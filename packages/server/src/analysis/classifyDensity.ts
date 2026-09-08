import type { NeighbourhoodDomain } from "@bearings/shared";
import { densityPerKm2 } from "./density.js";
import type { RingCount } from "./rings.js";
import { DENSITY_THRESHOLDS, type RatingLevel } from "./thresholds.js";

/**
 * A domain's verdict travelling with the evidence that produced it (root
 * Invariant 6): the count, the radius, the density that count implies, whether
 * the count was capped, and the full per-ring breakdown.
 */
export interface DomainRating {
  readonly rating: RatingLevel;
  readonly count: number;
  readonly radiusM: number;
  readonly densityPerKm2: number;
  readonly countCapped: boolean;
  readonly rings: readonly RingCount[];
}

const ratingForDensity = (
  domain: NeighbourhoodDomain,
  count: number,
  density: number,
): RatingLevel => {
  if (count === 0) {
    return "none";
  }
  const { medium, high } = DENSITY_THRESHOLDS[domain];
  if (density >= high) {
    return "high";
  }
  if (density >= medium) {
    return "medium";
  }
  return "low";
};

/**
 * Classify one domain from the outer-ring count and radius. When `countCapped` is
 * true the count is a floor (`searchPlaces` returned the full `limitPerCategory`),
 * so `densityPerKm2` is a lower bound and therefore so is `rating` — a later
 * uncapped call can only move the density up, and the buckets are monotonic in
 * density, so such a call can only raise the rating, never lower it. Nothing here
 * lowers a rating; the guarantee is a property of the ordering, not a fudge
 * factor applied to the number.
 */
export const classifyDomain = (
  domain: NeighbourhoodDomain,
  count: number,
  radiusM: number,
  rings: readonly RingCount[],
  options: { readonly countCapped: boolean },
): DomainRating => {
  const density = densityPerKm2(count, radiusM);
  return {
    rating: ratingForDensity(domain, count, density),
    count,
    radiusM,
    densityPerKm2: density,
    countCapped: options.countCapped,
    rings,
  };
};
