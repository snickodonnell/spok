/**
 * Prepares a Windows + Rust build environment for Tauri:
 * 1. Loads MSVC toolset via vcvars64.bat so link.exe is on PATH
 * 2. Prepends ~/.cargo/bin and node_modules/.bin
 *
 * Usage: node scripts/with-rust.mjs <command> [args...]
 * Example: node scripts/with-rust.mjs tauri dev
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";

const cargoHome = process.env.CARGO_HOME || path.join(homedir(), ".cargo");
const rustupHome = process.env.RUSTUP_HOME || path.join(homedir(), ".rustup");
const cargoBin = path.join(cargoHome, "bin");
const localBin = path.join(root, "node_modules", ".bin");

/** @type {NodeJS.ProcessEnv} */
const env = { ...process.env };
env.CARGO_HOME = cargoHome;
env.RUSTUP_HOME = rustupHome;

if (isWin) {
  // Prefer MinGW when Windows SDK (kernel32.lib) is missing — common incomplete VS installs
  const mingwBin = findMingwBin();
  const hasWinSdk = hasKernel32Lib();

  if (mingwBin) {
    prependPath(env, [mingwBin]);
    console.log(`[spok] MinGW: ${mingwBin}`);
  }

  if (hasWinSdk) {
    const msvc = loadMsvcEnv();
    if (msvc) applyEnvMap(env, msvc);
  } else if (mingwBin) {
    // Host is pinned to windows-gnu via rust-toolchain.toml (no MSVC SDK needed)
    console.log("[spok] No Windows SDK libs — MinGW + windows-gnu toolchain");
  } else {
    const msvc = loadMsvcEnv();
    if (msvc) {
      applyEnvMap(env, msvc);
    } else {
      console.warn(
        "[spok] Warning: no MinGW gcc and no MSVC/SDK environment.\n" +
          "  Install WinLibs: winget install BrechtSanders.WinLibs.POSIX.UCRT\n" +
          "  Or Windows SDK + VS C++ Build Tools."
      );
    }
  }
}

// Always put cargo + local bins first
prependPath(env, [localBin, cargoBin].filter((p) => existsSync(p)));

// Refresh machine/user PATH entries that winget may have just added
if (isWin) {
  try {
    const userPath =
      spawnSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','User')",
      ], { encoding: "utf8", windowsHide: true }).stdout?.trim() || "";
    if (userPath) {
      const merged = [getPath(env), userPath].join(path.delimiter);
      setPath(env, merged);
      // re-front cargo/local/mingw
      const mingwBin = findMingwBin();
      prependPath(env, [localBin, cargoBin, mingwBin].filter(Boolean).filter((p) => existsSync(p)));
    }
  } catch {
    /* ignore */
  }
}

if (isWin) {
  const gcc = findOnPath(getPath(env), "gcc.exe");
  const link = findOnPath(getPath(env), "link.exe");
  const cargo = findOnPath(getPath(env), "cargo.exe");
  if (gcc) console.log(`[spok] gcc: ${gcc}`);
  if (link) console.log(`[spok] MSVC linker: ${link}`);
  if (!cargo) console.warn(`[spok] Warning: cargo.exe not found (expected under ${cargoBin})`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/with-rust.mjs <command> [args...]");
  process.exit(1);
}

if (!existsSync(path.join(cargoBin, isWin ? "cargo.exe" : "cargo"))) {
  console.error(`[spok] cargo not found at: ${cargoBin}`);
  console.error("Install Rust from https://rustup.rs/ then run: npm run rust:path");
  process.exit(1);
}

let command = args[0];
const commandArgs = args.slice(1);

// Resolve npm shim
if (command === "tauri") {
  const candidate = path.join(localBin, isWin ? "tauri.cmd" : "tauri");
  if (existsSync(candidate)) command = candidate;
} else if (command === "cargo" && isWin) {
  command = path.join(cargoBin, "cargo.exe");
}

// Use shell only for .cmd/.bat shims; direct .exe avoids DEP0190
const needsShell = isWin && /\.(cmd|bat)$/i.test(command);
const child = spawn(command, commandArgs, {
  env,
  stdio: "inherit",
  shell: needsShell,
  cwd: root,
  windowsHide: true,
});

child.on("error", (err) => {
  console.error(`[spok] Failed to run "${command}":`, err.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

// ---------------------------------------------------------------------------

function hasKernel32Lib() {
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const libRoot = path.join(pf86, "Windows Kits", "10", "Lib");
  if (!existsSync(libRoot)) return false;
  try {
    for (const ver of readdirSync(libRoot)) {
      const k = path.join(libRoot, ver, "um", "x64", "kernel32.lib");
      if (existsSync(k)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function findMingwBin() {
  const candidates = [];
  // From current / user path
  const pathProbe = [
    process.env.Path || "",
    process.env.PATH || "",
  ].join(path.delimiter);
  for (const dir of pathProbe.split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, "gcc.exe")) && /mingw/i.test(dir)) {
      candidates.push(dir);
    }
  }
  // WinGet WinLibs default location
  const localApp = process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local");
  const wingetPkgs = path.join(localApp, "Microsoft", "WinGet", "Packages");
  if (existsSync(wingetPkgs)) {
    try {
      for (const name of readdirSync(wingetPkgs)) {
        if (!/WinLibs|mingw/i.test(name)) continue;
        const bin = path.join(wingetPkgs, name, "mingw64", "bin");
        if (existsSync(path.join(bin, "gcc.exe"))) candidates.push(bin);
      }
    } catch {
      /* ignore */
    }
  }
  // Common installs
  for (const p of [
    "C:\\mingw64\\bin",
    path.join(homedir(), "mingw64", "bin"),
    "C:\\Program Files\\mingw64\\bin",
  ]) {
    if (existsSync(path.join(p, "gcc.exe"))) candidates.push(p);
  }
  return candidates[0] || null;
}

function getPath(e) {
  return e.Path || e.PATH || "";
}

function setPath(e, value) {
  e.Path = value;
  e.PATH = value;
}

function prependPath(e, dirs) {
  const parts = getPath(e).split(path.delimiter).filter(Boolean);
  for (const d of [...dirs].reverse()) {
    const resolved = path.resolve(d);
    const idx = parts.findIndex((x) => {
      try {
        return path.resolve(x) === resolved;
      } catch {
        return false;
      }
    });
    if (idx !== -1) parts.splice(idx, 1);
    parts.unshift(d);
  }
  setPath(e, parts.join(path.delimiter));
}

function applyEnvMap(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v == null) continue;
    if (k.toUpperCase() === "PATH") {
      setPath(target, v);
    } else {
      target[k] = v;
    }
  }
}

function findOnPath(pathValue, exe) {
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, exe);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * @returns {Record<string, string> | null}
 */
function loadMsvcEnv() {
  const vcvars = findVcvars64();
  if (vcvars) {
    const fromBat = envFromVcvars(vcvars);
    if (fromBat && (fromBat.Path || fromBat.PATH)) {
      console.log(`[spok] Loaded MSVC env via: ${vcvars}`);
      return fromBat;
    }
    console.warn(`[spok] vcvars ran but env capture failed: ${vcvars}`);
  }
  const manual = manualMsvcEnv();
  if (manual) console.log("[spok] Using manual MSVC paths");
  return manual;
}

function envFromVcvars(vcvars) {
  const tmp = path.join(tmpdir(), `spok-msvc-env-${process.pid}-${Date.now()}.txt`);
  // Write a tiny helper .bat that calls vcvars then dumps env to a file (ASCII)
  const helper = path.join(tmpdir(), `spok-vcvars-${process.pid}.bat`);
  writeFileSync(
    helper,
    [
      "@echo off",
      `call "${vcvars}" >nul 2>&1`,
      `if errorlevel 1 exit /b 1`,
      `set > "${tmp}"`,
    ].join("\r\n"),
    "utf8"
  );

  try {
    const result = spawnSync("cmd.exe", ["/d", "/c", helper], {
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.status !== 0 || !existsSync(tmp)) {
      return null;
    }

    // `set` output is typically the system OEM/ANSI code page; utf8 read is usually fine for PATH
    let text;
    try {
      text = readFileSync(tmp, "utf8");
    } catch {
      text = readFileSync(tmp, "latin1");
    }

    /** @type {Record<string, string>} */
    const map = {};
    for (const line of text.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      const val = line.slice(eq + 1);
      if (!key || key === "PROMPT") continue;
      map[key] = val;
    }
    return Object.keys(map).length ? map : null;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(helper);
    } catch {
      /* ignore */
    }
  }
}

function findVcvars64() {
  const candidates = [];
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const vswhere = path.join(pf86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (existsSync(vswhere)) {
    // Prefer complete, launchable installs with VC tools
    for (const extra of [
      ["-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-sort"],
      ["-products", "*", "-sort"],
    ]) {
      const r = spawnSync(
        vswhere,
        [...extra, "-property", "installationPath"],
        { encoding: "utf8", windowsHide: true }
      );
      for (const p of (r.stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        candidates.push(path.join(p, "VC", "Auxiliary", "Build", "vcvars64.bat"));
      }
    }
  }

  for (const year of ["18", "2022", "2019", "2017"]) {
    for (const edition of ["BuildTools", "Community", "Professional", "Enterprise"]) {
      candidates.push(
        path.join(pf86, "Microsoft Visual Studio", year, edition, "VC", "Auxiliary", "Build", "vcvars64.bat")
      );
    }
  }

  // Prefer Community 2019 (known complete) before incomplete BuildTools 18 if both exist:
  // still just first existing; sort complete first via vswhere -sort (newest first).
  // Explicitly try Community 2019 early if BuildTools 18 is incomplete.
  const preferred = [
    path.join(pf86, "Microsoft Visual Studio", "2019", "Community", "VC", "Auxiliary", "Build", "vcvars64.bat"),
    path.join(pf86, "Microsoft Visual Studio", "2022", "Community", "VC", "Auxiliary", "Build", "vcvars64.bat"),
    path.join(pf86, "Microsoft Visual Studio", "18", "BuildTools", "VC", "Auxiliary", "Build", "vcvars64.bat"),
  ];
  for (const c of [...preferred, ...candidates]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function manualMsvcEnv() {
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const vsRoots = [
    path.join(pf86, "Microsoft Visual Studio", "2019", "Community"),
    path.join(pf86, "Microsoft Visual Studio", "18", "BuildTools"),
    path.join(pf86, "Microsoft Visual Studio", "2019", "BuildTools"),
    path.join(pf86, "Microsoft Visual Studio", "2022", "BuildTools"),
    path.join(pf86, "Microsoft Visual Studio", "2022", "Community"),
  ];

  let msvcBin = null;
  let msvcRoot = null;
  for (const vsRoot of vsRoots) {
    const msvcTools = path.join(vsRoot, "VC", "Tools", "MSVC");
    if (!existsSync(msvcTools)) continue;
    const versions = readdirSync(msvcTools).sort().reverse();
    for (const ver of versions) {
      const bin = path.join(msvcTools, ver, "bin", "Hostx64", "x64");
      if (existsSync(path.join(bin, "link.exe"))) {
        msvcBin = bin;
        msvcRoot = path.join(msvcTools, ver);
        break;
      }
    }
    if (msvcBin) break;
  }
  if (!msvcBin || !msvcRoot) return null;

  const kits = path.join(pf86, "Windows Kits", "10");
  let sdkVer = null;
  const libRoot = path.join(kits, "Lib");
  if (existsSync(libRoot)) {
    const vers = readdirSync(libRoot)
      .filter((v) => /^\d+\./.test(v))
      .sort()
      .reverse();
    sdkVer = vers[0] || null;
  }

  const pathExtra = [msvcBin];
  if (sdkVer) {
    const sdkBin = path.join(kits, "bin", sdkVer, "x64");
    if (existsSync(sdkBin)) pathExtra.push(sdkBin);
  }

  /** @type {Record<string, string>} */
  const map = {
    Path: [...pathExtra, process.env.Path || process.env.PATH || ""].join(path.delimiter),
  };

  const includes = [path.join(msvcRoot, "include")];
  const libs = [path.join(msvcRoot, "lib", "x64")];
  if (sdkVer) {
    includes.push(
      path.join(kits, "Include", sdkVer, "ucrt"),
      path.join(kits, "Include", sdkVer, "um"),
      path.join(kits, "Include", sdkVer, "shared")
    );
    libs.push(
      path.join(kits, "Lib", sdkVer, "ucrt", "x64"),
      path.join(kits, "Lib", sdkVer, "um", "x64")
    );
  }
  map.INCLUDE = includes.join(";");
  map.LIB = libs.join(";");
  return map;
}
