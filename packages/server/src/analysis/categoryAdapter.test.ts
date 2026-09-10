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

  it("never lets one domain query an ancestor of another domain's category", () => {
    // Geoapify returns a feature's full category ancestry, so a parent string drags every
    // child into the querying domain's count and bills that venue to two domains. This is
    // the property `entertainment` (nightlife) broke against `entertainment.museum`
    // (culture). `categoryAdapter.ts` also asserts it at module load; this states it as a
    // contract rather than leaving it to an import-time throw.
    const queried = NeighbourhoodDomainSchema.options.flatMap((domain) =>
      geoapifyStringsForDomain(domain).map((prefix) => ({ prefix, domain })),
    );

    for (const left of queried) {
      for (const right of queried) {
        if (left.domain === right.domain) continue;
        const isAncestor =
          right.prefix === left.prefix || right.prefix.startsWith(`${left.prefix}.`);
        expect(
          isAncestor,
          `"${left.prefix}" (${left.domain}) is an ancestor of "${right.prefix}" (${right.domain})`,
        ).toBe(false);
      }
    }
  });
});

describe("domainForGeoapifyCategories / poiCategoryForGeoapifyCategories", () => {
  it("classifies a restaurant feature as dining", () => {
    expect(domainForGeoapifyCategories(["catering.restaurant"])).toBe("dining");
    expect(poiCategoryForGeoapifyCategories(["catering.restaurant"])).toBe("dining");
  });

  it("classifies a nightclub as nightlife", () => {
    expect(domainForGeoapifyCategories(["adult", "adult.nightclub"])).toBe("nightlife");
    expect(domainForGeoapifyCategories(["catering", "catering.bar"])).toBe("nightlife");
  });

  it("keeps every entertainment leaf in culture and none of them in nightlife", () => {
    // The bare `entertainment` parent used to sit in nightlife, which made every one of
    // these a nightlife venue — Geoapify sends the full ancestry, so the parent matched
    // them all. Nightlife no longer queries a parent, so they classify only as culture.
    for (const leaf of ["entertainment.culture", "entertainment.museum", "entertainment.cinema"]) {
      expect(domainForGeoapifyCategories(["entertainment", leaf])).toBe("culture");
    }
    expect(poiCategoryForGeoapifyCategories(["entertainment.culture.theatre"])).toBe("culture");
  });

  it("no longer claims a bare entertainment feature — a zoo is not a night out", () => {
    // ["entertainment", "entertainment.zoo"] is what Geoapify sends for a zoo. It used to
    // resolve to nightlife via the depth-1 `entertainment` prefix and be counted as such.
    expect(domainForGeoapifyCategories(["entertainment"])).toBeUndefined();
    expect(domainForGeoapifyCategories(["entertainment", "entertainment.zoo"])).toBeUndefined();
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
