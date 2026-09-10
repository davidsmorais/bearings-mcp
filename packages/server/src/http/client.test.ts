import { isToolError } from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeClock, flushMicrotasks } from "../../test/fakeClock.js";
import { createHttpCore } from "./client.js";
import { HOST_CONFIG } from "./config.js";

const instantClock = {
  now: () => 0,
  sleep: async () => {},
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("createHttpCore request()", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("serves a cache hit without a second fetch", async () => {
    const fetch = vi.fn(async () => jsonResponse({ city: "Paris" }));
    const core = createHttpCore({ fetch, clock: instantClock });
    const params = { q: "Paris" };

    const first = await core.request<{ city: string }>("nominatim", "/search", params);
    const second = await core.request<{ city: string }>("nominatim", "/search", params);

    expect(isToolError(first)).toBe(false);
    expect(isToolError(second)).toBe(false);
    if (!isToolError(second)) {
      expect(second.meta.cacheHit).toBe(true);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not consume a rate-limit token on cache hit", async () => {
    const clock = createFakeClock();
    const fetch = vi.fn(async () => jsonResponse({ city: "Paris" }));
    const core = createHttpCore({ fetch, clock });
    const params = { q: "Paris" };

    await core.request("nominatim", "/search", params);
    const cached = await core.request("nominatim", "/search", params);
    expect(isToolError(cached)).toBe(false);
    if (!isToolError(cached)) {
      expect(cached.meta.cacheHit).toBe(true);
    }

    const uncachedStartedAt = clock.now();
    const uncached = core.request("nominatim", "/search", { q: "Lyon" });
    await flushMicrotasks();
    clock.advance(1000);
    await flushMicrotasks();
    await uncached;

    expect(clock.now() - uncachedStartedAt).toBeGreaterThanOrEqual(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("consumes three tokens when a request retries twice", async () => {
    const fetch = vi.fn(async () => new Response("fail", { status: 500 }));
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await core.request("open-meteo", "/forecast", { lat: "48.8" });

    expect(isToolError(result)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(HOST_CONFIG["open-meteo"].retry.maxAttempts);
  });

  it("deduplicates identical concurrent requests into one fetch", async () => {
    let releaseFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const fetch = vi.fn(async () => {
      await fetchGate;
      return jsonResponse({ city: "Paris" });
    });

    const core = createHttpCore({ fetch, clock: instantClock });
    const params = { q: "Paris" };

    const first = core.request<{ city: string }>("nominatim", "/search", params);
    const second = core.request<{ city: string }>("nominatim", "/search", params);

    await flushMicrotasks();
    expect(fetch).toHaveBeenCalledTimes(1);

    releaseFetch?.();
    const [left, right] = await Promise.all([first, second]);

    expect(isToolError(left)).toBe(false);
    expect(isToolError(right)).toBe(false);
    if (!isToolError(left) && !isToolError(right)) {
      expect(left.data).toEqual(right.data);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed single-flight entry so the next call retries", async () => {
    const fetch = vi.fn(async () => new Response("fail", { status: 500 }));
    const core = createHttpCore({ fetch, clock: instantClock });
    const params = { lat: "48.8" };

    const first = await core.request("open-meteo", "/forecast", params);
    expect(isToolError(first)).toBe(true);

    const second = await core.request("open-meteo", "/forecast", params);
    expect(isToolError(second)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(HOST_CONFIG["open-meteo"].retry.maxAttempts * 2);
  });

  it("maps per-attempt timeout to TIMEOUT and clears the timer", async () => {
    vi.useFakeTimers();

    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const core = createHttpCore({ fetch, clock: instantClock });
    const resultPromise = core.request("open-meteo", "/forecast", { lat: "48.8" });
    const { maxAttempts, baseDelayMs } = HOST_CONFIG["open-meteo"].retry;
    const { timeoutMs } = HOST_CONFIG["open-meteo"];

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await vi.advanceTimersByTimeAsync(timeoutMs + 1);
      if (attempt < maxAttempts - 1) {
        await vi.advanceTimersByTimeAsync(baseDelayMs);
      }
    }

    const result = await resultPromise;

    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe("TIMEOUT");
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels on caller abort without retrying", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
          controller.abort();
        }),
    );

    const core = createHttpCore({ fetch, clock: instantClock });
    const result = await core.request(
      "open-meteo",
      "/forecast",
      { lat: "48.8" },
      { signal: controller.signal },
    );

    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe("UPSTREAM_ERROR");
      expect(result.message).toContain("cancelled");
      expect(result.details?.attempts).toBe(1);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts immediately when caller cancels during retry backoff sleep", async () => {
    const clock = createFakeClock();
    const controller = new AbortController();
    const fetch = vi.fn(async () => new Response("busy", { status: 429 }));
    const core = createHttpCore({ fetch, clock });

    const requestPromise = core.request(
      "open-meteo",
      "/forecast",
      { lat: "48.8" },
      { signal: controller.signal },
    );

    await flushMicrotasks();
    expect(fetch).toHaveBeenCalledTimes(1);

    controller.abort();
    await flushMicrotasks();

    const result = await requestPromise;
    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe("UPSTREAM_ERROR");
      expect(result.message).toContain("cancelled");
      expect(result.details?.attempts).toBe(1);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows Caller B to succeed when concurrent Caller A aborts mid-flight", async () => {
    let releaseFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      await fetchGate;
      if (init?.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return jsonResponse({ city: "Paris" });
    });

    const core = createHttpCore({ fetch, clock: instantClock });
    const params = { q: "Paris" };
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const callerA = core.request<{ city: string }>("nominatim", "/search", params, {
      signal: controllerA.signal,
    });
    const callerB = core.request<{ city: string }>("nominatim", "/search", params, {
      signal: controllerB.signal,
    });

    await flushMicrotasks();
    expect(fetch).toHaveBeenCalledTimes(1);

    controllerA.abort();
    await flushMicrotasks();

    releaseFetch?.();
    const [resultA, resultB] = await Promise.all([callerA, callerB]);

    expect(isToolError(resultA)).toBe(true);
    if (isToolError(resultA)) {
      expect(resultA.code).toBe("UPSTREAM_ERROR");
      expect(resultA.message).toContain("cancelled");
    }

    expect(isToolError(resultB)).toBe(false);
    if (!isToolError(resultB)) {
      expect(resultB.data).toEqual({ city: "Paris" });
    }

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows Caller A to succeed when concurrent Caller B aborts mid-flight", async () => {
    let releaseFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      await fetchGate;
      if (init?.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return jsonResponse({ city: "Paris" });
    });

    const core = createHttpCore({ fetch, clock: instantClock });
    const params = { q: "Paris" };
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const callerA = core.request<{ city: string }>("nominatim", "/search", params, {
      signal: controllerA.signal,
    });
    const callerB = core.request<{ city: string }>("nominatim", "/search", params, {
      signal: controllerB.signal,
    });

    await flushMicrotasks();
    expect(fetch).toHaveBeenCalledTimes(1);

    controllerB.abort();
    await flushMicrotasks();

    releaseFetch?.();
    const [resultA, resultB] = await Promise.all([callerA, callerB]);

    expect(isToolError(resultA)).toBe(false);
    if (!isToolError(resultA)) {
      expect(resultA.data).toEqual({ city: "Paris" });
    }

    expect(isToolError(resultB)).toBe(true);
    if (isToolError(resultB)) {
      expect(resultB.code).toBe("UPSTREAM_ERROR");
      expect(resultB.message).toContain("cancelled");
    }

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts underlying network fetch when all concurrent callers abort", async () => {
    let underlyingFetchSignal: AbortSignal | null | undefined;
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          underlyingFetchSignal = init?.signal;
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const core = createHttpCore({ fetch, clock: instantClock });
    const params = { q: "Paris" };
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const callerA = core.request("nominatim", "/search", params, {
      signal: controllerA.signal,
    });
    const callerB = core.request("nominatim", "/search", params, {
      signal: controllerB.signal,
    });

    await flushMicrotasks();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(underlyingFetchSignal?.aborted).toBe(false);

    controllerA.abort();
    await flushMicrotasks();
    expect(underlyingFetchSignal?.aborted).toBe(false);

    controllerB.abort();
    await flushMicrotasks();
    expect(underlyingFetchSignal?.aborted).toBe(true);

    const [resultA, resultB] = await Promise.all([callerA, callerB]);
    expect(isToolError(resultA)).toBe(true);
    expect(isToolError(resultB)).toBe(true);
  });

  it("immediately aborts pre-aborted caller without disrupting active flight", async () => {
    let releaseFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const fetch = vi.fn(async () => {
      await fetchGate;
      return jsonResponse({ city: "Paris" });
    });

    const core = createHttpCore({ fetch, clock: instantClock });
    const params = { q: "Paris" };
    const controllerA = new AbortController();
    const preAborted = AbortSignal.abort();

    const callerA = core.request<{ city: string }>("nominatim", "/search", params, {
      signal: controllerA.signal,
    });
    const callerPreAborted = core.request<{ city: string }>("nominatim", "/search", params, {
      signal: preAborted,
    });

    const resultPreAborted = await callerPreAborted;
    expect(isToolError(resultPreAborted)).toBe(true);
    if (isToolError(resultPreAborted)) {
      expect(resultPreAborted.code).toBe("UPSTREAM_ERROR");
      expect(resultPreAborted.message).toContain("cancelled");
      expect(resultPreAborted.details?.attempts).toBe(0);
    }

    releaseFetch?.();
    const resultA = await callerA;
    expect(isToolError(resultA)).toBe(false);
    if (!isToolError(resultA)) {
      expect(resultA.data).toEqual({ city: "Paris" });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  describe("terminal classification breaks the retry loop", () => {
    afterEach(() => {
      delete process.env.GEOAPIFY_API_KEY;
    });

    it("stops on a Geoapify quota 429 — one request, no backoff sleep", async () => {
      process.env.GEOAPIFY_API_KEY = "test-key";
      const sleep = vi.fn(async () => {});
      const fetch = vi.fn(async () => jsonResponse({ message: "Daily quota limit exceeded" }, 429));
      const core = createHttpCore({ fetch, clock: { now: () => 0, sleep } });

      const result = await core.request("geoapify", "/v2/places", { categories: "catering.bar" });

      expect(isToolError(result)).toBe(true);
      if (isToolError(result)) {
        expect(result.code).toBe("QUOTA_EXCEEDED");
        expect(result.details?.attempts).toBe(1);
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("still retries a plain Geoapify 429 to maxAttempts and maps it RATE_LIMITED", async () => {
      process.env.GEOAPIFY_API_KEY = "test-key";
      const fetch = vi.fn(async () => jsonResponse({ message: "Too many requests" }, 429));
      const core = createHttpCore({ fetch, clock: instantClock });

      const result = await core.request("geoapify", "/v2/places", { categories: "catering.bar" });

      expect(isToolError(result)).toBe(true);
      if (isToolError(result)) {
        expect(result.code).toBe("RATE_LIMITED");
      }
      expect(fetch).toHaveBeenCalledTimes(HOST_CONFIG.geoapify.retry.maxAttempts);
    });

    it("leaves a host with no classifyStatus retrying a 429 as before", async () => {
      const fetch = vi.fn(async () => jsonResponse({ message: "Daily quota limit exceeded" }, 429));
      const core = createHttpCore({ fetch, clock: instantClock });

      // open-meteo has no classifyStatus — the quota body is meaningless to it.
      const result = await core.request("open-meteo", "/v1/forecast", { latitude: "48.8" });

      expect(isToolError(result)).toBe(true);
      if (isToolError(result)) {
        expect(result.code).toBe("RATE_LIMITED");
      }
      expect(fetch).toHaveBeenCalledTimes(HOST_CONFIG["open-meteo"].retry.maxAttempts);
    });
  });
});
