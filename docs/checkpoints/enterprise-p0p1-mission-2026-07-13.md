# Checkpoint — Enterprise P0/P1 mission

**Date:** 2026-07-13  
**Leader:** Spok  
**Mission branch:** `spok/enterprise-p0p1-mission`  
**HEAD:** `c1b88df`  
**Base:** `12d8f6e` (clean; `main` untouched)  
**Status:** Integrated and verified; UX findings advanced but not closed

## Outcome

Advance one evidence-backed Enterprise mission across four exclusive lanes: Lifecycle (Monitor/Run), Mission Domain v1, Policy confirm-before-escalation, and long-project performance gates.

## Provider lanes (real subagents)

| Crew name | Subagent ID | Contribution commits |
|-----------|-------------|----------------------|
| Lifecycle | `019f5d9e-0d3b-7923-810d-8b496979b9c8` | `3f1c95e`, `8879db7` |
| Performance | `019f5d9e-0d47-7241-a4cb-dc2be22ea3d0` | `33c2c55` |
| Mission Domain | `019f5d9e-0d3f-76d1-b996-4f937d534dfd` | `ec06efe` |
| Policy | `019f5d9e-0d43-7ac3-8007-a24b0c351ded` | `bc17036` |
| Spok integration | (orchestrator) | `c1b88df` type fix; docs update |

Note: provider worktree isolation reported shared workspace paths; Spok reconciled exclusive commits on the mission branch. File ownership remained non-overlapping.

## Delivered (verified against repository)

### Lifecycle — P0-1 / UX-005 / UX-006 (Monitor + Run)
- `src/lib/session-lifecycle-projection.ts` — adapter over inbox lifecycle
- `run-status-card.tsx`, `monitor-panel.tsx` — lane/process/job distinct; diagnostics; one next action
- Tests: `tests/harness/session-lifecycle-projection.test.ts`

### Mission Domain — P1-1/2 / UX-013 foundation
- `src/lib/missions/**` — types, validate, budgets, checkpoint, persist
- `src/server/routes/missions.ts` + thin `/api/missions` adapters
- Tests: `tests/missions/mission-domain.test.ts`, `mission-routes.test.ts`

### Policy — P0-4 / UX-009 composer slice
- `src/lib/security/effective-policy.ts`, `effective-policy-summary.tsx`
- Composer confirm-before-escalation; elevated indicator
- Tests: `tests/security/effective-policy.test.ts`, `e2e/permission-escalation.spec.ts`

### Performance — P0-8 gates
- `src/lib/perf.ts` budgets + `PERF_HOT_BOUNDS`
- `tests/perf/fixtures/long-project.ts`, strengthened `perf-budgets.test.ts`
- Spok fix: number typing for hot window size so `npm run build` typecheck passes

## Verification (Spok-run)

| Check | Result |
|-------|--------|
| Focused unit (lifecycle + missions + policy) | 37 pass |
| `npm test` | **351 pass** / 0 fail |
| `npm run test:perf` | **12 pass** / 0 fail |
| `npm run lint` | pass |
| `npm run build` | pass (after Spok type fix) |
| E2E: permission-escalation + startup-and-lifecycle | **9 pass** |

## Explicit non-closures

- **UX-005 / UX-006** not closed — Review + handoff lifecycle; job E2E/a11y remain
- **UX-009** not closed — Settings/Topbar/Run Status duplication; slash-command escalation; launch/handoff evidence
- **UX-013** not closed — Mission v1 domain not wired to Missions UI
- **P0-8** not closed — production `session.nodes` grows 1:1 with 10k events (breach for sequential fix)

## Production breach (for sequential Spok work)

After 10k `reduceStreamEvents`, `session.nodes` has ~10_000 entries while `eventLog` is capped at 8000. Need checkpoint-aware node eviction / hot-cold tiering in reduce/hydrate — **do not parallelize with other stream owners without integration lock**.

## Risks

- Mission create does not require trusted cwd (plan-only); execution must re-verify trust
- Empty mission authority capability list is open until receipt is set
- No concurrent write locking beyond atomic rename for missions FS
- Medium provider steps (`auto`, `acceptEdits`) do not require confirm
- Slash `/permission-mode` / `/always-approve` still escalate without dialog

## Safest next action

1. Wire Missions UI to Mission v1 store for plan/checkpoint/evidence (no decorative-first path).
2. Project lifecycle into Review readiness + handoff labels.
3. Sequentially bound hot `session.nodes` (production stream reduce/hydrate).
4. Consolidate Settings/Topbar policy chrome onto the effective-policy helper; gate slash-command escalations.

Do not broaden into navigation rewrite, archive cleanup, or scheduler/supervision until the above control-room truthfulness work lands.
