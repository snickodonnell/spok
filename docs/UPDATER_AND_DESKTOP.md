# Desktop, Notifications, And Updater

Date: 2026-07-10

This document describes the current desktop glue and the updater plan. It should be read with `docs/LOW_OVERHEAD_DESKTOP_ARCHITECTURE.md`: Tauri is an interim packaging shell, while the product target is native Windows UI plus the shared local runtime.

## What Runs Where Today

| Concern | Current implementation |
| --- | --- |
| Process spawn, Git, filesystem, policy, sessions | Next.js local API and shared library code. |
| UI | Next.js React app in browser or Tauri WebView. |
| Native folder picker | Tauri command `pick_folder`. |
| OS notifications | Tauri notification plugin plus `show_notification`. |
| Open/reveal paths | Tauri `open_path` and `reveal_path`. |
| Secrets | Node vault under `~/.spok/secrets`; OS keychain is future work. |
| Auto-update | Planned, not enabled for unsigned/internal builds. |

## Product Direction

The final desktop product should not depend on a browser tab, WebView, or Tauri as the primary UI surface. The native UI should supervise the local runtime and communicate over loopback HTTP or equivalent local IPC with the same capability-token and policy model.

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
- Important automation, validation, and review-ready events should be notification candidates once the event model is stable.

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

Internal builds should use manual install/update and clearly state when they are unsigned.

## Daily Driver Defaults

- Theme: Professional.
- High contrast: available.
- Reduced motion: honors OS and in-app preferences.
- Permission mode: `manual`.
- LAN access: off unless explicitly enabled.
