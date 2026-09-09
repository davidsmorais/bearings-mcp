#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { assertRequiredEnv, loadEnvFile } from "../env.js";
import { createServer } from "../server.js";

export interface StdioTransportHandle {
  close(): Promise<void>;
}

/** Connects the stdio transport to a fresh registry-backed server. Wiring only. */
export async function startStdioTransport(): Promise<StdioTransportHandle> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  // stdout carries the JSON-RPC stream; status lines go to stderr only.
  console.error("bearings-mcp stdio transport ready");

  return {
    close: async () => {
      try {
        await server.close();
      } catch {
        // Ignored during process teardown
      }
    },
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  assertRequiredEnv();
  const handle = await startStdioTransport();

  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Lets cli.ts import startStdioTransport without booting a transport as a side
// effect of the import, while `node dist/transports/stdio.js` — every existing
// Claude Desktop / Cursor config points here — keeps working byte-for-byte.
// realpathSync matters: an installed bin (package.json's "bin" field) is a
// symlink, so argv[1] is the symlink path while import.meta.url resolves to
// the real file — a bare === would never match and main() would silently
// never run.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
