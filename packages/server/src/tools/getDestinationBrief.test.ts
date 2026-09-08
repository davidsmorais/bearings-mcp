import {
  DestinationBriefSchema,
  GetDestinationBriefInputSchema,
  isToolError,
  ToolErrorCode,
} from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import nagerFixture from "../../test/fixtures/nager.json";
import openMeteoFixture from "../../test/fixtures/open-meteo.json";
import { createHttpCore, type HttpCore } from "../http/client.js";
import { composeDestinationBrief } from "./getDestinationBrief.js";

const instantClock = { now: () => 0, sleep: async () => {} };

const at = (isoDate: string) => () => new Date(`${isoDate}T12:00:00Z`);

const addDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A flat Open-Meteo-shaped hourly payload across a date range. */
const synthForecast = (start: string, end: string, code = 1) => {
  const time: string[] = [];
  const temperature_2m: number[] = [];
  const precipitation: number[] = [];
  const weather_code: number[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    for (let hour = 0; hour < 24; hour += 1) {
      time.push(`${date}T${String(hour).padStart(2, "0")}:00`);
      temperature_2m.push(15);
      precipitation.push(0);
      weather_code.push(code);
    }
  }
  return {
    latitude: 48.21,
    longitude: 16.37,
    timezone: "Europe/Vienna",
    hourly_units: { temperature_2m: "°C", precipitation: "mm" },
    hourly: { time, temperature_2m, precipitation, weather_code },
  };
};

interface HostHandlers {
  openMeteo?: (url: URL) => Response | Promise<Response>;
  nager?: (url: URL) => Response | Promise<Response>;
}

/** One scripted fetch for both clients, keyed by hostname (not full path). */
const routerFetch = (handlers: HostHandlers) =>
  vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    if (url.hostname === "api.open-meteo.com") {
      if (handlers.openMeteo === undefined) throw new Error("unexpected Open-Meteo request");
      return handlers.openMeteo(url);
    }
    if (url.hostname === "date.nager.at") {
      if (handlers.nager === undefined) throw new Error("unexpected Nager.Date request");
      return handlers.nager(url);
    }
    throw new Error(`unexpected host ${url.hostname}`);
  });

/** Serves the captured Nager response for whichever year is in the request path. */
const nagerYears =
  (byYear: Record<string, () => Response>) =>
  (url: URL): Response => {
    for (const [year, make] of Object.entries(byYear)) {
      if (url.pathname.includes(`/${year}/`)) return make();
    }
    return new Response("not found", { status: 404 });
  };

const baseInput = {
  location: { name: "Vienna", coordinates: { lat: 48.2082, lon: 16.3738 }, countryCode: "AT" },
  stay: { start: "2026-09-08", end: "2026-09-10" },
};

const buildInput = (overrides: Record<string, unknown> = {}) =>
  GetDestinationBriefInputSchema.parse({ ...baseInput, ...overrides });

const coreWith = (handlers: HostHandlers) => {
  const fetch = routerFetch(handlers);
  return { fetch, core: createHttpCore({ fetch, clock: instantClock }) };
};

/** A core that throws for one host (a genuine client bug) and delegates the other. */
const throwingCore = (delegate: HttpCore, throwHost: "open-meteo" | "nager"): HttpCore => ({
  request(hostId, path, params, opts) {
    if (hostId === throwHost) {
      throw new Error(`${hostId} client threw`);
    }
    return delegate.request(hostId, path, params, opts);
  },
});

const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("composeDestinationBrief — fan-out", () => {
  it("dispatches both upstream requests before either resolves", async () => {
    const forecastCall = deferred<Response>();
    const holidayCall = deferred<Response>();
    const { fetch, core } = coreWith({
      openMeteo: () => forecastCall.promise,
      nager: () => holidayCall.promise,
    });

    const pending = composeDestinationBrief(buildInput(), { core, now: at("2026-09-08") });
    await tick();

    expect(fetch).toHaveBeenCalledTimes(2);
    const hosts = fetch.mock.calls.map((call) => new URL(String(call[0])).hostname).sort();
    expect(hosts).toEqual(["api.open-meteo.com", "date.nager.at"]);

    // Resolve out of dispatch order — the result must still carry both sides.
    holidayCall.resolve(jsonResponse(nagerFixture.publicHolidays2026AT));
    forecastCall.resolve(jsonResponse(openMeteoFixture));

    const result = await pending;
    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.forecast).toBeDefined();
    expect(result.holidays).toBeDefined();
  });
});

describe("composeDestinationBrief — happy path", () => {
  it("returns both sides with sources ok when both upstreams succeed", async () => {
    const { core } = coreWith({
      openMeteo: () => jsonResponse(synthForecast("2026-10-24", "2026-10-27")),
      nager: nagerYears({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    });

    const result = await composeDestinationBrief(
      buildInput({ stay: { start: "2026-10-24", end: "2026-10-27" }, detail: "full" }),
      { core, now: at("2026-10-20") },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.detail).toBe("full");
    expect(result.forecast?.days).toHaveLength(4);
    expect(result.holidays?.map((holiday) => holiday.date)).toEqual(["2026-10-26"]);
    expect(result.sources.openMeteo.status).toBe("ok");
    expect(result.sources.nager.status).toBe("ok");
    expect(DestinationBriefSchema.safeParse(result).success).toBe(true);
  });
});

describe("composeDestinationBrief — one upstream down", () => {
  it("still returns holidays when the forecast fetch fails", async () => {
    const { core } = coreWith({
      openMeteo: () => new Response("boom", { status: 500 }),
      nager: nagerYears({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    });

    const result = await composeDestinationBrief(buildInput(), { core, now: at("2026-09-08") });

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.forecast).toBeUndefined();
    expect(result.sources.openMeteo.status).toBe("unavailable");
    expect(isToolError(result.sources.openMeteo.error)).toBe(true);
    expect(result.holidays).toBeDefined();
    expect(result.sources.nager.status).toBe("ok");
  });

  it("maps a client that throws (not returns) to an unavailable source and keeps the other side", async () => {
    const { core: delegate } = coreWith({
      nager: nagerYears({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    });
    const core = throwingCore(delegate, "open-meteo");

    const result = await composeDestinationBrief(buildInput(), { core, now: at("2026-09-08") });

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.forecast).toBeUndefined();
    expect(result.sources.openMeteo.status).toBe("unavailable");
    expect(result.sources.openMeteo.error?.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
    expect(result.sources.openMeteo.error?.message).toContain("threw");
    expect(result.holidays).toBeDefined();
    expect(result.sources.nager.status).toBe("ok");
  });

  it("still returns the forecast when the holiday fetch fails", async () => {
    const { core } = coreWith({
      openMeteo: () => jsonResponse(openMeteoFixture),
      nager: () => new Response("boom", { status: 500 }),
    });

    const result = await composeDestinationBrief(buildInput(), { core, now: at("2026-09-08") });

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.holidays).toBeUndefined();
    expect(result.sources.nager.status).toBe("unavailable");
    expect(isToolError(result.sources.nager.error)).toBe(true);
    expect(result.forecast).toBeDefined();
    expect(result.sources.openMeteo.status).toBe("ok");
  });

  it("reports the forecast unavailable when the whole stay is past the horizon", async () => {
    // The common case: a 30-night stay booked weeks out — the forecast horizon is 16 days,
    // so weather is legitimately NOT_FOUND while holidays are still answerable.
    const { core } = coreWith({
      nager: nagerYears({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    });

    const result = await composeDestinationBrief(
      buildInput({ stay: { start: "2026-11-01", end: "2026-11-28" } }),
      { core, now: at("2026-09-08") },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.forecast).toBeUndefined();
    expect(result.sources.openMeteo.status).toBe("unavailable");
    expect(result.sources.openMeteo.error?.code).toBe(ToolErrorCode.NOT_FOUND);
    expect(result.holidays?.map((holiday) => holiday.date)).toContain("2026-11-01");
    expect(result.sources.nager.status).toBe("ok");
  });
});

describe("composeDestinationBrief — holiday nuances", () => {
  it("returns holidays: [] with status ok when no holiday falls in the window", async () => {
    const { core } = coreWith({
      openMeteo: () => jsonResponse(openMeteoFixture),
      nager: nagerYears({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    });

    const result = await composeDestinationBrief(buildInput(), { core, now: at("2026-09-08") });

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.holidays).toEqual([]);
    expect(result.sources.nager.status).toBe("ok");
  });

  it("marks nager partial with a note when one year of a boundary window fails", async () => {
    const { core } = coreWith({
      nager: nagerYears({
        "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT),
        "2027": () => new Response("boom", { status: 500 }),
      }),
    });

    const result = await composeDestinationBrief(
      buildInput({ stay: { start: "2026-12-24", end: "2027-01-05" } }),
      { core, now: at("2026-09-08") },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.holidays).toBeDefined();
    expect(result.sources.nager.status).toBe("partial");
    expect(result.sources.nager.note).toContain("2027");
  });
});

describe("composeDestinationBrief — both upstreams down", () => {
  it("returns the more-severe ToolError with the other in details.alsoFailed", async () => {
    const { core } = coreWith({
      openMeteo: () => new Response("boom", { status: 500 }),
      nager: () => new Response("[]", { status: 404 }),
    });

    const result = await composeDestinationBrief(
      buildInput({
        location: {
          name: "Nowhere",
          coordinates: { lat: 48.2082, lon: 16.3738 },
          countryCode: "ZZ",
        },
      }),
      { core, now: at("2026-09-08") },
    );

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
    const alsoFailed = result.details?.alsoFailed;
    expect(isToolError(alsoFailed)).toBe(true);
    expect((alsoFailed as { code: ToolErrorCode }).code).toBe(ToolErrorCode.NOT_FOUND);
  });

  it("surfaces Open-Meteo's error when both errors are equally severe (tie → Open-Meteo)", async () => {
    const { core } = coreWith({
      // Both upstreams return 500 → both map to UPSTREAM_ERROR (equal severity).
      openMeteo: () => new Response("boom", { status: 500 }),
      nager: () => new Response("boom", { status: 500 }),
    });

    const result = await composeDestinationBrief(buildInput(), { core, now: at("2026-09-08") });

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
    // The surfaced error is the forecast one; the holiday error rides along in alsoFailed.
    expect((result.details as { hostId?: string }).hostId).toBe("open-meteo");
    const alsoFailed = result.details?.alsoFailed as { details?: { hostId?: string } };
    expect(alsoFailed.details?.hostId).toBe("nager");
  });

  it("preserves the worst error's own structured fields, not just its code and message", async () => {
    // Open-Meteo *throws* → the rejected-settled branch maps it to upstreamError(..., "open-meteo"),
    // which carries a top-level `upstream` field. Nager 404 → NOT_FOUND (less severe).
    const { core: delegate } = coreWith({
      nager: () => new Response("[]", { status: 404 }),
    });
    const core = throwingCore(delegate, "open-meteo");

    const result = await composeDestinationBrief(
      buildInput({
        location: {
          name: "Nowhere",
          coordinates: { lat: 48.2082, lon: 16.3738 },
          countryCode: "ZZ",
        },
      }),
      { core, now: at("2026-09-08") },
    );

    expect(isToolError(result)).toBe(true);
    if (!isToolError(result)) return;
    expect(result.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
    expect((result as { upstream?: string }).upstream).toBe("open-meteo");
    expect(result.message).toContain("threw");
    const alsoFailed = result.details?.alsoFailed;
    expect(isToolError(alsoFailed)).toBe(true);
    expect((alsoFailed as { code: ToolErrorCode }).code).toBe(ToolErrorCode.NOT_FOUND);
  });
});

describe("composeDestinationBrief — truncated forecast", () => {
  it("keeps the forecast and sets a note when the stay straddles the horizon", async () => {
    const { core } = coreWith({
      openMeteo: () => jsonResponse(synthForecast("2026-09-01", "2026-10-10")),
      nager: nagerYears({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    });

    const result = await composeDestinationBrief(
      buildInput({ stay: { start: "2026-09-20", end: "2026-10-05" }, detail: "full" }),
      { core, now: at("2026-09-08") },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result)) return;
    expect(result.forecast).toBeDefined();
    expect(result.forecast?.truncated).toBe(true);
    expect(result.sources.openMeteo.status).toBe("ok");
    expect(result.sources.openMeteo.note).toContain("horizon");
  });
});

describe("composeDestinationBrief — brief vs full projection", () => {
  const scenario = () =>
    coreWith({
      openMeteo: () => jsonResponse(synthForecast("2026-10-24", "2026-10-27")),
      nager: nagerYears({ "2026": () => jsonResponse(nagerFixture.publicHolidays2026AT) }),
    }).core;

  it("keeps weatherCode / coordinates / countryCode at detail: full", async () => {
    const result = await composeDestinationBrief(
      buildInput({ stay: { start: "2026-10-24", end: "2026-10-27" }, detail: "full" }),
      { core: scenario(), now: at("2026-10-20") },
    );

    expect(isToolError(result)).toBe(false);
    if (isToolError(result) || result.detail !== "full") return;
    expect(result.forecast?.coordinates).toBeDefined();
    expect(result.forecast?.days[0]?.weatherCode).toBeDefined();
    expect(result.holidays?.[0]?.countryCode).toBe("AT");
    expect(DestinationBriefSchema.safeParse(result).success).toBe(true);
  });

  it("strips them at detail: brief and at the default (omitted) detail", async () => {
    for (const overrides of [
      { stay: { start: "2026-10-24", end: "2026-10-27" }, detail: "brief" },
      { stay: { start: "2026-10-24", end: "2026-10-27" } },
    ]) {
      const result = await composeDestinationBrief(buildInput(overrides), {
        core: scenario(),
        now: at("2026-10-20"),
      });

      expect(isToolError(result)).toBe(false);
      if (isToolError(result) || result.detail !== "brief") {
        throw new Error("expected a brief result");
      }
      expect(result.forecast).toBeDefined();
      expect("coordinates" in (result.forecast ?? {})).toBe(false);
      expect(result.forecast?.days[0]).not.toHaveProperty("weatherCode");
      expect(result.forecast?.days[0]?.condition).toBeDefined();
      expect(result.holidays?.[0]).not.toHaveProperty("countryCode");
      expect(result.holidays?.[0]?.name).toBe("National Day");
      expect(DestinationBriefSchema.safeParse(result).success).toBe(true);
    }
  });
});
