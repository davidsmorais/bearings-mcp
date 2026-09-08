import { z } from "zod";

/**
 * The six neighbourhood-character domains a profile is keyed by. This is an
 * analysis-layer grouping of the seven `PoiCategory` input values, not a second
 * input vocabulary — it is output-only and deliberately absent from
 * `toolInputSchemas`. The 7→6 fold lives in
 * `packages/server/src/analysis/categoryAdapter.ts` (`DOMAIN_MEMBERS`).
 */
export const NeighbourhoodDomainSchema = z.enum([
  "nightlife",
  "dining",
  "transit",
  "greenSpace",
  "retail",
  "culture",
]);

export type NeighbourhoodDomain = z.infer<typeof NeighbourhoodDomainSchema>;
