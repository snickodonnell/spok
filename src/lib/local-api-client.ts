"use client";

import { CAPABILITY_HEADER } from "./security/local-api-shared";

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;

/** Sync read of last token (for pagehide / keepalive stop). */
export function getCachedCapabilityToken(): string | null {
  return cachedToken;
}

/**
 * Fetch the per-process capability token from the local health endpoint.
 * Token is only issued when Origin/Host validation passes on the server.
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  ms: number
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function getCapabilityToken(force = false): Promise<string> {
  if (!force && cachedToken) return cachedToken;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const res = await fetchWithTimeout(
      "/api/health",
      { cache: "no-store" },
      8_000
    );
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      throw new Error(
        errBody.error ||
          `Failed to obtain local capability token (${res.status}). If on phone Wi‑Fi, start with npm run dev:lan (SPOK_LAN_ACCESS).`
      );
    }
    const data = (await res.json()) as { localToken?: string; error?: string };
    if (!data.localToken) {
      throw new Error(data.error || "Health endpoint did not return a capability token");
    }
    cachedToken = data.localToken;
    return cachedToken;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Fetch wrapper that attaches the local capability token. Retries once on 401. */
export async function localFetch(
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getCapabilityToken();
  const headers = new Headers(init.headers);
  headers.set(CAPABILITY_HEADER, token);

  let res = await fetch(input, { ...init, headers });

  if (res.status === 401 || res.status === 403) {
    // Token may have rotated after server restart — refresh once
    const bodyPeek = await res
      .clone()
      .json()
      .catch(() => null) as { code?: string } | null;
    if (
      bodyPeek?.code === "missing_token" ||
      bodyPeek?.code === "invalid_token"
    ) {
      const fresh = await getCapabilityToken(true);
      headers.set(CAPABILITY_HEADER, fresh);
      res = await fetch(input, { ...init, headers });
    }
  }

  return res;
}

export async function trustWorkspace(path: string): Promise<{ root: string }> {
  const res = await localFetch("/api/workspace/trust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    root?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to trust workspace (${res.status})`);
  }
  if (!data.root) throw new Error("Trust response missing root");
  return { root: data.root };
}
