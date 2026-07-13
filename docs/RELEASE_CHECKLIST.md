# Spok Release Checklist

Date: 2026-07-12

This checklist covers the current internal web/Tauri packaging path and the future native Windows product path. Tauri is acceptable for dogfood and updater experiments. The end-user performance target is a native Windows UI supervising the shared local runtime.

## Release Types

| Type | Audience | UI surface | Status |
| --- | --- | --- | --- |
| Dev web | Contributors | Next.js browser UI | Current daily development path. |
| Internal desktop | Dogfood/internal testers | Tauri WebView shell | Allowed while runtime extraction and packaging are in progress. |
| Native desktop | End users | Native Windows UI plus local Node runtime | Product target from the low-overhead architecture plan. |

## Pre-Release

- [ ] Roadmap, UX audit, security posture, and architecture docs are current; no shipped behavior is still described more favorably than direct dogfood evidence.
- [ ] Version bumped in relevant package metadata.
- [ ] `npm test` green.
- [ ] `npm run build` green.
- [ ] `npm run test:server` green and `node scripts/dev-app.mjs --check` confirms runtime/UI readiness plus clean teardown.
- [ ] Playwright smoke green when UI behavior changed; required core-loop tests do not conditionally skip when expected UI is missing.
- [ ] Fresh, restored, slow, corrupt, and unavailable-runtime startup reaches a usable inbox or actionable recovery state within 2.5 seconds; no indefinite “Restoring” or “Connecting” state.
- [ ] Hiding, disconnecting, reloading, navigating, freezing, or changing layout on a client never stops an active host run.
- [ ] Opening/changing a repository never stops unrelated sessions or jobs; any conflict decision previews the exact affected run.
- [ ] Restoring or importing session data grants no workspace trust or execution authority.
- [ ] Job, session, run, turn, review, and handoff labels use the canonical state contract and do not contradict one another.
- [ ] Session/job/schedule archive or deletion and worktree cleanup preview impact; irreversible paths require explicit confirmation and are keyboard accessible.
- [ ] Slash catalog verification green when slash command docs or catalog code changed.
- [ ] Diagnostics bundle downloaded and scanned for secrets.
- [ ] Default permission mode remains `manual`.
- [ ] LAN access disabled unless explicitly testing `npm run dev:lan` or `npm run start:lan`.
- [ ] Tauri CSP present for internal builds.
- [ ] No Tauri `shell:allow-spawn` or `shell:allow-execute`.
- [ ] Trusted workspace and policy regressions covered by tests.
- [ ] Isolated background jobs create/verify a managed worktree and fail closed before process launch if isolation cannot be established.
- [ ] Durable automation ledger roundtrip, overwrite, redaction, trust denial, corrupt input, and interrupted-run reconciliation tests pass.
- [ ] Fleet capacity persists across restart; lowering it does not cancel active work, and queued rows explain capacity plus priority/FIFO position.
- [ ] Enterprise mission metadata, ordered turns, and accepted state roundtrip safely; requested crew never masquerade as emitted lanes; historical person traces remain inspectable; follow-up re-verifies the existing managed worktree and uses Grok continuation.
- [ ] Cancelling a run while it waits for approval removes that exact request and cannot later launch the process.
- [ ] Performance budgets checked when the release includes UI/runtime changes: `npm run test:perf`; manual smoke for progressive restore (last session opens without replaying every durable log), actionable restore failure, and live stream responsiveness.
- [ ] Core loop passes keyboard-only use, visible selected/focus semantics, AA contrast in every theme, reduced motion, 200% zoom, and screen-reader smoke.
- [ ] Compact, standard, and wide layouts are checked at 390, 768, 1024, and 1440 px without losing safety state or task context.

## Internal Tauri Build

- [ ] Icons valid: `32x32`, `128x128`, `icon.png`, `icon.icns`, `icon.ico`.
- [ ] Native folder picker works.
- [ ] OS notification toggle works.
- [ ] Open/reveal path commands are scoped and safe.
- [ ] Deep-link event emission still works for `spok://` argv.
- [ ] Desktop build is clearly labeled as internal if unsigned.

Until a signing certificate exists, ship unsigned internal builds only and document the Windows SmartScreen warning.

## Native Windows Product Build

Before an end-user native build ships:

- [ ] Shared runtime extracted from Next route handlers.
- [ ] Native host supervises the runtime lifecycle.
- [ ] Native UI talks to the runtime over loopback HTTP or equivalent local IPC with capability token protection.
- [ ] No WebView is required for the primary product shell.
- [ ] Pending approvals are dropped on runtime restart and surfaced with a UI banner.
- [ ] Native client implements the shared startup/recovery, state provenance, trust receipt, cancellation scope, archive/cleanup, and accessibility contracts; it does not copy unresolved React UX.
- [ ] Session reopen, large trace navigation, and diff review meet performance budgets.
- [ ] Installer owns protocol registration, runtime placement, and upgrade/rollback.
- [ ] Security posture is re-reviewed for native host privileges.

## Signing

- [ ] Code-signing certificate available. EV is preferred for Windows SmartScreen reputation.
- [ ] Timestamp URL configured.
- [ ] Installer and executable signatures verified with `signtool verify /pa`.
- [ ] Release artifacts archived with Git SHA, version, and diagnostics metadata.

## Updater

Auto-update stays disabled until:

1. Signed releases exist.
2. A release endpoint serves version metadata and artifacts.
3. The updater public key or equivalent verification mechanism is embedded.
4. Rollback behavior is documented and tested.

Internal builds can link to release notes and instruct users to install the new build manually.

## Deep Links

- Scheme: `spok://`
- Example: `spok://open?cwd=C:\dev\repo`
- Tauri currently emits `spok-deep-link` when argv contains a matching URL.
- Final protocol registration belongs to the installer or native product package.
- Invalid links should fail closed and show a non-destructive message.

## Human Smoke Test

1. Launch the selected build type.
2. Open a trusted workspace.
3. Start or replay a Grok Build session.
4. Inspect transcript, thinking, events, changes, review, and artifacts.
5. Run validation or replay commands relevant to the change.
6. Confirm denied operations are visible and understandable.
7. Export diagnostics and confirm redaction.
8. Reopen the app and verify recent session state.
9. Hide/reload/disconnect a monitoring client and confirm the host run continues; then exercise an explicit scoped stop.
10. Test mobile/LAN only when LAN mode is intentionally enabled, including stale/disconnected recovery and safe repository switching.
11. Complete the core loop by keyboard at 200% zoom and verify operational contrast in all themes.
12. Confirm release notes match the shipped behavior.

## Rollback

- Keep the previous installer or package for at least one version.
- User data under `~/.spok/` must be forward-compatible or migrated with a clear rollback note.
- Runtime schema changes need versioned migration and replay coverage.
