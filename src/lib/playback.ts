import type { StreamEvent } from "./types";

export type PlaybackController = {
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setSpeed: (speed: number) => void;
  isPaused: () => boolean;
};

/**
 * Replay a sequence of stream events with timing, for sample demos and paste playback.
 */
export function playEvents(
  events: StreamEvent[],
  onEvent: (event: StreamEvent) => void,
  options?: {
    speed?: number;
    onComplete?: () => void;
    minDelayMs?: number;
    maxDelayMs?: number;
  }
): PlaybackController {
  let speed = options?.speed ?? 1;
  let paused = false;
  let stopped = false;
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const minDelay = options?.minDelayMs ?? 40;
  const maxDelay = options?.maxDelayMs ?? 400;

  const schedule = () => {
    if (stopped || index >= events.length) {
      if (!stopped) options?.onComplete?.();
      return;
    }
    if (paused) return;

    const current = events[index];
    const next = events[index + 1];
    let delay = 120;
    if (next) {
      const natural = next.timestamp - current.timestamp;
      delay = Math.min(maxDelay, Math.max(minDelay, natural || 120));
    }
    delay = delay / speed;

    timer = setTimeout(() => {
      if (stopped) return;
      onEvent(events[index]);
      index++;
      schedule();
    }, delay);
  };

  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    pause: () => {
      paused = true;
      if (timer) clearTimeout(timer);
    },
    resume: () => {
      if (!paused) return;
      paused = false;
      schedule();
    },
    setSpeed: (s) => {
      speed = Math.max(0.25, Math.min(8, s));
    },
    isPaused: () => paused,
  };
}
