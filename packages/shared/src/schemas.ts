import { z } from "zod";

/** Geographic coordinates shared by MCP tools and the React inspector. */
export const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export type Coordinates = z.infer<typeof CoordinatesSchema>;

export const PlaceSchema = z.object({
  name: z.string().min(1),
  coordinates: CoordinatesSchema,
  countryCode: z.string().length(2).optional(),
});

export type Place = z.infer<typeof PlaceSchema>;

/** Input for the `echo` diagnostic tool — proves registry-to-transport wiring end to end. */
export const EchoInputSchema = z.object({
  message: z.string().min(1).max(1000),
});

export type EchoInput = z.infer<typeof EchoInputSchema>;
