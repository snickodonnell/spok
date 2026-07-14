---
name: spok-agent-orchestration
description: Plan, delegate, supervise, and synthesize Spok-led Grok multi-agent missions with dependency-aware work items, verified isolation, bounded authority and token budgets, truthful provider-lane state, compact context packets, retry policy, evidence reconciliation, user-friendly approvals, and clean Git handoff. Use for Enterprise/Missions work, long-project agent management, parallel execution, specialist prompts, checkpoints, or evaluating orchestration quality.
---

# Spok Agent Orchestration

## Purpose

Make Spok the accountable leader while specialists do narrow, parallel work. Optimize for useful evidence per token and for a user who should not have to manage chats, worktrees, retries, or cleanup.

Read [references/work-item-receipts.md](references/work-item-receipts.md) when creating mission, work-item, or return receipts.

## 1. Establish The Mission

Record the outcome, constraints, definition of done, repository/base, effective authority, validation plan, critical risks, and total budget. Reserve at least 20% for leader integration/validation plus one bounded recovery turn before assigning leaves.

Build a dependency graph. Delegate only ready work that is independent enough to run without concurrent edits to the same integration surface. Prefer the smallest useful team; an available lane is not a reason to create work.

If the user asks for “everything,” convert it into milestones and one next checkpoint. Do not ask the user to design the crew or translate provider terminology.

## 2. Issue Bounded Receipts

Every specialist receives a receipt with one outcome, owned/excluded scope, verified worktree, dependency inputs, authority, budget, checks, return condition, and report schema.

Context packets should point to repository paths, symbols, decisions, and durable artifacts. Do not paste the whole mission transcript, all skill bodies, or unchanged summaries. A leaf receives `$spok-grok-cli-operations` and `--no-subagents`; grant nested delegation only as a separately budgeted work item.

The integration owner owns shared contracts and conflict resolution. Specialists must not merge themselves, rewrite another lane, or clean another worktree unless their receipt grants it.

## 3. Supervise Truthfully

Track requested, assigned, provider-running, reported, verified, failed, and integrated as distinct states. Only provider-emitted lane/process evidence proves that an agent ran.

At checkpoints, show the user only:

- current outcome and reason;
- completed/active/blocked counts and real capacity;
- material budget or authority pressure;
- evidence gap or decision that needs attention;
- one safest next action.

Batch approvals that share scope and risk. Interrupt the user only when authority, destructive scope, material cost, or the requested outcome must change.

Retry once by default. Narrow the prompt using the actual error and reuse durable context references. Do not restart healthy siblings, create replacement lanes for cosmetic report defects, or spend the leader reserve rescuing low-value work.

## 4. Synthesize, Do Not Relay

The leader compares each report with repository state, diff ownership, tests, artifacts, and dependency criteria. Resolve overlaps, run integration checks, record untested scope, and reject unsupported completion claims.

Return packets stay compact: outcome, paths changed, checks/results, evidence, risks, and next action. Keep raw traces outside the leader's hot context unless diagnosing a specific failure.

A milestone becomes review-ready only when its dependency evidence and validation criteria are satisfied. Agent success, clean process exit, and review readiness are separate facts.

## 5. Hand Off Cleanly

Preview branch/worktree integration, conflicts, dirty files, unpushed commits, generated artifacts, and cleanup impact. Merge or commit only after reconciliation and risk-proportionate checks. Remove accepted temporary checkouts and artifacts, preserve unresolved work visibly, update source-of-truth docs, and confirm the repository is clean.

The final user summary distinguishes what Spok planned/coordinated, what each real agent contributed, what the leader independently verified or repaired, remaining risks, and the recommended next step.
