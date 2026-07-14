# Spok UX Audit

Date: 2026-07-13

Status: active remediation contract. This document records the substantial UX defects in the current React/Tauri dogfood product. Product order lives in `HARNESS_AUDIT_AND_ROADMAP.md`; this file owns the evidence, UX requirements, and closure criteria.

## Executive Summary

Spok has broad harness capability, but the current interface is not yet a dependable control room. The product core is now Spok-led Missions for long-running multi-agent Grok work; the current UI still reflects an older “workbench plus Enterprise demo” hierarchy. The largest problems are lifecycle safety and product coherence rather than styling:

- the preferred development UI can remain indefinitely on session restoration;
- the phone surface can stop active host work merely because the page hides or changes layout, and changing folders stops unrelated runs;
- Missions, Run, Review, Automate, and Extend do not yet share one navigation model;
- session, job, run, turn, mission, review, and handoff states can contradict one another;
- trust, permission, isolation, stop, delete, and cleanup consequences are fragmented or implicit;
- requested specialists, real provider lanes, remaining execution reserve, synthesis progress, and cleanup responsibility are not presented as one truthful mission contract;
- dense, low-contrast, frequently 9–10 px controls and hover-only actions prevent the advertised keyboard/AA quality bar;
- smoke tests can pass or skip while the usable workspace is still blocked.

The target interaction is: give Spok an outcome, inspect the plan and authority, leave safely, return to truthful progress, and review evidence. Performance and accessibility are part of usability: long projects must reopen from checkpoints, stream without shell churn, and remain navigable at 200% zoom.

The next product milestone is therefore fast, trustworthy mission control. New orchestration breadth, decorative team visualization, native UI expansion, and extension packaging should not outrank the P0/P1 findings below.

## Method And Scope

The audit combined:

- direct use of `npm run dev:app` in the current in-app browser on 2026-07-12;
- inspection of desktop startup, New Task, inbox, product modes, Monitor, Enterprise, Extensions, Settings, and forced phone layout;
- source review of shell routing, hydration, mobile lifecycle, launch, session inbox, composer, automation, review, Git, permission, and responsive behavior;
- review of the active roadmap, runtime/native plan, security posture, release checklist, and existing E2E coverage.

“Substantial” means the issue can block the core loop, stop or destroy work, misrepresent safety/state, hide the next action, exclude keyboard/low-vision users, or materially increase the chance of a wrong decision. Minor visual polish is intentionally excluded.

Severity:

- **P0:** blocks use or can cancel/affect work without a direct user decision.
- **P1:** makes the core loop unsafe, contradictory, undiscoverable, or inaccessible.
- **P2:** materially weakens an important secondary workflow or the product's ability to verify UX quality.

## Findings

### P0 — Blockers And Unintended Lifecycle Effects

#### UX-001 — Session restoration can deadlock the entire main surface

Status: **Closed 2026-07-12.** Hydration attempts now survive React development effect replay, timeout to an inline recovery state within 2.5 seconds, and expose Retry, Continue without restored sessions, and Diagnostics. Restored metadata shells remain visibly unavailable until materialized. Focused tests plus non-skipping desktop/mobile E2E cover fresh, failed, slow, corrupt, retry, and continue paths.

Observed: the desktop stayed on “Restoring sessions…” and the phone stayed on “Connecting to host…” indefinitely, while stale inbox/mission chrome remained visible. There was no timeout result, retry, diagnostic action, or usable empty state.

Likely cause: `useSessionHydration` uses a one-way `started` ref (`src/hooks/use-session-hydration.ts:61`) while its cleanup marks the first run cancelled (`:274`). React development effect replay can therefore cancel the first attempt and prevent the second. The existing 2.5-second deadline cannot recover after that cleanup.

Required outcome:

- boot reaches a usable inbox or an actionable recovery state within 2.5 seconds;
- restore failure names the failed operation and offers Retry, Continue without restored sessions, and Diagnostics;
- stale shell rows are visibly marked unavailable until their bodies are materialized;
- development and production startup paths share an E2E assertion that waits for usability, not merely the word “SPOK.”

#### UX-002 — Hiding or leaving the phone UI silently stops active work

Status: **Closed 2026-07-12.** Page hide, unload, freeze, visibility, unmount, and layout changes no longer call any stop helper. Mobile lifecycle now refreshes connectivity capability only; a non-skipping E2E dispatches passive events and unmounts the phone shell while asserting that no stop request occurs.

`useMobileSessionLifecycle` stops the active harness on `pagehide`, `beforeunload`, browser freeze, 12 seconds hidden, and mobile-shell unmount (`src/hooks/use-mobile-session-lifecycle.ts:37-99`). A notification shade, app switch, screen lock, navigation, or layout change can therefore cancel host work. This contradicts mobile monitoring and unattended execution.

Required outcome:

- passive client lifecycle events never imply user intent to stop a run;
- stop requires an explicit, scoped action naming the session/run and clearing consequences;
- client disconnect is a visible presence state, not a process cancellation signal;
- an optional owner-disconnect policy, if ever added, is opt-in, time-bounded, audited, and never applies to background jobs.

#### UX-003 — Changing folders on phone stops every live harness

Status: **Closed 2026-07-12.** Repository changes no longer invoke fleet stop. Unrelated repositories switch context without process mutation; a live foreground run in the exact same non-isolated checkout produces a named conflict with View, explicitly scoped Stop, and Cancel choices. Unit tests cover unrelated, isolated, exact, and terminal cases, and mobile E2E requires the non-destructive context-switch UI.

`MobileFolderPicker` calls `stopAllLiveHarnesses()` before opening a folder (`src/components/mobile/mobile-folder-picker.tsx:49`). The surrounding copy alternates between “current run,” “any running job,” and a global implementation. One phone action can affect unrelated repositories and users' background work.

Required outcome:

- opening another repository creates or switches workspace context without stopping unrelated work;
- if an interactive foreground run truly conflicts, preview exactly one affected session/run and ask for an explicit decision;
- global stop remains a separately named fleet action with a complete impact preview and confirmation.

### P1 — Core Product Coherence And Safety

#### UX-004 — Top-level navigation does not express the product hierarchy

Run maps to the workspace Changes tab; Review maps to the workspace Git/Review tab; Automate changes product state and opens Monitor as a modal; Enterprise replaces the whole main surface; Extend opens another modal. The sidebar separately exposes Workspace, Split, Thinking, Changes, Events, and Health, plus duplicate Monitor/Extensions entries. Closing a modal can leave a meaningless active product mode.

Required outcome:

- use one stable navigation model, ordered around Missions, Run, Review, Automate, and Extend: durable destinations in primary navigation, contextual panels/tabs inside a destination, transient dialogs only for short tasks;
- identify Spok as the accountable leader in Missions; Run is a single-session context, not the product’s top-level mental model;
- make URL/history, title, selected state, focus return, and keyboard shortcuts consistent;
- remove duplicate entry points unless one is explicitly a shortcut to the same destination;
- rename Review surfaces so “changed files,” “review findings,” and “Git handoff” are distinct.

#### UX-005 — Status and completion vocabulary contradicts itself

Status: **In progress 2026-07-13.** Inbox, Missions, Monitor, Run, review readiness, and handoff now use the versioned lifecycle presentation or its explicit process/task/review/validation/handoff layers. Diagnostic state wins over optimistic success, reasons retain provenance, and one next action is projected. Focused unit tests cover success, contradiction, recovery, readiness, and durable handoff evidence. The finding remains open pending direct cross-surface dogfood, remaining row E2E, and accessibility evidence.

The observed Enterprise mission simultaneously showed “Needs attention,” “Accepted,” a completed background job, zero emitted lanes, zero visible events, and no substantial summary. Inbox lanes, process status, job status, mission turn status, review readiness, and handoff outcomes use overlapping but non-equivalent labels.

Required outcome:

- define one versioned state model for job, session, run, turn, review readiness, and terminal outcome;
- distinguish process exit from task outcome and review readiness;
- every visible label must include provenance/reason and map to exactly one recommended next action;
- impossible or contradictory combinations fail validation and render a diagnostic state rather than optimistic success.

#### UX-006 — Inbox rows do not reliably answer “what now?”

Status: **In progress 2026-07-13.** Every current inbox row now exposes one visible primary navigation action. Review-ready sessions route to Changes; pre-session/job-only records open Monitor with the matching job focused; terminal clean records appear under Finished rather than Idle; and rows show execution location plus reason provenance. Focused contract tests cover job-only, review, terminal, and contradictory-state paths, with direct restored-data review at standard and wide widths. **Monitor job rows and Run status now surface the same reason/next-action projection** (including focusing Monitor when Run’s next action is `open_job`). Job detail/navigation E2E and final row hierarchy/accessibility review remain before closure.

Job-only rows appear in the session inbox but their main buttons are disabled when no `sessionId` exists. They expose branch/cwd/status yet cannot be opened from the row. Actions are hidden in an overflow menu; selection, active state, review readiness, and lifecycle identity are ambiguous. “Idle sessions” can describe completed job-only records.

Required outcome:

- every row answers what is running, where, what needs attention, and the single safest next action;
- job-only rows open job details; linked rows open the correct session/review context;
- row identity visibly separates repository, task, branch/worktree, run, and age without badge clutter;
- lane derivation uses the canonical state contract and never labels terminal work “idle” without explanation.

#### UX-007 — Destructive actions bypass preview and confirmation

The sidebar deletes a session and durable log directly through a hover-only trash icon (`src/components/shell/session-inbox.tsx:298-306`; `src/components/shell/sidebar.tsx:285`). Monitor clears finished jobs and removes schedules directly (`src/components/automation/monitor-panel.tsx:557,667`). Archive/worktree cleanup remains separate and incomplete.

Required outcome:

- replace direct deletion with archive-first behavior and a recoverable default;
- preview session/job records, durable logs, branch, worktree, dirty state, unpushed commits, and schedule consequences as applicable;
- hide no destructive action behind hover alone;
- require typed or otherwise high-friction confirmation only for irreversible/force cleanup, with audit evidence.

#### UX-008 — Repository trust is implicit and can be re-granted during restore

Status: **Closed 2026-07-12.** Restore and lazy materialization contain no trust-grant call, and opening repository context is authority-neutral. New Task shows a launch authority receipt with repository, execution location, effective policy, approval behavior, prior trust scope/time, failure behavior, and revocation location. New trust requires an explicit checkbox; denial E2E proves selection and submission without confirmation grant no trust or process authority. Mobile repository open uses the same explicit trust decision.

Verification follow-up (2026-07-13): direct in-app review exercised the development and production shells at 390, 768, 1024, and 1440 px. Startup reached a usable shell in 1.0–1.3 seconds during the observed runs; desktop and mobile trust denials remained inline and actionable; mobile repository switching retained its non-destructive scope copy; and mobile/desktop layout changes preserved the selected workspace. The full Chromium E2E suite passed 17/17 with no conditional skips. The resize-driven product-mode inconsistency remains tracked by UX-009 and is not treated as closed by this verification.

New Task says opening a repository trusts it, but does not show trust scope, inherited authority, current permission policy, prior trust, or revocation. Hydration calls `trustWorkspace` for restored sessions (`src/hooks/use-session-hydration.ts:213,255,343`), which can turn session restoration into an implicit trust grant.

Required outcome:

- restoring metadata never grants authority;
- repository selection and trust are separate, explicit states with scope, time, policy, and revoke affordances;
- launch summarizes repository, execution location, isolation, permission mode, and approval behavior before starting;
- untrusted restored sessions remain reviewable but cannot perform privileged actions until trust is explicitly renewed.

#### UX-009 — Permission controls are duplicated, jargon-heavy, and too easy to escalate

Status: **In progress 2026-07-13.** `effective-policy` now drives composer, Settings, Topbar, Run Status, and Status Line summaries with the same app/provider precedence and risk tier. High-risk selector and slash-command modes (`dontAsk`, `bypassPermissions`, `always-approve`) open a scope/duration confirmation dialog and **do not call `setGrokFlags` until Confirm**; de-escalation is immediate and elevated state remains visible. Verified by 26 focused unit tests and 5/5 Chromium E2E covering cancel, confirm, slash escalation, cross-chrome visibility, and slash de-escalation. **Not closed:** launch/continue/handoff evidence remains incomplete and mobile composer omits the desktop policy selector.

App policy and per-session Grok flags remain distinct controls, but every current desktop chrome surface derives its display from the same effective model. High-risk selector and slash-command mutations are gated as above.

Required outcome:

- present one effective-policy summary with expandable provider-specific detail;
- explain precedence between app policy, provider flags, allow rules, approvals, and deny rules;
- escalation requires an explicit confirmation showing scope and duration; de-escalation is immediate;
- risky modes remain visible for the duration of their effect and are included in launch/continue/handoff evidence.

#### UX-010 — New Task front-loads filesystem and Git implementation detail

The observed dialog embeds a full directory navigator (including generated folders such as `node_modules` and test reports), then repeats path/breadcrumb/selection, asks for the task, asks for execution target, explains implicit trust, and hides command selection under Advanced. “Open repo,” “New task,” “Open workspace,” “new session,” and “queue agent” overlap.

Required outcome:

- begin with recent/trusted repositories plus a clear Browse action;
- hide noisy/generated/hidden folders by default and provide an intentional reveal toggle;
- use a single task-launch vocabulary and progressive disclosure;
- show a concise launch receipt: repo, task, interactive/background, branch/worktree behavior, effective policy, and failure behavior.

#### UX-011 — The primary Run surface is overloaded and duplicates context

Repository, branch, permission, CLI, changed-file count, queue state, and stop appear in Run Status; cwd and policy appear again in the composer cockpit; Git status appears above the right tabs; global metrics, status line, and timeline add more persistent chrome. The composer also exposes model, run mode, skills, attachments, queue, send, and background actions simultaneously.

Required outcome:

- establish a clear hierarchy: task/status and next action first, secondary execution detail on demand;
- show policy once as an effective summary, not parallel app/provider controls;
- keep the composer focused on prompt, attachments, send/queue, and explicit stop;
- move model/debug/provider flags into a scoped run configuration surface.

#### UX-012 — Review is fragmented across Changes, Review, Validation, completion, and top-level Review

“Review” currently means a top product mode, a right tab that renders Git controls, a review queue inside diff surfaces, and a completion panel. Validation recipes prefill prompts rather than execute durable checks. Users must reconstruct whether findings are resolved, what was validated, and whether Git handoff is safe.

Required outcome:

- one review workbench owns changed files, findings, validation evidence, risk, and completion readiness;
- Git handoff is a guided phase after review readiness, not the definition of Review;
- findings can be sent back to the agent without losing prior evidence;
- validation runs are cancellable, durable, attributable, and explicit about untested scope.

#### UX-013 — Missions presents decoration before reliable leadership evidence

Status: **In progress 2026-07-13.** User-facing vocabulary presents Missions, Spok is explicitly the leader, and leader checkpoints, blockers, evidence gaps, budgets, and canonical state reasons precede the collapsed optional team map. The control room now loads durable Mission v1 records through a dedicated client, including milestones, work items, authority/budget receipts, evidence, checkpoints, and recovery states; focused client tests cover successful projection and unavailable/invalid evidence. Internal `enterprise` identifiers remain migration-only. The finding stays open for scheduler/supervision wiring, full direct interaction/accessibility evidence, and removal of remaining legacy orchestration paths.

The ASCII ship, crew avatars, rooms, telemetry, roster, turn rail, summary, and person inspector can dominate a mission that has zero actual lanes/events and no summary. Requested crew placeholders can look like agents even when no provider lane exists. The surface uses the same job/session/review lifecycle but does not yet have a durable long-project plan model.

Required outcome:

- coordinated work uses the standard project, mission, work-item, inbox, trace, review, and handoff primitives;
- Spok shows outcome, plan/checkpoint, critical blockers, evidence gaps, budget pressure, and next action before optional team visualization;
- requested, assigned, running, reported, failed, and synthesized agents are visually and semantically distinct;
- evidence and blockers precede decorative visualization;
- internal Enterprise-era contracts remain migration-only until state consistency, recovery, accessibility, performance, and core-loop reuse pass.

#### UX-014 — Mobile is neither a safe monitor nor a complete control surface

The phone shell claims connection while startup can be stuck, auto-switches to Thinking, provides a 40-line file preview rather than review evidence, hides validation/handoff/most settings, and uses “Change folder” as a globally destructive workflow. Desktop/mobile selection is a hard shell swap, not capability-aware responsive behavior.

Required outcome:

- define phone scope explicitly: fleet status, approvals, steering, stop, notifications, and evidence summary first;
- show connected/disconnected/stale with last successful sync and Retry;
- never imply that a local shell state is authoritative for host process state;
- provide review/validation summaries and safe handoff-to-desktop links rather than pretending truncated files are review.

#### UX-015 — Errors, loading, and disabled actions are passive

Many failures collapse into a toast, generic empty state, silent catch, or disabled button. Startup, CLI readiness, workspace absence, worktree loss, no session, no provider lane, plan-mode denial, and unavailable extensions do not share a recovery pattern. Toasts are transient and often contain the only explanation.

Required outcome:

- use durable inline problem states with cause, affected scope, retained safety, next action, and diagnostics link;
- disabled controls expose why and how to unblock them;
- transient toasts confirm completed actions but do not carry sole ownership of failures or policy denials;
- retry is idempotent and scoped.

#### UX-016 — Accessibility claims exceed current implementation

The interface repeatedly uses 9–10 px text and low-opacity accent colors, including operational labels. View/product buttons lack a consistent selected-state semantic. Session deletion is hover-only. The Windows-first app shows `⌘K` in the sidebar and `Ctrl+K` in the topbar. Dense tablists, ASCII telemetry, and raw content need screen-reader and zoom testing.

Required outcome:

- normal operational text is at least 12 px/appropriate native equivalent and meets WCAG AA in every theme;
- the core loop passes keyboard-only use, 200% zoom, high contrast, reduced motion, and screen-reader smoke;
- active navigation uses `aria-current` or the correct selected/pressed contract;
- icon actions have stable names, focus visibility, and non-hover discovery;
- shortcuts are platform-correct and remappable where conflicts exist.

#### UX-017 — Responsive behavior has an abrupt feature cliff

Below 768 px the app swaps to a different shell; above it, large modal dialogs and two-pane resizable workspaces assume substantial width. There is no tablet/compact-desktop hierarchy, and forcing desktop on phone exposes controls not designed for that viewport.

Required outcome:

- define compact, standard, and wide layouts by available space/capability rather than device label;
- replace wide modal management surfaces with responsive destinations or sheets;
- preserve task context and focus across layout transitions;
- test 390, 768, 1024, 1440 px, 100–200% scaling, touch, keyboard, and pointer combinations.

### P2 — Secondary Workflows And Verification Gaps

#### UX-018 — Automation is a modal control center tied to the current workspace

Fleet, schedules, channels, lanes, and compare are five tabs inside one modal. Queue creation depends on the active workspace; schedules only run while Spok is open; “Check schedules” exposes implementation mechanics. Closing the modal removes operational context.

Required outcome:

- make Automate a durable destination with repository scope and persistent selection;
- separate fleet operations from schedule/channel configuration;
- move scheduling to the supervised runtime before presenting unattended reliability;
- surface missed-run policy, next run, last result, credentials, isolation, and notification state.

#### UX-019 — Extensions are advertised before there is a user workflow

The empty Gallery instructs users to add files under `.agents`, `~/.spok`, or plugin directories manually. Skills, plugins, MCP, hooks, trust review, installed state, and agents are mixed in a developer-oriented modal without install/configure/disable/recovery guidance.

Required outcome:

- hide or label incomplete extension categories as experimental;
- start with discover → inspect permissions → install/enable → invoke → audit → disable/recover;
- distinguish project-scoped instructions from executable extensions and remote servers;
- never make filesystem surgery the primary empty-state CTA.

#### UX-020 — Settings has weak draft and scope behavior

User/project scope, five sections, Save, Reload, Reset, and live theme preview share one modal. Project scope can be disabled without an explanatory action. Closing can discard draft fields while leaving live preview effects applied. Unsaved-change state and save success are not persistent.

Required outcome:

- show current scope and inheritance at all times;
- indicate dirty fields, validate inline, and guard close/scope switches;
- preview appearance reversibly and restore the saved theme on cancel;
- require confirmation for reset and report exactly what changed.

#### UX-021 — Import/export and diagnostics are utilities, not lifecycle evidence

Import, export, and diagnostics are icon/dialog actions disconnected from the session's provenance, schema compatibility, redaction status, and handoff. Export failure is a toast; imported/replayed content can look like live work.

Required outcome:

- visibly label live, restored, imported, sample, and replay sessions throughout;
- preview schema/provider compatibility, redactions, omitted artifacts, and trust limitations;
- place evidence export and diagnostics in the session lifecycle with durable success/failure records.

#### UX-022 — Current UI tests can miss catastrophic UX failures

The smoke suite asserts that “SPOK” appears before proving hydration completed. Several workspace tests conditionally skip when the sample button is unavailable, so an infinite restore can leave the suite superficially green. There is no E2E coverage for mobile lifecycle cancellation, status contradictions, destructive confirmations, keyboard core loop, responsive layouts, or recovery states.

Required outcome:

- define a `shell-usable` contract and fail if startup does not reach it;
- do not conditionally skip required core-loop assertions based on missing UI;
- add success plus failure/recovery E2E for launch, restore, approval, stop, review, handoff, archive/cleanup, and phone disconnect;
- add automated accessibility checks plus manual screen-reader/high-contrast gates.

#### UX-023 — Agent management exposes mechanics while hiding execution truth

Status: **In progress 2026-07-13.** The provider foundation now exposes a sanitized, fingerprinted CLI capability snapshot and a fail-closed requirement result, including optional real leader health and explicit unknown auth state; raw inspect paths do not become mission UI state. This removes remembered CLI flags as a future source of optimistic launch state, but UX-023 remains open until the run spec, mission attachment, real-lane/reserve projection, supervision, synthesis, and previewed cleanup flow are wired and dogfooded.

The 2026-07-13 roadmap dogfood mission produced useful integrated work, but the operator still had to reconcile requested crew with actual Grok lanes, recover from worktree/continuation interruptions, preserve enough provider balance for synthesis, remove extra checkouts/artifacts, and ask for a role-attributed quality assessment. A configured crew can suggest parallel capacity that never existed, while raw agent activity is easier to find than ownership, remaining budget, integration status, or the single action required from the user.

Required outcome:

- start from the user outcome and let Spok propose the smallest dependency-aware team; naming agents is optional expert control;
- distinguish requested, assigned, provider-running, reported, verified, failed, replaced, and integrated states with direct provenance;
- show actual concurrency, queue pressure, remaining execution/synthesis reserve, worktree identity, and integration owner without exposing raw prompt administration by default;
- group equivalent approvals and ask the user only when authority, destructive scope, material cost, or the requested outcome changes;
- end with a previewed Git/cleanup handoff and a concise summary of Spok coordination, real agent contributions, leader verification/repairs, and remaining risk;
- prove the flow with a dogfood/E2E scenario covering lane mismatch, isolation failure, resource exhaustion, restart, synthesis, and clean repository inventory.

## Cross-Cutting Remediation Model

Work should land as six vertical slices:

1. **Recoverable shell:** fix hydration, explicit disconnected/error states, truthful stale shells, and non-skipping startup E2E.
2. **Safe lifecycle:** remove passive mobile cancellation, scope stop/delete/cleanup, separate restore from trust, and add previews/audit.
3. **Coherent control room:** make Missions the durable core destination, simplify primary navigation, canonicalize state/outcomes, and rebuild rows around the next safe action.
4. **Efficient agent leadership:** compile bounded CLI/work-item receipts, show real lanes and reserves, keep leaf context compact, and make Spok own retries, synthesis, and cleanup.
5. **Review-centered core loop:** simplify launch/composer, unify review evidence/validation/handoff, and make continuation preserve prior evidence.
6. **Accessible adaptive surfaces:** raise typography/contrast, complete keyboard/semantics, establish compact/standard/wide layouts, and then reshape Missions/Automate/Extend on shared primitives.

## Global UX Acceptance Criteria

- A fresh, restored, disconnected, corrupt, or slow startup reaches a usable or actionable state within 2.5 seconds.
- No run stops because a client hides, disconnects, reloads, navigates, or changes layout.
- Every stop/delete/archive/cleanup action is explicitly scoped; irreversible actions preview impact and require confirmation.
- Restoring or importing data grants no workspace trust or execution authority.
- Every inbox row shows identity, location, state reason, attention, and one safest next action.
- Process, task, review, and handoff states never contradict; every terminal outcome includes provenance.
- A new user can launch an isolated task in under 30 seconds without understanding worktree internals.
- Requested crew never masquerades as real concurrency; Spok preserves and displays an integration/recovery reserve and owns previewed cleanup.
- The full core loop works by keyboard and at 200% zoom; all themes meet AA for operational content.
- Compact, standard, and wide layouts preserve task context and expose the same safety state.
- Required E2E tests fail on missing/blocked UI rather than conditionally skipping.
- A mission with 100 jobs, 10 active lanes, and 10,000 hot events remains responsive; longer history restores checkpoint-first with bounded DOM and hot memory.

## Ownership Map

| Finding area | Primary owners |
| --- | --- |
| Startup/recovery | `src/hooks/use-session-hydration.ts`, desktop/mobile shells, session persistence client |
| Lifecycle/trust/destructive actions | mobile lifecycle/folder picker, runtime session APIs, workspace trust, inbox/archive cleanup |
| Navigation/state ontology | product modes/store, topbar/sidebar, session inbox, job/session/mission records |
| Launch/composer | launch dialog, directory navigator, prompt composer, settings/policy presentation |
| Review/evidence | diff/review queue, validation runner, Git completion/handoff |
| Missions/Automate/Extend | mission screen (`enterprise` migration module), monitor, extensions dialog, shared lifecycle contracts |
| Agent management/CLI efficiency | Grok command adapter, background runner, mission scheduler/domain, context artifacts, lane projection, Git/worktree handoff |
| Accessibility/responsive | global tokens/components, dialog/navigation primitives, desktop/mobile layout contracts |
| Verification | `e2e`, harness lifecycle tests, accessibility and responsive release gates |

## Closure Policy

A finding closes only when its user-visible outcome and failure/recovery path are covered by focused tests and direct interaction review. A component rewrite, visual refresh, or process exit alone is not closure. The product roadmap should cite finding IDs while work is active; completed details should move to tests and Git history rather than accumulating checklists here.
