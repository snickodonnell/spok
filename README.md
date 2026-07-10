# Spok

Spok is a local-first harness for Grok Build. It turns agent runs into an inspectable workspace with transcript, thinking, events, diffs, review, validation, Git context, mobile/LAN control, and policy-aware local execution.

The product goal is a world-class Grok Build control room that can compete with Cursor and Claude Code on speed, review ergonomics, multi-session orchestration, and safe extensibility.

## Current Plan

- Product and performance roadmap: [docs/HARNESS_AUDIT_AND_ROADMAP.md](docs/HARNESS_AUDIT_AND_ROADMAP.md)
- Low-overhead runtime and native desktop architecture: [docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md](docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md)
- Security posture: [docs/SECURITY_POSTURE.md](docs/SECURITY_POSTURE.md)
- Release checklist: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- Desktop updater notes: [docs/UPDATER_AND_DESKTOP.md](docs/UPDATER_AND_DESKTOP.md)

## Why Spok

| Area | What Spok Provides |
| --- | --- |
| Grok Build sessions | Local session launch, live stream ingestion, durable session state, replay/import fixtures, and resume-oriented UI. |
| Thinking and events | Human-readable thinking plus raw event inspection for trace debugging and parser regression work. |
| Changes and review | Diff, review, and Git surfaces built into the harness instead of left to a terminal scrollback. |
| Validation | Planned first-class lane for commands, tests, failures, retries, approvals, and artifacts. |
| Safety | Loopback-only local API checks, bearer token auth, Origin validation, workspace trust, policy denials, and no-store JSON responses. |
| Mobile/LAN | Host session discovery and phone-friendly session views for inbox, timeline, trace, diffs, and artifacts. |
| Extensibility | Roadmap includes MCP management, hooks, skills, project rules, plugins, GitHub/GitLab, and IDE companion flows. |

## Quick Start

Requirements:

- Node 20+
- npm
- Grok CLI / Grok Build tooling available on your path

Install and run:

```powershell
npm install
npm run dev
```

Then open the local URL printed by Next.js, usually `http://localhost:3000`.

Useful commands:

```powershell
npm test
npm run build
npm run verify:slash-catalog
npm run dev:lan
npm run lan:urls
```

Use `npm run dev:lan` when testing from a phone or another device on the same network. `npm run lan:urls` prints the local and LAN URLs that the app can advertise.

## Product Surfaces

- Inbox: session queue, status, mobile entry points, and future multi-agent control.
- Workspaces: trusted roots, workspace navigation, Git context, and project-oriented workflows.
- Harness: live Grok Build session control with transcript, thinking, events, changes, review, and artifacts.
- Automations: recurring or scheduled harness work.
- Extensions: future home for MCP servers, hooks, skills, project rules, and plugins.

## Architecture

The current application is a Next.js app with a local API and browser UI. The architecture plan is to extract shared runtime logic into `src/server`, keep Next routes as compatibility adapters, and move the final desktop product to a native Windows shell supervising a local Node runtime.

Key areas:

- `src/app`: Next app routes, API adapters, shell pages, and product surfaces.
- `src/components`: UI panels, mobile views, shell navigation, workspace views, review surfaces, and shared controls.
- `src/lib`: stream parsing, stores, security helpers, harness/runtime adapters, Git helpers, and shared state logic.
- `samples`: replayable stream fixtures.
- `tests`: parser, API, security, UI, mobile, and regression coverage.
- `scripts`: catalog checks, LAN helpers, fixture utilities, and automation scripts.

## Security Model

Spok is local-first. Local API routes are intended for trusted loopback or explicitly advertised LAN use during development. Sensitive operations must pass policy and trust checks before touching the filesystem, Git, process spawning, or session runtime state.

Security documentation lives in [docs/SECURITY_POSTURE.md](docs/SECURITY_POSTURE.md). Any work on process spawning, filesystem browse, Git operations, MCP, hooks, plugins, or remote runners should update that document and add focused regression coverage.

## Desktop Status

Tauri remains useful for internal packaging and updater experiments, but it is not the end-user performance target. The product direction is native Windows UI plus a shared local runtime. See [docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md](docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md) for the staged plan.

## Documentation Policy

Documentation should stay current and compact. Product direction belongs in the roadmap, runtime details in the low-overhead architecture plan, security details in the posture document, and release steps in the checklist. Snapshot handoff docs and completed milestone trackers should be removed or archived outside active docs.
