import type { AnyToolSchema, ToolDefinition } from "./tools/defineTool.js";
import { echoTool } from "./tools/echo.js";

/** Throws if two tools share a name — a silent overwrite would make tools/list lie. */
export function assertUniqueToolNames(definitions: readonly ToolDefinition<AnyToolSchema>[]): void {
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.name)) {
      throw new Error(`Duplicate tool name in registry: "${definition.name}"`);
    }
    seen.add(definition.name);
  }
}

/**
 * The single source of truth for tool registration (Architecture Invariant 1).
 * Both transports read from here; neither holds its own list. Adding a tool means
 * adding an import and an array entry — no transport change.
 */
export const tools: readonly ToolDefinition<AnyToolSchema>[] = [echoTool];

assertUniqueToolNames(tools);
