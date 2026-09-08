import type { WeatherCondition } from "@bearings/shared";

/**
 * WMO weather-interpretation codes (WW) → readable conditions.
 * Reference: https://open-meteo.com/en/docs — "WMO Weather interpretation codes".
 * Only the codes Open-Meteo actually emits are listed; the ~100-value WW table
 * is not imported wholesale (root AGENTS: map what the domain uses, nothing more).
 */
const WEATHER_CODE_CONDITIONS: Readonly<Record<number, WeatherCondition>> = {
  0: "clear",
  1: "partly-cloudy",
  2: "partly-cloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "drizzle",
  57: "drizzle",
  61: "rain",
  63: "rain",
  65: "rain",
  66: "rain",
  67: "rain",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  80: "rain-showers",
  81: "rain-showers",
  82: "rain-showers",
  85: "snow-showers",
  86: "snow-showers",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "thunderstorm",
};

const FALLBACK_CONDITION: WeatherCondition = "overcast";

/**
 * Maps a WMO code to a readable condition. An undocumented code is not fatal —
 * it falls back to `overcast` and logs to stderr so a taxonomy drift is visible.
 */
export const conditionForWeatherCode = (code: number): WeatherCondition => {
  const condition = WEATHER_CODE_CONDITIONS[code];
  if (condition === undefined) {
    console.error(
      `open-meteo: unmapped WMO weather code ${code}, treating as "${FALLBACK_CONDITION}"`,
    );
    return FALLBACK_CONDITION;
  }
  return condition;
};
