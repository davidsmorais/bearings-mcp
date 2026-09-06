import { internalError, toolInputSchemas } from "@bearings/shared";
import { defineTool } from "./defineTool.js";

export const analyseNeighbourhoodTool = defineTool({
  name: "analyse_neighbourhood",
  description:
    "Not yet implemented — Analyses POI density by category around a coordinate within a search radius.",
  inputSchema: toolInputSchemas.analyse_neighbourhood,
  handler: () => internalError("analyse_neighbourhood is not implemented yet"),
});
