---
name: spok-grok-cli-operations
description: Operate and integrate the Grok CLI for Spok missions, including capability preflight, prompt transport, machine-readable streaming, sessions, leader backends, worktrees, bounded flags, trace/export evidence, retries, cleanup, and token-efficient handoff. Use when constructing or reviewing Grok invocations, running Grok Build agents, resuming/forking sessions, diagnosing CLI behavior, or changing Spok's Grok adapter.
---

# Spok Grok CLI Operations

## Purpose

Use Grok CLI as a structured execution provider, not as an opaque terminal command. Compile each run from an explicit receipt, keep context bounded, preserve provider identity, and return compact evidence.

Read [references/grok-cli-contract.md](references/grok-cli-contract.md) when selecting flags, session/leader/worktree commands, prompt transport, or cleanup behavior. Re-run the relevant `grok ... --help` before implementing against a newer CLI.

## 1. Preflight Once Per Mission

1. Record `grok --version` and `grok inspect --json` output or the explicit capability error.
2. If shared leader mode is requested, inspect leader health with machine-readable output before assigning lanes.
3. Verify authentication, repository trust, cwd, base revision, and worktree availability without launching the real task.
4. Report unknown balance/capacity as unknown. Do not infer it from process success or spend the integration reserve probing repeatedly.
5. Pin the discovered capability set to the mission so a mid-run CLI upgrade cannot silently change semantics.

## 2. Choose The Run Shape

- **New leaf:** isolated cwd, prompt file, streaming JSON, explicit maximum turns, deliberate effort, narrow permissions/tools, and no subagents.
- **Continuation:** resume the exact durable session when the work item is unchanged and its worktree still verifies.
- **Fork:** fork an exact session when exploring an alternative while retaining provenance.
- **Leader backend:** use only for multiple observable lanes that benefit from a shared backend; keep a direct bounded-run recovery path.
- **Best-of-N:** reserve for small, high-value decisions with a cheap judge. Never use it as routine parallelism.

Do not combine continuation flags ambiguously. Do not run concurrent leaves in the main checkout. Do not silently replace a denied or unsupported flag with broader authority.

## 3. Compile A Minimal Invocation

Start from the work-item receipt, then emit only supported flags. Prefer:

- `--prompt-file` or `--prompt-json` for non-trivial context;
- `--output-format streaming-json` for live ingestion;
- `--json-schema` for a compact JSON-only specialist/report turn when supported; it implies JSON output, so do not combine it with a live `streaming-json` requirement;
- `--max-turns`, reasoning effort, tool allow/deny, web policy, permission mode, and sandbox chosen per work item;
- `--no-subagents` for leaves and `--no-memory` when durable mission context already supplies the needed state;
- explicit `--session-id`, resume, fork, cwd, and worktree identity where the CLI supports them.

Never log the full prompt, secrets, or oversized argv. Show a redacted run receipt: executable, capability version, cwd/worktree, session intent, policy, budgets, and prompt artifact hash/path.

## 4. Stream, Supervise, And Recover

Parse provider events and retain raw lines outside the hot UI projection. Requested lanes become real only after provider evidence.

Use semantic failure handling:

- policy/auth/capability failure: stop and surface the exact corrective action;
- isolation failure: launch nothing;
- malformed report: request one format-only repair without repeating repository context;
- implementation/test failure: retry once only when a narrower prompt and remaining budget make success plausible;
- exhausted budget or unhealthy leader: checkpoint useful state and return control to Spok.

Use native trace/export only for diagnostics, evidence retention, or handoff. Summarize it; do not inject a full transcript into the leader's next prompt.

## 5. Close The Run

Require a compact result containing outcome, changed paths, checks, artifacts, unresolved risks, and next action. Reconcile it with Git and test evidence before acceptance.

Preview native worktree removal or garbage collection before applying it. Preserve dirty/unpushed work unless the user explicitly accepts its disposition. Remove prompt/report artifacts after their durable evidence is captured, and confirm the intended repository is the only remaining checkout.
