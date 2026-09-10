import type { NeighbourhoodDomain } from "@bearings/shared";
import { densityPerKm2 } from "./density.js";
import { type RingCount, ratingRing } from "./rings.js";
import { DENSITY_THRESHOLDS, type RatingLevel } from "./thresholds.js";

/**
 * A domain's verdict travelling with the evidence that produced it (root Invariant 6):
 * the total count within the requested radius, that radius, the ring the rating was
 * actually read at, the density at that ring, whether that ring's count is a floor, and
 * the full per-ring breakdown.
 */
export interface DomainRating {
  readonly rating: RatingLevel;
  /** Total POIs within the requested `radiusM`. */
  readonly count: number;
  /** The radius the caller requested — sample width and evidence, not the rating input. */
  readonly radiusM: number;
  /** The ring `rating` was read at: `CALIBRATION_RADIUS_M`, or the outer ring below it. */
  readonly ratingRadiusM: number;
  /** Venue density at `ratingRadiusM` — the number `rating` is bucketed from. */
  readonly densityPerKm2: number;
  /** True when the rating ring's own count is a floor (see `classifyDomain`). */
  readonly countCapped: boolean;
  readonly rings: readonly RingCount[];
}

const ratingForDensity = (
  domain: NeighbourhoodDomain,
  ringCount: number,
  density: number,
): RatingLevel => {
  if (ringCount === 0) {
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
 * Classify one domain from the ring at `CALIBRATION_RADIUS_M` — the only radius
 * `DENSITY_THRESHOLDS` is calibrated at. `radiusM` is kept as evidence (total count,
 * sample width) but is not an input to the verdict: POI density falls off with radius,
 * so classifying a wide-radius sample against 500 m thresholds silently under-rates it.
 * Below 500 m there is no calibrated ring; `ratingRing` falls back to the request's
 * outer ring, which is tighter and so reports a higher density — the safe direction.
 *
 * `countCapped` here is scoped to the rating ring: `true` only when the whole response
 * was capped at `limitPerCategory` *and* every returned POI fell inside the rating ring,
 * so the ring's count — and therefore its density and rating — is a floor. When the
 * response is capped but POIs also landed beyond the rating ring, the sub-ring slice was
 * not truncated by the limit, so the flag clears. This leans on Geoapify's
 * `bias=proximity` returning near POIs first; that is a ranking preference, not a strict
 * distance sort, so the inference is strong but not guaranteed — when the counts are
 * equal the flag stays `true`, the conservative reading.
 *
 * Nothing here lowers a rating: a later uncapped call moves density up, the buckets are
 * monotonic in density, so it can only raise the rating. The guarantee is a property of
 * the ordering, not a fudge applied to the number.
 */
export const classifyDomain = (
  domain: NeighbourhoodDomain,
  count: number,
  radiusM: number,
  rings: readonly RingCount[],
  options: { readonly countCapped: boolean },
): DomainRating => {
  const ring = ratingRing(rings, radiusM);
  const density = densityPerKm2(ring.count, ring.radiusM);
  const ringCountCapped = options.countCapped && ring.count === count;
  return {
    rating: ratingForDensity(domain, ring.count, density),
    count,
    radiusM,
    ratingRadiusM: ring.radiusM,
    densityPerKm2: density,
    countCapped: ringCountCapped,
    rings,
  };
};
