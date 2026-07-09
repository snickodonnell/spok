# Spok Feature Areas

Use this reference when choosing where a roadmap item belongs.

## Core Surfaces

- Workspace shell: `src/components/session/workspace.tsx`
- Prompt composer and slash commands: `src/components/session/prompt-composer.tsx`, `src/lib/grok-commands.ts`
- Trace UI: `src/components/trace/*`
- Diff UI: `src/components/diff/*`
- Session state: `src/lib/store.ts`, `src/lib/types.ts`
- Harness runtime: `src/lib/harness.ts`, `src/app/api/session/start/route.ts`
- Git bridge: `src/app/api/session/git-diff/route.ts`, `src/hooks/use-git-watch.ts`
- Filesystem bridge: `src/app/api/fs/browse/route.ts`
- Desktop wrapper: `src-tauri/*`

## Roadmap Routing

- Runtime, process lifecycle, cwd, env, filesystem, git route, Tauri, permissions, CSP, or secrets -> use `$spok-secure-runtime`.
- Parser, stream schema, raw events, coalescing, replay, fixtures, file-change links, or diff contracts -> use `$spok-stream-contracts`.
- Session UX, command palette, roadmap sequencing, worktrees, automations, skills/plugins/MCP/hook product shape, or cross-module architecture -> use this skill.

## Product Principles

- Start with the actual harness workspace, not a landing page.
- Prefer one durable data model that can drive live mode, import, replay, and tests.
- Make agent autonomy legible: show cwd, branch/worktree, provider, model, permission mode, active process, and pending approvals.
- Keep risky actions reversible or explicitly approved.
- Do not add an extension surface without discovery, trust, configuration, execution, and observability plans.
