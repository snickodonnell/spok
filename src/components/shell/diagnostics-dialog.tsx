"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSpokStore } from "@/lib/store";
import { localFetch } from "@/lib/local-api-client";
import { isDesktopRuntime, getDesktopAppInfo } from "@/lib/desktop";
import type { DiagnosticsBundle } from "@/lib/diagnostics";
import { toast } from "sonner";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  Loader2,
  RefreshCw,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";

type DiagResponse = {
  ok: boolean;
  summary: { ok: number; warn: number; error: number; headline: string };
  diagnostics: DiagnosticsBundle;
};

export function DiagnosticsDialog() {
  const open = useSpokStore((s) => s.diagnosticsOpen);
  const setOpen = useSpokStore((s) => s.setDiagnosticsOpen);
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DiagResponse | null>(null);
  const [desktopLabel, setDesktopLabel] = useState<string>("Browser");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cwd = session?.config.cwd;
      const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const res = await localFetch(`/api/diagnostics${q}`);
      const json = (await res.json()) as DiagResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || `Diagnostics failed (${res.status})`);
      setData(json);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Diagnostics failed");
    } finally {
      setLoading(false);
    }
  }, [session?.config.cwd]);

  useEffect(() => {
    if (open) {
      void load();
      void getDesktopAppInfo().then((info) => {
        if (isDesktopRuntime() && info) {
          setDesktopLabel(
            `Desktop · ${info.platform}${info.version ? ` · v${info.version}` : ""}`
          );
        } else {
          setDesktopLabel("Browser (local Next)");
        }
      });
    }
  }, [open, load]);

  const download = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data.diagnostics, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spok-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Diagnostics bundle downloaded");
  };

  const copySummary = async () => {
    if (!data) return;
    const lines = [
      data.summary.headline,
      `theme=${data.diagnostics.settings.theme}`,
      `permission=${data.diagnostics.settings.permissionMode}`,
      `sessions=${data.diagnostics.sessions.count}`,
      `platform=${data.diagnostics.app.platform}`,
      ...data.diagnostics.checks.map(
        (c) => `[${c.severity}] ${c.id}: ${c.message}`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Summary copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden p-0">
        <div className="border-b border-phosphor-green/15 px-5 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-phosphor-cyan" />
              Diagnostics
            </DialogTitle>
            <DialogDescription>
              Redacted health report for support and self-checks. Secrets and
              capability tokens are never exported as values.
            </DialogDescription>
          </DialogHeader>
        </div>

        {loading && !data ? (
          <div className="flex h-48 items-center justify-center gap-2 text-phosphor-green/50">
            <Loader2 className="h-5 w-5 animate-spin" />
            Collecting diagnostics…
          </div>
        ) : data ? (
          <ScrollArea className="h-[min(56vh,460px)] px-5 py-3">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  data.summary.error > 0
                    ? "error"
                    : data.summary.warn > 0
                      ? "amber"
                      : "success"
                }
              >
                {data.summary.headline}
              </Badge>
              <Badge variant="muted">{desktopLabel}</Badge>
              <Badge variant="cyan">
                {data.diagnostics.sessions.count} sessions
              </Badge>
            </div>

            <ul className="space-y-1.5">
              {data.diagnostics.checks.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "flex items-start gap-2 rounded border px-2.5 py-2 text-[11px]",
                    c.severity === "error"
                      ? "border-phosphor-red/30 bg-phosphor-red/5"
                      : c.severity === "warn"
                        ? "border-phosphor-amber/30 bg-phosphor-amber/5"
                        : "border-phosphor-green/10 bg-black/20"
                  )}
                >
                  {c.severity === "error" ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-phosphor-red" />
                  ) : c.severity === "warn" ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-phosphor-amber" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-phosphor-green" />
                  )}
                  <div>
                    <div className="font-mono text-phosphor-green/80">{c.id}</div>
                    <div className="text-phosphor-green/50">{c.message}</div>
                  </div>
                </li>
              ))}
            </ul>

            <section className="mt-4 rounded border border-phosphor-green/10 bg-black/20 p-3 font-mono text-[10px] text-phosphor-green/45">
              <div>home: {data.diagnostics.paths.spokHome}</div>
              <div>
                theme: {data.diagnostics.settings.theme} · mode:{" "}
                {data.diagnostics.settings.permissionMode}
              </div>
              <div>
                node {data.diagnostics.app.node} · {data.diagnostics.app.platform}/
                {data.diagnostics.app.arch}
              </div>
              <div>
                vault secrets: {data.diagnostics.security.vault.secretCount} ·
                trusted roots: {data.diagnostics.security.trustedRootCount}
              </div>
            </section>
          </ScrollArea>
        ) : (
          <div className="px-5 py-12 text-center text-sm text-phosphor-green/45">
            No diagnostics loaded
          </div>
        )}

        <DialogFooter className="gap-2 border-t border-phosphor-green/15 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copySummary()}
            disabled={!data}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy summary
          </Button>
          <Button size="sm" onClick={download} disabled={!data}>
            <Download className="h-3.5 w-3.5" />
            Download bundle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
