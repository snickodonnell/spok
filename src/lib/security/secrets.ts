/** Normalize a repo-relative path for deny-glob matching (forward slashes). Browser-safe. */
export function normalizeRepoRelativePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export type RedactionCategory =
  | "api_key"
  | "bearer_token"
  | "aws_key"
  | "private_key"
  | "connection_string"
  | "generic_secret";

export type RedactionResult = {
  text: string;
  redacted: boolean;
  categories: RedactionCategory[];
  count: number;
};

/** Paths that must never be read into git-diff previews or exports. */
export const SECRET_DENY_GLOBS: readonly string[] = [
  ".env",
  ".env.*",
  "*.env",
  "**/.env",
  "**/.env.*",
  "**/credentials",
  "**/credentials.*",
  "**/*credentials*",
  "**/*secret*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.jks",
  "**/id_rsa",
  "**/id_rsa.*",
  "**/id_ed25519",
  "**/id_ed25519.*",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/.npmrc",
  "**/.pypirc",
  "**/netrc",
  "**/.netrc",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/gcloud/**/*.json",
  "**/service-account*.json",
  "**/*serviceaccount*.json",
  "**/kubeconfig",
  "**/.kube/config",
  "**/*.keystore",
  "**/docker/config.json",
  "**/.docker/config.json",
];

const SECRET_PATTERNS: Array<{ category: RedactionCategory; re: RegExp }> = [
  {
    category: "private_key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    category: "aws_key",
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    category: "bearer_token",
    re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  },
  {
    category: "api_key",
    re: /\b(?:sk|pk|rk|api|key)[_-](?:live|test|prod)?[_-]?[A-Za-z0-9]{16,}\b/gi,
  },
  {
    category: "api_key",
    re: /\b(?:xai|openai|anthropic|ghp|gho|github_pat)[_-][A-Za-z0-9]{20,}\b/gi,
  },
  {
    category: "connection_string",
    re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s"'<>]+/gi,
  },
  {
    category: "generic_secret",
    re: /(?:^|[\s,;{])(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^\s"'<>]{8,}/gi,
  },
];

const REDACTION_PLACEHOLDER = "[REDACTED]";

/**
 * Simple glob matcher supporting `*`, `**`, and path segments.
 * Patterns are matched against forward-slash normalized relative paths.
 */
export function matchDenyGlob(filePath: string, pattern: string): boolean {
  const pathNorm = normalizeRepoRelativePath(filePath).toLowerCase();
  const pat = pattern.replace(/\\/g, "/").toLowerCase();

  // Exact basename patterns like ".env"
  if (!pat.includes("/") && !pat.includes("*")) {
    const base = pathNorm.split("/").pop() ?? pathNorm;
    return base === pat;
  }

  const regex = globToRegExp(pat);
  return regex.test(pathNorm);
}

function globToRegExp(glob: string): RegExp {
  let i = 0;
  let out = "^";
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 3;
      } else {
        out += ".*";
        i += 2;
      }
      continue;
    }
    if (c === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if ("+^$|(){}[]\\.".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}

export function isDeniedSecretPath(filePath: string): boolean {
  return SECRET_DENY_GLOBS.some((g) => matchDenyGlob(filePath, g));
}

/**
 * Detect obvious binary content (NUL bytes or high non-text ratio in a sample).
 */
export function isLikelyBinary(content: string | Buffer, sampleBytes = 8192): boolean {
  if (typeof content === "string") {
    if (content.includes("\0")) return true;
    const sample = content.slice(0, sampleBytes);
    if (!sample.length) return false;
    let nonText = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (code === 0) return true;
      // Allow common whitespace; flag other C0 controls and high binary-ish ratios
      if (code < 9 || (code > 13 && code < 32)) nonText += 1;
    }
    return nonText / sample.length > 0.1;
  }

  const sample = content.subarray(0, Math.min(content.length, sampleBytes));
  if (sample.includes(0)) return true;
  let nonText = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample[i];
    if (code < 9 || (code > 13 && code < 32) || code === 0x7f) nonText += 1;
  }
  return sample.length > 0 && nonText / sample.length > 0.1;
}

export function redactSecrets(input: string): RedactionResult {
  if (!input) {
    return { text: input, redacted: false, categories: [], count: 0 };
  }

  let text = input;
  const categories = new Set<RedactionCategory>();
  let count = 0;

  for (const { category, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    const next = text.replace(re, () => {
      categories.add(category);
      count += 1;
      return REDACTION_PLACEHOLDER;
    });
    text = next;
  }

  return {
    text,
    redacted: count > 0,
    categories: [...categories],
    count,
  };
}

/** Redact string fields commonly present on stream/session payloads. */
export function redactDeepStrings<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (typeof value === "string") {
    return redactSecrets(value).text as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeepStrings(v, depth + 1)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Drop raw env maps from exports rather than risk leaking
      if (k === "env" && v && typeof v === "object") {
        out[k] = { "[redacted]": true };
        continue;
      }
      out[k] = redactDeepStrings(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

export type FilePreviewDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "skip"; reason: string };

export function decideFilePreview(opts: {
  relativePath: string;
  sizeBytes: number;
  maxBytes: number;
  contentSample?: string | Buffer;
}): FilePreviewDecision {
  if (isDeniedSecretPath(opts.relativePath)) {
    return {
      action: "deny",
      reason: `Path matches secret deny list: ${opts.relativePath}`,
    };
  }
  if (opts.sizeBytes > opts.maxBytes) {
    return {
      action: "skip",
      reason: `File too large to preview (${opts.sizeBytes} bytes)`,
    };
  }
  if (opts.contentSample != null && isLikelyBinary(opts.contentSample)) {
    return {
      action: "skip",
      reason: "Binary file skipped in preview",
    };
  }
  return { action: "allow" };
}
