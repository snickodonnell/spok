# Grok CLI Contract For Spok

Verified against local Grok CLI `0.2.99 (b1b49ccb71) [stable]` on 2026-07-13. This is an integration aid, not a substitute for capability discovery. Re-check `--help` and update adapter fixtures when the installed version changes.

## Capability Map

| Need | CLI surface | Spok rule |
| --- | --- | --- |
| Capability/version | `grok --version`, `grok inspect --json` | Capture once per mission and fail visibly when required behavior is unavailable. |
| Prompt transport | `--prompt-file`, `--prompt-json`, `--single` | Prefer files/JSON for non-trivial prompts; keep inline prompts small. |
| Stream/report | `--output-format streaming-json`, `--json-schema` | Stream live work or request a compact typed JSON result. `--json-schema` implies JSON output; the compiler must not pretend it remains streaming. |
| Bounds | `--max-turns`, `--reasoning-effort`, `--tools`, `--disallowed-tools`, `--disable-web-search` | Compile from each work-item receipt; do not inherit accidental global breadth. |
| Delegation | `--agent`, `--agents`, `--no-subagents` | Leaves use `--no-subagents`; only the accountable leader receives a delegation budget. |
| Permission/context | `--permission-mode`, `--allow`, `--deny`, `--sandbox`, `--no-memory`, `--no-plan`, `--check` | Deny wins; use `--check` selectively for implementation lanes, not every specialist. |
| Session lifecycle | `--session-id`, `--continue`, `--resume`, `--fork-session`, `grok sessions` | Prefer exact identity. “Latest” is interactive convenience, not unattended provenance. |
| Shared backend | `--leader-socket`, `grok agent leader`, `grok leader ... --json` | Verify leader health and lane observability before use. |
| Isolation | `--cwd`, `--worktree`, `--worktree-ref`, `grok worktree` | Verify the isolated path/base before launch; never fall back to main. |
| Diagnostics | `--debug-file`, `grok trace`, `grok export` | Redact and retain only on failure, investigation, or deliberate handoff. |

## Invocation Patterns

Bounded leaf implementation:

```text
grok --cwd <worktree> --no-subagents --max-turns 8 --reasoning-effort medium --output-format streaming-json --prompt-file <brief.md>
```

Compact machine report when schema output is supported and live events are not required for that turn:

```text
grok --cwd <worktree> --no-subagents --max-turns 6 --output-format json --json-schema <report-schema-json> --prompt-file <brief.md>
```

Use `--resume <session-id>` only after checking that the recorded cwd/worktree and base still match the receipt. To branch an existing conversation, combine that exact resume/continue source with `--fork-session` and optionally name the new conversation with `--session-id <new-uuid>`. Use `--continue` only in an interactive flow where the selected latest session is visible to the user.

Before destructive cleanup, use the CLI's dry-run forms, such as `grok worktree rm ... --dry-run` and `grok worktree gc --dry-run`, then show dirty/unpushed impact before any forced action.

## Prompt Packet

A prompt file should contain only:

1. work-item identity and one-sentence outcome;
2. scoped repository facts and relevant artifact paths;
3. constraints, authority, exclusions, dependencies, and budget;
4. definition of done and exact checks;
5. compact response schema.

Target 8 KiB or less before attached source excerpts. Link to files and symbols instead of pasting them. Include prior transcript text only when it is itself evidence.

## Budget Defaults

Start a mission allocation at discovery 15%, specialist execution 50%, leader integration/validation 25%, and one recovery turn 10%. Adapt to the work, but never schedule the integration/recovery reserve into initial leaves.

Each leaf gets explicit maximum turns and a return condition. Stop early when the condition is satisfied, the task is blocked, authority is insufficient, or remaining budget cannot cover its required checks.
