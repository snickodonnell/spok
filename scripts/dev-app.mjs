/**
 * Dogfood the standalone privileged runtime behind the existing Next UI.
 *
 * The runtime asks the OS for an ephemeral port and reports it over IPC. The
 * capability token is inherited by both children and is never printed or
 * written to disk. Next proxies only the routes extracted into src/server.
 */

import { fork, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 60_000;
const FORCE_KILL_DELAY_MS = 5_000;
const CHECK_ONLY = process.argv.includes("--check");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let runtime = null;
let ui = null;
let stopping = false;
let requestedExitCode = 0;
let forceKillTimer = null;

function parseUiPort() {
  const raw = (process.env.SPOK_UI_PORT || process.env.PORT || "").trim();
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SPOK_UI_PORT (or PORT) must be an integer from 1 to 65535");
  }
  return port;
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.unref();
    reservation.once("error", reject);
    reservation.listen({ host: HOST, port, exclusive: true }, () => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reservation.close();
        reject(new Error("Could not determine the reserved UI port"));
        return;
      }
      resolve({ reservation, port: address.port });
    });
  });
}

async function reserveUiPort() {
  const explicitPort = parseUiPort();
  if (explicitPort !== null) {
    try {
      return await reservePort(explicitPort);
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        throw new Error(
          `UI port ${explicitPort} is already in use. Choose another with SPOK_UI_PORT.`
        );
      }
      throw error;
    }
  }

  try {
    return await reservePort(3000);
  } catch (error) {
    if (error?.code !== "EADDRINUSE") throw error;
    return reservePort(0);
  }
}

function waitForRuntimeReady(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Runtime did not announce readiness within ${timeoutMs / 1000}s`));
    }, timeoutMs);

    const onMessage = (message) => {
      if (
        message?.type !== "spok-runtime-ready" ||
        message.host !== HOST ||
        !Number.isInteger(message.port) ||
        message.port < 1 ||
        message.port > 65_535
      ) {
        return;
      }
      cleanup();
      resolve(message);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Runtime exited before readiness (code ${code ?? "none"}, signal ${signal ?? "none"})`
        )
      );
    };
    const onError = (error) => {
      cleanup();
      reject(new Error(`Runtime failed to start: ${error.message}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function waitForHealth(url, expectedToken, expectedPid, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Process exited with code ${child.exitCode} while waiting for ${url}`);
    }
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.json().catch(() => null);
      if (
        response.ok &&
        body?.ok === true &&
        body.localToken === expectedToken &&
        (expectedPid === undefined || body.pid === expectedPid)
      ) {
        return;
      }
      lastError = `HTTP ${response.status} returned an unexpected health payload`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Health check timed out for ${url}: ${lastError}`);
}

function forceKillTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process exited between the checks.
    }
  }
}

function maybeFinishShutdown() {
  if (!stopping) return;
  const runtimeDone = !runtime || runtime.exitCode !== null;
  const uiDone = !ui || ui.exitCode !== null;
  if (!runtimeDone || !uiDone) return;
  if (forceKillTimer) clearTimeout(forceKillTimer);
  process.exit(requestedExitCode);
}

function shutdown(exitCode, reason) {
  if (stopping) return;
  stopping = true;
  requestedExitCode = exitCode;
  if (reason) console.error(`\n[spok-dev] ${reason}`);
  else console.log("\n[spok-dev] stopping UI and runtime…");

  if (runtime?.connected) {
    runtime.send({ type: "spok-runtime-shutdown" });
  } else if (runtime?.exitCode === null) {
    runtime.kill("SIGTERM");
  }
  if (ui?.exitCode === null) ui.kill("SIGTERM");

  forceKillTimer = setTimeout(() => {
    forceKillTree(ui);
    forceKillTree(runtime);
    setTimeout(() => process.exit(requestedExitCode || 1), 1_000).unref();
  }, FORCE_KILL_DELAY_MS);
  forceKillTimer.unref();
  maybeFinishShutdown();
}

function supervise(child, label) {
  child.once("error", (error) => {
    shutdown(1, `${label} process error: ${error.message}`);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      shutdown(
        code === 0 ? 0 : 1,
        `${label} exited (code ${code ?? "none"}, signal ${signal ?? "none"})`
      );
    }
    maybeFinishShutdown();
  });
}

async function main() {
  const capabilityToken = randomBytes(32).toString("base64url");
  const { reservation, port: uiPort } = await reserveUiPort();
  const sharedEnv = {
    ...process.env,
    SPOK_LOCAL_TOKEN: capabilityToken,
  };

  const runtimeEntry = join(root, "src", "server", "main.ts");
  runtime = fork(runtimeEntry, [], {
    cwd: root,
    env: { ...sharedEnv, SPOK_PORT: "0" },
    execArgv: ["--import", "tsx"],
    detached: process.platform !== "win32",
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  supervise(runtime, "runtime");

  const ready = await waitForRuntimeReady(runtime);
  const runtimeOrigin = `http://${HOST}:${ready.port}`;
  await waitForHealth(
    `${runtimeOrigin}/api/health`,
    capabilityToken,
    ready.pid,
    runtime,
    5_000
  );

  const nextBin = require.resolve("next/dist/bin/next");
  await new Promise((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });

  ui = spawn(
    process.execPath,
    [nextBin, "dev", "--turbopack", "-H", HOST, "-p", String(uiPort)],
    {
      cwd: root,
      env: {
        ...sharedEnv,
        PORT: String(uiPort),
        SPOK_RUNTIME_ORIGIN: runtimeOrigin,
      },
      detached: process.platform !== "win32",
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    }
  );
  supervise(ui, "UI");

  const uiOrigin = `http://${HOST}:${uiPort}`;
  await waitForHealth(
    `${uiOrigin}/api/health`,
    capabilityToken,
    ready.pid,
    ui,
    STARTUP_TIMEOUT_MS
  );

  console.log("");
  console.log("══════════════════════════════════════════════");
  console.log("  Spok standalone runtime dogfood is ready");
  console.log(`  Open: ${uiOrigin}`);
  console.log("══════════════════════════════════════════════");
  console.log("");

  if (CHECK_ONLY) shutdown(0);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  shutdown(1, error instanceof Error ? error.stack || error.message : String(error));
});
process.on("unhandledRejection", (error) => {
  shutdown(1, error instanceof Error ? error.stack || error.message : String(error));
});

main().catch((error) => {
  shutdown(1, error instanceof Error ? error.stack || error.message : String(error));
});
