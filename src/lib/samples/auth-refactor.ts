import type { StreamEvent, SampleSessionMeta } from "../types";

export const authRefactorMeta: SampleSessionMeta = {
  id: "sample-auth-refactor",
  name: "Auth middleware refactor",
  description:
    "Grok Build refactors Express auth middleware into modular JWT + session handlers with tests.",
  duration: "~2m",
  filesChanged: 5,
  toolCalls: 12,
  tags: ["refactor", "typescript", "auth"],
};

const t0 = Date.now() - 120_000;

function ev(
  offset: number,
  partial: Omit<StreamEvent, "timestamp"> & { timestamp?: number }
): StreamEvent {
  return { ...partial, timestamp: t0 + offset };
}

export const authRefactorEvents: StreamEvent[] = [
  ev(0, {
    type: "session_start",
    id: "s0",
    title: "Session started",
    content: "Grok Build session: refactor auth middleware",
  }),
  ev(500, {
    type: "goal",
    id: "g1",
    title: "Goal",
    content:
      "Refactor the monolithic auth middleware into modular JWT verification and session handling. Add unit tests and keep the public API stable.",
  }),
  ev(2000, {
    type: "thinking",
    id: "th1",
    parentId: "g1",
    title: "Exploring codebase",
    content:
      "I need to understand the current auth structure. Looking for middleware entry points under src/middleware and any JWT utilities.",
    status: "running",
  }),
  ev(3500, {
    type: "tool_call",
    id: "tc1",
    parentId: "th1",
    title: "Tool: list_dir",
    toolName: "list_dir",
    content: 'list_dir({ target_directory: "src" })',
    status: "running",
  }),
  ev(4200, {
    type: "tool_result",
    id: "tr1",
    parentId: "tc1",
    title: "Result: list_dir",
    toolName: "list_dir",
    content: "src/\n  middleware/\n    auth.ts\n  routes/\n    users.ts\n  utils/\n    jwt.ts\n  types/\n    auth.ts",
    status: "success",
    durationMs: 700,
  }),
  ev(5500, {
    type: "tool_call",
    id: "tc2",
    parentId: "th1",
    title: "Tool: read_file",
    toolName: "read_file",
    content: 'read_file({ target_file: "src/middleware/auth.ts" })',
    status: "running",
  }),
  ev(6800, {
    type: "tool_result",
    id: "tr2",
    parentId: "tc2",
    title: "Result: read_file",
    toolName: "read_file",
    content:
      "Monolithic auth middleware: 180 lines handling JWT parse, session lookup, role checks, and error formatting in one function.",
    status: "success",
    durationMs: 1200,
  }),
  ev(8000, {
    type: "thinking",
    id: "th2",
    parentId: "g1",
    title: "Design approach",
    content:
      "I'll split into:\n1. verifyJwt() — token extraction + verification\n2. loadSession() — optional session hydration\n3. requireRole() — composable role guard\n4. Keep authMiddleware as a thin composition for backwards compatibility.",
    status: "success",
  }),
  ev(9500, {
    type: "plan",
    id: "pl1",
    parentId: "g1",
    title: "Plan",
    content:
      "1. Extract JWT verification to src/middleware/verify-jwt.ts\n2. Extract session loading to src/middleware/load-session.ts\n3. Refactor auth.ts as composer\n4. Add unit tests\n5. Run typecheck",
    status: "running",
  }),
  ev(12000, {
    type: "tool_call",
    id: "tc3",
    parentId: "pl1",
    title: "Tool: write",
    toolName: "write",
    content: "Creating src/middleware/verify-jwt.ts",
    status: "running",
  }),
  ev(14000, {
    type: "file_change",
    id: "fc1",
    parentId: "tc3",
    title: "File: src/middleware/verify-jwt.ts",
    path: "src/middleware/verify-jwt.ts",
    diffStatus: "added",
    oldContent: "",
    newContent: `import { Request, Response, NextFunction } from "express";
import { verifyToken, JwtPayload } from "../utils/jwt";

export interface AuthedRequest extends Request {
  user?: JwtPayload;
}

/**
 * Extract Bearer token and verify JWT signature + expiry.
 */
export function verifyJwt(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
`,
    content: "Added verifyJwt middleware",
    status: "success",
  }),
  ev(14500, {
    type: "tool_result",
    id: "tr3",
    parentId: "tc3",
    title: "Result: write",
    toolName: "write",
    content: "Wrote src/middleware/verify-jwt.ts",
    status: "success",
    durationMs: 2500,
  }),
  ev(16000, {
    type: "tool_call",
    id: "tc4",
    parentId: "pl1",
    title: "Tool: write",
    toolName: "write",
    content: "Creating src/middleware/load-session.ts",
    status: "running",
  }),
  ev(18000, {
    type: "file_change",
    id: "fc2",
    parentId: "tc4",
    title: "File: src/middleware/load-session.ts",
    path: "src/middleware/load-session.ts",
    diffStatus: "added",
    oldContent: "",
    newContent: `import { Response, NextFunction } from "express";
import { AuthedRequest } from "./verify-jwt";
import { sessionStore } from "../utils/session-store";

/**
 * Optionally hydrate session data after JWT verification.
 */
export async function loadSession(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.sub) return next();
  try {
    const session = await sessionStore.get(req.user.sub);
    if (session) {
      (req as AuthedRequest & { session?: typeof session }).session = session;
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: "Session lookup failed" });
  }
}
`,
    content: "Added loadSession middleware",
    status: "success",
  }),
  ev(18500, {
    type: "tool_result",
    id: "tr4",
    parentId: "tc4",
    title: "Result: write",
    content: "Wrote src/middleware/load-session.ts",
    status: "success",
    durationMs: 2500,
  }),
  ev(20000, {
    type: "thinking",
    id: "th3",
    parentId: "g1",
    title: "Refactoring composer",
    content:
      "Now rewrite auth.ts to compose verifyJwt + loadSession while exporting requireRole for routes that need it.",
    status: "running",
  }),
  ev(22000, {
    type: "file_change",
    id: "fc3",
    parentId: "th3",
    title: "File: src/middleware/auth.ts",
    path: "src/middleware/auth.ts",
    diffStatus: "modified",
    oldContent: `import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { sessionStore } from "../utils/session-store";

const SECRET = process.env.JWT_SECRET || "dev-secret";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, SECRET) as { sub: string; role: string };
    (req as any).user = payload;
    sessionStore.get(payload.sub).then((session) => {
      if (session) (req as any).session = session;
      if (req.path.startsWith("/admin") && payload.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    }).catch(() => res.status(500).json({ error: "Session lookup failed" }));
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
`,
    newContent: `import { Response, NextFunction } from "express";
import { verifyJwt, AuthedRequest } from "./verify-jwt";
import { loadSession } from "./load-session";

export { verifyJwt, loadSession };
export type { AuthedRequest };

/**
 * Backwards-compatible auth stack: JWT verify then session hydrate.
 */
export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  verifyJwt(req, res, (err?: unknown) => {
    if (err) return next(err);
    return loadSession(req, res, next);
  });
}

/**
 * Role guard — use after authMiddleware / verifyJwt.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}
`,
    content: "Refactored auth middleware composer",
    status: "success",
  }),
  ev(25000, {
    type: "plan_update",
    id: "pl2",
    parentId: "pl1",
    title: "Plan update",
    content:
      "✓ Extract JWT verification\n✓ Extract session loading\n✓ Refactor auth.ts composer\n→ Add unit tests\n○ Run typecheck",
    status: "running",
  }),
  ev(27000, {
    type: "subagent_start",
    id: "sa1",
    parentId: "g1",
    title: "Subagent: test-writer",
    subagentId: "test-writer",
    content: "Spawning subagent to write unit tests for middleware modules.",
    status: "running",
  }),
  ev(29000, {
    type: "thinking",
    id: "th4",
    parentId: "sa1",
    title: "Writing tests",
    content: "Cover: missing token, invalid token, valid token, role guard allow/deny.",
    status: "running",
  }),
  ev(32000, {
    type: "file_change",
    id: "fc4",
    parentId: "th4",
    title: "File: src/middleware/__tests__/auth.test.ts",
    path: "src/middleware/__tests__/auth.test.ts",
    diffStatus: "added",
    oldContent: "",
    newContent: `import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyJwt, requireRole, AuthedRequest } from "../auth";
import * as jwtUtil from "../../utils/jwt";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("verifyJwt", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rejects missing bearer token", () => {
    const req = { headers: {} } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();
    verifyJwt(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts valid token", () => {
    vi.spyOn(jwtUtil, "verifyToken").mockReturnValue({ sub: "u1", role: "user" });
    const req = { headers: { authorization: "Bearer good" } } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();
    verifyJwt(req, res, next);
    expect(req.user?.sub).toBe("u1");
    expect(next).toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  it("forbids wrong role", () => {
    const req = { user: { sub: "u1", role: "user" } } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();
    requireRole("admin")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows matching role", () => {
    const req = { user: { sub: "u1", role: "admin" } } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();
    requireRole("admin")(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
`,
    content: "Added auth middleware tests",
    status: "success",
  }),
  ev(34000, {
    type: "subagent_end",
    id: "sa1e",
    parentId: "sa1",
    title: "Subagent finished",
    subagentId: "test-writer",
    content: "Test writer completed successfully.",
    status: "success",
    durationMs: 7000,
  }),
  ev(36000, {
    type: "tool_call",
    id: "tc5",
    parentId: "g1",
    title: "Tool: run_terminal_command",
    toolName: "run_terminal_command",
    content: 'npx vitest run src/middleware/__tests__/auth.test.ts',
    status: "running",
  }),
  ev(40000, {
    type: "tool_result",
    id: "tr5",
    parentId: "tc5",
    title: "Result: tests",
    content: "✓ src/middleware/__tests__/auth.test.ts (4)\n  Test Files  1 passed (1)\n  Tests  4 passed (4)",
    status: "success",
    durationMs: 3800,
  }),
  ev(42000, {
    type: "file_change",
    id: "fc5",
    parentId: "g1",
    title: "File: src/routes/users.ts",
    path: "src/routes/users.ts",
    diffStatus: "modified",
    oldContent: `import { Router } from "express";
import { authMiddleware } from "../middleware/auth";

export const usersRouter = Router();

usersRouter.get("/me", authMiddleware, (req, res) => {
  res.json({ user: (req as any).user });
});

usersRouter.get("/admin/stats", authMiddleware, (req, res) => {
  res.json({ ok: true });
});
`,
    newContent: `import { Router } from "express";
import { authMiddleware, requireRole } from "../middleware/auth";

export const usersRouter = Router();

usersRouter.get("/me", authMiddleware, (req, res) => {
  res.json({ user: (req as any).user });
});

usersRouter.get(
  "/admin/stats",
  authMiddleware,
  requireRole("admin"),
  (req, res) => {
    res.json({ ok: true });
  }
);
`,
    content: "Updated routes to use requireRole",
    status: "success",
  }),
  ev(45000, {
    type: "plan_update",
    id: "pl3",
    parentId: "pl1",
    title: "Plan complete",
    content:
      "✓ Extract JWT verification\n✓ Extract session loading\n✓ Refactor auth.ts composer\n✓ Add unit tests\n✓ Update routes\n✓ All tests passing",
    status: "success",
  }),
  ev(47000, {
    type: "message",
    id: "m1",
    parentId: "g1",
    title: "Summary",
    content:
      "Auth middleware is now modular:\n- verify-jwt.ts — token verification\n- load-session.ts — session hydration\n- auth.ts — composer + requireRole\n- routes use requireRole for admin\n- 4 unit tests passing\n\nPublic authMiddleware() API preserved for existing callers.",
    status: "success",
  }),
  ev(48000, {
    type: "session_end",
    id: "s1",
    title: "Session completed",
    content: "Session finished successfully",
    status: "success",
  }),
];
