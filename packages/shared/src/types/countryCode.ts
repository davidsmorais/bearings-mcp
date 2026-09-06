import { z } from "zod";

/** ISO 3166-1 alpha-2 country code, upper-case. Shared by `Location` and any tool that biases by country. */
export const CountryCodeSchema = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/);

export type CountryCode = z.infer<typeof CountryCodeSchema>;
