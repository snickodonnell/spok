"use client";

import { useState } from "react";
import { ArrowLeft, FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DirectoryNavigator } from "@/components/shell/directory-navigator";
import { openWorkspaceSession } from "@/lib/workspace-session";
import { stopAllLiveHarnesses } from "@/lib/session-lifecycle-client";
import { useSpokStore } from "@/lib/store";

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
 * Always starts a **new** session; stops any live host process first so an
 * existing/active session cannot block directory changes.
 */
export function MobileFolderPicker({ open, onClose, onOpened }: Props) {
  const activeCwd = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId]?.config.cwd
      : undefined
  );
  const [cwd, setCwd] = useState(activeCwd || "");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const confirm = async (path: string) => {
    const target = path.trim();
    if (!target) {
      toast.error("Pick a folder on the host PC");
      return;
    }
    setBusy(true);
    try {
      // Explicit stop so we never appear blocked by an active session
      await stopAllLiveHarnesses();
      const result = await openWorkspaceSession({
        cwd: target,
        command: "grok",
        forceNewSession: true,
      });
      toast.success(
        result.isNewDirectory
          ? `New session · ${result.name}`
          : `Session ready · ${result.name}`
      );
      onOpened?.(result);
      onClose();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not open folder on host"
      );
    } finally {
      setBusy(false);
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
            Starts a new session on the host · stops any running job
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

      <footer className="flex shrink-0 gap-2 border-t border-phosphor-green/15 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
      </footer>
    </div>
  );
}
