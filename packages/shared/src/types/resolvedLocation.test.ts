import { describe, expect, it } from "vitest";
import { LocationSchema } from "./location.js";
import {
  LocationCandidateSchema,
  PlaceKindSchema,
  ResolvedLocationSchema,
} from "./resolvedLocation.js";

const validResolved = {
  name: "Lisbon",
  coordinates: { lat: 38.7077507, lon: -9.1365919 },
  countryCode: "PT",
  displayName: "Lisbon, Portugal",
  admin: { county: "Lisbon", municipality: "Lisbon" },
  kind: "city",
  importance: 0.76,
  placeRank: 14,
  boundingBox: [38.6913994, 38.7967584, -9.2298356, -9.0863328],
  osmType: "relation",
  osmId: 5400890,
};

describe("ResolvedLocationSchema", () => {
  it("parses a fully-populated resolved location", () => {
    expect(ResolvedLocationSchema.safeParse(validResolved).success).toBe(true);
  });

  it("requires the admin object but treats each of its fields as optional", () => {
    expect(ResolvedLocationSchema.safeParse({ ...validResolved, admin: {} }).success).toBe(true);
    expect(
      ResolvedLocationSchema.safeParse({ ...validResolved, admin: { state: "Oregon" } }).success,
    ).toBe(true);

    const { admin: _admin, ...withoutAdmin } = validResolved;
    expect(ResolvedLocationSchema.safeParse(withoutAdmin).success).toBe(false);
  });

  it("stays structurally assignable to a Location", () => {
    const parsed = ResolvedLocationSchema.parse(validResolved);
    expect(LocationSchema.safeParse(parsed).success).toBe(true);
  });

  it("rejects an importance above 1", () => {
    expect(ResolvedLocationSchema.safeParse({ ...validResolved, importance: 1.4 }).success).toBe(
      false,
    );
  });

  it("rejects a bounding box that is not four numbers", () => {
    expect(
      ResolvedLocationSchema.safeParse({ ...validResolved, boundingBox: [1, 2, 3] }).success,
    ).toBe(false);
  });

  it("rejects a place rank outside 0–30", () => {
    expect(ResolvedLocationSchema.safeParse({ ...validResolved, placeRank: 42 }).success).toBe(
      false,
    );
  });
});

describe("PlaceKindSchema", () => {
  it("rejects a kind that is not in the enum", () => {
    expect(PlaceKindSchema.safeParse("metropolis").success).toBe(false);
  });

  it("accepts the explicit other fallback", () => {
    expect(PlaceKindSchema.safeParse("other").success).toBe(true);
  });
});

describe("LocationCandidateSchema", () => {
  it("parses a candidate carrying a resolved location, importance and kind", () => {
    const result = LocationCandidateSchema.safeParse({
      location: validResolved,
      importance: 0.61,
      kind: "city",
    });
    expect(result.success).toBe(true);
  });

  it("requires importance and kind on the candidate itself", () => {
    expect(LocationCandidateSchema.safeParse({ location: validResolved }).success).toBe(false);
  });
});
