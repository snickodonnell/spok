---
name: spok-harness-architecture
description: Use when planning or implementing Spok Grok Build harness roadmap work, agent lifecycle and mission-control UX, session/job/worktree flows, Git handoff, extension architecture, automations, native-runtime migration, or cross-cutting product features. Trigger for docs/HARNESS_AUDIT_AND_ROADMAP.md, app-shell workflow, roadmap milestones, or multi-module harness architecture.
---

# Spok Harness Architecture

## Start Here

Read `docs/HARNESS_AUDIT_AND_ROADMAP.md` and `docs/UX_AUDIT.md` before roadmap, UX, or cross-cutting product work. Frame the change as one part of Spok's core loop:

1. trust/open repository;
2. launch with an explicit policy;
3. execute in isolation when concurrent or unattended;
4. monitor progress and approvals;
5. review trace-linked changes and validation evidence;
6. hand off to Git or continue the agent;
7. archive and clean up intentionally.

Prefer completing a thin vertical slice of this loop over adding a disconnected surface.

Until the active audit closes, P0/P1 recoverability, lifecycle intent, state coherence, authority visibility, accessibility, and adaptive-layout work outranks new Enterprise, Automate, Extend, native-parity, or extension breadth.

## Workflow

1. Name the roadmap milestone, user outcome, and exit criteria.
2. Reproduce or inspect the current interaction when practical. Record the visible state, available next action, failure/recovery behavior, keyboard semantics, and compact/wide behavior; do not infer UX quality from component presence or process exit.
3. Map the durable identities and transitions before UI work: repository/workspace, job, session, run/turn, worktree/branch, approval, validation result, review readiness, handoff, and terminal outcome. Reject contradictory combinations.
4. Read only the files that own the selected workflow, then follow their direct contracts:
   - shell and inbox: `src/components/shell/*`, `src/lib/session-inbox.ts`;
   - live run/composer: `src/components/session/workspace.tsx`, `prompt-composer.tsx`, `src/lib/harness.ts`;
   - durable session state: `src/lib/store.ts`, `types.ts`, `session-store-fs.ts`, `session-hydrate.ts`;
   - jobs/automation: `src/lib/background-runner.ts`, `src/lib/automation/*`;
   - review/validation: `src/components/diff/*`, `src/lib/review-*`, `validation-*`;
   - runtime API: `src/server/*` plus thin `src/app/api/*` adapters;
   - native migration: `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md` and runtime capability contracts.
5. Define failure behavior before the happy path. Loading must time out into an actionable state. Never silently degrade isolation, policy, durability, review evidence, or client/runtime connectivity.
6. Define intent and scope for lifecycle actions. Client hide, disconnect, unload, freeze, navigation, or layout transition is never intent to stop work. Global/destructive actions need a complete impact preview.
7. Keep provider parsing behind adapters and keep privileged runtime logic out of presentation components.
8. Use `$spok-secure-runtime` for process, filesystem, Git/worktree, Tauri/native capabilities, permissions, secrets, approvals, trust, cancellation, cleanup, or audit changes.
9. Use `$spok-stream-contracts` for parser, replay, event schema, raw-event preservation, diff-linking, terminal-state provenance, or fixture changes.
10. Add focused tests for the main transition and at least one failure/recovery path. Required UI E2E must fail on missing/blocked UI rather than conditionally skip. Run the smallest suite first, then broader verification in proportion to risk.
11. Close the work by updating the roadmap and UX audit status, then cleaning related docs. Remove replaced plans and completed checklists instead of accumulating historical clutter.

## Architecture Rules

- Treat Spok as a privileged local desktop harness, not a normal untrusted web app.
- Review readiness—not process exit—is the meaningful success state.
- Concurrent/background work is worktree-isolated by default; failure to establish isolation means no process launch.
- Prefer durable, versioned run/event records over UI-only coordination state.
- A session row should explain what is running, where, what needs attention, and the next safe action.
- Primary navigation represents durable destinations. Tabs represent context within a destination; dialogs are short, transient tasks and must return focus/context on close.
- Process exit, task outcome, review readiness, and Git handoff are separate states with visible provenance. Never render optimistic success from one layer while another requires attention.
- Make permission and approval state visible anywhere the user can start, stop, continue, validate, hand off, or clean up work.
- Restore/import is authority-neutral. Selecting a repository is not the same as trusting it, and restoring metadata must not re-grant trust.
- Phone and secondary clients are monitors/controllers, not process owners. Disconnecting them must not stop host work.
- Preserve raw provider events beside normalized state so regressions remain diagnosable.
- Keep provider-specific parsing behind adapter boundaries; do not bake Grok CLI quirks into core UI contracts.
- Do not remove dirty or unpushed worktrees by default. Preview destructive scope and require explicit confirmation.
- Add extension points only for real workflows, with scope, ordering, permissions, audit, disable, and recovery behavior.
- Stabilize shared runtime contracts before duplicating a feature in the native Windows UI.
- Operational content must meet AA contrast and remain usable by keyboard, screen reader, reduced motion, high contrast, 200% zoom, and compact/standard/wide layouts.

## Parallel Work

When parallel agents are explicitly requested, split by ownership boundary (for example runtime, orchestration, review UI, documentation), name excluded files, and integrate through existing contracts. Avoid assigning two agents to the same high-churn file. The coordinating agent owns final verification and documentation truth.

## Definition Of Done

- The change advances a named roadmap outcome and its user-visible next action is clear.
- Direct interaction review confirms the happy path plus loading, empty, denied, failed, stale/disconnected, and recovery states that apply.
- Durable state survives restart/import/export, or the product explicitly surfaces why it cannot.
- Privileged actions have trust, policy, approval, containment, redaction, and audit behavior as applicable.
- Isolation and cleanup failure modes are safe and actionable.
- No passive client lifecycle event changes run state, and no restore/import path changes authority.
- Visible status uses the canonical state model; process, task, review, and handoff labels cannot contradict.
- Core actions have correct selected/focus semantics and remain usable at 200% zoom and compact width.
- Performance-sensitive UI derives from stable fingerprints/selectors rather than high-frequency whole-session updates.
- Focused tests cover success plus one denial, failure, cancellation, or recovery path; required E2E assertions do not skip when UI is absent.
- Relevant unit/build/E2E checks pass in proportion to the change.
- Roadmap and active docs describe current reality; obsolete task trackers are removed.
