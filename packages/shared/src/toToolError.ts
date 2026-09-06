import { ZodError, type ZodIssue } from "zod";
import { internalError, invalidInput, isToolError, type ToolError } from "./errors.js";

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

const formatIssueMessage = (issue: ZodIssue, input: unknown): string => {
  const field = pathToField(issue.path);
  const received = getValueAtPath(input, issue.path);

  switch (issue.code) {
    case "too_big": {
      if (issue.type === "string") {
        return `${field} must be at most ${issue.maximum} characters, received ${formatStringReceived(received)}`;
      }
      if (issue.inclusive) {
        return `${field} must be ${issue.maximum} or less, received ${received}`;
      }
      return `${field} must be less than ${issue.maximum}, received ${received}`;
    }
    case "too_small": {
      if (issue.type === "string") {
        return `${field} must be at least ${issue.minimum} characters, received ${formatStringReceived(received)}`;
      }
      if (issue.inclusive) {
        return `${field} must be at least ${issue.minimum}, received ${received}`;
      }
      return `${field} must be greater than ${issue.minimum}, received ${received}`;
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

export function zodErrorToToolError(error: ZodError, input: unknown): ToolError {
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

export function toToolError(error: unknown): ToolError {
  if (isToolError(error)) {
    return error;
  }
  if (error instanceof ZodError) {
    return zodErrorToToolError(error, undefined);
  }
  return internalError(unknownErrorMessage(error));
}
