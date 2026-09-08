import { describe, expect, it } from "vitest";
import { DailyForecastSchema, ForecastSchema, WeatherConditionSchema } from "./forecast.js";

const validDay = {
  date: "2026-09-08",
  tempMinC: 9,
  tempMaxC: 21,
  precipitationMm: 5,
  weatherCode: 63,
  condition: "rain",
} as const;

const validForecast = {
  coordinates: { lat: 48.85, lon: 2.35 },
  timezone: "Europe/Paris",
  units: { temperature: "°C", precipitation: "mm" },
  requestedRange: { start: "2026-09-08", end: "2026-09-10" },
  coveredRange: { start: "2026-09-08", end: "2026-09-10" },
  truncated: false,
  days: [validDay],
} as const;

describe("WeatherConditionSchema", () => {
  it("accepts a known condition", () => {
    expect(WeatherConditionSchema.safeParse("thunderstorm").success).toBe(true);
  });

  it("rejects an ad-hoc string", () => {
    expect(WeatherConditionSchema.safeParse("drizzly").success).toBe(false);
  });
});

describe("DailyForecastSchema", () => {
  it("parses a well-formed day", () => {
    expect(DailyForecastSchema.safeParse(validDay).success).toBe(true);
  });

  it("rejects negative precipitation", () => {
    const result = DailyForecastSchema.safeParse({ ...validDay, precipitationMm: -0.1 });
    expect(result.success).toBe(false);
  });

  it("rejects a weather code outside the WMO range", () => {
    expect(DailyForecastSchema.safeParse({ ...validDay, weatherCode: 120 }).success).toBe(false);
  });

  it("rejects a non-date `date`", () => {
    expect(DailyForecastSchema.safeParse({ ...validDay, date: "08-09-2026" }).success).toBe(false);
  });
});

describe("ForecastSchema", () => {
  it("parses a well-formed forecast", () => {
    expect(ForecastSchema.safeParse(validForecast).success).toBe(true);
  });

  it("requires at least one day (a bare empty forecast is not valid)", () => {
    const result = ForecastSchema.safeParse({ ...validForecast, days: [] });
    expect(result.success).toBe(false);
  });

  it("pins the units to the normalised values", () => {
    const result = ForecastSchema.safeParse({
      ...validForecast,
      units: { temperature: "F", precipitation: "in" },
    });
    expect(result.success).toBe(false);
  });

  it("carries an optional truncation reason", () => {
    const result = ForecastSchema.safeParse({
      ...validForecast,
      truncated: true,
      truncationReason: "requested end is beyond the forecast horizon",
    });
    expect(result.success).toBe(true);
  });
});
