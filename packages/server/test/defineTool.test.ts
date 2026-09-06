import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "../src/tools/defineTool.js";

describe("defineTool", () => {
  it("returns its input unchanged at runtime", () => {
    const definition = {
      name: "echo",
      description: "Echoes the message back.",
      inputSchema: z.object({ message: z.string() }),
      handler: (input: { message: string }) => input.message,
    };

    expect(defineTool(definition)).toBe(definition);
  });

  it("types the handler parameter from the schema", () => {
    const tool = defineTool({
      name: "add",
      description: "Adds two numbers.",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      handler: (input) => {
        // input is inferred as { a: number; b: number } from the schema.
        const sum: number = input.a + input.b;

        // @ts-expect-error - `missing` is not a property of the parsed schema type.
        return input.missing ?? sum;
      },
    });

    expect(tool.handler({ a: 2, b: 3 })).toBe(5);
  });
});
