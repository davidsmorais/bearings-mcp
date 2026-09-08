import {
  isToolError,
  type LocationCandidate,
  type ResolveDestinationInput,
  type ResolvedLocation,
  ToolErrorCode,
  toolInputSchemas,
} from "@bearings/shared";
import { resolveDestination } from "../upstream/nominatim.js";
import { defineTool } from "./defineTool.js";

type Detail = ResolveDestinationInput["detail"];

/**
 * `brief` returns the core location an agent needs to act; `full` adds the
 * enrichment Nominatim supplied (`kind`, `importance`, `placeRank`, `boundingBox`,
 * `osmType`, `osmId`). Shaping only drops keys, so the normaliser's validity holds.
 */
const shapeResolvedLocation = (location: ResolvedLocation, detail: Detail) => {
  if (detail === "full") {
    return location;
  }
  const { name, coordinates, countryCode, displayName, admin } = location;
  return {
    name,
    coordinates,
    countryCode,
    ...(displayName !== undefined ? { displayName } : {}),
    admin,
  };
};

const shapeCandidate = (candidate: LocationCandidate, detail: Detail) => ({
  ...candidate,
  location: shapeResolvedLocation(candidate.location, detail),
});

export const resolveDestinationTool = defineTool({
  name: "resolve_destination",
  description:
    "Resolves a fuzzy place name or address into a structured location with coordinates, country code and administrative context. Returns AMBIGUOUS with ranked candidates when no single match is clearly ahead, and NOT_FOUND when nothing matches.",
  inputSchema: toolInputSchemas.resolve_destination,
  handler: async (input, context) => {
    const result = await resolveDestination(input.query, {
      countryCode: input.countryCode,
      limit: input.limit,
      signal: context?.signal,
    });

    if (isToolError(result)) {
      if (result.code === ToolErrorCode.AMBIGUOUS && "candidates" in result) {
        return {
          ...result,
          candidates: result.candidates.map((candidate) => shapeCandidate(candidate, input.detail)),
        };
      }
      return result;
    }

    return shapeResolvedLocation(result, input.detail);
  },
});
