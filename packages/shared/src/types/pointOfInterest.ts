import { z } from "zod";
import { CoordinatesSchema } from "./coordinates.js";
import { PoiCategorySchema } from "./poiCategory.js";

/** A normalised place of interest returned by upstream POI clients. */
export const PointOfInterestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  coordinates: CoordinatesSchema,
  category: PoiCategorySchema,
  address: z.string().min(1).optional(),
  distanceM: z.number().nonnegative().optional(),
});

export type PointOfInterest = z.infer<typeof PointOfInterestSchema>;
