import { z } from "zod";
import { LocationSchema } from "../types/location.js";
import { TimeWindowSchema } from "../types/timeWindow.js";

/** Input for a stay forecast and public-holiday brief at a resolved location. */
export const GetDestinationBriefInputSchema = z.object({
  location: LocationSchema,
  stay: TimeWindowSchema,
  detail: z.enum(["brief", "full"]).default("brief"),
});

export type GetDestinationBriefInput = z.infer<typeof GetDestinationBriefInputSchema>;
