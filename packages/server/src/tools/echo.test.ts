import { toolInputSchemas } from "@bearings/shared";
import { describe, expect, it } from "vitest";
import { tools } from "../registry.js";
import { analyseNeighbourhoodTool } from "./analyseNeighbourhood.js";
import { echoTool } from "./echo.js";

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

describe("analyseNeighbourhoodTool", () => {
  it("is registered under the name analyse_neighbourhood", () => {
    expect(analyseNeighbourhoodTool.name).toBe("analyse_neighbourhood");
  });

  it("does not advertise a stub description", () => {
    expect(analyseNeighbourhoodTool.description).not.toMatch(/^Not yet implemented — /);
  });
});

describe("toolInputSchemas drift guard", () => {
  it("keeps registry inputSchema reference-identical to toolInputSchemas", () => {
    for (const tool of tools) {
      expect(tool.inputSchema).toBe(toolInputSchemas[tool.name as keyof typeof toolInputSchemas]);
    }
  });
});
