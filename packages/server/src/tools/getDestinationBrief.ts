import { internalError, toolInputSchemas } from "@bearings/shared";
import { defineTool } from "./defineTool.js";

export const getDestinationBriefTool = defineTool({
  name: "get_destination_brief",
  description:
    "Not yet implemented — Returns a weather forecast and public holidays for a stay at a resolved location.",
  inputSchema: toolInputSchemas.get_destination_brief,
  handler: () => internalError("get_destination_brief is not implemented yet"),
});
