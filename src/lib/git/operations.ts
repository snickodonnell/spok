import path from "path";
import { writeFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { nanoid } from "nanoid";
import { canonicalizePath } from "@/lib/security/paths";
import { listTrustedRoots } from "@/lib/security/workspace-trust";
import { gitExec } from "./exec";
import { collectGitStatus, listWorktrees } from "./status";
import {
  assertWorktreeIsolation,
  registerManagedWorktree,
  unregisterManagedWorktree,
  worktreePathsEqual,
} from "./worktree-registry";
import { gitRiskProfile } from "./risk";
import {
  assertWorktreeLocationAllowed,
  isValidGitRefName,
  resolveRepoPaths,
  resolveWorktreeAbsPath,
} from "./paths";
import type {
  GitAction,
  GitActionRequest,
  GitActionResponse,
  GitCommitResult,
  GitPrResult,
  GitPushResult,
} from "./types";

function isolationCheck(req: GitActionRequest): string | null {
  const risk = gitRiskProfile(req.action).risk;
  if (risk === "read") return null;
  const r = assertWorktreeIsolation({
    cwd: req.cwd,
    mainCheckout: req.mainCheckout,
    isolationGuard: req.isolationGuard,
  });
  return r.ok ? null : r.reason;
}

async function runStatus(cwd: string): Promise<GitActionResponse> {
  const status = await collectGitStatus(cwd);
  return { ok: !status.error, action: "status", status, error: status.error };
}

async function stage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) {
    await gitExec(cwd, ["add", "-A"]);
    return;
  }
  await gitExec(cwd, ["add", "--", ...paths]);
}

async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) {
    await gitExec(cwd, ["reset", "HEAD"], { allowFail: true });
    return;
  }
  // `git restore --staged` is modern; fall back to reset
  const r = await gitExec(cwd, ["restore", "--staged", "--", ...paths], {
    allowFail: true,
  });
  if (r.code !== 0) {
    await gitExec(cwd, ["reset", "HEAD", "--", ...paths], { allowFail: true });
  }
}

async function discard(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) {
    throw new Error("Discard requires explicit path(s) — refusing to wipe the whole tree");
  }
  for (const p of paths) {
    const st = await gitExec(cwd, ["status", "--porcelain=v1", "-uall", "--", p], {
      allowFail: true,
    });
    const lines = st.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const isUntrackedOnly =
      lines.length > 0 && lines.every((line) => line.startsWith("??"));

    if (isUntrackedOnly) {
      // -fd: remove untracked dirs for this path only (still path-scoped)
      await gitExec(cwd, ["clean", "-fd", "--", p]);
      continue;
    }

    // Tracked (or mixed): restore worktree from HEAD
    const r = await gitExec(
      cwd,
      ["restore", "--worktree", "--source=HEAD", "--", p],
      { allowFail: true }
    );
    if (r.code !== 0) {
      await gitExec(cwd, ["checkout", "HEAD", "--", p]);
    }
    // Also drop leftover untracked alongside a tracked path
    const again = await gitExec(cwd, ["status", "--porcelain=v1", "-uall", "--", p], {
      allowFail: true,
    });
    if (again.stdout.trim().startsWith("??")) {
      await gitExec(cwd, ["clean", "-fd", "--", p], { allowFail: true });
    }
  }
}

/**
 * Apply a unified diff patch to index or worktree.
 * `mode`: cached = index only; reverse worktree for discard.
 */
async function applyPatch(
  cwd: string,
  patch: string,
  opts: { cached?: boolean; reverse?: boolean }
): Promise<void> {
  if (!patch.trim()) throw new Error("Empty patch");
  // Reject path escape attempts inside patch headers (basic)
  for (const line of patch.split(/\r?\n/)) {
    if (
      (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("diff --git ")) &&
      (line.includes("/../") || line.includes("\\..\\") || line.includes("\0"))
    ) {
      throw new Error("Patch contains invalid path");
    }
  }

  const dir = mkdtempSync(path.join(tmpdir(), "spok-patch-"));
  const file = path.join(dir, "hunk.patch");
  try {
    writeFileSync(file, patch.endsWith("\n") ? patch : patch + "\n", "utf8");
    const args = ["apply", "--whitespace=nowarn"];
    if (opts.cached) args.push("--cached");
    if (opts.reverse) args.push("-R");
    args.push("--", file);
    await gitExec(cwd, args);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function commit(
  cwd: string,
  message: string,
  amend?: boolean
): Promise<GitCommitResult> {
  const msg = message.trim();
  if (!msg && !amend) {
    return { ok: false, error: "Commit message is required" };
  }

  // Ensure something is staged (unless amend with no changes is ok for message-only)
  const staged = await gitExec(cwd, ["diff", "--cached", "--name-only"], {
    allowFail: true,
  });
  if (!amend && !staged.stdout.trim()) {
    return { ok: false, error: "Nothing staged to commit" };
  }

  const args = ["commit"];
  if (amend) args.push("--amend");
  if (msg) {
    args.push("-m", msg);
  } else if (amend) {
    args.push("--no-edit");
  }

  try {
    const r = await gitExec(cwd, args);
    const oid = await gitExec(cwd, ["rev-parse", "--short", "HEAD"], {
      allowFail: true,
    });
    return {
      ok: true,
      oid: oid.stdout.trim() || undefined,
      message: msg || undefined,
      summary: r.stdout.trim().split("\n")[0] || "Committed",
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "commit failed",
    };
  }
}

async function branchList(cwd: string): Promise<string[]> {
  const r = await gitExec(cwd, ["branch", "--format=%(refname:short)"], {
    allowFail: true,
  });
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function branchCreate(
  cwd: string,
  branch: string,
  startPoint?: string,
  checkout?: boolean
): Promise<void> {
  const name = branch.trim();
  if (!isValidGitRefName(name)) {
    throw new Error("Invalid branch name");
  }
  if (startPoint && !isValidGitRefName(startPoint) && !/^[0-9a-f]{7,40}$/i.test(startPoint)) {
    throw new Error("Invalid start point");
  }
  if (checkout) {
    const args = ["switch", "-c", name];
    if (startPoint) args.push(startPoint);
    const r = await gitExec(cwd, args, { allowFail: true });
    if (r.code !== 0) {
      // Older git without switch
      const legacy = ["checkout", "-b", name];
      if (startPoint) legacy.push(startPoint);
      await gitExec(cwd, legacy);
    }
  } else {
    const args = ["branch", name];
    if (startPoint) args.push(startPoint);
    await gitExec(cwd, args);
  }
}

async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  const name = branch.trim();
  if (!isValidGitRefName(name)) throw new Error("Invalid branch name");
  // Never use `checkout -- name` — that treats name as a path.
  const r = await gitExec(cwd, ["switch", name], { allowFail: true });
  if (r.code !== 0) {
    await gitExec(cwd, ["checkout", name]);
  }
}

async function push(
  cwd: string,
  remote?: string,
  branch?: string,
  force?: boolean
): Promise<GitPushResult> {
  const rem = remote?.trim() || "origin";
  const args = ["push", "-u", rem];
  if (force) args.push("--force-with-lease");
  if (branch?.trim()) args.push(branch.trim());
  try {
    const r = await gitExec(cwd, args, { timeoutMs: 180_000 });
    return {
      ok: true,
      remote: rem,
      branch: branch,
      stdout: r.stdout,
      stderr: r.stderr,
    };
  } catch (e) {
    return {
      ok: false,
      remote: rem,
      branch,
      error: e instanceof Error ? e.message : "push failed",
    };
  }
}

async function pull(cwd: string, remote?: string): Promise<GitPushResult> {
  const rem = remote?.trim() || "origin";
  try {
    const r = await gitExec(cwd, ["pull", "--ff-only", rem], {
      timeoutMs: 180_000,
    });
    return { ok: true, remote: rem, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    // Retry without ff-only message clarity
    return {
      ok: false,
      remote: rem,
      error: e instanceof Error ? e.message : "pull failed",
    };
  }
}

async function worktreeAdd(
  cwd: string,
  worktreePath: string,
  branch: string | undefined,
  sessionId?: string
): Promise<{ path: string; branch: string }> {
  const status = await collectGitStatus(cwd);
  const repoRoot = status.repoRoot || cwd;
  const abs = resolveWorktreeAbsPath(cwd, worktreePath);

  assertWorktreeLocationAllowed({
    absWorktreePath: abs,
    repoRoot,
    trustedRoots: listTrustedRoots(),
  });

  if (existsSync(abs)) {
    throw new Error(`Worktree path already exists: ${abs}`);
  }
  const branchName =
    branch?.trim() ||
    `spok/${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`;
  if (!isValidGitRefName(branchName)) {
    throw new Error("Invalid branch name for worktree");
  }

  // Create new branch at HEAD in a new worktree
  await gitExec(cwd, ["worktree", "add", "-b", branchName, abs]);

  const mainCheckout = canonicalizePath(
    status.mainWorktreePath || status.repoRoot || cwd
  );

  registerManagedWorktree({
    path: abs,
    mainCheckout,
    branch: branchName,
    sessionId,
    label: branchName,
  });

  return { path: abs, branch: branchName };
}

async function worktreeRemove(cwd: string, worktreePath: string): Promise<void> {
  const abs = resolveWorktreeAbsPath(cwd, worktreePath);
  const status = await collectGitStatus(cwd);
  const main = status.mainWorktreePath || status.repoRoot;
  if (worktreePathsEqual(abs, main) || worktreePathsEqual(abs, status.repoRoot)) {
    throw new Error("Refusing to remove the main worktree");
  }

  const wts = await listWorktrees(cwd);
  const target = wts.find((w) => worktreePathsEqual(w.path, abs));
  if (target?.isMain) throw new Error("Refusing to remove the main worktree");

  let r = await gitExec(cwd, ["worktree", "remove", "--force", abs], {
    allowFail: true,
  });
  if (r.code !== 0) {
    // Unlock then retry
    await gitExec(cwd, ["worktree", "unlock", abs], { allowFail: true });
    r = await gitExec(cwd, ["worktree", "remove", "--force", abs], {
      allowFail: true,
    });
    if (r.code !== 0) {
      throw new Error(r.stderr || r.stdout || "worktree remove failed");
    }
  }
  unregisterManagedWorktree(abs);
}

async function prCreate(
  cwd: string,
  title: string,
  body?: string
): Promise<GitPrResult> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const args = [
    "pr",
    "create",
    "--title",
    title.trim() || "Spok changes",
    "--body",
    body?.trim() || "Opened from Spok harness.",
  ];

  try {
    const r = await execFileAsync("gh", args, {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    const out = (r.stdout?.toString() || "").trim();
    const urlMatch = out.match(/https?:\/\/\S+/);
    return {
      ok: true,
      url: urlMatch?.[0],
      stdout: out,
    };
  } catch (e) {
    const err = e as { message?: string; stderr?: Buffer | string; code?: string };
    const msg = err.stderr?.toString() || err.message || "gh pr create failed";
    if (
      /not recognized|ENOENT|not found|command not found/i.test(msg) ||
      err.code === "ENOENT"
    ) {
      return {
        ok: false,
        unavailable: true,
        error:
          "GitHub CLI (gh) is not installed or not on PATH. Install gh or create the PR in the browser.",
      };
    }
    return { ok: false, error: msg.slice(0, 2000) };
  }
}

async function recentLog(
  cwd: string,
  limit = 12
): Promise<Array<{ oid: string; subject: string; author: string; date: string }>> {
  const r = await gitExec(
    cwd,
    [
      "log",
      `-n`,
      String(limit),
      "--format=%h%x09%s%x09%an%x09%ad",
      "--date=short",
    ],
    { allowFail: true }
  );
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [oid, subject, author, date] = line.split("\t");
      return {
        oid: oid || "",
        subject: subject || "",
        author: author || "",
        date: date || "",
      };
    });
}

/**
 * Execute a closed-set git action. Caller is responsible for trust + policy.
 */
export async function executeGitAction(
  req: GitActionRequest
): Promise<GitActionResponse> {
  const action = req.action as GitAction;
  const profile = gitRiskProfile(action);
  const cwd = canonicalizePath(req.cwd);

  if (profile.requiresConfirm && !req.confirm) {
    return {
      ok: false,
      action,
      needsConfirm: true,
      risk: profile.risk,
      error: `${profile.label} requires explicit confirmation`,
      code: "needs_confirm",
    };
  }

  if (req.force && action === "push" && !req.confirm) {
    return {
      ok: false,
      action,
      needsConfirm: true,
      risk: "destructive",
      error: "Force push requires explicit confirmation",
      code: "needs_confirm",
    };
  }

  const iso = isolationCheck(req);
  if (iso) {
    return {
      ok: false,
      action,
      error: iso,
      code: "isolation_guard",
      risk: profile.risk,
    };
  }

  try {
    switch (action) {
      case "status":
        return runStatus(cwd);

      case "stage": {
        const paths = resolveRepoPaths(cwd, req.paths);
        await stage(cwd, paths);
        return { ...(await runStatus(cwd)), action: "stage", ok: true };
      }

      case "unstage": {
        const paths = resolveRepoPaths(cwd, req.paths);
        await unstage(cwd, paths);
        return { ...(await runStatus(cwd)), action: "unstage", ok: true };
      }

      case "discard": {
        const paths = resolveRepoPaths(cwd, req.paths);
        if (!paths.length) {
          return {
            ok: false,
            action,
            error: "Select at least one path to discard",
            code: "paths_required",
          };
        }
        await discard(cwd, paths);
        return { ...(await runStatus(cwd)), action: "discard", ok: true };
      }

      case "stage_hunk": {
        if (!req.patch) {
          return { ok: false, action, error: "patch required", code: "patch_required" };
        }
        await applyPatch(cwd, req.patch, { cached: true });
        return { ...(await runStatus(cwd)), action: "stage_hunk", ok: true };
      }

      case "unstage_hunk": {
        if (!req.patch) {
          return { ok: false, action, error: "patch required", code: "patch_required" };
        }
        await applyPatch(cwd, req.patch, { cached: true, reverse: true });
        return { ...(await runStatus(cwd)), action: "unstage_hunk", ok: true };
      }

      case "discard_hunk": {
        if (!req.patch) {
          return { ok: false, action, error: "patch required", code: "patch_required" };
        }
        await applyPatch(cwd, req.patch, { reverse: true });
        return { ...(await runStatus(cwd)), action: "discard_hunk", ok: true };
      }

      case "commit": {
        const result = await commit(cwd, req.message || "", req.amend);
        const status = await collectGitStatus(cwd);
        return {
          ok: result.ok,
          action: "commit",
          commit: result,
          status,
          error: result.error,
        };
      }

      case "branch_list": {
        const branches = await branchList(cwd);
        return { ok: true, action: "branch_list", branches };
      }

      case "branch_create": {
        if (!req.branch) {
          return { ok: false, action, error: "branch name required" };
        }
        await branchCreate(cwd, req.branch, req.startPoint, req.createBranch !== false);
        const status = await collectGitStatus(cwd);
        const branches = await branchList(cwd);
        return { ok: true, action: "branch_create", status, branches };
      }

      case "checkout": {
        if (!req.branch) {
          return { ok: false, action, error: "branch name required" };
        }
        await checkoutBranch(cwd, req.branch);
        return { ...(await runStatus(cwd)), action: "checkout", ok: true };
      }

      case "push": {
        const pushResult = await push(cwd, req.remote, req.branch, req.force);
        const status = await collectGitStatus(cwd);
        return {
          ok: pushResult.ok,
          action: "push",
          push: pushResult,
          status,
          error: pushResult.error,
        };
      }

      case "pull": {
        const pullResult = await pull(cwd, req.remote);
        const status = await collectGitStatus(cwd);
        return {
          ok: pullResult.ok,
          action: "pull",
          push: pullResult,
          status,
          error: pullResult.error,
        };
      }

      case "worktree_list": {
        const worktrees = await listWorktrees(cwd);
        return { ok: true, action: "worktree_list", worktrees };
      }

      case "worktree_add": {
        if (!req.worktreePath) {
          return { ok: false, action, error: "worktreePath required" };
        }
        const created = await worktreeAdd(
          cwd,
          req.worktreePath,
          req.branch,
          req.sessionId
        );
        const worktrees = await listWorktrees(cwd);
        const status = await collectGitStatus(cwd);
        return {
          ok: true,
          action: "worktree_add",
          worktrees,
          status,
          createdWorktree: created,
          stdout: `Created worktree ${created.path} on ${created.branch}`,
        };
      }

      case "worktree_remove": {
        if (!req.worktreePath) {
          return { ok: false, action, error: "worktreePath required" };
        }
        await worktreeRemove(cwd, req.worktreePath);
        const worktrees = await listWorktrees(cwd);
        return { ok: true, action: "worktree_remove", worktrees };
      }

      case "pr_create": {
        const pr = await prCreate(cwd, req.message || "Spok changes", req.body);
        return { ok: pr.ok, action: "pr_create", pr, error: pr.error };
      }

      case "log": {
        const log = await recentLog(cwd);
        return { ok: true, action: "log", log };
      }

      default:
        return {
          ok: false,
          action,
          error: `Unknown git action: ${action}`,
          code: "unknown_action",
        };
    }
  } catch (e) {
    return {
      ok: false,
      action,
      error: e instanceof Error ? e.message : "git action failed",
      code: "git_error",
      risk: profile.risk,
    };
  }
}
