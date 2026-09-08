import { describe, expect, it } from "vitest";
import { notFound, upstreamError } from "../errors.js";
import {
  DomainRatingSchema,
  NeighbourhoodCreditsSchema,
  NeighbourhoodProfileSchema,
} from "./neighbourhoodProfile.js";

const locationFull = {
  name: "Bairro Alto",
  coordinates: { lat: 38.7115, lon: -9.1449 },
  countryCode: "PT",
} as const;

const locationBrief = {
  name: "Bairro Alto",
  countryCode: "PT",
} as const;

const samplePoi = {
  id: "poi-1",
  name: "Bar Example",
  coordinates: { lat: 38.7115, lon: -9.1449 },
  category: "nightlife",
  distanceM: 120,
} as const;

const makeDomainRating = (
  overrides: Partial<{
    rating: "none" | "low" | "medium" | "high";
    count: number;
    densityPerKm2: number;
    countCapped: boolean;
  }> = {},
) => ({
  rating: "high" as const,
  count: 20,
  radiusM: 500,
  densityPerKm2: 25.5,
  countCapped: true,
  rings: [
    { radiusM: 250, count: 8 },
    { radiusM: 500, count: 20 },
  ],
  ...overrides,
});

const makeDomainProfile = (ratingOverrides?: Parameters<typeof makeDomainRating>[0]) => ({
  ...makeDomainRating(ratingOverrides),
  samplePois: [samplePoi],
});

const credits = { consumed: 1, byDomain: { nightlife: 1 } } as const;

/** Every profile needs a `credits` block; supply a valid default the case can override. */
const parseProfile = (profile: Record<string, unknown>) =>
  NeighbourhoodProfileSchema.safeParse({ credits, ...profile });

const okSource = { status: "ok" as const };
const unavailableSource = {
  status: "unavailable" as const,
  error: upstreamError("geoapify", "Geoapify Places request failed"),
};

describe("NeighbourhoodProfileSchema — full arm", () => {
  it("accepts a complete profile with rated domains and sample POIs", () => {
    const result = parseProfile({
      detail: "full",
      location: locationFull,
      radiusM: 500,
      requestedCategories: ["nightlife"],
      domains: {
        nightlife: makeDomainProfile(),
      },
      sources: {
        nightlife: okSource,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a none-rated domain with zero count", () => {
    const result = parseProfile({
      detail: "full",
      location: locationFull,
      radiusM: 500,
      requestedCategories: ["culture"],
      domains: {
        culture: makeDomainProfile({
          rating: "none",
          count: 0,
          densityPerKm2: 0,
          countCapped: false,
          rings: [{ radiusM: 500, count: 0 }],
        }),
      },
      sources: {
        culture: okSource,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an all-none empty rural profile", () => {
    const noneDomain = {
      rating: "none" as const,
      count: 0,
      radiusM: 500,
      densityPerKm2: 0,
      countCapped: false,
      rings: [{ radiusM: 500, count: 0 }],
      samplePois: [] as [],
    };

    const result = parseProfile({
      detail: "full",
      location: locationFull,
      radiusM: 500,
      requestedCategories: ["nightlife", "dining"],
      domains: {
        nightlife: noneDomain,
        dining: noneDomain,
      },
      sources: {
        nightlife: okSource,
        dining: okSource,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a null domain paired with an unavailable source", () => {
    const result = parseProfile({
      detail: "full",
      location: locationFull,
      radiusM: 500,
      requestedCategories: ["nightlife", "dining"],
      domains: {
        nightlife: makeDomainProfile(),
        dining: null,
      },
      sources: {
        nightlife: okSource,
        dining: unavailableSource,
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("NeighbourhoodProfileSchema — brief arm", () => {
  it("accepts a projected brief profile without coordinates or sample POIs", () => {
    const result = parseProfile({
      detail: "brief",
      location: locationBrief,
      radiusM: 500,
      requestedCategories: ["nightlife"],
      domains: {
        nightlife: makeDomainRating(),
      },
      sources: {
        nightlife: okSource,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a brief none-rated domain", () => {
    const result = parseProfile({
      detail: "brief",
      location: locationBrief,
      radiusM: 500,
      requestedCategories: ["parks"],
      domains: {
        greenSpace: makeDomainRating({
          rating: "none",
          count: 0,
          densityPerKm2: 0,
          countCapped: false,
          rings: [{ radiusM: 500, count: 0 }],
        }),
      },
      sources: {
        greenSpace: okSource,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a brief null domain with unavailable source", () => {
    const result = parseProfile({
      detail: "brief",
      location: locationBrief,
      radiusM: 500,
      requestedCategories: ["transit"],
      domains: {
        transit: null,
      },
      sources: {
        transit: { status: "unavailable", error: notFound("no transit data") },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a brief profile that still carries samplePois", () => {
    const result = parseProfile({
      detail: "brief",
      location: locationBrief,
      radiusM: 500,
      requestedCategories: ["nightlife"],
      domains: {
        nightlife: makeDomainProfile(),
      },
      sources: {
        nightlife: okSource,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a brief location that still carries coordinates", () => {
    const result = parseProfile({
      detail: "brief",
      location: locationFull,
      radiusM: 500,
      requestedCategories: ["nightlife"],
      domains: {
        nightlife: makeDomainRating(),
      },
      sources: {
        nightlife: okSource,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("DomainRatingSchema", () => {
  it("rejects a rating missing count", () => {
    const { count: _count, ...withoutCount } = makeDomainRating();
    const result = DomainRatingSchema.safeParse(withoutCount);
    expect(result.success).toBe(false);
  });

  it("rejects a rating missing rings", () => {
    const { rings: _rings, ...withoutRings } = makeDomainRating();
    const result = DomainRatingSchema.safeParse(withoutRings);
    expect(result.success).toBe(false);
  });

  it("rejects an empty rings array", () => {
    const result = DomainRatingSchema.safeParse({
      ...makeDomainRating(),
      rings: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative count", () => {
    const result = DomainRatingSchema.safeParse({
      ...makeDomainRating(),
      count: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("NeighbourhoodCreditsSchema", () => {
  it("accepts a consumed total with a per-domain breakdown", () => {
    const result = NeighbourhoodCreditsSchema.safeParse({
      consumed: 5,
      byDomain: { nightlife: 1, dining: 1, transit: 0, greenSpace: 1, retail: 1, culture: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty byDomain — a record over the enum is partial", () => {
    const result = NeighbourhoodCreditsSchema.safeParse({ consumed: 0, byDomain: {} });
    expect(result.success).toBe(true);
  });

  it("rejects a negative consumed total", () => {
    const result = NeighbourhoodCreditsSchema.safeParse({ consumed: -1, byDomain: {} });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional per-domain credit", () => {
    const result = NeighbourhoodCreditsSchema.safeParse({
      consumed: 1,
      byDomain: { nightlife: 0.5 },
    });
    expect(result.success).toBe(false);
  });
});

describe("NeighbourhoodProfileSchema — credits block", () => {
  const base = {
    detail: "full" as const,
    location: locationFull,
    radiusM: 500,
    requestedCategories: ["nightlife"],
    domains: { nightlife: makeDomainProfile() },
    sources: { nightlife: okSource },
  };

  it("rejects a full profile with no credits block", () => {
    expect(NeighbourhoodProfileSchema.safeParse(base).success).toBe(false);
  });

  it("rejects a brief profile with no credits block", () => {
    const { coordinates: _c, ...briefLocation } = locationFull;
    const result = NeighbourhoodProfileSchema.safeParse({
      ...base,
      detail: "brief",
      location: briefLocation,
      domains: { nightlife: makeDomainRating() },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a full profile once the credits block is present", () => {
    expect(NeighbourhoodProfileSchema.safeParse({ ...base, credits }).success).toBe(true);
  });
});
