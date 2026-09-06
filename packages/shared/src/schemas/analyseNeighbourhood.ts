import { z } from "zod";
import { CoordinatesSchema } from "../types/coordinates.js";
import { PoiCategorySchema } from "../types/poiCategory.js";

const ALL_POI_CATEGORIES = [
  "dining",
  "cafes",
  "nightlife",
  "groceries",
  "transit",
  "parks",
  "culture",
] as const;

/** Input for POI density analysis around a coordinate. */
export const AnalyseNeighbourhoodInputSchema = z
  .object({
    coordinates: CoordinatesSchema,
    radiusM: z
      .number()
      .int()
      .min(100)
      .max(5000)
      .default(500)
      .describe("Search radius in metres around the coordinates"),
    categories: z
      .array(PoiCategorySchema)
      .min(1)
      .max(7)
      .default([...ALL_POI_CATEGORIES])
      .describe("POI categories to include in the neighbourhood profile"),
    // Geoapify bills 1 credit per 20 places, so this is a cost lever, not a page size.
    limitPerCategory: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum places to fetch per category"),
    detail: z.enum(["brief", "full"]).default("brief"),
  })
  .refine(
    (data) => new Set(data.categories).size === data.categories.length,
    (data) => ({
      message: `categories must contain unique values, received [${data.categories.join(", ")}]`,
      path: ["categories"],
    }),
  );

export type AnalyseNeighbourhoodInput = z.infer<typeof AnalyseNeighbourhoodInputSchema>;
