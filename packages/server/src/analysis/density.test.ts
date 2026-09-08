import { describe, expect, it } from "vitest";
import { densityPerKm2 } from "./density.js";

describe("densityPerKm2", () => {
  it("matches a hand-computed value", () => {
    // area = pi * 0.5^2 = 0.785398 km²; 10 / 0.785398 = 12.732... -> 12.7
    expect(densityPerKm2(10, 500)).toBe(12.7);
  });

  it("computes the issue's worked example (20 venues within 500 m)", () => {
    // 20 / (pi * 0.25) = 25.464... -> 25.5
    expect(densityPerKm2(20, 500)).toBe(25.5);
  });

  it("is zero for a zero count", () => {
    expect(densityPerKm2(0, 500)).toBe(0);
  });

  it("guards a non-positive radius instead of dividing by zero", () => {
    expect(densityPerKm2(5, 0)).toBe(0);
  });

  it("rounds to one decimal place", () => {
    const value = densityPerKm2(7, 1000);
    expect(value).toBe(Math.round(value * 10) / 10);
  });
});
