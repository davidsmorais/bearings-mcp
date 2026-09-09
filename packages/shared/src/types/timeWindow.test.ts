import { describe, expect, it } from "vitest";
import { zodErrorToToolError } from "../toToolError.js";
import { MAX_STAY_NIGHTS, TimeWindowSchema } from "./timeWindow.js";

describe("TimeWindowSchema", () => {
  it("parses a valid time window", () => {
    const result = TimeWindowSchema.safeParse({
      start: "2026-06-01",
      end: "2026-06-07",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid start date format with a field-named message", () => {
    const input = { start: "06/01/2026", end: "2026-06-07" };
    const result = TimeWindowSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("start");
      expect(error.message).toContain("start");
    }
  });

  it("rejects an invalid end date format with a field-named message", () => {
    const input = { start: "2026-06-01", end: "not-a-date" };
    const result = TimeWindowSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("end");
      expect(error.message).toContain("end");
    }
  });

  it("rejects end before start with a field-named message", () => {
    const result = TimeWindowSchema.safeParse({
      start: "2026-06-10",
      end: "2026-06-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'end must be on or after start, received end "2026-06-01" with start "2026-06-10"',
      );
    }
  });

  it("rejects a time window longer than MAX_STAY_NIGHTS with a descriptive message", () => {
    const result = TimeWindowSchema.safeParse({
      start: "2026-01-01",
      end: "2026-02-15",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        `time window must span at most ${MAX_STAY_NIGHTS} nights, received 45 nights (start "2026-01-01", end "2026-02-15")`,
      );
    }
  });

  it("accepts a stay exactly at MAX_STAY_NIGHTS", () => {
    const result = TimeWindowSchema.safeParse({
      start: "2026-01-01",
      end: "2026-01-31",
    });
    expect(result.success).toBe(true);
  });
});
