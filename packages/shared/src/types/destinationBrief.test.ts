import { describe, expect, it } from "vitest";
import { notFound } from "../errors.js";
import { DestinationBriefSchema } from "./destinationBrief.js";

const location = {
  name: "Vienna",
  coordinates: { lat: 48.2082, lon: 16.3738 },
  countryCode: "AT",
} as const;

const stay = { start: "2026-09-08", end: "2026-09-10" } as const;

const fullForecast = {
  coordinates: location.coordinates,
  timezone: "Europe/Vienna",
  units: { temperature: "°C", precipitation: "mm" },
  requestedRange: stay,
  coveredRange: stay,
  truncated: false,
  days: [
    {
      date: "2026-09-08",
      tempMinC: 9,
      tempMaxC: 21,
      precipitationMm: 5,
      weatherCode: 63,
      condition: "rain",
    },
  ],
} as const;

const briefForecast = {
  timezone: "Europe/Vienna",
  units: { temperature: "°C", precipitation: "mm" },
  coveredRange: stay,
  truncated: false,
  days: [{ date: "2026-09-08", tempMinC: 9, tempMaxC: 21, precipitationMm: 5, condition: "rain" }],
} as const;

const okSources = {
  openMeteo: { status: "ok" },
  nager: { status: "ok" },
} as const;

describe("DestinationBriefSchema — full arm", () => {
  it("accepts a complete forecast + holidays + sources object", () => {
    const result = DestinationBriefSchema.safeParse({
      detail: "full",
      location,
      stay,
      forecast: fullForecast,
      holidays: [
        { date: "2026-09-08", name: "Test Day", localName: "Test Tag", countryCode: "AT" },
      ],
      sources: okSources,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an object with neither forecast nor holidays (both optional)", () => {
    const result = DestinationBriefSchema.safeParse({
      detail: "full",
      location,
      stay,
      sources: {
        openMeteo: { status: "unavailable", error: notFound("no forecast") },
        nager: { status: "unavailable", error: notFound("no holidays") },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("DestinationBriefSchema — brief arm", () => {
  it("accepts a projected brief object", () => {
    const result = DestinationBriefSchema.safeParse({
      detail: "brief",
      location,
      stay,
      forecast: briefForecast,
      holidays: [{ date: "2026-09-08", name: "Test Day", localName: "Test Tag" }],
      sources: okSources,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a brief forecast that still carries coordinates", () => {
    const result = DestinationBriefSchema.safeParse({
      detail: "brief",
      location,
      stay,
      forecast: { ...briefForecast, coordinates: location.coordinates },
      sources: okSources,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a brief forecast whose days still carry weatherCode", () => {
    const result = DestinationBriefSchema.safeParse({
      detail: "brief",
      location,
      stay,
      forecast: {
        ...briefForecast,
        days: [{ ...briefForecast.days[0], weatherCode: 63 }],
      },
      sources: okSources,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a brief holiday that still carries countryCode", () => {
    const result = DestinationBriefSchema.safeParse({
      detail: "brief",
      location,
      stay,
      holidays: [
        { date: "2026-09-08", name: "Test Day", localName: "Test Tag", countryCode: "AT" },
      ],
      sources: okSources,
    });
    expect(result.success).toBe(false);
  });
});

describe("DestinationBriefSchema — sources.*.error", () => {
  it("accepts a real ToolError", () => {
    const result = DestinationBriefSchema.safeParse({
      detail: "full",
      location,
      stay,
      holidays: [],
      sources: {
        openMeteo: { status: "unavailable", error: notFound("Open-Meteo horizon exceeded") },
        nager: { status: "ok" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bare object that is not a ToolError", () => {
    const result = DestinationBriefSchema.safeParse({
      detail: "full",
      location,
      stay,
      sources: {
        openMeteo: { status: "unavailable", error: { foo: 1 } },
        nager: { status: "ok" },
      },
    });
    expect(result.success).toBe(false);
  });
});
