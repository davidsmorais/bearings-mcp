import { z } from "zod";
import { CoordinatesSchema } from "./coordinates.js";
import { CountryCodeSchema } from "./countryCode.js";

export const LocationSchema = z.object({
  name: z.string().min(1),
  coordinates: CoordinatesSchema,
  countryCode: CountryCodeSchema,
  displayName: z.string().min(1).optional(),
});

export type Location = z.infer<typeof LocationSchema>;
