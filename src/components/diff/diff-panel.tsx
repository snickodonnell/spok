"use client";

import { useSpokStore } from "@/lib/store";
import { FileTree } from "./file-tree";
import { DiffStatChip, MonacoDiff, type DiffLayout } from "./monaco-diff";
import { HunkNav } from "./hunk-nav";
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
} from "lucide-react";
import { unifiedDiffText } from "@/lib/diff-utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { refreshGitDiff } from "@/lib/harness";
import { runGitAndRefresh } from "@/lib/git/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const LAYOUT_KEY = "spok.diffLayout";

export function DiffPanel() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);
  const file = session?.selectedFileId
    ? session.files[session.selectedFileId]
    : null;
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [layout, setLayout] = useState<DiffLayout>("unified");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved === "unified" || saved === "split") setLayout(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const onLayoutChange = (next: DiffLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const planMode = appPermissionMode === "plan";
  const canMutate = !!session?.config.cwd && !planMode;

  const copyDiff = async () => {
    if (!file) return;
    await navigator.clipboard.writeText(unifiedDiffText(file));
    setCopied(true);
    toast.success("Diff copied to clipboard");
    setTimeout(() => setCopied(false), 1500);
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

  const fileCount = session ? Object.keys(session.files).length : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-phosphor-green/15 px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-phosphor-green crt-glow">
            Repo Diff
          </h2>
          <span className="font-mono text-[10px] text-phosphor-green/40">
            {fileCount} file{fileCount === 1 ? "" : "s"}
          </span>
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
          <div className="flex min-w-0 items-center gap-2">
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
            <HunkNav file={file} />
            {canMutate && (
              <>
                {(file.unstaged || file.untracked) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Stage file"
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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyDiff}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-phosphor-green" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={downloadDiff}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Simple flex split — no nested resizable groups (avoids layout blowouts) */}
      <div className="flex min-h-0 flex-1">
        <div className="w-56 shrink-0 overflow-auto border-r border-phosphor-green/15">
          <FileTree />
        </div>
        <div className="min-w-0 flex-1">
          <MonacoDiff
            file={file}
            className="h-full"
            layout={layout}
            onLayoutChange={onLayoutChange}
          />
        </div>
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
