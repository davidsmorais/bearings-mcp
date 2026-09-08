import { isToolError, ToolErrorCode } from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import geoapifyFixture from "../../test/fixtures/geoapify-places.json";
import { createHttpCore } from "../http/client.js";
import { searchPlaces } from "./geoapify.js";

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

  it("queries Geoapify with a circle filter and normalises features into POIs", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      expect(url.pathname).toBe("/v2/places");
      expect(url.searchParams.get("categories")).toBe("catering.restaurant");
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
        category: "dining",
        limit: 20,
      },
      { core },
    );

    expect(isToolError(result)).toBe(false);
    if (!isToolError(result)) {
      expect(result.places).toHaveLength(1);
      expect(result.places[0]).toEqual({
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

  it("maps Geoapify domain categories for nightlife", async () => {
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
        category: "nightlife",
        limit: 10,
      },
      { core },
    );

    expect(capturedCategories).toBe("catering.bar,catering.pub");
  });

  it("returns a missing-key error when GEOAPIFY_API_KEY is unset", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        category: "dining",
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
        category: "dining",
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
        category: "dining",
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

  it("maps generic 429 responses to RATE_LIMITED", async () => {
    process.env.GEOAPIFY_API_KEY = "test-key";

    const fetch = vi.fn(async () => jsonResponse({ message: "Too many requests" }, 429));
    const core = createHttpCore({ fetch, clock: instantClock });

    const result = await searchPlaces(
      {
        coordinates: { lat: 48.8566, lon: 2.3522 },
        radiusM: 500,
        category: "dining",
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
