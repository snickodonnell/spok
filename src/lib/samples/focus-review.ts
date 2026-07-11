/**
 * After sample / import playback, park the user on the Review workbench
 * with the risk-ordered queue and Why rail ready (dogfood path).
 */

import { buildReviewQueue } from "../review-queue";
import type {
  ProductMode,
  Session,
  ViewMode,
  WorkspaceRightTab,
} from "../types";

export type ReviewWorkbenchStore = {
  sessions: Record<string, Session>;
  setWorkspaceRightTab: (tab: WorkspaceRightTab) => void;
  setViewMode: (mode: ViewMode) => void;
  setProductMode: (mode: ProductMode) => void;
  setCausalDrawerOpen: (open: boolean) => void;
  selectFile: (id: string | null) => void;
};

/**
 * Focus Changes + highest-risk file + Why drawer for dogfooding the queue.
 */
export function focusReviewWorkbench(
  store: ReviewWorkbenchStore,
  sessionId: string
): { fileId: string | null; headline: string } {
  const session = store.sessions[sessionId];
  if (!session) {
    return { fileId: null, headline: "Session missing" };
  }

  store.setViewMode("workspace");
  store.setWorkspaceRightTab("changes");
  store.setProductMode("review");
  store.setCausalDrawerOpen(true);

  const queue = buildReviewQueue(session);
  const first = queue.flat[0];
  if (first) {
    store.selectFile(first.fileId);
  }

  return {
    fileId: first?.fileId ?? null,
    headline: queue.summary.headline,
  };
}
