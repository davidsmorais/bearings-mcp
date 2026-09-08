import {
  type GetDestinationBriefInput,
  notFound,
  ToolErrorCode,
  toolInputSchemas,
} from "@bearings/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createHttpCore } from "../src/http/client.js";
import { tools } from "../src/registry.js";
import { createServer } from "../src/server.js";
import { defineTool } from "../src/tools/defineTool.js";
import { composeDestinationBrief } from "../src/tools/getDestinationBrief.js";
import nagerFixture from "./fixtures/nager.json";
import openMeteoFixture from "./fixtures/open-meteo.json";

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

  it.each(["resolve_destination", "analyse_neighbourhood"] as const)(
    "%s returns INTERNAL_ERROR via MCP",
    async (name) => {
      const args =
        name === "resolve_destination"
          ? { query: "Paris" }
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
    for (const name of ["resolve_destination", "analyse_neighbourhood"] as const) {
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

describe("get_destination_brief through the server envelope", () => {
  const instantClock = { now: () => 0, sleep: async () => {} };
  const at = (isoDate: string) => () => new Date(`${isoDate}T12:00:00Z`);

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  /** One scripted fetch for both upstreams, keyed by hostname (not full path). */
  const hostRouter =
    (handlers: { openMeteo: () => Response; nager: () => Response }) =>
    async (input: string | URL | Request) => {
      const host = new URL(String(input)).hostname;
      if (host === "api.open-meteo.com") return handlers.openMeteo();
      if (host === "date.nager.at") return handlers.nager();
      throw new Error(`unexpected host ${host}`);
    };

  const briefInput: GetDestinationBriefInput = {
    location: {
      name: "Vienna",
      coordinates: { lat: 48.2082, lon: 16.3738 },
      countryCode: "AT",
    },
    stay: { start: "2026-09-08", end: "2026-09-10" },
    detail: "full",
  };

  // Wires the real handler logic to an injected offline HTTP core; the point under test
  // is the createServer() envelope, not the network.
  const serverWith = (fetch: typeof globalThis.fetch) => {
    const core = createHttpCore({ fetch, clock: instantClock });
    return createServer([
      defineTool({
        name: "get_destination_brief",
        description: "test wiring",
        inputSchema: toolInputSchemas.get_destination_brief,
        handler: (input) =>
          composeDestinationBrief(input as GetDestinationBriefInput, {
            core,
            now: at("2026-09-08"),
          }),
      }),
    ]);
  };

  let client: Client;
  let server: Server;

  const connect = async (fetch: typeof globalThis.fetch) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-brief", version: "0" });
    server = serverWith(fetch);
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  };

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("returns structuredContent and no isError when only one upstream fails", async () => {
    await connect(
      hostRouter({
        openMeteo: () => new Response("upstream boom", { status: 500 }),
        nager: () => jsonResponse(nagerFixture.publicHolidays2026AT),
      }) as typeof globalThis.fetch,
    );

    const result = await client.callTool({ name: "get_destination_brief", arguments: briefInput });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toBeDefined();
    const sources = structured.sources as Record<string, { status: string }>;
    expect(sources.openMeteo.status).toBe("unavailable");
    expect(sources.nager.status).toBe("ok");
    expect(structured.forecast).toBeUndefined();
    expect(Array.isArray(structured.holidays)).toBe(true);
  });

  it("returns isError when both upstreams fail", async () => {
    await connect(
      hostRouter({
        openMeteo: () => new Response("upstream boom", { status: 500 }),
        nager: () => new Response("upstream boom", { status: 500 }),
      }) as typeof globalThis.fetch,
    );

    const result = await client.callTool({ name: "get_destination_brief", arguments: briefInput });

    expect(result.isError).toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
    expect((structured.details as Record<string, unknown>).alsoFailed).toBeDefined();
  });

  it("returns the full brief with both sources ok when both upstreams succeed", async () => {
    await connect(
      hostRouter({
        openMeteo: () => jsonResponse(openMeteoFixture),
        nager: () => jsonResponse(nagerFixture.publicHolidays2026AT),
      }) as typeof globalThis.fetch,
    );

    const result = await client.callTool({ name: "get_destination_brief", arguments: briefInput });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.forecast).toBeDefined();
    const sources = structured.sources as Record<string, { status: string }>;
    expect(sources.openMeteo.status).toBe("ok");
    expect(sources.nager.status).toBe("ok");
  });
});
