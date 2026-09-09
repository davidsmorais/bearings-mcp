import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tools } from "../registry.js";
import { createServer } from "../server.js";
import { type HttpTransportHandle, startHttpTransport } from "./http.js";

// Neither tool exercised in this file reaches an upstream, but createServer()
// registers the full tool set (including resolve_destination and
// analyse_neighbourhood), and root AGENTS.md forbids a test that can reach the
// network. Mocked at the same boundary as server.integration.test.ts.
vi.mock("../upstream/nominatim.js", () => ({
  resolveDestination: vi.fn(),
}));

vi.mock("../upstream/geoapify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../upstream/geoapify.js")>();
  return {
    ...actual,
    searchPlaces: vi.fn(async () => ({
      places: [],
      meta: { hostId: "geoapify" as const, cacheHit: false, attempts: 1, durationMs: 0 },
      credits: 1,
    })),
  };
});

const ALLOWED_ORIGIN = "http://localhost:5173";
const DISALLOWED_ORIGIN = "http://evil.example.com";

describe("startHttpTransport", () => {
  let handle: HttpTransportHandle;
  let baseUrl: string;

  beforeEach(async () => {
    handle = await startHttpTransport({
      port: 0,
      host: "127.0.0.1",
      allowedOrigins: [ALLOWED_ORIGIN],
    });
    baseUrl = `http://127.0.0.1:${handle.port}`;
  });

  afterEach(async () => {
    await handle.close();
  });

  const connectClient = async (name: string) => {
    const client = new Client({ name, version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);
    return { client, transport };
  };

  it("lists exactly the registered tools", async () => {
    const { client } = await connectClient("test-list");
    const { tools: listed } = await client.listTools();
    expect(listed).toHaveLength(tools.length);
    expect(listed.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
    await client.close();
  });

  it("issues a session id on initialize and reuses it on the next call", async () => {
    const { client, transport } = await connectClient("test-session");
    const sessionId = transport.sessionId;
    expect(sessionId).toBeDefined();

    await client.listTools();
    expect(transport.sessionId).toBe(sessionId);
    await client.close();
  });

  it("gives two clients distinct sessions that don't observe each other", async () => {
    const first = await connectClient("test-a");
    const second = await connectClient("test-b");

    expect(first.transport.sessionId).toBeDefined();
    expect(second.transport.sessionId).toBeDefined();
    expect(first.transport.sessionId).not.toBe(second.transport.sessionId);

    const resultA = await first.client.callTool({
      name: "echo",
      arguments: { message: "from-a" },
    });
    const resultB = await second.client.callTool({
      name: "echo",
      arguments: { message: "from-b" },
    });
    expect(resultA.structuredContent).toEqual({ message: "from-a" });
    expect(resultB.structuredContent).toEqual({ message: "from-b" });

    await first.transport.terminateSession();

    // Terminating the first session must not disturb the second, still-open one.
    const resultB2 = await second.client.callTool({
      name: "echo",
      arguments: { message: "still-alive" },
    });
    expect(resultB2.structuredContent).toEqual({ message: "still-alive" });

    await first.client.close();
    await second.client.close();
  });

  it("rejects a POST that reuses a terminated session id", async () => {
    const { transport } = await connectClient("test-terminate");
    const sessionId = transport.sessionId;
    expect(sessionId).toBeDefined();

    await transport.terminateSession();

    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId as string,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 with a JSON-RPC error body for a sessionless, non-initialize POST", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 }, id: null });
  });

  it("returns 404 for an unknown path", async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("reflects an allowlisted origin and exposes mcp-session-id on preflight", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: { origin: ALLOWED_ORIGIN, "access-control-request-method": "POST" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("access-control-expose-headers")).toContain("mcp-session-id");
  });

  it("carries no allow-origin header on preflight from a disallowed origin", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: { origin: DISALLOWED_ORIGIN, "access-control-request-method": "POST" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("HTTP and in-memory transports produce identical CallToolResults", () => {
  let httpHandle: HttpTransportHandle;
  let httpClient: Client;
  let inMemoryClient: Client;
  let inMemoryServer: Server;

  beforeEach(async () => {
    httpHandle = await startHttpTransport({
      port: 0,
      host: "127.0.0.1",
      allowedOrigins: [ALLOWED_ORIGIN],
    });
    httpClient = new Client({ name: "parity-http", version: "0" });
    await httpClient.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpHandle.port}/mcp`)),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    inMemoryClient = new Client({ name: "parity-inmemory", version: "0" });
    inMemoryServer = createServer();
    await Promise.all([
      inMemoryClient.connect(clientTransport),
      inMemoryServer.connect(serverTransport),
    ]);
  });

  afterEach(async () => {
    await httpClient.close();
    await httpHandle.close();
    await inMemoryClient.close();
    await inMemoryServer.close();
  });

  it("returns a deep-equal CallToolResult for a successful echo call", async () => {
    const args = { name: "echo", arguments: { message: "parity check" } };
    const httpResult = await httpClient.callTool(args);
    const inMemoryResult = await inMemoryClient.callTool(args);
    expect(httpResult).toEqual(inMemoryResult);
  });

  it("returns a deep-equal ToolError envelope for the same validation failure", async () => {
    const args = { name: "echo", arguments: { message: "" } };
    const httpResult = await httpClient.callTool(args);
    const inMemoryResult = await inMemoryClient.callTool(args);
    expect(httpResult.isError).toBe(true);
    expect(httpResult).toEqual(inMemoryResult);
  });
});
