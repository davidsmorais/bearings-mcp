import { z } from "zod";
import { LocationSchema } from "./location.js";

/**
 * Coarse place classification, mapped from Nominatim's `addresstype` at the
 * upstream boundary. `"other"` is the explicit catch-all for anything unmapped,
 * mirroring the "z.enum for wire values" precedent set by `PoiCategory`.
 */
export const PlaceKindSchema = z.enum([
  "city",
  "town",
  "village",
  "suburb",
  "locality",
  "airport",
  "region",
  "country",
  "other",
]);

export type PlaceKind = z.infer<typeof PlaceKindSchema>;

/**
 * A resolved geocoding hit. `LocationSchema.extend(...)` keeps it structurally a
 * `Location`, so it stays assignable wherever the downstream tools accept one; the
 * extra fields are the enrichment `resolve_destination` returns and the lean input
 * type never needs to carry.
 */
export const ResolvedLocationSchema = LocationSchema.extend({
  // Always an object so callers can read `admin.state` without a presence guard;
  // its individual fields are optional because Nominatim supplies them unevenly.
  admin: z.object({
    state: z.string().min(1).optional(),
    county: z.string().min(1).optional(),
    municipality: z.string().min(1).optional(),
  }),
  kind: PlaceKindSchema.optional(),
  importance: z.number().min(0).max(1).optional(),
  /** Nominatim `place_rank`, 0–30 (lower is a broader feature). */
  placeRank: z.number().int().min(0).max(30).optional(),
  /** `[south, north, west, east]` — latitudes then longitudes. */
  boundingBox: z
    .tuple([
      z.number().min(-90).max(90),
      z.number().min(-90).max(90),
      z.number().min(-180).max(180),
      z.number().min(-180).max(180),
    ])
    .optional(),
  osmType: z.enum(["node", "way", "relation"]).optional(),
  osmId: z.number().int().optional(),
});

export type ResolvedLocation = z.infer<typeof ResolvedLocationSchema>;

/** One disambiguation option: the resolved place plus the signals an agent ranks on. */
export const LocationCandidateSchema = z.object({
  location: ResolvedLocationSchema,
  importance: z.number().min(0).max(1),
  kind: PlaceKindSchema,
});

export type LocationCandidate = z.infer<typeof LocationCandidateSchema>;
