"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Layers,
  Loader2,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Upload,
  Trash2,
  FilePlus2,
  Minus,
  Eye,
  ClipboardCopy,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useSpokStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GitStatusPill } from "./git-status-pill";
import { CommitChecklist, useCommitReadiness } from "./commit-checklist";
import { cn } from "@/lib/utils";
import {
  fetchGitStatus,
  listWorktreesClient,
  runGitAndRefresh,
  syncDiffsFromGit,
} from "@/lib/git/client";
import { trustWorkspace } from "@/lib/local-api-client";
import { hunkToUnifiedPatch } from "@/lib/diff-utils";
import type { GitActionResponse, GitWorktreeInfo } from "@/lib/git/types";
import type { FileDiff } from "@/lib/types";
import { classifyFileRisk } from "@/lib/file-risk";
import { FileRiskBadge } from "@/components/diff/file-risk-badge";
import { buildReviewSummary } from "@/lib/review-summary";
import { buildReviewQueue } from "@/lib/review-queue";
import { buildHandoffFlow, type HandoffActionId } from "@/lib/handoff-flow";
import { advanceHandoffOutcome } from "@/lib/handoff-record";
import { CompletionPanel } from "./completion-panel";

type ConfirmState = {
  title: string;
  description: string;
  detail?: string;
  tone?: "amber" | "danger" | "cyan";
  confirmLabel?: string;
  run: () => Promise<void>;
} | null;

function areaBadge(file: FileDiff) {
  if (file.conflict) return { label: "conflict", variant: "error" as const };
  if (file.untracked) return { label: "untracked", variant: "cyan" as const };
  if (file.staged && file.unstaged)
    return { label: "partial", variant: "amber" as const };
  if (file.staged) return { label: "staged", variant: "success" as const };
  if (file.unstaged) return { label: "modified", variant: "amber" as const };
  return { label: file.status, variant: "muted" as const };
}

export function GitPanel() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const selectFile = useSpokStore((s) => s.selectFile);
  const createSession = useSpokStore((s) => s.createSession);
  const setActiveSession = useSpokStore((s) => s.setActiveSession);
  const addReviewComment = useSpokStore((s) => s.addReviewComment);
  const updateReviewComment = useSpokStore((s) => s.updateReviewComment);
  const removeReviewComment = useSpokStore((s) => s.removeReviewComment);
  const setReviewMode = useSpokStore((s) => s.setReviewMode);

  const [busy, setBusy] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [amend, setAmend] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktreeInfo[]>([]);
  const [showWorktrees, setShowWorktrees] = useState(false);
  const [wtPath, setWtPath] = useState("");
  const [wtBranch, setWtBranch] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [showPr, setShowPr] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [hunkIdx, setHunkIdx] = useState(0);
  const commitMessageRef = useRef<HTMLTextAreaElement>(null);
  const prFormRef = useRef<HTMLDivElement>(null);

  const cwd = session?.config.cwd;
  const summary = session?.gitSummary;
  const fileMap = session?.files;
  const files = useMemo(
    () => (fileMap ? Object.values(fileMap) : []),
    [fileMap]
  );
  const selectedFile = session?.selectedFileId
    ? session.files[session.selectedFileId]
    : null;

  const staged = files.filter((f) => f.staged);
  const worktreeChanges = files.filter((f) => f.unstaged || f.untracked);
  const readiness = useCommitReadiness();
  const reviewQueue = useMemo(
    () => (session ? buildReviewQueue(session) : null),
    [session]
  );
  const handoffFlow = useMemo(
    () => (session ? buildHandoffFlow(session) : null),
    [session]
  );

  const refreshMeta = useCallback(async () => {
    if (!session || !cwd) return;
    const [br, wt] = await Promise.all([
      runGitAndRefresh(session.id, cwd, "branch_list"),
      listWorktreesClient(cwd),
    ]);
    if (br.branches) setBranches(br.branches);
    setWorktrees(wt);
  }, [session, cwd]);

  const refresh = useCallback(async () => {
    if (!session || !cwd) return;
    setBusy("refresh");
    try {
      await syncDiffsFromGit(session.id, cwd);
      await refreshMeta();
    } catch {
      toast.error("Could not refresh git status");
    } finally {
      setBusy(null);
    }
  }, [session, cwd, refreshMeta]);

  useEffect(() => {
    if (session?.id && cwd) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on session/cwd change only
  }, [session?.id, cwd]);

  useEffect(() => {
    setHunkIdx(0);
  }, [selectedFile?.id]);

  // Drop selections for paths that no longer exist
  useEffect(() => {
    const live = new Set(files.map((f) => f.path));
    setSelectedPaths((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (live.has(p)) next.add(p);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [files]);

  const planMode = useSpokStore((s) => s.appPermissionMode) === "plan";

  const run = async (
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string; needsConfirm?: boolean }>,
    opts?: { silentSuccess?: boolean; refreshBranches?: boolean }
  ) => {
    if (!session || !cwd) return { ok: false as const };
    setBusy(label);
    try {
      const r = await fn();
      if (r.needsConfirm) {
        toast.message("Confirmation required — use the dialog");
      } else if (!r.ok) {
        toast.error(r.error || `${label} failed`);
      } else if (!opts?.silentSuccess) {
        toast.success(label);
      }
      // runGitAndRefresh already synced diffs; only refresh branch/worktree lists
      if (opts?.refreshBranches !== false) {
        try {
          await refreshMeta();
        } catch {
          /* non-fatal */
        }
      }
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`);
      return { ok: false as const };
    } finally {
      setBusy(null);
    }
  };

  const askConfirm = (state: ConfirmState) => setConfirm(state);

  const recordHandoffResult = (
    action: "commit" | "push" | "pr_create",
    result: GitActionResponse
  ) => {
    if (!session) return;
    const store = useSpokStore.getState();
    const latest = store.sessions[session.id];
    if (!latest) return;
    const jobId = store.automationJobs.find(
      (job) => job.sessionId === session.id
    )?.id;
    const handoffOutcome = advanceHandoffOutcome({
      session: latest,
      jobId,
      event: {
        action,
        ok: result.ok,
        auditId: result.auditId,
        error: result.error,
        commit: result.commit,
        push: result.push,
        pullRequest: result.pr,
      },
    });
    store.updateSession(session.id, { handoffOutcome });
    store.persistSessionNow(session.id);
  };

  const runConfirmed = async (state: NonNullable<ConfirmState>) => {
    setConfirm(null);
    setBusy(state.confirmLabel || "working");
    try {
      await state.run();
      try {
        await refreshMeta();
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const togglePath = (p: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const selectedList = [...selectedPaths];

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-phosphor-green/40">
        Open a workspace to use Git
      </div>
    );
  }

  if (!cwd) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-phosphor-green/45">
        <GitBranch className="h-8 w-8 opacity-40" />
        <p>This session has no working directory.</p>
        <p className="text-xs text-phosphor-green/30">
          Launch a live harness against a trusted repo to stage, commit, and manage worktrees.
        </p>
      </div>
    );
  }

  const onStage = (paths: string[]) =>
    run("Staged", () =>
      runGitAndRefresh(session.id, cwd, "stage", { paths })
    );

  const onUnstage = (paths: string[]) =>
    run("Unstaged", () =>
      runGitAndRefresh(session.id, cwd, "unstage", { paths })
    );

  const onDiscard = (paths: string[]) => {
    if (!paths.length) {
      toast.error("Select at least one path to discard");
      return;
    }
    askConfirm({
      title: "Discard changes?",
      description:
        "Permanently discards unstaged worktree changes (restored from HEAD) and untracked files/dirs for the selected paths. Staged index entries are left alone.",
      detail: paths.join("\n"),
      tone: "danger",
      confirmLabel: "Discard",
      run: async () => {
        const r = await runGitAndRefresh(session.id, cwd, "discard", {
          paths,
          confirm: true,
        });
        if (r.ok) {
          toast.success("Discarded");
          setSelectedPaths(new Set());
        } else toast.error(r.error || "Discard failed");
      },
    });
  };

  const onCommit = () => {
    if (!commitMsg.trim() && !amend) {
      toast.error("Enter a commit message");
      return;
    }
    if (!amend && staged.length === 0) {
      toast.error("Nothing staged — stage files before committing");
      return;
    }
    askConfirm({
      title: amend ? "Amend last commit?" : "Create commit?",
      description: amend
        ? "Amends the previous commit with the current index (and optional new message)."
        : `Creates a new commit from ${staged.length} staged file${staged.length === 1 ? "" : "s"}.`,
      detail: commitMsg.trim() || "(keep previous message)",
      tone: "cyan",
      confirmLabel: amend ? "Amend" : "Commit",
      run: async () => {
        const r = await runGitAndRefresh(session.id, cwd, "commit", {
          message: commitMsg,
          amend,
          confirm: true,
        });
        recordHandoffResult("commit", r);
        if (r.ok) {
          setCommitMsg("");
          setAmend(false);
          setSelectedPaths(new Set());
          toast.success(r.commit?.summary || "Committed");
        } else {
          toast.error(r.error || "Commit failed");
        }
      },
    });
  };

  const onPush = () => {
    askConfirm({
      title: "Push to remote?",
      description: `Pushes the current branch to origin${summary?.upstream ? ` (tracking ${summary.upstream})` : ""}. Network access required.`,
      detail: summary?.branch ? `branch: ${summary.branch}` : undefined,
      tone: "amber",
      confirmLabel: "Push",
      run: async () => {
        const r = await runGitAndRefresh(session.id, cwd, "push", {
          confirm: true,
          branch: summary?.branch ?? undefined,
        });
        recordHandoffResult("push", r);
        if (r.ok) toast.success("Pushed");
        else toast.error(r.error || "Push failed");
      },
    });
  };

  const onPull = () => {
    askConfirm({
      title: "Pull (ff-only)?",
      description:
        "Fetches and fast-forwards the current branch. Refuses non-ff merges to keep history safe.",
      tone: "amber",
      confirmLabel: "Pull",
      run: async () => {
        const r = await runGitAndRefresh(session.id, cwd, "pull", {
          confirm: true,
        });
        if (r.ok) toast.success("Pulled");
        else toast.error(r.error || "Pull failed");
      },
    });
  };

  const onCreateBranch = () => {
    if (!branchName.trim()) {
      toast.error("Branch name required");
      return;
    }
    void run("Branch created", () =>
      runGitAndRefresh(session.id, cwd, "branch_create", {
        branch: branchName.trim(),
        createBranch: true,
      })
    ).then((r) => {
      if (r && "ok" in r && r.ok) setBranchName("");
    });
  };

  const onCheckout = (name: string) => {
    askConfirm({
      title: `Checkout ${name}?`,
      description:
        "Switches HEAD to the selected branch. Uncommitted changes may block checkout.",
      tone: "amber",
      confirmLabel: "Checkout",
      run: async () => {
        const r = await runGitAndRefresh(session.id, cwd, "checkout", {
          branch: name,
          confirm: true,
        });
        if (r.ok) toast.success(`Checked out ${name}`);
        else toast.error(r.error || "Checkout failed");
      },
    });
  };

  const onCreateWorktree = () => {
    const base = summary?.repoRoot || cwd;
    const folder =
      wtPath.trim() ||
      // Default sibling directory (not inside the working tree)
      `${base.replace(/[\\/]+$/, "")}-wt-${Date.now().toString(36).slice(-4)}`;
    askConfirm({
      title: "Create isolated worktree?",
      description:
        "Spins up a linked git worktree on a new branch. Background agent work should run there so the main checkout stays untouched.",
      detail: `path: ${folder}\nbranch: ${wtBranch.trim() || "(auto)"}`,
      tone: "cyan",
      confirmLabel: "Create worktree",
      run: async () => {
        const r = await runGitAndRefresh(session.id, cwd, "worktree_add", {
          worktreePath: folder,
          branch: wtBranch.trim() || undefined,
          trustWorktree: true,
          confirm: true,
        });
        if (!r.ok) {
          toast.error(r.error || "Worktree create failed");
          return;
        }

        const absPath = r.createdWorktree?.path || folder;
        const branch = r.createdWorktree?.branch || wtBranch.trim() || "isolated";
        toast.success(r.stdout || `Worktree created on ${branch}`);
        setShowWorktrees(true);
        setWtPath("");
        setWtBranch("");

        try {
          await trustWorkspace(absPath);
        } catch {
          /* server may already trust from worktree_add */
        }

        const id = createSession({
          name: `Worktree · ${branch}`,
          source: "live",
          status: "ready",
          config: {
            cwd: absPath,
            command: "grok",
            args: [],
            autoScroll: true,
            playbackSpeed: 1,
            worktreePath: absPath,
            mainCheckout: summary?.repoRoot || cwd,
            isolationGuard: true,
          },
        });
        setActiveSession(id);
        toast.message("Handed off to worktree session (isolated)");
        await fetchGitStatus(absPath, { sessionId: id, syncDiffs: true });
      },
    });
  };

  const onRemoveWorktree = (wt: GitWorktreeInfo) => {
    if (wt.isMain) {
      toast.error("Cannot remove the main worktree");
      return;
    }
    askConfirm({
      title: "Remove worktree?",
      description:
        "Removes the linked worktree directory from disk. Uncommitted work in that tree will be lost.",
      detail: wt.path,
      tone: "danger",
      confirmLabel: "Remove",
      run: async () => {
        const r = await runGitAndRefresh(session.id, cwd, "worktree_remove", {
          worktreePath: wt.path,
          confirm: true,
        });
        if (r.ok) toast.success("Worktree removed");
        else toast.error(r.error || "Remove failed");
      },
    });
  };

  const onHandoffWorktree = (wt: GitWorktreeInfo) => {
    void (async () => {
      try {
        await trustWorkspace(wt.path);
      } catch {
        toast.error("Could not trust worktree path");
        return;
      }
      const id = createSession({
        name: `Worktree · ${wt.branch || "detached"}`,
        source: "live",
        status: "ready",
        config: {
          cwd: wt.path,
          command: "grok",
          args: [],
          autoScroll: true,
          playbackSpeed: 1,
          worktreePath: wt.path,
          mainCheckout: summary?.mainWorktreePath || summary?.repoRoot || cwd,
          isolationGuard: !wt.isMain,
        },
      });
      setActiveSession(id);
      toast.success("Switched to worktree session");
      await fetchGitStatus(wt.path, { sessionId: id, syncDiffs: true });
    })();
  };

  const onPr = () => {
    askConfirm({
      title: "Create pull request?",
      description:
        "Uses the GitHub CLI (gh) to open a PR for the current branch. Requires gh auth.",
      detail: prTitle.trim() || "(default title)",
      tone: "cyan",
      confirmLabel: "Create PR",
      run: async () => {
        const r = await runGitAndRefresh(session.id, cwd, "pr_create", {
          message: prTitle.trim() || `Spok: ${summary?.branch ?? "changes"}`,
          body: prBody.trim() || undefined,
          confirm: true,
        });
        recordHandoffResult("pr_create", r);
        if (r.ok) {
          if (r.pr?.url) {
            try {
              await navigator.clipboard.writeText(r.pr.url);
              toast.success("PR created — URL copied");
            } catch {
              toast.success(`PR created: ${r.pr.url}`);
            }
          } else {
            toast.success("PR created");
          }
          setShowPr(false);
        } else if (r.pr?.unavailable) {
          toast.error(r.error || "gh CLI unavailable");
        } else {
          toast.error(r.error || "PR create failed");
        }
      },
    });
  };

  const stageHunk = () => {
    if (!selectedFile) return;
    const patch = hunkToUnifiedPatch(selectedFile, hunkIdx);
    if (!patch) return;
    void run("Hunk staged", () =>
      runGitAndRefresh(session.id, cwd, "stage_hunk", { patch })
    );
  };

  const unstageHunk = () => {
    if (!selectedFile) return;
    const patch = hunkToUnifiedPatch(selectedFile, hunkIdx);
    if (!patch) return;
    void run("Hunk unstaged", () =>
      runGitAndRefresh(session.id, cwd, "unstage_hunk", { patch })
    );
  };

  const discardHunk = () => {
    if (!selectedFile) return;
    const patch = hunkToUnifiedPatch(selectedFile, hunkIdx);
    if (!patch) return;
    askConfirm({
      title: "Discard this hunk?",
      description: "Reverses the selected hunk in the working tree. This cannot be undone from Spok.",
      detail: selectedFile.path + " · hunk " + (hunkIdx + 1),
      tone: "danger",
      confirmLabel: "Discard hunk",
      run: async () => {
        await run("Hunk discarded", () =>
          runGitAndRefresh(session.id, cwd, "discard_hunk", {
            patch,
            confirm: true,
          })
        );
      },
    });
  };

  const addComment = () => {
    if (!selectedFile || !commentDraft.trim()) return;
    addReviewComment(session.id, {
      path: selectedFile.path,
      body: commentDraft.trim(),
      author: "user",
      traceNodeId: session.selectedTraceId ?? undefined,
      hunkId: selectedFile.hunks[hunkIdx]?.id,
    });
    setCommentDraft("");
    toast.success("Review comment added");
  };

  const copyReviewSummary = async () => {
    const reviewSummary = buildReviewSummary(session);
    await navigator.clipboard.writeText(reviewSummary.clipboard);
    toast.success("Review summary copied");
  };

  const openPrDraft = () => {
    const reviewSummary = buildReviewSummary(session);
    setPrTitle((current) => current || reviewSummary.title);
    setPrBody((current) => current || reviewSummary.bodyMarkdown);
    setShowPr(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        prFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  };

  const onHandoffAction = (action: HandoffActionId) => {
    switch (action) {
      case "review": {
        const issue = reviewQueue?.issues[0];
        if (issue?.fileId) selectFile(issue.fileId);
        setReviewMode(session.id, true);
        toast.message(
          issue ? `${issue.title} · ${issue.detail}` : "Review findings highlighted"
        );
        break;
      }
      case "stage":
        void onStage([]);
        break;
      case "commit":
        commitMessageRef.current?.focus();
        commitMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        break;
      case "pull":
        onPull();
        break;
      case "push":
        onPush();
        break;
      case "create_pr":
        openPrDraft();
        break;
      case "wait":
      case "none":
        break;
    }
  };

  const FileRow = ({ file, zone }: { file: FileDiff; zone: "staged" | "work" }) => {
    const badge = areaBadge(file);
    const risk = classifyFileRisk(file.path, file);
    const selected = selectedPaths.has(file.path);
    const isActive = session.selectedFileId === file.id;
    return (
      <div
        className={cn(
          "group flex items-center gap-1 border-b border-phosphor-green/5 px-2 py-1 text-xs",
          isActive && "bg-phosphor-green/10",
          selected && "bg-phosphor-cyan/5"
        )}
      >
        <input
          type="checkbox"
          className="accent-phosphor-green"
          checked={selected}
          onChange={() => togglePath(file.path)}
          aria-label={`Select ${file.path}`}
        />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-mono text-phosphor-green/80 hover:text-phosphor-green"
          onClick={() => selectFile(file.id)}
          title={file.path}
        >
          {file.path}
        </button>
        <Badge variant={badge.variant} className="text-[9px] px-1 py-0">
          {badge.label}
        </Badge>
        <FileRiskBadge risk={risk} compact />
        {file.isBinary && (
          <span className="text-[9px] text-phosphor-amber">bin</span>
        )}
        {file.isSecret && (
          <span className="text-[9px] text-red-400">secret</span>
        )}
        <span className="font-mono text-[10px] text-phosphor-green/40">
          <span className="text-phosphor-green">+{file.additions}</span>{" "}
          <span className="text-phosphor-red">-{file.deletions}</span>
        </span>
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {zone === "work" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Stage file"
              disabled={planMode || !!busy}
              onClick={() => void onStage([file.path])}
            >
              <Plus className="h-3 w-3" />
            </Button>
          )}
          {zone === "staged" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Unstage file"
              disabled={planMode || !!busy}
              onClick={() => void onUnstage([file.path])}
            >
              <Minus className="h-3 w-3" />
            </Button>
          )}
          {zone === "work" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-red-400/80"
              title="Discard file"
              disabled={planMode || !!busy}
              onClick={() => onDiscard([file.path])}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-phosphor-green/15 px-3 py-2">
        <h2 className="panel-title text-phosphor-green">
          Review
        </h2>
        <GitStatusPill summary={summary} cwd={cwd} />
        {reviewQueue && reviewQueue.summary.total > 0 && (
          <Badge
            variant={
              reviewQueue.summary.needsAttention ? "amber" : "muted"
            }
            className="text-[9px]"
            title={reviewQueue.summary.headline}
          >
            {reviewQueue.summary.headline}
          </Badge>
        )}
        {reviewQueue && reviewQueue.issues.length > 0 && (
          <Badge variant="error" className="text-[9px]">
            {reviewQueue.issues.length} issue
            {reviewQueue.issues.length === 1 ? "" : "s"}
          </Badge>
        )}
        {session.config.isolationGuard && (
          <Badge variant="magenta" className="text-[9px]">
            isolated
          </Badge>
        )}
        {planMode && (
          <Badge variant="amber" className="text-[9px]">
            plan · read-only
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Copy review summary for PR"
            onClick={() => void copyReviewSummary()}
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Refresh"
            disabled={!!busy}
            onClick={() => void refresh()}
          >
            {busy === "refresh" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant={session.reviewMode ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1 text-[10px]"
            onClick={() => setReviewMode(session.id, !session.reviewMode)}
            title="Toggle review mode"
          >
            <Eye className="h-3 w-3" />
            Review
          </Button>
        </div>
      </div>

      {handoffFlow && (
        <CompletionPanel
          flow={handoffFlow}
          busy={!!busy}
          planMode={planMode}
          onAction={onHandoffAction}
          onCopySummary={() => void copyReviewSummary()}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {/* Left: staging lists */}
        <div className="flex w-[min(100%,22rem)] shrink-0 flex-col border-r border-phosphor-green/15">
          {/* Bulk actions */}
          <div className="flex flex-wrap gap-1 border-b border-phosphor-green/10 p-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              disabled={planMode || !!busy}
              onClick={() => void onStage([])}
              title="Stage all changes"
            >
              <FilePlus2 className="h-3 w-3" />
              Stage all
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              disabled={planMode || !!busy || selectedList.length === 0}
              onClick={() => void onStage(selectedList)}
            >
              Stage sel.
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              disabled={planMode || !!busy || selectedList.length === 0}
              onClick={() => void onUnstage(selectedList)}
            >
              Unstage
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-[10px]"
              disabled={planMode || !!busy || selectedList.length === 0}
              onClick={() => onDiscard(selectedList)}
            >
              Discard
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <Section
              title="Staged"
              count={staged.length}
              accent="text-phosphor-green"
            >
              {staged.length === 0 ? (
                <Empty>Nothing staged</Empty>
              ) : (
                staged.map((f) => (
                  <FileRow key={f.id + "-s"} file={f} zone="staged" />
                ))
              )}
            </Section>
            <Section
              title="Changes"
              count={worktreeChanges.length}
              accent="text-phosphor-amber"
            >
              {worktreeChanges.length === 0 ? (
                <Empty>Working tree clean</Empty>
              ) : (
                worktreeChanges.map((f) => (
                  <FileRow key={f.id + "-w"} file={f} zone="work" />
                ))
              )}
            </Section>
          </div>

          {/* Commit + readiness */}
          <div className="space-y-2 border-t border-phosphor-green/15 p-2">
            <CommitChecklist />
            <div className="flex items-center gap-2 text-[10px] font-medium text-phosphor-green/50">
              <GitCommitHorizontal className="h-3 w-3" />
              Commit
            </div>
            <textarea
              ref={commitMessageRef}
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder={
                planMode
                  ? "Plan mode — commits disabled"
                  : "Commit message (Ctrl+Enter to commit)"
              }
              disabled={planMode}
              rows={3}
              className="w-full resize-none rounded-md border border-phosphor-green/25 bg-black/50 px-2 py-1.5 font-mono text-xs text-phosphor-green placeholder:text-phosphor-green/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-phosphor-green/50"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onCommit();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] text-phosphor-green/55">
                <input
                  type="checkbox"
                  checked={amend}
                  disabled={planMode}
                  onChange={(e) => setAmend(e.target.checked)}
                  className="accent-phosphor-amber"
                />
                Amend
              </label>
              <Button
                size="sm"
                className="ml-auto h-7 text-[10px]"
                disabled={
                  planMode ||
                  !!busy ||
                  (!!readiness && !readiness.readyToCommit && !amend)
                }
                title={
                  readiness && !readiness.readyToCommit
                    ? readiness.summary
                    : undefined
                }
                onClick={onCommit}
              >
                <Check className="h-3 w-3" />
                {amend ? "Amend" : "Commit"}
              </Button>
            </div>
          </div>
        </div>

        {/* Right: branch / worktree / review / hunk */}
        <div className="flex min-w-0 flex-1 flex-col overflow-auto">
          {/* Branch bar */}
          <div className="space-y-2 border-b border-phosphor-green/10 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <GitBranch className="h-3.5 w-3.5 text-phosphor-cyan" />
              <span className="font-mono text-xs text-phosphor-cyan">
                {summary?.branch ?? "—"}
              </span>
              {summary?.upstream && (
                <span className="font-mono text-[10px] text-phosphor-green/40">
                  ↔ {summary.upstream}
                </span>
              )}
              <div className="ml-auto flex flex-wrap gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px]"
                  disabled={planMode || !!busy}
                  onClick={onPull}
                >
                  <RotateCcw className="h-3 w-3" />
                  Pull
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px]"
                  disabled={planMode || !!busy}
                  onClick={onPush}
                >
                  <Upload className="h-3 w-3" />
                  Push
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-[10px]"
                  disabled={planMode || !!busy}
                  onClick={() => setShowPr((v) => !v)}
                >
                  <GitPullRequest className="h-3 w-3" />
                  PR
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Input
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="new-branch-name"
                className="h-7 max-w-xs text-xs"
                disabled={planMode}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px]"
                disabled={planMode || !!busy}
                onClick={onCreateBranch}
              >
                Create & checkout
              </Button>
            </div>

            {branches.length > 0 && (
              <div className="flex flex-wrap gap-1 max-h-20 overflow-auto">
                {branches.slice(0, 24).map((b) => (
                  <button
                    key={b}
                    type="button"
                    disabled={planMode || !!busy || b === summary?.branch}
                    onClick={() => onCheckout(b)}
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                      b === summary?.branch
                        ? "border-phosphor-cyan/40 bg-phosphor-cyan/15 text-phosphor-cyan"
                        : "border-phosphor-green/15 text-phosphor-green/60 hover:border-phosphor-green/35 hover:text-phosphor-green"
                    )}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}

            {showPr && (
              <div
                ref={prFormRef}
                className="space-y-2 rounded-md border border-phosphor-cyan/25 bg-phosphor-cyan/5 p-2"
              >
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 text-[10px]"
                    title="Fill title and body from the risk-ordered review summary"
                    onClick={() => {
                      const summary = buildReviewSummary(session);
                      setPrTitle(summary.title);
                      setPrBody(summary.bodyMarkdown);
                      toast.success("PR draft filled from review summary");
                    }}
                  >
                    <Sparkles className="h-3 w-3" />
                    Fill from review
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-[10px]"
                    title="Copy full review summary to clipboard"
                    onClick={async () => {
                      const summary = buildReviewSummary(session);
                      await navigator.clipboard.writeText(summary.clipboard);
                      toast.success("Review summary copied");
                    }}
                  >
                    <ClipboardCopy className="h-3 w-3" />
                    Copy summary
                  </Button>
                </div>
                <Input
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  placeholder="PR title"
                  className="h-7 text-xs"
                />
                <textarea
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  placeholder="PR body (optional)"
                  rows={5}
                  className="w-full resize-none rounded-md border border-phosphor-green/20 bg-black/40 px-2 py-1 font-mono text-xs text-phosphor-green"
                />
                <Button size="sm" className="h-7 text-[10px]" onClick={onPr}>
                  Create pull request
                </Button>
              </div>
            )}
          </div>

          {/* Worktrees */}
          <div className="border-b border-phosphor-green/10 p-3">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left text-[10px] uppercase tracking-widest text-phosphor-green/45"
              onClick={() => setShowWorktrees((v) => !v)}
            >
              <Layers className="h-3 w-3" />
              Worktrees
              <ChevronDown
                className={cn(
                  "ml-auto h-3 w-3 transition-transform",
                  showWorktrees && "rotate-180"
                )}
              />
            </button>
            {showWorktrees && (
              <div className="mt-2 space-y-2">
                {worktrees.map((wt) => (
                  <div
                    key={wt.path}
                    className="flex items-start gap-2 rounded border border-phosphor-green/10 bg-black/30 px-2 py-1.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-phosphor-green/80 truncate">
                          {wt.branch || (wt.detached ? "detached" : "—")}
                        </span>
                        {wt.isMain && (
                          <Badge variant="muted" className="text-[9px]">
                            main
                          </Badge>
                        )}
                        {wt.managedBySpok && (
                          <Badge variant="magenta" className="text-[9px]">
                            spok
                          </Badge>
                        )}
                      </div>
                      <div className="truncate font-mono text-[10px] text-phosphor-green/35">
                        {wt.path}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px]"
                      onClick={() => onHandoffWorktree(wt)}
                    >
                      Open
                    </Button>
                    {!wt.isMain && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-red-400/70"
                        disabled={planMode}
                        onClick={() => onRemoveWorktree(wt)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Input
                    value={wtBranch}
                    onChange={(e) => setWtBranch(e.target.value)}
                    placeholder="branch (optional)"
                    className="h-7 max-w-[10rem] text-xs"
                    disabled={planMode}
                  />
                  <Input
                    value={wtPath}
                    onChange={(e) => setWtPath(e.target.value)}
                    placeholder="path (optional sibling)"
                    className="h-7 min-w-[12rem] flex-1 text-xs"
                    disabled={planMode}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[10px]"
                    disabled={planMode || !!busy}
                    onClick={onCreateWorktree}
                  >
                    <Plus className="h-3 w-3" />
                    New worktree
                  </Button>
                </div>
                <p className="text-[10px] leading-relaxed text-phosphor-green/35">
                  Isolated worktree sessions set an isolation guard so agent runs
                  cannot mutate your main checkout.
                </p>
              </div>
            )}
          </div>

          {/* Selected file hunk actions + review */}
          <div className="flex-1 p-3 space-y-3">
            {selectedFile ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-mono text-xs text-phosphor-green/80">
                    {selectedFile.path}
                  </span>
                  <Badge variant={areaBadge(selectedFile).variant}>
                    {areaBadge(selectedFile).label}
                  </Badge>
                  {selectedFile.hunks.length > 0 && (
                    <span className="font-mono text-[10px] text-phosphor-green/45">
                      Hunk {Math.min(hunkIdx + 1, selectedFile.hunks.length)}/
                      {selectedFile.hunks.length}
                    </span>
                  )}
                </div>

                {selectedFile.hunks.length > 0 && !planMode && (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px]"
                      disabled={hunkIdx <= 0}
                      onClick={() => setHunkIdx((i) => Math.max(0, i - 1))}
                    >
                      Prev hunk
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px]"
                      disabled={hunkIdx >= selectedFile.hunks.length - 1}
                      onClick={() =>
                        setHunkIdx((i) =>
                          Math.min(selectedFile.hunks.length - 1, i + 1)
                        )
                      }
                    >
                      Next hunk
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px]"
                      disabled={!!busy}
                      onClick={stageHunk}
                    >
                      Stage hunk
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px]"
                      disabled={!!busy}
                      onClick={unstageHunk}
                    >
                      Unstage hunk
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-[10px]"
                      disabled={!!busy}
                      onClick={discardHunk}
                    >
                      Discard hunk
                    </Button>
                  </div>
                )}

                {selectedFile.hunks[hunkIdx] && (
                  <pre className="max-h-48 overflow-auto rounded border border-phosphor-green/15 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-phosphor-green/70">
                    {selectedFile.hunks[hunkIdx].header}
                    {"\n"}
                    {selectedFile.hunks[hunkIdx].lines
                      .map((l) => {
                        const p =
                          l.type === "add"
                            ? "+"
                            : l.type === "remove"
                              ? "-"
                              : " ";
                        return p + l.content;
                      })
                      .join("\n")}
                  </pre>
                )}

                {(session.reviewMode ||
                  (session.reviewComments?.length ?? 0) > 0) && (
                  <div className="space-y-2 rounded-md border border-phosphor-magenta/25 bg-phosphor-magenta/5 p-2">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-phosphor-magenta/80">
                      <MessageSquarePlus className="h-3 w-3" />
                      Review comments
                      {session.selectedTraceId && (
                        <span className="normal-case tracking-normal text-phosphor-green/40">
                          · linked to selected trace
                        </span>
                      )}
                    </div>
                    <textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="Note why this change matters, risks, follow-ups…"
                      rows={2}
                      className="w-full resize-none rounded border border-phosphor-green/20 bg-black/40 px-2 py-1 font-mono text-xs text-phosphor-green"
                    />
                    <Button
                      size="sm"
                      variant="magenta"
                      className="h-7 text-[10px]"
                      onClick={addComment}
                    >
                      Add comment
                    </Button>
                    <div className="space-y-1.5 max-h-40 overflow-auto">
                      {(session.reviewComments ?? [])
                        .filter((c) => c.path === selectedFile.path)
                        .map((c) => (
                          <div
                            key={c.id}
                            className={cn(
                              "rounded border border-phosphor-green/10 bg-black/30 px-2 py-1.5 text-xs",
                              c.resolved && "opacity-50"
                            )}
                          >
                            <div className="flex items-center gap-2 text-[10px] text-phosphor-green/40">
                              <span>{c.author}</span>
                              {c.traceNodeId && (
                                <button
                                  type="button"
                                  className="text-phosphor-cyan hover:underline"
                                  onClick={() =>
                                    useSpokStore
                                      .getState()
                                      .selectTrace(c.traceNodeId!)
                                  }
                                >
                                  trace
                                </button>
                              )}
                              <button
                                type="button"
                                className="ml-auto hover:text-phosphor-green"
                                onClick={() =>
                                  updateReviewComment(session.id, c.id, {
                                    resolved: !c.resolved,
                                  })
                                }
                              >
                                {c.resolved ? "reopen" : "resolve"}
                              </button>
                              <button
                                type="button"
                                className="text-red-400/70 hover:text-red-400"
                                onClick={() =>
                                  removeReviewComment(session.id, c.id)
                                }
                              >
                                delete
                              </button>
                            </div>
                            <p className="mt-0.5 text-phosphor-green/75 whitespace-pre-wrap">
                              {c.body}
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-phosphor-green/35">
                <p>Select a changed file to stage hunks or leave review notes.</p>
                <p className="max-w-sm text-[10px] text-phosphor-green/25">
                  Tip: use the Diff tab for full Monaco view; use this Git tab for
                  stage, commit, branch, worktree, and PR flows without leaving Spok.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        detail={confirm?.detail}
        tone={confirm?.tone}
        confirmLabel={confirm?.confirmLabel}
        busy={!!busy}
        onCancel={() => {
          if (!busy) setConfirm(null);
        }}
        onConfirm={() => {
          if (confirm && !busy) void runConfirmed(confirm);
        }}
      />
    </div>
  );
}

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          "sticky top-0 z-[1] flex items-center justify-between border-b border-phosphor-green/10 bg-crt-panel/95 px-2 py-1 text-[10px] uppercase tracking-widest backdrop-blur",
          accent
        )}
      >
        <span>{title}</span>
        <span className="font-mono opacity-70">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-3 text-center text-[11px] text-phosphor-green/30">
      {children}
    </div>
  );
}
