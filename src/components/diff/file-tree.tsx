"use client";

import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileCode2,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import type { DiffStatus, FileDiff, FileTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { DiffStatChip } from "./monaco-diff";
import { classifyFileRisk } from "@/lib/file-risk";
import { FileRiskBadge } from "./file-risk-badge";

function statusColor(status?: DiffStatus) {
  switch (status) {
    case "added":
      return "text-phosphor-green";
    case "deleted":
      return "text-phosphor-red";
    case "modified":
      return "text-phosphor-amber";
    case "renamed":
      return "text-phosphor-cyan";
    default:
      return "text-phosphor-green/50";
  }
}

function statusLetter(status?: DiffStatus) {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    default:
      return "";
  }
}

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
  search,
  stagedIds,
  untrackedIds,
  filesById,
}: {
  node: FileTreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (fileId: string) => void;
  search: string;
  stagedIds: Set<string>;
  untrackedIds: Set<string>;
  filesById: Record<string, FileDiff>;
}) {
  const [open, setOpen] = useState(true);
  const q = search.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!q) return true;
    if (node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q))
      return true;
    if (node.children) {
      const walk = (n: FileTreeNode): boolean => {
        if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
          return true;
        return n.children?.some(walk) ?? false;
      };
      return node.children.some(walk);
    }
    return false;
  }, [node, q]);

  if (!visible) return null;

  if (node.type === "directory") {
    return (
      <div>
        <button
          type="button"
          className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs hover:bg-phosphor-green/5"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 text-phosphor-green/40" />
          ) : (
            <ChevronRight className="h-3 w-3 text-phosphor-green/40" />
          )}
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 text-phosphor-amber/70" />
          ) : (
            <Folder className="h-3.5 w-3.5 text-phosphor-amber/70" />
          )}
          <span className="truncate text-phosphor-green/75">{node.name}</span>
          {(!!node.additions || !!node.deletions) && (
            <DiffStatChip
              className="ml-auto scale-90"
              additions={node.additions ?? 0}
              deletions={node.deletions ?? 0}
            />
          )}
        </button>
        {open &&
          node.children?.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              search={search}
              stagedIds={stagedIds}
              untrackedIds={untrackedIds}
              filesById={filesById}
            />
          ))}
      </div>
    );
  }

  const selected = node.fileId === selectedId;
  const isStaged = node.fileId ? stagedIds.has(node.fileId) : false;
  const isUntracked = node.fileId ? untrackedIds.has(node.fileId) : false;
  const fileMeta = node.fileId ? filesById[node.fileId] : undefined;
  const risk = fileMeta
    ? classifyFileRisk(fileMeta.path, fileMeta)
    : classifyFileRisk(node.path);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-xs transition-colors",
        selected
          ? "bg-phosphor-green/12 text-phosphor-green border-l-2 border-phosphor-green"
          : "border-l-2 border-transparent hover:bg-phosphor-green/5 text-phosphor-green/80"
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => node.fileId && onSelect(node.fileId)}
    >
      <FileCode2 className={cn("h-3.5 w-3.5 shrink-0", statusColor(node.status))} />
      <span className="truncate">{node.name}</span>
      {isStaged && (
        <span
          className="text-[9px] font-bold text-phosphor-green"
          title="Staged"
        >
          S
        </span>
      )}
      {isUntracked && (
        <span className="text-[9px] text-phosphor-cyan" title="Untracked">
          ?
        </span>
      )}
      <span className={cn("text-[10px] font-bold", statusColor(node.status))}>
        {statusLetter(node.status)}
      </span>
      {(risk.kind === "security" ||
        risk.kind === "config" ||
        risk.kind === "binary" ||
        risk.level === "critical" ||
        risk.level === "high") && (
        <FileRiskBadge risk={risk} compact className="ml-0.5" />
      )}
      <DiffStatChip
        className="ml-auto scale-90"
        additions={node.additions ?? 0}
        deletions={node.deletions ?? 0}
      />
    </button>
  );
}

export function FileTree() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const selectFile = useSpokStore((s) => s.selectFile);
  const [search, setSearch] = useState("");

  if (!session) return null;

  const files = Object.values(session.files);
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const stagedIds = new Set(files.filter((f) => f.staged).map((f) => f.id));
  const untrackedIds = new Set(
    files.filter((f) => f.untracked).map((f) => f.id)
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-phosphor-green/15 p-2 space-y-2">
        <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-phosphor-green/45">
          <span>
            Files{" "}
            <span className="font-mono normal-case text-phosphor-green/30">
              {files.length}
            </span>
          </span>
          <DiffStatChip additions={totalAdd} deletions={totalDel} />
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-phosphor-green/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter files…"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {session.fileTree.length === 0 ? (
          <div className="p-4 text-center text-xs text-phosphor-green/35">
            No file changes yet
          </div>
        ) : (
          session.fileTree.map((n) => (
            <TreeNode
              key={n.path}
              node={n}
              depth={0}
              selectedId={session.selectedFileId}
              onSelect={selectFile}
              search={search}
              stagedIds={stagedIds}
              untrackedIds={untrackedIds}
              filesById={session.files}
            />
          ))
        )}
      </div>
    </div>
  );
}
