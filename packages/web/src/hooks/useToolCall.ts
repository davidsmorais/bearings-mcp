import {
  createToolError,
  isToolError,
  type ToolError,
  zodErrorToToolError,
} from "@bearings/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallHistory } from "@/lib/callHistory";
import { type CallMetrics, extractCallMetrics } from "@/lib/callMetrics";
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
  /** The raw MCP envelope's `_meta`, kept so the raw pane can show what arrived. */
  readonly meta: unknown;
  readonly durationMs: number;
  readonly metrics: CallMetrics;
}

/** Wraps a `ToolError` so React Query's `error` channel carries the typed value. */
export class ToolCallError extends Error {
  readonly toolError: ToolError;
  /**
   * Metrics for a call that failed at the server. Absent when the call never left the
   * browser (client-side validation) — there was no response, so there is no latency or
   * token count to report, and inventing a zero would be worse than showing nothing.
   */
  readonly metrics?: CallMetrics;

  constructor(toolError: ToolError, metrics?: CallMetrics) {
    super(toolError.message);
    this.name = "ToolCallError";
    this.toolError = toolError;
    this.metrics = metrics;
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
  const { record } = useCallHistory();

  return useMutation<ToolCallData, ToolCallError, ToolCallVariables>({
    mutationKey: toolKeys.calls(),
    mutationFn: async ({ name, input }) => {
      // Reject client-side with the server's own schema so the developer sees the
      // exact message an agent would get. No request leaves on a validation failure.
      // Formatted through zodErrorToToolError — the same function the server runs on
      // the same failure — so the form's message and this one cannot diverge.
      const parsed = toolInputSchemas[name].safeParse(input);
      if (!parsed.success) {
        throw new ToolCallError(zodErrorToToolError(parsed.error, input));
      }

      const client = await getMcpClient();
      const startedAt = performance.now();
      const result = await client.callTool({
        name,
        arguments: parsed.data as Record<string, unknown>,
      });
      const durationMs = performance.now() - startedAt;
      const metrics = extractCallMetrics(result, durationMs);

      if (result.isError) {
        const structured = result.structuredContent;
        throw new ToolCallError(
          isToolError(structured)
            ? structured
            : createToolError(
                "INTERNAL_ERROR",
                firstText(result.content) ?? "Tool call returned an error",
              ),
          // A server-side failure still burned latency and may have burned credits
          // before the failing domain — those numbers belong in the history either way.
          metrics,
        );
      }

      return {
        structuredContent: result.structuredContent,
        content: result.content,
        meta: result._meta,
        durationMs,
        metrics,
      };
    },
    onSuccess: (data, { name, input }) => {
      queryClient.setQueryData(toolKeys.call(name, input), data);
    },
    // onSettled, not onSuccess: a failed call is exactly the call a developer wants to
    // find in the history, and it carries real cost data of its own.
    onSettled: (data, error, { name, input }) => {
      // Back-dated from the measured duration rather than stamped at settle time, so a
      // slow call sorts by when it was fired, not when it finally came back.
      const durationMs = data?.durationMs ?? error?.metrics?.durationMs ?? 0;
      const startedAt = Date.now() - durationMs;
      if (data) {
        record({
          toolName: name,
          input,
          startedAt,
          outcome: {
            status: "success",
            structuredContent: data.structuredContent,
            content: data.content,
          },
          metrics: data.metrics,
        });
        return;
      }
      if (error) {
        record({
          toolName: name,
          input,
          startedAt,
          outcome: { status: "error", error: error.toolError },
          metrics: error.metrics ?? { durationMs: 0 },
        });
      }
    },
  });
};
