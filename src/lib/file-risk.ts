/**
 * File risk labels for the Review workbench.
 * Pure path/heuristic classification — no I/O.
 *
 * Horizon 2: generated | config | security-sensitive | test-only |
 * unknown binary | large file | source | docs.
 */

import type { FileDiff } from "./types";

export type FileRiskKind =
  | "security"
  | "config"
  | "generated"
  | "test"
  | "binary"
  | "large"
  | "source"
  | "docs"
  | "unknown";

/** Higher number = review earlier in the queue. */
export type FileRiskLevel = "critical" | "high" | "medium" | "low" | "info";

export interface FileRisk {
  kind: FileRiskKind;
  level: FileRiskLevel;
  /** Human label for badges and headers. */
  label: string;
  /** 2–4 char chip. */
  shortLabel: string;
  description: string;
  /** Sort key: lower first. */
  sortPriority: number;
}

const LARGE_LINE_THRESHOLD = 400;
const LARGE_HUNK_THRESHOLD = 40;

const SECURITY_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  ".env.staging",
  "credentials.json",
  "credentials.csv",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "auth.json",
  "service-account.json",
  "serviceaccount.json",
]);

const SECURITY_EXT = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".kdbx",
]);

const SECURITY_PATH_RE =
  /(^|\/)(\.ssh|\.gnupg|secrets?|credentials?|private[-_]?keys?)(\/|$)/i;

const CONFIG_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "tsconfig.json",
  "jsconfig.json",
  "next.config.js",
  "next.config.ts",
  "next.config.mjs",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "rollup.config.js",
  "tailwind.config.js",
  "tailwind.config.ts",
  "postcss.config.js",
  "postcss.config.mjs",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".prettierrc",
  ".prettierrc.js",
  ".prettierrc.json",
  "prettier.config.js",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "cargo.toml",
  "go.mod",
  "go.sum",
  "pyproject.toml",
  "requirements.txt",
  "poetry.lock",
  "gemfile",
  "gemfile.lock",
  "makefile",
  "cmakelists.txt",
  "turbo.json",
  "nx.json",
  "project.json",
  "tauri.conf.json",
  "components.json",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  "rust-toolchain.toml",
  "procfile",
  "vercel.json",
  "netlify.toml",
  "fly.toml",
  "render.yaml",
]);

const CONFIG_PATH_RE =
  /(^|\/)(\.github|\.gitlab|\.circleci|\.vscode|\.idea|config|configs?|infra|deploy|deployment|helm|k8s|kubernetes|terraform|\.devcontainer)(\/|$)/i;

const GENERATED_PATH_RE =
  /(^|\/)(dist|build|out|output|\.next|\.nuxt|\.turbo|\.cache|coverage|node_modules|vendor|target\/(debug|release)|__pycache__|\.parcel-cache|\.svelte-kit)(\/|$)/i;

const GENERATED_BASENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  "uv.lock",
]);

const GENERATED_EXT = new Set([
  ".map",
  ".min.js",
  ".min.css",
  ".bundle.js",
  ".generated.ts",
  ".generated.js",
  ".gen.ts",
  ".gen.js",
]);

const DOCS_EXT = new Set([
  ".md",
  ".mdx",
  ".rst",
  ".txt",
  ".adoc",
  ".org",
]);

const DOCS_PATH_RE = /(^|\/)(docs?|documentation|changelog|license|readme)(\/|$)/i;

const TEST_PATH_RE =
  /(^|\/)(__tests__|__mocks__|tests?|spec|fixtures?|testdata|snapshots?)(\/|$)/i;

const TEST_FILE_RE =
  /(\.|_)(test|spec|tests|e2e|integration|unit)(\.|$)/i;

const SOURCE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".vue",
  ".svelte",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".sql",
  ".graphql",
  ".gql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
]);

function basename(path: string): string {
  const n = path.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i).toLowerCase();
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function risk(
  kind: FileRiskKind,
  level: FileRiskLevel,
  label: string,
  shortLabel: string,
  description: string,
  sortPriority: number
): FileRisk {
  return { kind, level, label, shortLabel, description, sortPriority };
}

/**
 * Classify a single path (and optional file metadata) into a review risk label.
 * Precedence: secret flag → binary → security patterns → generated → config →
 * test → large → docs → source → unknown.
 */
export function classifyFileRisk(
  path: string,
  meta?: Pick<
    FileDiff,
    "isSecret" | "isBinary" | "additions" | "deletions" | "hunks"
  >
): FileRisk {
  const p = normalize(path);
  const base = basename(p).toLowerCase();
  const ext = extname(p);
  const additions = meta?.additions ?? 0;
  const deletions = meta?.deletions ?? 0;
  const hunkCount = meta?.hunks?.length ?? 0;
  const lineChurn = additions + deletions;

  if (meta?.isSecret) {
    return risk(
      "security",
      "critical",
      "Security-sensitive",
      "SEC",
      "Matches secret deny list — content is redacted",
      0
    );
  }

  if (
    SECURITY_BASENAMES.has(base) ||
    SECURITY_EXT.has(ext) ||
    SECURITY_PATH_RE.test(p) ||
    base.endsWith(".env") ||
    base.includes(".env.")
  ) {
    return risk(
      "security",
      "critical",
      "Security-sensitive",
      "SEC",
      "Likely credentials, keys, or secret material",
      1
    );
  }

  if (meta?.isBinary) {
    return risk(
      "binary",
      "high",
      "Binary",
      "BIN",
      "Binary or non-text content — review carefully",
      10
    );
  }

  // Generated before config so lockfiles land in generated when both match
  if (
    GENERATED_BASENAMES.has(base) ||
    GENERATED_PATH_RE.test(p) ||
    [...GENERATED_EXT].some((e) => base.endsWith(e))
  ) {
    return risk(
      "generated",
      "low",
      "Generated",
      "GEN",
      "Lockfile, build output, or generated artifact",
      50
    );
  }

  if (
    CONFIG_BASENAMES.has(base) ||
    CONFIG_PATH_RE.test(p) ||
    base.startsWith(".") &&
      (ext === ".json" ||
        ext === ".yml" ||
        ext === ".yaml" ||
        ext === ".toml" ||
        ext === ".ini" ||
        !ext)
  ) {
    return risk(
      "config",
      "high",
      "Config",
      "CFG",
      "Build, package, CI, or tooling configuration",
      20
    );
  }

  if (
    TEST_PATH_RE.test(p) ||
    TEST_FILE_RE.test(base) ||
    base.endsWith(".snap")
  ) {
    return risk(
      "test",
      "low",
      "Test-only",
      "TEST",
      "Test, fixture, or snapshot file",
      60
    );
  }

  if (
    lineChurn >= LARGE_LINE_THRESHOLD ||
    hunkCount >= LARGE_HUNK_THRESHOLD
  ) {
    return risk(
      "large",
      "medium",
      "Large change",
      "LG",
      `High churn (+${additions}/−${deletions}) — scan carefully`,
      30
    );
  }

  if (
    DOCS_EXT.has(ext) ||
    DOCS_PATH_RE.test(p) ||
    base === "readme" ||
    base.startsWith("readme.") ||
    base === "license" ||
    base.startsWith("license.") ||
    base === "changelog" ||
    base.startsWith("changelog.")
  ) {
    return risk(
      "docs",
      "info",
      "Docs",
      "DOC",
      "Documentation or prose",
      70
    );
  }

  if (SOURCE_EXT.has(ext)) {
    return risk(
      "source",
      "medium",
      "Source",
      "SRC",
      "Application or library source",
      40
    );
  }

  return risk(
    "unknown",
    "medium",
    "Unknown",
    "?",
    "Unclassified path — open and inspect",
    35
  );
}

export function fileRiskBadgeVariant(
  level: FileRiskLevel
): "error" | "amber" | "magenta" | "cyan" | "muted" | "default" {
  switch (level) {
    case "critical":
      return "error";
    case "high":
      return "amber";
    case "medium":
      return "magenta";
    case "low":
      return "cyan";
    default:
      return "muted";
  }
}

export function riskLevelRank(level: FileRiskLevel): number {
  switch (level) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}
