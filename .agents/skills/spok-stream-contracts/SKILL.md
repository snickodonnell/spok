---
name: spok-stream-contracts
description: Use when modifying Spok/Grok stream ingestion, multi-agent and mission lifecycle provenance, StreamEvent/TraceNode schemas, parser fixtures, replay/import/export, checkpoint materialization, diff-linking, raw event preservation, or high-volume trace state.
---

# Spok Stream Contracts

## Quick Start

Read `references/event-contract.md`, then inspect `src/lib/types.ts`, `src/lib/grok-stream.ts`, `src/lib/parser.ts`, and `src/lib/store.ts`. Make stream changes fixture-first whenever possible.

## Workflow

1. Capture the raw input shape.
   - Grok ACP `session/update`
   - Grok events JSONL
   - Spok harness envelopes
   - plain stdout/stderr
   - imported Spok native events
   - Spok mission/work-item/checkpoint envelopes and Grok subagent events
2. Add or update a fixture before changing parser behavior.
3. Normalize into `StreamEvent` without discarding unknown fields; preserve raw provider data in `meta` when useful.
4. Keep IDs stable for chunk coalescing and tool call/result updates.
5. Keep parent/child relationships explicit. Do not infer a parent if the inference can attach unrelated nodes.
6. Map provider/process events into a canonical lifecycle model. Keep mission, milestone, work item, agent run/turn, process status, task outcome, review readiness, and handoff outcome separate and retain the event/provenance that justified each transition.
7. Rebuild materialized state through `useSpokStore.applyStreamEvent`; avoid UI-only parser or optimistic terminal state.
8. Verify trace nodes, file diffs, raw log lines, session metrics, inbox lane, visible status reason, and next action all update consistently.
9. Keep append-only cold history separate from the bounded hot projection. Checkpoints reference source events and never discard unknown/raw provider data required for later diagnosis.

## Parser Rules

- Unknown JSON must become a visible `system` or parser diagnostic event, not disappear.
- stderr is not always an error; preserve it in raw logs and classify only when content or exit status proves failure.
- Tool calls should stay `running` until a matching result/update/exit resolves them.
- File events must link to a `FileDiff` and retain the trace node that caused the change.
- Timestamp handling must normalize seconds vs milliseconds and preserve provider timestamps when present.
- Diff parsing must not pretend partial hunk data is full file content unless the source really provided full content.
- Process exit is evidence, not automatically task success or review readiness.
- Requested/briefed subagents must not appear as emitted/running lanes until provider evidence exists.
- Agent reports cannot advance a work-item dependency or mission readiness without a Spok lifecycle transition tied to evidence.
- Contradictory terminal inputs must materialize an explicit diagnostic/needs-attention state with provenance; do not let the last UI writer silently win.
- Import/replay/restore retains source labels and never grants trust, approval, or execution authority.

## Verification

Add tests for:

- ACP thought/message chunk coalescing.
- Tool call followed by tool result using the same provider id.
- File-change event with old/new content.
- Harness stdout and stderr envelopes.
- Exit code handling.
- conflicting job/session/run/mission outcomes and their diagnostic resolution.
- process completed with no usable summary/evidence versus review-ready completion.
- requested subagent with no emitted provider lane.
- Unknown JSON.
- Imported native Spok event.
- Large or binary diff guard behavior when implemented.
- multi-agent task/message/report attribution, work-item dependency transitions, and checkpoint replay;
- 10k hot events plus a larger checkpointed history without unbounded materialized/render state.

Run the smallest relevant command, usually parser unit tests once they exist, then `npm run lint` or `npm run build` when types/UI contracts changed.
