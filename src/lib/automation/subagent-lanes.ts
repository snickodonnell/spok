import type { StreamEvent, TraceNode } from "@/lib/types";
import type { SubagentLane, SubagentLaneStatus } from "./types";

/**
 * Build subagent lanes from session trace nodes.
 * Keeps subagent work inspectable without dumping into the main thought feed.
 */
export function extractSubagentLanes(
  nodes: Record<string, TraceNode>
): SubagentLane[] {
  const list = Object.values(nodes);
  const byId = new Map<string, SubagentLane>();

  for (const n of list) {
    if (n.type === "subagent" || n.subagentId) {
      const laneId = n.subagentId || n.id;
      const existing = byId.get(laneId);
      const status = mapNodeStatus(n.status);
      if (!existing) {
        byId.set(laneId, {
          id: laneId,
          label: n.title || n.summary || `Subagent ${laneId.slice(0, 8)}`,
          status,
          startedAt: n.timestamp,
          endedAt:
            status === "running" || status === "pending"
              ? undefined
              : n.timestamp + (n.durationMs ?? 0),
          nodeIds: [n.id],
          summary: n.summary || clip(n.content, 280),
          toolCallCount: 0,
          errorCount: status === "error" ? 1 : 0,
          childSessionId:
            typeof n.meta?.childSessionId === "string"
              ? n.meta.childSessionId
              : undefined,
        });
      } else {
        existing.nodeIds.push(n.id);
        if (n.timestamp < existing.startedAt) existing.startedAt = n.timestamp;
        if (status === "error") existing.errorCount += 1;
        if (status === "success" || status === "error" || status === "skipped") {
          existing.status = status;
          existing.endedAt = n.timestamp + (n.durationMs ?? 0);
        } else if (existing.status === "pending" && status === "running") {
          existing.status = "running";
        }
        if (n.summary || n.content) {
          existing.summary = n.summary || clip(n.content, 280);
        }
        if (n.title && existing.label.startsWith("Subagent")) {
          existing.label = n.title;
        }
      }
    }
  }

  // Attribute tool_call / tool_result / thinking under a subagent parent
  for (const n of list) {
    if (!n.parentId) continue;
    const parent = nodes[n.parentId];
    if (!parent) continue;
    const laneId = parent.subagentId || (parent.type === "subagent" ? parent.id : null);
    if (!laneId) continue;
    const lane = byId.get(laneId);
    if (!lane) continue;
    if (!lane.nodeIds.includes(n.id)) lane.nodeIds.push(n.id);
    if (n.type === "tool_call") lane.toolCallCount += 1;
    if (n.type === "error" || n.status === "error") lane.errorCount += 1;
  }

  // Also walk meta.subagentId on any node
  for (const n of list) {
    const sid =
      n.subagentId ||
      (typeof n.meta?.subagentId === "string" ? n.meta.subagentId : null);
    if (!sid) continue;
    const lane = byId.get(sid);
    if (!lane) continue;
    if (!lane.nodeIds.includes(n.id)) lane.nodeIds.push(n.id);
  }

  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Merge lane outcomes into one human summary for the parent session.
 * Used as a system event / Monitor card — not injected into Thinking stream.
 */
export function mergeSubagentSummaries(lanes: SubagentLane[]): string {
  if (!lanes.length) return "";
  const lines = [
    `## Subagent summary (${lanes.length} lane${lanes.length === 1 ? "" : "s"})`,
    "",
  ];
  for (const lane of lanes) {
    const dur =
      lane.endedAt != null
        ? `${Math.max(0, Math.round((lane.endedAt - lane.startedAt) / 1000))}s`
        : "…";
    lines.push(
      `- **${lane.label}** · ${lane.status} · ${dur} · tools:${lane.toolCallCount}` +
        (lane.errorCount ? ` · errors:${lane.errorCount}` : "")
    );
    if (lane.summary) {
      lines.push(`  ${lane.summary.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  const ok = lanes.filter((l) => l.status === "success").length;
  const err = lanes.filter((l) => l.status === "error").length;
  const run = lanes.filter((l) => l.status === "running" || l.status === "pending").length;
  lines.push("");
  lines.push(`Totals: ${ok} ok · ${err} failed · ${run} in progress`);
  return lines.join("\n");
}

/** True if a trace node should be hidden from the main thinking feed. */
export function isSubagentPollutingNode(
  node: TraceNode,
  lanes: SubagentLane[]
): boolean {
  if (node.type === "subagent") return true;
  if (node.subagentId) return true;
  if (typeof node.meta?.subagentId === "string") return true;
  for (const lane of lanes) {
    if (lane.nodeIds.includes(node.id) && node.type !== "message") {
      // Keep top-level messages; hide tool noise from lanes
      if (node.type === "tool_call" || node.type === "tool_result") return true;
      if (node.type === "thinking" || node.type === "reasoning") {
        // Subagent thinking stays in the lane panel, not main feed
        return true;
      }
    }
  }
  return false;
}

/**
 * Filter event log entries that belong only to subagent lanes (for optional
 * "main only" views). Pure heuristic on type + meta.
 */
export function isSubagentEvent(event: StreamEvent): boolean {
  if (event.type === "subagent_start" || event.type === "subagent_end") return true;
  if (event.subagentId) return true;
  if (event.meta && typeof event.meta.subagentId === "string") return true;
  return false;
}

function mapNodeStatus(
  s?: TraceNode["status"]
): SubagentLaneStatus {
  if (s === "success") return "success";
  if (s === "error") return "error";
  if (s === "skipped") return "skipped";
  if (s === "running") return "running";
  if (s === "pending") return "pending";
  return "running";
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
