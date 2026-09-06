import { createToolError, isToolError, type ToolError } from "@bearings/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getMcpClient } from "@/lib/mcpClient";
import { toolKeys } from "@/lib/queryKeys";
import { type ToolName, toolInputSchemas } from "@/lib/toolSchemas";

export interface ToolCallVariables {
  readonly name: ToolName;
  readonly input: unknown;
}

export interface ToolCallData {
  readonly structuredContent: unknown;
  readonly content: unknown;
  readonly durationMs: number;
}

/** Wraps a `ToolError` so React Query's `error` channel carries the typed value. */
export class ToolCallError extends Error {
  readonly toolError: ToolError;

  constructor(toolError: ToolError) {
    super(toolError.message);
    this.name = "ToolCallError";
    this.toolError = toolError;
  }
}

const firstText = (content: unknown): string | undefined => {
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const part of content) {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      return (part as { text: string }).text;
    }
  }
  return undefined;
};

export const useToolCall = () => {
  const queryClient = useQueryClient();

  return useMutation<ToolCallData, ToolCallError, ToolCallVariables>({
    mutationKey: toolKeys.calls(),
    mutationFn: async ({ name, input }) => {
      // Reject client-side with the server's own schema so the developer sees the
      // exact message an agent would get. No request leaves on a validation failure.
      const parsed = toolInputSchemas[name].safeParse(input);
      if (!parsed.success) {
        const message = parsed.error.issues.map((issue) => issue.message).join("; ");
        throw new ToolCallError(createToolError("INVALID_INPUT", message));
      }

      const client = await getMcpClient();
      const startedAt = performance.now();
      const result = await client.callTool({
        name,
        arguments: parsed.data as Record<string, unknown>,
      });
      const durationMs = performance.now() - startedAt;

      if (result.isError) {
        const structured = result.structuredContent;
        throw new ToolCallError(
          isToolError(structured)
            ? structured
            : createToolError(
                "INTERNAL_ERROR",
                firstText(result.content) ?? "Tool call returned an error",
              ),
        );
      }

      return {
        structuredContent: result.structuredContent,
        content: result.content,
        durationMs,
      };
    },
    onSuccess: (data, { name, input }) => {
      queryClient.setQueryData(toolKeys.call(name, input), data);
    },
  });
};
