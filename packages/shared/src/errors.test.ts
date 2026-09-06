import { describe, expect, it } from "vitest";
import { createToolError, isToolError } from "./errors.js";

describe("errors", () => {
  it("creates a well-formed ToolError", () => {
    const error = createToolError("INVALID_INPUT", "radius must be 5000m or less", {
      radius: 10000,
    });
    expect(error).toEqual({
      isError: true,
      code: "INVALID_INPUT",
      message: "radius must be 5000m or less",
      details: { radius: 10000 },
    });
  });

  it("creates a ToolError without details if omitted", () => {
    const error = createToolError("NOT_FOUND", "destination could not be resolved");
    expect(error).toEqual({
      isError: true,
      code: "NOT_FOUND",
      message: "destination could not be resolved",
    });
    expect(error.details).toBeUndefined();
  });

  it("identifies valid ToolError objects with isToolError", () => {
    const error = createToolError("RATE_LIMITED", "too many requests");
    expect(isToolError(error)).toBe(true);
  });

  it("rejects non-ToolError values with isToolError", () => {
    expect(isToolError(null)).toBe(false);
    expect(isToolError(undefined)).toBe(false);
    expect(isToolError("error")).toBe(false);
    expect(isToolError(new Error("oops"))).toBe(false);
    expect(isToolError({ isError: false })).toBe(false);
    expect(isToolError({ isError: true })).toBe(false);
    expect(isToolError({ isError: true, code: "FAIL" })).toBe(false);
    expect(isToolError({ isError: true, code: 123, message: "fail" })).toBe(false);
  });
});
