import { z } from "zod";

/** Geographic coordinates shared by MCP tools and the React inspector. */
export const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export type Coordinates = z.infer<typeof CoordinatesSchema>;
