#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { assertRequiredEnv } from "../env.js";
import { createServer } from "../server.js";

async function main(): Promise<void> {
  assertRequiredEnv();
  const server = createServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // Ignored during process teardown
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  // stdout carries the JSON-RPC stream; status lines go to stderr only.
  console.error("bearings-mcp stdio transport ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
