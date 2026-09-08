import { z } from "zod";
import { CoordinatesSchema } from "./coordinates.js";
import { TimeWindowSchema } from "./timeWindow.js";

/**
 * Readable weather conditions, mapped from WMO weather-interpretation codes.
 * The upstream `weatherCode` travels alongside so a caller can be more precise
 * than the bucket if it needs to (Root Invariant 6: derived values carry evidence).
 */
export const WeatherConditionSchema = z.enum([
  "clear",
  "partly-cloudy",
  "overcast",
  "fog",
  "drizzle",
  "rain",
  "rain-showers",
  "snow",
  "snow-showers",
  "thunderstorm",
]);

export type WeatherCondition = z.infer<typeof WeatherConditionSchema>;

/** One day of forecast, aggregated from Open-Meteo's hourly series. */
export const DailyForecastSchema = z.object({
  date: z.string().date(),
  tempMinC: z.number(),
  tempMaxC: z.number(),
  precipitationMm: z.number().min(0),
  /** WMO weather-interpretation code the headline `condition` was mapped from. */
  weatherCode: z.number().int().min(0).max(99),
  condition: WeatherConditionSchema,
});

export type DailyForecast = z.infer<typeof DailyForecastSchema>;

/**
 * Normalised forecast for a coordinate over a date range. Hourly arrays are
 * collapsed to daily summaries before they ever reach a tool response, and every
 * number carries its unit in `units` — no bare values.
 */
export const ForecastSchema = z.object({
  coordinates: CoordinatesSchema,
  /** IANA zone the daily buckets are cut on (from Open-Meteo `timezone=auto`). */
  timezone: z.string().min(1),
  units: z.object({
    temperature: z.literal("°C"),
    precipitation: z.literal("mm"),
  }),
  /** The range the caller asked for. */
  requestedRange: TimeWindowSchema,
  /** The range actually covered — narrower than requested when clamped. */
  coveredRange: TimeWindowSchema,
  /** True when `coveredRange` is narrower than `requestedRange`. */
  truncated: z.boolean(),
  /** Plain-language reason for the clamp, present only when `truncated`. */
  truncationReason: z.string().optional(),
  days: z.array(DailyForecastSchema).min(1),
});

export type Forecast = z.infer<typeof ForecastSchema>;
