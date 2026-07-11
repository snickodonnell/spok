# Spok Product Roadmap

Last updated: 2026-07-11

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

The repository already has a strong product spine:

- A focused Run workspace with thinking/events, changes, review, validation, raw log, health, Git, attachments, and a policy-aware composer.
- Durable sessions with snapshot-first progressive restore, replay/import/export, raw event preservation, and parser fixtures.
- Responsive stream handling through batched reduction, selective store subscriptions, virtualized high-volume views, and lazy heavy panels.
- A review workbench with risk ordering, file labels, unified/split diffs, keyboard navigation, hunk causality, review summaries, validation recipes, and issue derivation.
- An operational session inbox with attention, running, queued, failed, ready-for-review, and idle lanes on desktop and mobile.
- A shared privileged Node runtime with thin Next adapters for core routes, loopback/token/origin checks, durable workspace trust, approvals, audit events, path controls, and secret redaction.
- Git status/write operations plus managed-worktree primitives and isolation guards.
- Strict background isolation that creates, trusts, verifies, and binds a managed worktree before launching an unattended agent.
- Persistent review issue navigation through queue counts, a keyboard issue rail, and Monaco gutter/line/overview markers.
- A supervised `npm run dev:app` path that dogfoods extracted routes through the standalone runtime.
- Background jobs, schedules, channels, notifications, hooks, skills, MCP discovery foundations, mobile/LAN viewing, and an interim Tauri shell.

## Gaps Found In This Audit

These remaining gaps weaken the core workflow:

1. Worktree creation, task launch, session linkage, review handoff, archive, and cleanup are still separate UI actions rather than one lifecycle.
2. Job/session recovery after app or runtime restart is not yet a durable orchestration contract.
3. Validation recipes prefill prompts; they are not yet a structured, cancellable validation runner with durable artifacts.
4. Automation timers are app-lifetime helpers, not a supervised scheduler with restart recovery and missed-run policy.
5. Several automation, extension, attachment, secret, and live-runtime routes are still Next-hosted rather than shared standalone-runtime contracts.
6. The final native Windows UI is a major separate product track; starting a full rewrite before the agent lifecycle stabilizes would create two moving UI targets.

## Ordered Delivery Plan

### Now — Mission-Control Vertical Slice

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

1. **New task flow:** one compact launcher for repository, task, branch prefix, permission profile, and local/background execution. Isolation defaults on for parallel/background work.
2. **Durable orchestration:** versioned run records linking job, session, PID/runtime run, worktree, branch, policy, timestamps, and terminal outcome. Reconcile stale `starting`/`running` records after restart.
3. **Fleet controls:** stop, retry, continue, duplicate, reprioritize, and concurrency limits from the inbox. Show queued reason and runtime/resource pressure.
4. **Approval inbox:** group pending approvals across sessions, show command/path/risk/policy, and support allow-once, scoped durable grant, or deny without losing context.
5. **Handoff:** review readiness gate, commit, push, PR creation, open in IDE, and copy summary from one consistent completion panel.
6. **Archive and cleanup:** distinguish archive session, keep branch/worktree, remove clean worktree, and force cleanup. Never remove dirty or unpushed work by default.
7. **Run templates:** implement issue, fix CI, review branch, update dependencies, reproduce bug, and validate touched packages as editable presets—not hard-coded workflows.

UX acceptance:

- A new user can launch an isolated task in under 30 seconds without understanding Git worktree internals.
- Every session row answers: what is it doing, where is it running, what needs attention, and what can I do next?
- Keyboard navigation covers create, session cycling, stop, review, validation, and handoff.
- Destructive cleanup always previews affected session, worktree, branch, and dirty/unpushed state.

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

- A WinUI host can supervise the bundled runtime, bootstrap a token in memory, and render a session inbox.
- Native trace, diff, composer, approval, validation, settings, and accessibility prototypes meet quality budgets before product cutover.
- No WebView/browser is required in the end-user shell.
- The React UI remains the only feature-complete surface until native parity is real; do not maintain two independently evolving product designs.

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
| Isolation | No concurrent/background run writes to the main checkout by default |
| Review | Every changed file has risk, cause when known, validation state, and next action |
| Accessibility | Full core loop by keyboard; visible focus; reduced motion; AA contrast |
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
- `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md`: runtime/native boundary and migration plan.
- `docs/SECURITY_POSTURE.md`: active threat model and controls.
- `docs/RELEASE_CHECKLIST.md`: shippable verification gates.
- `docs/UPDATER_AND_DESKTOP.md`: current desktop glue, notifications, signing, and updater notes.

Historical handoffs, completed milestone trackers, and duplicate audit snapshots should not remain active documentation.
