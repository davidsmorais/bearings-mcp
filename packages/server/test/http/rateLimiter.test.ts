import { describe, expect, it } from "vitest";
import { HOST_CONFIG } from "../../src/http/config.js";
import { createRateLimiter } from "../../src/http/rateLimiter.js";
import { createFakeClock, flushMicrotasks } from "./fakeClock.js";

describe("createRateLimiter", () => {
  it("drains 10 parallel acquires at 1/sec in FIFO order", async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter(HOST_CONFIG.nominatim.rateLimit, clock);
    const resolveOrder: number[] = [];

    const acquires = Array.from({ length: 10 }, (_, index) =>
      limiter.acquire().then(() => {
        resolveOrder.push(index);
      }),
    );

    await flushMicrotasks();
    expect(resolveOrder).toEqual([0]);

    for (let second = 1; second < 10; second += 1) {
      clock.advance(1000);
      await flushMicrotasks();
      expect(resolveOrder).toEqual(Array.from({ length: second + 1 }, (_, index) => index));
    }

    await Promise.all(acquires);
    expect(resolveOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("rejects an aborted waiter without consuming a token", async () => {
    const clock = createFakeClock();
    const limiter = createRateLimiter(HOST_CONFIG.nominatim.rateLimit, clock);
    const controller = new AbortController();

    await limiter.acquire();

    const aborted = limiter.acquire(controller.signal);
    const waiting = limiter.acquire();

    await flushMicrotasks();
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });

    clock.advance(1000);
    await flushMicrotasks();
    await waiting;

    const resolveTimes: number[] = [];
    const followUp = limiter.acquire().then(() => {
      resolveTimes.push(clock.now());
    });

    await flushMicrotasks();
    expect(resolveTimes).toEqual([]);

    clock.advance(1000);
    await flushMicrotasks();
    await followUp;
    expect(resolveTimes).toEqual([2000]);
  });
});
