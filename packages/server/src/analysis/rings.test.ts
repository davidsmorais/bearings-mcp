import type { PointOfInterest } from "@bearings/shared";
import { describe, expect, it } from "vitest";
import { partitionByRing, ringsWithin, WALKING_RADII_M } from "./rings.js";

const poi = (id: string, distanceM?: number): PointOfInterest => ({
  id,
  name: id,
  coordinates: { lat: 0, lon: 0 },
  category: "dining",
  ...(distanceM !== undefined ? { distanceM } : {}),
});

describe("ringsWithin", () => {
  it("keeps ladder entries at or below the radius and adds the radius as the outer ring", () => {
    expect(ringsWithin(1000)).toEqual([250, 500, 1000]);
    expect(ringsWithin(600)).toEqual([250, 500, 600]);
  });

  it("returns just the radius when it is below the smallest ladder entry", () => {
    expect(ringsWithin(100)).toEqual([100]);
  });

  it("does not duplicate a ring when the radius equals a ladder entry", () => {
    expect(ringsWithin(500)).toEqual([250, 500]);
  });

  it("appends a radius wider than the whole ladder as the outer ring", () => {
    expect(ringsWithin(5000)).toEqual([...WALKING_RADII_M, 5000]);
  });
});

describe("partitionByRing", () => {
  it("counts cumulatively across rings", () => {
    const result = partitionByRing([poi("a", 100), poi("b", 300), poi("c", 900)], [250, 500, 1000]);
    expect(result.rings).toEqual([
      { radiusM: 250, count: 1 },
      { radiusM: 500, count: 2 },
      { radiusM: 1000, count: 3 },
    ]);
    expect(result.missingDistance).toBe(0);
  });

  it("places a POI exactly on a ring boundary inside that ring", () => {
    const result = partitionByRing([poi("edge", 500)], [250, 500, 1000]);
    expect(result.rings).toEqual([
      { radiusM: 250, count: 0 },
      { radiusM: 500, count: 1 },
      { radiusM: 1000, count: 1 },
    ]);
  });

  it("counts a POI with no distance only at the outer ring and reports it", () => {
    const result = partitionByRing([poi("known", 100), poi("unknown")], [250, 500]);
    expect(result.rings).toEqual([
      { radiusM: 250, count: 1 },
      { radiusM: 500, count: 2 },
    ]);
    expect(result.missingDistance).toBe(1);
  });

  it("returns zeroed rings for an empty POI list", () => {
    const result = partitionByRing([], [250, 500]);
    expect(result.rings).toEqual([
      { radiusM: 250, count: 0 },
      { radiusM: 500, count: 0 },
    ]);
    expect(result.missingDistance).toBe(0);
  });

  it("handles a single-ring partition", () => {
    const result = partitionByRing([poi("a", 40), poi("b")], [100]);
    expect(result.rings).toEqual([{ radiusM: 100, count: 2 }]);
    expect(result.missingDistance).toBe(1);
  });
});
