# Spok Harness Audit And Roadmap

Date: 2026-07-09

Spok is already pointed in the right direction: it has a Next.js/Tauri shell, a Grok CLI launcher, streaming trace ingestion, a diff viewer, sample playback, prompt history, slash-command autocomplete, and a workspace-first UI. The current implementation is a strong prototype. To become a world-class Grok Build harness comparable in ambition to Codex and Claude Code, it needs a hardened execution boundary, durable session model, typed stream contracts, richer Git/worktree workflows, extensibility, and serious validation.

This audit is based on the current repo state, including the dirty working tree present before this document was created. Existing modified files were treated as source of truth.

## External Baseline

The feature baseline was checked against current official docs on 2026-07-09.

- OpenAI Codex manual: app features, worktrees, automations, CLI features, slash commands, skills, MCP, hooks, subagents, sandboxing, permissions, and record/replay.
- Claude Code docs: overview, settings, permissions, MCP, hooks, skills, subagents, and cross-surface workflows.

Useful source links:

- OpenAI Codex app features: https://developers.openai.com/codex/app/features
- OpenAI Codex CLI features: https://developers.openai.com/codex/cli/features
- OpenAI Codex slash commands: https://developers.openai.com/codex/cli/slash-commands
- OpenAI Codex skills: https://developers.openai.com/codex/skills
- OpenAI Codex MCP: https://developers.openai.com/codex/mcp
- OpenAI Codex hooks: https://developers.openai.com/codex/hooks
- OpenAI Codex sandboxing: https://developers.openai.com/codex/concepts/sandboxing
- OpenAI Codex permissions: https://developers.openai.com/codex/permissions
- OpenAI Codex subagents: https://developers.openai.com/codex/subagents
- Claude Code overview: https://code.claude.com/docs/en/overview
- Claude Code settings: https://code.claude.com/docs/en/settings
- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents

## Current Architecture

Spok is organized around these surfaces:

- `src/app/api/session/start/route.ts`: privileged local process bridge that spawns the Grok CLI and streams NDJSON envelopes.
- `src/app/api/session/git-diff/route.ts`: privileged git bridge that polls status, diffs tracked changes, and reads small untracked files.
- `src/app/api/fs/browse/route.ts`: privileged filesystem browser used by the workspace launcher.
- `src/lib/grok-stream.ts`: stateful Grok ACP/streaming-json ingestor that normalizes output to `StreamEvent`s.
- `src/lib/grok-commands.ts`: slash-command catalog and Grok CLI argument resolver.
- `src/lib/store.ts`: Zustand session materializer for trace nodes, file diffs, metrics, selections, prompt history, and UI state.
- `src/lib/diff-utils.ts`: line diff, unified diff rendering, unified diff parsing, and file tree construction.
- `src/components/session/workspace.tsx`: primary split-pane harness surface with trace, diff/log/overview, and prompt composer.
- `src-tauri/`: optional desktop shell, currently thin and permissive.

## What Is Working

- The app has a coherent harness loop: pick repo, launch CLI, stream output, parse events, display trace and diffs.
- The UI already has the right first screen for a development tool: workspace, trace, diff, log, and composer are immediately usable.
- Grok streaming-json and ACP-style updates are recognized in `src/lib/grok-stream.ts`, including thought/message coalescing and tool call/result linking.
- The prompt composer supports sticky flags, recent turns, stop, export, and slash-command completion.
- Git diff polling and final snapshots make file changes visible even when Grok does not emit structured file events.
- Samples and import flows give the app a usable demo and regression artifact shape.

## Audit Findings And Corrections

| Priority | Finding | Evidence | Recommendation |
|---|---|---|---|
| P0 | Privileged local APIs trust any caller that can reach the dev server. | `src/app/api/session/start/route.ts`, `src/app/api/fs/browse/route.ts`, and `src/app/api/session/git-diff/route.ts` accept browser requests without a session token, Origin check, workspace trust record, or path policy. | Add a local capability token, strict Origin/Host validation, per-session workspace trust, and route-level authorization. Treat these APIs as a privileged desktop bridge, not normal web APIs. |
| P0 | The launcher can spawn arbitrary commands in arbitrary directories. | `/api/session/start` accepts `cwd`, `command`, `args`, and `env` from the request body. | Introduce a permission model: allowed command profiles, explicit command preview, approval prompts, environment redaction, and per-workspace policy. Default to `grok` only until the user approves custom binaries. |
| P0 | Filesystem browsing exposes the whole machine. | `/api/fs/browse` lists home and drive roots, then returns directories from any path the process can read. | Restrict browsing to approved roots after initial selection, add workspace trust prompts, and avoid returning hidden/system folders unless explicitly enabled. In desktop mode, prefer native folder picker APIs. |
| P0 | `alwaysApprove` defaults to true. | `defaultGrokFlags()` in `src/lib/grok-commands.ts` sets `alwaysApprove: true`, and `baseFlagsArgs()` emits `--always-approve`. | Change the default to manual or auto-with-review. If `alwaysApprove` remains available, make it a deliberate per-run opt-in with warning text and visible status. |
| P0 | Tauri capabilities and CSP are too broad for a privileged desktop wrapper. | `src-tauri/capabilities/default.json` allows `shell:allow-spawn` and `shell:allow-execute`; `src-tauri/tauri.conf.json` sets `csp: null`. | Remove broad shell permissions until needed by a scoped command. Add a strict CSP. Move privileged actions behind explicit Tauri commands with allowlisted arguments. |
| P0 | Untracked file reading can leak secrets into the UI/export. | `git-diff` reads untracked files up to 512 KB and returns content directly. Trace metadata can also include raw tool input. | Add deny globs and secret scanners for `.env`, credentials, keys, lockbox files, and binary data. Redact before storing, rendering, exporting, or sending to hooks/plugins. |
| P1 | Sessions are in-memory and not append-only. | `src/lib/store.ts` stores session state in Zustand only; process registry is module-local. | Add durable session storage: append-only raw event log, normalized event log, materialized snapshot, and export/import compatibility. Support resume by session id. |
| P1 | Stream parsing is optimistic and under-tested. | `src/lib/grok-stream.ts` parses multiple formats by inference; `package.json` has no test script for parser fixtures. | Define a versioned event contract, validate with Zod or typed guards, preserve unknown raw events, and add fixture-based regression tests for Grok ACP and harness envelopes. |
| P1 | Diff parsing reconstructs file contents from hunks, which loses unchanged lines and rename/binary nuance. | `parseUnifiedDiff()` in `src/lib/diff-utils.ts` builds old/new content from diff hunks only. | Keep parsed hunks as first-class data, use git plumbing for full file contents when needed, support binary/rename/mode changes, and cap large diffs. |
| P1 | Stop and process lifecycle need stronger semantics. | Stop calls abort fetch and DELETE, while route cancellation also kills the child. There is no process tree kill, timeout, detached cleanup, or registry recovery. | Track process groups, kill child trees on Windows/macOS/Linux, add timeout and stale process cleanup, and persist process state transitions in the event log. |
| P1 | Slash commands are hand-maintained and may drift from Grok CLI. | `src/lib/grok-commands.ts` contains a static command list and assumed flags. | Generate or verify command metadata from `grok --help`, `grok <subcommand> --help`, or a checked fixture. Gate unsupported commands by detected CLI version. |
| P1 | No first-class Git operations beyond diff. | Current UI can refresh/copy/download diffs, but cannot stage, revert, commit, branch, push, or open PRs. | Add a Git panel with stage/revert by hunk, commit, branch/worktree, push, PR creation, and review comments. Every destructive Git action should require confirmation. |
| P1 | Worktree isolation is only a flag hint. | `/worktree` currently maps to `-w` in CLI args, but Spok does not own or visualize worktree lifecycle. | Add worktree creation/listing/handoff UI, branch naming, cleanup, status, and guardrails for dirty local checkout collisions. |
| P1 | The app lacks a durable settings and policy system. | Settings live in localStorage or session state; no project/user/managed scope. | Add layered settings: managed, user, project, local. Include permission rules, command profiles, env profiles, hooks, MCP servers, models, and UI preferences. |
| P2 | UI style is memorable but not yet accessibility-ready. | CRT effects, scanlines, dense glow, and low-contrast phosphor text dominate the interface. | Keep the retro theme as an option, but add a quiet professional theme, reduced motion, high contrast, and accessible focus/keyboard states. |
| P2 | No integrated terminal or command output panes beyond raw log. | Codex/Claude-style workflows rely on terminal context, background commands, and visible validation. | Add a terminal panel scoped to workspace/worktree with command history, running process list, and "send output to prompt" affordances. |
| P2 | No hook, MCP, plugin, skill, or custom-agent management UI. | Current repo has no extension registry or lifecycle hooks. | Implement an extension center with MCP servers, hooks, skills, plugins, and custom agents. Start with read-only discovery, then add install/configure flows. |
| P2 | Build/package quality is early. | No CI config, no route tests, no Playwright coverage, no release/update path; Tauri icon list includes `icons/henry.w@example.net`. | Add CI, e2e smoke tests, package verification, crash/error reporting, proper app icons, signing/update plan, and desktop-specific security review. |

## Immediate Correction Plan

1. Harden dangerous defaults.
   - Flip `alwaysApprove` default to false.
   - Add a visible permission mode selector.
   - Disable custom command execution unless explicitly approved.
   - Remove broad Tauri shell permissions until a scoped command bridge exists.

2. Add a local trust boundary.
   - Generate a per-process capability token at server startup.
   - Require it on all privileged API calls.
   - Validate `Origin` and `Host`.
   - Store trusted workspace roots and reject `cwd` outside them.

3. Protect local data.
   - Redact secrets from raw logs, tool metadata, diffs, untracked files, and exports.
   - Add deny patterns for credential files.
   - Add binary detection and size limits for file previews.

4. Make the stream contract testable.
   - Define `StreamEvent` schema in one place.
   - Add fixtures for Grok ACP, harness stdout/stderr, exit, file diffs, and unknown JSON.
   - Add a `npm test` script that runs parser/diff route tests.

5. Persist sessions. **Done (Phase 1).**
   - Append raw envelopes to disk (`raw.ndjson`).
   - Store normalized events separately (`events.ndjson`).
   - Rebuild Zustand state from events on import/resume.
   - Preserve backwards compatibility with current export JSON (v1 import + v2 export).

## World-Class Feature Catalog

### Runtime And Sessions

- Provider adapter architecture for Grok Build first, then optional Codex/Claude/OpenCode adapters.
- Durable append-only session log, normalized event log, materialized state snapshot, and replay.
- Resume by session id, continue latest, fork/branch a session, archive/delete, title/pin, and cross-repo session picker.
- Multi-session dashboard with foreground, background, completed, failed, and waiting-for-approval states.
- Process lifecycle: start, pause if provider supports it, stop, kill process tree, timeout, retry, and recover stale sessions.
- Stdin and queued prompt support for interactive CLIs.
- Integrated terminal scoped to workspace/worktree.

### Permissions And Safety

- Workspace trust prompts and trusted-root registry.
- Permission modes similar to manual, plan/read-only, accept-edits, auto, and bypass for disposable environments.
- Fine-grained rules for command names, command patterns, path reads/writes, network use, Git operations, and MCP tools.
- Approval overlay with full command preview, cwd, environment delta, file paths, risk label, and "allow once/always/deny" choices.
- Sandboxed execution where available; at minimum, policy enforcement before spawn and before filesystem/git bridge calls.
- Secret redaction in logs, traces, diffs, exports, hooks, and telemetry.
- Audit log for every privileged action and user approval.

### Trace, Replay, And Observability

- Versioned event schema with Zod validation and provider-specific raw event preservation.
- Rich trace graph: goals, plans, decisions, tool calls, tool results, edits, tests, subagents, approvals, hooks, MCP calls, errors.
- Token/context/cost estimates when provider data is available.
- Trace search, filters, bookmarks, collapsible phases, and "why did this file change?" reverse lookup.
- Replay controls with speed, scrubber, event inspector, and fixture export.
- Error taxonomy: provider errors, parser errors, harness errors, policy denials, Git errors, and app errors.

### Diff, Git, Review, And PRs

- Accurate Git status including staged, unstaged, untracked, renamed, deleted, binary, mode-only, and submodule changes.
- Monaco diff with hunk navigation, inline comments, stage/revert hunk, open file, copy path, and linked trace node.
- Branch/worktree creation, handoff between local and worktree, cleanup, and collision checks.
- Commit, amend, push, pull/rebase, create PR, update PR description, and view CI status.
- Code review mode that can ask the agent to inspect working tree changes and attach actionable comments.
- PR/issue connector integration through GitHub/GitLab MCP or native plugin later.

### Prompt And Command UX

- Slash-command registry generated from Grok CLI capabilities.
- Command palette with all app actions, provider commands, and extension commands.
- Composer history search, queued follow-up while a run is active, prompt templates, variables, file mentions, and image/file attachments where supported.
- Plan/goal panel with explicit review/approve/modify flows.
- Status line showing cwd, branch, worktree, provider, model, permission mode, context, and run state.

### Extensibility

- Repo-local skills under `.agents/skills`, plus user/global skills.
- Plugin packaging for skills plus MCP servers, hooks, app UI, command metadata, and assets.
- MCP management: add/list/remove/login, tool search, resources, prompts, OAuth/token auth, and approval rules.
- Hook lifecycle: session start/end, prompt submit, pre/post tool use, permission request, file changed, stop, subagent start/stop.
- Custom agents/subagents with tool restrictions, model settings, and optional worktree isolation.

### Automation And Parallel Work

- Background sessions visible from one screen.
- Scheduled tasks for recurring prompts and repo checks.
- Monitors for CI failures, dependency updates, issue changes, telemetry errors, and PR review feedback.
- Parallel subagent/team workflows with separate traces and merged summaries.
- Channels/webhooks that can push external events into a session.

### Desktop, Cloud, And Collaboration

- Hardened Tauri desktop shell with native folder picker, OS keychain, notifications, deep links, update flow, crash reporting, and strict CSP.
- Optional remote controller/app-server mode with authenticated WebSocket and local-only defaults.
- Shareable artifacts: session bundles, trace snapshots, review reports, logs, and reproducible fixtures.
- Team settings, managed policy, onboarding checks, and repo health diagnostics.

### Quality And Operations

- Unit tests for parser, event reducer, diff parsing, slash command resolution, and route policy.
- Route tests with temp repos and fake CLIs.
- Playwright e2e for launch/import/sample/diff/stop/export.
- Visual regression checks for desktop and mobile-ish window sizes.
- Performance budgets for large traces and diffs.
- CI on Windows first, then macOS/Linux if the desktop target expands.

## Development Roadmap

### Phase 0: Stabilize The Prototype

Target: 1 week

**Status (2026-07-09): Implemented in tree.** Safer defaults, privileged-route guards, trust registry, redaction, and `npm test` fixtures are in place. Remaining hardening (Tauri CSP/shell, durable trust store, full command approval UX) is deferred to Phase 2.

Deliverables:

- [x] `alwaysApprove` default changed to safe mode.
  - `defaultGrokFlags().alwaysApprove === false`; composer no longer treats missing flag as true.
  - Visible permission mode `<select>` + status badge in the prompt composer.
- [x] Local API capability token and Origin/Host checks.
  - Per-process token from `/api/health` (local Host/Origin only).
  - Privileged routes require `x-spok-capability-token` via `authorizePrivilegedRequest`.
  - Covers `/api/session/start`, `/api/session/git-diff`, `/api/fs/browse`, `/api/workspace/trust`.
- [x] Workspace trust registry with cwd containment.
  - In-memory `trustWorkspaceRoot` registry; open-repo flow calls `POST /api/workspace/trust`.
  - Spawn and git-diff reject `cwd` outside trusted roots (`untrusted_cwd`).
- [x] Secret redaction and deny globs for untracked files/logs.
  - `src/lib/security/secrets.ts` deny globs + scanners; git-diff skips/denies secrets/binary/large files.
  - Stream log/event redaction in harness; export path uses `buildExportPayload`.
- [x] `npm test` script with parser and diff smoke tests.
  - `tests/fixtures/grok/*`, stream/security/command unit tests via `tsx --test`.
- [x] README link to this roadmap.

Safer extras landed with Phase 0:

- Default command profile allows only `grok` / `SPOK_GROK_CMD` unless `SPOK_ALLOW_CUSTOM_COMMANDS=1`.
- Client-supplied `env` overrides on session start are ignored (process env only).

Known gaps / follow-ups (not Phase 0 blockers):

- Trusted roots are process-local (cleared on server restart); re-open repo to re-trust.
- Tauri shell capabilities and CSP remain Phase 2.
- Approval overlay and layered settings remain Phase 2.
- Secret redaction is heuristic; not a full DLP solution.

Acceptance criteria:

- [x] A browser tab without the token cannot browse files, spawn a process, or read git diffs.
- [x] A prompt with spaces still reaches Grok as one argv value on Windows (argv preserved; covered by command unit test + existing spawn design).
- [x] Parser fixtures pass under `npm test`.

### Phase 1: Durable Sessions And Event Contracts

Target: 2 weeks

**Status (2026-07-09): Implemented in tree.** Versioned events, append-only disk logs, replay restore, v1→v2 export migration, and parser unknown/error preservation are live. Session list UX shows restored/durable badges; app hydrates on launch.

Deliverables:

- [x] Versioned `StreamEvent` schema and parser fixtures.
  - `src/lib/stream-event-schema.ts` (Zod) with `version`, `provider`, `rawEventId`, `runId`, `turnId`, `severity`.
  - Fixtures under `tests/fixtures/grok/`; schema + replay unit tests.
- [x] Append-only session log on disk.
  - `~/.spok/sessions/<id>/{meta.json,events.ndjson,raw.ndjson,snapshot.json}` (override `SPOK_SESSIONS_DIR`).
  - Privileged APIs: `/api/sessions`, `/api/sessions/[id]`, `/api/sessions/[id]/events`.
- [x] Replay from session log.
  - Pure `replayEvents` / `applyEventToSession` in `session-replay.ts`; client hydration via `useSessionHydration`.
- [x] Backwards-compatible import/export migration.
  - Export v2 (`events` + snapshot); import accepts v1 snapshot and v2 event logs (`parseImportPayload`).
- [x] Explicit parser error events and unknown-event preservation.
  - `parser_error` type + `makeParserErrorEvent`; unknown JSON → system event with `meta.raw` / `meta.unknown`.

Acceptance criteria:

- [x] Closing and reopening the app can restore a session (disk log + hydrate).
- [x] Every rendered trace node can be traced back to one raw event envelope (`eventLog` / `events.ndjson` + `rawEventId`).
- [x] Fixture updates are required for parser behavior changes (covered by `npm test`).

Known gaps / follow-ups (not Phase 1 blockers):

- In-memory `eventLog` is capped (~8k); full history always on disk.
- Running process state is not resumed (status forced to ready/completed on restore).
- No multi-device sync; logs are local to the machine’s `SPOK_SESSIONS_DIR`.

### Phase 2: Secure Runtime And Settings

Target: 2 weeks

Deliverables:

- Layered settings model: managed, user, project, local.
- Permission modes and permission rules.
- Approval overlay for command, file, Git, and MCP actions.
- Scoped command profiles for `grok`, `git`, package scripts, and tests.
- Hardened Tauri capabilities and CSP.

Acceptance criteria:

- Custom command execution requires an explicit approval path.
- Deny rules block matching actions before spawn or file read.
- Approval decisions are recorded in the session audit log.

### Phase 3: Git, Worktrees, And Review

Target: 2-3 weeks

Deliverables:

- Accurate Git status model and large/binary diff handling.
- Stage/revert by file and hunk.
- Commit, branch, push, PR creation hooks.
- Worktree create/list/handoff/cleanup.
- Review mode with inline comments linked to trace nodes.

Acceptance criteria:

- A background worktree task cannot modify the local checkout.
- Users can inspect, stage, commit, and export changes without leaving Spok.
- Risky Git actions have confirmation and audit records.

### Phase 4: Extensibility Layer

Target: 3 weeks

Deliverables:

- Skill discovery under `.agents/skills`.
- MCP server registry and read-only tool listing.
- Hook lifecycle runner with trust review.
- Plugin manifest draft for packaging skills, MCP, hooks, and commands.
- Custom agent/subagent config model.

Acceptance criteria:

- A repo skill can guide implementation without bloating every prompt.
- A hook can run on session stop and add a trace event.
- MCP tools are visible with approval state before invocation.

### Phase 5: Automation And Parallel Agents

Target: 3-4 weeks

Deliverables:

- Background session queue and monitor panel.
- Scheduled prompts and recurring repo checks.
- Subagent trace lanes and merged summaries.
- Event channels/webhooks for external triggers.
- Notifications for completion, approval needed, and failures.

Acceptance criteria:

- Users can run multiple isolated tasks and compare results.
- Scheduled tasks run only inside approved workspace/worktree policies.
- Subagent results remain inspectable without polluting the main trace.

### Phase 6: Desktop Product Hardening

Target: 4 weeks

Deliverables:

- Native folder picker, keychain-backed tokens, notifications, app protocol, and updater plan.
- Quiet/professional theme, accessible contrast, reduced motion, and keyboard audit.
- Crash/error reporting and diagnostics bundle.
- Packaging/signing/release checklist.
- Playwright and visual verification suite.

Acceptance criteria:

- Desktop app can be used daily without relying on raw dev server affordances.
- Security posture is documented and testable.
- Release builds pass smoke tests on Windows.

## Suggested First Issues

1. ~~Add `tests/fixtures/grok/*.jsonl` and parser smoke tests.~~ **Done (Phase 0).**
2. ~~Replace `alwaysApprove: true` with safe default and visible permission mode UI.~~ **Done (Phase 0).**
3. ~~Add `createLocalApiToken()` middleware for privileged routes.~~ **Done (Phase 0) — `authorizePrivilegedRequest`.**
4. ~~Add `WorkspaceTrust` model and reject untrusted `cwd`.~~ **Done (Phase 0) — in-memory registry.**
5. ~~Add secret redaction utility and route it through logs, events, diffs, and export.~~ **Done (Phase 0).**
6. Replace static slash-command assumptions with generated/verified Grok command metadata.
7. Add durable `sessions/<id>/events.ndjson` and replay loader.
8. Harden Tauri capabilities and remove the invalid icon entry.

## Generated Implementation Skills

The repo now includes targeted skills under `.agents/skills`:

- `spok-harness-architecture`: use for roadmap execution and cross-cutting product architecture.
- `spok-stream-contracts`: use for parser, event schema, fixture, diff-linking, and replay work.
- `spok-secure-runtime`: use for privileged local APIs, process spawning, filesystem browsing, Git bridge, Tauri capabilities, permissions, and sandboxing.

Use these skills to keep future implementation passes consistent and to avoid re-discovering the same architecture and safety rules.
