import {
  AnalyseNeighbourhoodInputSchema,
  isToolError,
  NeighbourhoodProfileSchema,
  ToolErrorCode,
} from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
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
