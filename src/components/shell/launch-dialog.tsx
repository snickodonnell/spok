"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSpokStore } from "@/lib/store";
import { toast } from "sonner";
import { DirectoryNavigator } from "@/components/shell/directory-navigator";
import { openWorkspaceSession } from "@/lib/workspace-session";
import { isDesktopRuntime, pickFolderNative } from "@/lib/desktop";
import { FolderOpen, FolderSearch } from "lucide-react";

const LAST_CWD_KEY = "spok.lastCwd";
const LAST_CMD_KEY = "spok.lastCommand";

/**
 * Step 1 only: pick a working directory (and optional CLI binary),
 * then open the full workspace where prompts are entered.
 */
export function LaunchDialog() {
  const open = useSpokStore((s) => s.launchOpen);
  const setOpen = useSpokStore((s) => s.setLaunchOpen);
  const nativeFolderPicker = useSpokStore((s) => s.nativeFolderPicker);

  const [cwd, setCwd] = useState("");
  const [command, setCommand] = useState("grok");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [picking, setPicking] = useState(false);
  const desktop = isDesktopRuntime();

  useEffect(() => {
    if (!open) return;
    try {
      const last = localStorage.getItem(LAST_CWD_KEY);
      if (last) setCwd(last);
      const lastCmd = localStorage.getItem(LAST_CMD_KEY);
      if (lastCmd) setCommand(lastCmd);
    } catch {
      /* ignore */
    }
    // Desktop default: prefer native picker; show in-app browser only when needed
    setShowBrowser(!desktop || !nativeFolderPicker);
  }, [open, desktop, nativeFolderPicker]);

  const pickNative = async () => {
    setPicking(true);
    try {
      const path = await pickFolderNative({
        title: "Open workspace folder",
        defaultPath: cwd || undefined,
      });
      if (path) {
        setCwd(path);
        toast.message("Folder selected");
      }
    } finally {
      setPicking(false);
    }
  };

  const openWorkspace = async () => {
    if (!cwd.trim()) {
      toast.error("Select a working directory for Grok");
      return;
    }

    try {
      const base =
        cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "repo";
      const { name, isNewDirectory } = await openWorkspaceSession({
        cwd,
        command,
        name: base,
        forceNewSession: true,
      });
      setOpen(false);
      toast.success(
        isNewDirectory
          ? `New session · ${name}`
          : `Workspace open · ${name}`
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to open workspace"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Open workspace</DialogTitle>
          <DialogDescription>
            Choose the local repo Grok will run in. You&apos;ll enter prompts and
            slash commands on the next screen — with live thinking and diffs
            permanently visible.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex items-center gap-2 rounded border border-phosphor-green/20 bg-black/30 px-2 py-1.5">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-phosphor-amber" />
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs text-phosphor-green"
              title={cwd}
            >
              {cwd || "No folder selected"}
            </span>
            {desktop && nativeFolderPicker && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 shrink-0"
                disabled={picking}
                onClick={() => void pickNative()}
              >
                <FolderSearch className="h-3.5 w-3.5" />
                Browse…
              </Button>
            )}
          </div>

          {desktop && nativeFolderPicker && !showBrowser && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-[11px] text-phosphor-green/45">
                Using the OS folder picker for a native desktop experience.
              </p>
              <button
                type="button"
                className="text-[10px] uppercase tracking-wider text-phosphor-cyan/70 hover:text-phosphor-cyan"
                onClick={() => setShowBrowser(true)}
              >
                Use in-app browser
              </button>
            </div>
          )}

          {open && showBrowser && (
            <DirectoryNavigator
              value={cwd}
              onChange={setCwd}
              onConfirm={(p) => {
                setCwd(p);
              }}
              compact
            />
          )}

          <button
            type="button"
            className="text-[10px] uppercase tracking-wider text-phosphor-green/40 hover:text-phosphor-cyan"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide advanced" : "Advanced · CLI binary"}
          </button>

          {showAdvanced && (
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-phosphor-green/45">
                Command
              </label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="grok"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void openWorkspace()} disabled={!cwd.trim()}>
            Open workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
