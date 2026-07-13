"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  Folder,
  FolderGit2,
  HardDrive,
  Home,
  Loader2,
  RefreshCw,
  Star,
  Check,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { localFetch } from "@/lib/local-api-client";
import { cn } from "@/lib/utils";

export type BrowseEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
  isGitRepo?: boolean;
  isHidden?: boolean;
};

export type BrowseResponse = {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
  isGitRepo: boolean;
  error?: string;
  roots?: string[];
  home?: string;
};

const RECENT_KEY = "spok.recentRepos";
const MAX_RECENT = 8;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecentDir(dir: string) {
  if (typeof window === "undefined" || !dir) return;
  try {
    const prev = loadRecent().filter((p) => p !== dir);
    const next = [dir, ...prev].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

type Props = {
  value: string;
  onChange: (path: string) => void;
  onConfirm?: (path: string) => void;
  className?: string;
  /** Compact height for embedding in launch dialog */
  compact?: boolean;
};

export function DirectoryNavigator({
  value,
  onChange,
  onConfirm,
  className,
  compact = false,
}: Props) {
  const [currentPath, setCurrentPath] = useState(value || "");
  const [pathInput, setPathInput] = useState(value || "");
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const browse = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (target) q.set("path", target);
      q.set("dirsOnly", "1");
      const res = await localFetch(`/api/fs/browse?${q.toString()}`);
      const json = (await res.json()) as BrowseResponse & {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        setError(json.error || `Browse failed (${res.status})`);
      } else if (json.error) {
        setError(json.error);
      }
      setData(json);
      setCurrentPath(json.path);
      setPathInput(json.path);
      onChange(json.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to browse");
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  // Initial load
  useEffect(() => {
    void browse(value || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once with initial value
  }, []);

  // Sync external value changes (e.g. recent click before browse)
  useEffect(() => {
    if (value && value !== currentPath && !loading) {
      // only when parent sets a different path intentionally
    }
  }, [value, currentPath, loading]);

  const goTo = (p: string) => {
    void browse(p);
  };

  const goUp = () => {
    if (data?.parent) void browse(data.parent);
  };

  const selectCurrent = () => {
    if (!currentPath) return;
    saveRecentDir(currentPath);
    setRecent(loadRecent());
    onChange(currentPath);
    onConfirm?.(currentPath);
  };

  const onPathKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (pathInput.trim()) void browse(pathInput.trim());
  };

  const crumbs = buildBreadcrumbs(currentPath);
  const filtered = (data?.entries ?? []).filter((e) =>
    filter ? e.name.toLowerCase().includes(filter.toLowerCase()) : true
  );

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-phosphor-green/25 bg-black/40",
        className
      )}
    >
      {/* Path bar */}
      <div className="flex items-center gap-1 border-b border-phosphor-green/15 p-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={goUp}
          disabled={!data?.parent || loading}
          title="Parent directory"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => data?.home && goTo(data.home)}
          disabled={loading}
          title="Home"
        >
          <Home className="h-3.5 w-3.5" />
        </Button>
        <Input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          className="h-8 flex-1 text-xs"
          placeholder="Path…"
          spellCheck={false}
          onKeyDown={onPathKeyDown}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => void browse(currentPath || pathInput)}
          disabled={loading}
          title="Refresh"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Breadcrumbs */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-phosphor-green/10 px-2 py-1.5">
        {crumbs.map((c, i) => (
          <span key={c.path} className="inline-flex items-center">
            {i > 0 && <ChevronRight className="mx-0.5 h-3 w-3 text-phosphor-green/30" />}
            <button
              type="button"
              onClick={() => goTo(c.path)}
              className={cn(
                "rounded px-1 py-0.5 font-mono text-[10px] transition-colors",
                i === crumbs.length - 1
                  ? "text-phosphor-green"
                  : "text-phosphor-green/50 hover:bg-phosphor-green/10 hover:text-phosphor-green"
              )}
            >
              {c.label}
            </button>
          </span>
        ))}
        {data?.isGitRepo && (
          <Badge variant="success" className="ml-auto">
            git
          </Badge>
        )}
      </div>

      {/* Roots + recent */}
      <div className="flex flex-wrap gap-1 border-b border-phosphor-green/10 px-2 py-1.5">
        {(data?.roots ?? []).slice(0, 8).map((root) => (
          <button
            key={root}
            type="button"
            onClick={() => goTo(root)}
            className="inline-flex items-center gap-1 rounded border border-phosphor-green/20 px-1.5 py-0.5 text-[10px] text-phosphor-green/60 hover:border-phosphor-green/40 hover:text-phosphor-green"
          >
            <HardDrive className="h-3 w-3" />
            {root.replace(/\\$/, "")}
          </button>
        ))}
        {recent.length > 0 && (
          <>
            <span className="mx-1 self-center text-[10px] text-phosphor-green/25">|</span>
            {recent.slice(0, 4).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => goTo(r)}
                title={r}
                className="inline-flex max-w-[120px] items-center gap-1 truncate rounded border border-phosphor-amber/25 px-1.5 py-0.5 text-[10px] text-phosphor-amber/70 hover:border-phosphor-amber/50 hover:text-phosphor-amber"
              >
                <Star className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{r.split(/[/\\]/).filter(Boolean).pop()}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Filter */}
      <div className="border-b border-phosphor-green/10 px-2 py-1.5">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter folders…"
          className="h-7 text-xs"
        />
      </div>

      {/* Listing */}
      <ScrollArea className={cn(compact ? "h-44" : "h-64")}>
        <div className="p-1">
          {error && (
            <div className="m-2 rounded border border-red-500/30 bg-red-950/30 px-2 py-1.5 text-[11px] text-red-400">
              {error}
            </div>
          )}
          {!loading && filtered.length === 0 && !error && (
            <div className="p-4 text-center text-[11px] text-phosphor-green/35">
              No folders here
            </div>
          )}
          {filtered.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onDoubleClick={() => goTo(entry.path)}
              onClick={() => {
                setCurrentPath(entry.path);
                setPathInput(entry.path);
                onChange(entry.path);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                currentPath === entry.path
                  ? "bg-phosphor-green/15 text-phosphor-green"
                  : "text-phosphor-green/75 hover:bg-phosphor-green/8"
              )}
            >
              {entry.isGitRepo ? (
                <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-phosphor-amber" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-phosphor-cyan/70" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
              {entry.isGitRepo && (
                <Badge variant="amber" className="shrink-0">
                  repo
                </Badge>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* Selection footer */}
      <div className="flex items-center gap-2 border-t border-phosphor-green/15 p-2">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-widest text-phosphor-green/40">
            Selected repo
          </div>
          <div className="truncate font-mono text-[11px] text-phosphor-green/85" title={currentPath}>
            {currentPath || "—"}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={selectCurrent}
          disabled={!currentPath}
        >
          <Check className="h-3.5 w-3.5" />
          Use this folder
        </Button>
      </div>
    </div>
  );
}

function buildBreadcrumbs(p: string): { label: string; path: string }[] {
  if (!p) return [];
  const normalized = p.replace(/\//g, "\\");
  const isWin = /^[A-Za-z]:/.test(normalized);

  if (isWin) {
    const parts = normalized.split("\\").filter(Boolean);
    // parts[0] is "C:"
    const crumbs: { label: string; path: string }[] = [];
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      if (i === 0) {
        acc = parts[0] + "\\";
        crumbs.push({ label: parts[0], path: acc });
      } else {
        acc = acc.endsWith("\\") ? acc + parts[i] : acc + "\\" + parts[i];
        crumbs.push({ label: parts[i], path: acc });
      }
    }
    return crumbs;
  }

  // POSIX
  if (p === "/") return [{ label: "/", path: "/" }];
  const parts = p.split("/").filter(Boolean);
  const crumbs: { label: string; path: string }[] = [{ label: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc += "/" + part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}
