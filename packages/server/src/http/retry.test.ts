import { isToolError } from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeClock } from "../../test/fakeClock.js";
import { createHttpCore } from "./client.js";
import { HOST_CONFIG } from "./config.js";
import { computeBackoffDelay, isRetryable, parseRetryAfter } from "./retry.js";

describe("retry helpers", () => {
  it("classifies 500 as retryable and 400 as not retryable", () => {
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(400)).toBe(false);
  });

  it("parses Retry-After delta seconds", () => {
    expect(parseRetryAfter("2")).toBe(2000);
  });

  it("prefers Retry-After over computed backoff on 429", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const delay = computeBackoffDelay({
      attempt: 1,
      baseDelayMs: HOST_CONFIG.nominatim.retry.baseDelayMs,
      maxDelayMs: HOST_CONFIG.nominatim.retry.maxDelayMs,
      status: 429,
      retryAfterHeader: "2",
    });
    randomSpy.mockRestore();
    expect(delay).toBe(2000);
  });
});

describe("createHttpCore retry behaviour", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries a 500 with growing delays and succeeds on attempt 3", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const clock = createFakeClock();
    const sleepDurations: number[] = [];
    const instrumentedClock = {
      now: clock.now,
      sleep: async (ms: number) => {
        sleepDurations.push(ms);
        clock.advance(ms);
      },
    };

    let attempts = 0;
    const fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("upstream failure", { status: 500 });
      }
      return Response.json({ ok: true });
    });

    const core = createHttpCore({ fetch, clock: instrumentedClock });
    const result = await core.request<{ ok: boolean }>("open-meteo", "/forecast", {
      lat: "48.8",
    });
    randomSpy.mockRestore();

    expect(isToolError(result)).toBe(false);
    if (!isToolError(result)) {
      expect(result.data).toEqual({ ok: true });
      expect(result.meta.attempts).toBe(3);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleepDurations).toEqual([250, 500]);
  });

  it("does not retry a 400 — exactly one fetch", async () => {
    const fetch = vi.fn(async () => new Response("bad request", { status: 400 }));
    const core = createHttpCore({
      fetch,
      clock: { now: () => 0, sleep: async () => {} },
    });

    const result = await core.request("open-meteo", "/forecast", { lat: "48.8" });

    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe("UPSTREAM_ERROR");
      expect(result.details?.attempts).toBe(1);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("honours Retry-After over computed backoff", async () => {
    const sleepDurations: number[] = [];
    const fetch = vi.fn(
      async () =>
        new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
    );

    const core = createHttpCore({
      fetch,
      clock: {
        now: () => 0,
        sleep: async (ms: number) => {
          sleepDurations.push(ms);
        },
      },
    });

    const result = await core.request("open-meteo", "/forecast", { lat: "48.8" });

    expect(isToolError(result)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(HOST_CONFIG["open-meteo"].retry.maxAttempts);
    expect(sleepDurations.every((duration) => duration === 2000)).toBe(true);
  });

  it("stops at maxAttempts and maps exhausted 5xx to UPSTREAM_ERROR", async () => {
    const fetch = vi.fn(async () => new Response("still failing", { status: 503 }));
    const core = createHttpCore({
      fetch,
      clock: { now: () => 0, sleep: async () => {} },
    });

    const result = await core.request("open-meteo", "/forecast", { lat: "48.8" });

    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe("UPSTREAM_ERROR");
      expect(result.details?.attempts).toBe(HOST_CONFIG["open-meteo"].retry.maxAttempts);
    }
    expect(fetch).toHaveBeenCalledTimes(HOST_CONFIG["open-meteo"].retry.maxAttempts);
  });
});
