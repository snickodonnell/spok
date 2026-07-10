/**
 * Start Spok for LAN / phone access.
 *
 * Default (`dev` | no arg | `start`): production server on 0.0.0.0 — fast on Wi‑Fi.
 * Hot reload: `node scripts/dev-lan.mjs hot` (slow over LAN; use on PC only).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const port = process.env.PORT || "3000";
const modeArg = process.argv[2] || "prod";
const hot = modeArg === "hot" || modeArg === "dev";

process.env.SPOK_LAN_ACCESS = process.env.SPOK_LAN_ACCESS || "1";

function lanIPv4s() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    if (!list) continue;
    for (const info of list) {
      if (info.family !== "IPv4" && info.family !== 4) continue;
      if (info.internal) continue;
      out.push(info.address);
    }
  }
  return out;
}

const addrs = lanIPv4s();
console.log("");
console.log("══════════════════════════════════════════════");
console.log(
  hot
    ? "  Spok · LAN (Next dev — slower on phones)"
    : "  Spok · LAN (production — fast for phones)"
);
console.log("══════════════════════════════════════════════");
console.log(`  SPOK_LAN_ACCESS=${process.env.SPOK_LAN_ACCESS}`);
console.log(`  Bind: 0.0.0.0:${port}`);
console.log("");
console.log("  This PC:  http://localhost:" + port);
if (addrs.length) {
  console.log("  Phone (same Wi‑Fi):");
  for (const a of addrs) {
    console.log(`    http://${a}:${port}`);
    console.log(`    http://${a}:${port}?mobile=1   (force phone UI)`);
  }
} else {
  console.log("  (No LAN IPv4 — check Wi‑Fi)");
}
console.log("");
console.log("  Tip: keep this PC awake; allow Node on Private firewall.");
console.log("══════════════════════════════════════════════");
console.log("");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  if (hot) {
    await run(npmCmd, [
      "run",
      "dev",
      "--",
      "-H",
      "0.0.0.0",
      "-p",
      String(port),
    ]);
    return;
  }

  // Production path: build if needed, then start
  const buildId = join(root, ".next", "BUILD_ID");
  const forceBuild = process.env.SPOK_LAN_FORCE_BUILD === "1";
  if (forceBuild || !existsSync(buildId)) {
    console.log(
      forceBuild
        ? "Building (SPOK_LAN_FORCE_BUILD=1)…"
        : "No production build found — building once (next phone loads will be fast)…"
    );
    console.log("");
    await run(npmCmd, ["run", "build"]);
  } else {
    console.log("Using existing production build (.next). Re-build with:");
    console.log("  $env:SPOK_LAN_FORCE_BUILD=1; npm run dev:lan");
    console.log("");
  }

  await run(npmCmd, [
    "run",
    "start",
    "--",
    "-H",
    "0.0.0.0",
    "-p",
    String(port),
  ]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
