# Stream Event Contract

Spok should keep three layers separate:

1. Raw provider envelope: exact line or object received from Grok or the harness.
2. Normalized `StreamEvent`: versioned app event used by reducers, replay, import/export, and tests.
3. Materialized UI state: `Session`, `TraceNode`, `FileDiff`, metrics, selections, and file tree.

Materialized state must also expose lifecycle provenance. Project/mission state, milestone/work-item dependencies, agent lane, job status, session availability, process run status, task outcome, review readiness, and Git handoff are different dimensions; clients must not collapse them into a single optimistic `completed` flag.

## Current Normalized Event Fields

Defined in `src/lib/types.ts`:

- `type`: event kind, such as `thinking`, `tool_call`, `tool_result`, `file_change`, `diff`, `goal`, `system`, or `error`.
- `timestamp`: milliseconds since epoch after normalization.
- `id`: stable event/node id when available.
- `parentId`: explicit parent node id when available.
- `title`, `content`, `summary`: display text.
- `toolName`, `status`, `durationMs`: tool and lifecycle data.
- `path`, `oldPath`, `oldContent`, `newContent`, `diffStatus`, `language`: file-change data.
- `links`: explicit trace links.
- `meta`: raw or provider-specific details.
- `subagentId`: agent lane/thread identity.

## Phase 1 Contract Fields (implemented)

- `version`: normalized event schema version (`STREAM_EVENT_SCHEMA_VERSION = 1`).
- `provider`: `grok` | `spok` | `import` | `harness` | `unknown`.
- `rawEventId`: pointer into append-only raw / normalized log sequence.
- `runId` and `turnId`: optional process/turn identity (stamped when available).
- `severity`: `debug` | `info` | `warn` | `error` | `parser` | `runtime` | `policy`.
- `redactions`: count of secret redactions applied to the event.
- `parser_error` event type for explicit parse failures (maps to error trace nodes).

## Future Contract Additions

- `approvalId`: link privileged action to approval record.
- `worktreeId` and `branch`: link events to isolation context.
- Stronger Zod-driven adapter boundaries per provider.
- `lifecycle`: versioned transition record with dimension (`job`, `session`, `run`, `turn`, `task`, `review`, `handoff`), from/to state, reason, source event id, and timestamp.
- `terminalOutcome`: `succeeded` | `failed` | `cancelled` | `interrupted` | `inconclusive`, distinct from process exit and review readiness.
- `reviewReadiness`: `not_ready` | `needs_attention` | `ready` | `accepted`, with validation/finding provenance.
- mission identities: `projectId`, `missionId`, `milestoneId`, `workItemId`, `checkpointId`, and `agentRunId` where applicable.
- work-item transition evidence: dependency state, owner, authority/budget receipt, retry/replace reason, and Spok decision provenance.

## Reducer Invariants

- Applying the same event id twice should update the node, not duplicate it.
- A `tool_result` for an existing `tool_call` should update the tool node status unless the provider emits a distinct result node by design.
- A `file_change` must be visible in both trace and diff views.
- Metrics should be recomputed from materialized nodes/files, not incremented blindly.
- Import/replay/live mode should flow through the same reducer.
- A process exit must not set task success, review readiness, mission acceptance, or handoff success without the required evidence for that dimension.
- Requested/briefed subagents are metadata, not provider lanes; lane state begins only with a provider task/message/report event.
- Agent completion/report events are evidence only; Spok emits or records the separate work-item/milestone transition after reconciliation.
- Contradictory transitions preserve both inputs, emit a diagnostic, and choose a safe `needs_attention`/`inconclusive` materialization.
- Imported/restored events preserve source/provenance but confer no trust, approval, or execution authority.
- Checkpoint-first restore may materialize a bounded hot window, but source offsets/hashes and cold raw events remain addressable for replay and diagnosis.
