import { ZodError, type ZodIssue } from "zod";
import { internalError, invalidInput, isToolError, type ToolError } from "./errors.js";

/**
 * Distinguishes "the caller captured the raw input and a field's value happens to be
 * `undefined`" from "no input was available to the caller at all" — only the latter
 * suppresses the `, received X` clause instead of fabricating one.
 */
const NO_INPUT_CAPTURED = Symbol("no-input-captured");

const pathToField = (path: (string | number)[]): string => path.map(String).join(".");

const getValueAtPath = (input: unknown, path: (string | number)[]): unknown => {
  let current = input;
  for (const key of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
};

const formatStringReceived = (value: unknown): string => {
  if (typeof value === "string") {
    return `"${value}" (${value.length})`;
  }
  return String(value);
};

const formatIssueMessage = (issue: ZodIssue, input: unknown | typeof NO_INPUT_CAPTURED): string => {
  const field = pathToField(issue.path);
  const hasInput = input !== NO_INPUT_CAPTURED;
  const received = hasInput ? getValueAtPath(input, issue.path) : undefined;

  switch (issue.code) {
    case "too_big": {
      if (issue.type === "string") {
        return hasInput
          ? `${field} must be at most ${issue.maximum} characters, received ${formatStringReceived(received)}`
          : `${field} must be at most ${issue.maximum} characters`;
      }
      if (issue.inclusive) {
        return hasInput
          ? `${field} must be ${issue.maximum} or less, received ${received}`
          : `${field} must be ${issue.maximum} or less`;
      }
      return hasInput
        ? `${field} must be less than ${issue.maximum}, received ${received}`
        : `${field} must be less than ${issue.maximum}`;
    }
    case "too_small": {
      if (issue.type === "string") {
        return hasInput
          ? `${field} must be at least ${issue.minimum} characters, received ${formatStringReceived(received)}`
          : `${field} must be at least ${issue.minimum} characters`;
      }
      if (issue.inclusive) {
        return hasInput
          ? `${field} must be at least ${issue.minimum}, received ${received}`
          : `${field} must be at least ${issue.minimum}`;
      }
      return hasInput
        ? `${field} must be greater than ${issue.minimum}, received ${received}`
        : `${field} must be greater than ${issue.minimum}`;
    }
    case "custom":
      return issue.message;
    default:
      if (field.length > 0) {
        return `${field}: ${issue.message}`;
      }
      return issue.message;
  }
};

export function zodErrorToToolError(
  error: ZodError,
  input: unknown | typeof NO_INPUT_CAPTURED = NO_INPUT_CAPTURED,
): ToolError {
  const { issues } = error;
  const field = issues.length > 0 ? pathToField(issues[0].path) : "";
  const message = issues.map((issue) => formatIssueMessage(issue, input)).join("; ");
  return invalidInput(message, field);
}

const unknownErrorMessage = (error: unknown): string => {
  try {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    if (error === null) {
      return "null";
    }
    if (error === undefined) {
      return "undefined";
    }
    return String(error);
  } catch {
    return "unknown error";
  }
};

/**
 * Maps an unknown thrown value to a `ToolError`, never throwing itself. `input` is the
 * raw arguments in scope at the catch site, if any — passed through so a handler that
 * throws a bare `ZodError` (e.g. an internal `.parse()` call) still gets a message with
 * the actual received value rather than a fabricated `undefined`.
 */
export function toToolError(error: unknown, input?: unknown): ToolError {
  if (isToolError(error)) {
    return error;
  }
  if (error instanceof ZodError) {
    // `input === undefined` covers both "the caller passed nothing" and "the caller's
    // whole args object happens to be undefined" — either way there is nothing real to
    // report, so every issue's `, received X` clause is omitted rather than fabricated.
    return input === undefined ? zodErrorToToolError(error) : zodErrorToToolError(error, input);
  }
  return internalError(unknownErrorMessage(error));
}
