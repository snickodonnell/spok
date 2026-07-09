import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, openSync, readSync, closeSync, readFileSync, statSync } from "fs";
import path from "path";
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { requireTrustedCwd } from "@/lib/security/workspace-trust";
import {
  decideFilePreview,
  isDeniedSecretPath,
  normalizeRepoRelativePath,
  redactSecrets,
} from "@/lib/security/secrets";
import { getResolvedSettings } from "@/lib/settings/settings-fs";
import { evaluatePolicy } from "@/lib/security/permission-policy";
import { getActiveGrants } from "@/lib/security/approvals";
import { appendAuditEvent } from "@/lib/security/audit";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UNTRACKED_BYTES = 512 * 1024;
/** Read a small sample for binary detection without loading the whole file. */
const BINARY_SAMPLE_BYTES = 8192;

function readFileSample(abs: string, size: number): Buffer {
  const len = Math.min(size, BINARY_SAMPLE_BYTES);
  const buf = Buffer.alloc(len);
  const fd = openSync(abs, "r");
  try {
    readSync(fd, buf, 0, len, 0);
  } finally {
    closeSync(fd);
  }
  return buf;
}

/**
 * Return working-tree git status + diffs, including untracked file contents
 * so newly created files appear in Spok's live Diff panel.
 * Secret paths, binaries, and oversized files are denied or skipped.
 */
export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "git_diff");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const rawCwd = searchParams.get("cwd") || process.cwd();

  const trust = requireTrustedCwd(rawCwd);
  if (!trust.ok) {
    return policyDenialResponse(403, {
      error: trust.reason,
      code: "untrusted_cwd",
      policy: "workspace_trust",
      action: "git_diff",
      details: { cwd: trust.path },
    });
  }
  const cwd = trust.path;

  const settings = getResolvedSettings(cwd);
  const policy = evaluatePolicy({
    settings,
    action: "git",
    cwd,
    command: "git",
    args: ["status", "diff"],
    grants: getActiveGrants(),
  });
  if (policy.decision === "deny") {
    appendAuditEvent({
      type: "policy_denial",
      timestamp: Date.now(),
      action: "git",
      cwd,
      command: "git",
      policy: policy.policy,
      decision: "blocked",
      details: { reason: policy.reason },
    });
    return policyDenialResponse(403, {
      error: policy.reason,
      code: "command_not_allowed",
      policy: "command_profile",
      action: "git_diff",
      details: { policy: policy.policy },
    });
  }

  if (!existsSync(cwd)) {
    return Response.json({ error: "Directory not found" }, { status: 404 });
  }

  const gitDir = path.join(cwd, ".git");
  if (!existsSync(gitDir)) {
    return Response.json({
      error: "Not a git repository",
      diff: "",
      status: "",
      files: [],
      untracked: [],
      skipped: [],
      cwd,
      timestamp: Date.now(),
    });
  }

  try {
    // One combined working-tree-vs-HEAD diff (staged + unstaged together).
    // Do not concatenate --cached + unstaged: that duplicates hunks and splits
    // additions/removals across partial reconstructions of the same path.
    const [{ stdout: status }, { stdout: diff }] = await Promise.all([
      execFileAsync("git", ["status", "--porcelain", "-uall"], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      }),
      execFileAsync("git", ["diff", "HEAD"], {
        cwd,
        maxBuffer: 20 * 1024 * 1024,
      }).catch(async () =>
        execFileAsync("git", ["diff"], { cwd, maxBuffer: 20 * 1024 * 1024 })
      ),
    ]);

    const combinedDiff = redactSecrets(diff || "").text;

    const untracked: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    const files: Array<{
      path: string;
      status: string;
      oldContent?: string;
      newContent?: string;
      skipped?: boolean;
      reason?: string;
    }> = [];

    for (const line of status.split("\n")) {
      if (!line.trim()) continue;
      // porcelain: XY PATH or XY ORIG -> PATH
      const code = line.slice(0, 2);
      let filePath = line.slice(3).trim();
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop()!.trim();
      }
      // Unquoted paths; strip quotes if present
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = JSON.parse(filePath) as string;
      }

      const rel = normalizeRepoRelativePath(filePath);

      if (code === "??" || code[0] === "?" || code[1] === "?") {
        untracked.push(rel);
        const abs = path.join(cwd, filePath);
        try {
          if (existsSync(abs) && statSync(abs).isFile()) {
            const size = statSync(abs).size;
            let sample: Buffer | undefined;
            try {
              sample = readFileSample(abs, size);
            } catch {
              sample = undefined;
            }
            const decision = decideFilePreview({
              relativePath: rel,
              sizeBytes: size,
              maxBytes: MAX_UNTRACKED_BYTES,
              contentSample: sample,
            });

            if (decision.action === "deny" || decision.action === "skip") {
              skipped.push({ path: rel, reason: decision.reason });
              files.push({
                path: rel,
                status: "added",
                oldContent: "",
                newContent: `// ${decision.reason}\n`,
                skipped: true,
                reason: decision.reason,
              });
              continue;
            }

            const raw = readFileSync(abs, "utf8");
            const redacted = redactSecrets(raw);
            files.push({
              path: rel,
              status: "added",
              oldContent: "",
              newContent: redacted.text,
            });
          }
        } catch {
          /* skip unreadable */
        }
      } else if (code.includes("A") || code.includes("M") || code.includes("D")) {
        // Modified/added tracked — content already in unified diff; still list path
        const st =
          code.includes("D") ? "deleted" : code.includes("A") ? "added" : "modified";
        if (isDeniedSecretPath(rel)) {
          skipped.push({
            path: rel,
            reason: `Path matches secret deny list: ${rel}`,
          });
          continue;
        }
        // Avoid duplicate if also in untracked list
        if (!files.some((f) => f.path === rel)) {
          files.push({
            path: rel,
            status: st,
          });
        }
      }
    }

    return Response.json({
      status,
      diff: combinedDiff,
      untracked,
      files,
      skipped,
      cwd,
      timestamp: Date.now(),
    });
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : "git failed",
        diff: "",
        status: "",
        files: [],
        skipped: [],
      },
      { status: 500 }
    );
  }
}
