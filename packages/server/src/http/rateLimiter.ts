export interface RateLimitConfig {
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export interface Clock {
  readonly now: () => number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RateLimiter {
  acquire(signal?: AbortSignal): Promise<void>;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  return new DOMException("The operation was aborted.", "AbortError");
}

export function createRateLimiter(config: RateLimitConfig, clock: Clock): RateLimiter {
  let tokens = config.capacity;
  let lastRefillAt = clock.now();
  const queue: Waiter[] = [];
  let processing = false;

  const refill = (): void => {
    const now = clock.now();
    const elapsedSec = (now - lastRefillAt) / 1000;
    if (elapsedSec <= 0) {
      return;
    }
    tokens = Math.min(config.capacity, tokens + elapsedSec * config.refillPerSecond);
    lastRefillAt = now;
  };

  const timeUntilNextTokenMs = (): number => {
    if (tokens >= 1) {
      return 0;
    }
    const deficit = 1 - tokens;
    return Math.ceil((deficit / config.refillPerSecond) * 1000);
  };

  const cleanupWaiter = (waiter: Waiter): void => {
    if (waiter.onAbort && waiter.signal) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  };

  const removeWaiter = (waiter: Waiter): void => {
    const index = queue.indexOf(waiter);
    if (index !== -1) {
      queue.splice(index, 1);
    }
    cleanupWaiter(waiter);
  };

  const processQueue = async (): Promise<void> => {
    if (processing) {
      return;
    }
    processing = true;

    try {
      while (queue.length > 0) {
        refill();

        while (queue.length > 0) {
          const head = queue[0];

          if (head.signal?.aborted) {
            queue.shift();
            cleanupWaiter(head);
            head.reject(abortError(head.signal));
            continue;
          }

          if (tokens < 1) {
            break;
          }

          tokens -= 1;
          const waiter = queue.shift();
          if (waiter === undefined) {
            break;
          }
          cleanupWaiter(waiter);
          waiter.resolve();
        }

        if (queue.length === 0) {
          break;
        }

        await clock.sleep(timeUntilNextTokenMs());
      }
    } finally {
      processing = false;
    }

    if (queue.length > 0) {
      void processQueue();
    }
  };

  const acquire = (signal?: AbortSignal): Promise<void> => {
    refill();

    if (signal?.aborted) {
      return Promise.reject(abortError(signal));
    }

    if (queue.length === 0 && !processing && tokens >= 1) {
      tokens -= 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };

      if (signal) {
        waiter.onAbort = () => {
          removeWaiter(waiter);
          reject(abortError(signal));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }

      queue.push(waiter);
      void processQueue();
    });
  };

  return { acquire };
}
