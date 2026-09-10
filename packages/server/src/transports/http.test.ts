import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFaults } from "../http/faults.js";
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

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "raw", version: "0" },
  },
});

/** Raw request with a caller-set Host header — `fetch` silently drops Host overrides. */
const rawRequest = (
  port: number,
  {
    method = "POST",
    path = "/mcp",
    host,
    body,
  }: { method?: string; path?: string; host: string; body?: string },
): Promise<{ status: number }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          Host: host,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(body ? { "content-length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });

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

  it("rejects a request whose Host header is off the allowlist with 403", async () => {
    const rebound = await rawRequest(handle.port, {
      host: "evil.example.com",
      body: INITIALIZE_BODY,
    });
    expect(rebound.status).toBe(403);

    // The same request against a loopback Host is not blocked by the guard.
    const loopback = await rawRequest(handle.port, {
      host: `127.0.0.1:${handle.port}`,
      body: INITIALIZE_BODY,
    });
    expect(loopback.status).not.toBe(403);
  });
});

describe("startHttpTransport — session bounds", () => {
  let handle: HttpTransportHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("refuses a new initialize once the session ceiling is reached", async () => {
    handle = await startHttpTransport({ port: 0, host: "127.0.0.1", maxSessions: 1 });

    const first = await connectRawInitialize(handle.port);
    expect(first.status).toBe(200);

    const second = await connectRawInitialize(handle.port);
    expect(second.status).toBe(503);
  });

  it("sweeps an idle session on the next initialize, and its id then 404s", async () => {
    handle = await startHttpTransport({
      port: 0,
      host: "127.0.0.1",
      maxSessions: 8,
      sessionIdleMs: 1,
    });
    const baseUrl = `http://127.0.0.1:${handle.port}`;

    const client = new Client({ name: "idle-victim", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);
    const staleId = transport.sessionId as string;
    expect(staleId).toBeDefined();

    // Let the 1 ms idle window lapse, then trigger a sweep with a fresh initialize.
    await new Promise((r) => setTimeout(r, 10));
    await connectRawInitialize(handle.port);

    const reused = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": staleId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    });
    expect(reused.status).toBe(404);

    await transport.close();
  });
});

/** Fires a bare initialize POST and resolves its status — used to fill session slots. */
const connectRawInitialize = (port: number): Promise<{ status: number }> =>
  rawRequest(port, { host: `127.0.0.1:${port}`, body: INITIALIZE_BODY });

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

describe("dev fault-injection route", () => {
  let handle: HttpTransportHandle | undefined;

  const start = async () => {
    handle = await startHttpTransport({
      port: 0,
      host: "127.0.0.1",
      allowedOrigins: [ALLOWED_ORIGIN],
    });
    return `http://127.0.0.1:${handle.port}`;
  };

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    delete process.env.BEARINGS_FAULT_INJECTION;
    clearFaults();
  });

  it("does not exist when BEARINGS_FAULT_INJECTION is unset", async () => {
    delete process.env.BEARINGS_FAULT_INJECTION;
    const baseUrl = await start();

    // 404, not 403: an unarmed flag leaves no surface at all rather than one that
    // advertises itself by refusing.
    expect((await fetch(`${baseUrl}/__dev/faults`)).status).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/__dev/faults`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ faults: { geoapify: "timeout" } }),
        })
      ).status,
    ).toBe(404);
  });

  it("arms and reports faults when the flag is set", async () => {
    process.env.BEARINGS_FAULT_INJECTION = "1";
    const baseUrl = await start();

    const posted = await fetch(`${baseUrl}/__dev/faults`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faults: { geoapify: "quota_exceeded" } }),
    });

    expect(posted.status).toBe(200);
    expect(await posted.json()).toEqual({ faults: { geoapify: "quota_exceeded" } });

    const read = await fetch(`${baseUrl}/__dev/faults`);
    expect(await read.json()).toEqual({ faults: { geoapify: "quota_exceeded" } });
  });

  it("rejects an invalid fault map instead of storing it", async () => {
    process.env.BEARINGS_FAULT_INJECTION = "1";
    const baseUrl = await start();

    const response = await fetch(`${baseUrl}/__dev/faults`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faults: { geoapify: "explode" } }),
    });

    expect(response.status).toBe(400);
    expect(await (await fetch(`${baseUrl}/__dev/faults`)).json()).toEqual({ faults: {} });
  });

  it("clears every fault on an empty map", async () => {
    process.env.BEARINGS_FAULT_INJECTION = "1";
    const baseUrl = await start();

    await fetch(`${baseUrl}/__dev/faults`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faults: { nager: "timeout" } }),
    });
    await fetch(`${baseUrl}/__dev/faults`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faults: {} }),
    });

    expect(await (await fetch(`${baseUrl}/__dev/faults`)).json()).toEqual({ faults: {} });
  });
});
