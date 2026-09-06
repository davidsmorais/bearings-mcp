import { isToolError, type ToolError, toToolError, zodErrorToToolError } from "@bearings/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { tools } from "./registry.js";
import type { AnyToolSchema, ToolDefinition } from "./tools/defineTool.js";

/**
 * Unwraps `.refine()` / `.superRefine()` wrappers (`ZodEffects`) to reach the
 * underlying object schema. The SDK generates the `tools/list` JSON Schema and
 * validates fields from this object; the full schema (refinements included) is
 * still enforced in the handler wrapper below.
 */
function resolveObjectSchema(schema: AnyToolSchema): z.ZodObject<z.ZodRawShape> {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = current.innerType();
  }
  if (!(current instanceof z.ZodObject)) {
    throw new Error("Tool inputSchema must be a ZodObject, optionally wrapped in .refine()");
  }
  return current;
}

function toolErrorToStructuredContent(error: ToolError): Record<string, unknown> {
  return error as unknown as Record<string, unknown>;
}

function errorResult(error: ToolError): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: error.message }],
    structuredContent: toolErrorToStructuredContent(error),
  };
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
    const objectSchema = resolveObjectSchema(tool.inputSchema);
    // Only re-validate when the tool schema carries refinements the SDK won't see.
    const hasRefinements = tool.inputSchema !== objectSchema;

    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: objectSchema },
      async (args, extra): Promise<CallToolResult> => {
        if (hasRefinements) {
          const refined = tool.inputSchema.safeParse(args);
          if (!refined.success) {
            return errorResult(zodErrorToToolError(refined.error, args));
          }
        }

        try {
          const value = await tool.handler(args, { signal: extra?.signal });

          if (isToolError(value)) {
            return errorResult(value);
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
          return errorResult(toToolError(error));
        }
      },
    );
  }

  return server;
}
