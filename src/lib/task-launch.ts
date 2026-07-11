export type TaskLaunchTarget = "interactive" | "background";

export type TaskLaunchInput = {
  cwd: string;
  command: string;
  task: string;
  target: TaskLaunchTarget;
};

export type TaskLaunchValidation = {
  ok: boolean;
  errors: Partial<Record<"cwd" | "command" | "task", string>>;
};

function normalizeWorkspacePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function sameWorkspace(a?: string | null, b?: string | null): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return normalizeWorkspacePath(a) === normalizeWorkspacePath(b);
}

/** Product default before a user-selected target preference is applied. */
export function defaultTaskLaunchTarget(opts: {
  cwd: string;
  task: string;
  activeSessionCwd?: string | null;
}): TaskLaunchTarget {
  return opts.task.trim() && sameWorkspace(opts.cwd, opts.activeSessionCwd)
    ? "background"
    : "interactive";
}

export function parseTaskLaunchTarget(
  value: string | null | undefined
): TaskLaunchTarget | null {
  return value === "interactive" || value === "background" ? value : null;
}

export function validateTaskLaunch(
  input: TaskLaunchInput
): TaskLaunchValidation {
  const errors: TaskLaunchValidation["errors"] = {};
  if (!input.cwd.trim()) errors.cwd = "Select a repository";
  if (input.target === "interactive" && !input.command.trim()) {
    errors.command = "Enter a CLI command";
  }
  if (input.target === "background" && !input.task.trim()) {
    errors.task = "Describe the task for the background agent";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
