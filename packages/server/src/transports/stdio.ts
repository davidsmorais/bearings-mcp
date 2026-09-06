#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../server.js";

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdout carries the JSON-RPC stream; status lines go to stderr only.
  console.error("bearings-mcp stdio transport ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
