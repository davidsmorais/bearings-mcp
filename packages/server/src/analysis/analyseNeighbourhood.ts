import {
  type AnalyseNeighbourhoodInput,
  type Coordinates,
  type DomainProfile,
  internalError,
  isToolError,
  type Location,
  type NeighbourhoodDomain,
  type NeighbourhoodProfile,
  type NeighbourhoodProfileBrief,
  type NeighbourhoodProfileFull,
  NeighbourhoodProfileSchema,
  type SourceOutcome,
  type ToolError,
  upstreamError,
} from "@bearings/shared";
import type { HttpCore } from "../http/index.js";
import { searchPlaces } from "../upstream/geoapify.js";
import { DOMAIN_MEMBERS, domainsForRequestedCategories } from "./categoryAdapter.js";
import { classifyDomain } from "./classifyDensity.js";
import { worstOfErrors } from "./errorSeverity.js";
import { partitionByRing, ringsWithin } from "./rings.js";

// `toBriefDetail` drops `samplePois` outright, so this only ever affects `full` — no
// per-detail branching needed or wanted. Raised 5 → 10 (DMS-501): with
// `limitPerCategory` reaching 40, five samples out of forty is a thinner window than
// five out of twenty was, and `full` exists to trade credits for depth.
const SAMPLE_POI_LIMIT = 10;

export interface AnalyseNeighbourhoodDeps {
  readonly core?: HttpCore;
  readonly signal?: AbortSignal;
}

/** Coordinate-only input has no resolved place name — echo the point for Invariant 6. */
const locationFromCoordinates = (coordinates: Coordinates): Location => ({
  name: `${coordinates.lat.toFixed(4)}, ${coordinates.lon.toFixed(4)}`,
  coordinates,
  countryCode: "ZZ",
});

const nearestSamplePois = (
  places: readonly DomainProfile["samplePois"][number][],
): DomainProfile["samplePois"] =>
  [...places]
    .sort((left, right) => {
      const leftDistance = left.distanceM ?? Number.POSITIVE_INFINITY;
      const rightDistance = right.distanceM ?? Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance;
    })
    .slice(0, SAMPLE_POI_LIMIT);

const toBriefDetail = (full: NeighbourhoodProfileFull): NeighbourhoodProfileBrief => {
  const { coordinates: _coordinates, ...location } = full.location;
  const domains = Object.fromEntries(
    Object.entries(full.domains).map(([domain, profile]) => {
      if (profile === null) {
        return [domain, null];
      }
      const { samplePois: _samplePois, ...rating } = profile;
      return [domain, rating];
    }),
  ) as NeighbourhoodProfileBrief["domains"];

  return {
    detail: "brief",
    location,
    radiusM: full.radiusM,
    requestedCategories: full.requestedCategories,
    domains,
    sources: full.sources,
    // `brief` drops bulk (sample POIs, echo coordinates), not evidence — the
    // credit block is two small numbers and is carried through untouched.
    credits: full.credits,
  };
};

/**
 * Fans out one Geoapify domain query per requested analysis domain (`Promise.allSettled`,
 * never `Promise.all`) and assembles a neighbourhood profile where every rating carries
 * its count, radius and ring breakdown. One domain failing still returns the others;
 * every domain failing returns the worst `ToolError` (quota exhaustion surfaces as
 * `QUOTA_EXCEEDED`). An all-empty rural coordinate is a valid all-`none` profile, not an error.
 */
export async function analyseNeighbourhood(
  input: AnalyseNeighbourhoodInput,
  deps: AnalyseNeighbourhoodDeps = {},
): Promise<NeighbourhoodProfile | ToolError> {
  const requestedDomains = domainsForRequestedCategories(input.categories);
  const rings = ringsWithin(input.radiusM);

  const settled = await Promise.allSettled(
    requestedDomains.map((domain) =>
      searchPlaces(
        {
          coordinates: input.coordinates,
          radiusM: input.radiusM,
          categories: [...DOMAIN_MEMBERS[domain]],
          limit: input.limitPerCategory,
          signal: deps.signal,
        },
        { core: deps.core },
      ),
    ),
  );

  const domains = {} as Record<NeighbourhoodDomain, DomainProfile | null>;
  const sources = {} as Record<NeighbourhoodDomain, SourceOutcome>;
  // A failed domain is absent from `byDomain` (contributes 0); a cache-served
  // domain appears as an explicit 0. The two stay distinguishable.
  const byDomain: Partial<Record<NeighbourhoodDomain, number>> = {};
  const failures: ToolError[] = [];
  let anySuccess = false;

  for (let index = 0; index < requestedDomains.length; index += 1) {
    const domain = requestedDomains[index];
    const outcome = settled[index];

    const searchResult =
      outcome?.status === "fulfilled"
        ? outcome.value
        : upstreamError("Geoapify client threw instead of returning an error", "geoapify");

    if (isToolError(searchResult)) {
      sources[domain] = { status: "unavailable", error: searchResult };
      domains[domain] = null;
      failures.push(searchResult);
      continue;
    }

    anySuccess = true;
    byDomain[domain] = searchResult.credits;
    const places = searchResult.places;
    const { rings: ringCounts, missingDistance } = partitionByRing(places, rings);
    const count = places.length;
    const rating = classifyDomain(domain, count, input.radiusM, ringCounts, {
      countCapped: count >= input.limitPerCategory,
    });

    domains[domain] = {
      ...rating,
      // Copy the ring breakdown as a fresh mutable array — `DomainRating.rings` is
      // `readonly` in the analysis layer; the shared `DomainProfile` type is not.
      rings: rating.rings.map((ring) => ({ radiusM: ring.radiusM, count: ring.count })),
      samplePois: nearestSamplePois(places),
    };

    if (missingDistance > 0) {
      sources[domain] = {
        status: "partial",
        note: `${missingDistance} place(s) had no distance and were counted only at the outer ring`,
      };
    } else {
      sources[domain] = { status: "ok" };
    }
  }

  if (!anySuccess) {
    return worstOfErrors(failures);
  }

  const consumed = Object.values(byDomain).reduce((sum, credits) => sum + credits, 0);

  const full: NeighbourhoodProfileFull = {
    detail: "full",
    location: locationFromCoordinates(input.coordinates),
    radiusM: input.radiusM,
    requestedCategories: [...input.categories],
    domains,
    sources,
    credits: { consumed, byDomain },
  };

  const composed: NeighbourhoodProfile = input.detail === "brief" ? toBriefDetail(full) : full;

  const parsed = NeighbourhoodProfileSchema.safeParse(composed);
  if (!parsed.success) {
    return internalError(
      `composed neighbourhood profile failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
