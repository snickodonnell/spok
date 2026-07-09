"use client";

import { useSpokStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { notificationTone } from "@/lib/automation/notifications";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  Bell,
  CheckCheck,
  Trash2,
  X,
  ExternalLink,
  Layers,
} from "lucide-react";

export function NotificationsDrawer() {
  const open = useSpokStore((s) => s.notificationsOpen);
  const setOpen = useSpokStore((s) => s.setNotificationsOpen);
  const notifications = useSpokStore((s) => s.notifications);
  const markRead = useSpokStore((s) => s.markNotificationRead);
  const markAll = useSpokStore((s) => s.markAllNotificationsRead);
  const clear = useSpokStore((s) => s.clearNotifications);
  const setActiveSession = useSpokStore((s) => s.setActiveSession);
  const setViewMode = useSpokStore((s) => s.setViewMode);
  const setMonitorOpen = useSpokStore((s) => s.setMonitorOpen);

  if (!open) return null;

  const act = (n: (typeof notifications)[0]) => {
    markRead(n.id);
    if (n.action === "open_session" && n.sessionId) {
      setActiveSession(n.sessionId);
      setViewMode("workspace");
      setOpen(false);
    } else if (n.action === "open_monitor") {
      setMonitorOpen(true);
      setOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        aria-label="Close notifications"
        onClick={() => setOpen(false)}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-phosphor-green/20 bg-crt-panel shadow-[-12px_0_40px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-2 border-b border-phosphor-green/15 px-4 py-3">
          <Bell className="h-4 w-4 text-phosphor-cyan" />
          <h2 className="font-mono text-sm text-phosphor-green">Notifications</h2>
          <Badge variant="muted" className="text-[9px]">
            {notifications.filter((n) => !n.read).length} new
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px]"
              onClick={() => markAll()}
              title="Mark all read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px]"
              onClick={() => clear()}
              title="Clear all"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {notifications.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Bell className="mx-auto mb-2 h-8 w-8 text-phosphor-green/20" />
              <p className="text-sm text-phosphor-green/50">All clear</p>
              <p className="mt-1 text-[11px] text-phosphor-green/30">
                Completions, failures, schedules, and approvals show up here.
              </p>
            </div>
          ) : (
            <ul className="space-y-1 p-2">
              {notifications.map((n) => {
                const tone = notificationTone(n.kind);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => act(n)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2.5 text-left transition",
                        n.read
                          ? "border-phosphor-green/10 bg-black/20 opacity-70"
                          : "border-phosphor-green/20 bg-black/40 hover:border-phosphor-cyan/30"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            "mt-1 h-2 w-2 shrink-0 rounded-full",
                            tone === "success" && "bg-phosphor-green",
                            tone === "error" && "bg-red-400",
                            tone === "warn" && "bg-phosphor-amber",
                            tone === "info" && "bg-phosphor-cyan"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-phosphor-green">
                              {n.title}
                            </span>
                            {!n.read && (
                              <Badge variant="cyan" className="text-[8px]">
                                new
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-phosphor-green/55">
                            {n.body}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[9px] text-phosphor-green/30">
                            <span>{formatRelativeTime(n.timestamp)}</span>
                            {n.action === "open_session" && (
                              <span className="inline-flex items-center gap-0.5 text-phosphor-cyan/50">
                                <ExternalLink className="h-2.5 w-2.5" />
                                session
                              </span>
                            )}
                            {n.action === "open_monitor" && (
                              <span className="inline-flex items-center gap-0.5 text-phosphor-cyan/50">
                                <Layers className="h-2.5 w-2.5" />
                                monitor
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </aside>
    </div>
  );
}
