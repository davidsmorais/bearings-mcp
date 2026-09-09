import { describe, expect, it } from "vitest";
import { zodErrorToToolError } from "../toToolError.js";
import { GetDestinationBriefInputSchema } from "./getDestinationBrief.js";

const validLocation = {
  name: "Paris",
  coordinates: { lat: 48.8566, lon: 2.3522 },
  countryCode: "FR",
};

describe("GetDestinationBriefInputSchema", () => {
  it("parses valid input with defaults applied", () => {
    const result = GetDestinationBriefInputSchema.safeParse({
      location: validLocation,
      stay: { start: "2026-06-01", end: "2026-06-07" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.detail).toBe("brief");
    }
  });

  it("rejects missing location with a recoverable message", () => {
    const input = { stay: { start: "2026-06-01", end: "2026-06-07" } };
    const result = GetDestinationBriefInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("location");
      expect(error.message).toContain("location");
    }
  });

  it("rejects invalid countryCode on nested location", () => {
    const input = {
      location: { ...validLocation, countryCode: "fr" },
      stay: { start: "2026-06-01", end: "2026-06-07" },
    };
    const result = GetDestinationBriefInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.field).toBe("location.countryCode");
      expect(error.message).toContain("location.countryCode");
    }
  });

  it("rejects stay end before start with a field-named message", () => {
    const input = {
      location: validLocation,
      stay: { start: "2026-06-10", end: "2026-06-01" },
    };
    const result = GetDestinationBriefInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = zodErrorToToolError(result.error, input);
      expect(error.message).toContain("end");
      expect(error.message).toContain("2026-06-01");
    }
  });
});
