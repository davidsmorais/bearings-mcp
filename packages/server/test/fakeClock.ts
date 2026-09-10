import type { Clock } from "../src/http/rateLimiter.js";

interface PendingSleep {
  wakeAt: number;
  resolve: () => void;
}

export interface FakeClock extends Clock {
  advance(ms: number): void;
  runPendingSleeps(): Promise<void>;
}

/** Controllable clock for rate-limiter and client tests — no real wall time. */
export const createFakeClock = (startMs = 0): FakeClock => {
  let nowMs = startMs;
  const pendingSleeps: PendingSleep[] = [];

  const drainDueSleeps = (): void => {
    const due = pendingSleeps.filter((sleep) => sleep.wakeAt <= nowMs);
    pendingSleeps.splice(
      0,
      pendingSleeps.length,
      ...pendingSleeps.filter((sleep) => sleep.wakeAt > nowMs),
    );
    for (const sleep of due) {
      sleep.resolve();
    }
  };

  return {
    now: () => nowMs,
    sleep: (ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        const entry: PendingSleep = { wakeAt: nowMs + ms, resolve };
        pendingSleeps.push(entry);

        if (signal) {
          signal.addEventListener(
            "abort",
            () => {
              const idx = pendingSleeps.indexOf(entry);
              if (idx !== -1) {
                pendingSleeps.splice(idx, 1);
              }
              reject(new DOMException("The operation was aborted.", "AbortError"));
            },
            { once: true },
          );
        }
      }),
    advance(ms: number) {
      nowMs += ms;
      drainDueSleeps();
    },
    async runPendingSleeps() {
      while (pendingSleeps.length > 0) {
        const nextWake = Math.min(...pendingSleeps.map((sleep) => sleep.wakeAt));
        if (nextWake > nowMs) {
          nowMs = nextWake;
        }
        drainDueSleeps();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    },
  };
};

export const flushMicrotasks = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};
