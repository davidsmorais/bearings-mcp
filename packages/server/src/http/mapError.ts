import { createToolError, type ToolError } from "@bearings/shared";
import type { HostConfig, HostId } from "./types.js";

interface HttpErrorDetails {
  readonly hostId: HostId;
  readonly status?: number;
  readonly attempts: number;
}

export interface MapHttpErrorInput {
  readonly hostId: HostId;
  readonly config: HostConfig;
  readonly attempts: number;
  readonly status?: number;
  readonly body?: unknown;
  readonly timedOut?: boolean;
  readonly timeoutMs?: number;
}

function buildDetails(input: MapHttpErrorInput): Record<string, unknown> {
  const details: HttpErrorDetails = {
    hostId: input.hostId,
    status: input.status,
    attempts: input.attempts,
  };
  return { ...details };
}

function defaultMessage(hostId: HostId, code: string, status?: number, timeoutMs?: number): string {
  switch (code) {
    case "TIMEOUT":
      return `${hostId} request timed out after ${timeoutMs ?? "unknown"}ms`;
    case "NOT_FOUND":
      return `${hostId} returned 404`;
    case "RATE_LIMITED":
      return `${hostId} rate limited (429)`;
    case "QUOTA_EXCEEDED":
      return `${hostId} daily quota exceeded`;
    case "UPSTREAM_ERROR":
      return status !== undefined
        ? `${hostId} upstream error (${status})`
        : `${hostId} upstream request failed`;
    default:
      return `${hostId} request failed`;
  }
}

/**
 * Maps an HTTP failure to a ToolError. classifyStatus on host config gets first refusal.
 * Details never include the authenticated URL.
 */
export function mapHttpError(input: MapHttpErrorInput): ToolError {
  const details = buildDetails(input);

  if (input.timedOut) {
    return createToolError(
      "TIMEOUT",
      defaultMessage(input.hostId, "TIMEOUT", input.status, input.timeoutMs),
      details,
    );
  }

  const { status, body } = input;
  if (status !== undefined) {
    const classified = input.config.classifyStatus?.(status, body);
    if (classified !== undefined) {
      return createToolError(
        classified,
        defaultMessage(input.hostId, classified, status, input.timeoutMs),
        details,
      );
    }

    if (status === 404) {
      return createToolError(
        "NOT_FOUND",
        defaultMessage(input.hostId, "NOT_FOUND", status),
        details,
      );
    }

    if (status === 429) {
      return createToolError(
        "RATE_LIMITED",
        defaultMessage(input.hostId, "RATE_LIMITED", status),
        details,
      );
    }

    if (status >= 400) {
      return createToolError(
        "UPSTREAM_ERROR",
        defaultMessage(input.hostId, "UPSTREAM_ERROR", status),
        details,
      );
    }
  }

  return createToolError(
    "UPSTREAM_ERROR",
    defaultMessage(input.hostId, "UPSTREAM_ERROR", input.status),
    details,
  );
}
