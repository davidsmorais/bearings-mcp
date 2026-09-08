import { isToolError, ToolErrorCode } from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpCore } from "../../src/http/client.js";
import { fetchForecast } from "../../src/upstream/openMeteo.js";
import openMeteoFixture from "../fixtures/open-meteo.json";

const instantClock = { now: () => 0, sleep: async () => {} };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const coreReturning = (body: unknown, status = 200) => {
  const fetch = vi.fn(async (_input: unknown, _init?: unknown) => jsonResponse(body, status));
  return { fetch, core: createHttpCore({ fetch, clock: instantClock }) };
};

const at = (isoDate: string) => () => new Date(`${isoDate}T12:00:00Z`);

const addDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A minimal Open-Meteo-shaped payload with flat hourly values across a range. */
const synthPayload = (
  start: string,
  end: string,
  opts: { code?: number; temp?: number; precip?: number } = {},
) => {
  const { code = 1, temp = 15, precip = 0 } = opts;
  const time: string[] = [];
  const temperature_2m: number[] = [];
  const precipitation: number[] = [];
  const weather_code: number[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    for (let hour = 0; hour < 24; hour += 1) {
      time.push(`${date}T${String(hour).padStart(2, "0")}:00`);
      temperature_2m.push(temp);
      precipitation.push(precip);
      weather_code.push(code);
    }
  }
  return {
    latitude: 1,
    longitude: 1,
    timezone: "UTC",
    hourly_units: { temperature_2m: "°C", precipitation: "mm" },
    hourly: { time, temperature_2m, precipitation, weather_code },
  };
};

const PARIS = { lat: 48.85, lon: 2.35 };
const FIXTURE_RANGE = { start: "2026-09-08", end: "2026-09-10" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchForecast — normalisation", () => {
  it("collapses the hourly fixture into one summary per day", async () => {
    const { core } = coreReturning(openMeteoFixture);

    const result = await fetchForecast(PARIS, FIXTURE_RANGE, { core, now: at("2026-09-08") });

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;

    expect(result.timezone).toBe("Europe/Paris");
    expect(result.coordinates).toEqual(PARIS);
    expect(result.units).toEqual({ temperature: "°C", precipitation: "mm" });
    expect(result.truncated).toBe(false);
    expect(result.coveredRange).toEqual(FIXTURE_RANGE);
    expect(result.days).toEqual([
      {
        date: "2026-09-08",
        tempMinC: 9,
        tempMaxC: 21,
        precipitationMm: 5,
        weatherCode: 63,
        condition: "rain",
      },
      {
        date: "2026-09-09",
        tempMinC: 12,
        tempMaxC: 28,
        precipitationMm: 0,
        weatherCode: 0,
        condition: "clear",
      },
      {
        date: "2026-09-10",
        tempMinC: 14,
        tempMaxC: 28,
        precipitationMm: 16.8,
        weatherCode: 95,
        condition: "thunderstorm",
      },
    ]);
  });

  it("never lets a raw hourly array reach the response", async () => {
    const { core } = coreReturning(openMeteoFixture);

    const result = await fetchForecast(PARIS, FIXTURE_RANGE, { core, now: at("2026-09-08") });

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("temperature_2m");
    expect(serialised).not.toContain("hourly");
  });

  it("picks the headline condition from daytime hours by frequency", async () => {
    // 6 daytime hours of light rain (61), 8 daytime hours of overcast (3):
    // overcast is the daytime mode even though rain looks more 'significant'.
    const time: string[] = [];
    const weather_code: number[] = [];
    const temperature_2m: number[] = [];
    const precipitation: number[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      time.push(`2026-09-08T${String(hour).padStart(2, "0")}:00`);
      temperature_2m.push(10);
      precipitation.push(0);
      weather_code.push(hour >= 8 && hour < 14 ? 61 : 3);
    }
    const { core } = coreReturning({
      latitude: 1,
      longitude: 1,
      timezone: "UTC",
      hourly_units: { temperature_2m: "°C", precipitation: "mm" },
      hourly: { time, temperature_2m, precipitation, weather_code },
    });

    const result = await fetchForecast(
      PARIS,
      { start: "2026-09-08", end: "2026-09-08" },
      {
        core,
        now: at("2026-09-08"),
      },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.days[0].condition).toBe("overcast");
    expect(result.days[0].weatherCode).toBe(3);
  });

  it("rounds the coordinate sent upstream and keeps it out of the cache key", async () => {
    const { core, fetch } = coreReturning(openMeteoFixture);

    await fetchForecast({ lat: 48.8501234, lon: 2.3512345 }, FIXTURE_RANGE, {
      core,
      now: at("2026-09-08"),
    });

    const url = fetch.mock.calls[0]?.[0] as unknown as URL;
    expect(url.searchParams.get("latitude")).toBe("48.8501");
    expect(url.searchParams.get("longitude")).toBe("2.3512");
  });
});

describe("fetchForecast — forecast horizon", () => {
  it("rejects a range that lies entirely beyond the horizon", async () => {
    const { core, fetch } = coreReturning(openMeteoFixture);

    const result = await fetchForecast(
      PARIS,
      { start: "2026-10-01", end: "2026-10-05" },
      { core, now: at("2026-09-08") },
    );

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.NOT_FOUND);
    expect(result.message).toContain("2026-09-23");
    expect(result.message).toContain("beyond");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a range that lies entirely in the past", async () => {
    const { core, fetch } = coreReturning(openMeteoFixture);

    const result = await fetchForecast(
      PARIS,
      { start: "2026-09-01", end: "2026-09-05" },
      { core, now: at("2026-09-08") },
    );

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.NOT_FOUND);
    expect(result.message).toContain("past");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clamps a range that partly exceeds the horizon and flags it", async () => {
    const today = "2026-09-08";
    const horizonEnd = addDays(today, 15);
    const { core } = coreReturning(synthPayload(today, horizonEnd, { code: 2, temp: 17 }));

    const result = await fetchForecast(
      PARIS,
      { start: today, end: "2026-09-30" },
      { core, now: at(today) },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toContain("horizon");
    expect(result.requestedRange).toEqual({ start: today, end: "2026-09-30" });
    expect(result.coveredRange).toEqual({ start: today, end: horizonEnd });
    expect(result.days).toHaveLength(16);
    expect(result.days.at(-1)?.date).toBe(horizonEnd);
  });

  it("clamps a range whose start is in the past", async () => {
    const today = "2026-09-10";
    const { core } = coreReturning(synthPayload(today, "2026-09-12", { code: 1 }));

    const result = await fetchForecast(
      PARIS,
      { start: "2026-09-08", end: "2026-09-12" },
      { core, now: at(today) },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toContain("past");
    expect(result.coveredRange).toEqual({ start: today, end: "2026-09-12" });
    expect(result.days.map((day) => day.date)).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
  });
});

describe("fetchForecast — upstream failures", () => {
  it("propagates an HTTP-core error unchanged", async () => {
    const { core } = coreReturning({ error: true, reason: "boom" }, 500);

    const result = await fetchForecast(PARIS, FIXTURE_RANGE, { core, now: at("2026-09-08") });

    expect(isToolError(result)).toBe(true);
  });

  it("reports a response missing its hourly series as an internal error", async () => {
    const { core } = coreReturning({ latitude: 1, longitude: 1, timezone: "UTC" });

    const result = await fetchForecast(PARIS, FIXTURE_RANGE, { core, now: at("2026-09-08") });

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
  });

  it("rejects a response whose units are not the ones requested", async () => {
    const payload = synthPayload("2026-09-08", "2026-09-10");
    payload.hourly_units.temperature_2m = "°F";
    const { core } = coreReturning(payload);

    const result = await fetchForecast(PARIS, FIXTURE_RANGE, { core, now: at("2026-09-08") });

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
    expect(result.message).toContain("°F");
  });
});
