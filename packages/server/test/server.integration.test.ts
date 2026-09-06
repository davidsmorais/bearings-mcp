import { notFound, ToolErrorCode, toolInputSchemas } from "@bearings/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { tools } from "../src/registry.js";
import { createServer } from "../src/server.js";
import { defineTool } from "../src/tools/defineTool.js";

describe("createServer over an in-memory transport", () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "0" });
    server = createServer();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("lists exactly the registered tools", async () => {
    const { tools: listed } = await client.listTools();
    expect(listed).toHaveLength(tools.length);
    expect(listed.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("exposes echo with a JSON Schema for its input including description", async () => {
    const { tools: listed } = await client.listTools();
    const echo = listed.find((t) => t.name === "echo");
    expect(echo).toBeDefined();
    expect(echo?.inputSchema.type).toBe("object");
    expect(echo?.inputSchema.properties).toHaveProperty("message");
    const messageProp = echo?.inputSchema.properties?.message as { description?: string };
    expect(messageProp.description).toBe("The message to echo back verbatim");
  });

  it("returns the message back when echo is called", async () => {
    const result = await client.callTool({ name: "echo", arguments: { message: "hi" } });
    expect(result.structuredContent).toEqual({ message: "hi" });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ message: "hi" }) }]);
  });

  it("rejects an invalid echo argument before the handler runs", async () => {
    const result = await client.callTool({ name: "echo", arguments: { message: "" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toMatch(/validation/i);
  });
});

describe("createServer error handling and schema extensions", () => {
  let client: Client;
  let server: McpServer;

  const testTools = [
    defineTool({
      name: "returnsError",
      description: "Returns a ToolError structure.",
      inputSchema: z.object({ query: z.string() }),
      handler: ({ query }) => notFound(`Query "${query}" not found`),
    }),
    defineTool({
      name: "throwsError",
      description: "Throws an unexpected error.",
      inputSchema: z.object({ shouldFail: z.boolean() }),
      handler: () => {
        throw new Error("Unexpected database connection crash");
      },
    }),
    defineTool({
      name: "refinedTool",
      description: "Tool with an object-level refinement schema.",
      inputSchema: z
        .object({
          min: z.number(),
          max: z.number(),
        })
        .refine((data) => data.min <= data.max, {
          message: "min must be less than or equal to max",
        }),
      handler: ({ min, max }) => ({ range: max - min }),
    }),
    defineTool({
      name: "signalAwareTool",
      description: "Tool that inspects execution context signal.",
      inputSchema: z.object({}),
      handler: (_input, context) => {
        return { hasSignal: context?.signal !== undefined };
      },
    }),
  ];

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-extended", version: "0" });
    server = createServer(testTools);
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("maps returned ToolError to isError: true and surfaces the error message", async () => {
    const result = await client.callTool({
      name: "returnsError",
      arguments: { query: "atlantis" },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: 'Query "atlantis" not found' }]);
    expect(result.structuredContent).toEqual({
      code: ToolErrorCode.NOT_FOUND,
      message: 'Query "atlantis" not found',
    });
  });

  it("catches thrown exceptions and returns an INTERNAL_ERROR result", async () => {
    const result = await client.callTool({ name: "throwsError", arguments: { shouldFail: true } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Unexpected database connection crash",
      },
    ]);
    expect(result.structuredContent).toEqual({
      code: ToolErrorCode.INTERNAL_ERROR,
      message: "Unexpected database connection crash",
    });
  });

  it("exposes properties in tools/list for schemas using .refine() and validates at runtime", async () => {
    const { tools: listed } = await client.listTools();
    const refined = listed.find((t) => t.name === "refinedTool");
    expect(refined).toBeDefined();
    expect(refined?.inputSchema.properties).toHaveProperty("min");
    expect(refined?.inputSchema.properties).toHaveProperty("max");

    const validResult = await client.callTool({
      name: "refinedTool",
      arguments: { min: 10, max: 20 },
    });
    expect(validResult.isError).toBeFalsy();
    expect(validResult.structuredContent).toEqual({ range: 10 });

    const invalidResult = await client.callTool({
      name: "refinedTool",
      arguments: { min: 30, max: 20 },
    });
    expect(invalidResult.isError).toBe(true);
    expect(JSON.stringify(invalidResult.content)).toMatch(/min must be less than or equal to max/i);
    expect(invalidResult.structuredContent).toEqual({
      code: ToolErrorCode.INVALID_INPUT,
      field: "",
      message: "min must be less than or equal to max",
    });
  });

  it("forwards AbortSignal in ToolContext to handler", async () => {
    const result = await client.callTool({ name: "signalAwareTool", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ hasSignal: true });
  });
});

describe("stub tools over an in-memory transport", () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-stubs", version: "0" });
    server = createServer();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it.each(["resolve_destination", "get_destination_brief", "analyse_neighbourhood"] as const)(
    "%s returns INTERNAL_ERROR via MCP",
    async (name) => {
      const args =
        name === "resolve_destination"
          ? { query: "Paris" }
          : name === "get_destination_brief"
            ? {
                location: {
                  name: "Paris",
                  coordinates: { lat: 48.8566, lon: 2.3522 },
                  countryCode: "FR",
                },
                stay: { start: "2026-06-01", end: "2026-06-07" },
              }
            : { coordinates: { lat: 48.8566, lon: 2.3522 } };

      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: ToolErrorCode.INTERNAL_ERROR,
        message: `${name} is not implemented yet`,
      });
    },
  );

  it("advertises stub tools with Not yet implemented prefix", async () => {
    const { tools: listed } = await client.listTools();
    for (const name of [
      "resolve_destination",
      "get_destination_brief",
      "analyse_neighbourhood",
    ] as const) {
      const tool = listed.find((t) => t.name === name);
      expect(tool?.description).toMatch(/^Not yet implemented — /);
    }
  });
});

describe("toolInputSchemas drift guard", () => {
  it("registers every toolInputSchemas entry with reference-identical inputSchema", () => {
    for (const [name, schema] of Object.entries(toolInputSchemas)) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `missing registry entry for ${name}`).toBeDefined();
      expect(tool?.inputSchema).toBe(schema);
    }
  });

  it("registers no tools absent from toolInputSchemas", () => {
    for (const tool of tools) {
      expect(toolInputSchemas).toHaveProperty(tool.name);
      expect(tool.inputSchema).toBe(toolInputSchemas[tool.name as keyof typeof toolInputSchemas]);
    }
  });
});
