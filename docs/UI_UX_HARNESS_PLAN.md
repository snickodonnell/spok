# Spok UI/UX Harness Plan

Date: 2026-07-09

> **Implementation handoff (through mobile dual-device demo):** [`docs/DEVELOPMENT_HANDOFF.md`](./DEVELOPMENT_HANDOFF.md)

## Inspection Summary

Spok is no longer a thin prototype. The repo now has a working Next/Tauri harness, durable sessions, policy-gated privileged APIs, Git/worktree operations, automation, extensions, diagnostics, theming, and good unit coverage. `npm test` passes 140 tests, and `npm run build` succeeds. The Playwright smoke tests all reported `ok`, but the `npm run test:e2e` wrapper timed out waiting for the command to exit, so the e2e lifecycle needs tightening.

The immediate opportunity is product coherence. The app has many of the right capabilities, but the UX still feels like several strong tools placed next to each other rather than one calm, obvious Grok Build workbench.

## Product Principles

1. Make the workspace the product.
   The first screen after opening a repo should answer: what is running, what changed, why it changed, what needs approval, and what can I do next?

2. Prefer visible state over explanatory prose.
   Permission mode, cwd, branch, worktree isolation, CLI readiness, run state, queue state, and dirty Git state should be obvious without reading paragraphs.

3. Treat trace and diff as one artifact.
   A world-class harness is not just "thinking on the left, diff on the right." It should let the user move between intent, action, file change, validation, and review comment without losing context.

4. Make advanced power feel progressive.
   Automation, extensions, MCP, hooks, custom agents, and schedules are valuable, but they should not compete with the main run loop until the user asks for them.

5. Build for daily use, not novelty.
   The professional theme should feel like a precise engineering instrument. CRT should remain a personality option, not the visual grammar of the default product.

## Correct Immediately

### 1. Recenter The Workspace IA

**Status (2026-07-09): Implemented.**

Current state (post-fix):

- Product modes **Run / Review / Automate / Extend** in the topbar (`productMode` in store).
- Right-side tabs renamed **Changes / Review / Events / Health** (`workspaceRightTab`).
- **Run status card** at the top of the workspace (status, cwd, branch, permission, CLI, dirty count, queue, stop).
- Left pane toggles **Thinking** (prose feed) vs **Events** (full event graph).
- Topbar de-duplicated (Import/Export icon-only; Monitor/Extensions via product modes).

Acceptance criteria:

- [x] A new user can identify the active repo, run status, permission mode, and changed-file count within 5 seconds.
- [x] There is one obvious primary action when idle (prompt Send) and when running (Stop / Queue).
- [x] High-level product modes appear once in the topbar (sidebar keeps secondary layout views only).

### 2. Turn Trace + Diff Into A Causal Workbench

**Status (2026-07-09): Implemented (v1).**

Delivered:

- `src/lib/causal-links.ts` — pure causal bundle builder (direct + reverse links, comments).
- **Why this change** drawer (`CausalRail`) + compact **Why** mini-rail on Changes.
- Event graph panel with "Touched files" reverse links from selected steps.
- Review comments surface in the causal drawer with jump-to-trace.

Acceptance criteria:

- [x] Selecting a changed file reveals the agent steps that produced it (when links exist).
- [x] Selecting a trace/event step reveals files it touched.
- [x] Review comments can link to a file path and optional trace step.

Follow-ups: hunk-level causal anchors; validation/test steps as first-class kinds.

### 3. Simplify The Composer Into A Run Cockpit

**Status (2026-07-09): Partially implemented.**

Delivered:

- Structured cockpit row: App permission, CLI Permission, Model, Run mode, Skills.
- Removed "yolo" labeling; **Always approve (high risk)** with warning toast.
- Follow-up queue is an ordered stack with edit / reorder / remove / clear.
- Slash picker shows group badges, examples, and risk labels (`risk: high|medium`).

Delivered (slash catalog):

- Checked fixture `tests/fixtures/grok/slash-commands.fixture.json`.
- `src/lib/slash-catalog.ts` verify + `parseGrokHelpCommands` + help coverage.
- Regression suite + `npm run verify:slash-catalog` / `slash-catalog:write`.

Acceptance criteria:

- [x] Permission state is visible but structured (not a dense flag dump).
- [x] Queue is editable and reorderable.
- [x] Static slash command drift has a fixture update path.

### 4. Quiet The Default Visual System

**Status (2026-07-09): Implemented (v1).**

Delivered:

- Professional tokens: neutral slate body text, restrained sage accent, no glows.
- `.panel-title` for non-mono hierarchy; badge tracking de-emphasized.
- Dialog shadow uses theme token (no CRT glow on professional).
- Responsive helpers for ≤900px / ≤1100px (causal rail, product mode nav).

Acceptance criteria:

- [x] Professional theme reads as an engineering desktop app.
- [x] High-risk states use amber/red more than chrome accent.
- [ ] Full screenshot baselines still deferred.

### 5. Tighten First-Run And Repo Launch

**Status (2026-07-09): Implemented (v1).**

Delivered:

- Welcome readiness strip: CLI probe + permission mode + trust note.
- Primary actions: **Open repo** and **Play sample** (Import secondary).
- Recent sessions list for continue.

Still open: richer trust UI at picker time (trust is still recorded on open via existing API).

Acceptance criteria:

- [x] Missing CLI is visible before launch; samples/import still offered.
- [x] Permission mode shown on first screen; trust implication noted.

### 6. Merge Diff And Git Into A Review Flow

**Status (2026-07-09): Implemented (v1).**

Delivered:

- Changes tab keeps stage/diff/causal; compact **commit readiness** strip + Open Review.
- Review tab hosts full Git panel with **Commit readiness** checklist blocking unsafe commit.
- `src/lib/review-readiness.ts` pure checklist (conflicts, staged, comments, secrets, isolation, run).

Acceptance criteria:

- [x] Stage while reading diff (existing + checklist visibility).
- [x] Commit readiness visible on Changes (compact) and Review (full).
- [x] Destructive Git actions still confirm + audit.

### 7. Reduce Dialog Density

**Status (2026-07-09): Implemented (v1).**

Delivered:

- Settings: left-nav sections, shorter copy, pref-row toggles, empty grants state.
- Monitor: shorter header; queue labeled Foreground queue; empty-state CSS pattern.
- Extensions: Gallery / Installed / Trust review / Agents; shorter titles/descriptions.

Acceptance criteria:

- [x] Dialog titles/labels carry the task without long paragraphs.
- [x] Trust review is a first-class tab with pending count.
- [x] Empty states use shared pattern (single next step where applicable).

### 8. Fix Verification Friction

**Status (2026-07-09): Partially implemented.**

Delivered:

- `usage-meter.tsx` uses primitive deps (no eslint-disable thrash).
- Playwright: `globalTimeout`, per-test timeout, `gracefulShutdown` on webServer.
- E2E smoke extended: welcome readiness, workspace/run card, product mode nav, Changes tab.
- Unit tests: causal links + product modes (**151** tests green).

Still open: full screenshot baselines; broader keyboard-flow e2e matrix.

Acceptance criteria:

- [x] Unit tests green (including new harness suites).
- [~] E2e lifecycle hardened; verify exit on Windows after next full run.
- [ ] Visual regression baselines deferred.

## Long-Term Feature Plan

### Horizon 1: Product Coherence

Target: 2-4 weeks

**Status (2026-07-09): Complete (v1) — remaining polish is Horizon 2+.**

- [x] Workspace IA rebuild around Run, Review, Automate, Extend.
- [x] Unified run status header (approval still via existing overlay/settings).
- [x] Trace/diff causal links as a core interaction (v1 rail + event graph).
- [x] Composer cockpit with structured controls + slash fixture verification.
- [x] Professional theme polish and responsive layout helpers.
- [x] First-run repo launcher with CLI readiness and trust note.
- [x] Dialog density pass (Settings / Monitor / Extensions).
- [x] Pre-commit readiness checklist on Changes + Review.

### Horizon 2: Review-Grade Harness

Target: 1-2 months

- Changes workbench with file tree, Monaco diff, hunk staging, causal trace, review comments, and validation status in one flow.
- Pre-commit and PR readiness checklist.
- Integrated terminal scoped to workspace/worktree with "send output to prompt."
- Validation lane for tests/build/lint, including background command tracking.
- Replayable session review mode with timeline scrubber, bookmarks, and event inspector.

### Horizon 3: Parallel Work And Automation

Target: 2-3 months

- Worktree-first background jobs with automatic branch naming, cleanup, and collision protection.
- Monitor as a true mission control surface: queue, schedules, lanes, comparisons, approvals, and outcomes.
- Subagent lane comparison with merged summaries and per-lane diffs.
- Recurring repo checks with notification routing and failure triage.
- Automation templates for common Grok Build workflows.

### Horizon 4: Extensible Platform

Target: 3-6 months

- Live MCP invocation with typed approval UX.
- Plugin install/update/uninstall UI with trust review and capability diff.
- Skill marketplace or curated local gallery with preview and attach semantics.
- Custom agent builder with tool scopes, model/permission defaults, and worktree policy.
- Hook debugger with dry-run previews, logs, and allow/deny rules.

### Horizon 5: Collaboration And Distribution

Target: 6+ months

- Shareable session bundles with redacted trace, diff, review comments, validation output, and replay metadata.
- GitHub/GitLab PR review integration for comments, CI, issue context, and PR description updates.
- Optional authenticated remote controller while preserving local-only defaults.
- Signed desktop releases, updater, crash report workflow, and release health dashboard.
- Provider adapter layer so Grok remains first-class while the core harness can support other agent CLIs later.

## North Star UX

The final experience should feel like this:

1. Open a repo.
2. See immediately whether Grok CLI, Git, trust, permissions, and workspace state are ready.
3. Give Grok a task.
4. Watch a readable thought stream while a structured event graph quietly builds underneath.
5. See every file change linked back to the reason, tool, approval, and validation that produced it.
6. Review, stage, commit, push, and open a PR without leaving the harness.
7. Send safe parallel work into isolated worktrees and compare outcomes.
8. Extend the harness with skills, agents, MCP, hooks, and plugins only when that power is useful.

That is the path from "feature-rich local harness" to "world-class Grok Build workbench."
