"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Shield,
  ShieldAlert,
  ShieldOff,
  Terminal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  completeUserApproval,
  cancelUserApproval,
  subscribeApprovalQueue,
} from "@/lib/settings-client";
import type { ApprovalRequest } from "@/lib/settings/types";
import { cn } from "@/lib/utils";

const RISK_STYLES: Record<
  string,
  { badge: "muted" | "amber" | "error" | "cyan"; label: string }
> = {
  low: { badge: "cyan", label: "Low risk" },
  medium: { badge: "amber", label: "Medium risk" },
  high: { badge: "amber", label: "High risk" },
  critical: { badge: "error", label: "Critical risk" },
};

/**
 * Full-screen approval gate for privileged actions (spawn custom commands, etc.).
 * Driven by the global approval waiter in settings-client.
 */
export function ApprovalOverlay() {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return subscribeApprovalQueue((snapshot) => {
      setRequests(snapshot.requests);
      setSelectedId((current) =>
        current && snapshot.requests.some((request) => request.id === current)
          ? current
          : snapshot.activeRequestId
      );
      setBusy(false);
    });
  }, []);

  const request =
    requests.find((candidate) => candidate.id === selectedId) ??
    requests[0] ??
    null;

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelUserApproval(request.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request]);

  if (!request) return null;

  const risk = RISK_STYLES[request.risk] ?? RISK_STYLES.medium;

  const decide = async (decision: "allow_once" | "allow_always" | "deny") => {
    if (busy) return;
    setBusy(true);
    try {
      if (decision === "deny") {
        cancelUserApproval(request.id);
      } else {
        await completeUserApproval(decision, request.id);
      }
    } catch {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
      onMouseDown={(e) => {
        // Click outside denies (safe default)
        if (e.target === e.currentTarget && !busy) {
          cancelUserApproval(request.id);
        }
      }}
    >
      <div className="crt-panel w-full max-w-lg overflow-hidden rounded-xl border border-phosphor-amber/40 shadow-[0_0_60px_rgba(255,176,0,0.15)]">
        <div className="flex items-start gap-3 border-b border-phosphor-amber/25 bg-phosphor-amber/10 px-4 py-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-phosphor-amber/40 bg-black/40">
            <ShieldAlert className="h-5 w-5 text-phosphor-amber" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="approval-title"
              className="font-mono text-sm font-semibold tracking-wide text-phosphor-amber"
            >
              Approval required
            </h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-phosphor-green/55">
              Spok blocked a privileged action until you review it. Deny is always safe.
              {requests.length > 1 && (
                <span className="ml-1 text-phosphor-cyan">
                  {requests.length} sessions are waiting.
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-phosphor-green/40 hover:bg-white/5 hover:text-phosphor-green"
            onClick={() => cancelUserApproval(request.id)}
            title="Deny (Esc)"
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {requests.length > 1 && (
            <div
              className="flex gap-1 overflow-x-auto border-b border-phosphor-green/15 pb-2"
              role="tablist"
              aria-label="Pending approvals"
            >
              {requests.map((candidate, index) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="tab"
                  aria-selected={candidate.id === request.id}
                  onClick={() => {
                    setSelectedId(candidate.id);
                    setBusy(false);
                  }}
                  className={cn(
                    "max-w-[11rem] shrink-0 truncate rounded border px-2 py-1 font-mono text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-phosphor-cyan/50",
                    candidate.id === request.id
                      ? "border-phosphor-cyan/45 bg-phosphor-cyan/10 text-phosphor-cyan"
                      : "border-phosphor-green/15 text-phosphor-green/45 hover:border-phosphor-green/30 hover:text-phosphor-green/75"
                  )}
                  title={`${candidate.reason}\n${candidate.cwd ?? ""}`}
                >
                  {index + 1}. {candidate.sessionId?.slice(0, 8) || candidate.profile || candidate.action}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={risk.badge}>{risk.label}</Badge>
            <Badge variant="muted">{request.action}</Badge>
            {request.profile && (
              <Badge variant="cyan">profile:{request.profile}</Badge>
            )}
            <Badge variant="muted" className="font-mono normal-case">
              {request.policy}
            </Badge>
          </div>

          <p className="text-xs leading-relaxed text-phosphor-green/75">
            {request.reason}
          </p>

          <div className="rounded-lg border border-phosphor-green/20 bg-black/50 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-phosphor-green/40">
              <Terminal className="h-3 w-3" />
              Command preview
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-phosphor-green">
              {request.preview}
            </pre>
          </div>

          {request.cwd && (
            <div className="font-mono text-[10px] text-phosphor-green/40">
              <span className="text-phosphor-green/30">cwd </span>
              {request.cwd}
            </div>
          )}

          <div className="flex items-start gap-2 rounded border border-phosphor-cyan/20 bg-phosphor-cyan/5 px-2.5 py-2 text-[11px] text-phosphor-cyan/80">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong className="font-medium">Allow always</strong> remembers this
              command for this workspace. You can revoke grants in Settings →
              Permissions.
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-phosphor-green/15 bg-black/30 p-3 sm:flex-row sm:items-center sm:justify-end">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void decide("deny")}
            className="sm:mr-auto"
          >
            <ShieldOff className="h-3.5 w-3.5" />
            Deny
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void decide("allow_once")}
          >
            <Check className="h-3.5 w-3.5" />
            Allow once
          </Button>
          <Button
            variant="amber"
            size="sm"
            disabled={busy}
            onClick={() => void decide("allow_always")}
            className={cn(
              request.risk === "critical" && "ring-1 ring-red-500/40"
            )}
          >
            <Shield className="h-3.5 w-3.5" />
            Allow always
          </Button>
        </div>
      </div>
    </div>
  );
}
