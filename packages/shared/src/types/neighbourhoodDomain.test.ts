import { describe, expect, it } from "vitest";
import { NeighbourhoodDomainSchema } from "./neighbourhoodDomain.js";

describe("NeighbourhoodDomainSchema", () => {
  it.each(["nightlife", "dining", "transit", "greenSpace", "retail", "culture"])(
    "parses valid domain %s",
    (domain) => {
      expect(NeighbourhoodDomainSchema.safeParse(domain).success).toBe(true);
    },
  );

  it("rejects a PoiCategory value that is not a domain", () => {
    expect(NeighbourhoodDomainSchema.safeParse("cafes").success).toBe(false);
    expect(NeighbourhoodDomainSchema.safeParse("parks").success).toBe(false);
  });

  it("exposes exactly six options in a stable order", () => {
    expect(NeighbourhoodDomainSchema.options).toEqual([
      "nightlife",
      "dining",
      "transit",
      "greenSpace",
      "retail",
      "culture",
    ]);
  });
});
