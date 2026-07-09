# Spok — Live Harness & Visualizer for Grok Build

**Spok** is a production-quality desktop-ready app that wraps [Grok Build](https://x.ai) sessions with **live** thinking-trace and repository-diff visualization.

Watch reasoning steps, tool calls, plan updates, sub-agents, and code changes stream in as they happen — not after the fact — with a retro tech / CRT phosphor aesthetic.

![Spok](https://img.shields.io/badge/Spok-Live%20Harness-33ff66?style=flat-square&labelColor=0a100c)
![Next.js 15](https://img.shields.io/badge/Next.js-15-black?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square)

---

## Why Spok?

| Capability | What you get |
|---|---|
| **Live session harness** | Spawn & stream Grok Build (CLI) output into structured events |
| **Thinking Trace** | Expandable virtualized tree — reasoning, tools, plans, subagents |
| **Repo Diff** | File tree + Monaco side-by-side diffs, hunk nav, stats |
| **Unified view** | Deep-link: select a trace step → highlight related code changes |
| **Import & samples** | JSON exports, paste logs, unified diffs, high-quality sample sessions |
| **Retro tech UI** | Phosphor greens / ambers / cyans / magentas, CRT scanlines, glow |

Use Spok as your **primary interface** for running Grok Build when you want full visibility into the agent’s mind and the working tree.

---

## Quick start

### Requirements

- **Node.js 20+** (18+ may work)
- **npm** 10+
- Optional: **Grok CLI** on `PATH` for live sessions
- Optional: **Rust + Tauri CLI** for native desktop packaging

### Install & run

```bash
# from the repo root
npm install
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)**.

Production build:

```bash
npm run build
npm start
```

---

## Using Spok as your Grok Build interface

### 1. Play a sample (no CLI needed)

1. Open Spok
2. Click **Play demo sample**, or **Import → Samples**
3. Watch the thinking tree and Monaco diffs update live

Samples included:

- **Auth middleware refactor** — multi-file TS refactor, tools, subagent, tests
- **Live metrics dashboard** — React hooks + components scaffold

### 2. Launch a live Grok Build session

1. Click **Launch** (or `Ctrl+K` → “Launch Grok Build session”)
2. Set:
   - **Working directory** — your project path
   - **Command** — default `grok` (or full path / alias)
   - **Extra args** — e.g. flags your CLI accepts
   - **Prompt / task** — the work for the agent
3. Spok spawns the process via `/api/session/start` and streams stdout/stderr
4. Output is parsed into trace nodes; `git diff` can be polled for live file changes

Environment overrides:

| Variable | Purpose |
|---|---|
| `SPOK_GROK_CMD` | Default CLI binary name/path |

> If the CLI is not installed, launch will error cleanly — use **samples** or **import** instead.

### 3. Import pastes, JSON, or diffs

**Import** dialog supports:

- **Paste** — free-form agent logs or NDJSON events (optional live replay)
- **Diff** — unified `git diff` text
- **File** — Spok session export JSON, `{ events: [...] }`, or raw logs

### 4. Export

Export the active session as JSON (`Export` button or command palette) for sharing, archiving, or re-import.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `⌘K` | Command palette |
| `Ctrl+1` | Unified view (trace + diff) |
| `Ctrl+2` | Trace only |
| `Ctrl+3` | Diff only |
| `Ctrl+4` | Session overview |
| `↑` `↓` | Navigate trace tree |
| `←` `→` | Collapse / expand node |
| `Enter` | Jump to linked file change |

---

## Architecture

```
spok/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── api/session/      # Live harness: spawn CLI, git diff
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── shell/            # App chrome, palette, dialogs
│   │   ├── trace/            # Thinking trace visualizer
│   │   ├── diff/             # File tree + Monaco diffs
│   │   ├── session/          # Metrics, timeline, overview, log
│   │   └── ui/               # shadcn-style primitives
│   ├── hooks/                # e.g. useGitWatch
│   └── lib/
│       ├── types.ts          # Domain model
│       ├── store.ts          # Zustand session store
│       ├── parser.ts         # Log / NDJSON → StreamEvent
│       ├── diff-utils.ts     # Line diff, file tree, unified parse
│       ├── playback.ts       # Sample / paste live replay
│       └── samples/          # Built-in demo sessions
├── src-tauri/                # Optional Tauri 2 desktop shell
├── samples/                  # On-disk sample JSON
└── package.json
```

### Live data flow

1. **Harness** (`POST /api/session/start`) spawns the CLI and streams NDJSON lines (`stdout` / `stderr` / `exit` / structured `event`)
2. **Parser** turns lines into `StreamEvent`s
3. **Store** materializes a `Session` with a node graph + `FileDiff` map
4. **UI** virtualizes the trace tree and renders Monaco diffs; selecting a node with a file link opens the related diff

### Stream event shape (NDJSON)

```json
{
  "type": "tool_call",
  "timestamp": 1710000000000,
  "id": "tc1",
  "parentId": "th1",
  "title": "Tool: read_file",
  "content": "read_file({ ... })",
  "toolName": "read_file",
  "status": "running"
}
```

Supported `type` values include: `session_start`, `session_end`, `thinking`, `reasoning`, `tool_call`, `tool_result`, `plan`, `plan_update`, `subagent_start`, `subagent_end`, `file_change`, `diff`, `message`, `error`, `goal`, `system`.

`file_change` / `diff` may include `path`, `oldContent`, `newContent`, `diffStatus`.

---

## Desktop (Tauri)

Tauri 2 is set up (`@tauri-apps/cli` + `src-tauri/`). Requires [Rust](https://rustup.rs/).

### Cargo PATH fix

If you see **`failed to run 'cargo metadata'`**, your shell cannot find `cargo` (common after installing rustup without restarting the IDE).

```bash
# One-time: ensure %USERPROFILE%\.cargo\bin is on your User PATH
npm run rust:path

# Then always use these scripts (they prepend cargo to PATH automatically)
npm run tauri:dev
npm run tauri:info
```

`scripts/with-rust.mjs` injects `~/.cargo/bin` into `PATH` before invoking the Tauri CLI, so npm scripts work even when the integrated terminal was started before Rust was installed.

### Windows build toolchain (MinGW path)

Spok is configured for **MinGW / windows-gnu** so you do **not** need a complete Windows SDK / `kernel32.lib` install:

1. Rust: [rustup](https://rustup.rs/) (already installed)
2. MinGW: `winget install BrechtSanders.WinLibs.POSIX.UCRT`
3. Then: `npm run tauri:dev`

`scripts/with-rust.mjs` puts cargo + WinLibs `gcc` on PATH automatically.  
`rust-toolchain.toml` pins `stable-x86_64-pc-windows-gnu`.

**Optional MSVC path:** install [VS Build Tools](https://aka.ms/vs/17/release/vs_BuildTools.exe) with **Desktop development with C++** *and* a **Windows 10/11 SDK** (must include `kernel32.lib` under `Windows Kits\10\Lib\...\um\x64`). Then you can switch the toolchain back to `x86_64-pc-windows-msvc`.

### Commands

```bash
# Web app (full harness: CLI spawn + directory browser)
npm run dev

# Desktop window (loads the Next dev server; auto-fixes cargo PATH)
npm run tauri:dev
# or
npm run desktop

# Package (requires MSVC tools on Windows)
npm run tauri:build
```

> **Note:** Live process harness and directory browsing use the **Next.js Node API** (`/api/session/*`, `/api/fs/browse`). Use `npm run dev` (or `tauri:dev`, which starts the same server) so Launch can spawn `grok` and browse your disks.

### Picking a repo

1. Click **Launch**
2. Use the **directory navigator** — drives, breadcrumbs, double-click folders, filter, recent repos
3. Git repos are marked with a **repo** badge
4. Click **Use this folder**, enter a prompt, then **Launch session**

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Serve production build |
| `npm run lint` | ESLint |

---

## Theme

Spok uses a dark CRT base with phosphor accents:

- **Green** `#33ff66` — primary text, success, additions  
- **Amber** `#ffb000` — tools, warnings  
- **Cyan** `#33e0ff` — thinking, links  
- **Magenta** `#ff33aa` — plans, accents  

Toggle CRT / scanline effects from the top bar or command palette.

---

## Tips for daily use

1. Keep Spok open as the front-end; launch every Grok Build job from **Launch**
2. Use **Unified** view so traces and diffs stay linked
3. Scrub the **timeline** to jump to any step
4. Filter the trace tree by type (Think / Tools / Files / Plan / Agents / Errors)
5. Export sessions after important runs for review or bug reports

---

## License

MIT — build on it, ship with it, make Grok Build visible.
