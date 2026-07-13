# Desktop, Notifications, And Updater

Date: 2026-07-13

This document describes the current desktop glue and the updater plan. It should be read with `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md`: Tauri is an interim packaging shell, while the product target is native Windows UI plus the shared local runtime.

## Run Commands (dogfood)

| Command | What it does |
| --- | --- |
| `npm run dev:app` | Preferred contributor dogfood: supervised standalone runtime + Next UI with strict loopback proxying |
| `npm run desktop` / `npm run tauri:dev` | Next + Tauri WebView shell (interim daily driver) |
| `npm run tauri:build` | Packaged desktop binary (internal / unsigned unless signed) |
| `npm run dev` | Browser-only Next UI |
| `npm run runtime` | Standalone Node privileged API on loopback |
| `node scripts/dev-app.mjs --check` | Verify runtime/UI readiness and clean supervisor teardown |
| `npm run rust:path` | Ensure Rust/cargo on PATH (Windows) |

## What Runs Where Today

| Concern | Current implementation |
| --- | --- |
| Process spawn, Git, filesystem, policy, sessions | Shared Node runtime/domain code; core routes run standalone or through thin Next adapters. |
| UI | Next.js React app in browser or Tauri WebView. |
| Native folder picker | Tauri command `pick_folder`. |
| OS notifications | Tauri notification plugin plus `show_notification`. |
| Open/reveal paths | Tauri `open_path` and `reveal_path`. |
| Secrets | Node vault under `~/.spok/secrets`; OS keychain is future work. |
| Auto-update | Planned, not enabled for unsigned/internal builds. |

## Product Direction

The final desktop product should not depend on a browser tab, WebView, or Tauri as the primary UI surface. The native UI should supervise the local runtime and communicate over loopback HTTP or equivalent local IPC with the same capability-token and policy model. Its primary destination is Missions: a fast, durable control room where Spok leads long-running Grok work and the user sees plan, blockers, evidence, budget pressure, and the next safe action.

Closing or updating any client must not own or stop a mission. Before an update, the supervisor records mission/run state, reconciles pending approvals as interrupted rather than approved, and preserves managed worktrees. After restart, checkpoint-first recovery must show useful project state without replaying the entire event history.

Tauri can continue to be used for:

- Internal packaging tests.
- Folder picker and notification experiments.
- Deep-link prototypes.
- Updater experiments before the native shell is ready.

## Detecting Desktop

```ts
import { isDesktopRuntime, pickFolderNative } from "@/lib/desktop";
```

`isDesktopRuntime()` checks for Tauri internals. In normal `next dev` browser mode, native picker calls return `null` and the in-app directory navigator is used.

## Notifications

- The in-app notification drawer should always work.
- OS notifications require the user-facing setting to be enabled.
- Browser fallback uses the `Notification` API only if permission was already granted.
- Notifications are attention-ranked: approval/authority changes, blocked critical-path work, budget pressure, failed recovery, and review-ready outcomes outrank ordinary agent progress.
- Long missions coalesce routine progress; one agent event must not produce one OS notification.

## Protocol

- Scheme: `spok://`
- Event name: `spok-deep-link`
- Payload: full `spok://` URL string from process argv.
- Registration with Windows belongs to the installer or native product package.
- Invalid or untrusted links should fail closed.

## Updater

Auto-update is intentionally off until signing and release metadata are real.

Required before enabling:

- Signed artifacts.
- Versioned release endpoint.
- Embedded updater verification key or platform-equivalent signature verification.
- Rollback plan.
- User-visible release notes.
- Mission/runtime compatibility metadata and a tested checkpoint-first restart path.

Internal builds should use manual install/update and clearly state when they are unsigned.

## Daily Driver Defaults

- Theme: Professional.
- High contrast: available.
- Reduced motion: honors OS and in-app preferences.
- Permission mode: `manual`.
- LAN access: off unless explicitly enabled.
- Background missions: host-runtime owned; client hide/disconnect/update is never stop intent.
