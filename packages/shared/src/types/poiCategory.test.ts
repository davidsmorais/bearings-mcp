import { describe, expect, it } from "vitest";
import { PoiCategorySchema } from "./poiCategory.js";

const validCategories = [
  "dining",
  "cafes",
  "nightlife",
  "groceries",
  "transit",
  "parks",
  "culture",
] as const;

describe("PoiCategorySchema", () => {
  it.each(validCategories)("parses valid category %s", (category) => {
    const result = PoiCategorySchema.safeParse(category);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const result = PoiCategorySchema.safeParse("shopping");
    expect(result.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = PoiCategorySchema.safeParse("");
    expect(result.success).toBe(false);
  });
});
