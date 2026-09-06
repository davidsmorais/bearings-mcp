import type { z } from "zod";

/**
 * Execution context supplied by the transport layer to tool handlers.
 */
export interface ToolContext {
  /** Abort signal triggered if the client disconnects or cancels the request. */
  readonly signal?: AbortSignal;
}

/**
 * Accepted input schema type for tools. Supports object schemas as well as
 * schemas wrapped in `.refine()` / `.superRefine()` (`z.ZodEffects`).
 */
export type AnyToolSchema = z.ZodTypeAny;

export type ToolDefinition<TSchema extends AnyToolSchema = AnyToolSchema> = {
  /** Unique tool name, surfaced verbatim in tools/list. */
  name: string;
  description: string;
  inputSchema: TSchema;
  // Method syntax (not an arrow property) so a concrete tool stays assignable to
  // ToolDefinition in heterogeneous arrays like the registry.
  handler(input: z.infer<TSchema>, context?: ToolContext): unknown | Promise<unknown>;
};

/**
 * Identity function that pins the generic so `handler`'s argument is the parsed
 * schema type and its return type is inferred — never `any`.
 */
export function defineTool<TSchema extends AnyToolSchema>(
  definition: ToolDefinition<TSchema>,
): ToolDefinition<TSchema> {
  return definition;
}
