import { isToolError, ToolErrorCode } from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import nominatimFixture from "../../test/fixtures/nominatim.json";
import { createHttpCore } from "../http/client.js";
import { resolveDestination } from "./nominatim.js";

const instantClock = {
  now: () => 0,
  sleep: async () => {},
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const coreServing = (body: unknown) => {
  const fetch = vi.fn(async (_input: string | URL | Request) => jsonResponse(body));
  return { fetch, core: createHttpCore({ fetch, clock: instantClock }) };
};

describe("resolveDestination", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a confident ResolvedLocation when one hit dominates on importance", async () => {
    const { core } = coreServing(nominatimFixture.lisbon);

    const result = await resolveDestination("Lisbon", { limit: 5, core });

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.name).toBe("Lisbon");
    expect(result.countryCode).toBe("PT");
    expect(result.displayName).toBe("Lisbon, Portugal");
    expect(result.coordinates).toEqual({ lat: 38.7077507, lon: -9.1365919 });
    expect(result.admin).toEqual({ county: "Lisbon", municipality: "Lisbon" });
    expect(result.kind).toBe("city");
    expect(result.boundingBox).toHaveLength(4);
    expect(result.osmType).toBe("relation");
  });

  it("returns AMBIGUOUS with ranked candidates when hits are near-tied", async () => {
    const { core } = coreServing(nominatimFixture.springfield);

    const result = await resolveDestination("Springfield", { limit: 6, core });

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.AMBIGUOUS);
    if (!("candidates" in result)) return;
    expect(result.candidates.length).toBeGreaterThan(1);
    for (const candidate of result.candidates) {
      expect(candidate.location.name).toBe("Springfield");
      expect(typeof candidate.importance).toBe("number");
      expect(candidate.kind).toBeTruthy();
    }
    // Ranked by importance descending.
    const importances = result.candidates.map((candidate) => candidate.importance);
    expect([...importances].sort((a, b) => b - a)).toEqual(importances);
  });

  it("returns NOT_FOUND (never an empty success) when Nominatim returns nothing", async () => {
    const { core } = coreServing(nominatimFixture.asdkjhasd);

    const result = await resolveDestination("asdkjhasd", { limit: 5, core });

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.NOT_FOUND);
    expect(result.message).toContain("asdkjhasd");
  });

  it("puts countrycodes=pt on the outgoing request when countryCode is PT", async () => {
    const { fetch, core } = coreServing(nominatimFixture.lisbon);

    await resolveDestination("Lisbon", { limit: 5, countryCode: "PT", core });

    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("countrycodes")).toBe("pt");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("accept-language")).toBe("en");
    expect(url.searchParams.get("addressdetails")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("omits countrycodes when no countryCode is given", async () => {
    const { fetch, core } = coreServing(nominatimFixture.lisbon);

    await resolveDestination("Lisbon", { limit: 5, core });

    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.searchParams.has("countrycodes")).toBe(false);
  });

  it("sends the descriptive User-Agent header on every call", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("User-Agent")).toContain("BearingsMCP");
      return jsonResponse(nominatimFixture.lisbon);
    });
    const core = createHttpCore({ fetch, clock: instantClock });

    await resolveDestination("Lisbon", { limit: 5, core });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("drops a hit with no address.country_code rather than returning a bad code", async () => {
    const { core } = coreServing([
      {
        place_id: 1,
        osm_type: "relation",
        osm_id: 11,
        lat: "1.0",
        lon: "1.0",
        display_name: "No Country Place",
        name: "No Country Place",
        addresstype: "city",
        type: "administrative",
        importance: 0.9,
        place_rank: 16,
        address: { state: "Nowhere" },
      },
      {
        place_id: 2,
        osm_type: "relation",
        osm_id: 22,
        lat: "2.0",
        lon: "2.0",
        display_name: "Real Place, Realland",
        name: "Real Place",
        addresstype: "city",
        type: "administrative",
        importance: 0.4,
        place_rank: 16,
        address: { country_code: "de", state: "Realland" },
      },
    ]);

    const result = await resolveDestination("place", { limit: 5, core });

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    // Only the second hit normalises, so it resolves confidently as the lone survivor.
    expect(result.name).toBe("Real Place");
    expect(result.countryCode).toBe("DE");
  });

  it("treats an importance gap exactly at the threshold as confident (inclusive)", async () => {
    // 0.15 - 0 is the CONFIDENT_IMPORTANCE_GAP double exactly, so this exercises the
    // inclusive `>=` boundary rather than landing just above it through float drift.
    const { core } = coreServing([
      {
        place_id: 1,
        osm_type: "relation",
        osm_id: 11,
        lat: "10.0",
        lon: "10.0",
        display_name: "Top, Country",
        name: "Top",
        addresstype: "city",
        type: "administrative",
        importance: 0.15,
        place_rank: 16,
        address: { country_code: "fr" },
      },
      {
        place_id: 2,
        osm_type: "relation",
        osm_id: 22,
        lat: "20.0",
        lon: "20.0",
        display_name: "Runner Up, Country",
        name: "Runner Up",
        addresstype: "city",
        type: "administrative",
        importance: 0,
        place_rank: 16,
        address: { country_code: "fr" },
      },
    ]);

    const result = await resolveDestination("top", { limit: 5, core });

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.name).toBe("Top");
  });

  it("drops a non-object array element instead of throwing", async () => {
    const { core } = coreServing([null, "nope", 42]);

    const result = await resolveDestination("junk", { limit: 5, core });

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.NOT_FOUND);
  });

  it("returns UPSTREAM_ERROR when Nominatim serves a non-array body", async () => {
    const { core } = coreServing({ error: "unexpected" });

    const result = await resolveDestination("Lisbon", { limit: 5, core });

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
  });
});
