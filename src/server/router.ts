/**
 * Minimal path dispatcher for the standalone Node runtime (Track A PR2 precursor).
 * Next.js continues to host production/dev web; this enables loopback-only dogfood.
 */

import {
  handleAutomationJobsGet,
  handleAutomationJobsPost,
  handleAutomationJobsPut,
  handleApprovalsDelete,
  handleApprovalsGet,
  handleApprovalsPost,
  handleCliStatusGet,
  handleDiagnosticsGet,
  handleFsBrowseGet,
  handleGitDiffGet,
  handleGitGet,
  handleGitPost,
  handleHealthGet,
  handleSessionEventsGet,
  handleSessionEventsPost,
  handleSessionIdDelete,
  handleSessionIdGet,
  handleSessionIdPut,
  handleSessionStartDelete,
  handleSessionStartPost,
  handleSessionsListGet,
  handleSessionsListPost,
  handleSettingsGet,
  handleSettingsPut,
  handleTrustDelete,
  handleTrustGet,
  handleTrustPost,
} from "./index";

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

function match(
  method: string,
  pathname: string
): { handler: Handler; params: Record<string, string> } | null {
  const m = method.toUpperCase();

  if (pathname === "/api/health" && m === "GET") {
    return { handler: handleHealthGet, params: {} };
  }
  if (pathname === "/api/automation/jobs" && m === "GET") {
    return { handler: handleAutomationJobsGet, params: {} };
  }
  if (pathname === "/api/automation/jobs" && m === "POST") {
    return { handler: handleAutomationJobsPost, params: {} };
  }
  if (pathname === "/api/automation/jobs" && m === "PUT") {
    return { handler: handleAutomationJobsPut, params: {} };
  }
  if (pathname === "/api/session/start" && m === "POST") {
    return { handler: handleSessionStartPost, params: {} };
  }
  if (pathname === "/api/session/start" && m === "DELETE") {
    return { handler: handleSessionStartDelete, params: {} };
  }
  if (pathname === "/api/fs/browse" && m === "GET") {
    return { handler: handleFsBrowseGet, params: {} };
  }
  if (pathname === "/api/workspace/trust" && m === "GET") {
    return { handler: handleTrustGet, params: {} };
  }
  if (pathname === "/api/workspace/trust" && m === "POST") {
    return { handler: handleTrustPost, params: {} };
  }
  if (pathname === "/api/workspace/trust" && m === "DELETE") {
    return { handler: handleTrustDelete, params: {} };
  }
  if (pathname === "/api/session/git" && m === "GET") {
    return { handler: handleGitGet, params: {} };
  }
  if (pathname === "/api/session/git" && m === "POST") {
    return { handler: handleGitPost, params: {} };
  }
  if (pathname === "/api/session/git-diff" && m === "GET") {
    return { handler: handleGitDiffGet, params: {} };
  }
  if (pathname === "/api/sessions" && m === "GET") {
    return { handler: handleSessionsListGet, params: {} };
  }
  if (pathname === "/api/sessions" && m === "POST") {
    return { handler: handleSessionsListPost, params: {} };
  }
  if (pathname === "/api/settings" && m === "GET") {
    return { handler: handleSettingsGet, params: {} };
  }
  if (pathname === "/api/settings" && m === "PUT") {
    return { handler: handleSettingsPut, params: {} };
  }
  if (pathname === "/api/approvals" && m === "GET") {
    return { handler: handleApprovalsGet, params: {} };
  }
  if (pathname === "/api/approvals" && m === "POST") {
    return { handler: handleApprovalsPost, params: {} };
  }
  if (pathname === "/api/approvals" && m === "DELETE") {
    return { handler: handleApprovalsDelete, params: {} };
  }
  if (pathname === "/api/diagnostics" && m === "GET") {
    return { handler: handleDiagnosticsGet, params: {} };
  }
  if (pathname === "/api/runtime/cli-status" && m === "GET") {
    return { handler: handleCliStatusGet, params: {} };
  }

  const sessionEvents = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (sessionEvents) {
    const id = decodeURIComponent(sessionEvents[1]);
    if (m === "GET") {
      return {
        handler: (req) => handleSessionEventsGet(req, { params: Promise.resolve({ id }) }),
        params: { id },
      };
    }
    if (m === "POST") {
      return {
        handler: (req) => handleSessionEventsPost(req, { params: Promise.resolve({ id }) }),
        params: { id },
      };
    }
  }

  const sessionId = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionId) {
    const id = decodeURIComponent(sessionId[1]);
    if (m === "GET") {
      return {
        handler: (req) => handleSessionIdGet(req, { params: Promise.resolve({ id }) }),
        params: { id },
      };
    }
    if (m === "PUT") {
      return {
        handler: (req) => handleSessionIdPut(req, { params: Promise.resolve({ id }) }),
        params: { id },
      };
    }
    if (m === "DELETE") {
      return {
        handler: (req) => handleSessionIdDelete(req, { params: Promise.resolve({ id }) }),
        params: { id },
      };
    }
  }

  return null;
}

/** Dispatch a Fetch API Request to the extracted handlers. */
export async function dispatchRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const hit = match(req.method, url.pathname);
  if (!hit) {
    return Response.json(
      { error: "Not found", path: url.pathname },
      { status: 404 }
    );
  }
  return hit.handler(req, { params: Promise.resolve(hit.params) });
}
