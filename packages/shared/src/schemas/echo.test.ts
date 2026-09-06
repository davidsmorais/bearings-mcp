import { describe, expect, it } from "vitest";
import { EchoInputSchema } from "./echo.js";

describe("EchoInputSchema", () => {
  it("parses a valid message", () => {
    const result = EchoInputSchema.safeParse({ message: "hi" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty message", () => {
    const result = EchoInputSchema.safeParse({ message: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a message longer than 1000 characters", () => {
    const result = EchoInputSchema.safeParse({ message: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });

  it("rejects a missing message", () => {
    const result = EchoInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
