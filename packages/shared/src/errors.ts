import type { LocationCandidate } from "./types/resolvedLocation.js";

/**
 * Canonical error codes for Bearings MCP tools.
 * Error codes are additive per packages/shared/AGENTS.md.
 */
export enum ToolErrorCode {
  INVALID_INPUT = "INVALID_INPUT",
  AMBIGUOUS = "AMBIGUOUS",
  RATE_LIMITED = "RATE_LIMITED",
  UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT",
  TIMEOUT = "TIMEOUT",
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",
  NOT_FOUND = "NOT_FOUND",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  UPSTREAM_ERROR = "UPSTREAM_ERROR",
}

export type ToolError =
  | {
      readonly isError?: true;
      readonly code: ToolErrorCode.INVALID_INPUT;
      readonly message: string;
      readonly field: string;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly isError?: true;
      readonly code: ToolErrorCode.AMBIGUOUS;
      readonly message: string;
      readonly candidates: readonly LocationCandidate[];
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly isError?: true;
      readonly code: ToolErrorCode.RATE_LIMITED;
      readonly message: string;
      readonly upstream: string;
      readonly retryAfterMs: number;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly isError?: true;
      readonly code: ToolErrorCode.UPSTREAM_TIMEOUT;
      readonly message: string;
      readonly upstream: string;
      readonly timeoutMs: number;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly isError?: true;
      readonly code: ToolErrorCode.TIMEOUT;
      readonly message: string;
      readonly upstream?: string;
      readonly timeoutMs?: number;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly isError?: true;
      readonly code: ToolErrorCode.QUOTA_EXCEEDED;
      readonly message: string;
      readonly upstream: string;
      readonly resetsAt?: string;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly isError?: true;
      readonly code: ToolErrorCode.NOT_FOUND;
      readonly message: string;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly isError?: true;
      readonly code: ToolErrorCode.INTERNAL_ERROR;
      readonly message: string;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly isError?: true;
      readonly code: ToolErrorCode.UPSTREAM_ERROR;
      readonly message: string;
      readonly upstream?: string;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly isError: true;
      readonly code: ToolErrorCode;
      readonly message: string;
      readonly details?: Record<string, unknown>;
    };

const toolErrorCodes = Object.values(ToolErrorCode);

/**
 * Structural type guard, not just a discriminant check — a domain object that happens
 * to carry a `code` field naming a `ToolErrorCode` value must not read as an error, so
 * each branch verifies the fields that variant actually requires.
 */
export function isToolError(value: unknown): value is ToolError {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string") {
    return false;
  }

  if (record.isError === true) {
    return typeof record.code === "string" && toolErrorCodes.includes(record.code as ToolErrorCode);
  }

  switch (record.code) {
    case ToolErrorCode.INVALID_INPUT:
      return typeof record.field === "string";
    case ToolErrorCode.AMBIGUOUS:
      return Array.isArray(record.candidates);
    case ToolErrorCode.RATE_LIMITED:
      return typeof record.upstream === "string" && typeof record.retryAfterMs === "number";
    case ToolErrorCode.UPSTREAM_TIMEOUT:
      return typeof record.upstream === "string" && typeof record.timeoutMs === "number";
    case ToolErrorCode.TIMEOUT:
      return true;
    case ToolErrorCode.QUOTA_EXCEEDED:
      return (
        typeof record.upstream === "string" &&
        (record.resetsAt === undefined || typeof record.resetsAt === "string")
      );
    case ToolErrorCode.NOT_FOUND:
    case ToolErrorCode.INTERNAL_ERROR:
    case ToolErrorCode.UPSTREAM_ERROR:
      return true;
    default:
      return false;
  }
}

export function invalidInput(message: string, field: string): ToolError {
  return { code: ToolErrorCode.INVALID_INPUT, message, field };
}

export function ambiguous(message: string, candidates: readonly LocationCandidate[]): ToolError {
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

export function upstreamError(
  message: string,
  upstream?: string,
  details?: Record<string, unknown>,
): ToolError {
  return {
    code: ToolErrorCode.UPSTREAM_ERROR,
    message,
    ...(upstream !== undefined ? { upstream } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

export function createToolError(
  code: ToolErrorCode | `${ToolErrorCode}`,
  message: string,
  details?: Record<string, unknown>,
): ToolError {
  return {
    isError: true,
    code: code as ToolErrorCode,
    message,
    ...(details !== undefined ? { details } : {}),
  };
}
