export type { ToolError } from "./errors.js";
export {
  ambiguous,
  internalError,
  invalidInput,
  isToolError,
  notFound,
  quotaExceeded,
  rateLimited,
  ToolErrorCode,
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
export type { Location } from "./types/location.js";
export { LocationSchema } from "./types/location.js";
export type { PoiCategory } from "./types/poiCategory.js";
export { PoiCategorySchema } from "./types/poiCategory.js";
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
