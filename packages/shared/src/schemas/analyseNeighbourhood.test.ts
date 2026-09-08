import { describe, expect, it } from "vitest";
import { zodErrorToToolError } from "../toToolError.js";
import { AnalyseNeighbourhoodInputSchema } from "./analyseNeighbourhood.js";

const validCoordinates = { lat: 48.8566, lon: 2.3522 };

describe("AnalyseNeighbourhoodInputSchema", () => {
  it("parses valid input with defaults applied", () => {
    const result = AnalyseNeighbourhoodInputSchema.safeParse({
      coordinates: validCoordinates,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.radiusM).toBe(500);
      expect(result.data.limitPerCategory).toBe(20);
      expect(result.data.detail).toBe("brief");
      expect(result.data.categories).toHaveLength(7);
    }
  });

  it("accepts radiusM at minimum boundary", () => {
    expect(
      AnalyseNeighbourhoodInputSchema.safeParse({
        coordinates: validCoordinates,
        radiusM: 100,
      }).success,
    ).toBe(true);
  });

  it("accepts radiusM at maximum boundary", () => {
    expect(
      AnalyseNeighbourhoodInputSchema.safeParse({
        coordinates: validCoordinates,
        radiusM: 5000,
      }).success,
    ).toBe(true);
  });

  it("rejects radiusM below minimum", () => {
    const input = { coordinates: validCoordinates, radiusM: 99 };
    const result = AnalyseNeighbourhoodInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("radiusM");
      expect(error.message).toContain("radiusM");
      expect(error.message).toContain("99");
    }
  });

  it("rejects radiusM above maximum", () => {
    const input = { coordinates: validCoordinates, radiusM: 5001 };
    const result = AnalyseNeighbourhoodInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("radiusM");
      expect(error.message).toBe("radiusM must be 5000 or less, received 5001");
    }
  });

  it("rejects limitPerCategory above maximum", () => {
    const input = { coordinates: validCoordinates, limitPerCategory: 101 };
    const result = AnalyseNeighbourhoodInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("limitPerCategory");
      expect(error.message).toContain("limitPerCategory");
      expect(error.message).toContain("101");
    }
  });

  it("keeps the default limitPerCategory at 20 for brief", () => {
    const result = AnalyseNeighbourhoodInputSchema.safeParse({
      coordinates: validCoordinates,
      detail: "brief",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limitPerCategory).toBe(20);
    }
  });

  it("keeps the default limitPerCategory at 20 for full", () => {
    const result = AnalyseNeighbourhoodInputSchema.safeParse({
      coordinates: validCoordinates,
      detail: "full",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limitPerCategory).toBe(20);
    }
  });

  it("accepts brief with limitPerCategory at 20 — the one-credit ceiling", () => {
    const result = AnalyseNeighbourhoodInputSchema.safeParse({
      coordinates: validCoordinates,
      detail: "brief",
      limitPerCategory: 20,
    });
    expect(result.success).toBe(true);
  });

  it("rejects brief with limitPerCategory above 20, with a recoverable message", () => {
    const input = {
      coordinates: validCoordinates,
      detail: "brief",
      limitPerCategory: 40,
    };
    const result = AnalyseNeighbourhoodInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("limitPerCategory");
      expect(error.message).toBe(
        "limitPerCategory must be 20 or less when detail is brief (received 40); " +
          'use detail: "full" to fetch up to 40 places per domain at 2 credits',
      );
    }
  });

  it("accepts full with limitPerCategory up to 40 — the two-credit ceiling", () => {
    const result = AnalyseNeighbourhoodInputSchema.safeParse({
      coordinates: validCoordinates,
      detail: "full",
      limitPerCategory: 40,
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate categories", () => {
    const input = {
      coordinates: validCoordinates,
      categories: ["dining", "dining", "cafes"],
    };
    const result = AnalyseNeighbourhoodInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.message).toContain("categories");
      expect(error.message).toContain("dining");
    }
  });

  it("rejects empty categories array", () => {
    const input = { coordinates: validCoordinates, categories: [] };
    const result = AnalyseNeighbourhoodInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("categories");
      expect(error.message).toContain("categories");
    }
  });
});
