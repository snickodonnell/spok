---
name: spok-harness-architecture
description: Use when planning or implementing Spok Grok Build harness roadmap work, Codex/Claude-style agent UX, session lifecycle, Git/worktree flows, extension architecture, automations, or cross-cutting product features. Trigger for tasks touching docs/HARNESS_AUDIT_AND_ROADMAP.md, app shell workflow, roadmap phases, or multi-module harness architecture.
---

# Spok Harness Architecture

## Quick Start

Read `docs/HARNESS_AUDIT_AND_ROADMAP.md` before making roadmap or product-architecture changes. Use this skill to keep implementation aligned with the audit, avoid feature drift, and sequence work in safe milestones.

## Workflow

1. Identify the roadmap phase and user workflow.
2. Read the files that own the workflow before editing:
   - `src/components/session/workspace.tsx`
   - `src/components/session/prompt-composer.tsx`
   - `src/components/shell/app-shell.tsx`
   - `src/lib/store.ts`
   - `src/lib/types.ts`
   - `src/lib/harness.ts`
3. Define the state/event contract before changing UI.
4. Keep privileged runtime changes out of product UI changes unless the task explicitly requires both.
5. Use `$spok-secure-runtime` for process, filesystem, Git, Tauri, permissions, or sandbox work.
6. Use `$spok-stream-contracts` for parser, replay, event schema, diff-linking, or fixture work.
7. Add or update focused tests for the behavior, then run the smallest meaningful verification command.
8. Update `docs/HARNESS_AUDIT_AND_ROADMAP.md` when a roadmap item is completed, replaced, or intentionally deferred.

## Architecture Rules

- Treat Spok as a privileged local desktop harness, not a normal untrusted web app.
- Prefer durable event logs and replayable state over UI-only state.
- Keep provider-specific parsing behind adapter boundaries; do not bake Grok-only assumptions into core session UI.
- Make permission state visible anywhere the user can start, stop, approve, or continue work.
- Keep worktree/background-agent features isolated from the user's local checkout by default.
- Add extension points only where a real workflow exists: skills, hooks, MCP, plugins, custom agents, or automations.

## Definition Of Done

- The feature has a clear place in the roadmap.
- State survives import/export or has a documented reason not to.
- The UI exposes enough context for the user to understand what the agent can do next.
- Privileged actions have an approval, policy, or trust boundary.
- Tests or fixtures cover the main behavior and at least one failure mode.
