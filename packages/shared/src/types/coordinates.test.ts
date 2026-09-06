import { describe, expect, it } from "vitest";
import { CoordinatesSchema } from "./coordinates.js";

describe("CoordinatesSchema", () => {
  it("parses valid coordinates", () => {
    const result = CoordinatesSchema.safeParse({ lat: 51.5, lon: -0.12 });
    expect(result.success).toBe(true);
  });

  it("rejects latitude below -90", () => {
    const result = CoordinatesSchema.safeParse({ lat: -91, lon: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects latitude above 90", () => {
    const result = CoordinatesSchema.safeParse({ lat: 91, lon: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects longitude below -180", () => {
    const result = CoordinatesSchema.safeParse({ lat: 0, lon: -181 });
    expect(result.success).toBe(false);
  });

  it("rejects longitude above 180", () => {
    const result = CoordinatesSchema.safeParse({ lat: 0, lon: 181 });
    expect(result.success).toBe(false);
  });
});
