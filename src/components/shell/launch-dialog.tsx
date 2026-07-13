"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
import {
  listTrustedWorkspaces,
  trustWorkspace,
  type TrustedRootDto,
} from "@/lib/local-api-client";
import { findTrustedWorkspaceReceipt } from "@/lib/workspace-trust-receipt";
import { isDesktopRuntime, pickFolderNative } from "@/lib/desktop";
import {
  defaultTaskLaunchTarget,
  parseTaskLaunchTarget,
  validateTaskLaunch,
  type TaskLaunchTarget,
} from "@/lib/task-launch";
import { cn } from "@/lib/utils";
import {
  Bot,
  ChevronDown,
  FolderOpen,
  FolderSearch,
  Loader2,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";

const LAST_CWD_KEY = "spok.lastCwd";
const LAST_CMD_KEY = "spok.lastCommand";
const LAST_TARGET_KEY = "spok.lastTaskTarget";

function taskTitle(task: string): string {
  const firstLine = task.trim().split(/\r?\n/, 1)[0] || "Background task";
  return firstLine.length > 56 ? `${firstLine.slice(0, 55)}…` : firstLine;
}

/** Compact repository + task launcher for interactive and isolated work. */
export function LaunchDialog() {
  const open = useSpokStore((s) => s.launchOpen);
  const setOpen = useSpokStore((s) => s.setLaunchOpen);
  const nativeFolderPicker = useSpokStore((s) => s.nativeFolderPicker);
  const activeSessionCwd = useSpokStore((s) => {
    const active = s.activeSessionId ? s.sessions[s.activeSessionId] : null;
    return active?.config.cwd ?? null;
  });
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);

  const [cwd, setCwd] = useState("");
  const [command, setCommand] = useState("grok");
  const [task, setTask] = useState("");
  const [target, setTarget] = useState<TaskLaunchTarget>("interactive");
  const [preferredTarget, setPreferredTarget] =
    useState<TaskLaunchTarget | null>(null);
  const [targetTouched, setTargetTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [trustedRoots, setTrustedRoots] = useState<TrustedRootDto[]>([]);
  const [trustChecking, setTrustChecking] = useState(false);
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [launchProblem, setLaunchProblem] = useState<string | null>(null);
  const desktop = isDesktopRuntime();

  useEffect(() => {
    if (!open) return;
    let savedTarget: TaskLaunchTarget | null = null;
    try {
      const last = localStorage.getItem(LAST_CWD_KEY);
      if (last) setCwd(last);
      const lastCmd = localStorage.getItem(LAST_CMD_KEY);
      if (lastCmd) setCommand(lastCmd);
      savedTarget = parseTaskLaunchTarget(localStorage.getItem(LAST_TARGET_KEY));
    } catch {
      /* ignore */
    }
    // Prompt content is deliberately reset and never persisted.
    setTask("");
    setTarget("interactive");
    setPreferredTarget(savedTarget);
    setTargetTouched(false);
    setSubmitted(false);
    setShowAdvanced(false);
    setSubmitting(false);
    setTrustConfirmed(false);
    setLaunchProblem(null);
    setShowBrowser(!desktop || !nativeFolderPicker);
  }, [open, desktop, nativeFolderPicker]);

  useEffect(() => {
    if (!open || targetTouched) return;
    if (!task.trim()) {
      setTarget("interactive");
      return;
    }
    setTarget(
      preferredTarget ??
        defaultTaskLaunchTarget({ cwd, task, activeSessionCwd })
    );
  }, [
    open,
    targetTouched,
    task,
    cwd,
    activeSessionCwd,
    preferredTarget,
  ]);

  useEffect(() => {
    if (!open || !cwd.trim()) {
      setTrustedRoots([]);
      setTrustChecking(false);
      return;
    }
    let cancelled = false;
    setTrustChecking(true);
    const timer = window.setTimeout(() => {
      void listTrustedWorkspaces()
        .then((result) => {
          if (!cancelled) setTrustedRoots(result.roots);
        })
        .catch(() => {
          if (!cancelled) setTrustedRoots([]);
        })
        .finally(() => {
          if (!cancelled) setTrustChecking(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, cwd]);

  useEffect(() => {
    setTrustConfirmed(false);
    setLaunchProblem(null);
  }, [cwd]);

  const validation = validateTaskLaunch({ cwd, command, task, target });
  const trustReceipt = findTrustedWorkspaceReceipt(cwd, trustedRoots);
  const authorityReady = !!trustReceipt || trustConfirmed;

  const pickNative = async () => {
    setPicking(true);
    try {
      const path = await pickFolderNative({
        title: "Choose task repository",
        defaultPath: cwd || undefined,
      });
      if (path) {
        setCwd(path);
        setSubmitted(false);
        toast.message("Repository selected");
      }
    } finally {
      setPicking(false);
    }
  };

  const chooseTarget = (next: TaskLaunchTarget) => {
    setTarget(next);
    setPreferredTarget(next);
    setTargetTouched(true);
    setSubmitted(false);
  };

  const persistSafeChoices = (
    trustedCwd: string,
    nextTarget: TaskLaunchTarget
  ) => {
    try {
      localStorage.setItem(LAST_CWD_KEY, trustedCwd);
      localStorage.setItem(LAST_CMD_KEY, command.trim() || "grok");
      localStorage.setItem(LAST_TARGET_KEY, nextTarget);
    } catch {
      /* ignore */
    }
  };

  const launch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!validation.ok || submitting) return;
    if (!authorityReady) {
      setLaunchProblem(
        "Confirm repository trust before launching. Selecting a folder alone grants no execution authority."
      );
      return;
    }

    setSubmitting(true);
    setLaunchProblem(null);
    try {
      // This is the only authority-changing step and follows the visible trust
      // confirmation (or an existing durable trust receipt).
      const trusted = await trustWorkspace(cwd.trim());
      if (target === "background") {
        const { enqueueBackgroundJob } = await import("@/lib/background-runner");
        enqueueBackgroundJob({
          title: taskTitle(task),
          prompt: task.trim(),
          cwd: trusted.root,
          isolate: true,
          kind: "background",
        });
        persistSafeChoices(trusted.root, target);
        setOpen(false);
        toast.success("Isolated agent queued", {
          description: "Spok will stop safely if worktree or policy setup fails.",
        });
        return;
      }

      const base =
        cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "repo";
      const result = await openWorkspaceSession({
        cwd: trusted.root,
        command,
        name: base,
        forceNewSession: true,
      });
      if (task.trim()) {
        // Existing one-shot composer contract: draft only, never auto-submit.
        useSpokStore.getState().setComposerPrefill(task.trim());
      }
      persistSafeChoices(result.root, target);
      setOpen(false);
      toast.success(`Workspace ready · ${result.name}`, {
        description: task.trim()
          ? "Task added as a draft. Review it, then send when ready."
          : "Enter a task when you are ready.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task launch failed";
      setLaunchProblem(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[92dvh] max-w-2xl flex-col overflow-hidden p-0">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={launch}>
          <DialogHeader className="shrink-0 border-b border-phosphor-green/15 px-5 py-4 text-left">
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>
              Choose a repository, describe the work, and decide where it runs.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <section aria-labelledby="task-repository-label" className="space-y-2">
              <div
                id="task-repository-label"
                className="text-[10px] font-medium uppercase tracking-widest text-phosphor-green/50"
              >
                Repository
              </div>
              <div
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-md border bg-black/30 px-2",
                  submitted && validation.errors.cwd
                    ? "border-red-400/60"
                    : "border-phosphor-green/20"
                )}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-phosphor-amber" />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs text-phosphor-green"
                  title={cwd}
                >
                  {cwd || "No repository selected"}
                </span>
                {desktop && nativeFolderPicker && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 shrink-0"
                    disabled={picking || submitting}
                    onClick={() => void pickNative()}
                  >
                    {picking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FolderSearch className="h-3.5 w-3.5" />
                    )}
                    Browse…
                  </Button>
                )}
              </div>
              {submitted && validation.errors.cwd && (
                <p className="text-[11px] text-red-300" role="alert">
                  {validation.errors.cwd}
                </p>
              )}

              {desktop && nativeFolderPicker && !showBrowser && (
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wider text-phosphor-cyan/70 hover:text-phosphor-cyan"
                  onClick={() => setShowBrowser(true)}
                >
                  Use in-app browser
                </button>
              )}

              {open && showBrowser && (
                <DirectoryNavigator
                  value={cwd}
                  onChange={(value) => {
                    setCwd(value);
                    setSubmitted(false);
                  }}
                  onConfirm={(value) => {
                    setCwd(value);
                    setSubmitted(false);
                  }}
                  compact
                />
              )}
            </section>

            <section className="space-y-2">
              <label
                htmlFor="new-task-description"
                className="flex items-center justify-between text-[10px] font-medium uppercase tracking-widest text-phosphor-green/50"
              >
                <span>Task</span>
                <span className="normal-case tracking-normal text-phosphor-green/30">
                  optional for interactive
                </span>
              </label>
              <textarea
                id="new-task-description"
                value={task}
                onChange={(event) => {
                  setTask(event.target.value);
                  setSubmitted(false);
                }}
                placeholder="Describe what you want the agent to accomplish…"
                rows={4}
                aria-invalid={submitted && !!validation.errors.task}
                aria-describedby="new-task-policy"
                className={cn(
                  "w-full resize-y rounded-md border bg-black/40 px-3 py-2 font-mono text-sm leading-relaxed text-phosphor-green outline-none placeholder:text-phosphor-green/25 focus:border-phosphor-cyan/50",
                  submitted && validation.errors.task
                    ? "border-red-400/60"
                    : "border-phosphor-green/20"
                )}
              />
              {submitted && validation.errors.task && (
                <p className="text-[11px] text-red-300" role="alert">
                  {validation.errors.task}
                </p>
              )}
            </section>

            <fieldset className="space-y-2">
              <legend className="text-[10px] font-medium uppercase tracking-widest text-phosphor-green/50">
                Execution target
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <TargetOption
                  value="interactive"
                  checked={target === "interactive"}
                  onChange={chooseTarget}
                  icon={<MessageSquareText className="h-4 w-4" />}
                  title="Work interactively"
                  body="Open the workspace. A task becomes a draft and never runs until you send it."
                />
                <TargetOption
                  value="background"
                  checked={target === "background"}
                  onChange={chooseTarget}
                  icon={<Bot className="h-4 w-4" />}
                  title="Queue isolated agent"
                  body="Run concurrently in a Spok-managed worktree and keep the main checkout untouched."
                />
              </div>
            </fieldset>

            <div
              id="new-task-policy"
              className="flex items-start gap-2 rounded-md border border-phosphor-cyan/20 bg-phosphor-cyan/5 px-3 py-2 text-[11px] leading-relaxed text-phosphor-cyan/75"
            >
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {target === "background"
                ? "Selection grants no authority. Confirm trust below; if policy or worktree isolation fails, no agent process starts."
                : "Selection grants no authority. Confirm trust below; the task remains a draft until you explicitly send it."}
            </div>

            <section
              className="space-y-3 rounded-md border border-phosphor-green/20 bg-black/25 p-3"
              aria-labelledby="launch-receipt-title"
              data-testid="launch-authority-receipt"
            >
              <div id="launch-receipt-title" className="text-xs font-semibold text-phosphor-green">
                Launch authority receipt
              </div>
              <dl className="grid gap-2 text-xs sm:grid-cols-[8rem_1fr]">
                <dt className="text-phosphor-green/60">Repository</dt>
                <dd className="break-all font-mono text-phosphor-green/90">{cwd || "Not selected"}</dd>
                <dt className="text-phosphor-green/60">Execution</dt>
                <dd>{target === "background" ? "Isolated managed worktree" : "Interactive selected checkout"}</dd>
                <dt className="text-phosphor-green/60">Effective policy</dt>
                <dd className="capitalize">{appPermissionMode} · deny rules always win</dd>
                <dt className="text-phosphor-green/60">Approval behavior</dt>
                <dd>{appPermissionMode === "plan" ? "Execution is blocked in plan mode" : "Actions outside policy require a scoped approval"}</dd>
                <dt className="text-phosphor-green/60">Trust</dt>
                <dd>
                  {trustChecking
                    ? "Checking durable trust…"
                    : trustReceipt
                      ? `Trusted ${trustReceipt.trustedAt ? new Date(trustReceipt.trustedAt).toLocaleString() : "previously"} · root ${trustReceipt.path}`
                      : "Not trusted · repository selection grants no authority"}
                </dd>
              </dl>
              {!trustReceipt && !trustChecking && (
                <label className="flex cursor-pointer items-start gap-2 rounded border border-phosphor-amber/30 bg-phosphor-amber/5 p-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-amber-400"
                    checked={trustConfirmed}
                    onChange={(event) => {
                      setTrustConfirmed(event.target.checked);
                      setLaunchProblem(null);
                    }}
                    data-testid="launch-trust-confirmation"
                  />
                  <span>
                    Trust this repository root for agent execution and Git operations. Trust is durable and can be revoked in Settings → Privacy.
                  </span>
                </label>
              )}
              <p className="text-xs text-phosphor-green/60">
                Failure is safe: trust, policy, or isolation denial starts no agent process.
              </p>
            </section>

            {launchProblem && (
              <div className="rounded border border-phosphor-red/40 bg-phosphor-red/10 p-3 text-sm text-phosphor-red" role="alert" data-testid="launch-problem">
                {launchProblem}
              </div>
            )}

            <section>
              <button
                type="button"
                aria-expanded={showAdvanced}
                aria-controls="new-task-advanced"
                className="flex min-h-8 items-center gap-1 text-[10px] uppercase tracking-wider text-phosphor-green/45 hover:text-phosphor-cyan"
                onClick={() => setShowAdvanced((value) => !value)}
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    showAdvanced && "rotate-180"
                  )}
                />
                Advanced
              </button>
              {showAdvanced && (
                <div id="new-task-advanced" className="mt-2 space-y-1.5">
                  <label
                    htmlFor="new-task-command"
                    className="block text-[10px] uppercase tracking-widest text-phosphor-green/45"
                  >
                    Interactive CLI command
                  </label>
                  <Input
                    id="new-task-command"
                    value={command}
                    onChange={(event) => {
                      setCommand(event.target.value);
                      setSubmitted(false);
                    }}
                    placeholder="grok"
                    disabled={target === "background"}
                    aria-invalid={submitted && !!validation.errors.command}
                  />
                  <p className="text-[10px] text-phosphor-green/35">
                    {target === "background"
                      ? "Background agents use Spok’s managed Grok runner."
                      : "Override the Grok executable for this workspace."}
                  </p>
                  {submitted && validation.errors.command && (
                    <p className="text-[11px] text-red-300" role="alert">
                      {validation.errors.command}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>

          <DialogFooter className="shrink-0 border-t border-phosphor-green/15 px-5 py-3 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {target === "background" ? "Queue agent" : "Open workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TargetOption({
  value,
  checked,
  onChange,
  icon,
  title,
  body,
}: {
  value: TaskLaunchTarget;
  checked: boolean;
  onChange: (value: TaskLaunchTarget) => void;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-24 cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
        checked
          ? "border-phosphor-cyan/45 bg-phosphor-cyan/10"
          : "border-phosphor-green/15 bg-black/25 hover:border-phosphor-green/30"
      )}
    >
      <input
        type="radio"
        name="task-execution-target"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-1 accent-cyan-400"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-phosphor-green">
          <span className="text-phosphor-cyan">{icon}</span>
          {title}
        </span>
        <span className="mt-1 block text-[11px] leading-relaxed text-phosphor-green/45">
          {body}
        </span>
      </span>
    </label>
  );
}
