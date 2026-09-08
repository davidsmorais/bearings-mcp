import { describe, expect, it } from "vitest";
import { PointOfInterestSchema } from "./pointOfInterest.js";

describe("PointOfInterestSchema", () => {
  it("parses a minimal valid POI", () => {
    const result = PointOfInterestSchema.safeParse({
      id: "place-1",
      name: "Cafe Central",
      coordinates: { lat: 48.8566, lon: 2.3522 },
      category: "cafes",
    });

    expect(result.success).toBe(true);
  });

  it("rejects coordinates outside valid bounds", () => {
    const result = PointOfInterestSchema.safeParse({
      id: "place-1",
      name: "Invalid",
      coordinates: { lat: 91, lon: 0 },
      category: "dining",
    });

    expect(result.success).toBe(false);
  });
});
