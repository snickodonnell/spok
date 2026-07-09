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
import { parseTextLine } from "@/lib/parser";
import { toast } from "sonner";
import {
  DirectoryNavigator,
  saveRecentDir,
} from "@/components/shell/directory-navigator";
import { FolderOpen, ChevronDown, ChevronUp } from "lucide-react";

const LAST_CWD_KEY = "spok.lastCwd";
const LAST_CMD_KEY = "spok.lastCommand";

export function LaunchDialog() {
  const open = useSpokStore((s) => s.launchOpen);
  const setOpen = useSpokStore((s) => s.setLaunchOpen);
  const createSession = useSpokStore((s) => s.createSession);
  const applyStreamEvent = useSpokStore((s) => s.applyStreamEvent);
  const appendRawLog = useSpokStore((s) => s.appendRawLog);
  const updateSession = useSpokStore((s) => s.updateSession);

  const [cwd, setCwd] = useState("");
  const [command, setCommand] = useState("grok");
  const [args, setArgs] = useState("");
  const [prompt, setPrompt] = useState("");
  const [launching, setLaunching] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(true);

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

  const onLaunch = async () => {
    if (!cwd.trim()) {
      toast.error("Select a working directory for Grok to run in");
      setBrowserOpen(true);
      return;
    }

    setLaunching(true);
    saveRecentDir(cwd);
    try {
      localStorage.setItem(LAST_CWD_KEY, cwd);
      localStorage.setItem(LAST_CMD_KEY, command);
    } catch {
      /* ignore */
    }

    const sessionId = createSession({
      name: prompt.slice(0, 60) || `Live ${new Date().toLocaleTimeString()}`,
      source: "live",
      status: "starting",
      config: {
        cwd,
        command,
        args: args ? args.split(/\s+/) : [],
        autoScroll: true,
        playbackSpeed: 1,
      },
    });

    applyStreamEvent(sessionId, {
      type: "session_start",
      timestamp: Date.now(),
      title: "Session starting",
      content: `${command} ${args}`.trim() + `\ncwd: ${cwd}`,
    });

    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          cwd: cwd || undefined,
          command,
          args: [
            ...(args ? args.split(/\s+/).filter(Boolean) : []),
            ...(prompt ? [prompt] : []),
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Failed to start session");
      }

      if (!res.body) throw new Error("No response stream");

      updateSession(sessionId, { status: "running" });
      setOpen(false);
      toast.success(`Live session in ${cwd}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              appendRawLog(sessionId, line);
              try {
                const parsed = JSON.parse(line) as {
                  type?: string;
                  data?: string;
                  event?: unknown;
                };
                if (parsed.type === "stdout" || parsed.type === "stderr") {
                  const text = parsed.data ?? "";
                  for (const l of text.split("\n").filter(Boolean)) {
                    applyStreamEvent(sessionId, parseTextLine(l));
                  }
                } else if (parsed.type === "event" && parsed.event) {
                  applyStreamEvent(sessionId, parsed.event as never);
                } else if (parsed.type === "exit") {
                  updateSession(sessionId, {
                    status:
                      (parsed as { code?: number }).code === 0
                        ? "completed"
                        : "error",
                  });
                  applyStreamEvent(sessionId, {
                    type: "session_end",
                    timestamp: Date.now(),
                    content: `Process exited with code ${(parsed as { code?: number }).code}`,
                    status:
                      (parsed as { code?: number }).code === 0
                        ? "success"
                        : "error",
                  });
                } else {
                  applyStreamEvent(sessionId, parseTextLine(line));
                }
              } catch {
                applyStreamEvent(sessionId, parseTextLine(line));
              }
            }
          }
          const s = useSpokStore.getState().sessions[sessionId];
          if (s && (s.status === "running" || s.status === "starting")) {
            updateSession(sessionId, { status: "completed" });
            applyStreamEvent(sessionId, {
              type: "session_end",
              timestamp: Date.now(),
              content: "Stream ended",
              status: "success",
            });
          }
        } catch (e) {
          updateSession(sessionId, {
            status: "error",
            error: e instanceof Error ? e.message : "Stream error",
          });
          toast.error("Session stream error");
        }
      })();
    } catch (e) {
      updateSession(sessionId, {
        status: "error",
        error: e instanceof Error ? e.message : "Launch failed",
      });
      applyStreamEvent(sessionId, {
        type: "error",
        timestamp: Date.now(),
        title: "Launch failed",
        content:
          e instanceof Error
            ? e.message
            : "Could not spawn process. Is the Grok CLI installed and on PATH?",
        status: "error",
      });
      toast.error(
        e instanceof Error
          ? e.message
          : "Launch failed — use samples or import if CLI is unavailable"
      );
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Launch Grok Build</DialogTitle>
          <DialogDescription>
            Pick the local repo Grok will run in, then launch a CLI session.
            Traces and diffs stream live into Spok. CLI:{" "}
            <code className="text-phosphor-cyan">grok</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Working directory */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-[10px] uppercase tracking-widest text-phosphor-green/45">
                Working directory (repo)
              </label>
              <button
                type="button"
                onClick={() => setBrowserOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-phosphor-cyan/70 hover:text-phosphor-cyan"
              >
                <FolderOpen className="h-3 w-3" />
                {browserOpen ? "Hide browser" : "Browse folders"}
                {browserOpen ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            </div>

            <div className="mb-2 flex items-center gap-2 rounded border border-phosphor-green/20 bg-black/30 px-2 py-1.5">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-phosphor-amber" />
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs text-phosphor-green"
                title={cwd}
              >
                {cwd || "No folder selected — browse below"}
              </span>
            </div>

            {browserOpen && open && (
              <DirectoryNavigator
                value={cwd}
                onChange={setCwd}
                onConfirm={(p) => {
                  setCwd(p);
                  toast.success(`Repo set: ${p}`);
                }}
                compact
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
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
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-phosphor-green/45">
                Extra args
              </label>
              <Input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="optional flags"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-widest text-phosphor-green/45">
              Prompt / task
            </label>
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Refactor the auth middleware…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={onLaunch} disabled={launching || !cwd.trim()}>
            {launching ? "Starting…" : "Launch session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
