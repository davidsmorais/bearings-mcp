import { describe, expect, it } from "vitest";
import { classifyDomain } from "./classifyDensity.js";
import type { RingCount } from "./rings.js";
import { CALIBRATION_RADIUS_M, DENSITY_THRESHOLDS } from "./thresholds.js";

const rings: readonly RingCount[] = [
  { radiusM: 250, count: 12 },
  { radiusM: 500, count: 20 },
];

describe("classifyDomain", () => {
  it("rates a zero rating-ring count none regardless of thresholds", () => {
    const rating = classifyDomain("nightlife", 0, 500, [{ radiusM: 500, count: 0 }], {
      countCapped: false,
    });
    expect(rating.rating).toBe("none");
    expect(rating.densityPerKm2).toBe(0);
    expect(rating.ratingRadiusM).toBe(CALIBRATION_RADIUS_M);
  });

  it("lands the issue's worked example (20 capped nightlife venues within 500 m) at high", () => {
    const rating = classifyDomain("nightlife", 20, 500, rings, { countCapped: true });
    expect(rating).toEqual({
      rating: "high",
      count: 20,
      radiusM: 500,
      ratingRadiusM: 500,
      densityPerKm2: 25.5,
      countCapped: true,
      rings,
    });
  });

  it("keeps rating a saturated 500 m sample high no matter how wide radiusM is", () => {
    // 20 nightlife venues, all inside 500 m. Widening the request must not dilute the
    // verdict — the rating ring stays the 500 m one. On the pre-fix code radiusM 1000+
    // returned `low`.
    const wideRings: readonly RingCount[] = [
      { radiusM: 250, count: 12 },
      { radiusM: 500, count: 20 },
      { radiusM: 1000, count: 20 },
      { radiusM: 2000, count: 20 },
      { radiusM: 5000, count: 20 },
    ];

    for (const radiusM of [500, 1000, 2000, 5000]) {
      const rating = classifyDomain("nightlife", 20, radiusM, wideRings, { countCapped: true });
      expect(rating.rating).toBe("high");
      expect(rating.ratingRadiusM).toBe(500);
      expect(rating.densityPerKm2).toBe(25.5);
      expect(rating.radiusM).toBe(radiusM);
      expect(rating.count).toBe(20);
    }
  });

  it("falls back to the request's outer ring when radiusM is below the calibration radius", () => {
    // radiusM 250: no 500 m ring exists. Rate off the 250 m outer ring — tighter, so a
    // higher density for the same sample.
    const rating = classifyDomain("nightlife", 8, 250, [{ radiusM: 250, count: 8 }], {
      countCapped: true,
    });
    expect(rating.ratingRadiusM).toBe(250);
    // 8 / (pi * 0.25^2) = 40.7 venues/km² — comfortably `high`.
    expect(rating.rating).toBe("high");
  });

  it("clears countCapped when the rating ring holds fewer POIs than the total", () => {
    // 20 returned (capped), but only 15 within 500 m — the 500 m slice was not truncated
    // by the limit, so its count is not a floor.
    const spreadRings: readonly RingCount[] = [
      { radiusM: 250, count: 5 },
      { radiusM: 500, count: 15 },
      { radiusM: 1000, count: 20 },
    ];
    const rating = classifyDomain("nightlife", 20, 1000, spreadRings, { countCapped: true });
    expect(rating.countCapped).toBe(false);
    expect(rating.ratingRadiusM).toBe(500);
    // 15 / (pi * 0.5^2) = 19.1 venues/km² — below nightlife high (20).
    expect(rating.rating).toBe("medium");
  });

  it("keeps countCapped when the whole capped sample sits inside the rating ring", () => {
    const rating = classifyDomain(
      "dining",
      20,
      1000,
      [
        { radiusM: 250, count: 9 },
        { radiusM: 500, count: 20 },
        { radiusM: 1000, count: 20 },
      ],
      { countCapped: true },
    );
    expect(rating.countCapped).toBe(true);
  });

  it("classifies a rating-ring density just below the medium cutoff as low", () => {
    // 6 / (pi * 0.25) = 7.64 venues/km², below nightlife medium (8).
    const rating = classifyDomain("nightlife", 6, 500, [{ radiusM: 500, count: 6 }], {
      countCapped: false,
    });
    expect(rating.rating).toBe("low");
  });

  it("classifies a rating-ring density on the medium cutoff as medium", () => {
    // 8 / (pi * 0.25) = 10.19 venues/km² — at or above dining's medium cutoff of 10.
    const rating = classifyDomain("dining", 8, 500, [{ radiusM: 500, count: 8 }], {
      countCapped: false,
    });
    expect(rating.densityPerKm2).toBeGreaterThanOrEqual(DENSITY_THRESHOLDS.dining.medium);
    expect(rating.rating).toBe("medium");
  });

  it("applies per-domain thresholds at the rating ring", () => {
    // 15 within 500 m = 19.1 venues/km²: above nightlife medium (8), below its high (20);
    // above greenSpace high (5); below dining high (22) but above its medium (10).
    const ring: readonly RingCount[] = [{ radiusM: 500, count: 15 }];
    expect(classifyDomain("nightlife", 15, 500, ring, { countCapped: false }).rating).toBe(
      "medium",
    );
    expect(classifyDomain("greenSpace", 15, 500, ring, { countCapped: false }).rating).toBe("high");
    expect(classifyDomain("dining", 15, 500, ring, { countCapped: false }).rating).toBe("medium");
  });

  it("carries the full ring breakdown and the requested radius through unchanged", () => {
    const rating = classifyDomain("dining", 5, 500, rings, { countCapped: true });
    expect(rating.rings).toBe(rings);
    expect(rating.count).toBe(5);
    expect(rating.radiusM).toBe(500);
    expect(rating.ratingRadiusM).toBe(500);
  });
});
