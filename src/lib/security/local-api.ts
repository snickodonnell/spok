import { randomBytes, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { CAPABILITY_HEADER } from "./local-api-shared";

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
  | "path_denied"
  | "forbidden";

export type LocalPolicyDenial = {
  error: string;
  code: LocalPolicyCode;
  policy: "local_capability" | "origin_host" | "workspace_trust" | "command_profile" | "path_policy";
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

  const [host, port] = raw.split(":");
  return { host, port };
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

export function isLocalHostAllowed(hostHeader: string | null): boolean {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed) return false;
  return allowedHosts().has(parsed.host);
}

/**
 * Validate Origin for browser callers.
 * - Missing Origin is allowed only for same-machine tooling when Host is local
 *   (e.g. some navigations / non-CORS GETs). Privileged routes still need the token.
 * - When Origin is present it must be http(s) to an allowed local host.
 */
export function isOriginAllowed(origin: string | null, hostHeader: string | null): boolean {
  if (!isLocalHostAllowed(hostHeader)) return false;
  if (!origin) return true;

  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const originHost = url.hostname.toLowerCase();
    const normalized =
      originHost === "::1" || originHost === "[::1]" ? "[::1]" : originHost;
    return allowedHosts().has(normalized) || allowedHosts().has(originHost);
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

export function policyDenialResponse(
  status: number,
  body: LocalPolicyDenial
): NextResponse {
  return NextResponse.json(body, { status });
}

export function denyFromAuthorize(result: Extract<AuthorizeResult, { ok: false }>): NextResponse {
  return policyDenialResponse(result.status, result.body);
}

/** Default allowlist: only the Grok CLI binary (basename match). */
export function isCommandAllowed(command: string): boolean {
  if (process.env.SPOK_ALLOW_CUSTOM_COMMANDS === "1") return true;
  const allowed = (process.env.SPOK_GROK_CMD || "grok").trim();
  const base = command.replace(/\\/g, "/").split("/").pop() || command;
  const allowedBase = allowed.replace(/\\/g, "/").split("/").pop() || allowed;
  return base.toLowerCase() === allowedBase.toLowerCase();
}
