# Spok Agent Operating Contract

These instructions apply to every agent working in this repository. Spok is the accountable leader; delegated agents supply bounded evidence.

## Required Skills

- Use `$spok-harness-architecture` for mission-control, roadmap, lifecycle, worktree, automation, performance, or cross-cutting product work.
- Use `$spok-grok-cli-operations` when constructing, launching, resuming, supervising, or cleaning up Grok CLI work.
- Use `$spok-agent-orchestration` when decomposing a mission, delegating work, setting budgets, supervising agents, or synthesizing results.
- Add `$spok-secure-runtime` for privileged routes, process/filesystem/Git authority, approvals, secrets, cancellation, isolation, or recovery.
- Add `$spok-stream-contracts` for provider events, lane provenance, trace state, replay, checkpoints, or high-volume stream work.

Read every selected skill completely before acting. Read only the references that the skill routes to; do not dump all skill bodies or repository history into a prompt.

## Mission Contract

Before delegating, record the outcome, constraints, definition of done, repository/worktree, effective authority, dependencies, validation plan, and total budget. Keep at least 20% of the available token budget for leader synthesis and one bounded recovery turn.

Delegate only work that is both useful and independently executable. Every work item must name:

- one owner and one integration owner;
- allowed files or subsystem plus explicit exclusions;
- verified worktree/cwd and base revision;
- dependencies and return condition;
- turn, token/time, tool, permission, and retry bounds;
- expected changes, checks, artifacts, and compact report format.

Leaf agents must not create subagents. A child may delegate only when its receipt explicitly grants a subagent budget and the leader can observe the resulting provider lanes.

## Grok CLI Contract

- Preflight the installed CLI and machine-readable capabilities before a mission; do not assume remembered flags or a healthy leader backend.
- Prefer `--prompt-file` or `--prompt-json` to large inline prompt arguments, and `streaming-json` to terminal prose.
- Give every leaf a bounded `--max-turns`, deliberate reasoning effort, narrow tools/permissions, and `--no-subagents`.
- Use exact session identity for resume/fork decisions. Never continue an ambiguous “latest” session in unattended work.
- Use native Grok session, leader, trace, export, and worktree commands where they strengthen provenance. Preserve raw transcripts only for diagnostics; return compact evidence to the parent.
- Concurrent or unattended work must use a verified isolated worktree. Isolation failure launches nothing and never falls back to the shared/main checkout.
- Preview worktree removal/garbage collection before applying it. Do not leave temporary repositories, branches, reports, or prompt artifacts after accepted handoff.

## Supervision And Reporting

Requested agents are not running agents. Only provider-emitted lane/process evidence changes an agent to running, reported, failed, or complete.

Agents report a concise packet: outcome, files changed, checks with results, evidence/artifacts, remaining risks, and recommended next action. Do not paste full transcripts, repeated plans, or unchanged context. The leader verifies reports against repository and test state before claiming review readiness.

Retry at most once by default, with a narrower prompt that names the observed failure. Do not spend the synthesis reserve to keep weak lanes alive. Escalate only when user authority, destructive scope, cost, or the requested outcome must change; otherwise choose the safest bounded recovery and continue.

Finish by reconciling all worktrees and branches, running risk-proportionate checks, updating source-of-truth documentation, committing intentionally, and confirming a clean repository.
