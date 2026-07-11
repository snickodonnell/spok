/**
 * Grok CLI slash-command catalog for Spok prompt autocomplete.
 * Typing `/` in the prompt box filters these by name / aliases / description.
 */

export type SlashKind =
  | "prompt" // maps to a headless/single prompt turn
  | "flag" // sets a sticky session flag
  | "cli" // runs a non-interactive CLI subcommand
  | "ui"; // Spok-only UI action

export type SlashRisk = "low" | "medium" | "high";

export interface SlashCommand {
  /** Primary trigger without leading slash, e.g. "model" */
  name: string;
  aliases?: string[];
  description: string;
  /** Argument placeholder shown in autocomplete */
  argsHint?: string;
  kind: SlashKind;
  /** Category for grouping */
  group: "session" | "agent" | "config" | "tools" | "spok";
  /** Example usage */
  example?: string;
  /** Risk label for command picker (high = needs caution). */
  risk?: SlashRisk;
}

export const GROK_SLASH_COMMANDS: SlashCommand[] = [
  // Session
  {
    name: "help",
    aliases: ["?"],
    description: "Show Grok CLI help or command usage",
    argsHint: "[command]",
    kind: "cli",
    group: "session",
    example: "/help agent",
  },
  {
    name: "continue",
    aliases: ["c"],
    description: "Continue the most recent session for this directory",
    argsHint: "[prompt]",
    kind: "prompt",
    group: "session",
    example: "/continue fix the failing tests",
  },
  {
    name: "resume",
    aliases: ["r"],
    description: "Resume a session by ID (or most recent if omitted)",
    argsHint: "[session-id] [prompt]",
    kind: "prompt",
    group: "session",
    example: "/resume",
  },
  {
    name: "single",
    aliases: ["p", "ask"],
    description: "Single-turn headless prompt (prints and exits)",
    argsHint: "<prompt>",
    kind: "prompt",
    group: "session",
    example: "/single summarize the README",
  },
  {
    name: "sessions",
    description: "List Grok sessions for discovery",
    kind: "cli",
    group: "session",
    example: "/sessions",
  },
  {
    name: "export",
    description: "Export active Spok session JSON (UI)",
    kind: "ui",
    group: "spok",
  },
  {
    name: "clear",
    description: "Clear traces/logs in this Spok workspace (keeps cwd)",
    kind: "ui",
    group: "spok",
  },
  {
    name: "stop",
    description: "Stop the currently running Grok process",
    kind: "ui",
    group: "spok",
  },

  // Agent / model
  {
    name: "model",
    aliases: ["m"],
    description: "Set model for subsequent prompts",
    argsHint: "<model-id>",
    kind: "flag",
    group: "agent",
    example: "/model grok-3",
  },
  {
    name: "models",
    description: "List available models",
    kind: "cli",
    group: "agent",
  },
  {
    name: "effort",
    aliases: ["reasoning-effort"],
    description: "Set reasoning effort",
    argsHint: "<low|medium|high|…>",
    kind: "flag",
    group: "agent",
    example: "/effort high",
  },
  {
    name: "max-turns",
    description: "Cap agent turns for the next run",
    argsHint: "<n>",
    kind: "flag",
    group: "agent",
  },
  {
    name: "agent",
    description: "Use a named agent or definition file",
    argsHint: "<name-or-path>",
    kind: "flag",
    group: "agent",
  },
  {
    name: "check",
    description: "Append self-verification loop (headless)",
    kind: "flag",
    group: "agent",
  },

  // Config / permissions
  {
    name: "always-approve",
    aliases: ["yolo", "auto-approve"],
    description: "Always approve tool executions (high risk — trusted workspaces only)",
    kind: "flag",
    group: "config",
    risk: "high",
  },
  {
    name: "permission-mode",
    description: "Set permission mode",
    argsHint: "<default|acceptEdits|auto|dontAsk|bypassPermissions|plan>",
    kind: "flag",
    group: "config",
    risk: "medium",
  },
  {
    name: "no-plan",
    description: "Disable plan mode for subsequent runs",
    kind: "flag",
    group: "config",
  },
  {
    name: "no-subagents",
    description: "Disable subagent spawning",
    kind: "flag",
    group: "config",
  },
  {
    name: "no-memory",
    description: "Disable cross-session memory",
    kind: "flag",
    group: "config",
  },
  {
    name: "debug",
    description: "Toggle debug logging for CLI runs",
    kind: "flag",
    group: "config",
  },
  {
    name: "inspect",
    description: "Show configuration Grok discovers for this directory",
    kind: "cli",
    group: "config",
  },
  {
    name: "version",
    aliases: ["v"],
    description: "Print Grok CLI version",
    kind: "cli",
    group: "config",
  },

  // Tools / platform
  {
    name: "login",
    description: "Sign in to Grok",
    kind: "cli",
    group: "tools",
  },
  {
    name: "logout",
    description: "Sign out and clear credentials",
    kind: "cli",
    group: "tools",
  },
  {
    name: "mcp",
    description: "MCP server management (passes remaining args to CLI)",
    argsHint: "[subcommand…]",
    kind: "cli",
    group: "tools",
    example: "/mcp list",
  },
  {
    name: "memory",
    description: "Manage cross-session memory",
    argsHint: "[subcommand…]",
    kind: "cli",
    group: "tools",
  },
  {
    name: "worktree",
    aliases: ["w"],
    description: "Start in a new git worktree (optional name)",
    argsHint: "[name] [prompt]",
    kind: "prompt",
    group: "tools",
    example: "/worktree feat-auth implement oauth",
  },
  {
    name: "plugin",
    description: "Manage plugins",
    argsHint: "[subcommand…]",
    kind: "cli",
    group: "tools",
  },
  {
    name: "update",
    description: "Check for Grok CLI updates",
    kind: "cli",
    group: "tools",
  },
  {
    name: "trace",
    description: "Export/upload session trace data via CLI",
    argsHint: "[args…]",
    kind: "cli",
    group: "tools",
  },
];

export interface ParsedSlash {
  isSlash: boolean;
  command?: SlashCommand;
  /** raw name without slash */
  name?: string;
  /** rest of line after command name */
  rest: string;
  /** full original text */
  raw: string;
}

export function parseSlashInput(text: string): ParsedSlash {
  const raw = text;
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) {
    return { isSlash: false, rest: text, raw };
  }
  const body = trimmed.slice(1);
  const m = body.match(/^([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!m) {
    return { isSlash: true, name: "", rest: "", raw };
  }
  const name = m[1].toLowerCase();
  const rest = (m[2] ?? "").trim();
  const command = resolveSlashCommand(name);
  return { isSlash: true, command, name, rest, raw };
}

export function resolveSlashCommand(name: string): SlashCommand | undefined {
  const n = name.toLowerCase();
  return GROK_SLASH_COMMANDS.find(
    (c) => c.name === n || c.aliases?.some((a) => a.toLowerCase() === n)
  );
}

/** Filter commands for autocomplete given the text after `/` */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().trim();
  if (!q) return GROK_SLASH_COMMANDS;
  return GROK_SLASH_COMMANDS.filter((c) => {
    if (c.name.includes(q)) return true;
    if (c.aliases?.some((a) => a.includes(q))) return true;
    if (c.description.toLowerCase().includes(q)) return true;
    return false;
  }).sort((a, b) => {
    const as = a.name.startsWith(q) ? 0 : 1;
    const bs = b.name.startsWith(q) ? 0 : 1;
    if (as !== bs) return as - bs;
    return a.name.localeCompare(b.name);
  });
}

/** Sticky flags carried across prompts in a workspace */
export interface GrokRunFlags {
  model?: string;
  effort?: string;
  maxTurns?: number;
  agent?: string;
  alwaysApprove: boolean;
  permissionMode?: string;
  noPlan: boolean;
  noSubagents: boolean;
  noMemory: boolean;
  debug: boolean;
  check: boolean;
  worktree?: string;
  continueSession: boolean;
  resumeId?: string | true;
}

/**
 * Safe defaults for Grok CLI sticky flags.
 * `alwaysApprove` is opt-in — users must enable auto-approve deliberately.
 */
export function defaultGrokFlags(): GrokRunFlags {
  return {
    alwaysApprove: false,
    noPlan: false,
    noSubagents: false,
    noMemory: false,
    debug: false,
    check: false,
    continueSession: false,
  };
}

/** Human-readable permission mode for status chips / selectors. */
export function permissionModeLabel(flags: GrokRunFlags): string {
  if (flags.alwaysApprove) return "Always approve";
  if (flags.permissionMode) return flags.permissionMode;
  return "manual";
}

/** Grouped slash commands for the structured command picker. */
export function slashCommandsByGroup(): Record<
  SlashCommand["group"],
  SlashCommand[]
> {
  const groups: Record<SlashCommand["group"], SlashCommand[]> = {
    session: [],
    agent: [],
    config: [],
    tools: [],
    spok: [],
  };
  for (const c of GROK_SLASH_COMMANDS) {
    groups[c.group].push(c);
  }
  return groups;
}

export function slashRiskLabel(risk?: SlashRisk): string | null {
  if (!risk || risk === "low") return null;
  if (risk === "medium") return "caution";
  return "high risk";
}

export type ResolvedRun =
  | {
      type: "prompt";
      prompt: string;
      args: string[];
      label: string;
    }
  | {
      type: "cli";
      args: string[];
      label: string;
    }
  | {
      type: "ui";
      action: "help" | "clear" | "stop" | "export" | "set-flag" | "show-help";
      message?: string;
      flags?: Partial<GrokRunFlags>;
    };

export function baseFlagsArgs(flags: GrokRunFlags): string[] {
  const args: string[] = [];
  if (flags.model) args.push("-m", flags.model);
  if (flags.effort) args.push("--reasoning-effort", flags.effort);
  if (flags.maxTurns != null) args.push("--max-turns", String(flags.maxTurns));
  if (flags.agent) args.push("--agent", flags.agent);
  if (flags.alwaysApprove) args.push("--always-approve");
  if (flags.permissionMode) args.push("--permission-mode", flags.permissionMode);
  if (flags.noPlan) args.push("--no-plan");
  if (flags.noSubagents) args.push("--no-subagents");
  if (flags.noMemory) args.push("--no-memory");
  if (flags.debug) args.push("--debug");
  if (flags.check) args.push("--check");
  if (flags.worktree) args.push("-w", flags.worktree);
  if (flags.continueSession) args.push("-c");
  if (flags.resumeId === true) args.push("-r");
  else if (typeof flags.resumeId === "string" && flags.resumeId) {
    args.push("-r", flags.resumeId);
  }
  // Prefer streamable machine output when available
  args.push("--output-format", "streaming-json");
  return args;
}

/**
 * Swap a headless text prompt (`-p` / `--single`) for `--prompt-file`.
 * Used when attachments are delivered as ACP content-block JSON.
 */
export function replacePromptWithFile(
  args: string[],
  promptFilePath: string
): string[] {
  const out = [...args];
  const pIdx = out.findIndex((a) => a === "-p" || a === "--single");
  if (pIdx >= 0) {
    out.splice(pIdx, out[pIdx + 1] != null ? 2 : 1, "--prompt-file", promptFilePath);
    return out;
  }
  const pfIdx = out.findIndex((a) => a === "--prompt-file");
  if (pfIdx >= 0) {
    if (pfIdx + 1 < out.length) out[pfIdx + 1] = promptFilePath;
    else out.push(promptFilePath);
    return out;
  }
  out.push("--prompt-file", promptFilePath);
  return out;
}

/**
 * Resolve user input + sticky flags into a runnable invocation.
 */
export function resolveRun(
  input: string,
  flags: GrokRunFlags
): ResolvedRun {
  const text = input.trim();
  if (!text) {
    return { type: "ui", action: "show-help", message: "Enter a prompt or /command" };
  }

  const parsed = parseSlashInput(text);

  if (!parsed.isSlash) {
    return {
      type: "prompt",
      prompt: text,
      args: [...baseFlagsArgs(flags), "-p", text],
      label: text.slice(0, 80),
    };
  }

  const cmd = parsed.command;
  const rest = parsed.rest;

  if (!cmd) {
    // Unknown slash — treat remainder after first token as freeform if empty name
    return {
      type: "ui",
      action: "show-help",
      message: `Unknown command /${parsed.name}. Type /help for commands.`,
    };
  }

  switch (cmd.name) {
    case "help":
      if (!rest) {
        return {
          type: "ui",
          action: "show-help",
          message: "Slash commands — type / to search. Common: /continue /model /always-approve /sessions /inspect",
        };
      }
      return {
        type: "cli",
        args: ["help", ...rest.split(/\s+/).filter(Boolean)],
        label: `help ${rest}`,
      };

    case "clear":
      return { type: "ui", action: "clear" };
    case "stop":
      return { type: "ui", action: "stop" };
    case "export":
      return { type: "ui", action: "export" };

    case "model":
      if (!rest) {
        return {
          type: "ui",
          action: "show-help",
          message: flags.model
            ? `Current model: ${flags.model}. Usage: /model <id>`
            : "Usage: /model <model-id>",
        };
      }
      return {
        type: "ui",
        action: "set-flag",
        flags: { model: rest.split(/\s+/)[0] },
        message: `Model set to ${rest.split(/\s+/)[0]}`,
      };

    case "effort":
      if (!rest) {
        return {
          type: "ui",
          action: "show-help",
          message: "Usage: /effort <level>",
        };
      }
      return {
        type: "ui",
        action: "set-flag",
        flags: { effort: rest.split(/\s+/)[0] },
        message: `Reasoning effort: ${rest.split(/\s+/)[0]}`,
      };

    case "max-turns": {
      const n = parseInt(rest, 10);
      if (!Number.isFinite(n)) {
        return {
          type: "ui",
          action: "show-help",
          message: "Usage: /max-turns <n>",
        };
      }
      return {
        type: "ui",
        action: "set-flag",
        flags: { maxTurns: n },
        message: `Max turns: ${n}`,
      };
    }

    case "agent":
      if (!rest) {
        return {
          type: "ui",
          action: "show-help",
          message: "Usage: /agent <name-or-path>",
        };
      }
      return {
        type: "ui",
        action: "set-flag",
        flags: { agent: rest },
        message: `Agent: ${rest}`,
      };

    case "always-approve":
      return {
        type: "ui",
        action: "set-flag",
        flags: { alwaysApprove: !flags.alwaysApprove },
        message: `always-approve: ${!flags.alwaysApprove}`,
      };

    case "permission-mode":
      if (!rest) {
        return {
          type: "ui",
          action: "show-help",
          message:
            "Usage: /permission-mode <default|acceptEdits|auto|dontAsk|bypassPermissions|plan>",
        };
      }
      return {
        type: "ui",
        action: "set-flag",
        flags: { permissionMode: rest.split(/\s+/)[0] },
        message: `permission-mode: ${rest.split(/\s+/)[0]}`,
      };

    case "no-plan":
      return {
        type: "ui",
        action: "set-flag",
        flags: { noPlan: !flags.noPlan },
        message: `no-plan: ${!flags.noPlan}`,
      };
    case "no-subagents":
      return {
        type: "ui",
        action: "set-flag",
        flags: { noSubagents: !flags.noSubagents },
        message: `no-subagents: ${!flags.noSubagents}`,
      };
    case "no-memory":
      return {
        type: "ui",
        action: "set-flag",
        flags: { noMemory: !flags.noMemory },
        message: `no-memory: ${!flags.noMemory}`,
      };
    case "debug":
      return {
        type: "ui",
        action: "set-flag",
        flags: { debug: !flags.debug },
        message: `debug: ${!flags.debug}`,
      };
    case "check":
      return {
        type: "ui",
        action: "set-flag",
        flags: { check: !flags.check },
        message: `check: ${!flags.check}`,
      };

    case "continue": {
      const nextFlags = { ...flags, continueSession: true, resumeId: undefined };
      const prompt = rest || "Continue from where we left off.";
      return {
        type: "prompt",
        prompt,
        args: [...baseFlagsArgs(nextFlags), "-p", prompt],
        label: `/continue ${prompt}`.slice(0, 80),
      };
    }

    case "resume": {
      const parts = rest.split(/\s+/).filter(Boolean);
      let resumeId: string | true = true;
      let prompt = "Continue this session.";
      if (parts.length) {
        // UUID-ish or first token as id
        if (/^[0-9a-f-]{8,}$/i.test(parts[0])) {
          resumeId = parts[0];
          prompt = parts.slice(1).join(" ") || prompt;
        } else {
          prompt = parts.join(" ");
        }
      }
      const nextFlags: GrokRunFlags = {
        ...flags,
        resumeId,
        continueSession: false,
      };
      return {
        type: "prompt",
        prompt,
        args: [...baseFlagsArgs(nextFlags), "-p", prompt],
        label: `/resume ${prompt}`.slice(0, 80),
      };
    }

    case "single": {
      if (!rest) {
        return {
          type: "ui",
          action: "show-help",
          message: "Usage: /single <prompt>",
        };
      }
      return {
        type: "prompt",
        prompt: rest,
        args: [...baseFlagsArgs(flags), "-p", rest],
        label: rest.slice(0, 80),
      };
    }

    case "worktree": {
      const parts = rest.split(/\s+/).filter(Boolean);
      const wt = parts[0] || "spok";
      const prompt = parts.slice(1).join(" ") || "Start work in this worktree.";
      const nextFlags = { ...flags, worktree: wt };
      return {
        type: "prompt",
        prompt,
        args: [...baseFlagsArgs(nextFlags), "-p", prompt],
        label: `/worktree ${wt}`,
      };
    }

    case "sessions":
      return { type: "cli", args: ["sessions"], label: "sessions" };
    case "models":
      return { type: "cli", args: ["models"], label: "models" };
    case "inspect":
      return { type: "cli", args: ["inspect"], label: "inspect" };
    case "version":
      return { type: "cli", args: ["version"], label: "version" };
    case "login":
      return { type: "cli", args: ["login"], label: "login" };
    case "logout":
      return { type: "cli", args: ["logout"], label: "logout" };
    case "mcp":
      return {
        type: "cli",
        args: ["mcp", ...rest.split(/\s+/).filter(Boolean)],
        label: `mcp ${rest}`.trim(),
      };
    case "memory":
      return {
        type: "cli",
        args: ["memory", ...rest.split(/\s+/).filter(Boolean)],
        label: `memory ${rest}`.trim(),
      };
    case "plugin":
      return {
        type: "cli",
        args: ["plugin", ...rest.split(/\s+/).filter(Boolean)],
        label: `plugin ${rest}`.trim(),
      };
    case "update":
      return { type: "cli", args: ["update"], label: "update" };
    case "trace":
      return {
        type: "cli",
        args: ["trace", ...rest.split(/\s+/).filter(Boolean)],
        label: `trace ${rest}`.trim(),
      };

    default:
      return {
        type: "ui",
        action: "show-help",
        message: `Unhandled /${cmd.name}`,
      };
  }
}
