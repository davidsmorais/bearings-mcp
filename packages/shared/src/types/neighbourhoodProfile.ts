import { z } from "zod";
import { LocationSchema } from "./location.js";
import { NeighbourhoodDomainSchema } from "./neighbourhoodDomain.js";
import { PoiCategorySchema } from "./poiCategory.js";
import { PointOfInterestSchema } from "./pointOfInterest.js";
import { SourceOutcomeSchema } from "./sourceOutcome.js";

/** Matches `RATING_LEVELS` in `packages/server/src/analysis/thresholds.ts`. */
const RATING_LEVELS = ["none", "low", "medium", "high"] as const;

const RingCountSchema = z.object({
  radiusM: z.number().int(),
  count: z.number().int().min(0),
});

/**
 * One domain's density verdict with the evidence that produced it (root Invariant 6).
 * Every field is required — a rating without its evidence must fail validation.
 *
 * `radiusM` is the radius the caller requested — the width of the sample and the span
 * `count` is measured over. `ratingRadiusM` is the walking ring `rating` was actually
 * read at: the 500 m calibration ring, or the request's outer ring when `radiusM` is
 * under 500 m. They differ whenever `radiusM > 500`, and `densityPerKm2` is always
 * measured at `ratingRadiusM`.
 */
export const DomainRatingSchema = z.object({
  rating: z.enum(RATING_LEVELS),
  count: z.number().int().min(0),
  radiusM: z.number().int(),
  ratingRadiusM: z.number().int(),
  densityPerKm2: z.number().min(0),
  countCapped: z.boolean(),
  rings: z.array(RingCountSchema).min(1),
});

export type DomainRating = z.infer<typeof DomainRatingSchema>;

/**
 * Full domain profile: the rating evidence plus sample POIs for human inspection.
 * `.max(10)` is a response bound, not an input bound — it caps nothing that costs
 * money or admits bad input, so widening it (5 → 10, DMS-501) is exactly the trade
 * `full` exists to make. `full` returning ten samples doesn't mean a richer window on
 * a domain that never returned more than a handful — twenty places already yield ten.
 */
export const DomainProfileSchema = DomainRatingSchema.extend({
  samplePois: z.array(PointOfInterestSchema).max(10),
});

export type DomainProfile = z.infer<typeof DomainProfileSchema>;

/**
 * Geoapify credits the call consumed (root Invariant 6: a derived number carries
 * its evidence). `consumed` is the sum of `byDomain`'s values. A domain whose
 * query failed is absent from `byDomain` and contributes nothing; a cache-served
 * domain appears as `0`. Under per-20 Geoapify billing (`ceil(returnedCount / 20)`,
 * restored in `cffa7e5`) a present value ranges `0`–`2` — `2` only when `detail: "full"`
 * opts into the raised `limitPerCategory` ceiling (DMS-501) — but `byDomain` always
 * records which domains were billed, cached, or failed regardless of the value's range.
 * `z.record` over the domain enum infers a partial record.
 */
export const NeighbourhoodCreditsSchema = z.object({
  consumed: z.number().int().min(0),
  byDomain: z.record(NeighbourhoodDomainSchema, z.number().int().min(0)),
});

export type NeighbourhoodCredits = z.infer<typeof NeighbourhoodCreditsSchema>;

/** `brief` location: coordinates are redundant with the request and dropped. */
const BriefLocationSchema = LocationSchema.omit({ coordinates: true }).strict();

const NeighbourhoodProfileFullSchema = z.object({
  detail: z.literal("full"),
  location: LocationSchema,
  radiusM: z.number().int(),
  requestedCategories: z.array(PoiCategorySchema),
  domains: z.record(NeighbourhoodDomainSchema, DomainProfileSchema.nullable()),
  sources: z.record(NeighbourhoodDomainSchema, SourceOutcomeSchema),
  credits: NeighbourhoodCreditsSchema,
});

const NeighbourhoodProfileBriefSchema = z.object({
  detail: z.literal("brief"),
  location: BriefLocationSchema,
  radiusM: z.number().int(),
  requestedCategories: z.array(PoiCategorySchema),
  domains: z.record(NeighbourhoodDomainSchema, DomainRatingSchema.strict().nullable()),
  sources: z.record(NeighbourhoodDomainSchema, SourceOutcomeSchema),
  credits: NeighbourhoodCreditsSchema,
});

/**
 * Neighbourhood character profile keyed by the six analysis domains. Discriminated on
 * `detail` — `full` carries sample POIs, `brief` is a lossy projection that keeps the
 * count/radius/density evidence. `domains[d] === null` iff `sources[d].status ===
 * "unavailable"`. The handler `safeParse`s its own output against this before returning.
 */
export const NeighbourhoodProfileSchema = z.discriminatedUnion("detail", [
  NeighbourhoodProfileFullSchema,
  NeighbourhoodProfileBriefSchema,
]);

export type NeighbourhoodProfile = z.infer<typeof NeighbourhoodProfileSchema>;
export type NeighbourhoodProfileFull = z.infer<typeof NeighbourhoodProfileFullSchema>;
export type NeighbourhoodProfileBrief = z.infer<typeof NeighbourhoodProfileBriefSchema>;
