"use client";

import { useSpokStore } from "@/lib/store";
import { FileTree } from "./file-tree";
import { ReviewQueuePanel } from "./review-queue-panel";
import { FileRiskBadge } from "./file-risk-badge";
import { DiffStatChip, MonacoDiff, type DiffLayout } from "./monaco-diff";
import { HunkNav } from "./hunk-nav";
import { CausalRail, CausalMiniRail } from "./causal-rail";
import { ReviewIssueRail } from "./review-issue-rail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Download,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Minus,
  Trash2,
  Link2,
  ListTree,
  FolderTree,
  FileText,
  ClipboardCopy,
} from "lucide-react";
import { unifiedDiffText } from "@/lib/diff-utils";
import { classifyFileRisk } from "@/lib/file-risk";
import {
  buildReviewQueue,
  nextReviewFileId,
  reviewQueueIndex,
} from "@/lib/review-queue";
import { buildReviewSummary } from "@/lib/review-summary";
import {
  locateReviewIssuesForFile,
  type LocatedReviewIssue,
} from "@/lib/review-issue-location";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { refreshGitDiff } from "@/lib/harness";
import { runGitAndRefresh } from "@/lib/git/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CommitChecklist } from "@/components/git/commit-checklist";
import { cn } from "@/lib/utils";

const LAYOUT_KEY = "spok.diffLayout";
const SIDEBAR_MODE_KEY = "spok.changesSidebar";

type SidebarMode = "queue" | "tree";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (target.isContentEditable) return true;
  if (target.getAttribute("role") === "textbox") return true;
  return false;
}

export function DiffPanel() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);
  const causalOpen = useSpokStore((s) => s.causalDrawerOpen);
  const setCausalOpen = useSpokStore((s) => s.setCausalDrawerOpen);
  const setWorkspaceRightTab = useSpokStore((s) => s.setWorkspaceRightTab);
  const selectFile = useSpokStore((s) => s.selectFile);
  const selectTrace = useSpokStore((s) => s.selectTrace);
  const setLeftTraceMode = useSpokStore((s) => s.setLeftTraceMode);
  const workspaceRightTab = useSpokStore((s) => s.workspaceRightTab);

  const file = session?.selectedFileId
    ? session.files[session.selectedFileId]
    : null;
  const [copied, setCopied] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [layout, setLayout] = useState<DiffLayout>("unified");
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("queue");
  const [hunkIdx, setHunkIdx] = useState(0);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved === "unified" || saved === "split") setLayout(saved);
      const side = localStorage.getItem(SIDEBAR_MODE_KEY);
      if (side === "queue" || side === "tree") setSidebarMode(side);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setHunkIdx(0);
    setActiveIssueId(null);
  }, [file?.id]);

  const onLayoutChange = (next: DiffLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const onSidebarMode = (mode: SidebarMode) => {
    setSidebarMode(mode);
    try {
      localStorage.setItem(SIDEBAR_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  const planMode = appPermissionMode === "plan";
  const canMutate = !!session?.config.cwd && !planMode;

  const queue = useMemo(
    () => (session ? buildReviewQueue(session) : null),
    [session]
  );

  const fileRisk = useMemo(
    () => (file ? classifyFileRisk(file.path, file) : null),
    [file]
  );

  const queuePos = queue ? reviewQueueIndex(queue, file?.id) : -1;

  const locatedIssues = useMemo(
    () =>
      session && file && queue
        ? locateReviewIssuesForFile(session, file, queue.issues)
        : [],
    [session, file, queue]
  );

  const openIssue = useCallback(
    (located: LocatedReviewIssue) => {
      setActiveIssueId(located.issue.id);
      setHunkIdx(located.hunkIndex);
      if (located.issue.fileId && located.issue.fileId !== file?.id) {
        selectFile(located.issue.fileId);
      }
      if (located.issue.traceNodeId) {
        selectTrace(located.issue.traceNodeId);
        setLeftTraceMode("events");
      }
    },
    [file?.id, selectFile, selectTrace, setLeftTraceMode]
  );

  const copyDiff = async () => {
    if (!file) return;
    await navigator.clipboard.writeText(unifiedDiffText(file));
    setCopied(true);
    toast.success("Diff copied to clipboard");
    setTimeout(() => setCopied(false), 1500);
  };

  const copySummary = async () => {
    if (!session) return;
    const summary = buildReviewSummary(session);
    await navigator.clipboard.writeText(summary.clipboard);
    setSummaryCopied(true);
    toast.success("Review summary copied", {
      description: summary.title,
    });
    setTimeout(() => setSummaryCopied(false), 1500);
  };

  const downloadDiff = () => {
    if (!file) return;
    const blob = new Blob([unifiedDiffText(file)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.path.replace(/[/\\]/g, "_")}.diff`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onRefresh = async () => {
    if (!session?.config.cwd) return;
    setRefreshing(true);
    try {
      await refreshGitDiff(session.id, session.config.cwd);
      toast.success("Diff refreshed from git");
    } catch {
      toast.error("Could not refresh git diff");
    } finally {
      setRefreshing(false);
    }
  };

  const stageFile = async () => {
    if (!session?.config.cwd || !file) return;
    setBusy(true);
    try {
      const r = await runGitAndRefresh(session.id, session.config.cwd, "stage", {
        paths: [file.path],
      });
      if (r.ok) toast.success(`Staged ${file.path}`);
      else toast.error(r.error || "Stage failed");
    } finally {
      setBusy(false);
    }
  };

  const unstageFile = async () => {
    if (!session?.config.cwd || !file) return;
    setBusy(true);
    try {
      const r = await runGitAndRefresh(
        session.id,
        session.config.cwd,
        "unstage",
        { paths: [file.path] }
      );
      if (r.ok) toast.success(`Unstaged ${file.path}`);
      else toast.error(r.error || "Unstage failed");
    } finally {
      setBusy(false);
    }
  };

  const discardFile = async () => {
    if (!session?.config.cwd || !file) return;
    setBusy(true);
    try {
      const r = await runGitAndRefresh(
        session.id,
        session.config.cwd,
        "discard",
        { paths: [file.path], confirm: true }
      );
      if (r.ok) toast.success(`Discarded ${file.path}`);
      else toast.error(r.error || "Discard failed");
    } finally {
      setBusy(false);
      setConfirmDiscard(false);
    }
  };

  const goFile = useCallback(
    (delta: 1 | -1) => {
      if (!queue) return;
      const next = nextReviewFileId(queue, file?.id ?? null, delta);
      if (next) selectFile(next);
    },
    [queue, file?.id, selectFile]
  );

  const goHunk = useCallback(
    (delta: 1 | -1) => {
      if (!file || file.hunks.length === 0) return;
      setActiveIssueId(null);
      setHunkIdx((i) => {
        const next = Math.max(0, Math.min(file.hunks.length - 1, i + delta));
        return next;
      });
    },
    [file]
  );

  // Keyboard review flow (active when Changes tab is visible)
  useEffect(() => {
    if (workspaceRightTab !== "changes") return;

    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === "j" || key === "]") {
        e.preventDefault();
        goFile(1);
        return;
      }
      if (key === "k" || key === "[") {
        e.preventDefault();
        goFile(-1);
        return;
      }
      if (key === "n") {
        e.preventDefault();
        goHunk(1);
        return;
      }
      if (key === "p") {
        e.preventDefault();
        goHunk(-1);
        return;
      }
      if (key === "w") {
        e.preventDefault();
        setCausalOpen(!useSpokStore.getState().causalDrawerOpen);
        return;
      }
      if (key === "u") {
        e.preventDefault();
        onLayoutChange(layout === "unified" ? "split" : "unified");
        return;
      }
      if (key === "s" && canMutate && file && (file.unstaged || file.untracked)) {
        e.preventDefault();
        void stageFile();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // stageFile closes over session/file — intentional for current selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspaceRightTab,
    goFile,
    goHunk,
    setCausalOpen,
    layout,
    canMutate,
    file,
  ]);

  const fileCount = session ? Object.keys(session.files).length : 0;
  const relatedCount = file?.relatedTraceIds.length ?? 0;

  return (
    <div className="flex h-full flex-col" data-testid="changes-panel">
      <div className="flex items-center justify-between gap-2 border-b border-phosphor-green/15 px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-medium tracking-wide text-phosphor-green/90">
            Changes
          </h2>
          <span className="font-mono text-[10px] text-phosphor-green/40">
            {fileCount} file{fileCount === 1 ? "" : "s"}
          </span>
          {queue && queuePos >= 0 && (
            <span
              className="rounded border border-phosphor-green/20 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-phosphor-cyan/80"
              title="Position in risk-ordered review queue"
            >
              {queuePos + 1}/{queue.flat.length}
            </span>
          )}
          {session?.config.cwd && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => void onRefresh()}
              title="Refresh from git working tree"
              disabled={refreshing}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
            </Button>
          )}
        </div>
        {file && (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Badge
              variant={
                file.status === "added"
                  ? "success"
                  : file.status === "deleted"
                    ? "error"
                    : file.status === "modified"
                      ? "amber"
                      : "cyan"
              }
            >
              {file.status}
            </Badge>
            {fileRisk && <FileRiskBadge risk={fileRisk} />}
            {file.staged && (
              <Badge variant="success" className="text-[9px]">
                staged
              </Badge>
            )}
            {file.untracked && (
              <Badge variant="cyan" className="text-[9px]">
                untracked
              </Badge>
            )}
            {file.isBinary && (
              <Badge variant="amber" className="text-[9px]">
                binary
              </Badge>
            )}
            {file.isSecret && (
              <Badge variant="error" className="text-[9px]">
                secret
              </Badge>
            )}
            <span className="max-w-[200px] truncate font-mono text-[11px] text-phosphor-green/70">
              {file.path}
            </span>
            <DiffStatChip
              additions={file.additions}
              deletions={file.deletions}
            />
            <HunkNav
              file={file}
              index={hunkIdx}
              onJump={(index) => {
                setActiveIssueId(null);
                setHunkIdx(index);
              }}
            />
            <Button
              variant={causalOpen ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1 text-[10px]"
              title="Why did this change? (w)"
              onClick={() => setCausalOpen(!causalOpen)}
            >
              <Link2 className="h-3 w-3" />
              Why
              {relatedCount > 0 && (
                <span className="font-mono text-phosphor-cyan">
                  {relatedCount}
                </span>
              )}
            </Button>
            {canMutate && (
              <>
                {(file.unstaged || file.untracked) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Stage file (s)"
                    disabled={busy}
                    onClick={() => void stageFile()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                )}
                {file.staged && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Unstage file"
                    disabled={busy}
                    onClick={() => void unstageFile()}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                )}
                {(file.unstaged || file.untracked) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-400/80"
                    title="Discard file changes"
                    disabled={busy}
                    onClick={() => setConfirmDiscard(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={copyDiff}
              title="Copy unified diff"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-phosphor-green" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={downloadDiff}
              title="Download .diff"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <CausalMiniRail hunkIndex={hunkIdx} />

      <div className="flex items-center gap-2 border-b border-phosphor-green/10 px-2 py-1">
        <CommitChecklist compact className="min-w-0 flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 text-[10px]"
          onClick={() => void copySummary()}
          title="Copy PR review summary"
        >
          {summaryCopied ? (
            <Check className="h-3 w-3 text-phosphor-green" />
          ) : (
            <ClipboardCopy className="h-3 w-3" />
          )}
          Summary
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 text-[10px]"
          onClick={() => setWorkspaceRightTab("review")}
        >
          Open Review
        </Button>
      </div>

      {/* File queue/tree + diff + optional causal rail */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col border-r border-phosphor-green/15">
          <div
            className="flex shrink-0 items-center gap-0.5 border-b border-phosphor-green/10 p-1"
            role="tablist"
            aria-label="Changes sidebar mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={sidebarMode === "queue"}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-[10px] transition",
                sidebarMode === "queue"
                  ? "bg-phosphor-green/12 text-phosphor-green"
                  : "text-phosphor-green/45 hover:bg-phosphor-green/5 hover:text-phosphor-green/75"
              )}
              onClick={() => onSidebarMode("queue")}
            >
              <ListTree className="h-3 w-3" />
              Queue
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarMode === "tree"}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-[10px] transition",
                sidebarMode === "tree"
                  ? "bg-phosphor-green/12 text-phosphor-green"
                  : "text-phosphor-green/45 hover:bg-phosphor-green/5 hover:text-phosphor-green/75"
              )}
              onClick={() => onSidebarMode("tree")}
            >
              <FolderTree className="h-3 w-3" />
              Tree
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {sidebarMode === "queue" ? <ReviewQueuePanel /> : <FileTree />}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <ReviewIssueRail
            issues={locatedIssues}
            activeIssueId={activeIssueId}
            onOpen={openIssue}
          />
          <div className="min-h-0 flex-1">
            {!file && queue && queue.flat.length > 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <FileText className="h-8 w-8 text-phosphor-green/25" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-phosphor-green/45">
                  Ready to review
                </p>
                <p className="max-w-sm text-[11px] text-phosphor-green/40">
                  {queue.summary.headline}. Select a file from the risk-ordered
                  queue, or press{" "}
                  <kbd className="rounded border border-phosphor-green/25 px-1 font-mono text-[10px]">
                    j
                  </kbd>{" "}
                  to start.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-[10px]"
                  onClick={() => selectFile(queue.flat[0].fileId)}
                >
                  Review first file
                </Button>
              </div>
            ) : (
              <MonacoDiff
                file={file}
                className="h-full"
                layout={layout}
                onLayoutChange={onLayoutChange}
                revealHunkIndex={hunkIdx}
                revealLineNumber={
                  locatedIssues.find(
                    (entry) => entry.issue.id === activeIssueId
                  )?.lineNumber
                }
                issues={locatedIssues}
                onIssueOpen={openIssue}
              />
            )}
          </div>
        </div>
        <CausalRail hunkIndex={hunkIdx} />
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard file changes?"
        description="Permanently discards unstaged or untracked changes for this path. This cannot be undone from Spok."
        detail={file?.path}
        tone="danger"
        confirmLabel="Discard"
        busy={busy}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => void discardFile()}
      />
    </div>
  );
}
