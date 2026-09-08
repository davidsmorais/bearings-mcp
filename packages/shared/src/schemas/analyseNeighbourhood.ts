import { z } from "zod";
import { CoordinatesSchema } from "../types/coordinates.js";
import { PoiCategorySchema } from "../types/poiCategory.js";

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
    // Bounds and default are derived from PoiCategorySchema.options rather than repeated
    // here — adding a category to that enum must not silently exclude it from either.
    categories: z
      .array(PoiCategorySchema)
      .min(1)
      .max(PoiCategorySchema.options.length)
      .default([...PoiCategorySchema.options])
      .describe("POI categories to include in the neighbourhood profile"),
    // Geoapify bills 1 credit per 20 places, so this is a cost lever, not a page size.
    // Capped at 20 (one credit bucket per domain) — a higher ceiling is a deliberate
    // per-caller decision that needs its own sign-off, not the default path.
    limitPerCategory: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(20)
      .describe("Maximum places to fetch per category (max 20 = one Geoapify credit per domain)"),
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
