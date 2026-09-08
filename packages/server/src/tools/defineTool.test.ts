import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./defineTool.js";

describe("defineTool", () => {
  it("defines a tool with standard object schema and invokes its handler", async () => {
    const tool = defineTool({
      name: "add",
      description: "Adds two numbers.",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      handler: ({ a, b }) => a + b,
    });

    expect(tool.name).toBe("add");
    expect(tool.description).toBe("Adds two numbers.");
    const result = await tool.handler({ a: 2, b: 3 }, {});
    expect(result).toBe(5);
  });

  it("supports schemas with object-level refine (ZodEffects)", async () => {
    const dateRangeSchema = z
      .object({
        startDate: z.string(),
        endDate: z.string(),
      })
      .refine((data) => data.startDate <= data.endDate, {
        message: "startDate must be before or equal to endDate",
      });

    const tool = defineTool({
      name: "dateRange",
      description: "Checks a date range.",
      inputSchema: dateRangeSchema,
      handler: ({ startDate, endDate }) => `${startDate} to ${endDate}`,
    });

    expect(tool.name).toBe("dateRange");
    const result = await tool.handler({ startDate: "2026-09-01", endDate: "2026-09-05" }, {});
    expect(result).toBe("2026-09-01 to 2026-09-05");
  });

  it("passes execution context including AbortSignal to handler", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const tool = defineTool({
      name: "cancellable",
      description: "Tool with abort signal awareness.",
      inputSchema: z.object({ query: z.string() }),
      handler: (_input, context) => {
        receivedSignal = context?.signal;
        return { ok: true };
      },
    });

    await tool.handler({ query: "test" }, { signal: controller.signal });
    expect(receivedSignal).toBe(controller.signal);
  });
});
