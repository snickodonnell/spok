# Spok Development Handoff

**Date:** 2026-07-09  
**Scope:** Work from UI/UX harness plan Horizon 1 through mobile LAN demo, session lifecycle, and host sync.  
**Tests at handoff:** `npm test` — **173** passing.

Use this document when resuming development. Product roadmap context remains in:

- [`docs/UI_UX_HARNESS_PLAN.md`](./UI_UX_HARNESS_PLAN.md) — Horizon 1 acceptance tracking  
- [`docs/HARNESS_AUDIT_AND_ROADMAP.md`](./HARNESS_AUDIT_AND_ROADMAP.md) — Phases 0–7 + product coherence notes  
- [`docs/SECURITY_POSTURE.md`](./SECURITY_POSTURE.md) — privilege model + LAN caveat  
- [`README.md`](../README.md) — quick start  

---

## 1. Session separation (desktop Spok-dev vs mobile demos)

### How sessions work today

| Concept | Behavior |
|--------|----------|
| **Session identity** | Each run is a **session id** under `~/.spok/sessions/<id>/` (`meta.json`, `events.ndjson`, `snapshot.json`). |
| **Workspace binding** | Each session has a **`cwd`** (e.g. `C:\dev\fantasy-football` vs `C:\dev\spok`). |
| **Active session** | Client Zustand holds many sessions; one `activeSessionId` is focused in the UI. |
| **Live process** | Host process registry maps **sessionId → Grok child process**. “Live” UI must follow this registry, not sticky meta. |
| **Mobile ↔ desktop sync** | Same Spok **server process** + same **sessions directory** → both UIs poll and merge events. |

There is **no automatic isolation** between “I’m developing Spok” and “I’m demoing a repo on the phone.” Separation is **by workspace `cwd` and which session you activate**.

### Keep Spok product work separate from remote/mobile demos

1. **Different folders**  
   - Developing Spok itself: open **`C:\dev\spok`** (or this repo path).  
   - Demos / wife phone / fantasy work: open **`C:\dev\fantasy-football`** (or another project).  
   Never point the mobile demo at the Spok repo unless you intend to run Grok on Spok’s own tree.

2. **New session on directory change**  
   Opening a folder always **creates a new session** and **stops live harnesses** first (`openWorkspaceSession` + `stopAllLiveHarnesses`).  
   Mobile full-screen **Folder** picker does the same (does not reuse the previous session id).

3. **Don’t mix “active” on the phone**  
   Mobile home / banner only shows **host-live** processes. If you leave a Grok run going in `spok` while demoing `fantasy-football`, both can appear if both are live—**stop the Spok-dev run** before demos.

4. **Optional: separate data root for demos** (strong isolation)  
   Run demo server with a different sessions dir so Spok-dev history never shows on the phone:

   ```powershell
   $env:SPOK_SESSIONS_DIR = "$env:USERPROFILE\.spok\demo-sessions"
   $env:SPOK_LAN_FORCE_BUILD = "1"
   npm run dev:lan
   ```

   Day-to-day Spok-dev can use the default `~/.spok/sessions`.

5. **Optional: separate port**  
   Keep product work on `3000` and demos on `3001` (`$env:PORT=3001`) so tokens/process registries never collide.

6. **This chat / Grok Build agent working on Spok**  
   Work done **in Grok Build / this harness against `C:\dev\spok`** is a **different session** from Spok UI sessions **only if** they use different session ids/cwds. Spok does not automatically see “the agent that is editing Spok” unless you launched that agent **as a Spok session** on that cwd.  
   Desktop Spok UI sessions for `fantasy-football` and mobile sessions for the same cwd **do** share one server’s durable log when both hit the same Spok instance—that is intentional for dual-device demos.

### Current example on this machine (at handoff)

| Session name | cwd | Disk status |
|--------------|-----|-------------|
| fantasy-football | `C:\dev\fantasy-football` | ready (completed run) |
| Aether-conquer (+ variants) | `C:\dev\Aether-conquer` | ready |

No Spok session was required to be “only” for tool development; keep product edits in git on `C:\dev\spok` and open that path only when you want Grok inside the Spok repo.

---

## 2. What shipped (chronological product slices)

### A. UI/UX Horizon 1 — product coherence

**Workspace IA**

- Product modes: **Run / Review / Automate / Extend** (topbar + store).  
- Right tabs: **Changes / Review / Events / Health**.  
- Left: **Thinking | Events** (event graph).  
- **Run status card** (status, cwd, branch, permission, CLI, dirty, stop).

**Causal workbench**

- `src/lib/causal-links.ts` — file ↔ trace reverse lookup.  
- Changes panel: **Why** rail + mini-rail.  
- Review comments surface next to causal steps.

**Composer cockpit**

- Structured permission / model / run controls.  
- No “yolo” copy → **Always approve (high risk)**.  
- Queue: edit / reorder / remove.  
- Slash picker: groups, examples, risk badges.  
- Fixture-gated catalog: `tests/fixtures/grok/slash-commands.fixture.json` + `npm run verify:slash-catalog`.

**First-run**

- Welcome readiness: CLI probe + permission before any session.

**Review readiness**

- `src/lib/review-readiness.ts` + checklist on Changes (compact) and Review (full).  
- Commit disabled when blockers (nothing staged, conflicts, isolation).

**Theme / dialogs / verification**

- Professional theme more neutral; responsive helpers.  
- Settings left-nav; Extensions Gallery / Installed / Trust / Agents.  
- Playwright timeouts; usage-meter deps cleaned.

### B. LAN hosting (phone on Wi‑Fi)

- **`SPOK_LAN_ACCESS=1`** — allow RFC1918 Host/Origin (not public internet).  
- **`npm run dev:lan`** — production bind `0.0.0.0` (fast on phones).  
  - First run may build; force rebuild: `$env:SPOK_LAN_FORCE_BUILD=1; npm run dev:lan`  
  - Hot/dev over LAN (slow): `npm run dev:lan:hot`  
- **`npm run lan:urls`** — print LAN addresses.  
- Security: trusted home Wi‑Fi only; anyone with the URL can get the capability token.

### C. Mobile shell (does not change desktop)

- Detection: `src/lib/mobile-layout.ts` + `useMobileLayout` (viewport + UA; overrides `?mobile=1` / `?desktop=1`).  
- **Code split:** `app-shell` dynamically loads `desktop-shell` vs `mobile-shell` (phones avoid Monaco).  
- Tabs: **Prompt · Thinking · Files · More**.  
- Full-screen **folder picker** (not blocked by “active session”).  
- **Live thinking** strip on Prompt; auto-switch to Thinking when host process is live.  
- **Leave phone → stop host process** (`pagehide` / `beforeunload` / freeze / visibility grace).  
- **New folder → new session** + stop all live harnesses.

### D. Host sync (mobile + desktop live together)

- Shared: `src/lib/host-session-sync.ts` + `useHostSessionSync` (desktop + mobile).  
- Polls:
  - `GET /api/runtime/live` — real Grok processes (pruned when exited).  
  - Durable events + snapshot (prompts, files, status).  
- **Live banner only if process registry says live**, not sticky meta/`running` message status.  
- Run end: status → `completed` / `error` / `stopped`, `session_end` event, **persist snapshot** so peers clear “live”.

---

## 3. How to run (cheat sheet)

```powershell
# Product work on this PC only
npm run dev

# Phone + desktop same host (recommended for dual UI)
$env:SPOK_LAN_FORCE_BUILD=1   # after code changes
npm run dev:lan
# Phone: http://<lan-ip>:3000?mobile=1
# Desktop: http://localhost:3000 or same LAN IP

# Strong session isolation for demos
$env:SPOK_SESSIONS_DIR = "$env:USERPROFILE\.spok\demo-sessions"
npm run dev:lan

npm test
npm run verify:slash-catalog
```

---

## 4. Key files (map)

| Area | Paths |
|------|--------|
| Product modes | `src/lib/product-modes.ts`, `src/lib/store.ts`, topbar |
| Causal | `src/lib/causal-links.ts`, `src/components/diff/causal-rail.tsx` |
| Workspace shell | `src/components/session/workspace.tsx`, `run-status-card.tsx` |
| Review checklist | `src/lib/review-readiness.ts`, `src/components/git/commit-checklist.tsx` |
| Slash catalog | `src/lib/slash-catalog.ts`, `src/lib/grok-commands.ts`, fixture + scripts |
| LAN / security | `src/lib/security/local-api.ts`, `scripts/dev-lan.mjs`, `scripts/lan-host.mjs` |
| App split | `src/components/shell/app-shell.tsx`, `desktop-shell.tsx` |
| Mobile | `src/components/mobile/*`, `src/hooks/use-mobile-layout.ts`, `use-mobile-session-lifecycle.ts` |
| Host sync | `src/lib/host-session-sync.ts`, `src/hooks/use-host-session-sync.ts`, `src/app/api/runtime/live/route.ts` |
| Session open/stop | `src/lib/workspace-session.ts`, `src/lib/session-lifecycle-client.ts`, `src/lib/harness.ts` |
| Process registry | `src/lib/process-lifecycle.ts` |

---

## 5. Architecture notes for next work

1. **Dual UI = one Node server.** Sync is poll-based (not WebSocket). Latency ~1–2s while live.  
2. **“Live” must mean process registry**, not ACP `message status=running` or stale `meta.status`.  
3. **Capability token** from `GET /api/health` requires allowed Host/Origin (localhost or LAN mode).  
4. **Mobile abandon** stops the process; durable history remains on disk unless deleted.  
5. **Horizon 1 leftovers** (from plan): visual screenshot baselines, live `grok --help` catalog regen, denser Settings risk UX, hunk-level causal anchors.  
6. **Horizon 2+** (plan): Changes workbench depth, terminal panel, stronger Review/PR checklist, automation mission control.

---

## 6. Skills (agents)

| Skill | When |
|-------|------|
| `.agents/skills/spok-harness-architecture` | Roadmap / shell / multi-surface product |
| `.agents/skills/spok-secure-runtime` | Privileged APIs, spawn, git, trust, Tauri |
| `.agents/skills/spok-stream-contracts` | Parser, events, fixtures, replay |

---

## 7. Suggested next development steps

1. Rebuild LAN after any shell/sync change (`SPOK_LAN_FORCE_BUILD=1`).  
2. Optional: **demo profile** env (`SPOK_SESSIONS_DIR` + port) documented in Settings UI.  
3. Optional: pin mobile to a **session filter** (only list sessions under a demo cwd).  
4. Continue Horizon 2 from `UI_UX_HARNESS_PLAN.md` without regressing mobile first-load or live-status correctness.  
5. If dual-device race issues appear: consider WebSocket fan-out of NDJSON events instead of poll-only.

---

## 8. Definition of “good enough” at handoff

- Desktop workbench remains full-featured and **code-split** from mobile.  
- Phone on Wi‑Fi loads production build, sees live thoughts, changes folders without being blocked.  
- Active banner clears when the host process exits and status is persisted.  
- Desktop and mobile, same server, can watch the **same session** progress.  
- **Separation of Spok-dev vs demos** is operational (cwd / sessions dir / stop live runs), not a hard multi-tenant boundary.

*End of handoff — continue from here.*
