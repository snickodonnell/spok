"use client";

import { useSpokStore } from "@/lib/store";
import { FileTree } from "./file-tree";
import { MonacoDiff } from "./monaco-diff";
import { HunkNav } from "./hunk-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check, RefreshCw } from "lucide-react";
import { unifiedDiffText } from "@/lib/diff-utils";
import { useState } from "react";
import { toast } from "sonner";
import { refreshGitDiff } from "@/lib/harness";

export function DiffPanel() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const file = session?.selectedFileId
    ? session.files[session.selectedFileId]
    : null;
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
            <span className="max-w-[240px] truncate font-mono text-[11px] text-phosphor-green/70">
              {file.path}
            </span>
            <span className="font-mono text-[11px]">
              <span className="text-phosphor-green">+{file.additions}</span>{" "}
              <span className="text-phosphor-red">-{file.deletions}</span>
            </span>
            <HunkNav file={file} />
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
          <MonacoDiff file={file} className="h-full" />
        </div>
      </div>
    </div>
  );
}
