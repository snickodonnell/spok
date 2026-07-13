"use client";

import { useEffect } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmTone = "amber" | "danger" | "cyan";

/**
 * Modal confirmation for risky Git / runtime actions.
 * Escape and outside-click cancel (safe default).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "amber",
  busy,
  onConfirm,
  onCancel,
  testId,
}: {
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional data-testid on the dialog surface (not a zero-size wrapper). */
  testId?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const border =
    tone === "danger"
      ? "border-red-500/40"
      : tone === "cyan"
        ? "border-phosphor-cyan/40"
        : "border-phosphor-amber/40";
  const glow =
    tone === "danger"
      ? "shadow-[0_0_50px_rgba(255,68,85,0.12)]"
      : tone === "cyan"
        ? "shadow-[0_0_50px_rgba(51,224,255,0.12)]"
        : "shadow-[0_0_50px_rgba(255,176,0,0.12)]";
  const headBg =
    tone === "danger"
      ? "bg-red-500/10 border-red-500/25"
      : tone === "cyan"
        ? "bg-phosphor-cyan/10 border-phosphor-cyan/25"
        : "bg-phosphor-amber/10 border-phosphor-amber/25";
  const titleColor =
    tone === "danger"
      ? "text-red-400"
      : tone === "cyan"
        ? "text-phosphor-cyan"
        : "text-phosphor-amber";

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      data-testid={testId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className={cn(
          "crt-panel w-full max-w-md overflow-hidden rounded-xl border",
          border,
          glow
        )}
      >
        <div className={cn("flex items-start gap-3 border-b px-4 py-3", headBg)}>
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/40">
            {tone === "danger" ? (
              <ShieldAlert className="h-5 w-5 text-red-400" />
            ) : (
              <AlertTriangle className={cn("h-5 w-5", titleColor)} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="confirm-title"
              className={cn("font-mono text-sm font-semibold tracking-wide", titleColor)}
            >
              {title}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-phosphor-green/70">
              {description}
            </p>
          </div>
        </div>

        {detail && (
          <pre className="max-h-40 overflow-auto border-b border-phosphor-green/10 bg-black/40 px-4 py-3 font-mono text-[11px] text-phosphor-green/65 whitespace-pre-wrap">
            {detail}
          </pre>
        )}

        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "destructive" : tone === "cyan" ? "secondary" : "amber"}
            size="sm"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
