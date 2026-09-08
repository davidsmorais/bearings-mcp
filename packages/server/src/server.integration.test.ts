import {
  ambiguous,
  type GetDestinationBriefInput,
  notFound,
  ToolErrorCode,
  toolInputSchemas,
} from "@bearings/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import nagerFixture from "../test/fixtures/nager.json";
import openMeteoFixture from "../test/fixtures/open-meteo.json";
import { createHttpCore } from "./http/client.js";
import { tools } from "./registry.js";
import { createServer } from "./server.js";
import { defineTool } from "./tools/defineTool.js";
import { composeDestinationBrief } from "./tools/getDestinationBrief.js";
import { resolveDestination } from "./upstream/nominatim.js";

/** `_meta` key the approximate per-response token count rides on (Phase 2, DMS-501). */
const TOKEN_META_KEY = "bearings/tokens";

interface TokenMeta {
  readonly approximate: boolean;
  readonly tokenizer: string;
  readonly contentTokens: number;
  readonly structuredContentDuplicated: boolean;
  readonly worstCaseTokens: number;
}

const tokenMetaOf = (result: { _meta?: Record<string, unknown> }): TokenMeta =>
  result._meta?.[TOKEN_META_KEY] as TokenMeta;

vi.mock("./upstream/nominatim.js", () => ({
  resolveDestination: vi.fn(),
}));

vi.mock("./upstream/geoapify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./upstream/geoapify.js")>();
  return {
    ...actual,
    searchPlaces: vi.fn(async () => ({
      places: [],
      meta: { hostId: "geoapify" as const, cacheHit: false, attempts: 1, durationMs: 0 },
      // cacheHit: false ⇒ the request was billed one credit.
      credits: 1,
    })),
  };
});

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

    const meta = tokenMetaOf(result);
    expect(meta.approximate).toBe(true);
    expect(meta.tokenizer).toBe("o200k_base");
    expect(meta.contentTokens).toBeGreaterThan(0);
    expect(meta.structuredContentDuplicated).toBe(true);
    expect(meta.worstCaseTokens).toBe(meta.contentTokens * 2);
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

    // A failure carries a token cost too — an agent (and the inspector) can see it.
    const meta = tokenMetaOf(result);
    expect(meta.approximate).toBe(true);
    expect(meta.contentTokens).toBeGreaterThan(0);
    expect(meta.structuredContentDuplicated).toBe(true);
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
    defineTool({
      name: "returnsString",
      description: "Returns a bare string, not an object.",
      inputSchema: z.object({}),
      handler: () => "just a string",
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

  it("reports structuredContentDuplicated: false when the handler returns a non-object", async () => {
    const result = await client.callTool({ name: "returnsString", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "just a string" }]);

    const meta = tokenMetaOf(result);
    expect(meta.approximate).toBe(true);
    expect(meta.structuredContentDuplicated).toBe(false);
    expect(meta.worstCaseTokens).toBe(meta.contentTokens);
  });
});

describe("analyse_neighbourhood over an in-memory transport", () => {
  let client: Client;
  let server: Server;

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-analyse", version: "0" });
    server = createServer();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("returns a valid brief profile via MCP", async () => {
    const result = await client.callTool({
      name: "analyse_neighbourhood",
      arguments: {
        coordinates: { lat: 38.7003, lon: -9.421 },
        categories: ["nightlife"],
      },
    });
    expect(result.isError).toBeFalsy();
    const profile = result.structuredContent as {
      detail?: string;
      domains?: unknown;
      credits?: { consumed?: number };
    };
    expect(profile.detail).toBe("brief");
    expect(profile.domains).toBeDefined();
    // The mocked searchPlaces reports credits: 1 (cacheHit: false); one domain queried.
    expect(profile.credits?.consumed).toBe(1);

    const meta = tokenMetaOf(result);
    expect(meta.approximate).toBe(true);
    expect(meta.contentTokens).toBeGreaterThan(0);
    expect(meta.structuredContentDuplicated).toBe(true);
  });

  it("advertises a real tool description", async () => {
    const { tools: listed } = await client.listTools();
    const tool = listed.find((t) => t.name === "analyse_neighbourhood");
    expect(tool?.description).not.toMatch(/^Not yet implemented — /);
    expect(tool?.description).toContain("sources");
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
