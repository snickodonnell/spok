# Spok Product And Development Roadmap

Last updated: 2026-07-13

This is the product and engineering source of truth for Spok. Completed implementation detail belongs in code, tests, and Git history. `docs/UX_AUDIT.md` is the active interaction-remediation contract; this document owns product direction and delivery order.

## North Star

Spok will be the most useful, user-friendly, and performant harness in the world for Grok Build (Grok 4.5), especially for projects that take many agents, many turns, and many hours or days to finish.

Spok is not a themed terminal or a passive dashboard. Spok is the accountable leader of a Grok engineering team. A user gives Spok an outcome, constraints, and authority. Spok plans the work, delegates bounded assignments to real Grok subagents, watches dependencies and budgets, resolves or escalates blockers, integrates the results, gathers validation evidence, and keeps the project resumable until the user accepts the outcome.

The product promise is simple: **state the goal, understand the plan, leave safely, return to truthful progress, and review an evidence-backed result.**

## Core Product Loop

1. Open and explicitly trust a repository.
2. Define a project outcome, constraints, definition of done, and execution policy.
3. Spok creates a mission plan with milestones, dependencies, budgets, risks, and the next checkpoint.
4. Spok delegates isolated work packages to real Grok agents and remains accountable for integration.
5. The user monitors progress, approvals, resource pressure, blockers, and plan changes from one control room.
6. Spok reconciles agent reports with repository state and durable validation evidence.
7. The user reviews trace-linked changes, findings, checks, and untested scope.
8. Spok continues, repairs, hands off to Git, or archives safely without losing project context.

For short work, this loop should feel lighter than a terminal. For long work, it should remain comprehensible after a restart, a client disconnect, thousands of events, and multiple agent turnovers.

## Durable Product Model

Spok’s long-project model is hierarchical and versioned:

- **Project:** repository-level objective and durable history.
- **Mission:** one Spok-led attempt to achieve a project outcome.
- **Milestone:** a user-meaningful checkpoint with exit criteria.
- **Work item:** a bounded assignment with owner, dependencies, authority, budget, and expected evidence.
- **Agent run / turn:** one provider execution, never confused with task success.
- **Evidence:** changes, findings, validation, artifacts, decisions, approvals, and Git handoff.

Existing internal `enterprise` names are migration identifiers, not product vocabulary. The user-facing destination is **Missions**, and Spok is always identified as the leader. Requested agents never appear as running until provider evidence exists.

## Product Principles

- **Spok leads; agents contribute.** Delegation does not transfer accountability for synthesis, validation, or completion claims.
- **Review readiness is success.** Process exit, agent report, task outcome, review readiness, acceptance, and Git handoff are separate states with visible provenance.
- **Long work is durable.** Plans, dependencies, checkpoints, approvals, validation, and handoff evidence survive restart or surface an explicit recovery state.
- **Isolation is the default.** Concurrent or unattended work runs in verified managed worktrees. Isolation failure means no process launch.
- **Authority is visible and bounded.** Every delegated run inherits no more authority than its mission policy and work-item scope allow.
- **The UI answers “what now?”** Every project, mission, work item, and agent row shows identity, location, reason, attention, and one safest next action.
- **Performance is a feature.** Streaming cannot churn the shell, grow the DOM without bound, or make old projects expensive to reopen.
- **Evidence precedes spectacle.** Plans, blockers, diffs, checks, and next actions appear before decorative team visualizations.
- **Provider details stay behind adapters.** Grok 4.5 is first class; core lifecycle contracts do not encode accidental CLI quirks.
- **Accessibility is a release gate.** The core loop works by keyboard, screen reader, high contrast, reduced motion, 200% zoom, and compact/standard/wide layouts.

## Current Baseline

Spok already has a broad capability spine:

- Durable sessions, snapshot-first restore, replay/import/export, raw event preservation, parser fixtures, batched stream reduction, selective subscriptions, and virtualized high-volume views.
- A review workbench with risk ordering, trace-linked diffs, findings, validation recipes, Git state, and guided handoff records.
- A versioned inbox lifecycle projection that separates attention, active, queued, failed, review-ready, finished, and ready states; contradictions become diagnostics and job-only rows have a real detail target. Monitor and Run now consume the same projection via `session-lifecycle-projection` (review readiness and handoff surfaces still incomplete).
- A shared privileged Node runtime with capability tokens, loopback/origin checks, durable trust, approvals, audit events, path containment, secret redaction, and thin Next adapters for core routes.
- Managed-worktree isolation for background jobs, a durable job ledger, restart reconciliation, concurrent approvals, fleet controls, and configurable runner capacity.
- A thin versioned **Mission v1** domain and privileged API (`src/lib/missions`, `/api/missions`) with milestones, work items, dependency/evidence rules, authority and budget receipts, and checkpoint materialization. It is not yet wired as the user-facing Missions leadership surface.
- Composer effective-policy summary plus confirm-before-escalation for high-risk provider modes; Settings/Topbar still expose parallel policy chrome.
- Deterministic long-project performance gates for 100 jobs, 10 lanes, 10k hot events, and checkpoint-first projection under 500 ms (fixture-owned bounds; production `session.nodes` growth after 10k reduce remains a known breach).
- An experimental Spok-led multi-agent mission implementation with durable turns, real provider-lane linkage, same-worktree continuation, and accepted summaries. Its internal name and evidence hierarchy are being migrated; it is not yet the long-project contract.

Direct dogfood evidence still shows release-blocking product defects. Startup/lifecycle/trust defects UX-001, UX-002, UX-003, and UX-008 are closed. UX-004–UX-007 and UX-009–UX-017 remain the current gate. UX-005/UX-006 are advanced on Inbox, Missions, Monitor, and Run but stay open until review/handoff and remaining row E2E/a11y criteria pass.

## Ordered Delivery Plan

### P0 — Trustworthy, Fast Mission Control

Outcome: the current app always reaches a truthful, usable state; no passive client event changes execution; every visible state has one safe next action; the shell stays responsive under load.

Progress verified 2026-07-13 (enterprise mission `spok/enterprise-p0p1-mission` @ `c1b88df`): prior Missions navigation/leadership vocabulary slice retained. Additionally: Monitor and Run project the canonical lifecycle (lane, process, job layers distinct; diagnostics on contradiction; one next action); composer presents an effective-policy summary and blocks high-risk provider escalation until scope/duration confirmation (2/2 permission E2E + 15 unit); deterministic perf gates cover 100 jobs / 10 lanes / 10k hot events / checkpoint-first ≤500 ms (12/12 `test:perf`). Full suite: 351 unit/integration tests, lint, production build, and 9 Chromium E2E (permission + startup/lifecycle subset) pass. Remaining P0 gaps: review/handoff lifecycle consumption, navigation/cleanup, Settings/Topbar policy consolidation, a11y/responsive, and production hot-node bounding.

Build in this order:

1. Finish the canonical lifecycle projection across Inbox, Missions, Run, Monitor, Review, and handoff. **In progress:** Inbox, Missions, Monitor, and Run consume the versioned projection; Review and handoff still need the same legal model. Contradictory durable claims render a diagnostic, never optimistic success.
2. Replace mixed product-mode/dialog navigation with durable destinations: **Missions, Run, Review, Automate, Extend**. Context tabs remain local to a destination.
3. Replace direct deletion with archive-first, scope-aware cleanup previews covering durable records, logs, branches, worktrees, dirty files, and unpushed commits.
4. Present one effective policy summary; require explicit scope/duration confirmation for escalation. **In progress (composer slice):** effective summary + confirm-before-escalation for high-risk provider modes; Settings/Topbar/Run Status duplication and launch/handoff evidence remain.
5. Simplify New Task, Run, and composer hierarchy. Put outcome and next action first; move provider/debug detail on demand.
6. Unify changed files, findings, validation, readiness, and Git handoff in one review workbench.
7. Meet keyboard, AA contrast, screen-reader, 200% zoom, and compact/standard/wide layout gates.
8. Enforce performance budgets with release-build telemetry and representative long-project fixtures. **In progress:** representative gates exist and pass; production `session.nodes` after 10k reduce remains unbounded (breach for sequential fix).

Exit criteria:

- Every P0/P1 finding in `docs/UX_AUDIT.md` meets its required outcome.
- Startup reaches usable or actionable recovery state within 2.5 seconds.
- Client hide, disconnect, reload, navigation, repository switch, and layout transition never stop host work.
- Restore/import grants no authority.
- A user can launch an isolated mission in under 30 seconds without understanding worktree internals.
- Mission control remains interactive with 100 visible jobs, 10 concurrent agent lanes, 10,000 hot events, and a much larger cold history.

### P1 — Spok Leader And Long-Project Engine

Outcome: a user can hand Spok a substantial outcome and rely on a durable, inspectable leadership loop rather than manually operating a collection of chats.

Build in this order:

1. Replace prompt-only mission metadata with a versioned mission record: outcome, definition of done, constraints, policy, repository/worktree, status provenance, next action, and checkpoint. **Domain/API slice landed** (`MISSION_SCHEMA_VERSION = 1`, FS persist under `$SPOK_HOME/missions`, privileged list/create/read/update/checkpoint routes). Not yet the user-facing Missions store.
2. Add durable milestones and work items with dependencies, owner, requested capability, authority, time/token/tool budget, expected evidence, retries, and terminal outcome. **Domain/API slice landed** with validation that refuses false dependency completion without evidence and keeps terminal provenance distinct from process exit. Scheduler and UI wiring remain open.
3. Let Spok propose and revise the plan. Plan changes retain rationale and require user approval only when authority, destructive scope, cost, or declared outcome changes.
4. Add a scheduler for ready work items with dependency, capacity, repository-lock, and worktree constraints. Spok may parallelize only independent work.
5. Add checkpoint summaries that make a mission resumable without replaying its full transcript: completed, active, blocked, changed assumptions, evidence, risks, and next decisions.
6. Add context packets and artifact references so agents receive the smallest sufficient context, not the whole project history.
7. Add supervision: stalled-run detection, bounded retry, agent replacement, plan repair, budget pressure, approval expiry, and human escalation.
8. Add leader synthesis that verifies reports against repository/evidence state before marking a milestone or mission ready for review.

Exit criteria:

- A multi-hour mission survives runtime/client restart and resumes from its last durable checkpoint.
- Agent failure or replacement does not erase work-item history or falsely complete a dependency.
- Every delegation has an authority and budget receipt.
- Spok can explain the current plan, critical path, blockers, evidence gaps, and next safe action in under five seconds of user inspection.

### P2 — Evidence-First Review And Handoff

Outcome: Spok is better than an editor plus terminal at deciding whether multi-agent work is correct.

1. Ship a structured validation runner with cancellation, retry, timeout, exit code, bounded logs, durable artifacts, and explicit untested scope.
2. Infer touched packages and recommend the smallest useful checks; attach outcomes to work items, files, hunks, traces, and milestones.
3. Make findings durable and sendable back to Spok without losing prior evidence or accepted work.
4. Add artifact browsing for screenshots, test reports, coverage, build output, preview URLs, and generated documents.
5. Add attempt/agent comparison by plan, duration, budget, tools, changes, checks, findings, and outcome.
6. Complete audited IDE launch, stage/commit/sync/push/PR preparation, and archive/worktree cleanup.

### P3 — Reliable Unattended Operation

Outcome: long projects behave like a dependable local service.

1. Move queue pumping, schedules, checkpoints, and recovery behind the supervised runtime.
2. Add missed-run policy, deduplication, jitter, bounded concurrency, resource pressure, and orphan-process reconciliation.
3. Make notifications durable and attention-ranked across Windows, in-app, phone/LAN, and optional external channels.
4. Add least-privilege GitHub/GitLab issue, PR, check, review-comment, and CI workflows.
5. Promote skills, hooks, MCP, project rules, and custom agents only with scope, order, permissions, audit, disable, and recovery.

### Parallel Platform Track — Runtime And Native Windows UI

Continue extracting the shared Node runtime now. Expand the native UI only after lifecycle, mission, and accessibility contracts are stable enough not to duplicate unresolved product churn.

1. Extract residual automation, extension, attachment, secret, and live-runtime routes.
2. Publish versioned API/schema capability responses and compatibility tests.
3. Add process supervision metadata, Windows Job Object ownership, restart recovery, and portable packaging.
4. Prove a native shell with recoverable startup, Missions inbox, trust/policy receipt, virtualized streams, and diagnostics.
5. Add Run and Review parity, then mission planning/supervision, then extensibility.

## Performance And Scale Budgets

Measure release builds on a representative Windows laptop. Hard ceilings fail release gates.

| Measure | Target | Hard ceiling |
| --- | ---: | ---: |
| Cold launch to usable control room | 1.2 s | 2.5 s |
| Warm launch | 500 ms | 1.0 s |
| Recent mission checkpoint to useful content | 300 ms | 500 ms |
| Stream reduction work per burst | 8 ms | 16 ms |
| Common destination/tab switch | 100 ms | 250 ms |
| Common diff open/switch | 150 ms | 300 ms |
| Inbox update with 100 jobs | 8 ms | 16 ms |
| 10k hot-event navigation | No dropped interaction frames | No stall over 250 ms |
| Long-project history | Bounded hot memory/DOM | No unbounded growth |
| Native UI + runtime idle RSS | 150 MB | 280 MB |

High-frequency UI subscribes to stable projections/fingerprints, not whole sessions. Event history uses hot/cold tiers, bounded rendered windows, incremental indexes, and checkpoint-first restore. Performance regressions are product bugs, not cleanup work.

## Measures Of Product Quality

- Time from install to first isolated mission.
- Time to understand current plan, blocker, and next action after reopening.
- Percentage of missions that reach review-ready with validation evidence.
- Human approval latency and false/duplicate attention rate.
- Recovery success after restart, disconnect, agent failure, or corrupted tail data.
- Main-checkout escapes, unintended stops, contradictory success labels, and authority leaks: target zero.
- P50/P95 shell, inbox, trace, diff, and checkpoint latency on representative long projects.
- Keyboard, screen-reader, contrast, zoom, and compact-layout completion rate.

## Explicitly Deferred

- Decorative team visualization as a primary surface.
- Enterprise administration features unrelated to the core engineering loop.
- Broad plugin/gallery work before a safe install → permission → invoke → audit → disable workflow exists.
- Remote runners before local unattended recovery is dependable.
- Native feature breadth before lifecycle, mission, review, and performance contracts stabilize.
- Provider breadth that weakens Grok 4.5 quality.

## Documentation Ownership

- This roadmap owns product outcomes, order, exit criteria, and budgets.
- `docs/UX_AUDIT.md` owns observed interaction defects and closure evidence.
- `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md` owns runtime/native boundaries and migration.
- `docs/SECURITY_POSTURE.md` owns authority, trust, delegation, containment, and audit controls.
- `docs/RELEASE_CHECKLIST.md` owns shippable verification.
- Project skills under `.agents/skills` encode implementation workflow; `.codex/skills` remains compatibility-only.

A milestone closes only when its user-visible outcome, failure/recovery path, performance budget, and focused tests pass. A component rewrite, process exit, agent report, or attractive screenshot is not completion.
