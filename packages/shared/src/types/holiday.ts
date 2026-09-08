import { z } from "zod";
import { CountryCodeSchema } from "./countryCode.js";

/**
 * A single public holiday, normalised from an upstream calendar provider.
 * Deliberately minimal: a booking agent needs the date and both names to reason
 * about closures and pricing — nationwide-vs-regional scope is not modelled here.
 */
export const HolidaySchema = z.object({
  date: z.string().date(),
  name: z.string().min(1),
  localName: z.string().min(1),
  countryCode: CountryCodeSchema,
});

export type Holiday = z.infer<typeof HolidaySchema>;
