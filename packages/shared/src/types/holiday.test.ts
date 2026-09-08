import { describe, expect, it } from "vitest";
import { HolidaySchema } from "./holiday.js";

describe("HolidaySchema", () => {
  it("parses a fully specified holiday", () => {
    const result = HolidaySchema.safeParse({
      date: "2026-12-25",
      name: "Christmas Day",
      localName: "Weihnachten",
      countryCode: "AT",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-ISO date", () => {
    const result = HolidaySchema.safeParse({
      date: "25/12/2026",
      name: "Christmas Day",
      localName: "Weihnachten",
      countryCode: "AT",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty localName", () => {
    const result = HolidaySchema.safeParse({
      date: "2026-12-25",
      name: "Christmas Day",
      localName: "",
      countryCode: "AT",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a lower-case country code", () => {
    const result = HolidaySchema.safeParse({
      date: "2026-12-25",
      name: "Christmas Day",
      localName: "Weihnachten",
      countryCode: "at",
    });
    expect(result.success).toBe(false);
  });
});
