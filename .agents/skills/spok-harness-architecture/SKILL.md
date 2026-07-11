---
name: spok-harness-architecture
description: Use when planning or implementing Spok Grok Build harness roadmap work, agent lifecycle and mission-control UX, session/job/worktree flows, Git handoff, extension architecture, automations, native-runtime migration, or cross-cutting product features. Trigger for docs/HARNESS_AUDIT_AND_ROADMAP.md, app-shell workflow, roadmap milestones, or multi-module harness architecture.
---

# Spok Harness Architecture

## Start Here

Read `docs/HARNESS_AUDIT_AND_ROADMAP.md` before roadmap or cross-cutting product work. Frame the change as one part of Spok's core loop:

1. trust/open repository;
2. launch with an explicit policy;
3. execute in isolation when concurrent or unattended;
4. monitor progress and approvals;
5. review trace-linked changes and validation evidence;
6. hand off to Git or continue the agent;
7. archive and clean up intentionally.

Prefer completing a thin vertical slice of this loop over adding a disconnected surface.

## Workflow

1. Name the roadmap milestone, user outcome, and exit criteria.
2. Map the durable identities and transitions before UI work: repository/workspace, job, session, run/turn, worktree/branch, approval, validation result, and terminal outcome.
3. Read only the files that own the selected workflow, then follow their direct contracts:
   - shell and inbox: `src/components/shell/*`, `src/lib/session-inbox.ts`;
   - live run/composer: `src/components/session/workspace.tsx`, `prompt-composer.tsx`, `src/lib/harness.ts`;
   - durable session state: `src/lib/store.ts`, `types.ts`, `session-store-fs.ts`, `session-hydrate.ts`;
   - jobs/automation: `src/lib/background-runner.ts`, `src/lib/automation/*`;
   - review/validation: `src/components/diff/*`, `src/lib/review-*`, `validation-*`;
   - runtime API: `src/server/*` plus thin `src/app/api/*` adapters;
   - native migration: `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md` and runtime capability contracts.
4. Define failure behavior before the happy path. Never silently degrade isolation, policy, durability, or review evidence.
5. Keep provider parsing behind adapters and keep privileged runtime logic out of presentation components.
6. Use `$spok-secure-runtime` for process, filesystem, Git/worktree, Tauri/native capabilities, permissions, secrets, approvals, or audit changes.
7. Use `$spok-stream-contracts` for parser, replay, event schema, raw-event preservation, diff-linking, or fixture changes.
8. Add focused tests for the main transition and at least one failure/recovery path. Run the smallest suite first, then broader verification in proportion to risk.
9. Close the work by updating the roadmap's current status and cleaning related docs. Remove replaced plans and completed checklists instead of accumulating historical clutter.

## Architecture Rules

- Treat Spok as a privileged local desktop harness, not a normal untrusted web app.
- Review readiness—not process exit—is the meaningful success state.
- Concurrent/background work is worktree-isolated by default; failure to establish isolation means no process launch.
- Prefer durable, versioned run/event records over UI-only coordination state.
- A session row should explain what is running, where, what needs attention, and the next safe action.
- Make permission and approval state visible anywhere the user can start, stop, continue, validate, hand off, or clean up work.
- Preserve raw provider events beside normalized state so regressions remain diagnosable.
- Keep provider-specific parsing behind adapter boundaries; do not bake Grok CLI quirks into core UI contracts.
- Do not remove dirty or unpushed worktrees by default. Preview destructive scope and require explicit confirmation.
- Add extension points only for real workflows, with scope, ordering, permissions, audit, disable, and recovery behavior.
- Stabilize shared runtime contracts before duplicating a feature in the native Windows UI.

## Parallel Work

When parallel agents are explicitly requested, split by ownership boundary (for example runtime, orchestration, review UI, documentation), name excluded files, and integrate through existing contracts. Avoid assigning two agents to the same high-churn file. The coordinating agent owns final verification and documentation truth.

## Definition Of Done

- The change advances a named roadmap outcome and its user-visible next action is clear.
- Durable state survives restart/import/export, or the product explicitly surfaces why it cannot.
- Privileged actions have trust, policy, approval, containment, redaction, and audit behavior as applicable.
- Isolation and cleanup failure modes are safe and actionable.
- Performance-sensitive UI derives from stable fingerprints/selectors rather than high-frequency whole-session updates.
- Focused tests cover success plus one denial, failure, cancellation, or recovery path.
- Relevant unit/build/E2E checks pass in proportion to the change.
- Roadmap and active docs describe current reality; obsolete task trackers are removed.
