---
name: spok-harness-architecture
description: Use when planning or implementing Spok's Grok Build roadmap, Spok-led long-project missions, multi-agent orchestration, mission-control UX, session/job/worktree flows, performance, Git handoff, automations, runtime migration, or cross-cutting product features.
---

# Spok Harness Architecture

## Start Here

Read `docs/HARNESS_AUDIT_AND_ROADMAP.md` and `docs/UX_AUDIT.md` before roadmap, UX, or cross-cutting product work. Spok is the accountable leader of long-running Grok 4.5 projects; agents contribute bounded work and never become the source of product truth. Frame the change as one part of Spok's core loop:

1. trust/open repository;
2. define an outcome, definition of done, constraints, and explicit policy;
3. let Spok plan milestones/work items and delegate only independent, bounded work;
4. execute in isolation when concurrent or unattended;
5. monitor dependencies, progress, approvals, budgets, failures, and checkpoints;
6. reconcile agent reports with trace-linked changes and validation evidence;
7. hand off to Git, repair/continue the mission, or archive and clean up intentionally.

Prefer completing a thin vertical slice of this loop over adding a disconnected surface. Missions is the user-facing core destination; `enterprise` remains an internal migration identifier only. Put operational evidence and the next safe action before optional visualization.

Until the active audit closes, P0/P1 recoverability, lifecycle intent, state coherence, authority visibility, accessibility, and adaptive-layout work outranks new Missions orchestration breadth, Automate, Extend, native parity, or extension breadth.

## Workflow

1. Name the roadmap milestone, user outcome, scale/performance budget, and exit criteria.
2. Reproduce or inspect the current interaction when practical. Record the visible state, available next action, failure/recovery behavior, keyboard semantics, and compact/wide behavior; do not infer UX quality from component presence or process exit.
3. Map the durable identities and transitions before UI work: project, mission, milestone, work item, dependency, checkpoint, repository/workspace, job, session, agent run/turn, worktree/branch, authority/resource budget, approval, validation result, review readiness, handoff, and terminal outcome. Reject contradictory combinations.
4. Read only the files that own the selected workflow, then follow their direct contracts:
   - shell and inbox: `src/components/shell/*`, `src/lib/session-inbox.ts`;
   - live run/composer: `src/components/session/workspace.tsx`, `prompt-composer.tsx`, `src/lib/harness.ts`;
   - durable session state: `src/lib/store.ts`, `types.ts`, `session-store-fs.ts`, `session-hydrate.ts`;
   - jobs/automation: `src/lib/background-runner.ts`, `src/lib/automation/*`;
   - Spok-led missions: `src/lib/enterprise.ts` and `src/components/enterprise/*` during migration, then versioned mission-domain modules;
   - review/validation: `src/components/diff/*`, `src/lib/review-*`, `validation-*`;
   - runtime API: `src/server/*` plus thin `src/app/api/*` adapters;
   - native migration: `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md` and runtime capability contracts.
5. Define failure behavior before the happy path. Loading must time out into an actionable state. Agent failure, stall, replacement, retry, budget exhaustion, missing checkpoint, or contradictory reports must not erase history or advance dependencies. Never silently degrade isolation, policy, durability, review evidence, or client/runtime connectivity.
6. Define intent and scope for lifecycle actions. Client hide, disconnect, unload, freeze, navigation, or layout transition is never intent to stop work. Global/destructive actions need a complete impact preview.
7. Keep provider parsing behind adapters and keep privileged runtime logic out of presentation components.
8. Design hot/cold data flow before high-volume UI work. Subscribe through stable projections/fingerprints, virtualize history, checkpoint long missions, and prove the roadmap budget with representative fixtures.
9. Use `$spok-secure-runtime` for process, filesystem, Git/worktree, Tauri/native capabilities, delegated authority/budgets, permissions, secrets, approvals, trust, cancellation, cleanup, or audit changes.
10. Use `$spok-stream-contracts` for parser, replay, event schema, raw-event preservation, agent/mission provenance, diff-linking, terminal-state provenance, checkpoint materialization, or fixture changes.
11. Add focused tests for the main transition and at least one failure/recovery path. Required UI E2E must fail on missing/blocked UI rather than conditionally skip. Run the smallest suite first, then broader verification in proportion to risk.
12. Close the work by updating the roadmap and UX audit status, then cleaning related docs. Remove replaced plans and completed checklists instead of accumulating historical clutter.

## Architecture Rules

- Treat Spok as a privileged local desktop harness, not a normal untrusted web app.
- Treat Spok—not any child agent—as owner of the mission plan, dependency transitions, synthesis, readiness claim, and next action.
- Requested specialists are plan metadata. Show them as running only after provider evidence creates a real lane.
- Parallelize only work items whose dependencies, repository locks, isolation, authority, and budgets allow it.
- Long missions reopen checkpoint-first. Append-only cold evidence must not sit on the hot render path or require full replay for first useful content.
- Review readiness—not process exit—is the meaningful success state.
- Concurrent/background work is worktree-isolated by default; failure to establish isolation means no process launch.
- Prefer durable, versioned run/event records over UI-only coordination state.
- A session row should explain what is running, where, what needs attention, and the next safe action.
- Project durable session/job records through a versioned lifecycle presentation contract. Keep terminal work separate from sessions ready for another turn, show the reason's owning layer, expose one primary next action, and render contradictory claims as diagnostics.
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
- Missions is a durable destination, Run is a session context, and review/handoff is evidence workflow. Do not expose internal “Enterprise” vocabulary as the product hierarchy.

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
- Representative 100-job/10-lane/10k-hot-event fixtures meet the roadmap budgets, and longer history remains bounded through checkpoints and hot/cold storage.
- Focused tests cover success plus one denial, failure, cancellation, or recovery path; required E2E assertions do not skip when UI is absent.
- Relevant unit/build/E2E checks pass in proportion to the change.
- Roadmap and active docs describe current reality; obsolete task trackers are removed.
