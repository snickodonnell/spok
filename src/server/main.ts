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
import { dispatchRequest } from "./router";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SPOK_PORT || 7788) || 7788;

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
    res.end();
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
  // eslint-disable-next-line no-console
  console.log(`[spok-runtime] listening on http://${HOST}:${PORT}`);
});

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`[spok-runtime] ${signal} — closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
