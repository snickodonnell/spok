# Grok CLI And Agent Orchestration Correction Roadmap

Last updated: 2026-07-13

Status: active correction track. This document turns the 2026-07-13 Spok/Grok Build dogfood results into an implementation sequence. `HARNESS_AUDIT_AND_ROADMAP.md` remains the product source of truth; this document owns the detailed CLI and agent-management correction contract.

## Why This Track Exists

The dogfood mission produced substantial useful engineering work and the integrated repository passed broad verification. That is meaningful evidence that Spok can coordinate productive Grok work. It also exposed avoidable operator burden and resource waste:

- useful specialist output arrived, but requested agents and provider-emitted lanes were not always easy to distinguish;
- isolation failures and later cleanup required leader intervention instead of a predictable fail-closed lifecycle;
- the mission path used a large prose prompt and only a narrow subset of Grok CLI's session, schema, leader, worktree, and diagnostic capabilities;
- agents received insufficiently explicit file ownership, dependency, retry, and return receipts;
- resource/balance pressure arrived before synthesis and cleanup were complete;
- false restart/interruption signals and fragmented evidence made progress harder to judge than the repository state warranted;
- the user had to ask for consolidation, removal of extra repositories/folders, and a final quality assessment.

The correction is not “more agents.” It is a smaller, observable team using native CLI contracts, compact context, bounded authority, and leader-owned integration.

## Corrected User Promise

A user states the outcome and constraints once. Spok:

1. preflights Grok CLI capabilities, repository state, policy, isolation, and available execution capacity;
2. proposes the smallest dependency-aware plan and explains only material choices;
3. launches real isolated lanes with compact receipts and reserved synthesis budget;
4. reports truthful progress, one blocker/decision at a time, without exposing chat-management mechanics;
5. verifies agent claims against Git, tests, and artifacts;
6. merges, documents, and cleans up through a previewed handoff;
7. leaves one clean repository and a concise account of what Spok, Grok agents, and the integrating leader each did.

## Correction Principles

- **CLI capabilities are discovered, not remembered.** Pin version/capability evidence to the mission.
- **The adapter compiles a run receipt.** UI state and prose do not hand-build provider argv.
- **Provider truth wins.** Requested crew, spawned process, emitted lane, returned report, verified result, and integrated change are separate facts.
- **Leaf agents stay leaf agents.** Nested delegation requires a distinct receipt and budget.
- **Context is referenced.** Send paths, symbols, decisions, and artifacts; do not replay the whole transcript.
- **Integration budget is protected.** Initial scheduling cannot consume the leader's validation/recovery reserve.
- **Isolation fails closed.** No fallback from an intended worktree to main or another shared checkout.
- **Reports are typed and compact.** Raw streams remain diagnostic evidence outside hot leader context.
- **The user manages outcomes, not agents.** Spok handles lane selection, retries, integration, and cleanup within granted authority.

## Landed Foundation

This correction package lands the instructional layer before runtime changes:

- root `AGENTS.md` with the repository-wide operating contract;
- canonical `$spok-grok-cli-operations` and `$spok-agent-orchestration` skills under `.agents/skills`;
- compatibility shims under `.codex/skills`;
- Grok CLI capability and mission/work-item receipt references;
- roadmap, UX, security, and release gates aligned to the dogfood evidence.

These files define expected behavior; they do not claim that the current runtime already implements every item below.

The first runtime slice, CLI-001, landed on 2026-07-13: `grok-capabilities` now captures a versioned, fingerprinted snapshot from bounded `--version`, `--help`, and `inspect --json` probes, optionally checks `leader list --json`, reports auth as explicitly unknown, and gates declared requirements before a caller launches work. The privileged status route limits detailed discovery to the configured Grok executable and a trusted cwd, audits only sanitized capability evidence, and keeps raw inspect/help content out of API state.

CLI-002 also landed on 2026-07-13. The immutable v1 `GrokRunSpec` owns workspace/isolation, prompt transport metadata, exact session intent, model/agent/effort, turn/tool/web/permission/sandbox bounds, delegation, stream-versus-report output, schema hash, and debug retention. Its deterministic compiler pins the CLI-001 fingerprint, rejects unsupported or ambiguous contracts before spawn, enforces verified isolation and `--no-subagents` for leaves, and emits a redacted receipt. The privileged start route accepts this contract as an exclusive alternative to legacy command/argv fields, repeats capability preflight in the trusted cwd, and keeps raw prompt/schema argv out of approvals, audit, process state, and harness system events. Existing foreground/background callers still use the legacy path; CLI-003 will create and verify prompt artifacts and migrate those callers onto the spec path.

## P0 — Versioned Grok Run Contract

Outcome: every provider launch is reproducible, bounded, redacted, and compatible with the installed CLI.

1. Add a runtime capability probe that records CLI version, `inspect --json`, supported flags/commands, auth state, leader health when requested, and explicit unknowns. **Landed 2026-07-13:** the v1 sanitized snapshot, fingerprint, requirement gate, trusted runtime route, output/time bounds, real-CLI preflight, and supported/unsupported/malformed/timeout fixtures are in place; CLI-002 now pins that fingerprint to compiled runs.
2. Introduce a versioned `GrokRunSpec` and compiler. It owns cwd/worktree, prompt transport, session intent, model/effort, maximum turns, tool/web/sandbox/permission policy, subagent policy, output format, final report schema, and debug retention. **Landed 2026-07-13:** strict v1 parsing, immutable compiled state, deterministic capability-supported argv, exact new/resume/fork identity, attended-only continue-latest, stream/report exclusivity, leaf isolation/delegation denial, sanitized receipts, launch-boundary revalidation, and exact redacted approval fingerprints are covered by table-driven success and denial tests. Prompt artifact creation/content verification and legacy-caller migration remain CLI-003.
3. Replace large `-p` mission argv with runtime-managed `--prompt-file`/`--prompt-json` artifacts. Store only redacted metadata and a content hash in logs; delete ephemeral prompt files after durable handoff.
4. Keep `streaming-json` for live ingestion and add a typed specialist return path. Because Grok's `--json-schema` implies JSON rather than streaming output, the run compiler must choose explicitly between a live stream and a JSON-only/report turn instead of emitting incompatible intent. Preserve unrecognized raw events without feeding them into every leader turn.
5. Use exact session IDs for resume/fork. “Continue latest” remains visible interactive convenience and is prohibited for unattended jobs.
6. Make leaf defaults explicit: `--no-subagents`, bounded turns, deliberate effort, narrow tools/permissions, and selective `--check`.
7. Model provider errors by category: capability, authentication, policy, isolation, leader, malformed report, implementation, validation, cancellation, or resource exhaustion.
8. Add CLI contract fixtures that fail clearly when a supported-version upgrade changes argv or event semantics.

Exit criteria:

- no non-trivial mission prompt appears in process argv, audit previews, or user-visible command logs;
- a run can be reconstructed from its sanitized spec, capability snapshot, prompt hash, session identity, and worktree receipt;
- unsupported required capabilities block before launch with one corrective action;
- leaf invocations cannot create unbudgeted descendants;
- tests cover new, resume, fork, denial, missing capability, malformed stream, and cleanup paths.

## P1 — Dependency-Aware Agent Manager

Outcome: Spok schedules the smallest useful real team and preserves enough budget to integrate it.

1. Compile mission intent into durable milestone and work-item receipts with owner, integration owner, dependencies, owned/excluded files, authority, budgets, checks, and return condition.
2. Add readiness scheduling across dependency, repository lock, verified worktree, provider capacity, token/cost reserve, and approval state.
3. Reserve at least 20% for leader integration/validation and one recovery turn by default. Capacity UI shows requested lanes, real lanes, queue depth, and remaining reserve separately.
4. Generate compact context packets from repository paths, symbols, decisions, checkpoint deltas, and artifact references. Add size telemetry and a user-visible reason when a packet exceeds its budget.
5. Launch leaves with no subagents. Nested delegation is a new work item whose lanes, cost, and authority remain observable to Spok.
6. Assign one integration owner for shared contracts. Prevent overlapping write scopes or serialize them intentionally.
7. Require structured return packets. Treat missing format as a cheap format-repair turn, not a reason to resend the repository.
8. Make status transitions evidence-backed: requested → assigned → provider running → reported → verified → integrated, with failed/replaced attempts retained.
9. Present one mission summary: current outcome/reason, completed/active/blocked, material pressure, evidence gap, and safest next action. Hide provider mechanics unless they help a decision.

Exit criteria:

- every launch has a durable authority/budget/worktree receipt;
- displayed real concurrency equals provider-emitted active lanes, never requested crew count;
- no two concurrent leaves own the same write surface without an explicit integration plan;
- initial scheduling cannot consume integration/recovery reserves;
- a user can start and monitor a substantial mission without naming agents or managing worktrees.

## P2 — Supervision, Synthesis, And Recovery

Outcome: failures cost bounded work, and Spok—not the user—turns reports into a review-ready repository.

1. Detect stalls from provider heartbeat/progress evidence, not client visibility or missing decoration.
2. Retry once by default with a narrower error-specific receipt. Preserve the original attempt; do not restart healthy siblings.
3. Reconcile every report with Git diff, owned paths, tests, artifacts, and dependency exit criteria before advancing a milestone.
4. Detect conflicting reports or edits and route them to the integration owner with the smallest relevant evidence packet.
5. Materialize checkpoint deltas: completed, active, blocked, decisions, changed assumptions, budget use, evidence, cleanup state, and next action.
6. Recover exact sessions/worktrees after runtime restart. Pending approvals and execution authority do not revive automatically.
7. Degrade an unhealthy leader backend to a visible checkpoint/replan state; never silently relaunch all lanes through a broader path.
8. Keep trace/export artifacts on failure or explicit handoff, with redaction and retention controls.

Exit criteria:

- an agent failure/replacement cannot erase history, duplicate accepted work, or falsely complete a dependency;
- a restart resumes from a durable checkpoint without injecting the full transcript;
- leader synthesis names unsupported claims and untested scope;
- retry and repair spend is attributable and bounded.

## P3 — One-Step Git Handoff And Cleanup

Outcome: accepted missions finish with an intentional revision and no hidden execution debris.

1. Preview integration order, conflicts, dirty files, unpushed commits, prompt/report artifacts, branches, worktrees, and durable records.
2. Let the user accept one recommended handoff or expand the details; group decisions by scope/risk instead of asking per agent.
3. Run the smallest risk-proportionate integration suite, retain evidence, and distinguish green checks from untested scope.
4. Commit/merge on the selected branch only after evidence reconciliation. Never infer permission to push, delete remote branches, or discard dirty work.
5. Use Grok/Git native dry-run cleanup where available, then remove accepted temporary worktrees, branches, reports, and prompt artifacts.
6. Finish with one repository/worktree inventory and a role-attributed summary.

Exit criteria:

- accepted handoff leaves exactly the intended checkout(s), branches, and durable evidence;
- cleanup cannot destroy dirty/unpushed work without explicit impact acceptance;
- the final summary distinguishes Spok coordination, real agent contributions, leader repairs/verification, and remaining risk;
- the repository is clean and source-of-truth documentation matches the integrated revision.

## Prioritized Implementation Backlog

| ID | Priority | Deliverable | Primary ownership | Required proof |
| --- | --- | --- | --- | --- |
| CLI-001 | P0 | Capability snapshot and compatibility gate — **landed 2026-07-13** | runtime health/provider adapter | v0.2.99 fixture, unsupported/unknown denial, malformed inspect, timeout, missing binary, and real installed-CLI preflight |
| CLI-002 | P0 | Versioned `GrokRunSpec` plus argv compiler — **landed 2026-07-13** | `src/lib/runtime/grok-run-spec.ts`, runtime spawn boundary | table-driven new/resume/fork/report/denial/capability/redaction tests |
| CLI-003 | P0 | Runtime-managed prompt file/JSON lifecycle | session-start/runtime artifacts | long prompt, secret redaction, cleanup, crash recovery |
| CLI-004 | P0 | Structured specialist report schema | provider adapter/stream contracts | valid, partial, malformed, repair fixtures |
| ORCH-001 | P0 | Mission/work-item receipt compiler | mission domain | schema migration and validation tests |
| ORCH-002 | P1 | Dependency/capacity/reserve scheduler | mission runtime/background runner | deterministic scheduling and starvation tests |
| ORCH-003 | P1 | Context packet builder with byte/token telemetry | mission artifacts/extensions | relevance, limit, deduplication tests |
| ORCH-004 | P1 | Truthful lane/attempt state projection | mission + stream contracts | requested-vs-real and replacement fixtures |
| ORCH-005 | P2 | Bounded semantic retry and stall recovery | supervised runtime | no sibling restart; reserve enforcement |
| SYN-001 | P2 | Repository/evidence reconciliation engine | review/validation/mission domain | false-report and overlap tests |
| UX-023 | P1 | Outcome-first mission status and grouped decisions | Missions/Inbox/Review | E2E for pressure, approval, failure, cleanup |
| GIT-001 | P3 | Previewed integration/cleanup transaction | Git/worktree runtime + Review | dirty/unpushed preservation and clean inventory |

## Token And Efficiency Budgets

These are initial product budgets, not billing promises:

- prompt packet target: at most 8 KiB before necessary source excerpts;
- specialist return: at most 600 words plus paths/check records/artifact references;
- raw transcript in leader hot context: zero by default;
- initial allocation: discovery 15%, specialist execution 50%, integration/validation 25%, recovery 10%;
- default retry: one per failed work item, only with an observed narrower failure;
- default nested delegation: denied;
- checkpoint: deltas since the prior checkpoint, not a restatement of the mission.

Track prompt bytes, referenced artifact bytes, input/output tokens when available, turns, retries, elapsed time, actual lane utilization, validation spend, and synthesis reserve. Optimize review-ready work per total token, not agent count or raw output volume.

## Dogfood Acceptance Scenario

Repeat a roadmap-development mission comparable to the 2026-07-13 run:

1. start from one clean `main` checkout;
2. ask Spok for a substantial cross-cutting roadmap slice without naming a crew;
3. confirm capability/policy/worktree/budget receipts and the proposed smallest team;
4. interrupt one lane, fail isolation for another, exhaust a simulated lane budget, and restart the client/runtime;
5. verify healthy work continues, failed work remains attributable, and no fallback touches main;
6. have Spok reconcile, test, document, merge/commit, and preview cleanup;
7. confirm one clean repository, no extra worktrees/repos/artifacts, truthful lane accounting, and a role-attributed final assessment.

The track is corrected only when the user does not need a second request to merge, tidy, explain agent quality, or discover what remains.

## Documentation And Skill Ownership

- This document owns the detailed correction sequence and Grok/agent acceptance criteria.
- `HARNESS_AUDIT_AND_ROADMAP.md` owns product priority and milestone status.
- `UX_AUDIT.md` owns user-visible evidence and closure of UX-023.
- `SECURITY_POSTURE.md` owns CLI authority, prompt artifacts, isolation, cleanup, and delegation boundaries.
- `RELEASE_CHECKLIST.md` owns shippable verification.
- `.agents/skills/spok-grok-cli-operations` owns CLI operating guidance.
- `.agents/skills/spok-agent-orchestration` owns mission delegation/synthesis guidance.
- root `AGENTS.md` owns the concise repository-wide default contract.

Update these together when the provider contract or dogfood evidence changes. Remove superseded instructions instead of accumulating another competing playbook.
