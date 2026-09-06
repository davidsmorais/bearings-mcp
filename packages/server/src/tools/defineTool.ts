import type { z } from "zod";

export type ToolDefinition<TSchema extends z.ZodObject<z.ZodRawShape>> = {
  /** Unique tool name, surfaced verbatim in tools/list. */
  name: string;
  description: string;
  inputSchema: TSchema;
  // Method syntax (not an arrow property) so a concrete tool stays assignable to
  // ToolDefinition<ZodObject<ZodRawShape>> when the registry holds them together.
  handler(input: z.infer<TSchema>): unknown | Promise<unknown>;
};

/**
 * Identity function that pins the generic so `handler`'s argument is the parsed
 * schema type and its return type is inferred — never `any`.
 */
export function defineTool<TSchema extends z.ZodObject<z.ZodRawShape>>(
  definition: ToolDefinition<TSchema>,
): ToolDefinition<TSchema> {
  return definition;
}
