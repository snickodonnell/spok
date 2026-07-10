# Spok Security Posture

Date: 2026-07-10

Spok is a privileged local harness for Grok Build. It can browse workspaces, run Git, start agent sessions, store local secrets, and eventually manage MCP servers, hooks, plugins, and remote runners. The security model is local-first, least-privilege, visible to the user, and tested at the API boundary.

The current implementation still uses Next.js route handlers for the local API. The runtime extraction plan moves shared privileged logic into `src/server` while keeping the same token, origin, workspace trust, policy, and audit expectations.

## Trust Model

| Boundary | Rule |
| --- | --- |
| Network | Privileged APIs accept loopback hosts by default. `SPOK_LAN_ACCESS=1` allows private LAN hosts for phone/tablet testing on the same trusted network. Public internet hosts remain denied. |
| Capability | Privileged routes require `x-spok-capability-token` from `GET /api/health`. |
| Origin | Browser-originated calls must come from allowed local or private LAN origins. |
| Workspace | Filesystem, Git write, and spawn operations must resolve inside a trusted workspace root. |
| Commands | Default command profiles are restricted. Custom or high-risk profiles require approval unless policy explicitly allows them. |
| Secrets | Secrets are stored locally, redacted from exports/logs where possible, and treated as sensitive even after redaction. |
| Desktop | Tauri is an interim shell. It must not gain arbitrary process spawn permissions. The long-term product is native UI plus the shared local runtime. |
| Grok login | External. Users authenticate through the native Grok CLI; Spok does not store Grok API keys or run Grok OAuth. |

## Privileged Routes

The privileged API surface must call the shared authorization helpers:

- `/api/session/start`
- `/api/session/git`
- `/api/session/git-diff`
- `/api/fs/browse`
- `/api/workspace/trust`
- `/api/settings`
- `/api/approvals`
- `/api/sessions/*`
- `/api/extensions/*`
- `/api/automation/*`
- `/api/diagnostics`
- `/api/secrets`

`GET /api/health` issues a capability token only when Host and Origin checks pass.

## Optional LAN Access

| Mode | How | Who can reach privileged APIs |
| --- | --- | --- |
| Default | `npm run dev` | This machine only through loopback hosts. |
| LAN | `npm run dev:lan` or `npm run start:lan` | Devices on the same private network that know the URL and can obtain a valid token. |
| Pin one host | `SPOK_ALLOWED_HOSTS=192.168.1.10` | That Host value plus loopback. |

LAN mode is for trusted local networks only. Do not port-forward or expose Spok to the public internet.

## Permission Modes

| Mode | Intent |
| --- | --- |
| `manual` | Default daily-driver mode. High-risk actions require approval. |
| `plan` | Read-oriented mode. Agent spawn and write operations are blocked. |
| `acceptEdits` | Agent may run in a trusted workspace, with custom profiles still gated. |
| `auto` | Auto-approves listed profiles while deny rules still win. |
| `bypass` | Dangerous mode for disposable environments only. |

Deny rules always win. Approval decisions and security-relevant state changes should be auditable.

## Desktop Boundary

Current Tauri permissions should stay narrow:

- Explicit CSP in `src-tauri/tauri.conf.json`.
- No `shell:allow-spawn` or `shell:allow-execute`.
- Allowed OS glue only: folder picker, notification, open path, reveal path, app info, and deep-link event emission.
- Process spawn, Git, filesystem browse, workspace trust, and policy remain in the local runtime/API layer.

The native desktop roadmap does not relax this boundary. A native UI may supervise the runtime, but privileged execution still goes through the same policy and audit model.

## Secrets

- Local vault path: `~/.spok/secrets`.
- API: `/api/secrets`, capability required.
- Diagnostics exports should include counts and metadata, not raw secret values.
- Redaction is heuristic and must be treated as a guardrail, not a DLP guarantee.
- Future OS keychain integration should preserve the same client API and audit behavior.

Redaction should cover common credential file names, token-like values, high-entropy strings, oversized files, binary files, and diagnostics exports.

## Extension Risk

MCP servers, hooks, skills, project rules, plugins, GitHub/GitLab connectors, IDE companions, and remote runners are privileged extension points. Before they are enabled broadly, each needs:

- A permission declaration.
- A trust prompt.
- Visible scope and revocation.
- Invocation logs.
- Secret redaction.
- Tests for denied and allowed paths.

## How To Test

```bash
npm test
```

Focused checks:

1. Call a privileged route without a token and confirm denial.
2. Call with an invalid Origin and confirm denial.
3. Open a trusted root, then attempt spawn or Git write outside it and confirm denial.
4. Set permission mode to `plan` and confirm agent spawn is blocked.
5. Export diagnostics and confirm no raw capability token or stored secret value appears.
6. Confirm Tauri config does not grant arbitrary process spawn.

## Residual Risks

- A dev server on a shared machine remains a local privilege surface.
- LAN mode is only as safe as the local network and token handling.
- Trusted workspace persistence is still being formalized in the runtime extraction plan.
- Redaction can miss novel secret formats.
- Windows file permissions are best-effort.
- Future MCP, hooks, plugins, and remote runners increase attack surface unless each permission boundary is explicit and tested.
