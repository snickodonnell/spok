import type { SampleSessionMeta, StreamEvent } from "../types";
import { authRefactorEvents, authRefactorMeta } from "./auth-refactor";
import { liveDashboardEvents, liveDashboardMeta } from "./live-dashboard";

export interface SampleDefinition {
  meta: SampleSessionMeta;
  events: StreamEvent[];
}

export const SAMPLES: SampleDefinition[] = [
  { meta: authRefactorMeta, events: authRefactorEvents },
  { meta: liveDashboardMeta, events: liveDashboardEvents },
];

export function getSample(id: string): SampleDefinition | undefined {
  return SAMPLES.find((s) => s.meta.id === id);
}

export { authRefactorEvents, authRefactorMeta, liveDashboardEvents, liveDashboardMeta };
