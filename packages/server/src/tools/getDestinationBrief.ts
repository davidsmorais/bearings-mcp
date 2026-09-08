import {
  type DestinationBrief,
  type DestinationBriefBrief,
  type DestinationBriefFull,
  DestinationBriefSchema,
  type Forecast,
  type GetDestinationBriefInput,
  type Holiday,
  internalError,
  isToolError,
  type SourceOutcome,
  type ToolError,
  ToolErrorCode,
  toolInputSchemas,
  upstreamError,
} from "@bearings/shared";
import type { HttpCore } from "../http/index.js";
import { fetchHolidaysInWindow, type HolidayLookup } from "../upstream/nager.js";
import { fetchForecast } from "../upstream/openMeteo.js";
import { defineTool } from "./defineTool.js";

/**
 * Severity ranking used only when BOTH upstreams fail: the worse error is the one
 * surfaced, the other travels in `details.alsoFailed` (root Invariant 7 — the ranking
 * is a named constant block, not magic numbers). Higher is worse. Equal severity
 * resolves to Open-Meteo, since weather is the headline of a destination brief.
 */
const ERROR_SEVERITY: Record<ToolErrorCode, number> = {
  [ToolErrorCode.NOT_FOUND]: 1,
  [ToolErrorCode.QUOTA_EXCEEDED]: 2,
  [ToolErrorCode.RATE_LIMITED]: 3,
  [ToolErrorCode.TIMEOUT]: 4,
  [ToolErrorCode.UPSTREAM_TIMEOUT]: 4,
  [ToolErrorCode.AMBIGUOUS]: 5,
  [ToolErrorCode.INVALID_INPUT]: 5,
  [ToolErrorCode.UPSTREAM_ERROR]: 6,
  [ToolErrorCode.INTERNAL_ERROR]: 7,
};

export interface ComposeDeps {
  /** HTTP core to route both upstreams through. Defaults to the production singleton. */
  readonly core?: HttpCore;
  /** Caller cancellation, forwarded to both upstream clients. */
  readonly signal?: AbortSignal;
  /** Injectable "now" for Open-Meteo's horizon math; defaults to the wall clock. */
  readonly now?: () => Date;
}

function moreSevereError(forecastError: ToolError, holidayError: ToolError): ToolError {
  const holidayWorse = ERROR_SEVERITY[holidayError.code] > ERROR_SEVERITY[forecastError.code];
  const worst = holidayWorse ? holidayError : forecastError;
  const other = holidayWorse ? forecastError : holidayError;
  // Spread `worst` whole so its own structured fields (`upstream`, `retryAfterMs`,
  // `timeoutMs`, `field`, …) survive — only `alsoFailed` is folded into `details`.
  return { ...worst, isError: true, details: { ...worst.details, alsoFailed: other } };
}

function mapForecast(result: Forecast | ToolError): {
  forecast?: Forecast;
  openMeteo: SourceOutcome;
} {
  if (isToolError(result)) {
    return { openMeteo: { status: "unavailable", error: result } };
  }
  return {
    forecast: result,
    openMeteo: {
      status: "ok",
      // A truncated-but-usable forecast is still "ok"; the clamp reason is the note.
      ...(result.truncationReason !== undefined ? { note: result.truncationReason } : {}),
    },
  };
}

function mapHolidays(result: HolidayLookup | ToolError): {
  holidays?: Holiday[];
  nager: SourceOutcome;
} {
  if (isToolError(result)) {
    return { nager: { status: "unavailable", error: result } };
  }
  // An empty list is a real answer ("no public holidays during the stay"), never a failure.
  const holidays = [...result.holidays];
  if (result.partial !== undefined) {
    return { holidays, nager: { status: "partial", note: result.partial.reason } };
  }
  return { holidays, nager: { status: "ok" } };
}

/** Lossy projection of the assembled `full` brief — drops echo/evidence fields. */
function toBriefDetail(full: DestinationBriefFull): DestinationBriefBrief {
  const brief: DestinationBriefBrief = {
    detail: "brief",
    location: full.location,
    stay: full.stay,
    sources: full.sources,
  };

  if (full.forecast !== undefined) {
    const {
      coordinates: _coordinates,
      requestedRange: _requestedRange,
      days,
      ...rest
    } = full.forecast;
    brief.forecast = {
      ...rest,
      days: days.map(({ weatherCode: _weatherCode, ...day }) => day),
    };
  }

  if (full.holidays !== undefined) {
    brief.holidays = full.holidays.map(({ countryCode: _countryCode, ...holiday }) => holiday);
  }

  return brief;
}

/**
 * Fans out to Open-Meteo and Nager.Date in parallel (`Promise.allSettled`, never
 * `Promise.all` — repo Forbidden Practice) and degrades gracefully: one upstream
 * failing still returns the other's data, with a per-upstream `sources` block so an
 * agent can tell "no holidays during the stay" from "the holiday service was down".
 * Both failing returns the more-severe `ToolError`, the other in `details.alsoFailed`.
 */
export async function composeDestinationBrief(
  input: GetDestinationBriefInput,
  deps: ComposeDeps = {},
): Promise<DestinationBrief | ToolError> {
  // Both promises are constructed before either is awaited, so wall time is the slower
  // upstream, not the sum.
  const [forecastSettled, holidaySettled] = await Promise.allSettled([
    fetchForecast(input.location.coordinates, input.stay, {
      core: deps.core,
      signal: deps.signal,
      now: deps.now,
    }),
    fetchHolidaysInWindow(input.location.countryCode, input.stay, {
      core: deps.core,
      signal: deps.signal,
    }),
  ]);

  // The clients return errors rather than throw; a rejection means a genuine client bug.
  const forecastResult =
    forecastSettled.status === "fulfilled"
      ? forecastSettled.value
      : upstreamError("Open-Meteo client threw instead of returning an error", "open-meteo");
  const holidayResult =
    holidaySettled.status === "fulfilled"
      ? holidaySettled.value
      : upstreamError("Nager.Date client threw instead of returning an error", "nager");

  if (isToolError(forecastResult) && isToolError(holidayResult)) {
    return moreSevereError(forecastResult, holidayResult);
  }

  const { forecast, openMeteo } = mapForecast(forecastResult);
  const { holidays, nager } = mapHolidays(holidayResult);

  const full: DestinationBriefFull = {
    detail: "full",
    location: input.location,
    stay: input.stay,
    ...(forecast !== undefined ? { forecast } : {}),
    ...(holidays !== undefined ? { holidays } : {}),
    sources: { openMeteo, nager },
  };

  const composed: DestinationBrief = input.detail === "brief" ? toBriefDetail(full) : full;

  const parsed = DestinationBriefSchema.safeParse(composed);
  if (!parsed.success) {
    return internalError(`composed brief failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const getDestinationBriefTool = defineTool({
  name: "get_destination_brief",
  description:
    "Weather forecast and public holidays for a stay at an already-resolved location. Open-Meteo and Nager.Date are fetched in parallel and the brief degrades gracefully: if one upstream fails the other's data is still returned, and a sources block reports each upstream as ok, partial, or unavailable, carrying the underlying error when unavailable. If both upstreams fail, a single structured error is returned. detail defaults to brief, which drops echo and evidence fields such as weatherCode, coordinates and holiday countryCode; full keeps them.",
  inputSchema: toolInputSchemas.get_destination_brief,
  handler: (input, context) => composeDestinationBrief(input, { signal: context?.signal }),
});
