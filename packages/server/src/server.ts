import { isToolError } from "@bearings/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./registry.js";
import type { AnyToolSchema, ToolDefinition } from "./tools/defineTool.js";

/**
 * Normalizes a schema for the MCP SDK.
 * If the schema is a ZodEffects (e.g. from .refine()), expose .shape from the underlying
 * schema so the SDK's `normalizeObjectSchema` can generate proper JSON Schema in tools/list.
 */
function normalizeSchemaForSdk(schema: AnyToolSchema): AnyToolSchema {
  if ("_def" in schema && schema._def && "schema" in schema._def && !("shape" in schema)) {
    const inner = (schema._def as { schema: unknown }).schema;
    if (inner && typeof inner === "object" && "shape" in inner) {
      Object.defineProperty(schema, "shape", {
        get: () => (inner as { shape: unknown }).shape,
        configurable: true,
      });
    }
  }
  return schema;
}

/**
 * Builds an MCP server from the tool registry. This is the seam both transports
 * share: they call `createServer()` and connect a transport to it, nothing more.
 * Registering a tool happens here once, so adding one never touches a transport.
 */
export function createServer(
  definitions: readonly ToolDefinition<AnyToolSchema>[] = tools,
): McpServer {
  const server = new McpServer({ name: "bearings-mcp", version: "0.1.0" });

  for (const tool of definitions) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: normalizeSchemaForSdk(tool.inputSchema),
      },
      async (args, extra): Promise<CallToolResult> => {
        try {
          const value = await tool.handler(args, { signal: extra?.signal });

          if (isToolError(value)) {
            return {
              isError: true,
              content: [{ type: "text", text: value.message }],
              structuredContent: value as unknown as Record<string, unknown>,
            };
          }

          const text =
            value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
          const isPlainObject =
            typeof value === "object" && value !== null && !Array.isArray(value);

          return {
            content: [{ type: "text", text }],
            // structuredContent must be an object per the MCP spec.
            ...(isPlainObject ? { structuredContent: value as Record<string, unknown> } : {}),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            isError: true,
            content: [{ type: "text", text: `Internal tool execution error: ${message}` }],
            structuredContent: {
              isError: true,
              code: "INTERNAL_ERROR",
              message,
            },
          };
        }
      },
    );
  }

  return server;
}
