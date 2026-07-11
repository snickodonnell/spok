import type { NextConfig } from "next";
import path from "path";

const RUNTIME_ROUTE_SOURCES = [
  "/api/health",
  "/api/session/start",
  "/api/fs/browse",
  "/api/workspace/trust",
  "/api/session/git",
  "/api/session/git-diff",
  "/api/sessions",
  "/api/sessions/:path*",
  "/api/settings",
  "/api/approvals",
  "/api/diagnostics",
  "/api/runtime/cli-status",
  "/api/automation/jobs",
];

function getLoopbackRuntimeOrigin(): string | null {
  const raw = process.env.SPOK_RUNTIME_ORIGIN?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SPOK_RUNTIME_ORIGIN must be a valid loopback HTTP URL");
  }

  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "SPOK_RUNTIME_ORIGIN must be http://127.0.0.1:<port> with no path or credentials"
    );
  }

  return url.origin;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  async rewrites() {
    const runtimeOrigin = getLoopbackRuntimeOrigin();
    if (!runtimeOrigin) return [];

    return {
      beforeFiles: RUNTIME_ROUTE_SOURCES.map((source) => ({
        source,
        destination: `${runtimeOrigin}${source}`,
      })),
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
