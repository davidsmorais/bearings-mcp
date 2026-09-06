import { describe, expect, it } from "vitest";
import { LocationSchema } from "./location.js";

const validLocation = {
  name: "London",
  coordinates: { lat: 51.5, lon: -0.12 },
  countryCode: "GB",
};

describe("LocationSchema", () => {
  it("parses a valid location", () => {
    const result = LocationSchema.safeParse(validLocation);
    expect(result.success).toBe(true);
  });

  it("parses an optional displayName", () => {
    const result = LocationSchema.safeParse({
      ...validLocation,
      displayName: "London, England, United Kingdom",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = LocationSchema.safeParse({ ...validLocation, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing countryCode", () => {
    const { countryCode: _, ...withoutCountry } = validLocation;
    const result = LocationSchema.safeParse(withoutCountry);
    expect(result.success).toBe(false);
  });

  it("rejects a countryCode with wrong length", () => {
    const result = LocationSchema.safeParse({ ...validLocation, countryCode: "GBR" });
    expect(result.success).toBe(false);
  });

  it("rejects a lowercase countryCode", () => {
    const result = LocationSchema.safeParse({ ...validLocation, countryCode: "gb" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-alpha countryCode", () => {
    for (const countryCode of ["G1", "12"]) {
      const result = LocationSchema.safeParse({ ...validLocation, countryCode });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes("countryCode"))).toBe(true);
        expect(result.error.issues[0]?.message).toBe("Invalid");
      }
    }
  });

  it("rejects an empty displayName when provided", () => {
    const result = LocationSchema.safeParse({ ...validLocation, displayName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid nested coordinates", () => {
    const result = LocationSchema.safeParse({
      ...validLocation,
      coordinates: { lat: 100, lon: 0 },
    });
    expect(result.success).toBe(false);
  });
});
