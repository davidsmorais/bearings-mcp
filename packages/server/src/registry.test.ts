import { toolInputSchemas } from "@bearings/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertUniqueToolNames, tools } from "./registry.js";
import { defineTool } from "./tools/defineTool.js";

describe("registry", () => {
  it("exposes structurally well-formed tool definitions", () => {
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.inputSchema.safeParse).toBe("function");
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("registers get_destination_brief exactly once with its shared input schema", () => {
    const matches = tools.filter((tool) => tool.name === "get_destination_brief");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.inputSchema).toBe(toolInputSchemas.get_destination_brief);
  });

  it("passes validation when tool names are unique", () => {
    const unique = [
      defineTool({
        name: "toolA",
        description: "Tool A",
        inputSchema: z.object({}),
        handler: () => ({}),
      }),
      defineTool({
        name: "toolB",
        description: "Tool B",
        inputSchema: z.object({}),
        handler: () => ({}),
      }),
    ];
    expect(() => assertUniqueToolNames(unique)).not.toThrow();
  });

  it("throws when two tools share a name", () => {
    const clash = [
      defineTool({
        name: "duplicate",
        description: "First",
        inputSchema: z.object({}),
        handler: () => ({}),
      }),
      defineTool({
        name: "duplicate",
        description: "Second",
        inputSchema: z.object({}),
        handler: () => ({}),
      }),
    ];
    expect(() => assertUniqueToolNames(clash)).toThrow(
      /duplicate tool name in registry: "duplicate"/i,
    );
  });
});
