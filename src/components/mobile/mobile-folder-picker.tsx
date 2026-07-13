"use client";

import { useState } from "react";
import { ArrowLeft, FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DirectoryNavigator } from "@/components/shell/directory-navigator";
import { openWorkspaceSession } from "@/lib/workspace-session";
import {
  findWorkspaceRunConflict,
  type WorkspaceRunConflict,
} from "@/lib/session-lifecycle-client";
import { useSpokStore } from "@/lib/store";
import { trustWorkspace } from "@/lib/local-api-client";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called after a new session is created for the chosen folder */
  onOpened?: (info: {
    sessionId: string;
    root: string;
    name: string;
    isNewDirectory: boolean;
  }) => void;
};

/**
 * Full-screen folder picker for phone — does not use Radix Dialog.
 * Opens or switches repository context without mutating unrelated runs.
 */
export function MobileFolderPicker({ open, onClose, onOpened }: Props) {
  const activeCwd = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId]?.config.cwd
      : undefined
  );
  const [cwd, setCwd] = useState(activeCwd || "");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<WorkspaceRunConflict | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [trustConfirmed, setTrustConfirmed] = useState(false);

  if (!open) return null;

  const confirm = async (path: string, conflictDecision?: "reuse" | "stop") => {
    const target = path.trim();
    if (!target) {
      setProblem("Pick a folder on the host PC.");
      return;
    }
    const exactConflict = findWorkspaceRunConflict(target);
    if (exactConflict && !conflictDecision) {
      setConflict(exactConflict);
      setProblem(null);
      return;
    }
    if (conflictDecision !== "reuse" && !trustConfirmed) {
      setProblem(
        "Confirm repository trust before opening a new executable workspace. Selecting a folder grants no authority."
      );
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const authorizedTarget =
        conflictDecision === "reuse"
          ? target
          : (await trustWorkspace(target)).root;
      const result = await openWorkspaceSession({
        cwd: authorizedTarget,
        command: "grok",
        forceNewSession: true,
        conflictDecision,
      });
      toast.success(
        result.isNewDirectory
          ? `New session · ${result.name}`
          : `Session ready · ${result.name}`
      );
      onOpened?.(result);
      onClose();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not open folder on host");
    } finally {
      setBusy(false);
      setConflict(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-crt-bg text-phosphor-green"
      data-testid="mobile-folder-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Change folder"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-phosphor-green/15 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={onClose}
          disabled={busy}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Change folder</div>
          <div className="truncate text-[11px] text-phosphor-green/45">
            Switch repository context · unrelated runs keep working
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <DirectoryNavigator
          value={cwd}
          onChange={setCwd}
          onConfirm={(p) => {
            setCwd(p);
            void confirm(p);
          }}
        />
      </div>

      {conflict && (
        <section
          className="mx-3 mb-2 rounded-lg border border-phosphor-amber/40 bg-phosphor-amber/10 p-3"
          role="alertdialog"
          aria-label="Repository run conflict"
          data-testid="mobile-folder-conflict"
        >
          <div className="text-sm font-medium text-phosphor-amber">
            {conflict.name} is {conflict.status}
          </div>
          <p className="mt-1 break-all text-xs text-phosphor-green/75">
            This exact checkout is in use: {conflict.cwd}
          </p>
          <p className="mt-1 text-xs text-phosphor-green/65">
            Other repositories are unaffected. Choose whether to view this run or stop only this session.
          </p>
          <div className="mt-3 grid gap-2">
            <Button
              onClick={() => void confirm(cwd, "reuse")}
              data-testid="mobile-conflict-view-run"
            >
              View running session
            </Button>
            <Button
              variant="outline"
              onClick={() => void confirm(cwd, "stop")}
              data-testid="mobile-conflict-stop-run"
            >
              Stop {conflict.name} and open a new session
            </Button>
            <Button variant="ghost" onClick={() => setConflict(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {problem && (
        <div className="mx-3 mb-2 rounded border border-phosphor-red/40 bg-phosphor-red/10 p-3 text-sm text-phosphor-red" role="alert">
          {problem}
        </div>
      )}

      <footer className="shrink-0 space-y-2 border-t border-phosphor-green/15 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <label className="flex items-start gap-2 rounded border border-phosphor-amber/30 bg-phosphor-amber/5 p-2 text-xs text-phosphor-green/80">
          <input
            type="checkbox"
            className="mt-0.5 accent-amber-400"
            checked={trustConfirmed}
            onChange={(event) => {
              setTrustConfirmed(event.target.checked);
              setProblem(null);
            }}
            data-testid="mobile-folder-trust"
          />
          <span>
            Trust this repository root for agent execution and Git. Selection alone grants no authority; revoke in Settings → Privacy.
          </span>
        </label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="min-h-12 flex-1"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            className="min-h-12 flex-[1.4]"
            disabled={busy || !cwd.trim()}
            onClick={() => void confirm(cwd)}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )}
            {busy ? "Opening…" : "Use folder"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
