import { describe, expect, it } from "vitest";
import { z } from "zod";
import { internalError, invalidInput, notFound, ToolErrorCode } from "./errors.js";
import { toToolError, zodErrorToToolError } from "./toToolError.js";
import { MAX_STAY_NIGHTS, TimeWindowSchema } from "./types/timeWindow.js";

describe("zodErrorToToolError", () => {
  it("formats too_big number issues with field name and received value", () => {
    const schema = z.object({ radiusM: z.number().int().max(5000) });
    const input = { radiusM: 50000 };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error).toEqual({
        code: ToolErrorCode.INVALID_INPUT,
        field: "radiusM",
        message: "radiusM must be 5000 or less, received 50000",
      });
    }
  });

  it("formats too_small string issues with field name and received value", () => {
    const schema = z.object({ query: z.string().min(2) });
    const input = { query: "a" };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error).toEqual({
        code: ToolErrorCode.INVALID_INPUT,
        field: "query",
        message: 'query must be at least 2 characters, received "a" (1)',
      });
    }
  });

  it("enumerates all issues in the message", () => {
    const schema = z.object({
      radiusM: z.number().int().max(5000),
      query: z.string().min(2),
    });
    const input = { radiusM: 50000, query: "a" };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("radiusM");
      expect(error.message).toBe(
        'radiusM must be 5000 or less, received 50000; query must be at least 2 characters, received "a" (1)',
      );
    }
  });

  it("preserves TimeWindow refinement messages", () => {
    const input = { start: "2026-01-01", end: "2026-02-15" };
    const result = TimeWindowSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("");
      expect(error.message).toBe(
        `time window must span at most ${MAX_STAY_NIGHTS} nights, received 45 nights (start "2026-01-01", end "2026-02-15")`,
      );
    }
  });

  it("preserves end-before-start TimeWindow refinement message", () => {
    const input = { start: "2026-06-10", end: "2026-06-01" };
    const result = TimeWindowSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.message).toBe(
        'end must be on or after start, received end "2026-06-01" with start "2026-06-10"',
      );
    }
  });
});

describe("toToolError", () => {
  it("passes through an existing ToolError unchanged", () => {
    const original = invalidInput("radiusM must be 5000 or less, received 50000", "radiusM");
    expect(toToolError(original)).toBe(original);
  });

  it("passes through non-INVALID_INPUT ToolError variants", () => {
    const original = notFound("destination could not be resolved");
    expect(toToolError(original)).toBe(original);
  });

  it("maps a ZodError without input, omitting the received clause instead of fabricating one", () => {
    const schema = z.object({ radiusM: z.number().int().max(5000) });
    const result = schema.safeParse({ radiusM: 50000 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = toToolError(result.error);
      expect(error.code).toBe(ToolErrorCode.INVALID_INPUT);
      expect(error).toHaveProperty("field", "radiusM");
      expect(error.message).toBe("radiusM must be 5000 or less");
      expect(error.message).not.toContain("undefined");
    }
  });

  it("maps a ZodError with input, reporting the actual received value", () => {
    const schema = z.object({ radiusM: z.number().int().max(5000) });
    const input = { radiusM: 50000 };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = toToolError(result.error, input);
      expect(error).toEqual({
        code: ToolErrorCode.INVALID_INPUT,
        field: "radiusM",
        message: "radiusM must be 5000 or less, received 50000",
      });
    }
  });

  it("maps Error instances to INTERNAL_ERROR", () => {
    const error = toToolError(new Error("unexpected failure"));
    expect(error).toEqual({
      code: ToolErrorCode.INTERNAL_ERROR,
      message: "unexpected failure",
    });
  });

  it("maps thrown strings to INTERNAL_ERROR", () => {
    const error = toToolError("something broke");
    expect(error).toEqual({
      code: ToolErrorCode.INTERNAL_ERROR,
      message: "something broke",
    });
  });

  it("maps null to INTERNAL_ERROR without throwing", () => {
    const error = toToolError(null);
    expect(error).toEqual({
      code: ToolErrorCode.INTERNAL_ERROR,
      message: "null",
    });
  });

  it("maps circular references to INTERNAL_ERROR without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const error = toToolError(circular);
    expect(error.code).toBe(ToolErrorCode.INTERNAL_ERROR);
    expect(error.message).toBe("[object Object]");
  });

  it("maps pre-built internalError through unchanged", () => {
    const original = internalError("already typed");
    expect(toToolError(original)).toBe(original);
  });
});
