import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./registry.js";

/**
 * Builds an MCP server from the tool registry. This is the seam both transports
 * share: they call `createServer()` and connect a transport to it, nothing more.
 * Registering a tool happens here once, so adding one never touches a transport.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: "bearings-mcp", version: "0.1.0" });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      // Pass the whole schema, not `.shape`: object-level `.refine()` / `.strict()`
      // on a shared schema must still run at this boundary.
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args): Promise<CallToolResult> => {
        // Handlers return a plain value; the MCP envelope is shaped here, once.
        const value = await tool.handler(args);
        const text = value === undefined ? "" : JSON.stringify(value);
        const isPlainObject = typeof value === "object" && value !== null && !Array.isArray(value);
        return {
          content: [{ type: "text", text }],
          // structuredContent must be an object per the MCP spec.
          ...(isPlainObject ? { structuredContent: value as Record<string, unknown> } : {}),
        };
      },
    );
  }

  return server;
}
