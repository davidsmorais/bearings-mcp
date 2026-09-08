import { describe, expect, it } from "vitest";
import { notFound, upstreamError } from "../errors.js";
import { SourceOutcomeSchema, SourceStatusSchema } from "./sourceOutcome.js";

describe("SourceStatusSchema", () => {
  it.each(["ok", "partial", "unavailable"] as const)("parses %s", (status) => {
    expect(SourceStatusSchema.safeParse(status).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(SourceStatusSchema.safeParse("failed").success).toBe(false);
  });
});

describe("SourceOutcomeSchema", () => {
  it("accepts a minimal ok outcome", () => {
    expect(SourceOutcomeSchema.safeParse({ status: "ok" }).success).toBe(true);
  });

  it("accepts partial with a note", () => {
    expect(
      SourceOutcomeSchema.safeParse({ status: "partial", note: "3 POIs missing distance" }).success,
    ).toBe(true);
  });

  it("accepts unavailable with a real ToolError", () => {
    expect(
      SourceOutcomeSchema.safeParse({
        status: "unavailable",
        error: upstreamError("geoapify", "Geoapify Places request failed"),
      }).success,
    ).toBe(true);
  });

  it("rejects a bare object that is not a ToolError", () => {
    expect(
      SourceOutcomeSchema.safeParse({
        status: "unavailable",
        error: { code: "UPSTREAM_ERROR" },
      }).success,
    ).toBe(false);
  });

  it("accepts notFound as a ToolError variant", () => {
    expect(
      SourceOutcomeSchema.safeParse({
        status: "unavailable",
        error: notFound("no places in radius"),
      }).success,
    ).toBe(true);
  });
});
