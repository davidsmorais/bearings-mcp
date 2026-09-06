import { z } from "zod";
import { CoordinatesSchema } from "./coordinates.js";

export const LocationSchema = z.object({
  name: z.string().min(1),
  coordinates: CoordinatesSchema,
  countryCode: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/),
  displayName: z.string().min(1).optional(),
});

export type Location = z.infer<typeof LocationSchema>;
