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
 * Every field is required — a rating without its count or radius must fail validation.
 */
export const DomainRatingSchema = z.object({
  rating: z.enum(RATING_LEVELS),
  count: z.number().int().min(0),
  radiusM: z.number().int(),
  densityPerKm2: z.number().min(0),
  countCapped: z.boolean(),
  rings: z.array(RingCountSchema).min(1),
});

export type DomainRating = z.infer<typeof DomainRatingSchema>;

/** Full domain profile: the rating evidence plus sample POIs for human inspection. */
export const DomainProfileSchema = DomainRatingSchema.extend({
  samplePois: z.array(PointOfInterestSchema).max(5),
});

export type DomainProfile = z.infer<typeof DomainProfileSchema>;

/**
 * Geoapify credits the call consumed (root Invariant 6: a derived number carries
 * its evidence). `consumed` is the sum of `byDomain`'s values. A domain whose
 * query failed is absent from `byDomain` and contributes nothing; a cache-served
 * domain appears as `0`. Under per-request Geoapify billing every present value
 * is `0` or `1`, but `byDomain` still records which domains were billed, cached,
 * or failed. `z.record` over the domain enum infers a partial record.
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
