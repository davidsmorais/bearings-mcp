import type { GetDestinationBriefInput } from "@bearings/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nagerFixture from "../../test/fixtures/nager.json" with { type: "json" };
import openMeteoFixture from "../../test/fixtures/open-meteo.json" with { type: "json" };
import { composeDestinationBrief } from "../tools/getDestinationBrief.js";
import { createHttpCore } from "./client.js";
import { clearFaults, setFaults } from "./faults.js";

const instantClock = { now: () => 0, sleep: async () => {} };
const now = () => new Date("2026-09-08T12:00:00Z");

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

// The same committed fixtures the integration suite uses, so this test agrees with it
// about what a healthy upstream response looks like.
const fetchBoth = async (input: string | URL | Request) => {
  const host = new URL(String(input)).hostname;
  if (host === "api.open-meteo.com") return jsonResponse(openMeteoFixture);
  if (host === "date.nager.at") return jsonResponse(nagerFixture.publicHolidays2026AT);
  throw new Error(`unexpected host ${host}`);
};

const input: GetDestinationBriefInput = {
  location: { name: "Vienna", coordinates: { lat: 48.2082, lon: 16.3738 }, countryCode: "AT" },
  stay: { start: "2026-09-08", end: "2026-09-09" },
  detail: "full",
};

/**
 * The end the fault seam exists for: one upstream simulated down, the composition still
 * returning what the other one produced. Exercised through the real composition, with the
 * fault raised inside the HTTP core, so nothing about this path is special-cased for the
 * demo.
 *
 * Note the granularity: faults are per **host**, not per domain. `analyse_neighbourhood`
 * queries Geoapify for all six domains, so faulting Geoapify takes all six down together
 * rather than one — the mixed ok/unavailable case lives here, where two genuinely
 * different upstreams compose one response.
 */
describe("an injected fault produces a real partial result", () => {
  beforeEach(() => {
    clearFaults();
    process.env.BEARINGS_FAULT_INJECTION = "1";
  });

  afterEach(() => {
    clearFaults();
    delete process.env.BEARINGS_FAULT_INJECTION;
    vi.restoreAllMocks();
  });

  it("returns holidays when Open-Meteo is faulted", async () => {
    const fetch = vi.fn(fetchBoth);
    setFaults({ "open-meteo": "upstream_error" });

    const result = await composeDestinationBrief(input, {
      core: createHttpCore({ fetch, clock: instantClock }),
      now,
    });

    const brief = result as { sources: Record<string, { status: string }>; holidays?: unknown[] };
    expect(brief.sources.openMeteo?.status).toBe("unavailable");
    expect(brief.sources.nager?.status).toBe("ok");
    expect(Array.isArray(brief.holidays)).toBe(true);
    // Nager was still called; only the faulted host was short-circuited.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns the forecast when Nager is faulted", async () => {
    const fetch = vi.fn(fetchBoth);
    setFaults({ nager: "timeout" });

    const result = await composeDestinationBrief(input, {
      core: createHttpCore({ fetch, clock: instantClock }),
      now,
    });

    const brief = result as { sources: Record<string, { status: string }>; forecast?: unknown };
    expect(brief.sources.nager?.status).toBe("unavailable");
    expect(brief.sources.openMeteo?.status).toBe("ok");
    expect(brief.forecast).toBeDefined();
  });

  it("returns both when nothing is faulted", async () => {
    const result = await composeDestinationBrief(input, {
      core: createHttpCore({ fetch: vi.fn(fetchBoth), clock: instantClock }),
      now,
    });

    const brief = result as { sources: Record<string, { status: string }> };
    expect(brief.sources.openMeteo?.status).toBe("ok");
    expect(brief.sources.nager?.status).toBe("ok");
  });
});
