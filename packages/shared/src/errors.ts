/**
 * Canonical error codes for Bearings MCP tools.
 * Error codes are additive per packages/shared/AGENTS.md.
 */
export type ToolErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "INTERNAL_ERROR";

/**
 * Structured tool error returned by tool handlers (Architecture Invariant 4).
 * Handlers return this instead of throwing; transports map it to MCP error envelopes.
 */
export interface ToolError {
  readonly isError: true;
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export function isToolError(value: unknown): value is ToolError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).isError === true &&
    typeof (value as Record<string, unknown>).code === "string" &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}

export function createToolError(
  code: ToolErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ToolError {
  return {
    isError: true,
    code,
    message,
    ...(details ? { details } : {}),
  };
}
