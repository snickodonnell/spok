import { nanoid } from "nanoid";
import type { AppNotification, NotificationKind } from "./types";
import { AUTOMATION_DEFAULTS } from "./types";

export function createNotification(
  partial: Omit<AppNotification, "id" | "timestamp" | "read"> & {
    id?: string;
    timestamp?: number;
    read?: boolean;
  }
): AppNotification {
  return {
    id: partial.id ?? `note-${nanoid(10)}`,
    kind: partial.kind,
    title: partial.title,
    body: partial.body,
    timestamp: partial.timestamp ?? Date.now(),
    read: partial.read ?? false,
    sessionId: partial.sessionId,
    jobId: partial.jobId,
    scheduleId: partial.scheduleId,
    channelId: partial.channelId,
    action: partial.action,
  };
}

export function prependNotification(
  list: AppNotification[],
  note: AppNotification,
  max = AUTOMATION_DEFAULTS.maxNotifications
): AppNotification[] {
  return [note, ...list].slice(0, max);
}

export function markNotificationRead(
  list: AppNotification[],
  id: string
): AppNotification[] {
  return list.map((n) => (n.id === id ? { ...n, read: true } : n));
}

export function markAllNotificationsRead(
  list: AppNotification[]
): AppNotification[] {
  return list.map((n) => ({ ...n, read: true }));
}

export function unreadCount(list: AppNotification[]): number {
  return list.filter((n) => !n.read).length;
}

export function notificationTone(
  kind: NotificationKind
): "success" | "error" | "warn" | "info" {
  switch (kind) {
    case "run_complete":
    case "subagent_complete":
      return "success";
    case "run_failed":
      return "error";
    case "approval_needed":
    case "schedule_skipped":
      return "warn";
    default:
      return "info";
  }
}
