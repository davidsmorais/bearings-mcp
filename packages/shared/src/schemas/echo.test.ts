import { describe, expect, it } from "vitest";
import { zodErrorToToolError } from "../toToolError.js";
import { EchoInputSchema } from "./echo.js";

describe("EchoInputSchema", () => {
  it("parses a valid message", () => {
    const result = EchoInputSchema.safeParse({ message: "hi" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty message with a recoverable message", () => {
    const input = { message: "" };
    const result = EchoInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("message");
      expect(error.message).toContain("message");
    }
  });

  it("rejects a message longer than 1000 characters with a recoverable message", () => {
    const input = { message: "x".repeat(1001) };
    const result = EchoInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("message");
      expect(error.message).toContain("1000");
    }
  });

  it("rejects a missing message with a recoverable message", () => {
    const input = {};
    const result = EchoInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("message");
      expect(error.message).toContain("message");
    }
  });
});
