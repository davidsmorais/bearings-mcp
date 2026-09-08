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
    // Geoapify bills ceil(places / 20), so every limit from 1 to 20 costs exactly one
    // credit — lowering it saves nothing. The only value that changes spend is one
    // above 20, which is why this knob is gated by `detail` below rather than derived
    // from it: `brief` stays capped at the one-credit ceiling, `full` may opt into a
    // second credit bucket (40 places) for a higher honest-count ceiling. The default
    // stays 20 for both so nobody spends double by accident.
    limitPerCategory: z
      .number()
      .int()
      .min(1)
      .max(40)
      .default(20)
      .describe(
        "Maximum places to fetch per category (20 = one Geoapify credit per domain, " +
          "up to 40 = two credits when detail is full)",
      ),
    detail: z.enum(["brief", "full"]).default("brief"),
  })
  .refine(
    (data) => new Set(data.categories).size === data.categories.length,
    (data) => ({
      message: `categories must contain unique values, received [${data.categories.join(", ")}]`,
      path: ["categories"],
    }),
  )
  .refine(
    (data) => !(data.detail === "brief" && data.limitPerCategory > 20),
    (data) => ({
      message:
        `limitPerCategory must be 20 or less when detail is brief (received ` +
        `${data.limitPerCategory}); use detail: "full" to fetch up to 40 places per ` +
        `domain at 2 credits`,
      path: ["limitPerCategory"],
    }),
  );

export type AnalyseNeighbourhoodInput = z.infer<typeof AnalyseNeighbourhoodInputSchema>;
