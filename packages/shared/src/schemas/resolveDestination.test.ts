import { describe, expect, it } from "vitest";
import { zodErrorToToolError } from "../toToolError.js";
import { ResolveDestinationInputSchema } from "./resolveDestination.js";

describe("ResolveDestinationInputSchema", () => {
  it("parses valid input with defaults applied", () => {
    const result = ResolveDestinationInputSchema.safeParse({ query: "Paris" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(5);
      expect(result.data.detail).toBe("brief");
    }
  });

  it("accepts query at minimum length boundary", () => {
    expect(ResolveDestinationInputSchema.safeParse({ query: "ab" }).success).toBe(true);
  });

  it("rejects query below minimum length", () => {
    const input = { query: "a" };
    const result = ResolveDestinationInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("query");
      expect(error.message).toContain("query");
      expect(error.message).toContain('"a"');
    }
  });

  it("rejects query above maximum length", () => {
    const input = { query: "x".repeat(201) };
    const result = ResolveDestinationInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("query");
      expect(error.message).toContain("query");
      expect(error.message).toContain("200");
    }
  });

  it("rejects limit below minimum", () => {
    const input = { query: "Paris", limit: 0 };
    const result = ResolveDestinationInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("limit");
      expect(error.message).toContain("limit");
      expect(error.message).toContain("0");
    }
  });

  it("rejects limit above maximum", () => {
    const input = { query: "Paris", limit: 11 };
    const result = ResolveDestinationInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("limit");
      expect(error.message).toContain("limit");
      expect(error.message).toContain("11");
    }
  });

  it("accepts limit at boundaries", () => {
    expect(ResolveDestinationInputSchema.safeParse({ query: "Paris", limit: 1 }).success).toBe(
      true,
    );
    expect(ResolveDestinationInputSchema.safeParse({ query: "Paris", limit: 10 }).success).toBe(
      true,
    );
  });

  it("rejects lowercase countryCode", () => {
    const input = { query: "Paris", countryCode: "fr" };
    const result = ResolveDestinationInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("countryCode");
      expect(error.message).toContain("countryCode");
    }
  });
});
