import { z } from "zod";

/** Input for resolving a fuzzy place name into a structured Location. */
export const ResolveDestinationInputSchema = z.object({
  query: z
    .string()
    .min(2)
    .max(200)
    .describe("Place name or address to resolve into a structured location"),
  countryCode: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .optional()
    .describe("ISO 3166-1 alpha-2 country code to bias geocoding results"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("Maximum number of location candidates to return"),
  detail: z.enum(["brief", "full"]).default("brief"),
});

export type ResolveDestinationInput = z.infer<typeof ResolveDestinationInputSchema>;
