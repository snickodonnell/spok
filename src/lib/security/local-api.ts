import { randomBytes, timingSafeEqual } from "crypto";
import { CAPABILITY_HEADER } from "./local-api-shared";
import { resolveCommandProfile } from "./command-profiles";

export { CAPABILITY_HEADER };

/** Per-process capability token for privileged local routes. */
const processToken =
  process.env.SPOK_LOCAL_TOKEN?.trim() ||
  randomBytes(32).toString("base64url");

export function getLocalCapabilityToken(): string {
  return processToken;
}

export type LocalPolicyCode =
  | "missing_token"
  | "invalid_token"
  | "invalid_origin"
  | "invalid_host"
  | "untrusted_cwd"
  | "command_not_allowed"
  | "invalid_run_spec"
  | "capability_mismatch"
  | "session_already_running"
  | "invalid_receipt"
  | "path_denied"
  | "approval_required"
  | "forbidden";

export type LocalPolicyDenial = {
  error: string;
  code: LocalPolicyCode;
  policy:
    | "local_capability"
    | "origin_host"
    | "workspace_trust"
    | "command_profile"
    | "provider_contract"
    | "path_policy";
  action?: string;
  details?: Record<string, unknown>;
};

export type AuthorizeResult =
  | { ok: true }
  | { ok: false; status: number; body: LocalPolicyDenial };

const DEFAULT_LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
]);

/**
 * When true, Host/Origin may be RFC1918 private LAN addresses (and link-local).
 * Required for phone/tablet access on the same Wi‑Fi. Off by default — Spok
 * remains loopback-only until you opt in (`SPOK_LAN_ACCESS=1` or `npm run dev:lan`).
 */
export function isLanAccessEnabled(): boolean {
  const v = process.env.SPOK_LAN_ACCESS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseHostHeader(hostHeader: string | null): { host: string; port?: string } | null {
  if (!hostHeader) return null;
  const raw = hostHeader.trim().toLowerCase();
  if (!raw) return null;

  // IPv6 in brackets: [::1]:3000
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end === -1) return null;
    const host = raw.slice(0, end + 1);
    const rest = raw.slice(end + 1);
    const port = rest.startsWith(":") ? rest.slice(1) : undefined;
    return { host, port };
  }

  // Hostnames / IPv4: last colon separates port (avoid splitting IPv6 without brackets)
  const lastColon = raw.lastIndexOf(":");
  if (lastColon > 0 && /^\d+$/.test(raw.slice(lastColon + 1))) {
    return { host: raw.slice(0, lastColon), port: raw.slice(lastColon + 1) };
  }
  return { host: raw };
}

function allowedHosts(): Set<string> {
  const set = new Set(DEFAULT_LOCAL_HOSTS);
  const extra = process.env.SPOK_ALLOWED_HOSTS?.split(",") ?? [];
  for (const h of extra) {
    const t = h.trim().toLowerCase();
    if (t) set.add(t);
  }
  return set;
}

/**
 * RFC1918 + common local-only ranges for optional LAN hosting.
 * Does **not** include public internet addresses.
 */
export function isPrivateLanHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;

  // IPv4
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const parts = m.slice(1).map((x) => Number(x));
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    // Link-local (APIPA) — useful on ad-hoc networks
    if (a === 169 && b === 254) return true;
    return false;
  }

  // IPv6 unique local (fc00::/7) and link-local (fe80::/10)
  if (h.includes(":")) {
    if (h.startsWith("fc") || h.startsWith("fd")) return true;
    if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb"))
      return true;
  }

  // .local mDNS (e.g. mypc.local) — only when LAN mode is on (checked by caller)
  if (h.endsWith(".local")) return true;

  return false;
}

function hostIsAllowed(hostname: string): boolean {
  const normalized =
    hostname === "::1" || hostname === "[::1]" ? "[::1]" : hostname;
  if (allowedHosts().has(normalized) || allowedHosts().has(hostname)) {
    return true;
  }
  if (isLanAccessEnabled() && isPrivateLanHostname(hostname)) {
    return true;
  }
  return false;
}

export function isLocalHostAllowed(hostHeader: string | null): boolean {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed) return false;
  return hostIsAllowed(parsed.host);
}

/**
 * Validate Origin for browser callers.
 * - Missing Origin is allowed only when Host is allowed
 *   (e.g. some navigations / non-CORS GETs). Privileged routes still need the token.
 * - When Origin is present it must be http(s) to an allowed host (loopback and,
 *   if SPOK_LAN_ACCESS is on, private LAN addresses).
 */
export function isOriginAllowed(origin: string | null, hostHeader: string | null): boolean {
  if (!isLocalHostAllowed(hostHeader)) return false;
  if (!origin) return true;

  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const originHost = url.hostname.toLowerCase();
    return hostIsAllowed(originHost);
  } catch {
    return false;
  }
}

function safeEqualToken(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function extractCapabilityToken(req: Request): string | null {
  const header = req.headers.get(CAPABILITY_HEADER);
  if (header?.trim()) return header.trim();

  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    return token || null;
  }
  return null;
}

/**
 * Authorize a privileged local API request: Host/Origin + capability token.
 */
export function authorizePrivilegedRequest(
  req: Request,
  action: string
): AuthorizeResult {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");

  if (!isLocalHostAllowed(host)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "Host is not allowed for privileged local APIs",
        code: "invalid_host",
        policy: "origin_host",
        action,
        details: { host },
      },
    };
  }

  if (!isOriginAllowed(origin, host)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "Origin is not allowed for privileged local APIs",
        code: "invalid_origin",
        policy: "origin_host",
        action,
        details: { origin, host },
      },
    };
  }

  const token = extractCapabilityToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "Missing local capability token",
        code: "missing_token",
        policy: "local_capability",
        action,
      },
    };
  }

  if (!safeEqualToken(token, getLocalCapabilityToken())) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "Invalid local capability token",
        code: "invalid_token",
        policy: "local_capability",
        action,
      },
    };
  }

  return { ok: true };
}

/**
 * Structured policy denial as a standard Web Response.
 * Framework-agnostic so Next route wrappers and the standalone runtime share one denial shape.
 */
export function policyDenialResponse(
  status: number,
  body: LocalPolicyDenial
): Response {
  return Response.json(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function denyFromAuthorize(
  result: Extract<AuthorizeResult, { ok: false }>
): Response {
  return policyDenialResponse(result.status, result.body);
}

/**
 * Coarse allowlist used by tests and simple gates.
 * Full enforcement is `evaluatePolicy` (profiles, modes, grants, deny rules).
 * Shell interpreters are always denied at this layer.
 */
export function isCommandAllowed(command: string): boolean {
  if (matchShell(command)) return false;
  if (process.env.SPOK_ALLOW_CUSTOM_COMMANDS === "1") return true;
  const allowed = (process.env.SPOK_GROK_CMD || "grok").trim();
  const base = command.replace(/\\/g, "/").split("/").pop() || command;
  const allowedBase = allowed.replace(/\\/g, "/").split("/").pop() || allowed;
  if (base.toLowerCase() === allowedBase.toLowerCase()) return true;
  // Known non-custom profiles pass the coarse gate (may still need approval).
  return resolveCommandProfile(command).id !== "custom";
}

function matchShell(command: string): boolean {
  const base = (
    command.replace(/\\/g, "/").split("/").pop() || ""
  ).toLowerCase();
  return [
    "cmd",
    "cmd.exe",
    "powershell",
    "powershell.exe",
    "pwsh",
    "pwsh.exe",
    "bash",
    "sh",
    "zsh",
  ].includes(base);
}
