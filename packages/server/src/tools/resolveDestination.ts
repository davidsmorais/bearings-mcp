import { internalError, toolInputSchemas } from "@bearings/shared";
import { defineTool } from "./defineTool.js";

export const resolveDestinationTool = defineTool({
  name: "resolve_destination",
  description:
    "Not yet implemented — Resolves a fuzzy place name into a structured Location with coordinates and country code.",
  inputSchema: toolInputSchemas.resolve_destination,
  handler: () => internalError("resolve_destination is not implemented yet"),
});
