import {
  isToolError,
  TOKEN_META_KEY,
  type TokenMeta,
  type ToolError,
  toToolError,
  zodErrorToToolError,
} from "@bearings/shared";
import { estimateTokens, TOKENIZER_ENCODING } from "@bearings/shared/tokens";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { tools } from "./registry.js";
import type { AnyToolSchema, ToolDefinition } from "./tools/defineTool.js";

function toolErrorToStructuredContent(error: ToolError): Record<string, unknown> {
  return error as unknown as Record<string, unknown>;
}

/**
 * `structuredContent` serialises to the identical JSON as `content[0].text` whenever a
 * handler returns a plain object, since the MCP spec recommends sending both for
 * compatibility. That means a host forwarding both to the model actually spends
 * `contentTokens * 2` — the honest worst case, not `contentTokens` alone. This is
 * computed from the already-serialised text so it applies uniformly to every tool and
 * to errors, without touching a single domain schema.
 */
function tokenMeta(
  text: string,
  hasStructuredContent: boolean,
): Record<typeof TOKEN_META_KEY, TokenMeta> {
  const contentTokens = estimateTokens(text);
  // Annotated as TokenMeta (the shared contract the inspector parses with) rather than
  // Record<string, unknown>, so a field renamed here fails to compile instead of
  // silently dropping the inspector's token display to "unavailable" at runtime.
  return {
    [TOKEN_META_KEY]: {
      approximate: true,
      tokenizer: TOKENIZER_ENCODING,
      contentTokens,
      structuredContentDuplicated: hasStructuredContent,
      worstCaseTokens: hasStructuredContent ? contentTokens * 2 : contentTokens,
    },
  };
}

function errorResult(error: ToolError): CallToolResult {
  const text = error.message;
  return {
    isError: true,
    content: [{ type: "text", text }],
    structuredContent: toolErrorToStructuredContent(error),
    _meta: tokenMeta(text, true),
  };
}

/**
 * Converts a tool's full Zod schema — refinements included — into the JSON Schema
 * advertised in tools/list. `effectStrategy: "input"` walks `.refine()` / `.superRefine()`
 * wrappers down to their underlying shape instead of dropping them, matching the
 * inspector's `zodToForm.ts` so the server and the web form generator render the same
 * schema for the same tool.
 */
function toolInputJsonSchema(schema: AnyToolSchema): Tool["inputSchema"] {
  const { $schema: _drop, ...jsonSchema } = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    effectStrategy: "input",
  }) as Record<string, unknown>;
  return jsonSchema as Tool["inputSchema"];
}

/**
 * Builds an MCP server from the tool registry. This is the seam both transports
 * share: they call `createServer()` and connect a transport to it, nothing more.
 * Registering a tool happens here once, so adding one never touches a transport.
 *
 * Built on the low-level `Server`, not `McpServer.registerTool`. The high-level API
 * validates arguments itself, against the same schema it renders for tools/list, and
 * throws a bare `McpError` on failure before any handler or formatter in this file
 * runs — that bypasses the `ToolError` envelope entirely for ordinary field
 * validation. Here validation is always ours: one `safeParse` per call, against the
 * tool's full schema, refinements included, always producing a `ToolError`.
 */
export function createServer(
  definitions: readonly ToolDefinition<AnyToolSchema>[] = tools,
): Server {
  const server = new Server(
    { name: "bearings-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const byName = new Map(definitions.map((tool) => [tool.name, tool] as const));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: definitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toolInputJsonSchema(tool.inputSchema),
    })),
  }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra): Promise<CallToolResult> => {
      const tool = byName.get(request.params.name);
      if (!tool) {
        throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
      }

      const parsed = tool.inputSchema.safeParse(request.params.arguments ?? {});
      if (!parsed.success) {
        return errorResult(zodErrorToToolError(parsed.error, request.params.arguments));
      }

      try {
        const value = await tool.handler(parsed.data, { signal: extra.signal });

        if (isToolError(value)) {
          return errorResult(value);
        }

        const text =
          value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
        const isPlainObject = typeof value === "object" && value !== null && !Array.isArray(value);

        return {
          content: [{ type: "text", text }],
          // structuredContent must be an object per the MCP spec.
          ...(isPlainObject ? { structuredContent: value as Record<string, unknown> } : {}),
          _meta: tokenMeta(text, isPlainObject),
        };
      } catch (error) {
        return errorResult(toToolError(error, parsed.data));
      }
    },
  );

  return server;
}
