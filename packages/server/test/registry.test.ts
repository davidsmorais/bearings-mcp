import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertUniqueToolNames, tools } from "../src/registry.js";

describe("registry", () => {
  it("exposes structurally well-formed tool definitions", () => {
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeInstanceOf(z.ZodObject);
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("registers every tool under a unique name", () => {
    expect(() => assertUniqueToolNames(tools)).not.toThrow();
  });

  it("throws when two tools share a name", () => {
    const clash = [...tools, tools[0]];
    expect(() => assertUniqueToolNames(clash)).toThrow(/duplicate tool name/i);
  });
});
