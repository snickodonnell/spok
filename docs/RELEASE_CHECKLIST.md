# Spok Release Checklist (Windows-first)

Phase 6 packaging and release plan. Use this before shipping a desktop build.

## Pre-release

- [ ] Version bumped in `package.json` and `src-tauri/tauri.conf.json` / `Cargo.toml`
- [ ] `npm test` green
- [ ] `npm run build` green
- [ ] Playwright smoke (`npm run test:e2e`) green against production build
- [ ] Diagnostics bundle downloaded and scanned for secrets
- [ ] Permission default remains `manual`; `alwaysApprove` false
- [ ] Tauri CSP present; no `shell:allow-spawn` / `shell:allow-execute`
- [ ] Icons valid (`32x32`, `128x128`, `icon.png`, `icon.icns`, `icon.ico`)
- [ ] README / SECURITY_POSTURE / roadmap status current

## Signing (Windows)

- [ ] Code-signing certificate available (EV preferred for SmartScreen)
- [ ] Set `certificateThumbprint` in `src-tauri/tauri.conf.json` → `bundle.windows`
- [ ] Configure timestamp URL for Authenticode
- [ ] Build: `npm run tauri:build`
- [ ] Verify signature on `.msi` / `.exe` with `signtool verify /pa`

Until a cert is available, ship **unsigned internal builds** only and document the SmartScreen warning.

## Updater plan

Spok does **not** enable auto-update until:

1. A public (or private) static endpoint serves `latest.json` + artifacts.
2. A Tauri updater pubkey is generated and embedded.
3. Releases are signed.

Recommended shape (when ready):

```json
// tauri.conf.json plugins.updater (enable only with real keys)
{
  "active": true,
  "endpoints": ["https://releases.example.com/spok/{{target}}/{{current_version}}"],
  "dialog": true,
  "pubkey": "<minisign public key>"
}
```

Until then: users update by installing a new build; in-app copy can link to release notes.

## Deep link / app protocol

- Scheme: `spok://` (e.g. `spok://open?cwd=C:\dev\repo`)
- Desktop shell already emits `spok-deep-link` when argv contains `spok://…`
- Register protocol with the OS installer / MSIX package in a later packaging pass
- Frontend should open workspace / session when event fires (graceful no-op if invalid)

## Smoke tests (human)

1. Launch desktop app (or `npm run desktop`).
2. Open repo via **native folder picker**.
3. Run a sample playback.
4. Launch a short Grok prompt if CLI available; stop cleanly.
5. Stage → commit path in Git panel (temp repo).
6. Cycle themes: Professional → CRT → High contrast.
7. Toggle reduced motion; confirm no flicker/scanlines.
8. Open Diagnostics; download bundle; confirm redaction.
9. Trigger background job; confirm OS notification if enabled.
10. Export session; re-import.

## Artifact layout

```
src-tauri/target/release/bundle/
  msi/   # Windows installer
  nsis/  # optional NSIS
```

Archive diagnostics + git SHA with the release notes.

## Rollback

- Keep previous installer for one version.
- User data under `~/.spok/` is forward-compatible; do not delete on upgrade.
