import { isToolError } from "@bearings/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpCore } from "./client.js";
import { clearFaults, setFaults } from "./faults.js";

const instantClock = { now: () => 0, sleep: async () => {} };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const arm = (value: string | undefined) => {
  if (value === undefined) {
    process.env.BEARINGS_FAULT_INJECTION = undefined;
    delete process.env.BEARINGS_FAULT_INJECTION;
    return;
  }
  process.env.BEARINGS_FAULT_INJECTION = value;
};

describe("fault injection in the HTTP core", () => {
  beforeEach(() => {
    clearFaults();
    arm("1");
    // The unfaulted paths below reach the Geoapify branch of the core, which refuses
    // without a key before it ever gets to fetch.
    process.env.GEOAPIFY_API_KEY = "test-key";
  });

  afterEach(() => {
    clearFaults();
    arm(undefined);
    vi.restoreAllMocks();
  });

  it("never reaches the network for a faulted host", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const core = createHttpCore({ fetch, clock: instantClock });
    setFaults({ geoapify: "upstream_error" });

    const result = await core.request("geoapify", "/v2/places", { categories: "catering" });

    expect(isToolError(result)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves an unfaulted host completely alone", async () => {
    const fetch = vi.fn(async () => jsonResponse({ city: "Paris" }));
    const core = createHttpCore({ fetch, clock: instantClock });
    setFaults({ geoapify: "timeout" });

    const result = await core.request("nominatim", "/search", { q: "Paris" });

    expect(isToolError(result)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fires even when the request would have been served from cache", async () => {
    // The trap this guards: arm a fault, repeat a call you already made, and a warm
    // cache entry answers it — the control looks broken when it is actually fine.
    const fetch = vi.fn(async () => jsonResponse({ city: "Paris" }));
    const core = createHttpCore({ fetch, clock: instantClock });
    const params = { q: "Paris" };

    const warm = await core.request("nominatim", "/search", params);
    expect(isToolError(warm)).toBe(false);

    setFaults({ nominatim: "upstream_error" });
    const faulted = await core.request("nominatim", "/search", params);

    expect(isToolError(faulted)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("produces the same ToolError shape the real failure path produces", async () => {
    const core = createHttpCore({ fetch: vi.fn(), clock: instantClock });

    setFaults({ geoapify: "quota_exceeded" });
    const quota = await core.request("geoapify", "/v2/places", {});
    expect(isToolError(quota) && quota.code).toBe("QUOTA_EXCEEDED");

    setFaults({ geoapify: "rate_limited" });
    const limited = await core.request("geoapify", "/v2/places", {});
    expect(isToolError(limited) && limited.code).toBe("RATE_LIMITED");

    setFaults({ geoapify: "timeout" });
    const timedOut = await core.request("geoapify", "/v2/places", {});
    expect(isToolError(timedOut) && timedOut.code).toBe("TIMEOUT");

    setFaults({ geoapify: "upstream_error" });
    const failed = await core.request("geoapify", "/v2/places", {});
    expect(isToolError(failed) && failed.code).toBe("UPSTREAM_ERROR");
  });

  it("is inert when the env flag is not armed, even with a fault set", async () => {
    arm(undefined);
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const core = createHttpCore({ fetch, clock: instantClock });
    setFaults({ geoapify: "upstream_error" });

    const result = await core.request("geoapify", "/v2/places", {});

    expect(isToolError(result)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
