# Spok Security Posture

Date: 2026-07-09 · Phase 6 desktop product hardening

Spok is a **privileged local desktop harness**, not a multi-tenant web app. The Next.js API routes and Tauri shell can spawn processes, browse the filesystem, run git, and hold secrets. This document describes the security model, what is enforced, and how to test it.

## Trust model

| Boundary | Rule |
|---|---|
| Network | Privileged APIs only accept **local Host/Origin** (localhost / 127.0.0.1). |
| Capability | Every privileged route requires `x-spok-capability-token` from `GET /api/health`. |
| Workspace | Spawn and git write ops require **trusted cwd** (open-repo flow trusts a root). |
| Commands | Default allowlist is Grok + git profiles; custom binaries need approval. |
| Secrets | Diff/export redaction; vault at `~/.spok/secrets/` encrypted at rest. |
| Desktop | Tauri has **no** shell spawn/execute; process spawn stays on the Next bridge. |
| Grok login | **External.** Users authenticate with the native Grok CLI; Spok does not store Grok API keys or run OAuth. |

## Privileged routes

All of the following call `authorizePrivilegedRequest`:

- `/api/session/start`, `/api/session/git`, `/api/session/git-diff`
- `/api/fs/browse`, `/api/workspace/trust`
- `/api/settings`, `/api/approvals`, `/api/sessions/*`
- `/api/extensions/*`, `/api/automation/*`
- `/api/diagnostics`, `/api/secrets`

`GET /api/health` issues the capability token only when Host/Origin look local.

## Permission modes

| Mode | Intent |
|---|---|
| `manual` (default) | Safest daily driver; high-risk profiles need approval. |
| `plan` | Read-only: no agent spawn; git/browse only. |
| `acceptEdits` | Agent may run in trusted workspace; custom still gated. |
| `auto` | Auto-approve listed profiles; deny rules still win. |
| `bypass` | Dangerous; disposable envs only. |

Deny rules always win. Approval decisions are audited to `~/.spok/audit.ndjson`.

## Desktop (Tauri)

- **CSP** is explicit in `src-tauri/tauri.conf.json` (no `csp: null`).
- Capabilities: `core:default`, `shell:allow-open`, `notification:default`, event listen/emit.
- Custom commands: `pick_folder`, `show_notification`, `get_app_info`, `open_path`, `reveal_path`.
- No webview permission to spawn arbitrary processes.

## Secrets vault

- Path: `~/.spok/secrets/*.enc` + `.key` (AES-256-GCM).
- API: `/api/secrets` (list ids, get by id, put, delete) — capability required.
- Values never appear in diagnostics exports (counts only).
- Future: OS keychain via Tauri command with the same client API.

## Secret redaction

Heuristic scanners in `src/lib/security/secrets.ts` cover:

- Common credential file names (`.env`, keys, tokens)
- High-entropy token patterns in logs/exports
- Binary / oversized untracked file skips in git-diff

This is **not** a full DLP product. Treat exports as sensitive.

## Deep links & updater

- App protocol plan: `spok://` deep links (argv emission + frontend event). Full OS registration is release-checklist work.
- Updater is **documented** in `docs/RELEASE_CHECKLIST.md`; not auto-enabled until signing keys exist.

## How to test

```bash
npm test
# security tests cover policy, secrets redaction, vault round-trip
```

Manual checks:

1. Call `/api/fs/browse` without token → 401/403.
2. Open repo → trust root; spawn with untrusted cwd → denial.
3. Set permission mode to `plan` → spawn blocked.
4. Export diagnostics → no raw capability token or secret values.
5. Desktop: folder picker opens OS dialog; notifications appear when enabled.

## Residual risks

- Dev server on a shared machine is still a local privilege surface; do not expose port 3000 remotely.
- Trusted roots are process-local until re-open after restart.
- Heuristic redaction can miss novel secret formats.
- Windows file modes (`chmod 0o600`) are best-effort.
