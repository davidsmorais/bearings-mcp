import type { PointOfInterest } from "@bearings/shared";

/**
 * Walking-time bands used as the inner ring ladder: ~3 min / ~6 min / ~12 min at a
 * typical 1.3–1.4 m/s pace. One Geoapify call is made at the widest radius and the
 * returned POIs are partitioned into these rings client-side — the inner rings cost
 * no extra credits.
 */
export const WALKING_RADII_M = [250, 500, 1000] as const;

export interface RingCount {
  readonly radiusM: number;
  readonly count: number;
}

export interface RingPartition {
  readonly rings: readonly RingCount[];
  /** POIs that carried no `distanceM` and were counted only at the outer ring. */
  readonly missingDistance: number;
}

/**
 * The ring radii to report for a request: every ladder entry `<= radiusM`, plus
 * `radiusM` itself as the outer ring. Ascending, deduped — so a `radiusM` that
 * equals a ladder entry does not produce a duplicate ring.
 */
export const ringsWithin = (radiusM: number): readonly number[] => {
  const withinLadder = WALKING_RADII_M.filter((entry) => entry <= radiusM);
  return [...new Set([...withinLadder, radiusM])].sort((a, b) => a - b);
};

/**
 * Cumulative POI counts per ring: a POI 300 m out is counted in the 500 m and
 * 1000 m rings, not the 250 m ring. A POI with no `distanceM` cannot be placed in
 * an inner ring, so it is counted only at the outer ring and tallied in
 * `missingDistance` for the caller to surface.
 */
export const partitionByRing = (
  pois: readonly PointOfInterest[],
  rings: readonly number[],
): RingPartition => {
  const ascending = [...new Set(rings)].sort((a, b) => a - b);
  if (ascending.length === 0) {
    return { rings: [], missingDistance: 0 };
  }

  const counts = ascending.map((radiusM) => ({ radiusM, count: 0 }));
  const outer = counts[counts.length - 1];
  let missingDistance = 0;

  for (const poi of pois) {
    const distanceM = poi.distanceM;
    if (distanceM === undefined || !Number.isFinite(distanceM)) {
      missingDistance += 1;
      outer.count += 1;
      continue;
    }
    for (const ring of counts) {
      if (distanceM <= ring.radiusM) {
        ring.count += 1;
      }
    }
  }

  return { rings: counts.map((ring) => ({ ...ring })), missingDistance };
};
