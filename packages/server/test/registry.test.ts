import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertUniqueToolNames, tools } from "../src/registry.js";
import { defineTool } from "../src/tools/defineTool.js";

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
