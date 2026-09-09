import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_MCP_URL = "http://127.0.0.1:3000/mcp";

/** The configured MCP endpoint. Exported so sibling dev routes resolve against it. */
export const getMcpUrl = (): URL =>
  new URL(import.meta.env.VITE_BEARINGS_MCP_URL ?? DEFAULT_MCP_URL);

const endpoint = getMcpUrl;

// The SDK Client is a stateful long-lived object and React StrictMode double-mounts
// in dev. Memoising the connection *promise* (not the client) means the second call
// awaits the first connect instead of opening a second transport. On rejection the
// memo is cleared so the next call retries — otherwise a connect that failed before
// the server was up would need a page reload to recover.
let connection: Promise<Client> | undefined;

export const getMcpClient = (): Promise<Client> => {
  connection ??= (async () => {
    const client = new Client({ name: "bearings-inspector", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(endpoint()));
    return client;
  })().catch((err) => {
    connection = undefined;
    throw err;
  });
  return connection;
};
