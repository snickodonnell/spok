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
import {
  DirectoryNavigator,
  saveRecentDir,
} from "@/components/shell/directory-navigator";
import { FolderOpen } from "lucide-react";

const LAST_CWD_KEY = "spok.lastCwd";
const LAST_CMD_KEY = "spok.lastCommand";

/**
 * Step 1 only: pick a working directory (and optional CLI binary),
 * then open the full workspace where prompts are entered.
 */
export function LaunchDialog() {
  const open = useSpokStore((s) => s.launchOpen);
  const setOpen = useSpokStore((s) => s.setLaunchOpen);
  const createSession = useSpokStore((s) => s.createSession);
  const setViewMode = useSpokStore((s) => s.setViewMode);
  const applyStreamEvent = useSpokStore((s) => s.applyStreamEvent);

  const [cwd, setCwd] = useState("");
  const [command, setCommand] = useState("grok");
  const [showAdvanced, setShowAdvanced] = useState(false);

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
  }, [open]);

  const openWorkspace = () => {
    if (!cwd.trim()) {
      toast.error("Select a working directory for Grok");
      return;
    }

    saveRecentDir(cwd);
    try {
      localStorage.setItem(LAST_CWD_KEY, cwd);
      localStorage.setItem(LAST_CMD_KEY, command);
    } catch {
      /* ignore */
    }

    const base = cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "repo";
    const sessionId = createSession({
      name: base,
      source: "live",
      status: "ready",
      config: {
        cwd,
        command: command.trim() || "grok",
        args: [],
        autoScroll: true,
        playbackSpeed: 1,
      },
    });

    applyStreamEvent(sessionId, {
      type: "system",
      timestamp: Date.now(),
      title: "Workspace ready",
      content: `Repo: ${cwd}\nCLI: ${command.trim() || "grok"}\n\nType a prompt below, or / for Grok commands.`,
      status: "success",
    });

    setViewMode("workspace");
    setOpen(false);
    toast.success(`Workspace open · ${base}`);
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
          </div>

          {open && (
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
          <Button onClick={openWorkspace} disabled={!cwd.trim()}>
            Open workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
