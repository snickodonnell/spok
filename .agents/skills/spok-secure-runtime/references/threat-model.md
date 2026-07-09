# Spok Runtime Threat Model

## Assets

- Source code in selected repositories.
- Files readable from the user's machine.
- Secrets in env vars, `.env` files, credentials, logs, and tool inputs.
- Git history, branches, remotes, and working tree changes.
- Provider auth state and CLI credentials.
- Exported session bundles.

## Trust Boundaries

- Browser UI to local Next API.
- Next API to OS process and filesystem.
- Tauri webview to native shell/plugin capabilities.
- Grok CLI output to Spok parser.
- Spok session export to external sharing.
- Future hooks/MCP/plugins to local runtime.

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

## Risky Defaults To Avoid

- Auto-approving all CLI actions in a normal checkout.
- Accepting arbitrary `command`, `cwd`, `args`, or `env` from the webview without policy.
- Returning drive roots and hidden directories by default.
- Reading untracked secret files into diffs or exports.
- Using shell invocation for normal process spawning.
- Letting hooks/plugins/MCP run before trust review.

## Audit Event Minimum Fields

- `type`: `approval_request`, `approval_decision`, `policy_denial`, `runtime_action`, or `redaction`.
- `timestamp`
- `sessionId`, `runId`, and `turnId` when available.
- `action`: spawn, browse, git, read-file, write-file, export, hook, MCP.
- `cwd` and normalized paths.
- `command` and argv when applicable.
- `policy`: matching rule or denial reason.
- `decision`: allow once, allow always, deny, or blocked by policy.
- `redactions`: categories and counts, never raw secrets.
