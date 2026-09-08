import { describe, expect, it } from "vitest";
import { classifyDomain } from "./classifyDensity.js";
import type { RingCount } from "./rings.js";
import { DENSITY_THRESHOLDS } from "./thresholds.js";

const rings: readonly RingCount[] = [
  { radiusM: 250, count: 12 },
  { radiusM: 500, count: 20 },
];

describe("classifyDomain", () => {
  it("rates a zero count none regardless of thresholds", () => {
    const rating = classifyDomain("nightlife", 0, 500, [{ radiusM: 500, count: 0 }], {
      countCapped: false,
    });
    expect(rating.rating).toBe("none");
    expect(rating.densityPerKm2).toBe(0);
  });

  it("lands the issue's worked example (20 capped nightlife venues within 500 m) at high", () => {
    const rating = classifyDomain("nightlife", 20, 500, rings, { countCapped: true });
    expect(rating).toEqual({
      rating: "high",
      count: 20,
      radiusM: 500,
      densityPerKm2: 25.5,
      countCapped: true,
      rings,
    });
  });

  it("classifies just below the medium cutoff as low", () => {
    // 24 / (pi * 1^2) = 7.64 venues/km², below nightlife medium (8).
    expect(classifyDomain("nightlife", 24, 1000, rings, { countCapped: false }).rating).toBe("low");
  });

  it("classifies a density that lands exactly on the medium cutoff as medium", () => {
    // 25 / (pi * 1^2) = 7.96 -> rounds to 8.0 == nightlife medium.
    const rating = classifyDomain("nightlife", 25, 1000, rings, { countCapped: false });
    expect(rating.densityPerKm2).toBe(DENSITY_THRESHOLDS.nightlife.medium);
    expect(rating.rating).toBe("medium");
  });

  it("classifies a density that lands exactly on the high cutoff as high", () => {
    // 10 / (pi * 0.8^2) = 4.97 -> rounds to 5.0 == greenSpace high.
    const rating = classifyDomain("greenSpace", 10, 800, rings, { countCapped: false });
    expect(rating.densityPerKm2).toBe(DENSITY_THRESHOLDS.greenSpace.high);
    expect(rating.rating).toBe("high");
  });

  it("applies per-domain thresholds — the same density rates differently by domain", () => {
    // ~8.0 venues/km²: above nightlife medium (8) and greenSpace high (5), below dining medium (10).
    expect(classifyDomain("nightlife", 25, 1000, rings, { countCapped: false }).rating).toBe(
      "medium",
    );
    expect(classifyDomain("greenSpace", 25, 1000, rings, { countCapped: false }).rating).toBe(
      "high",
    );
    expect(classifyDomain("dining", 25, 1000, rings, { countCapped: false }).rating).toBe("low");
  });

  it("carries countCapped and the ring breakdown through unchanged", () => {
    const rating = classifyDomain("dining", 5, 500, rings, { countCapped: true });
    expect(rating.countCapped).toBe(true);
    expect(rating.rings).toBe(rings);
    expect(rating.count).toBe(5);
    expect(rating.radiusM).toBe(500);
  });
});
