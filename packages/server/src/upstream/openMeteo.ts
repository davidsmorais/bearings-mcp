import {
  type Coordinates,
  type DailyForecast,
  type Forecast,
  ForecastSchema,
  internalError,
  isToolError,
  notFound,
  type TimeWindow,
  type ToolError,
} from "@bearings/shared";
import { getHttpCore, type HttpCore } from "../http/index.js";
import { conditionForWeatherCode } from "./weatherCode.js";

const HOST_ID = "open-meteo" as const;
const FORECAST_PATH = "/v1/forecast";

// --- Normalisation constants (root Invariant 7: named, in one block) ---------
/** Open-Meteo publishes 16 forecast days: today plus 15 ahead. */
const FORECAST_HORIZON_DAYS = 16;
/** Local hours [start, end) treated as "daytime" when picking the headline condition. */
const DAYTIME_START_HOUR = 6;
const DAYTIME_END_HOUR = 20;
/** Coordinate precision sent upstream and folded into the cache key (~11 m). */
const COORD_DECIMALS = 4;

const ISO_DATE_LENGTH = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The slice of the Open-Meteo forecast payload this client relies on. */
interface OpenMeteoForecastResponse {
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string;
  readonly hourly_units?: Readonly<Record<string, string>>;
  readonly hourly?: {
    readonly time?: readonly string[];
    readonly temperature_2m?: readonly (number | null)[];
    readonly precipitation?: readonly (number | null)[];
    readonly weather_code?: readonly (number | null)[];
  };
}

export interface FetchForecastDeps {
  /** HTTP core to route through. Defaults to the production singleton. */
  readonly core?: HttpCore;
  /** Caller cancellation, forwarded to the HTTP core. */
  readonly signal?: AbortSignal;
  /** Injectable "now" for the horizon math; defaults to the wall clock. */
  readonly now?: () => Date;
}

const toIsoDate = (date: Date): string => date.toISOString().slice(0, ISO_DATE_LENGTH);

const addDays = (isoDate: string, days: number): string =>
  toIsoDate(new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_PER_DAY));

const round1 = (value: number): number => Math.round(value * 10) / 10;

interface DayBucket {
  readonly temps: number[];
  readonly precipitation: number[];
  readonly allCodes: number[];
  readonly daytimeCodes: number[];
}

/** Most frequent code; ties resolve toward the higher (more disruptive) code. */
const pickHeadlineCode = (codes: readonly number[]): number => {
  const counts = new Map<number, number>();
  for (const code of codes) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let headline = codes[0];
  let headlineCount = 0;
  for (const [code, count] of counts) {
    if (count > headlineCount || (count === headlineCount && code > headline)) {
      headline = code;
      headlineCount = count;
    }
  }
  return headline;
};

const bucketHourlySeries = (hourly: {
  readonly time: readonly string[];
  readonly temperature_2m: readonly (number | null)[];
  readonly precipitation: readonly (number | null)[];
  readonly weather_code: readonly (number | null)[];
}): Map<string, DayBucket> => {
  const buckets = new Map<string, DayBucket>();
  for (let i = 0; i < hourly.time.length; i += 1) {
    const stamp = hourly.time[i];
    const temp = hourly.temperature_2m[i];
    const precip = hourly.precipitation[i];
    const code = hourly.weather_code[i];
    if (temp === null || temp === undefined || precip === null || precip === undefined) {
      continue;
    }
    if (code === null || code === undefined) {
      continue;
    }
    const date = stamp.slice(0, ISO_DATE_LENGTH);
    const hour = Number(stamp.slice(11, 13));
    let bucket = buckets.get(date);
    if (bucket === undefined) {
      bucket = { temps: [], precipitation: [], allCodes: [], daytimeCodes: [] };
      buckets.set(date, bucket);
    }
    bucket.temps.push(temp);
    bucket.precipitation.push(precip);
    bucket.allCodes.push(code);
    if (hour >= DAYTIME_START_HOUR && hour < DAYTIME_END_HOUR) {
      bucket.daytimeCodes.push(code);
    }
  }
  return buckets;
};

const summariseDay = (date: string, bucket: DayBucket): DailyForecast => {
  const codesForCondition = bucket.daytimeCodes.length > 0 ? bucket.daytimeCodes : bucket.allCodes;
  const weatherCode = pickHeadlineCode(codesForCondition);
  return {
    date,
    tempMinC: round1(Math.min(...bucket.temps)),
    tempMaxC: round1(Math.max(...bucket.temps)),
    precipitationMm: round1(bucket.precipitation.reduce((sum, mm) => sum + mm, 0)),
    weatherCode,
    condition: conditionForWeatherCode(weatherCode),
  };
};

interface CoveredRange {
  readonly start: string;
  readonly end: string;
  readonly truncated: boolean;
  readonly reason?: string;
}

/** Clamps the requested range to what Open-Meteo can actually answer. */
const resolveCoveredRange = (range: TimeWindow, today: string): CoveredRange | ToolError => {
  const horizonEnd = addDays(today, FORECAST_HORIZON_DAYS - 1);

  if (range.end < today) {
    return notFound(
      `Open-Meteo forecasts ${today} onward; the requested range ends ${range.end}, entirely in the past.`,
    );
  }
  if (range.start > horizonEnd) {
    return notFound(
      `Open-Meteo's forecast horizon reaches ${horizonEnd} (${FORECAST_HORIZON_DAYS} days out); the requested range starts ${range.start}, beyond it.`,
    );
  }

  const start = range.start < today ? today : range.start;
  const end = range.end > horizonEnd ? horizonEnd : range.end;
  const reasons: string[] = [];
  if (start !== range.start) {
    reasons.push(`start moved to ${start} (${range.start} is in the past)`);
  }
  if (end !== range.end) {
    reasons.push(
      `end moved to ${end} (${range.end} is beyond the ${FORECAST_HORIZON_DAYS}-day horizon)`,
    );
  }
  return {
    start,
    end,
    truncated: reasons.length > 0,
    ...(reasons.length > 0 ? { reason: reasons.join("; ") } : {}),
  };
};

const assertExpectedUnits = (
  units: Readonly<Record<string, string>> | undefined,
): ToolError | undefined => {
  if (units === undefined) {
    return undefined;
  }
  if (units.temperature_2m !== undefined && units.temperature_2m !== "°C") {
    return internalError(
      `Open-Meteo returned temperature in "${units.temperature_2m}", expected "°C"`,
    );
  }
  if (units.precipitation !== undefined && units.precipitation !== "mm") {
    return internalError(
      `Open-Meteo returned precipitation in "${units.precipitation}", expected "mm"`,
    );
  }
  return undefined;
};

/**
 * Fetches a forecast for a coordinate and date range, normalised into per-day
 * summaries. Hourly arrays never leave this function (root Upstream Quirks:
 * "passing raw hourly data through is a normalisation bug"). Ranges beyond the
 * forecast horizon return a `NOT_FOUND` with the latest available date; ranges
 * that only partly exceed it are clamped and flagged via `truncated`.
 */
export async function fetchForecast(
  coordinates: Coordinates,
  range: TimeWindow,
  deps: FetchForecastDeps = {},
): Promise<Forecast | ToolError> {
  const today = toIsoDate(deps.now?.() ?? new Date());
  const covered = resolveCoveredRange(range, today);
  if (isToolError(covered)) {
    return covered;
  }

  const core = deps.core ?? getHttpCore();
  const result = await core.request<OpenMeteoForecastResponse>(
    HOST_ID,
    FORECAST_PATH,
    {
      latitude: coordinates.lat.toFixed(COORD_DECIMALS),
      longitude: coordinates.lon.toFixed(COORD_DECIMALS),
      hourly: "temperature_2m,precipitation,weather_code",
      start_date: covered.start,
      end_date: covered.end,
      timezone: "auto",
      temperature_unit: "celsius",
      precipitation_unit: "mm",
    },
    { signal: deps.signal },
  );
  if (isToolError(result)) {
    return result;
  }

  const unitError = assertExpectedUnits(result.data.hourly_units);
  if (unitError !== undefined) {
    return unitError;
  }

  const hourly = result.data.hourly;
  if (
    hourly?.time === undefined ||
    hourly.temperature_2m === undefined ||
    hourly.precipitation === undefined ||
    hourly.weather_code === undefined
  ) {
    return internalError("Open-Meteo forecast response is missing its hourly series");
  }

  const buckets = bucketHourlySeries({
    time: hourly.time,
    temperature_2m: hourly.temperature_2m,
    precipitation: hourly.precipitation,
    weather_code: hourly.weather_code,
  });

  const days: DailyForecast[] = [];
  for (let date = covered.start; date <= covered.end; date = addDays(date, 1)) {
    const bucket = buckets.get(date);
    if (bucket === undefined || bucket.temps.length === 0) {
      return internalError(`Open-Meteo forecast response has no hourly data for ${date}`);
    }
    days.push(summariseDay(date, bucket));
  }

  const forecast: Forecast = {
    coordinates,
    timezone: result.data.timezone,
    units: { temperature: "°C", precipitation: "mm" },
    requestedRange: range,
    coveredRange: { start: covered.start, end: covered.end },
    truncated: covered.truncated,
    ...(covered.reason !== undefined ? { truncationReason: covered.reason } : {}),
    days,
  };

  const parsed = ForecastSchema.safeParse(forecast);
  if (!parsed.success) {
    return internalError(
      `Normalised Open-Meteo forecast failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
