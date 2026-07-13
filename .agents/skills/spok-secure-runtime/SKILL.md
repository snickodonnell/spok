---
name: spok-secure-runtime
description: Use when implementing or reviewing Spok privileged runtime boundaries, delegated agent authority and budgets, local API routes, process spawning, filesystem/Git operations, trust, permissions, approvals, sandboxing, Tauri capabilities, secrets, audit logging, cancellation, or long-project recovery.
---

# Spok Secure Runtime

## Quick Start

Treat Spok's Next API routes and Tauri shell as a privileged local bridge to the user's machine. Before changing runtime code, read `references/threat-model.md` and identify what permission boundary the change affects.

## Workflow

1. Identify the privileged action:
   - spawn process
   - browse filesystem
   - read file content
   - run git
   - pass environment variables
   - call Tauri shell
   - export logs/diffs/traces
   - stop/cancel/archive/delete/cleanup one or many lifecycle records
   - create/retry/reassign a mission work item or expand its authority/resource budget
2. Define the policy before implementation.
   - trusted workspace roots
   - allowed command profile
   - path containment
   - secret deny/redaction rules
   - approval requirement
   - audit event shape
   - user-visible scope/impact preview and recovery behavior
   - mission/work-item dependency, retry, concurrency, time/token/tool budget, and escalation boundary
3. Identify the actual user intent signal. Page hide, unload, disconnect, freeze, timeout, navigation, client unmount, and layout transition are not authorization to stop or mutate work.
4. Canonicalize paths before comparing them.
5. Avoid shell execution. If Windows `.cmd` fallback is necessary, keep quoting deterministic and covered by tests.
6. Never expand privileges silently. Restore/import/read operations are authority-neutral; selecting or reopening a path must not implicitly trust it. If a request crosses policy, return a structured denial event.
7. Record every privileged action and approval/denial in the session event log.
8. Add tests with temp directories/repos and fake CLIs.

## Runtime Rules

- All privileged routes must require a local capability token and validate `Origin`/`Host`.
- `cwd` must be inside a trusted workspace root.
- Custom commands must be explicitly approved or matched by an allow rule.
- Environment overrides must be allowlisted; redact secrets in display and export.
- Filesystem browsing must not enumerate arbitrary drives after workspace selection unless the user explicitly opens a picker.
- Restored/imported sessions may be inspected without execution authority; hydration must not call a trust-grant path.
- Stop/cancel is scoped to a named session and run by default. Fleet stop is a separate explicit action and must never be inferred from folder selection or client lifecycle.
- Archive/delete/cleanup previews must include affected durable records, branch/worktree, dirty state, and unpushed commits. Irreversible or force paths require explicit confirmation.
- Permission escalation (`bypass`, `always approve`, broad allow rules) requires a visible scope/duration confirmation before state changes; a toast after mutation is insufficient.
- Child agents inherit no more authority than the mission and receive narrower work-item receipts where possible. They cannot grant trust, approve themselves, broaden cwd/env/commands, increase retries/concurrency/budget, or authorize cleanup.
- Restart/checkpoint restore is authority-neutral. Pending approvals expire; queued work resumes only after trust, policy, dependency, isolation, and budget are revalidated.
- Stall recovery and automatic retry must be bounded, audited, idempotent where possible, and unable to duplicate destructive work.
- Git diff preview must skip binary files, cap large files, and deny known secret paths.
- Tauri capabilities must be least privilege; do not keep broad shell spawn/execute permissions as defaults.
- CSP must be explicit in desktop builds.

## Verification

Add tests for:

- Untrusted route request without token.
- Invalid Origin/Host.
- `cwd` outside trusted root.
- command not allowed.
- env secret redaction.
- untracked `.env` file denial.
- binary/large file skip.
- process cancellation and child tree cleanup.
- client hide/disconnect/reload/layout change does not cancel a process.
- repository switching preserves unrelated runs and global stop requires explicit fleet intent.
- revoked trust remains revoked across session restore/import.
- scoped stop cannot cancel another session/run; destructive preview matches the audited affected identities.
- Windows `.cmd` fallback argv preservation.
- delegated work cannot exceed mission/work-item authority or budget;
- restart does not revive approvals or bypass dependency/isolation checks;
- bounded retry cannot launch duplicate destructive work.

Run route/unit tests first. Run `npm run build` when route types or Tauri-facing config changed.
