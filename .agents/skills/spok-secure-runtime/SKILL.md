---
name: spok-secure-runtime
description: Use when implementing or reviewing Spok privileged runtime boundaries, local API routes, process spawning, filesystem browsing, git diff/status operations, workspace trust, permission modes, approvals, sandboxing, Tauri capabilities, CSP, environment handling, secret redaction, or audit logging. Trigger for src/app/api/session/start/route.ts, src/app/api/session/git-diff/route.ts, src/app/api/fs/browse/route.ts, src/lib/harness.ts, src/lib/grok-commands.ts, src-tauri, and security-sensitive roadmap work.
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
2. Define the policy before implementation.
   - trusted workspace roots
   - allowed command profile
   - path containment
   - secret deny/redaction rules
   - approval requirement
   - audit event shape
3. Canonicalize paths before comparing them.
4. Avoid shell execution. If Windows `.cmd` fallback is necessary, keep quoting deterministic and covered by tests.
5. Never expand privileges silently. If a request crosses policy, return a structured denial event.
6. Record every privileged action and approval/denial in the session event log.
7. Add tests with temp directories/repos and fake CLIs.

## Runtime Rules

- All privileged routes must require a local capability token and validate `Origin`/`Host`.
- `cwd` must be inside a trusted workspace root.
- Custom commands must be explicitly approved or matched by an allow rule.
- Environment overrides must be allowlisted; redact secrets in display and export.
- Filesystem browsing must not enumerate arbitrary drives after workspace selection unless the user explicitly opens a picker.
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
- Windows `.cmd` fallback argv preservation.

Run route/unit tests first. Run `npm run build` when route types or Tauri-facing config changed.
