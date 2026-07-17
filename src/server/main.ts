/**
 * Standalone Spok privileged runtime (Track A PR2).
 *
 * Binds 127.0.0.1 only. Port from SPOK_PORT or 7788.
 * No unauthenticated HTTP shutdown — process signals only.
 *
 *   npx tsx src/server/main.ts
 *   node --import tsx src/server/main.ts
 */

import http from "http";
import { stopAllProcesses } from "@/lib/process-lifecycle";
import { dispatchRequest } from "./router";

const HOST = "127.0.0.1";
const rawPort = process.env.SPOK_PORT?.trim();
const parsedPort = rawPort === undefined || rawPort === "" ? 7788 : Number(rawPort);
if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65_535) {
  throw new Error("SPOK_PORT must be an integer from 0 to 65535");
}
const PORT = parsedPort;

function nodeToWebRequest(
  req: http.IncomingMessage,
  body: Buffer
): Request {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const url = `http://${host}${req.url || "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((item) => headers.append(k, item));
    else headers.set(k, v);
  }
  const method = (req.method || "GET").toUpperCase();
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && body.length) {
    // Uint8Array is a valid BodyInit; Node Buffer is not always typed as such
    init.body = new Uint8Array(body);
  }
  return new Request(url, init);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function webToNodeResponse(
  webRes: Response,
  res: http.ServerResponse
): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    // Node disallows setting transfer-encoding manually in some cases
    if (key.toLowerCase() === "transfer-encoding") return;
    res.setHeader(key, value);
  });

  if (!webRes.body) {
    res.end();
    return;
  }

  const reader = webRes.body.getReader();
  const detach = () => {
    void reader.cancel("HTTP client disconnected").catch(() => undefined);
  };
  res.once("close", detach);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        res.write(Buffer.from(value));
      }
    }
  } catch {
    /* client aborted */
  } finally {
    res.off("close", detach);
    if (!res.writableEnded) res.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const body = await readBody(req);
    const webReq = nodeToWebRequest(req, body);
    const webRes = await dispatchRequest(webReq);
    await webToNodeResponse(webRes, res);
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: e instanceof Error ? e.message : "Internal error",
        })
      );
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  console.log(`[spok-runtime] listening on http://${HOST}:${port}`);
  if (process.send) {
    process.send({ type: "spok-runtime-ready", host: HOST, port, pid: process.pid });
  }
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[spok-runtime] ${signal} — closing`);
  stopAllProcesses();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("message", (message) => {
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "spok-runtime-shutdown"
  ) {
    shutdown("supervisor request");
  }
});
