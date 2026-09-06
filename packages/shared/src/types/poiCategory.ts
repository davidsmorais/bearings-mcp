import { z } from "zod";

export const PoiCategorySchema = z.enum([
  "dining",
  "cafes",
  "nightlife",
  "groceries",
  "transit",
  "parks",
  "culture",
]);

export type PoiCategory = z.infer<typeof PoiCategorySchema>;
