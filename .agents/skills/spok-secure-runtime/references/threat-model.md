# Spok Runtime Threat Model

## Assets

- Source code in selected repositories.
- Files readable from the user's machine.
- Secrets in env vars, `.env` files, credentials, logs, and tool inputs.
- Git history, branches, remotes, and working tree changes.
- Provider auth state and CLI credentials.
- Exported session bundles.
- Active agent processes, queued work, and unreviewed worktrees whose continuity is valuable.

## Trust Boundaries

- Browser UI to local Next API.
- Next API to OS process and filesystem.
- Tauri webview to native shell/plugin capabilities.
- Grok CLI output to Spok parser.
- Spok session export to external sharing.
- Future hooks/MCP/plugins to local runtime.
- Phone/browser/native client lifecycle signals to host process ownership.

## Required Controls

- Local capability token for privileged routes.
- Origin/Host validation.
- Workspace trust and cwd containment.
- Command allow rules and approval prompts.
- Path deny rules and secret redaction.
- Audit events for privileged actions.
- Least-privilege Tauri permissions.
- Explicit CSP.
- Size and binary guards for file previews.
- Explicit lifecycle intent and scope: disconnect/hide/unload is not stop authorization.
- Authority-neutral restore/import and explicit trust renewal.
- Impact preview and confirmation for global or irreversible stop/delete/cleanup.

## Risky Defaults To Avoid

- Auto-approving all CLI actions in a normal checkout.
- Accepting arbitrary `command`, `cwd`, `args`, or `env` from the webview without policy.
- Returning drive roots and hidden directories by default.
- Reading untracked secret files into diffs or exports.
- Using shell invocation for normal process spawning.
- Letting hooks/plugins/MCP run before trust review.
- Re-granting workspace trust while hydrating or importing old session metadata.
- Treating page hide, disconnect, freeze, navigation, or UI unmount as permission to stop host work.
- Stopping all sessions as a side effect of switching repository context.

## Audit Event Minimum Fields

- `type`: `approval_request`, `approval_decision`, `policy_denial`, `runtime_action`, or `redaction`.
- `timestamp`
- `sessionId`, `runId`, and `turnId` when available.
- `action`: spawn, browse, git, read-file, write-file, export, hook, MCP, stop, archive, delete, or cleanup.
- `scope`: affected workspace/job/session/run/worktree identities; global actions must say `fleet` explicitly.
- `cwd` and normalized paths.
- `command` and argv when applicable.
- `policy`: matching rule or denial reason.
- `decision`: allow once, allow always, deny, or blocked by policy.
- `intentSource`: explicit UI action/API caller; never synthesize intent from passive client lifecycle.
- `redactions`: categories and counts, never raw secrets.
