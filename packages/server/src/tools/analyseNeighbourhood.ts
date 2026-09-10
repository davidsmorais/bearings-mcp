import { toolInputSchemas } from "@bearings/shared";
import { analyseNeighbourhood } from "../analysis/analyseNeighbourhood.js";
import { defineTool } from "./defineTool.js";

export const analyseNeighbourhoodTool = defineTool({
  name: "analyse_neighbourhood",
  description:
    "POI density profile around a coordinate, grouped into six walking-distance domains (nightlife, dining, transit, greenSpace, retail, culture). Geoapify is queried once per domain at the requested radius; inner walking rings are partitioned client-side from returned distances at no extra credit cost. Each domain's rating is read at the 500 m walking ring (or the request's outer ring when radiusM is under 500), reported as ratingRadiusM — widening radiusM changes the sample and the counts but not the ring the verdict comes from, so a dense centre stays rated dense at any radius. Every domain rating carries its total venue count, the requested radius, ratingRadiusM, the density at that ring, whether that ring's count is a floor (countCapped), and the per-ring breakdown; full detail also includes up to ten nearest sample POIs. limitPerCategory defaults to and is capped at 20 places per domain (one Geoapify credit) when detail is brief; detail: full may raise it up to 40 (a second credit bucket) for a higher honest-count ceiling. Counts at the limitPerCategory ceiling are a floor — countCapped marks when density may be understated. A sources block reports each domain upstream as ok, partial, or unavailable. The response also reports the Geoapify credits consumed (credits.consumed and a per-domain breakdown): ceil(placesReturned/20) per domain queried, and 0 for a domain served from Geoapify's cache, so an identical repeat call within the cache window reports 0. detail defaults to brief, which drops sample POIs and location coordinates; full keeps them. One set of upstream calls regardless of detail.",
  inputSchema: toolInputSchemas.analyse_neighbourhood,
  handler: (input, context) => analyseNeighbourhood(input, { signal: context?.signal }),
});
