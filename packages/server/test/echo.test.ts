import { ToolErrorCode, toolInputSchemas } from "@bearings/shared";
import { describe, expect, it } from "vitest";
import { tools } from "../src/registry.js";
import { analyseNeighbourhoodTool } from "../src/tools/analyseNeighbourhood.js";
import { echoTool } from "../src/tools/echo.js";
import { getDestinationBriefTool } from "../src/tools/getDestinationBrief.js";
import { resolveDestinationTool } from "../src/tools/resolveDestination.js";

describe("echoTool", () => {
  it("is registered under the name 'echo'", () => {
    expect(echoTool.name).toBe("echo");
  });

  it("accepts a valid message", () => {
    expect(echoTool.inputSchema.safeParse({ message: "hi" }).success).toBe(true);
  });

  it("rejects an empty message", () => {
    expect(echoTool.inputSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("returns the message unchanged as a plain value", async () => {
    const result = await echoTool.handler({ message: "hi" });
    expect(result).toEqual({ message: "hi" });
  });
});

describe("stub tools", () => {
  it("resolve_destination returns INTERNAL_ERROR", async () => {
    const result = await resolveDestinationTool.handler({
      query: "Paris",
      limit: 5,
      detail: "brief",
    });
    expect(result).toEqual({
      code: ToolErrorCode.INTERNAL_ERROR,
      message: "resolve_destination is not implemented yet",
    });
  });

  it("get_destination_brief returns INTERNAL_ERROR", async () => {
    const result = await getDestinationBriefTool.handler({
      location: {
        name: "Paris",
        coordinates: { lat: 48.8566, lon: 2.3522 },
        countryCode: "FR",
      },
      stay: { start: "2026-06-01", end: "2026-06-07" },
      detail: "brief",
    });
    expect(result).toEqual({
      code: ToolErrorCode.INTERNAL_ERROR,
      message: "get_destination_brief is not implemented yet",
    });
  });

  it("analyse_neighbourhood returns INTERNAL_ERROR", async () => {
    const result = await analyseNeighbourhoodTool.handler({
      coordinates: { lat: 48.8566, lon: 2.3522 },
      radiusM: 500,
      categories: ["dining", "cafes", "nightlife", "groceries", "transit", "parks", "culture"],
      limitPerCategory: 20,
      detail: "brief",
    });
    expect(result).toEqual({
      code: ToolErrorCode.INTERNAL_ERROR,
      message: "analyse_neighbourhood is not implemented yet",
    });
  });

  it.each([resolveDestinationTool, getDestinationBriefTool, analyseNeighbourhoodTool] as const)(
    "stub description for %s begins with Not yet implemented",
    (tool) => {
      expect(tool.description).toMatch(/^Not yet implemented — /);
    },
  );
});

describe("toolInputSchemas drift guard", () => {
  it("keeps registry inputSchema reference-identical to toolInputSchemas", () => {
    for (const tool of tools) {
      expect(tool.inputSchema).toBe(toolInputSchemas[tool.name as keyof typeof toolInputSchemas]);
    }
  });
});
