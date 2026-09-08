import { z } from "zod";
import { isToolError, type ToolError } from "../errors.js";
import { DailyForecastSchema, ForecastSchema } from "./forecast.js";
import { HolidaySchema } from "./holiday.js";
import { LocationSchema } from "./location.js";
import { TimeWindowSchema } from "./timeWindow.js";

/** Per-upstream health, reported in a destination brief's `sources` block. */
export const SourceStatusSchema = z.enum(["ok", "partial", "unavailable"]);

export type SourceStatus = z.infer<typeof SourceStatusSchema>;

/**
 * Outcome of one upstream fetch. `note` explains a `partial` result or a clamp;
 * `error` carries the actual `ToolError` when the upstream was `unavailable` so an
 * agent can act on it (root Invariant 6: derived values carry their evidence).
 *
 * `error` is validated with the structural `isToolError` guard rather than a full
 * Zod mirror of the `ToolError` union — that union is nine variants and a parallel
 * schema would be a drift trap for a shape that is never parsed off the wire.
 */
export const SourceOutcomeSchema = z.object({
  status: SourceStatusSchema,
  note: z.string().optional(),
  error: z.custom<ToolError>((value) => isToolError(value)).optional(),
});

export type SourceOutcome = z.infer<typeof SourceOutcomeSchema>;

export const SourcesSchema = z.object({
  openMeteo: SourceOutcomeSchema,
  nager: SourceOutcomeSchema,
});

export type Sources = z.infer<typeof SourcesSchema>;

/** A forecast day with the raw WMO `weatherCode` dropped — `condition` carries the brief. */
const BriefDailyForecastSchema = DailyForecastSchema.omit({ weatherCode: true }).strict();

/**
 * `brief` forecast: the echo fields (`coordinates`, `requestedRange`) and each day's
 * raw `weatherCode` are gone. `.strict()` so a projection that forgets to drop one of
 * them fails validation instead of quietly passing it through.
 */
export const BriefForecastSchema = ForecastSchema.omit({
  coordinates: true,
  requestedRange: true,
  days: true,
})
  .extend({ days: z.array(BriefDailyForecastSchema).min(1) })
  .strict();

export type BriefForecast = z.infer<typeof BriefForecastSchema>;

/** `brief` holiday: `countryCode` is redundant with `location.countryCode`. */
export const BriefHolidaySchema = HolidaySchema.omit({ countryCode: true }).strict();

export type BriefHoliday = z.infer<typeof BriefHolidaySchema>;

const DestinationBriefFullSchema = z.object({
  detail: z.literal("full"),
  location: LocationSchema,
  stay: TimeWindowSchema,
  forecast: ForecastSchema.optional(),
  holidays: z.array(HolidaySchema).optional(),
  sources: SourcesSchema,
});

const DestinationBriefBriefSchema = z.object({
  detail: z.literal("brief"),
  location: LocationSchema,
  stay: TimeWindowSchema,
  forecast: BriefForecastSchema.optional(),
  holidays: z.array(BriefHolidaySchema).optional(),
  sources: SourcesSchema,
});

/**
 * A composed brief for a stay: forecast + public holidays + a per-upstream `sources`
 * block. Discriminated on `detail` — `full` echoes every evidence field, `brief` is a
 * lossy projection of the same data. Either side may be absent when its upstream failed;
 * `sources` says which. The handler `safeParse`s its own output against this before
 * returning, the way the upstream clients self-check their normalised shapes.
 */
export const DestinationBriefSchema = z.discriminatedUnion("detail", [
  DestinationBriefFullSchema,
  DestinationBriefBriefSchema,
]);

export type DestinationBrief = z.infer<typeof DestinationBriefSchema>;
export type DestinationBriefFull = z.infer<typeof DestinationBriefFullSchema>;
export type DestinationBriefBrief = z.infer<typeof DestinationBriefBriefSchema>;
