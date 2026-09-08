import { afterEach, describe, expect, it, vi } from "vitest";
import { conditionForWeatherCode } from "./weatherCode.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("conditionForWeatherCode", () => {
  it.each([
    [0, "clear"],
    [2, "partly-cloudy"],
    [3, "overcast"],
    [48, "fog"],
    [55, "drizzle"],
    [65, "rain"],
    [75, "snow"],
    [82, "rain-showers"],
    [86, "snow-showers"],
    [99, "thunderstorm"],
  ] as const)("maps WMO code %i to %s", (code, condition) => {
    expect(conditionForWeatherCode(code)).toBe(condition);
  });

  it("falls back to overcast and logs for an unmapped code", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(conditionForWeatherCode(123)).toBe("overcast");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("123"));
  });
});
