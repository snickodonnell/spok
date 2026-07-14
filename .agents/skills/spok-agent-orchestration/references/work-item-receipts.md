# Mission And Work-Item Receipts

Use these compact structures as durable records and prompt inputs. Omit empty optional fields; link artifacts instead of pasting them.

## Mission Receipt

```yaml
mission_id: stable-id
outcome: one user-visible result
definition_of_done: [observable criterion]
constraints: [scope, compatibility, timing]
repository: { root: absolute-path, base: git-revision }
policy: { permission: mode, destructive: denied-or-approved-scope }
budget: { total: units, integration_reserve: units, recovery_reserve: units }
milestones: [id]
validation: [command-or-review]
next_checkpoint: event-or-time
```

## Work-Item Receipt

```yaml
work_item_id: stable-id
outcome: one independently verifiable result
owner: specialist-id
integration_owner: leader-or-agent-id
depends_on: [work-item-id]
scope:
  own: [path-or-component]
  exclude: [path-or-component]
execution:
  cwd: verified-worktree
  base: git-revision
  session_intent: new|resume-id|fork-id
  allow_subagents: false
authority: { permission: mode, tools: [allowed], destructive: false }
budget: { max_turns: number, token_or_cost: bound, retry: 0-or-1 }
context: [path, symbol, decision-id, artifact-id]
definition_of_done: [criterion]
checks: [exact-command-or-inspection]
return_when: complete|blocked|authority-needed|budget-pressure
```

## Specialist Return Packet

Keep prose under 600 words unless evidence requires more.

```json
{
  "outcome": "completed|partial|blocked|failed",
  "summary": "what changed and why",
  "changed_paths": ["path"],
  "checks": [{"command": "...", "result": "passed|failed|not_run", "evidence": "artifact/ref"}],
  "artifacts": ["durable/ref"],
  "risks": ["remaining risk or untested scope"],
  "next_action": "single recommendation"
}
```

## State Rules

- `requested` does not imply a process or provider lane.
- `reported` means the specialist returned a packet; it does not imply verification.
- `verified` means the integration owner reconciled the packet with repository/evidence state.
- `integrated` means the accepted result is present on the mission's integration revision.
- A retry creates a new attempt under the same work item and retains the failed attempt's evidence.
- A replaced agent never erases the prior owner, attempt, budget use, or failure reason.
