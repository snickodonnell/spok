"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useSpokStore } from "@/lib/store";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import {
  markAppBootEnd,
  markAppBootStart,
  sampleMemoryHeap,
} from "@/lib/perf";

markAppBootStart();

/**
 * Thin shell router. Desktop and mobile are separate chunks so a phone on
 * Wi‑Fi never downloads Monaco / workspace panels.
 */
const DesktopShell = dynamic(
  () =>
    import("./desktop-shell").then((m) => m.DesktopShell),
  {
    ssr: false,
    loading: () => <ShellSplash label="Loading workbench…" />,
  }
);

const MobileShell = dynamic(
  () =>
    import("@/components/mobile/mobile-shell").then((m) => m.MobileShell),
  {
    ssr: false,
    loading: () => <ShellSplash label="Loading phone UI…" />,
  }
);

function ShellSplash({ label }: { label: string }) {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-2 bg-crt-bg text-phosphor-green/55">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function AppShell() {
  const { isMobile, ready: layoutReady, preference, setPreference } =
    useMobileLayout();

  useEffect(() => {
    if (!layoutReady) return;
    markAppBootEnd({ surface: isMobile ? "mobile" : "desktop" });
    sampleMemoryHeap();
  }, [layoutReady, isMobile]);

  // Defer automation imports — not needed for first paint / phone welcome
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("@/lib/background-runner").then((m) => {
      if (cancelled) return;
      stop = m.startScheduleTicker();
      m.ensureQueuePump();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const automationJobs = useSpokStore((s) => s.automationJobs);
  useEffect(() => {
    void import("@/lib/background-runner").then((m) => m.ensureQueuePump());
  }, [automationJobs]);

  if (!layoutReady) {
    return <ShellSplash label="Starting…" />;
  }

  if (isMobile) {
    return (
      <MobileShell
        layoutPreference={preference}
        onLayoutPreference={setPreference}
      />
    );
  }

  return <DesktopShell />;
}
