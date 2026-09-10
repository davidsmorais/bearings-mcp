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
 * `missingDistance` is POIs that came back with no `distanceM`. They are within `radiusM`
 * — the circle filter guarantees it — but cannot be placed in an inner ring, so
 * `partitionByRing` counts them only at the outer ring. When the rating ring is an inner
 * one, its count omits them: rating `none` for a domain with twenty distanceless venues
 * is the failure this guards against. If placing every missing POI at the rating ring
 * would not change the bucket, the rating is certain and stands. If it would, the rating
 * ring cannot be classified honestly, so fall back to the outer ring — whose count *is*
 * complete — and mark the result a floor.
 *
 * Nothing here lowers a rating below the truth: `countCapped` and the missing-distance
 * fallback both surface a lower bound. A later fuller call moves density up, the buckets
 * are monotonic, so it can only raise the rating.
 */
export const classifyDomain = (
  domain: NeighbourhoodDomain,
  count: number,
  radiusM: number,
  rings: readonly RingCount[],
  options: { readonly countCapped: boolean; readonly missingDistance?: number },
): DomainRating => {
  const primary = ratingRing(rings, radiusM);
  const missing = options.missingDistance ?? 0;
  const outer = rings[rings.length - 1] ?? primary;

  // The primary ring omits the distanceless POIs. If they cannot swing the bucket, the
  // rating is safe to read there; if they can, the outer ring is the widest one whose
  // count is not missing anything.
  const missingCouldSwing =
    missing > 0 &&
    primary.radiusM < outer.radiusM &&
    ratingForDensity(domain, primary.count, densityPerKm2(primary.count, primary.radiusM)) !==
      ratingForDensity(
        domain,
        primary.count + missing,
        densityPerKm2(primary.count + missing, primary.radiusM),
      );

  const ring = missingCouldSwing ? outer : primary;
  const density = densityPerKm2(ring.count, ring.radiusM);
  const countCapped =
    (options.countCapped && ring.count === count) || (missingCouldSwing && missing > 0);

  return {
    rating: ratingForDensity(domain, ring.count, density),
    count,
    radiusM,
    ratingRadiusM: ring.radiusM,
    densityPerKm2: density,
    countCapped,
    rings,
  };
};
