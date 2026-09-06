import { describe, expect, it } from "vitest";
import { CountryCodeSchema } from "./countryCode.js";

describe("CountryCodeSchema", () => {
  it("parses a valid upper-case alpha-2 code", () => {
    expect(CountryCodeSchema.safeParse("FR").success).toBe(true);
  });

  it("rejects a lower-case code", () => {
    expect(CountryCodeSchema.safeParse("fr").success).toBe(false);
  });

  it("rejects a code shorter than 2 characters", () => {
    expect(CountryCodeSchema.safeParse("F").success).toBe(false);
  });

  it("rejects a code longer than 2 characters", () => {
    expect(CountryCodeSchema.safeParse("FRA").success).toBe(false);
  });

  it("rejects digits", () => {
    expect(CountryCodeSchema.safeParse("F1").success).toBe(false);
  });
});
