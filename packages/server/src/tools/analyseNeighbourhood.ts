import { toolInputSchemas } from "@bearings/shared";
import { analyseNeighbourhood } from "../analysis/analyseNeighbourhood.js";
import { defineTool } from "./defineTool.js";

export const analyseNeighbourhoodTool = defineTool({
  name: "analyse_neighbourhood",
  description:
    "POI density profile around a coordinate, grouped into six walking-distance domains (nightlife, dining, transit, greenSpace, retail, culture). Geoapify is queried once per domain at the requested radius; inner walking rings are partitioned client-side from returned distances at no extra credit cost. Every domain rating carries its venue count, radius, density and per-ring breakdown; full detail also includes up to five nearest sample POIs. Counts at the limitPerCategory ceiling are a floor — countCapped marks when density may be understated. A sources block reports each domain upstream as ok, partial, or unavailable. The response also reports the Geoapify credits consumed (credits.consumed and a per-domain breakdown): one credit per domain queried, and 0 for a domain served from Geoapify's cache, so an identical repeat call within the cache window reports 0. detail defaults to brief, which drops sample POIs and location coordinates; full keeps them. One set of upstream calls regardless of detail.",
  inputSchema: toolInputSchemas.analyse_neighbourhood,
  handler: (input, context) => analyseNeighbourhood(input, { signal: context?.signal }),
});
