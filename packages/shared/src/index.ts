export type { ToolError } from "./errors.js";
export {
  ambiguous,
  createToolError,
  internalError,
  invalidInput,
  isToolError,
  notFound,
  quotaExceeded,
  rateLimited,
  ToolErrorCode,
  upstreamError,
  upstreamTimeout,
} from "./errors.js";
export type { AnalyseNeighbourhoodInput } from "./schemas/analyseNeighbourhood.js";
export { AnalyseNeighbourhoodInputSchema } from "./schemas/analyseNeighbourhood.js";
export type { EchoInput } from "./schemas/echo.js";
export { EchoInputSchema } from "./schemas/echo.js";
export type { GetDestinationBriefInput } from "./schemas/getDestinationBrief.js";
export { GetDestinationBriefInputSchema } from "./schemas/getDestinationBrief.js";
export type { ResolveDestinationInput } from "./schemas/resolveDestination.js";
export { ResolveDestinationInputSchema } from "./schemas/resolveDestination.js";
export { toToolError, zodErrorToToolError } from "./toToolError.js";
export type { Coordinates } from "./types/coordinates.js";
export { CoordinatesSchema } from "./types/coordinates.js";
export type { CountryCode } from "./types/countryCode.js";
export { CountryCodeSchema } from "./types/countryCode.js";
export type {
  BriefForecast,
  BriefHoliday,
  DestinationBrief,
  DestinationBriefBrief,
  DestinationBriefFull,
  SourceOutcome,
  SourceStatus,
  Sources,
} from "./types/destinationBrief.js";
export {
  BriefForecastSchema,
  BriefHolidaySchema,
  DestinationBriefSchema,
  SourceOutcomeSchema,
  SourceStatusSchema,
  SourcesSchema,
} from "./types/destinationBrief.js";
export type { DailyForecast, Forecast, WeatherCondition } from "./types/forecast.js";
export { DailyForecastSchema, ForecastSchema, WeatherConditionSchema } from "./types/forecast.js";
export type { Holiday } from "./types/holiday.js";
export { HolidaySchema } from "./types/holiday.js";
export type { Location } from "./types/location.js";
export { LocationSchema } from "./types/location.js";
export type { PoiCategory } from "./types/poiCategory.js";
export { PoiCategorySchema } from "./types/poiCategory.js";
export type { PointOfInterest } from "./types/pointOfInterest.js";
export { PointOfInterestSchema } from "./types/pointOfInterest.js";
export type {
  LocationCandidate,
  PlaceKind,
  ResolvedLocation,
} from "./types/resolvedLocation.js";
export {
  LocationCandidateSchema,
  PlaceKindSchema,
  ResolvedLocationSchema,
} from "./types/resolvedLocation.js";
export type { TimeWindow } from "./types/timeWindow.js";
export { MAX_STAY_NIGHTS, TimeWindowSchema } from "./types/timeWindow.js";

import { AnalyseNeighbourhoodInputSchema } from "./schemas/analyseNeighbourhood.js";
import { EchoInputSchema } from "./schemas/echo.js";
import { GetDestinationBriefInputSchema } from "./schemas/getDestinationBrief.js";
import { ResolveDestinationInputSchema } from "./schemas/resolveDestination.js";

/** Name → input schema map consumed by the inspector form generator (Invariant 2). */
export const toolInputSchemas = {
  echo: EchoInputSchema,
  resolve_destination: ResolveDestinationInputSchema,
  get_destination_brief: GetDestinationBriefInputSchema,
  analyse_neighbourhood: AnalyseNeighbourhoodInputSchema,
} as const;
