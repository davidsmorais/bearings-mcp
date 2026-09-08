import {
  AnalyseNeighbourhoodInputSchema,
  isToolError,
  NeighbourhoodProfileSchema,
  ToolErrorCode,
} from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import geoapifyFixture from "../../test/fixtures/geoapify-places.json";
import { createHttpCore } from "../http/client.js";
import { analyseNeighbourhood } from "./analyseNeighbourhood.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const denseUrban = { lat: 38.7115, lon: -9.1449 };
const ruralQuiet = { lat: 38.7003, lon: -9.421 };

const buildInput = (overrides: Record<string, unknown> = {}) =>
  AnalyseNeighbourhoodInputSchema.parse({
    coordinates: denseUrban,
    ...overrides,
  });

const makePlace = (id: string, name: string, distanceM: number, categories: readonly string[]) => ({
  type: "Feature",
  properties: {
    name,
    lat: denseUrban.lat,
    lon: denseUrban.lon,
    place_id: id,
    formatted: `${name}, Lisbon, Portugal`,
    categories,
    distance: distanceM,
  },
  geometry: { type: "Point", coordinates: [denseUrban.lon, denseUrban.lat] },
});

const makeNightlifePlaces = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    makePlace(`nightlife-${index}`, `Bar ${index}`, 50 + index * 10, ["catering.bar"]),
  );

const geoapifyFetch = (handler: (categories: string | null) => Response | Promise<Response>) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    return handler(url.searchParams.get("categories"));
  });

// `now()` advances as sleeps elapse — a frozen clock would starve the shared
// Geoapify rate limiter (capacity 5) the moment six queued acquires (two domains ×
// three retry attempts, the all-quota case) drain it, since it never refills. No
// real wall time passes: `sleep` just moves the clock forward.
let clockMs = 0;
const instantClock = {
  now: () => clockMs,
  sleep: async (ms: number) => {
    clockMs += ms;
  },
};

const runComposition = (
  input: ReturnType<typeof buildInput>,
  fetch: ReturnType<typeof geoapifyFetch>,
) => analyseNeighbourhood(input, { core: createHttpCore({ fetch, clock: instantClock }) });

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GEOAPIFY_API_KEY;
});

describe("analyseNeighbourhood — dense urban", () => {
  it("returns rated domains with count, radius and ring evidence", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch((categories) => {
      if (categories?.includes("catering.bar")) {
        return jsonResponse({
          type: "FeatureCollection",
          features: makeNightlifePlaces(20),
        });
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    });

    const result = await runComposition(
      buildInput({ categories: ["nightlife"], detail: "full" }),
      fetch,
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;

    if (result.detail !== "full") throw new Error("expected a full profile");
    expect(result.domains.nightlife?.rating).toBe("high");
    expect(result.domains.nightlife?.count).toBe(20);
    expect(result.domains.nightlife?.radiusM).toBe(500);
    expect(result.domains.nightlife?.countCapped).toBe(true);
    expect(result.domains.nightlife?.rings.length).toBeGreaterThan(0);
    expect(result.domains.nightlife?.samplePois.length).toBeGreaterThan(0);
    expect(result.sources.nightlife?.status).toBe("ok");
    // A domain returning the full 20 places is still one request — one credit, not two.
    expect(result.credits.consumed).toBe(1);
    expect(result.credits.byDomain.nightlife).toBe(1);
    expect(NeighbourhoodProfileSchema.safeParse(result).success).toBe(true);
  });
});

describe("analyseNeighbourhood — rural empty", () => {
  it("returns a valid all-none profile, not an error", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch(() => jsonResponse({ type: "FeatureCollection", features: [] }));

    const result = await runComposition(
      buildInput({
        coordinates: ruralQuiet,
        categories: ["nightlife", "dining"],
        detail: "full",
      }),
      fetch,
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;

    expect(result.domains.nightlife?.rating).toBe("none");
    expect(result.domains.dining?.rating).toBe("none");
    expect(result.sources.nightlife?.status).toBe("ok");
    expect(result.sources.dining?.status).toBe("ok");
    expect(NeighbourhoodProfileSchema.safeParse(result).success).toBe(true);
    // Two requests left the process but returned no places — per-20 billing is 0 each.
    expect(result.credits.consumed).toBe(0);
    expect(result.credits.byDomain).toEqual({ nightlife: 0, dining: 0 });
  });

  it("bills zero credits per domain when every domain returns no places", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch(() => jsonResponse({ type: "FeatureCollection", features: [] }));

    const result = await runComposition(
      buildInput({ coordinates: ruralQuiet, detail: "full" }),
      fetch,
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;

    expect(result.credits.consumed).toBe(0);
    expect(Object.values(result.credits.byDomain)).toEqual([0, 0, 0, 0, 0, 0]);
    if (result.detail !== "full") throw new Error("expected a full profile");
    for (const domain of Object.values(result.domains)) {
      expect(domain?.rating).toBe("none");
    }
  });

  it("reports zero credits when an identical call is served from a warm cache", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch(() => jsonResponse({ type: "FeatureCollection", features: [] }));
    const core = createHttpCore({ fetch, clock: instantClock });
    const input = buildInput({ categories: ["nightlife", "dining"], detail: "full" });

    const first = await analyseNeighbourhood(input, { core });
    const second = await analyseNeighbourhood(input, { core });

    expect(isToolError(first)).toBe(false);
    expect(isToolError(second)).toBe(false);
    if (isToolError(first) || isToolError(second)) return;

    expect(first.credits.consumed).toBe(0);
    expect(second.credits.consumed).toBe(0);
    expect(second.credits.byDomain).toEqual({ nightlife: 0, dining: 0 });
  });

  it("keeps a failed domain (absent) distinct from a cache-served domain (explicit 0)", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch((categories) => {
      if (categories?.includes("catering.bar")) {
        return new Response("boom", { status: 500 });
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    });
    const core = createHttpCore({ fetch, clock: instantClock });

    // Warm only the dining cache — nightlife is never queried successfully.
    await analyseNeighbourhood(buildInput({ categories: ["dining"], detail: "full" }), { core });

    // Now nightlife errors and dining is served from cache in the same call.
    const result = await analyseNeighbourhood(
      buildInput({ categories: ["nightlife", "dining"], detail: "full" }),
      { core },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;

    // Failed domain: absent from byDomain entirely.
    expect("nightlife" in result.credits.byDomain).toBe(false);
    // Cache-served domain: present as an explicit 0.
    expect(result.credits.byDomain.dining).toBe(0);
    expect(result.credits.byDomain).toEqual({ dining: 0 });
    expect(result.credits.consumed).toBe(0);
  });
});

describe("analyseNeighbourhood — partial upstream failure", () => {
  it("nulls the failed domain and still returns the rest", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch((categories) => {
      if (categories?.includes("catering.bar")) {
        return new Response("boom", { status: 500 });
      }
      return jsonResponse({
        type: "FeatureCollection",
        features: [makePlace("dining-1", "Bistro", 100, ["catering.restaurant"])],
      });
    });

    const result = await runComposition(
      buildInput({ categories: ["nightlife", "dining"], detail: "full" }),
      fetch,
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;

    expect(result.domains.nightlife).toBeNull();
    expect(result.sources.nightlife?.status).toBe("unavailable");
    expect(result.domains.dining?.rating).toBeDefined();
    expect(result.sources.dining?.status).toBe("ok");
    // The failed domain is absent from byDomain and adds nothing to the total.
    expect(result.credits.byDomain.nightlife).toBeUndefined();
    expect(result.credits.byDomain.dining).toBe(1);
    expect(result.credits.consumed).toBe(1);
  });

  it("counts zero credits for successful domains that returned no places when others fail", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch((categories) => {
      // nightlife and transit fail; the other four domains return empty.
      if (categories?.includes("catering.bar") || categories?.includes("public_transport")) {
        return new Response("boom", { status: 500 });
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    });

    const result = await runComposition(buildInput({ coordinates: ruralQuiet }), fetch);

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;

    expect(result.credits.consumed).toBe(0);
    expect(result.credits.byDomain).toEqual({
      culture: 0,
      dining: 0,
      greenSpace: 0,
      retail: 0,
    });
  });
});

describe("analyseNeighbourhood — all domains fail", () => {
  it("returns QUOTA_EXCEEDED when every domain hits quota", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch(() =>
      jsonResponse({ statusMessage: "Daily quota limit exceeded" }, 429),
    );

    const result = await runComposition(buildInput({ categories: ["nightlife", "dining"] }), fetch);

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.QUOTA_EXCEEDED);
    // An all-domains-fail ToolError carries no credit block — nothing was billed
    // (deliberate choice, recorded in DECISIONS.md / MEMORY.md).
    expect(result).not.toHaveProperty("credits");
  });
});

describe("analyseNeighbourhood — brief vs full", () => {
  it("drops samplePois at brief and keeps them at full with one upstream call set", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch(() =>
      jsonResponse({
        type: "FeatureCollection",
        features: [makePlace("nightlife-1", "Bar One", 80, ["catering.bar"])],
      }),
    );

    const full = await runComposition(
      buildInput({ categories: ["nightlife"], detail: "full" }),
      fetch,
    );
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.mockClear();

    const brief = await runComposition(
      buildInput({ categories: ["nightlife"], detail: "brief" }),
      fetch,
    );
    expect(fetch).toHaveBeenCalledTimes(1);

    expect(isToolError(full)).toBe(false);
    expect(isToolError(brief)).toBe(false);
    if (isToolError(full) || isToolError(brief)) return;

    expect(full.domains.nightlife).toHaveProperty("samplePois");
    expect(brief.domains.nightlife).not.toHaveProperty("samplePois");
    expect("coordinates" in brief.location).toBe(false);
    // brief drops bulk, not evidence — the credit block is identical at both levels.
    expect(brief.credits).toEqual(full.credits);
    expect(full.credits.consumed).toBe(1);
  });
});

describe("analyseNeighbourhood — domain scoping", () => {
  it("queries only the nightlife domain when categories is [nightlife]", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const captured: string[] = [];
    const fetch = geoapifyFetch((categories) => {
      captured.push(categories ?? "");
      return jsonResponse({ type: "FeatureCollection", features: [] });
    });

    await runComposition(buildInput({ categories: ["nightlife"] }), fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(captured[0]).toBe("catering.bar,catering.pub,entertainment.nightclub");
  });
});

describe("analyseNeighbourhood — detail-gated credit ceiling (DMS-501)", () => {
  it("reports 2 credits and countCapped at the 40-place ceiling with detail: full", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch((categories) =>
      categories?.includes("catering.bar")
        ? jsonResponse({ type: "FeatureCollection", features: geoapifyFixture.dense.features })
        : jsonResponse({ type: "FeatureCollection", features: [] }),
    );

    const result = await runComposition(
      buildInput({ categories: ["nightlife"], detail: "full", limitPerCategory: 40 }),
      fetch,
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    if (result.detail !== "full") throw new Error("expected a full profile");

    expect(result.domains.nightlife?.count).toBe(40);
    expect(result.domains.nightlife?.countCapped).toBe(true);
    // ceil(40 / 20) = 2 — the second credit bucket the raised ceiling opts into.
    expect(result.credits.byDomain.nightlife).toBe(2);
    expect(result.credits.consumed).toBe(2);
    expect(NeighbourhoodProfileSchema.safeParse(result).success).toBe(true);
  });

  it("returns the 10 nearest samples, ordered by distanceM, when more than 10 places come back", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = geoapifyFetch((categories) =>
      categories?.includes("catering.bar")
        ? jsonResponse({ type: "FeatureCollection", features: geoapifyFixture.dense.features })
        : jsonResponse({ type: "FeatureCollection", features: [] }),
    );

    const result = await runComposition(
      buildInput({ categories: ["nightlife"], detail: "full", limitPerCategory: 40 }),
      fetch,
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    if (result.detail !== "full") throw new Error("expected a full profile");

    const samples = result.domains.nightlife?.samplePois ?? [];
    expect(samples).toHaveLength(10);
    const distances = samples.map((poi) => poi.distanceM ?? Number.POSITIVE_INFINITY);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    // The fixture's 40 features are already distance-ascending — the 10 nearest are
    // the first 10 place_ids.
    expect(samples.map((poi) => poi.id)).toEqual(
      geoapifyFixture.dense.features.slice(0, 10).map((f) => f.properties.place_id),
    );
  });

  it("leaves a domain returning fewer than 10 places unaffected by the raised sample cap", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    // The default (non-dense) fixture has 3 features, one with no name — normalised
    // down to 2 valid places, well under the 10-sample cap.
    const fetch = geoapifyFetch(() =>
      jsonResponse({ type: "FeatureCollection", features: geoapifyFixture.features }),
    );

    const result = await runComposition(
      buildInput({ categories: ["dining"], detail: "full" }),
      fetch,
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    if (result.detail !== "full") throw new Error("expected a full profile");

    expect(result.domains.dining?.samplePois).toHaveLength(2);
  });
});
