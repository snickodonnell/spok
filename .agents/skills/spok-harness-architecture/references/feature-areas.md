# Spok Feature Areas

Use this reference when choosing where a roadmap item belongs.

## Core Surfaces

- Workspace shell: `src/components/session/workspace.tsx`
- Shell startup/recovery: `src/hooks/use-session-hydration.ts`, `src/components/shell/desktop-shell.tsx`, `src/components/mobile/mobile-shell.tsx`
- Product navigation and state ontology: `src/lib/product-modes.ts`, `src/lib/session-inbox.ts`, `src/lib/store.ts`, `src/components/shell/topbar.tsx`, `src/components/shell/sidebar.tsx`, `src/components/shell/session-inbox.tsx`
- Spok-led Missions (migration implementation): `src/lib/enterprise.ts`, `src/components/enterprise/enterprise-screen.tsx`, `src/lib/automation/types.ts`, `src/lib/automation/subagent-lanes.ts`
- Phone lifecycle and control: `src/hooks/use-mobile-session-lifecycle.ts`, `src/hooks/use-host-session-sync.ts`, `src/components/mobile/*`
- Prompt composer and slash commands: `src/components/session/prompt-composer.tsx`, `src/lib/grok-commands.ts`
- Trace UI: `src/components/trace/*`
- Diff UI: `src/components/diff/*`
- Session/mission state: `src/lib/store.ts`, `src/lib/types.ts`, versioned automation and future mission-domain records
- Harness runtime: `src/lib/harness.ts`, `src/app/api/session/start/route.ts`
- Git bridge: `src/app/api/session/git-diff/route.ts`, `src/hooks/use-git-watch.ts`
- Filesystem bridge: `src/app/api/fs/browse/route.ts`
- Desktop wrapper: `src-tauri/*`

## Roadmap Routing

- Runtime, process lifecycle, cwd, env, filesystem, git route, Tauri, permissions, CSP, or secrets -> use `$spok-secure-runtime`.
- Parser, stream schema, raw events, coalescing, replay, fixtures, file-change links, or diff contracts -> use `$spok-stream-contracts`.
- Grok CLI capability/version, argv, prompt files/JSON, sessions, leader backend, worktree commands, report schema, diagnostics, or CLI cleanup -> use `$spok-grok-cli-operations`.
- Mission decomposition, work-item receipts, dependency scheduling, context/token budgets, provider-lane truth, retries, leader synthesis, or role-attributed handoff -> use `$spok-agent-orchestration`.
- Missions, Spok leadership, project/milestone/work-item/checkpoint contracts, session UX, roadmap sequencing, worktrees, automations, performance, skills/plugins/MCP/hook product shape, or cross-module architecture -> use this skill.
- UX audits, startup/loading/recovery, navigation hierarchy, status vocabulary, next-action design, accessibility, or responsive/adaptive behavior -> use this skill; add `$spok-secure-runtime` when lifecycle authority/trust/cancellation is involved and `$spok-stream-contracts` when state provenance comes from events.

## Product Principles

- Start with the actual harness workspace, not a landing page.
- Make Missions the product core: outcome, plan/checkpoint, blocker, evidence gap, budget pressure, and next action precede team decoration.
- Spok owns planning, delegation, integration, validation, and readiness; agent reports are evidence, not authority.
- Prefer one durable data model that can drive live mode, import, replay, and tests.
- Make agent autonomy legible: show cwd, branch/worktree, provider, model, permission mode, active process, and pending approvals.
- Separate process state, task outcome, review readiness, and handoff. Every surface must derive from the same legal transition model and show provenance for exceptions.
- Treat the inbox as a versioned projection rather than another durable authority: distinguish ready, active, review-ready, terminal, and diagnostic states; give job-only records a real detail target; and test contradictory session/job outcomes explicitly.
- Never treat client disconnect/hide as stop intent or session restore/import as trust intent.
- Keep risky actions reversible or explicitly approved.
- Prefer durable destinations over modal control centers; dialogs are for short scoped decisions, not fleet/review/extension workspaces.
- Meet keyboard, screen-reader, AA contrast, 200% zoom, and compact/standard/wide layout requirements before calling a surface complete.
- Do not add an extension surface without discovery, trust, configuration, execution, and observability plans.
- For long projects, keep a bounded hot projection and checkpoint-first restore; never subscribe the whole shell to raw high-frequency mission/session state.
