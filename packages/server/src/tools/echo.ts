import { EchoInputSchema } from "@bearings/shared";
import { defineTool } from "./defineTool.js";

export const echoTool = defineTool({
  name: "echo",
  description:
    "Diagnostic tool. Returns the given message unchanged — proves the registry-to-transport wiring works end to end.",
  inputSchema: EchoInputSchema,
  handler: ({ message }) => ({ message }),
});
