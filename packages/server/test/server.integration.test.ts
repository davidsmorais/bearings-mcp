import { ambiguous, notFound, ToolErrorCode, toolInputSchemas } from "@bearings/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tools } from "../src/registry.js";
import { createServer } from "../src/server.js";
import { defineTool } from "../src/tools/defineTool.js";
import { resolveDestination } from "../src/upstream/nominatim.js";

vi.mock("../src/upstream/nominatim.js", () => ({
  resolveDestination: vi.fn(),
}));

const mockedResolveDestination = vi.mocked(resolveDestination);

describe("createServer over an in-memory transport", () => {
  let client: Client;
  let server: Server;

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

  it("rejects an invalid echo argument before the handler runs, as a structured ToolError", async () => {
    const result = await client.callTool({ name: "echo", arguments: { message: "" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: ToolErrorCode.INVALID_INPUT,
      field: "message",
      message: 'message must be at least 1 characters, received "" (0)',
    });
    expect(result.content).toEqual([
      { type: "text", text: 'message must be at least 1 characters, received "" (0)' },
    ]);
  });

  it("rejects an unknown tool name", async () => {
    await expect(client.callTool({ name: "not_a_real_tool", arguments: {} })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("createServer error handling and schema extensions", () => {
  let client: Client;
  let server: Server;

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
  let server: Server;

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

  it.each(["get_destination_brief", "analyse_neighbourhood"] as const)(
    "%s returns INTERNAL_ERROR via MCP",
    async (name) => {
      const args =
        name === "get_destination_brief"
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
    for (const name of ["get_destination_brief", "analyse_neighbourhood"] as const) {
      const tool = listed.find((t) => t.name === name);
      expect(tool?.description).toMatch(/^Not yet implemented — /);
    }
  });
});

describe("resolve_destination over an in-memory transport", () => {
  let client: Client;
  let server: Server;

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-resolve", version: "0" });
    server = createServer();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await client.close();
    await server.close();
  });

  it("returns the brief-shaped location as structuredContent for a confident match", async () => {
    mockedResolveDestination.mockResolvedValue({
      name: "Lisbon",
      coordinates: { lat: 38.7077507, lon: -9.1365919 },
      countryCode: "PT",
      displayName: "Lisbon, Portugal",
      admin: { county: "Lisbon", municipality: "Lisbon" },
      kind: "city",
      importance: 0.76,
      placeRank: 14,
      boundingBox: [38.69, 38.79, -9.22, -9.08],
      osmType: "relation",
      osmId: 5400890,
    });

    const result = await client.callTool({
      name: "resolve_destination",
      arguments: { query: "Lisbon" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      name: "Lisbon",
      coordinates: { lat: 38.7077507, lon: -9.1365919 },
      countryCode: "PT",
      displayName: "Lisbon, Portugal",
      admin: { county: "Lisbon", municipality: "Lisbon" },
    });
  });

  it("surfaces AMBIGUOUS as isError with the code and candidates in structuredContent", async () => {
    const candidate = (name: string, importance: number) => ({
      location: {
        name,
        coordinates: { lat: 1, lon: 1 },
        countryCode: "US" as const,
        admin: { state: name },
        kind: "city" as const,
      },
      importance,
      kind: "city" as const,
    });
    mockedResolveDestination.mockResolvedValue(
      ambiguous('"Springfield" matched 2 places; specify which', [
        candidate("Springfield IL", 0.61),
        candidate("Springfield MO", 0.6),
      ]),
    );

    const result = await client.callTool({
      name: "resolve_destination",
      arguments: { query: "Springfield" },
    });

    expect(result.isError).toBe(true);
    const structured = result.structuredContent as { code: string; candidates: unknown[] };
    expect(structured.code).toBe("AMBIGUOUS");
    expect(structured.candidates).toHaveLength(2);
  });

  it("rejects a 1-character query before the upstream is called", async () => {
    const result = await client.callTool({
      name: "resolve_destination",
      arguments: { query: "a" },
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe(ToolErrorCode.INVALID_INPUT);
    expect(mockedResolveDestination).not.toHaveBeenCalled();
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
