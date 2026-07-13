# Spok Product Roadmap

Last updated: 2026-07-12

This is the product and engineering source of truth for Spok. It describes what is true now, what is being built next, and the order in which larger capabilities should land. Completed implementation detail belongs in code, tests, and Git history—not in a permanent checklist of crossed-out tasks.

## Product Thesis

Spok should be the best control room for Grok Build: a fast, local-first desktop harness where a developer can launch several coding tasks safely, understand what each agent did, validate the result, and hand good work to Git without reconstructing intent from terminal output.

The critical workflow is:

1. Open and trust a repository.
2. Describe a task and choose an execution policy.
3. Run the task in an isolated worktree by default.
4. Monitor progress, approvals, failures, and resource use across sessions.
5. Review trace-linked changes and validation evidence.
6. Continue, retry, commit, push, open a PR, or discard with confidence.
7. Archive the session and clean up its worktree intentionally.

Features that make this loop faster, safer, or easier to understand outrank broad platform work.

## Product Principles

- **Review is the center of gravity.** A successful process exit is not the same as a successful task.
- **Isolation is the default.** Concurrent or unattended work must not modify the user's main checkout.
- **State is durable and replayable.** Session, job, approval, validation, and handoff state must survive a restart or explicitly explain why it cannot.
- **Policy is visible.** The UI must show what the agent can do, what it is waiting for, and why an action was denied.
- **The interface stays quiet under load.** Streaming must not cause shell churn, layout shifts, or hidden background work.
- **Provider details stay behind adapters.** Grok Build is the first-class provider; core session and review contracts should not encode accidental CLI quirks.
- **No speculative platform surface.** Add hooks, MCP, skills, plugins, connectors, and remote runners only behind a real user workflow and explicit permissions.

## Current Baseline

The repository has a broad capability spine, but the current React/Tauri dogfood UI is not yet a dependable design reference. The active evidence and remediation contract is `docs/UX_AUDIT.md`. In particular, startup recovery, mobile lifecycle safety, navigation coherence, canonical status language, destructive-action previews, and accessibility must be corrected before more surface area is treated as product progress.

Capabilities already present include:

- A focused Run workspace with thinking/events, changes, review, validation, raw log, health, Git, attachments, and a policy-aware composer.
- Durable sessions with snapshot-first progressive restore, replay/import/export, raw event preservation, and parser fixtures.
- Responsive stream handling through batched reduction, selective store subscriptions, virtualized high-volume views, and lazy heavy panels.
- A review workbench with risk ordering, file labels, unified/split diffs, keyboard navigation, hunk causality, review summaries, validation recipes, and issue derivation.
- A lane-grouped session/job inbox with attention, running, queued, failed, ready-for-review, and idle derivation; row identity, job-only navigation, status consistency, and next-action UX remain incomplete.
- A shared privileged Node runtime with thin Next adapters for core routes, loopback/token/origin checks, durable workspace trust, approvals, audit events, path controls, and secret redaction.
- Git status/write operations plus managed-worktree primitives and isolation guards.
- Strict background isolation that creates, trusts, verifies, and binds a managed worktree before launching an unattended agent.
- Persistent review issue navigation through queue counts, a keyboard issue rail, and Monaco gutter/line/overview markers.
- A supervised `npm run dev:app` path that dogfoods extracted routes through the standalone runtime.
- A concurrent approval queue that keeps session waiters independent, binds each waiter to run cancellation, and exposes selected risk, command, path, policy, allow-once/scoped-always, and deny decisions without superseding or reviving another agent.
- A New Task flow for repository, optional task, interactive draft versus isolated background execution, and advanced CLI selection; it still front-loads filesystem detail and makes trust/policy consequences too implicit.
- Inbox fleet controls for job-only and session-linked work: stop/cancel, retry, safe duplicate, and queued priority changes with execution/worktree identity stripped from clones.
- Durable user-configurable background capacity (one to eight runner slots), with non-destructive limit changes and priority/FIFO queue reasons shown consistently in the inbox and Monitor.
- A responsive Review completion path that derives the next safe handoff action from fresh session, review, validation, and Git state; it routes findings back to review, then guides stage, commit, fast-forward sync, push, PR preparation, and copyable trace-linked summaries through the existing confirmation and policy gates. Confirmed commit, push, and PR outcomes persist as a versioned, audit-linked, secret-safe handoff record tied to the session, background job, branch, and worktree, with the captured readiness evidence restored after restart.
- Direct-path repository navigation in New Task that handles Enter inside the picker without submitting the enclosing launch flow.
- An experimental Enterprise coordinated-mission surface with leader/crew metadata, real provider-lane linkage, turn history, same-worktree follow-up, and accept-to-Run. Its current presentation can contradict terminal state and overemphasizes decorative ship/crew UI before evidence, so it is not a core-loop quality baseline.
- A versioned, atomic, secret-safe automation job ledger linking job/session/worktree/branch/policy/timestamps/outcome, with persist-before-launch guarantees and restart reconciliation for interrupted or still-queued work.
- Background jobs, schedules, channels, notifications, hooks, skills, MCP discovery foundations, mobile/LAN viewing, and an interim Tauri shell.

## Gaps Found In This Audit

The comprehensive finding list is maintained in `docs/UX_AUDIT.md`. The release-blocking themes are:

1. **Recoverability:** the preferred development shell can remain indefinitely on restore/connect loading with no recovery action.
2. **Lifecycle safety:** passive phone lifecycle events can stop active work, and phone folder changes stop unrelated harnesses.
3. **Control-room coherence:** navigation mixes destinations, tab aliases, and dialogs; status vocabularies contradict; job-only inbox rows lack a reliable next action.
4. **Visible authority:** restore can re-grant workspace trust, while permission escalation, stop, delete, archive, and cleanup scope are fragmented or implicit.
5. **Review evidence:** review, validation, Git handoff, findings, and completion remain split across overlapping surfaces.
6. **Accessibility/adaptation:** dense low-contrast 9–10 px controls, incomplete selection semantics, hover-only actions, and an abrupt desktop/phone feature cliff do not meet the stated quality bar.
7. **Verification:** current smoke tests can pass or skip without proving that the shell became usable.
8. **Remaining architecture gaps:** structured validation, durable scheduling, residual Next-hosted privileged routes, IDE launch, and safe archive/worktree cleanup still remain.

## Ordered Delivery Plan

### Now — UX Recovery And Lifecycle Coherence

Goal: the current dogfood app always reaches a truthful, usable state and never changes run authority or lifecycle without a scoped user decision.

Closure update (verified 2026-07-13): UX-001, UX-002, UX-003, and UX-008 are closed with focused tests, required non-skipping E2E, and direct development/production interaction review at 390, 768, 1024, and 1440 px. Startup reaches usable/recovery state within the 2.5-second contract; passive client lifecycle events and repository switching preserve unrelated runs; restore/import grants no trust; and launch requires a visible authority receipt plus explicit trust when needed. UX-004–UX-007 and UX-009–UX-017 remain open and continue to block Enterprise, Automate, Extend, and native-parity expansion.

Build in this order:

1. Fix desktop/mobile hydration so startup reaches usable, recoverable, or diagnostic state within 2.5 seconds in development and production. Add non-skipping E2E for fresh, restored, corrupt, slow, and unavailable runtime cases.
2. Remove all stop behavior tied to page hide, unload, freeze, disconnect, or layout transition. Replace global phone folder-stop behavior with context switching and a scoped conflict decision.
3. Separate restore/import from workspace trust. Add explicit trust state and an effective launch-policy receipt for repository, location, isolation, permissions, and approval behavior.
4. Define and enforce the canonical job/session/run/turn/review/handoff state model. Rebuild inbox rows around identity, state reason, attention, and the next safe action.
5. Replace product-mode/dialog ambiguity with durable primary destinations and contextual tabs. Unify Changes, findings, validation, review readiness, and Git handoff terminology.
6. Make deletion archive-first; add previews and confirmation for session logs, schedules, jobs, branches, worktrees, dirty files, and unpushed commits.
7. Simplify Run/New Task/composer hierarchy, then meet keyboard, AA contrast, screen-reader, 200% zoom, and compact/standard/wide layout gates.

Exit criteria:

- All P0 and P1 findings in `docs/UX_AUDIT.md` meet their required outcomes.
- No client lifecycle event stops a run; every explicit stop identifies exactly one scope unless the user intentionally chooses a fleet action.
- Restore/import grants no authority, and untrusted restored work remains safely reviewable.
- Every inbox row and terminal surface uses the canonical state model and exposes one safe next action.
- Required startup/core-loop E2E assertions fail rather than skip when UI is missing or blocked.
- The core loop passes keyboard-only, AA contrast, high-contrast, reduced-motion, screen-reader smoke, and 200% zoom review.

### Completed Foundation — Mission-Control Vertical Slice

Goal: a user can launch two or more Grok tasks, leave them running safely, and return to reviewable results without touching the main checkout.

Current implementation pass:

- [x] **Completed 2026-07-11:** isolated background jobs create, trust, verify, and bind a managed sibling worktree before process launch. They never silently fall back to the main checkout.
- [x] **Completed 2026-07-11:** the job/session relationship retains worktree path, branch, main checkout, session ID, and job ID; the session runs with the worktree as its cwd.
- [x] **Completed 2026-07-11:** isolation setup failures become actionable failed jobs/notifications and launch no agent process. Worktrees are never auto-removed.
- [x] **Completed 2026-07-11:** review issues remain visible in the queue, a compact keyboard-accessible issue rail, and Monaco gutter/line/overview markers; navigation preserves file, hunk/line, and causal trace context when available.
- [x] **Completed 2026-07-11:** `npm run dev:app` supervises the standalone runtime and existing Next UI, proxies extracted routes over strict loopback, keeps the shared capability token in memory, verifies readiness, and cleans up both process trees.
- [x] **Completed 2026-07-11:** focused and full tests, TypeScript, lint, performance budgets, standalone launcher smoke, and production build pass; roadmap, desktop architecture, README, security/release docs, and architecture skill match the shipped behavior.

Exit criteria:

- Two isolated jobs can run concurrently against one repository.
- Neither job can mutate the main checkout through Spok's Git or process path.
- Each result appears in the inbox with branch/worktree identity and a clear next action.
- Failure to create or trust a worktree runs no agent process.
- Focused tests and the full unit suite pass; production build passes for route/UI contract changes.

### Next — Complete The Agent Lifecycle

Goal: turn the vertical slice into the default daily workflow.

Build in this order:

1. **Fleet policy:** add general-purpose continue/steer and runtime/resource pressure. Enterprise now ships a focused same-worktree team continuation flow; stop, retry, safe duplicate, reprioritize, durable user-configurable concurrency, and explicit capacity/queue-position reasons already ship in the inbox and Monitor.
2. **Approval recovery:** reconcile expired or runtime-interrupted approvals into explicit session/job outcomes and retain audit-safe decision history without restoring stale authority.
3. **Handoff:** the consistent completion panel now ships review-finding recovery, stage/commit/sync/push routing, PR preparation, copy summary, and a durable audit-linked outcome containing commit SHA, push result, PR URL, and readiness evidence. Next, add audited open-in-IDE and show the completed outcome in the inbox.
4. **Archive and cleanup:** distinguish archive session, keep branch/worktree, remove clean worktree, and force cleanup. Never remove dirty or unpushed work by default.
5. **Run templates:** implement issue, fix CI, review branch, update dependencies, reproduce bug, and validate touched packages as editable presets—not hard-coded workflows.

UX acceptance:

- A new user can launch an isolated task in under 30 seconds without understanding Git worktree internals.
- Every session row answers: what is it doing, where is it running, what needs attention, and what can I do next?
- Keyboard navigation covers create, session cycling, stop, review, validation, and handoff.
- Destructive cleanup always previews affected session, worktree, branch, and dirty/unpushed state.
- Loading, disconnected, denied, failed, and stale states always expose a durable recovery action; toasts are never the only error explanation.
- Restoring/importing sessions never grants workspace trust or execution authority.
- Phone clients can disconnect, hide, or change layout without stopping host work.
- Operational text and controls meet AA contrast and remain usable at 200% zoom.

Immediate implementation sequence:

1. Complete the UX Recovery milestone above; do not expand Enterprise, Automate, Extend, or native feature parity while P0/P1 lifecycle and coherence findings remain open.
2. Add an audited runtime capability for “Open in IDE” with trusted-workspace containment and explicit unavailable/error states. Keep editor discovery and process spawning outside React components.
3. Build one archive-and-cleanup flow from managed-worktree status: archive only, archive and keep worktree, remove clean/pushed worktree, or force cleanup after a full dirty/unpushed preview and explicit confirmation.
4. Stabilize Monaco model disposal during rapid Changes/Review or session switches, then add keyboard and E2E coverage for finding → validate → stage → commit → push → PR preparation, plan-mode denial, failed validation recovery, compact Review panes, and New Task direct-path repository flow.
5. Only after lifecycle state is durable and coherent, add general-purpose continue/steer and resource-pressure UX so resumed work cannot obscure or invalidate prior handoff evidence.

### Then — Review And Validation As Evidence

Goal: make Spok better than an editor-plus-terminal for deciding whether agent work is correct.

1. Add a structured validation runner with command recipes, cancellation, retry, timeout, exit code, logs, and durable artifacts.
2. Infer touched packages and recommend the smallest useful tests/builds; show what was not checked.
3. Attach validation outcomes and policy denials to files, hunks, causal trace nodes, and prompt turns.
4. Add an artifact browser for screenshots, test reports, coverage, build output, preview URLs, and generated documents.
5. Add inline review comments with open/resolved state and a “send findings back to agent” continuation flow.
6. Add session compare for alternative attempts: plan, duration, tool use, changed files, validation, and diff.
7. Add agent checkpoints or equivalent safe restore points for agent-authored changes without pretending they replace Git.

Quality budgets:

- Common diff tab switch: under 300 ms.
- Review queue remains interactive for 1,000 changed files and 10,000 trace events.
- No full-session React rerender per stream event.
- Validation output can grow without unbounded DOM or in-memory tails.

### After That — Reliable Unattended Work

Goal: scheduled and event-triggered work behaves like a dependable local service.

1. Move scheduling and queue pumping behind the supervised runtime with restart recovery, missed-run policy, deduplication, jitter, and concurrency control.
2. Make notification delivery durable across in-app, Windows, mobile/LAN, and optional external channels.
3. Add GitHub/GitLab issue, PR, check-run, review-comment, and CI-log workflows behind least-privilege credentials.
4. Promote hooks, skills, project rules, and custom agents into a visible scope/order/conflict model.
5. Add MCP management with trust prompts, per-server/tool permissions, health, invocation logs, and secret-safe configuration.
6. Add extension packaging only after permission declarations, compatibility checks, disable/recovery, and audit behavior are defined.

### Parallel Platform Track — Runtime And Native Windows UI

The shared Node runtime continues now; the full native UI starts after the agent lifecycle and runtime API contracts are stable enough to avoid duplicating churn.

Near-term runtime work:

1. Extract the remaining automation, extension, attachment, secret, and live-runtime routes from Next.
2. Publish a versioned API/schema capability response and compatibility tests.
3. Add runtime supervision metadata, orphan-process reconciliation, graceful shutdown, and portable packaging.
4. Run browser/Tauri dogfood against the standalone runtime so native-client behavior is exercised continuously.

Native track gates:

- Canonical navigation, state/outcome vocabulary, trust receipt, cancellation scope, recovery states, and accessibility behavior are specified independently of the current React component layout.
- A WinUI host can supervise the bundled runtime, bootstrap a token in memory, and render a session inbox.
- Native trace, diff, composer, approval, validation, settings, and accessibility prototypes meet quality budgets before product cutover.
- No WebView/browser is required in the end-user shell.
- The React UI remains the only broad-capability surface until native parity is real; it is a dogfood client for the shared contracts, not a layout/status model to copy while its UX audit remains open. Do not maintain two independently evolving product designs.

See `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md` for the current boundary and cutover plan.

## Explicitly Deferred

- Multi-provider support before Grok Build execution, parsing, review, and recovery are excellent.
- Cloud runners before local run records, policy, replay, and handoff contracts are portable.
- Team collaboration before single-user archive/review ownership is durable.
- A broad plugin marketplace before permissions, compatibility, recovery, and audit are enforceable.
- A native rewrite of privileged TypeScript domain logic.

## Measures Of Product Quality

| Area | Target |
| --- | --- |
| Cold shell | Usable in under 2 seconds on the target Windows laptop |
| Recent session | First useful content in under 500 ms |
| Stream ingest | Under 16 ms main-thread work per burst after batching |
| Reliability | No silent loss of session/job terminal state after restart |
| Startup recovery | Usable inbox or actionable recovery within 2.5 seconds; no indefinite loading |
| Lifecycle intent | Client hide, disconnect, reload, or layout change never stops host work |
| Isolation | No concurrent/background run writes to the main checkout by default |
| Review | Every changed file has risk, cause when known, validation state, and next action |
| State coherence | Job, session, run, review, and handoff labels cannot contradict and include provenance |
| Accessibility | Full core loop by keyboard and at 200% zoom; visible focus; reduced motion; screen-reader smoke; AA contrast |
| Security | Every privileged action is trusted, policy-checked, approval-gated when required, and audited |

## Competitive Context

Official product documentation checked on 2026-07-11 shows the desktop bar now includes parallel sessions with automatic worktree isolation, visual diff review, approvals, phone dispatch, schedules, connectors, and PR monitoring; Cursor also emphasizes background agents, multitasking/worktrees, review, and checkpoints. Spok should match the safety and lifecycle fundamentals while differentiating through Grok-native trace causality, review evidence, local-first control, and a fast operational UI.

- https://code.claude.com/docs/en/desktop
- https://code.claude.com/docs/en/worktrees
- https://code.claude.com/docs/en/scheduled-tasks
- https://cursor.com/changelog/04-24-26
- https://docs.cursor.com/en/agent/chat/checkpoints

## Documentation Ownership

- This file: current product priorities, sequence, and acceptance criteria.
- `docs/UX_AUDIT.md`: active substantial UX findings, evidence, required outcomes, and closure policy.
- `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md`: runtime/native boundary and migration plan.
- `docs/SECURITY_POSTURE.md`: active threat model and controls.
- `docs/RELEASE_CHECKLIST.md`: shippable verification gates.
- `docs/UPDATER_AND_DESKTOP.md`: current desktop glue, notifications, signing, and updater notes.

Historical handoffs, completed milestone trackers, and duplicate audit snapshots should not remain active documentation.
