# Spok Harness Competitive Development Plan

Last updated: 2026-07-10 (perf + progressive session restore)

This is the current product and engineering source of truth for making Spok a world-class Grok Build harness. Older audit snapshots and completed UI milestone trackers have been removed so planning stays focused on the next product leap.

## Product Goal

Spok should feel like the control room for Grok Build: fast to launch, reliable under long agent runs, safe around local privileges, and more legible than a terminal when an agent edits, tests, retries, or gets stuck.

The product target is not "a prettier log viewer." It is a harness that competes with Cursor and Claude Code by combining agent execution, trace understanding, review, workspace safety, and multi-session orchestration in one focused desktop experience.

## Competitive Baseline

The 2026 competitive bar is agent-first, multi-surface, and policy-aware.

- Cursor is positioning around agent-first coding, cloud agents, rules, MCP, skills/CLI, background review, and multiple concurrent agents.
- Claude Code spans terminal, IDE, desktop, web, GitHub, cloud/background sessions, visual diffs, scheduled tasks, MCP, hooks, skills, subagents, and fine-grained permissions.
- Both products are moving away from "single prompt, single transcript" and toward managed fleets of coding agents with review, policy, and workflow integration.

Spok's advantage can be narrower and sharper: Grok Build-specific execution, best-in-class trace causality, review ergonomics, mobile/LAN continuity, and a local-first security model.

Sources checked on 2026-07-10:

- Cursor docs: https://cursor.com/docs
- Cursor cloud agents: https://cursor.com/docs/cloud-agent
- Cursor 3 coverage: https://www.wired.com/story/cusor-launches-coding-agent-openai-anthropic
- Claude Code overview: https://code.claude.com/docs/en/overview
- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents

## Current Strengths

Spok already has the right product spine:

- A focused session shell for Grok Build with transcript, thinking, events, changes, review, validation, and Git surfaces.
- Durable session state with progressive snapshot-first restore, imported traces, live sessions, replay fixtures, slash command catalog checks, and test coverage around parser/stream/perf behavior.
- Shared privileged runtime under `src/server` with thin Next adapters and standalone `npm run runtime`.
- A local API security posture with loopback-only checks, bearer token auth, Origin validation, no-store JSON responses, **durable** workspace trust, and policy denial helpers.
- Stream/UI responsiveness work: rAF batching, virtualized lists, selective store subscriptions, active-tab mount for heavy panels.
- Mobile/LAN support with host session sync, mobile sessions, split panes, timeline, trace, diff, and artifact views.
- Product modes that let the UI shift between Harness, Inbox, Workspaces, Automations, and Extensions.
- A low-overhead desktop architecture plan that separates the Grok runtime from Next.js and targets native Windows UI for the final product.

## Immediate Corrections

These are the next corrections I would make before expanding scope.

### P0: Make Performance Measurable

- ~~Add a small performance telemetry layer~~ **Done (2026-07-10):** `src/lib/perf.ts` — boot, stream ingest burst, reduce, tab switch, memory heap samples; budgets in `PERF_BUDGETS`.
- ~~Add CI checks for fixture replay speed and stream ingestion throughput.~~ **Done:** `tests/perf/perf-budgets.test.ts` + `npm run test:perf`.
- ~~Ship a real responsiveness pass~~ **Done (2026-07-10):** batch reduce, selective Zustand selectors, mount-only-active workspace tabs, timeline marker cap, coarse large-file diffs, host/git poll pause when hidden — see Horizon 1 notes below.
- ~~Progressive session restore~~ **Done (2026-07-10):** snapshot-first materialize of last active session only; meta shells for the rest; lazy full load on select (`src/lib/session-hydrate.ts`, `use-session-hydration`).
- Budgets (enforced/soft in tests + product targets):
  - Cold launch to usable shell: under 2 seconds on a target Windows laptop.
  - Reopen recent session: under 500 ms to first useful content (**snapshot-first path**).
  - Stream ingest: under 16 ms main-thread work per burst after batching.
  - Large trace navigation: no visible frame drops for 10k event fixtures.
  - Diff tab switch: under 300 ms for common repo diffs.

### P0: Finish Runtime Extraction

Continue Track A from `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md`.

- ~~Complete the `src/server` extraction~~ **Done (2026-07-10) PR1b–1e core:** handlers under `src/server/routes/*`; Next routes are thin adapters.
- ~~Parity tests~~ **Done:** `tests/server/handler-extraction.test.ts` exercises shared handlers + `dispatchRequest`.
- ~~Standalone Node sidecar precursor~~ **Done:** `src/server/main.ts` + `src/server/router.ts` (`npm run runtime`, port `SPOK_PORT`/`7788`, loopback only). Remaining: full dogfood `dev-app.mjs` + SPA proxy (PR2 polish).

### P0: Stabilize The Review Loop

- ~~Keep the Changes and Review surfaces permanently visible as first-class work areas~~ **Done:** workspace right tabs (Changes / Review / Validation / Events / Health) with stable chrome + test ids.
- ~~Add a validation lane that shows tests, builds, command results, failures, retries, and approvals in time order.~~ **Done (2026-07-09):** workspace **Validation** tab + pure `buildValidationLane` (`src/lib/validation-lane.ts`, `src/components/session/validation-panel.tsx`). Filters, badge counts, jump-to-trace/file.
- ~~Link validation failures back to the event, file, command, and model message that caused them.~~ **Done** for trace nodes and file links; deeper hunk/prompt causal links remain Horizon 2.
- Preserve raw stream events beside normalized UI state so parser regressions remain diagnosable. (Raw Log tab virtualized; durable `eventLog` retained.)

### P0: Reduce UI Jank

- ~~Batch stream updates before React state commits.~~ **Done (2026-07-09 / tightened 2026-07-10):** pure batch `reduceStreamEvents` (single clone + mutate + freeze), rAF `stream-batch` with heavy-load frame skip (`src/lib/session-reduce.ts`, `src/lib/stream-batch.ts`).
- ~~Make trace/event lists fully virtualized~~ **Done (2026-07-10):** event graph tree + **thinking stream** + **raw log** virtualized (`@tanstack/react-virtual`).
- ~~Lazy-load Monaco and large diff renderers only when their tabs are opened.~~ **Done (2026-07-10):** workspace mounts **only the active right tab** (Changes/Review/Validation/Events/Health); Monaco remains dynamic-imported.
- ~~Stop full-session re-renders of shell chrome during stream.~~ **Done (2026-07-10):** field-level Zustand selectors on desktop shell, sidebar, metrics, status, timeline, composer, run card, usage meter.
- ~~Cap in-memory raw/event tails; timeline DOM markers.~~ **Done:** raw log 4k; restore event tail 80; timeline max 200 markers.
- ~~Add skeletons and stable dimensions for panels~~ **Done:** `PanelSkeleton` + fixed-height workspace tab chrome.
- ~~Audit mobile panels~~ **Done (pass):** mobile tab bar `min-h-14`, primary actions `min-h-11/12`, scroll ownership on main/run panes.

### P1: Make Security Durable

- ~~Persist trusted workspace roots intentionally instead of relying on process-local trust.~~ **Done (2026-07-09):** `~/.spok/workspace-trust.json` schema v1 via `src/lib/security/workspace-trust.ts`.
- ~~Store trust decisions with revocation UI and clear scope labels.~~ **Done:** Settings → Privacy trusted roots list + revoke; API `DELETE /api/workspace/trust`.
- Keep the local API loopback-only and token-gated.
- Audit logging: workspace trust grant/revoke write `workspace_trust` audit events; policy denials and spawn paths already audited.

## Development Plan

### Horizon 1: Fast, Stable Local Harness

Target: 2-4 weeks · **Status: core outcomes met (2026-07-10)** — remaining work is polish and dogfood packaging.

Outcome: Spok feels fast and dependable on real Grok Build sessions.

- ~~Finish Track A PR1b-PR1e runtime extraction~~ **Done (2026-07-10)** for session start, sessions, settings, approvals, git, git-diff, fs browse, trust, diagnostics, cli-status, health + standalone `npm run runtime`. Extensions/automation still Next-hosted (PR1e residual).
- ~~Add performance instrumentation and replay benchmarks.~~ **Done** (`src/lib/perf.ts`, `tests/perf`).
- ~~Introduce event ingestion batching~~ + ~~reducer profiling / perf telemetry~~ **Done** (batch reduce + stream batch marks).
- ~~Virtualize high-volume thinking stream and raw log panes~~ **Done**.
- ~~Make Monaco and heavy diff views lazy by default~~ **Done** (active-tab mount + dynamic Monaco).
- ~~Progressive / snapshot-first session restore~~ **Done:** last active full-materialize; sidebar shells; background snapshot fill; `listSessionMetas` no longer scans NDJSON; lean snapshots on disk.
- ~~Add an always-visible validation lane with command status, exit code, duration, and linked artifacts.~~ **Done** (Validation tab).
- ~~Prompt composer file attachments (images / PDFs / documents) with session-scoped storage and Grok ACP `--prompt-file` integration.~~ **Done (2026-07-10):** paperclip + drag/drop/paste; files under `~/.spok/sessions/<id>/attachments/`; vision via inline image blocks; docs via embedded text or `resource_link`.
- ~~Update E2E coverage~~ **Done (partial):** Playwright smoke covers workspace tabs + composer attach control after sample load.
- **Still open (Horizon 1 polish):** Hono + `dev-app.mjs` dogfood launcher (Track A PR2); optional efficiency diff mode setting; broader Playwright coverage for restore/stream.

### Horizon 2: Review Workbench

Target: 1-2 months

Outcome: Spok becomes better than a terminal for understanding and accepting agent work.

- Build a review queue that groups changes by intent, file, command, and risk.
- Add side-by-side and inline diff modes with keyboard review flow.
- Show "why this changed" by linking each hunk to trace nodes, tool calls, and prompts.
- Add file risk labels: generated, config, security-sensitive, test-only, unknown binary, large file.
- Add one-click validation recipes: test touched packages, run last failed command, run slash catalog check, build current workspace.
- Add review summaries that can be copied into PR descriptions.
- Add persistent issue markers for failed tests, policy denials, incomplete tool calls, and parser warnings.

### Horizon 3: Agent Mission Control

Target: 2-3 months

Outcome: Spok can manage many coding efforts at once.

- Add a session inbox with queued, running, waiting-for-approval, failed, and ready-for-review states.
- Support multiple concurrent Grok Build agents, each isolated by worktree and policy profile.
- Add worktree creation, branch naming, cleanup, and PR handoff flows.
- Add routine/scheduled runs for recurring maintenance tasks.
- Add run templates for common tasks such as fix CI, review branch, update dependencies, and implement issue.
- Add notification and remote-control channels for mobile/LAN handoff.
- Add session compare and replay so two agent attempts can be inspected side by side.

### Horizon 4: Extensible Workflow Platform

Target: 3-6 months

Outcome: Spok competes with Cursor/Claude Code on extensibility while staying Grok-first.

- Add MCP server management with trust prompts, health checks, per-server permissions, and live invocation logs.
- Add hooks for lifecycle events: session start, user submit, tool call, command complete, file changed, pre-commit, review ready.
- Add skills and project rules with visible scope, ordering, and conflict resolution.
- Add plugin packaging, install/update/remove UI, compatibility checks, and permission declarations.
- Add GitHub/GitLab integration for issues, PRs, check runs, review comments, and CI logs.
- Add IDE companion support for opening files, applying selections, and syncing diagnostics.
- Add enterprise policy profiles for allowed commands, network access, workspace trust, and secret redaction.

### Horizon 5: Native Product And Cloud-Ready Runners

Target: 6+ months

Outcome: Spok becomes a polished desktop product with optional off-machine execution.

- Complete the native Windows UI track from `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md`.
- Remove WebView from the end-user shell.
- Run the shared Node harness runtime as a supervised sidecar.
- Add cloud or remote runners with the same trace, policy, review, and replay contracts as local runs.
- Add team collaboration: shared sessions, review assignment, run history, policy templates, and audit export.
- Add provider adapters beyond Grok Build only after Grok Build support is excellent.

## UI/UX Priorities

The product should feel quiet, dense, and operational. It should not feel like a landing page, a decorative dashboard, or a generic chat wrapper.

### Shell

- Keep primary navigation predictable: Inbox, Workspaces, Harness, Automations, Extensions.
- Treat transcript, thinking, events, changes, review, validation, and artifacts as work surfaces with stable tabs.
- Maintain a clear session status model: idle, starting, running, waiting, blocked, validating, ready for review, failed, complete.
- Make mobile a real control surface, not a compressed desktop clone.

### Trace And Causality

- Make every visible change explainable.
- Let users travel from diff hunk to event to command to prompt to raw event.
- Preserve raw events for debugging while keeping the default view human-readable.
- Use compact labels, timestamps, durations, and status icons instead of verbose prose.

### Review

- Review should be the product's center of gravity.
- The user should be able to inspect, validate, approve, commit, or discard agent work without hunting through a transcript.
- Risk should be visible before the user opens a file.
- Validation failures should be grouped by actionable cause.

### Performance UX

- ~~Long sessions must stay responsive while data streams in.~~ **In place:** rAF batch + selective re-renders + virtualized lists (ongoing dogfood).
- Panels should not resize unexpectedly when new content arrives.
- Loading states should be local to the affected panel.
- ~~Heavy editors and diff viewers should appear only when needed.~~ **Done:** active right-tab mount.
- ~~Session reopen must not block on replaying every durable log.~~ **Done:** progressive snapshot-first restore.
- The UI should expose when the runtime is busy, blocked, or waiting for permission.

## Architecture Priorities

### Runtime

- ~~Shared runtime logic belongs in `src/server`.~~ **Done** for core privileged routes; extensions/automation extract residual.
- ~~Next routes should become adapters.~~ **Done** for extracted handlers.
- The desktop product should eventually run a native UI plus a local Node sidecar (Horizon 5 / Track B).
- The runtime must preserve raw stream contracts and normalized store contracts.

### Stream Contracts

- Parser fixtures should cover every supported Grok Build event shape.
- Unknown events should remain inspectable instead of disappearing.
- Diff linkage must remain causality-preserving.
- Replay/import/export should use versioned schemas.

### Security

- Default to least privilege.
- Make trust visible and revocable.
- Keep policy decisions explainable.
- Redact secrets before logs, telemetry, exports, and UI surfaces.
- Treat MCP, hooks, plugins, and remote runners as privileged extension points with explicit permissions.

## Competitive Feature Checklist

Spok should reach these capabilities before being called competitive:

- ~~Fast desktop launch and session reopen.~~ **Partial / strong:** progressive restore + stream/UI perf pass; formal cold-launch measurement on device still open.
- Multi-session inbox with concurrent agents. *(Monitor / automation jobs exist; full inbox UX still open.)*
- Worktree and branch orchestration. *(Git panel + worktree helpers exist; full orchestration UX still open.)*
- First-class review workbench with trace-linked diffs. *(Changes/Review + causal rail ship; Horizon 2 queue/recipes still open.)*
- ~~Validation lane with commands, tests, failures, and artifacts.~~ **Partial:** Validation tab ships tools/tests/builds/approvals/policy with jump-to-trace; artifact browser and one-click recipes still open.
- MCP management with permissioned invocation logs. *(MCP registry + trust basics ship; full management UI still open.)*
- Hooks, skills, and project rules. *(Discovery, attach, hooks run ship; conflict/ordering UI still open.)*
- ~~Mobile/LAN continuity.~~ **Done for dogfood:** host sync, mobile shell, `dev:lan`.
- GitHub/GitLab PR and CI integration.
- Native desktop shell without WebView for the end-user product. *(Horizon 5 / Track B.)*
- ~~Performance budgets and automated replay benchmarks.~~ **Done:** `perf.ts` + `tests/perf`.
- ~~Durable workspace trust and audit logs.~~ **Partial:** durable trust + revoke + trust audit events done; broader denial/mode audit coverage continues.
- Optional remote/cloud runners using the same local contracts.

## Documentation Policy

- This file is the current product roadmap.
- `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md` is the runtime/native desktop architecture plan.
- `docs/SECURITY_POSTURE.md` is the current security posture.
- `docs/RELEASE_CHECKLIST.md` is the release checklist.
- Historical handoff snapshots and completed UI milestone trackers should not be kept as active docs.
