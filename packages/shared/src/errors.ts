import type { Location } from "./types/location.js";

export enum ToolErrorCode {
  INVALID_INPUT = "INVALID_INPUT",
  AMBIGUOUS = "AMBIGUOUS",
  RATE_LIMITED = "RATE_LIMITED",
  UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT",
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",
  NOT_FOUND = "NOT_FOUND",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export type ToolError =
  | {
      readonly code: ToolErrorCode.INVALID_INPUT;
      readonly message: string;
      readonly field: string;
    }
  | {
      readonly code: ToolErrorCode.AMBIGUOUS;
      readonly message: string;
      readonly candidates: readonly Location[];
    }
  | {
      readonly code: ToolErrorCode.RATE_LIMITED;
      readonly message: string;
      readonly upstream: string;
      readonly retryAfterMs: number;
    }
  | {
      readonly code: ToolErrorCode.UPSTREAM_TIMEOUT;
      readonly message: string;
      readonly upstream: string;
      readonly timeoutMs: number;
    }
  | {
      readonly code: ToolErrorCode.QUOTA_EXCEEDED;
      readonly message: string;
      readonly upstream: string;
      readonly resetsAt?: string;
    }
  | { readonly code: ToolErrorCode.NOT_FOUND; readonly message: string }
  | { readonly code: ToolErrorCode.INTERNAL_ERROR; readonly message: string };

const toolErrorCodes = Object.values(ToolErrorCode);

export function isToolError(value: unknown): value is ToolError {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    toolErrorCodes.includes(record.code as ToolErrorCode) && typeof record.message === "string"
  );
}

export function invalidInput(message: string, field: string): ToolError {
  return { code: ToolErrorCode.INVALID_INPUT, message, field };
}

export function ambiguous(message: string, candidates: readonly Location[]): ToolError {
  return { code: ToolErrorCode.AMBIGUOUS, message, candidates };
}

export function rateLimited(message: string, upstream: string, retryAfterMs: number): ToolError {
  return {
    code: ToolErrorCode.RATE_LIMITED,
    message,
    upstream,
    retryAfterMs,
  };
}

export function upstreamTimeout(message: string, upstream: string, timeoutMs: number): ToolError {
  return {
    code: ToolErrorCode.UPSTREAM_TIMEOUT,
    message,
    upstream,
    timeoutMs,
  };
}

export function quotaExceeded(message: string, upstream: string, resetsAt?: string): ToolError {
  return {
    code: ToolErrorCode.QUOTA_EXCEEDED,
    message,
    upstream,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

export function notFound(message: string): ToolError {
  return { code: ToolErrorCode.NOT_FOUND, message };
}

export function internalError(message: string): ToolError {
  return { code: ToolErrorCode.INTERNAL_ERROR, message };
}
