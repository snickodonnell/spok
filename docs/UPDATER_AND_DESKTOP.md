# Desktop shell, notifications, and updater

## What runs where

| Concern | Implementation |
|---|---|
| Process spawn / git / fs | Next.js local API (privileged) |
| UI | Next.js React app in webview or browser |
| Native folder picker | Tauri command `pick_folder` (`rfd`) |
| OS notifications | Tauri `tauri-plugin-notification` + command `show_notification` |
| Open / reveal paths | `open_path`, `reveal_path` |
| Secrets | Node vault `~/.spok/secrets` (AES-GCM); OS keychain later |
| Auto-update | Planned — see Release Checklist |

## Detecting desktop

```ts
import { isDesktopRuntime, pickFolderNative } from "@/lib/desktop";
```

`isDesktopRuntime()` checks Tauri internals. In pure `next dev` browser mode, native picker returns `null` and the in-app directory navigator is used.

## Notifications

- In-app drawer always works.
- When **Settings → Appearance → OS notifications** is on, important automation events also call `showOsNotification`.
- Browser fallback: `Notification` API only if already granted (no surprise permission prompts in web mode).

## Protocol

- Event name: `spok-deep-link`
- Payload: full `spok://…` URL string from process argv
- Registration with Windows is installer-owned (Release Checklist)

## Daily driver defaults (Phase 6)

- Theme: **Professional**
- CRT: optional
- High contrast: a11y option
- Reduced motion: honors OS + in-app toggle
- Permission mode: **manual**
