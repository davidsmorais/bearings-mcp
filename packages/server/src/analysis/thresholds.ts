import type { NeighbourhoodDomain } from "@bearings/shared";

/**
 * The rating vocabulary, worst to best. `none` is reserved for a zero count; the
 * other three are density buckets. Kept here, next to the thresholds it is read
 * against, rather than in the shared schema (which only needs the string enum).
 */
const RATING_LEVELS = ["none", "low", "medium", "high"] as const;

export type RatingLevel = (typeof RATING_LEVELS)[number];

/**
 * The one radius these thresholds are valid at. `classifyDomain` reads the rating off
 * the ring at this radius — the ~6-minute walk — no matter how wide `radiusM` was: the
 * cutoffs below are calibrated here and nowhere else, and POI density genuinely falls
 * off with radius (a 20-place sample saturates 25.5 venues/km² at 500 m and reports 1.6
 * at 2000 m for the same neighbourhood). A request with `radiusM` under this value has
 * no ring here, so the classifier falls back to that request's outer ring — tighter than
 * 500 m, so a higher density for the same sample, which is the safe direction.
 */
export const CALIBRATION_RADIUS_M = 500;

/**
 * Venue-density cutoffs in venues/km², one pair per domain, read at
 * `CALIBRATION_RADIUS_M`. This is the single named-constant block for the analysis layer
 * (root Invariant 7) — no other file carries a density number.
 *
 * Per-domain because a walkable dining scene and a walkable museum scene are
 * different densities: 22 restaurants/km² is ordinary, 22 museums/km² is a
 * cultural quarter. Each pair is calibrated against one dense and one quiet
 * reference coordinate so the dense one classifies `high` and the quiet one
 * `low`; `high` sits at or below the 25.5 venues/km² that a call capped at
 * `limitPerCategory: 20` can still report within 500 m, so a genuinely dense but
 * count-capped domain is not under-rated. Full derivation, with the reference
 * readings, lives in MEMORY.md → "Neighbourhood density thresholds (DMS-499)".
 */
export const DENSITY_THRESHOLDS: Record<
  NeighbourhoodDomain,
  { readonly medium: number; readonly high: number }
> = {
  // Bairro Alto's bar grid saturates the 20-place sample (>=25.5/km²); a Cascais
  // residential grid returns ~1/km².
  nightlife: { medium: 8, high: 20 },
  // Baixa-Chiado dining saturates the sample (>=25.5/km²); a quiet suburb runs ~5/km².
  dining: { medium: 10, high: 22 },
  // Central metro/rail/bus stops cluster around ~16/km²; suburban coverage is ~2/km².
  transit: { medium: 6, high: 15 },
  // Municipal gardens are sparse even where present: ~6/km² beside a big park, ~1 elsewhere.
  greenSpace: { medium: 2, high: 5 },
  // Supermarkets and markets are a low-count domain: ~16/km² in a retail core, ~3 in a suburb.
  retail: { medium: 6, high: 13 },
  // Museums, galleries and cinemas concentrate in the cultural quarter (~14/km²), ~1 in a suburb.
  culture: { medium: 3, high: 8 },
};
