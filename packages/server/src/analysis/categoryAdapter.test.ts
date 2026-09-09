import { NeighbourhoodDomainSchema, PoiCategorySchema } from "@bearings/shared";
import { describe, expect, it } from "vitest";
import {
  DOMAIN_MEMBERS,
  domainForGeoapifyCategories,
  domainsForRequestedCategories,
  GEOAPIFY_CATEGORY_STRINGS,
  geoapifyStringsForDomain,
  poiCategoryForGeoapifyCategories,
} from "./categoryAdapter.js";

describe("DOMAIN_MEMBERS", () => {
  it("maps every PoiCategory into exactly one domain", () => {
    const seen = new Map<string, number>();
    for (const domain of NeighbourhoodDomainSchema.options) {
      for (const category of DOMAIN_MEMBERS[domain]) {
        seen.set(category, (seen.get(category) ?? 0) + 1);
      }
    }
    for (const category of PoiCategorySchema.options) {
      expect(seen.get(category)).toBe(1);
    }
    expect(seen.size).toBe(PoiCategorySchema.options.length);
  });

  it("gives every domain at least one member", () => {
    for (const domain of NeighbourhoodDomainSchema.options) {
      expect(DOMAIN_MEMBERS[domain].length).toBeGreaterThan(0);
    }
  });
});

describe("geoapifyStringsForDomain", () => {
  it("unions both restaurant and cafe strings for dining", () => {
    const strings = geoapifyStringsForDomain("dining");
    expect(strings).toContain("catering.restaurant");
    expect(strings).toContain("catering.cafe");
  });

  it("deduplicates", () => {
    for (const domain of NeighbourhoodDomainSchema.options) {
      const strings = geoapifyStringsForDomain(domain);
      expect(new Set(strings).size).toBe(strings.length);
    }
  });
});

describe("domainForGeoapifyCategories / poiCategoryForGeoapifyCategories", () => {
  it("classifies a restaurant feature as dining", () => {
    expect(domainForGeoapifyCategories(["catering.restaurant"])).toBe("dining");
    expect(poiCategoryForGeoapifyCategories(["catering.restaurant"])).toBe("dining");
  });

  it("classifies an entertainment feature as nightlife", () => {
    expect(domainForGeoapifyCategories(["entertainment"])).toBe("nightlife");
    expect(domainForGeoapifyCategories(["entertainment.cinema"])).toBe("nightlife");
  });

  it("keeps entertainment.culture / entertainment.museum in culture, not nightlife", () => {
    // `entertainment` (nightlife) is a depth-1 prefix; the culture leaves are deeper
    // and must still win the longest-prefix match.
    expect(domainForGeoapifyCategories(["entertainment.culture"])).toBe("culture");
    expect(domainForGeoapifyCategories(["entertainment.museum"])).toBe("culture");
    expect(poiCategoryForGeoapifyCategories(["entertainment.culture.theatre"])).toBe("culture");
  });

  it("classifies a park feature as greenSpace", () => {
    expect(domainForGeoapifyCategories(["leisure.park"])).toBe("greenSpace");
  });

  it("matches a deeper dotted category by its known prefix", () => {
    expect(poiCategoryForGeoapifyCategories(["catering.restaurant.pizza"])).toBe("dining");
  });

  it("prefers the longest known prefix when several match", () => {
    // `catering.cafe` (cafes) is a deeper match than a hypothetical bare `catering`.
    expect(poiCategoryForGeoapifyCategories(["catering", "catering.cafe"])).toBe("cafes");
  });

  it("returns undefined for an unknown string", () => {
    expect(domainForGeoapifyCategories(["building.residential"])).toBeUndefined();
    expect(poiCategoryForGeoapifyCategories([])).toBeUndefined();
  });
});

describe("domainsForRequestedCategories", () => {
  it("folds cafes into the dining domain", () => {
    expect(domainsForRequestedCategories(["cafes"])).toEqual(["dining"]);
  });

  it("returns all six domains for the full category set, in stable order", () => {
    expect(domainsForRequestedCategories([...PoiCategorySchema.options])).toEqual([
      "nightlife",
      "dining",
      "transit",
      "greenSpace",
      "retail",
      "culture",
    ]);
  });

  it("deduplicates when both members of a domain are requested", () => {
    expect(domainsForRequestedCategories(["cafes", "dining"])).toEqual(["dining"]);
  });

  it("keeps every PoiCategory covered by GEOAPIFY_CATEGORY_STRINGS", () => {
    for (const category of PoiCategorySchema.options) {
      expect(GEOAPIFY_CATEGORY_STRINGS[category].length).toBeGreaterThan(0);
    }
  });
});
