/**
 * Session usage estimation and limit tones (context / turns).
 * Provider-reported tokens win when present; otherwise rough char/4 estimate.
 */

import type { Session, SessionMetrics } from "./types";

/** Default context budget when provider does not report a window. */
export const DEFAULT_CONTEXT_LIMIT = 128_000;

export type UsageTone = "calm" | "notice" | "caution" | "warn" | "critical";

export type UsageMeterModel = {
  id: "context" | "turns";
  label: string;
  shortLabel: string;
  used: number;
  limit: number;
  /** 0..1+ (can exceed 1) */
  ratio: number;
  percent: number;
  tone: UsageTone;
  /** true when used is estimated rather than provider-reported */
  estimated: boolean;
  detail: string;
};

export type SessionUsageSnapshot = {
  meters: UsageMeterModel[];
  /** Highest severity tone among meters (for strip chrome) */
  peakTone: UsageTone;
  context: UsageMeterModel;
  turns: UsageMeterModel | null;
};

const TONE_ORDER: UsageTone[] = [
  "calm",
  "notice",
  "caution",
  "warn",
  "critical",
];

export function usageToneFromRatio(ratio: number): UsageTone {
  if (!Number.isFinite(ratio) || ratio < 0) return "calm";
  if (ratio >= 0.98) return "critical";
  if (ratio >= 0.9) return "warn";
  if (ratio >= 0.75) return "caution";
  if (ratio >= 0.5) return "notice";
  return "calm";
}

/** Tailwind-friendly class bundles + CSS color for the fill bar. */
export function usageToneStyles(tone: UsageTone): {
  text: string;
  border: string;
  bg: string;
  bar: string;
  glow: string;
  label: string;
} {
  switch (tone) {
    case "critical":
      return {
        text: "text-phosphor-red",
        border: "border-phosphor-red/50",
        bg: "bg-phosphor-red/10",
        bar: "#ff4455",
        glow: "shadow-[0_0_8px_rgba(255,68,85,0.35)]",
        label: "Near limit",
      };
    case "warn":
      return {
        text: "text-phosphor-magenta",
        border: "border-phosphor-magenta/45",
        bg: "bg-phosphor-magenta/10",
        bar: "#ff33aa",
        glow: "shadow-[0_0_6px_rgba(255,51,170,0.25)]",
        label: "High",
      };
    case "caution":
      return {
        text: "text-phosphor-amber",
        border: "border-phosphor-amber/45",
        bg: "bg-phosphor-amber/10",
        bar: "#ffb000",
        glow: "shadow-[0_0_6px_rgba(255,176,0,0.2)]",
        label: "Elevated",
      };
    case "notice":
      return {
        text: "text-phosphor-cyan",
        border: "border-phosphor-cyan/40",
        bg: "bg-phosphor-cyan/10",
        bar: "#33e0ff",
        glow: "",
        label: "Moderate",
      };
    case "calm":
    default:
      return {
        text: "text-phosphor-green",
        border: "border-phosphor-green/30",
        bg: "bg-phosphor-green/8",
        bar: "#33ff66",
        glow: "",
        label: "Comfortable",
      };
  }
}

export function peakTone(tones: UsageTone[]): UsageTone {
  let best: UsageTone = "calm";
  for (const t of tones) {
    if (TONE_ORDER.indexOf(t) > TONE_ORDER.indexOf(best)) best = t;
  }
  return best;
}

/** Rough English tokenizer: ~4 characters per token. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Pull provider-reported usage from event meta when present.
 * Accepts common shapes: usage.total_tokens, tokens, input+output, etc.
 */
export function extractProviderTokens(meta: unknown): number | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const usage = m.usage;
  if (usage && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    const total =
      num(u.total_tokens) ??
      num(u.totalTokens) ??
      sumNullable(num(u.input_tokens) ?? num(u.prompt_tokens), num(u.output_tokens) ?? num(u.completion_tokens));
    if (total != null) return total;
  }
  const direct =
    num(m.total_tokens) ??
    num(m.totalTokens) ??
    num(m.tokens) ??
    sumNullable(num(m.input_tokens), num(m.output_tokens));
  return direct;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/** Content-based estimate of context occupancy for a session. */
export function estimateContextTokens(session: Session): {
  tokens: number;
  estimated: boolean;
} {
  let fromContent = 0;
  for (const n of Object.values(session.nodes)) {
    fromContent += estimateTokensFromText(n.title || "");
    fromContent += estimateTokensFromText(n.content || "");
    fromContent += estimateTokensFromText(n.summary || "");
  }
  for (const t of session.promptHistory ?? []) {
    fromContent += estimateTokensFromText(t.text || "");
  }
  // File diffs can dominate; sample only
  for (const f of Object.values(session.files)) {
    const sample = `${f.oldContent ?? ""}\n${f.newContent ?? ""}`.slice(0, 12_000);
    fromContent += estimateTokensFromText(sample);
  }

  const reported = session.metrics.tokensEstimate;
  if (typeof reported === "number" && reported > 0) {
    // Prefer the larger of provider report vs content estimate (provider is usually cumulative)
    return {
      tokens: Math.max(reported, fromContent),
      estimated: reported < fromContent,
    };
  }
  return { tokens: fromContent, estimated: true };
}

export function resolveContextLimit(opts?: {
  settingsLimit?: number | null;
  sessionLimit?: number | null;
  envLimit?: string | null;
}): number {
  const env = opts?.envLimit?.trim();
  if (env && /^\d+$/.test(env)) {
    return Math.max(1_000, Math.min(2_000_000, parseInt(env, 10)));
  }
  if (
    typeof opts?.sessionLimit === "number" &&
    Number.isFinite(opts.sessionLimit) &&
    opts.sessionLimit > 0
  ) {
    return Math.floor(opts.sessionLimit);
  }
  if (
    typeof opts?.settingsLimit === "number" &&
    Number.isFinite(opts.settingsLimit) &&
    opts.settingsLimit > 0
  ) {
    return Math.floor(opts.settingsLimit);
  }
  return DEFAULT_CONTEXT_LIMIT;
}

function buildMeter(
  id: UsageMeterModel["id"],
  label: string,
  shortLabel: string,
  used: number,
  limit: number,
  estimated: boolean,
  detail: string
): UsageMeterModel {
  const safeLimit = Math.max(1, limit);
  const ratio = used / safeLimit;
  const percent = Math.min(999, Math.round(ratio * 100));
  return {
    id,
    label,
    shortLabel,
    used,
    limit: safeLimit,
    ratio,
    percent,
    tone: usageToneFromRatio(ratio),
    estimated,
    detail,
  };
}

export function buildSessionUsage(
  session: Session,
  opts?: { contextLimit?: number }
): SessionUsageSnapshot {
  let envLimit: string | null = null;
  try {
    // Optional managed override; avoided on pure client if process is stripped
    envLimit =
      typeof process !== "undefined" && process.env?.SPOK_CONTEXT_LIMIT
        ? process.env.SPOK_CONTEXT_LIMIT
        : null;
  } catch {
    envLimit = null;
  }

  const limit = resolveContextLimit({
    settingsLimit: opts?.contextLimit,
    sessionLimit:
      typeof session.metrics.tokensLimit === "number"
        ? session.metrics.tokensLimit
        : null,
    envLimit,
  });

  const { tokens, estimated } = estimateContextTokens(session);
  const context = buildMeter(
    "context",
    "Context",
    "ctx",
    tokens,
    limit,
    estimated,
    estimated
      ? "Estimated from session content (~4 chars/token). Provider totals used when available."
      : "Includes provider-reported token totals when present."
  );

  let turns: UsageMeterModel | null = null;
  const maxTurns = session.grokFlags?.maxTurns;
  if (typeof maxTurns === "number" && maxTurns > 0) {
    const usedTurns = (session.promptHistory ?? []).filter(
      (t) => t.status === "success" || t.status === "running" || t.status === "error"
    ).length;
    turns = buildMeter(
      "turns",
      "Turns",
      "turns",
      usedTurns,
      maxTurns,
      false,
      `Prompt turns vs /max-turns ${maxTurns}`
    );
  }

  const meters = turns ? [context, turns] : [context];
  return {
    meters,
    peakTone: peakTone(meters.map((m) => m.tone)),
    context,
    turns,
  };
}

/** Merge provider token totals into metrics without wiping other fields. */
export function mergeTokensIntoMetrics(
  metrics: SessionMetrics,
  tokens: number
): SessionMetrics {
  if (!Number.isFinite(tokens) || tokens <= 0) return metrics;
  const prev = metrics.tokensEstimate ?? 0;
  return {
    ...metrics,
    tokensEstimate: Math.max(prev, Math.floor(tokens)),
  };
}
