# Spok

Spok is a local-first mission-control harness for Grok Build (Grok 4.5). Spok leads long-running, multi-agent engineering projects: it plans work, delegates bounded assignments to real Grok agents, monitors dependencies and approvals, integrates results, gathers validation evidence, and keeps the project resumable through review and Git handoff.

The product goal is to be the most useful, user-friendly, and performant Grok Build harness in the world. The core promise is: state the outcome, understand Spok’s plan, leave safely, return to truthful progress, and review an evidence-backed result.

## Current Plan

- Product and performance roadmap: [docs/HARNESS_AUDIT_AND_ROADMAP.md](docs/HARNESS_AUDIT_AND_ROADMAP.md)
- Active UX audit and remediation contract: [docs/UX_AUDIT.md](docs/UX_AUDIT.md)
- Low-overhead runtime and native desktop architecture: [docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md](docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md)
- Security posture: [docs/SECURITY_POSTURE.md](docs/SECURITY_POSTURE.md)
- Release checklist: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- Desktop updater notes: [docs/UPDATER_AND_DESKTOP.md](docs/UPDATER_AND_DESKTOP.md)

The fast local harness and Review Workbench foundations are implemented: batched/virtualized streams, snapshot-first persistence, durable trust, trace-linked diffs, isolated background launch, a durable job ledger, concurrent approvals, fleet controls, an experimental Spok-led mission flow, and guided Git handoff. Direct dogfood testing also found release-blocking lifecycle, navigation, authority, accessibility, and adaptive-layout defects. The current milestone makes mission control truthful, fast, and usable before expanding the long-project engine.

## Why Spok

| Area | What Spok Provides |
| --- | --- |
| Grok Build sessions | Local session launch, live stream ingestion, durable session state, progressive restore, replay/import fixtures. |
| Spok-led missions | One accountable leader, real provider-emitted agent lanes, isolated execution, durable turns, evidence-first status, and same-worktree continuation. |
| Thinking and events | Human-readable thinking plus raw event inspection for trace debugging and parser regression work. |
| Changes and review | Diff, review, and Git surfaces built into the harness instead of left to a terminal scrollback. |
| Validation | First-class **Validation** tab: tools, tests, builds, run outcomes, approvals, and policy denials in time order with jump-to-event/file. |
| Safety | Loopback-only local API checks, bearer token auth, Origin validation, **durable** workspace trust and job recovery, worktree isolation, concurrent approval queue, policy denials, audit log, and no-store JSON responses. |
| Mobile/LAN | Host session discovery and phone-friendly session views for inbox, timeline, trace, diffs, and artifacts. |
| Extensibility | Skills, hooks, MCP registry foundations; roadmap covers full MCP management, plugins, GitHub/GitLab, and IDE companion flows. |

## Quick Start

Requirements:

- Node 20+
- npm
- Grok CLI / Grok Build tooling available on your path
- For desktop shell: Rust toolchain (used by Tauri interim packaging)

### Preferred contributor dogfood

```powershell
npm install
npm run dev:app
```

This supervises the standalone privileged runtime and existing Next UI, proxies extracted APIs over loopback, and shuts down both process trees together. Open the local URL printed by the launcher, usually `http://127.0.0.1:3000`.

Use `npm run dev` when working directly on residual Next-hosted APIs.

### Desktop (Tauri interim shell)

```powershell
npm install
npm run desktop
```

Same as `npm run tauri:dev`. First run compiles Rust deps and can take a while.

Production desktop package:

```powershell
npm run tauri:build
```

### Standalone runtime (privileged API only)

```powershell
npm run runtime
```

Listens on loopback (`SPOK_PORT` or `7788`). Used by the architecture plan as the shared backend for native UI later.

### Useful commands

```powershell
npm test
npm run test:server
npm run test:perf
npm run build
node scripts/dev-app.mjs --check
npm run verify:slash-catalog
npm run dev:lan
npm run lan:urls
npm run tauri:info
npm run rust:path
```

Use `npm run dev:lan` when testing from a phone or another device on the same network. `npm run lan:urls` prints the local and LAN URLs that the app can advertise.

## Product Surfaces

- Inbox: attention/running/queued/failed/review-ready lanes for foreground and isolated background work, including priority-aware queue position and capacity waits.
- Workspaces: trusted roots, workspace navigation, Git context, and project-oriented workflows.
- Harness: live Grok Build session control with transcript, thinking, events, changes, review, validation, and artifacts.
- Automations: recurring or scheduled harness work (monitor + schedules).
- Missions: Spok-led outcomes, real Grok agent evidence, durable turns, isolated continuation, leader summaries, blockers, review readiness, and one safe next action. The optional team map is secondary to operational evidence.
- Extensions: skills, hooks, MCP registry, and future plugins.

## Architecture

The current dogfood app is **Next.js + React** backed by a standalone Node runtime for extracted APIs and residual Next adapters, with an optional **Tauri** WebView shell. Privileged logic lives in TypeScript under `src/server` and `src/lib`. The long-term product is a **native Windows UI** talking to the same Node runtime over loopback HTTP—not a permanent WebView app.

Key areas:

- `src/app`: Next app routes, API adapters, shell pages.
- `src/components`: UI panels, mobile views, shell, workspace, review, shared controls.
- `src/lib`: stream parsing, stores, security, harness, Git, session hydrate/reduce/persist, shared state.
- `src/server`: privileged HTTP handlers + standalone `main.ts` runtime.
- `samples`: replayable stream fixtures.
- `tests`: parser, API, security, perf, session, stream, and regression coverage.
- `scripts`: catalog checks, LAN helpers, Rust path, automation scripts.
- `src-tauri`: interim desktop packaging only.

## Security Model

Spok is local-first. Local API routes are intended for trusted loopback or explicitly advertised LAN use during development. Sensitive operations must pass policy and trust checks before touching the filesystem, Git, process spawning, or session runtime state.

Security documentation lives in [docs/SECURITY_POSTURE.md](docs/SECURITY_POSTURE.md). Any work on process spawning, filesystem browse, Git operations, MCP, hooks, plugins, or remote runners should update that document and add focused regression coverage.

## Desktop Status

Tauri remains useful for internal packaging and updater experiments, but it is not the end-user performance target. The product direction is native Windows UI plus a shared local runtime. See [docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md](docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md) for the staged plan.

Daily driver commands today: `npm run dev:app` (standalone runtime + browser UI), `npm run desktop` (interim Tauri + Next), or `npm run dev` for direct Next work.

## Documentation Policy

Documentation should stay current and compact. Product direction and performance budgets belong in the roadmap, interaction defects in the UX audit, runtime details in the low-overhead architecture plan, delegation/security controls in the posture document, and release steps in the checklist. Snapshot handoff docs and completed milestone trackers should be removed or archived outside active docs.
