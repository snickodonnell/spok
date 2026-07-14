# Spok Security Posture

Date: 2026-07-13

Spok is a privileged local harness and multi-agent leader for Grok Build. It can browse workspaces, run Git, start and supervise agent sessions, store local secrets, and eventually manage MCP servers, hooks, plugins, and remote runners. The security model is local-first, least-privilege, visible to the user, and tested at the API boundary. Leadership never implies unlimited authority: every mission, work item, agent run, and retry is bounded by repository, policy, budget, and explicit user intent.

**Runtime extraction status:** shared privileged handlers live under `src/server/routes/*`. Core Next `src/app/api/**` routes are thin adapters, including the durable automation job ledger; schedules/channels, extensions, attachments, and secrets still have residual Next-hosted routes. `npm run dev:app` supervises the standalone loopback runtime and proxies extracted routes through the existing UI. Token, origin, workspace trust, policy, and audit expectations are unchanged for both hosts.

## Trust Model

| Boundary | Rule |
| --- | --- |
| Network | Privileged APIs accept loopback hosts by default. `SPOK_LAN_ACCESS=1` allows private LAN hosts for phone/tablet testing on the same trusted network. Public internet hosts remain denied. |
| Capability | Privileged routes require `x-spok-capability-token` from `GET /api/health`. |
| Origin | Browser-originated calls must come from allowed local or private LAN origins. |
| Workspace | Filesystem, Git write, and spawn operations must resolve inside a trusted workspace root. Trust is **durable** in `~/.spok/workspace-trust.json` (schema v1) and survives process restart. |
| Background isolation | Concurrent/unattended jobs that request isolation must create, trust, and verify a Spok-managed linked worktree before process launch. Failure runs no agent process and never falls back to the main checkout. |
| Job recovery | Active job records are sanitized and persisted before privileged preparation/process launch. On restart, stale in-flight work becomes an explicit interrupted failure; queued work resumes only while its workspace remains trusted. |
| Spok-led missions | Mission/work-item intent compiles into a durable v1 receipt with exact worktree/session/base identity, owned/excluded scope, bounded tools/permission/turns/tokens/retry, checks, return condition, and integration owner. Compilation and scheduling grant no trust or execution authority; trusted worktrees are revalidated, at least 20% remains reserved for integration plus a separate recovery reserve, and only dependency/isolation/approval/capacity/lock/budget-ready work may be selected. |
| Delegation | A child agent cannot broaden the leader’s policy, trusted roots, environment access, approval duration, destructive scope, or resource budget. Spok may narrow authority per work item; escalation returns to an explicit user decision. |
| Long-project recovery | Checkpoints and restored mission data are authority-neutral. Restart drops pending approvals, reconciles active runs, and never turns an old plan or retry instruction into fresh execution authority. |
| Concurrent approvals | Each pending approval is bound to one session/run and its abort signal. Cancelling a run denies/removes only its request; a later approval cannot supersede or revive another run. |
| Client lifecycle | Browser/phone hide, unload, disconnect, freeze, navigation, and layout changes are not user authorization to stop a run. Cancellation requires an explicit scoped action and audit event. |
| Restore/import | Restored or imported data is authority-neutral. It may be inspected without trust, but must never grant/re-grant workspace trust, approvals, command permission, or execution capability. |
| Destructive scope | Stop, archive, delete, worktree cleanup, and fleet actions identify affected session/run/job/worktree records. Global or irreversible actions require an impact preview and explicit confirmation. |
| Commands | Default command profiles are restricted. Custom or high-risk profiles require approval unless policy explicitly allows them. |
| Secrets | Secrets are stored locally, redacted from exports/logs where possible, and treated as sensitive even after redaction. |
| Desktop | Tauri is an interim shell. It must not gain arbitrary process spawn permissions. The long-term product is native UI plus the shared local runtime. |
| Grok login | External. Users authenticate through the native Grok CLI; Spok does not store Grok API keys or run Grok OAuth. |
| Grok invocation | Spok compiles a versioned, sanitized run receipt from discovered CLI capabilities. Non-trivial prompts use runtime-managed files/JSON rather than process argv; leaves receive bounded turns/tools/permissions and no nested delegation by default. Unsupported required capabilities fail before launch. |

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
- `/api/missions/*`
- `/api/diagnostics`
- `/api/secrets`

`GET /api/health` issues a capability token only when Host and Origin checks pass.

## Optional LAN Access

| Mode | How | Who can reach privileged APIs |
| --- | --- | --- |
| Default | `npm run dev:app` or `npm run dev` | This machine only through loopback hosts. |
| LAN | `npm run dev:lan` or `npm run start:lan` | Devices on the same private network that know the URL and can obtain a valid token. |
| Pin one host | `SPOK_ALLOWED_HOSTS=192.168.1.10` | That Host value plus loopback. |

LAN mode is for trusted local networks only. Do not port-forward or expose Spok to the public internet.

## Durable Workspace Trust

| Item | Detail |
| --- | --- |
| File | `~/.spok/workspace-trust.json` (or `$SPOK_HOME/workspace-trust.json`) |
| Schema | `{ "version": 1, "roots": [{ "path": string, "trustedAt": number }] }` |
| Paths | Stored via `canonicalizePath` (absolute, Windows drive letter normalized) |
| Grant | Explicit trust decision during workspace open / `POST /api/workspace/trust` with capability token; session restore/import is never a grant |
| List | `GET /api/workspace/trust` → `trustedRoots` + `roots` (with timestamps) |
| Revoke | `DELETE /api/workspace/trust` body `{ "path" }`; Settings → Privacy UI |
| Audit | `workspace_trust` events on grant and revoke in `~/.spok/audit.ndjson` |
| Containment | `isTrustedWorkspacePath` / `requireTrustedCwd` — path must equal a root or nest under one |

Trust is loaded from the durable file on first use and re-read when that file’s mtime/size changes (cross-process coherence for standalone runtime vs residual Next API). Mutations rewrite the file atomically. Refresh only materializes already-persisted roots — it never grants trust. Tests should set `SPOK_HOME` to a temp directory so durable writes do not touch the developer’s real home.

## Permission Modes

| Mode | Intent |
| --- | --- |
| `manual` | Default daily-driver mode. High-risk actions require approval. |
| `plan` | Read-oriented mode. Agent spawn and write operations are blocked. |
| `acceptEdits` | Agent may run in a trusted workspace, with custom profiles still gated. |
| `auto` | Auto-approves listed profiles while deny rules still win. |
| `bypass` | Dangerous mode for disposable environments only. |

Deny rules always win. Approval decisions and security-relevant state changes should be auditable.

Client presentation must show the effective policy and its scope before launch or escalation. A compact provider flag selector or transient toast is not sufficient consent for `bypass`, `always approve`, global stop, or destructive cleanup.

Mission launch and every material plan escalation must show the effective repository/worktree, permission mode, approval behavior, concurrency/resource budget, and destructive limits. A leader may schedule only work whose dependency, isolation, and authority requirements are currently satisfied.

## Grok CLI Invocation Boundary

The CLI adapter is privileged policy, not presentation convenience. Before mission launch it records the installed version/capability snapshot and compiles an immutable run spec with cwd/worktree, session intent, prompt artifact, output/report contract, maximum turns, model/effort, tool/web/sandbox policy, permission mode, subagent policy, and debug retention.

The landed v1 capability probe bounds subprocess time/output, requires local-route authorization plus a trusted cwd for detailed discovery, limits detailed execution to the configured Grok command, and returns sanitized summaries with content hashes rather than raw `inspect`/help output. It reports native CLI auth as unknown because the discovered inspect contract does not expose login state. Requirement support that is missing or unknown returns one corrective action and no launch authority; the immutable run spec pins the snapshot fingerprint and repeats capability/trust verification before spawn.

- Non-trivial prompts use deterministic runtime-owned `--prompt-file` or `--prompt-json` artifacts with atomic mode-restricted writes, containment/realpath/hash verification, idempotent retry, and bounded size. Audit, approval, process, and UI records contain artifact identity/hash/size only, never full secret-bearing prompt text or oversized argv. Ephemeral success/cancellation artifacts are removed; failed diagnostic evidence is retained and stale crash/approval artifacts are recovered.
- Live streaming and JSON-schema specialist reports are mutually exclusive launch contracts. Reports are size/shape/path bounded and redacted; normalized `agent_report` events are evidence only and cannot advance mission lifecycle without leader verification. Malformed output receives at most one format-only repair turn with no repository context replay.
- Unattended resume/fork identifies the exact session and verifies its worktree/base. Ambiguous “continue latest” is interactive only.
- Leaf agents cannot create descendants unless a separate work-item receipt grants bounded nested delegation.
- A leader backend is used only after health/capability inspection; failure produces an explicit checkpoint or denial, not broader fallback authority.
- Raw streaming/trace/export data is redacted and kept outside hot leader context. Retention is failure- or handoff-driven.
- Prompt/report artifacts and managed worktrees participate in previewed cleanup. Dirty/unpushed state is preserved unless its disposition is explicitly approved.

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

MCP servers, hooks, skills, project rules, plugins, GitHub/GitLab connectors, IDE companions, remote runners, and future specialist-agent profiles are privileged extension points. Before they are enabled broadly, each needs:

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
7. Queue an isolated job and confirm worktree-creation/policy failure launches no process and never uses the main checkout.
8. Restore/import sessions after revoking trust and confirm they remain inspectable but cannot spawn, browse, or run Git until the user explicitly trusts the workspace again.
9. Hide, reload, disconnect, freeze, or switch layout on phone/browser clients and confirm active host runs continue.
10. Attempt scoped and global stop/cleanup actions and confirm authorization, impact preview, audit identity, and unrelated-run preservation.
11. Delegate a work item and confirm its command, path, environment, approval, concurrency, and retry scope cannot exceed the mission receipt.
12. Restart during a long mission and confirm checkpoints remain inspectable while pending approvals and execution authority do not revive.
13. Compile a long/secret-bearing Grok prompt and confirm process argv, audit events, approvals, diagnostics, and UI show only a redacted artifact receipt.
14. Request a leaf descendant or unsupported CLI flag and confirm the launch is denied before spawn without falling back to broader policy or main checkout.
15. Resume/fork and clean up a mission, confirming exact session/worktree identity, dry-run impact, dirty/unpushed preservation, and prompt-artifact removal.

## Residual Risks

- A dev server on a shared machine remains a local privilege surface.
- LAN mode is only as safe as the local network and token handling.
- Durable job state reconciles after restart, but OS-level orphan-process reconciliation still depends on the future native supervisor/Job Object.
- Managed worktrees are preserved by default; intentional dirty/unpushed cleanup UX is still required.
- Phone lifecycle and repository-switch regressions remain release gates: required E2E asserts passive events issue no stop request and exact-checkout conflicts stay scoped to one named session.
- Restore/import trust neutrality remains a release gate: hydration contains no trust grant, and launch denial E2E proves folder selection alone grants no authority.
- Redaction can miss novel secret formats.
- Windows file permissions are best-effort.
- Future MCP, hooks, plugins, and remote runners increase attack surface unless each permission boundary is explicit and tested.
- Long-running autonomous retries can amplify mistakes or cost; work-item budgets, bounded retries, stall detection, and human escalation are required before unattended missions are promoted.
