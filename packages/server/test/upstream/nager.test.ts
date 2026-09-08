import { isToolError, ToolErrorCode } from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpCore } from "../../src/http/client.js";
import { HOST_CONFIG } from "../../src/http/config.js";
import { fetchHolidaysInWindow } from "../../src/upstream/nager.js";
import nagerFixture from "../fixtures/nager.json";

const instantClock = {
  now: () => 0,
  sleep: async () => {},
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Serves the captured Nager response for whichever year appears in the request path. */
const yearRouter =
  (responses: Record<string, () => Response>) => async (input: string | URL | Request) => {
    const url = String(input);
    for (const [year, make] of Object.entries(responses)) {
      if (url.includes(`/${year}/`)) {
        return make();
      }
    }
    return new Response("not found", { status: 404 });
  };

const coreWith = (fetch: typeof globalThis.fetch) => createHttpCore({ fetch, clock: instantClock });

const dates = (holidays: readonly { date: string }[]) => holidays.map((holiday) => holiday.date);

describe("fetchHolidaysInWindow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns only holidays inside the window, sorted by date", async () => {
    const fetch = vi.fn(
      yearRouter({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    );

    const result = await fetchHolidaysInWindow(
      "AT",
      { start: "2026-05-01", end: "2026-05-25" },
      { core: coreWith(fetch) },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(dates(result.holidays)).toEqual(["2026-05-01", "2026-05-14", "2026-05-25"]);
    expect(result.holidays[0]).toEqual({
      date: "2026-05-01",
      name: "National Holiday",
      localName: "Staatsfeiertag",
      countryCode: "AT",
    });
    expect(result.partial).toBeUndefined();
  });

  it("includes holidays that land exactly on the window's start and end", async () => {
    const fetch = vi.fn(
      yearRouter({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    );

    const result = await fetchHolidaysInWindow(
      "AT",
      { start: "2026-01-01", end: "2026-01-06" },
      { core: coreWith(fetch) },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(dates(result.holidays)).toEqual(["2026-01-01", "2026-01-06"]);
  });

  it("returns an empty list (not an error) when no holiday falls in the window", async () => {
    const fetch = vi.fn(
      yearRouter({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    );

    const result = await fetchHolidaysInWindow(
      "AT",
      { start: "2026-07-02", end: "2026-07-20" },
      { core: coreWith(fetch) },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.holidays).toEqual([]);
    expect(result.partial).toBeUndefined();
  });

  it("fetches both years when the window crosses 31 December", async () => {
    const fetch = vi.fn(
      yearRouter({
        "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT),
        "2027": () => jsonResponse(nagerFixture.publicHolidays2027AT),
      }),
    );

    const result = await fetchHolidaysInWindow(
      "AT",
      { start: "2026-12-24", end: "2027-01-05" },
      { core: coreWith(fetch) },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(dates(result.holidays)).toEqual(["2026-12-25", "2026-12-26", "2027-01-01"]);

    const requestedPaths = fetch.mock.calls.map((call) => new URL(String(call[0])).pathname).sort();
    expect(requestedPaths).toEqual([
      "/api/v3/PublicHolidays/2026/AT",
      "/api/v3/PublicHolidays/2027/AT",
    ]);
  });

  it("sorts merged holidays by date regardless of upstream ordering", async () => {
    const unordered = [
      { date: "2026-05-25", localName: "c", name: "C", countryCode: "DE" },
      { date: "2026-05-01", localName: "a", name: "A", countryCode: "DE" },
      { date: "2026-05-14", localName: "b", name: "B", countryCode: "DE" },
    ];
    const fetch = vi.fn(yearRouter({ "2026": () => jsonResponse(unordered) }));

    const result = await fetchHolidaysInWindow(
      "AT",
      { start: "2026-05-01", end: "2026-05-31" },
      { core: coreWith(fetch) },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(dates(result.holidays)).toEqual(["2026-05-01", "2026-05-14", "2026-05-25"]);
    // countryCode comes from the validated argument, never the upstream payload.
    expect(result.holidays.every((holiday) => holiday.countryCode === "AT")).toBe(true);
  });

  it("maps an unsupported country code to NOT_FOUND, not an empty list", async () => {
    const fetch = vi.fn(async () => new Response("[]", { status: 404 }));

    const result = await fetchHolidaysInWindow(
      "ZZ",
      { start: "2026-06-01", end: "2026-06-10" },
      { core: coreWith(fetch) },
    );

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.NOT_FOUND);
    expect(result.message).toContain("ZZ");
  });

  it("returns the year it could fetch plus a note when the other year fails", async () => {
    const fetch = vi.fn(
      yearRouter({
        "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT),
        "2027": () => new Response("upstream boom", { status: 500 }),
      }),
    );

    const result = await fetchHolidaysInWindow(
      "AT",
      { start: "2026-12-24", end: "2027-01-02" },
      { core: coreWith(fetch) },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(dates(result.holidays)).toEqual(["2026-12-25", "2026-12-26"]);
    expect(result.partial?.missingYears).toEqual([2027]);
    expect(result.partial?.reason).toContain("2027");
  });

  it("propagates the upstream error when every year's fetch fails", async () => {
    const fetch = vi.fn(async () => new Response("boom", { status: 500 }));

    const result = await fetchHolidaysInWindow(
      "AT",
      { start: "2026-12-24", end: "2027-01-02" },
      { core: coreWith(fetch) },
    );

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
    expect(fetch).toHaveBeenCalledTimes(HOST_CONFIG.nager.retry.maxAttempts * 2);
  });

  it("propagates a caller abort through to a returned error", async () => {
    const fetch = vi.fn(async () => jsonResponse(nagerFixture.publicHolidays2026AT));
    const controller = new AbortController();
    controller.abort();

    const result = await fetchHolidaysInWindow(
      "AT",
      { start: "2026-05-01", end: "2026-05-25" },
      { core: coreWith(fetch), signal: controller.signal },
    );

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.message.toLowerCase()).toContain("cancel");
    expect(fetch).not.toHaveBeenCalled();
  });
});
