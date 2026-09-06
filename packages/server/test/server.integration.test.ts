import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tools } from "../src/registry.js";
import { createServer } from "../src/server.js";

describe("createServer over an in-memory transport", () => {
  let client: Client;

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "0" });
    await Promise.all([client.connect(clientTransport), createServer().connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("lists exactly the registered tools", async () => {
    const { tools: listed } = await client.listTools();
    expect(listed).toHaveLength(tools.length);
    expect(listed.map((t) => t.name).sort()).toEqual(
      tools
        .map((t) => t.name)
        .slice()
        .sort(),
    );
  });

  it("exposes echo with a JSON Schema for its input", async () => {
    const { tools: listed } = await client.listTools();
    const echo = listed.find((t) => t.name === "echo");
    expect(echo).toBeDefined();
    expect(echo?.inputSchema.type).toBe("object");
    expect(echo?.inputSchema.properties).toHaveProperty("message");
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
