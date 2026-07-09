import type { StreamEvent, SampleSessionMeta } from "../types";

export const liveDashboardMeta: SampleSessionMeta = {
  id: "sample-live-dashboard",
  name: "Live metrics dashboard",
  description:
    "Agent scaffolds a React metrics dashboard with WebSocket hooks and phosphor-styled charts.",
  duration: "~90s",
  filesChanged: 4,
  toolCalls: 8,
  tags: ["react", "dashboard", "websocket"],
};

const t0 = Date.now() - 90_000;

function ev(
  offset: number,
  partial: Omit<StreamEvent, "timestamp">
): StreamEvent {
  return { ...partial, timestamp: t0 + offset };
}

export const liveDashboardEvents: StreamEvent[] = [
  ev(0, {
    type: "session_start",
    id: "d0",
    title: "Session started",
    content: "Build a live metrics dashboard component",
  }),
  ev(400, {
    type: "goal",
    id: "dg1",
    title: "Goal",
    content:
      "Create a live metrics dashboard with WebSocket data hook, KPI cards, and a sparkline chart component.",
  }),
  ev(1500, {
    type: "thinking",
    id: "dth1",
    parentId: "dg1",
    title: "Architecture",
    content:
      "I'll use a useMetricsSocket hook for streaming numbers, pure SVG sparklines for zero-deps charts, and a Dashboard shell composing KPI cards.",
    status: "success",
  }),
  ev(3000, {
    type: "tool_call",
    id: "dtc1",
    parentId: "dg1",
    title: "Tool: list_dir",
    toolName: "list_dir",
    content: 'list_dir({ target_directory: "src/components" })',
    status: "running",
  }),
  ev(3800, {
    type: "tool_result",
    id: "dtr1",
    parentId: "dtc1",
    title: "Result: list_dir",
    content: "src/components/\n  ui/\n  layout/",
    status: "success",
    durationMs: 700,
  }),
  ev(5000, {
    type: "file_change",
    id: "dfc1",
    parentId: "dg1",
    title: "File: src/hooks/useMetricsSocket.ts",
    path: "src/hooks/useMetricsSocket.ts",
    diffStatus: "added",
    oldContent: "",
    newContent: `import { useEffect, useRef, useState, useCallback } from "react";

export type MetricPoint = { t: number; value: number };
export type MetricsSnapshot = {
  rps: number;
  latencyMs: number;
  errorRate: number;
  series: MetricPoint[];
};

const EMPTY: MetricsSnapshot = {
  rps: 0,
  latencyMs: 0,
  errorRate: 0,
  series: [],
};

export function useMetricsSocket(url: string) {
  const [data, setData] = useState<MetricsSnapshot>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const reconnect = useCallback(() => {
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setError(null);
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError("WebSocket error");
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as MetricsSnapshot;
        setData(msg);
      } catch {
        setError("Invalid metrics payload");
      }
    };
  }, [url]);

  useEffect(() => {
    reconnect();
    return () => wsRef.current?.close();
  }, [reconnect]);

  return { data, connected, error, reconnect };
}
`,
    content: "Added WebSocket metrics hook",
    status: "success",
  }),
  ev(8000, {
    type: "file_change",
    id: "dfc2",
    parentId: "dg1",
    title: "File: src/components/Sparkline.tsx",
    path: "src/components/Sparkline.tsx",
    diffStatus: "added",
    oldContent: "",
    newContent: `import React, { useMemo } from "react";

type Props = {
  points: Array<{ t: number; value: number }>;
  width?: number;
  height?: number;
  stroke?: string;
};

export function Sparkline({
  points,
  width = 160,
  height = 40,
  stroke = "#33ff66",
}: Props) {
  const d = useMemo(() => {
    if (points.length < 2) return "";
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = height - ((p.value - min) / range) * (height - 4) - 2;
        return \`\${i === 0 ? "M" : "L"}\${x.toFixed(1)},\${y.toFixed(1)}\`;
      })
      .join(" ");
  }, [points, width, height]);

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}
`,
    content: "Added Sparkline SVG component",
    status: "success",
  }),
  ev(11000, {
    type: "file_change",
    id: "dfc3",
    parentId: "dg1",
    title: "File: src/components/KpiCard.tsx",
    path: "src/components/KpiCard.tsx",
    diffStatus: "added",
    oldContent: "",
    newContent: `import React from "react";
import { Sparkline } from "./Sparkline";

type Props = {
  label: string;
  value: string;
  delta?: string;
  points?: Array<{ t: number; value: number }>;
  accent?: string;
};

export function KpiCard({
  label,
  value,
  delta,
  points = [],
  accent = "#33ff66",
}: Props) {
  return (
    <div className="rounded border border-emerald-500/30 bg-black/60 p-4 shadow-[0_0_12px_rgba(51,255,102,0.15)]">
      <div className="text-xs uppercase tracking-widest text-emerald-400/70">
        {label}
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-2xl text-emerald-300" style={{ textShadow: \`0 0 8px \${accent}\` }}>
            {value}
          </div>
          {delta && (
            <div className="text-xs text-cyan-400/80">{delta}</div>
          )}
        </div>
        {points.length > 1 && <Sparkline points={points} stroke={accent} />}
      </div>
    </div>
  );
}
`,
    content: "Added KPI card",
    status: "success",
  }),
  ev(14000, {
    type: "file_change",
    id: "dfc4",
    parentId: "dg1",
    title: "File: src/components/MetricsDashboard.tsx",
    path: "src/components/MetricsDashboard.tsx",
    diffStatus: "added",
    oldContent: "",
    newContent: `import React from "react";
import { useMetricsSocket } from "../hooks/useMetricsSocket";
import { KpiCard } from "./KpiCard";

type Props = { url?: string };

export function MetricsDashboard({ url = "ws://localhost:8080/metrics" }: Props) {
  const { data, connected, error, reconnect } = useMetricsSocket(url);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-lg text-emerald-300">LIVE METRICS</h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={\`h-2 w-2 rounded-full \${connected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}\`}
          />
          <span className="text-emerald-400/70">
            {connected ? "CONNECTED" : "DISCONNECTED"}
          </span>
          {!connected && (
            <button
              onClick={reconnect}
              className="rounded border border-cyan-500/40 px-2 py-0.5 text-cyan-300"
            >
              Reconnect
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="rounded border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Requests / sec"
          value={data.rps.toFixed(1)}
          points={data.series}
          accent="#33ff66"
        />
        <KpiCard
          label="Latency p50"
          value={\`\${data.latencyMs.toFixed(0)}ms\`}
          accent="#ffb000"
        />
        <KpiCard
          label="Error rate"
          value={\`\${(data.errorRate * 100).toFixed(2)}%\`}
          accent="#ff33aa"
        />
      </div>
    </div>
  );
}
`,
    content: "Added MetricsDashboard shell",
    status: "success",
  }),
  ev(17000, {
    type: "tool_call",
    id: "dtc2",
    parentId: "dg1",
    title: "Tool: run_terminal_command",
    toolName: "run_terminal_command",
    content: "npx tsc --noEmit",
    status: "running",
  }),
  ev(20000, {
    type: "tool_result",
    id: "dtr2",
    parentId: "dtc2",
    title: "Result: tsc",
    content: "Typecheck passed with 0 errors.",
    status: "success",
    durationMs: 2800,
  }),
  ev(22000, {
    type: "message",
    id: "dm1",
    parentId: "dg1",
    title: "Summary",
    content:
      "Shipped live metrics dashboard:\n- useMetricsSocket for WS streaming\n- Sparkline (SVG)\n- KpiCard + MetricsDashboard\n- Typecheck clean",
    status: "success",
  }),
  ev(23000, {
    type: "session_end",
    id: "d1",
    title: "Session completed",
    content: "Done",
    status: "success",
  }),
];
