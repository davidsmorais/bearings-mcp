import { isToolError, ToolErrorCode } from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import geoapifyFixture from "../../test/fixtures/geoapify-places.json";
import { createHttpCore } from "../http/client.js";
import { creditsForResponse, GEOAPIFY_PLACES_PER_CREDIT, searchPlaces } from "./geoapify.js";

const instantClock = {
  now: () => 0,
  sleep: async () => {},
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("searchPlaces", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEOAPIFY_API_KEY;
  });

  it("queries Geoapify with a circle filter and tags each feature to its own category", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      expect(url.pathname).toBe("/v2/places");
      // A dining-domain query unions both member categories into one request.
      expect(url.searchParams.get("categories")).toBe("catering.restaurant,catering.cafe");
      expect(url.searchParams.get("filter")).toBe("circle:2.3522,48.8566,500");
      expect(url.searchParams.get("bias")).toBe("proximity:2.3522,48.8566");
      expect(url.searchParams.get("limit")).toBe("20");
      expect(url.searchParams.get("apiKey")).toBe("test-key");
      return jsonResponse(geoapifyFixture);
    });

    const core = createHttpCore({ fetch, clock: instantClock });
    const result = await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        categories: ["dining", "cafes"],
        limit: 20,
      },
      { core },
    );

    expect(isToolError(result)).toBe(false);
    if (!isToolError(result)) {
      expect(result.places).toHaveLength(2);
      const byName = Object.fromEntries(result.places.map((place) => [place.name, place]));
      expect(byName["Le Petit Bistro"]?.category).toBe("dining");
      expect(byName["Café de la Paix"]?.category).toBe("cafes");
      expect(byName["Le Petit Bistro"]).toEqual({
        id: "51f07665660fc4024059dc0a96dfac6c12345678",
        name: "Le Petit Bistro",
        coordinates: { lat: 48.8566, lon: 2.3522 },
        category: "dining",
        address: "Le Petit Bistro, 12 Rue de Rivoli, 75001 Paris, France",
        distanceM: 120,
      });
      expect(result.meta.cacheHit).toBe(false);
    }
  });

  it("unions the member category strings for a nightlife domain query", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    let capturedCategories: string | null = null;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      capturedCategories = url.searchParams.get("categories");
      return jsonResponse({ type: "FeatureCollection", features: [] });
    });
    const core = createHttpCore({ fetch, clock: instantClock });

    await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        categories: ["nightlife"],
        limit: 10,
      },
      { core },
    );

    expect(capturedCategories).toBe("catering.bar,catering.pub,entertainment");
  });

  it("rounds a sub-metre input coordinate to 4 dp in the filter and bias strings", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    let filter: string | null = null;
    let bias: string | null = null;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      filter = url.searchParams.get("filter");
      bias = url.searchParams.get("bias");
      return jsonResponse({ type: "FeatureCollection", features: [] });
    });
    const core = createHttpCore({ fetch, clock: instantClock });

    await searchPlaces(
      {
        coordinates: { lat: 48.856614, lon: 2.352221 },
        radiusM: 500,
        categories: ["dining"],
        limit: 20,
      },
      { core },
    );

    expect(filter).toBe("circle:2.3522,48.8566,500");
    expect(bias).toBe("proximity:2.3522,48.8566");
  });

  it("falls back to the first requested category when a feature carries no categories array", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = vi.fn(async () =>
      jsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              name: "Unlabelled Venue",
              lat: 48.8566,
              lon: 2.3522,
              place_id: "no-categories-here",
              distance: 40,
            },
          },
        ],
      }),
    );
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        categories: ["culture", "dining"],
        limit: 20,
      },
      { core },
    );

    expect(isToolError(result)).toBe(false);
    if (!isToolError(result)) {
      expect(result.places).toHaveLength(1);
      expect(result.places[0]?.category).toBe("culture");
    }
  });

  it("rejects an empty categories array without a request", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";
    const fetch = vi.fn(async () => jsonResponse({}));
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await searchPlaces(
      { coordinates: { lat: 48.8566, lon: 2.3522 }, radiusM: 500, categories: [], limit: 20 },
      { core },
    );

    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe(ToolErrorCode.INVALID_INPUT);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a missing-key error when GEOAPIFY_API_KEY is unset", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        categories: ["dining"],
        limit: 20,
      },
      { core },
    );

    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
      expect(result.message).toContain("GEOAPIFY_API_KEY");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps quota exhaustion to QUOTA_EXCEEDED", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = vi.fn(async () =>
      jsonResponse({ statusMessage: "Daily quota limit exceeded" }, 429),
    );
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        categories: ["dining"],
        limit: 20,
      },
      { core },
    );

    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe(ToolErrorCode.QUOTA_EXCEEDED);
    }
  });

  it("maps 401 responses to UPSTREAM_ERROR", async () => {
    process.env.GEOAPIFY_API_KEY = "bad-key";

    const fetch = vi.fn(async () => jsonResponse({ message: "Invalid apiKey" }, 401));
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        categories: ["dining"],
        limit: 20,
      },
      { core },
    );

    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
      expect(result.details?.status).toBe(401);
    }
  });

  it("reports ceil(places / 20) credits for an uncached request", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    for (const [featureCount, expectedCredits] of [
      [0, 0],
      [1, 1],
      [20, 1],
    ] as const) {
      const fetch = vi.fn(async () =>
        jsonResponse({
          type: "FeatureCollection",
          features: Array.from({ length: featureCount }, (_, index) => ({
            type: "Feature",
            properties: {
              name: `Venue ${index}`,
              lat: 48.8566,
              lon: 2.3522,
              place_id: `place-${index}`,
              categories: ["catering.restaurant"],
              distance: 10 + index,
            },
          })),
        }),
      );
      const core = createHttpCore({ fetch, clock: instantClock });

      const result = await searchPlaces(
        {
          coordinates: { lat: 48.8566, lon: 2.3522 },
          radiusM: 500,
          categories: ["dining"],
          limit: 20,
        },
        { core },
      );

      expect(isToolError(result)).toBe(false);
      if (!isToolError(result)) {
        expect(result.credits).toBe(expectedCredits);
        expect(result.meta.cacheHit).toBe(false);
      }
    }
  });

  it("bills credits on the feature count Geoapify returned, not on what survived normalisation", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    // 21 features on the wire: 19 valid, one missing place_id, one missing coordinates.
    // Geoapify billed ceil(21 / 20) = 2 credits; normalisation keeps only 19.
    const features = [
      ...Array.from({ length: 19 }, (_, index) => ({
        type: "Feature",
        properties: {
          name: `Venue ${index}`,
          lat: 48.8566,
          lon: 2.3522,
          place_id: `place-${index}`,
          categories: ["catering.restaurant"],
          distance: 10 + index,
        },
      })),
      {
        type: "Feature",
        properties: {
          name: "No id",
          lat: 48.8566,
          lon: 2.3522,
          categories: ["catering.restaurant"],
          distance: 5,
        },
      },
      {
        type: "Feature",
        properties: {
          name: "No coordinates",
          place_id: "place-no-coords",
          categories: ["catering.restaurant"],
          distance: 5,
        },
      },
    ];

    const fetch = vi.fn(async () => jsonResponse({ type: "FeatureCollection", features }));
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        categories: ["dining"],
        limit: 40,
      },
      { core },
    );

    expect(isToolError(result)).toBe(false);
    if (!isToolError(result)) {
      expect(result.places).toHaveLength(19);
      expect(result.returnedCount).toBe(21);
      expect(result.credits).toBe(2);
    }
  });

  it("bills zero credits on a cache hit regardless of the returned feature count", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const features = Array.from({ length: 25 }, (_, index) => ({
      type: "Feature",
      properties: {
        name: `Venue ${index}`,
        lat: 48.8566,
        lon: 2.3522,
        place_id: `place-${index}`,
        categories: ["catering.restaurant"],
        distance: 10 + index,
      },
    }));
    const fetch = vi.fn(async () => jsonResponse({ type: "FeatureCollection", features }));
    const core = createHttpCore({ fetch, clock: instantClock });
    const input = {
      coordinates: { lat: 48.8566, lon: 2.3522 },
      radiusM: 500,
      categories: ["dining"] as const,
      limit: 40,
    };

    const first = await searchPlaces(input, { core });
    const second = await searchPlaces(input, { core });

    expect(fetch).toHaveBeenCalledTimes(1);
    if (!isToolError(first)) {
      expect(first.returnedCount).toBe(25);
      expect(first.credits).toBe(2);
    }
    if (!isToolError(second)) {
      expect(second.meta.cacheHit).toBe(true);
      expect(second.returnedCount).toBe(25);
      expect(second.credits).toBe(0);
    }
  });

  it("reports zero credits when the HTTP core serves the response from cache", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = vi.fn(async () =>
      jsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              name: "Venue",
              lat: 48.8566,
              lon: 2.3522,
              place_id: "place-1",
              categories: ["catering.restaurant"],
              distance: 10,
            },
          },
        ],
      }),
    );
    const core = createHttpCore({ fetch, clock: instantClock });
    const input = {
      coordinates: { lat: 48.8566, lon: 2.3522 },
      radiusM: 500,
      categories: ["dining"] as const,
      limit: 20,
    };

    const first = await searchPlaces(input, { core });
    const second = await searchPlaces(input, { core });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(isToolError(first)).toBe(false);
    expect(isToolError(second)).toBe(false);
    if (!isToolError(first)) expect(first.credits).toBe(1);
    if (!isToolError(second)) {
      expect(second.credits).toBe(0);
      expect(second.meta.cacheHit).toBe(true);
    }
  });

  it("creditsForResponse bills ceil(places / 20)", () => {
    expect(creditsForResponse(false, 20)).toBe(1);
    expect(creditsForResponse(false, 50)).toBe(3);
    expect(creditsForResponse(true, 50)).toBe(0);
    expect(GEOAPIFY_PLACES_PER_CREDIT).toBe(20);
  });

  it("maps generic 429 responses to RATE_LIMITED", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = vi.fn(async () => jsonResponse({ message: "Too many requests" }, 429));
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        categories: ["dining"],
        limit: 20,
      },
      { core },
    );

    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.code).toBe(ToolErrorCode.RATE_LIMITED);
    }
  });
});
