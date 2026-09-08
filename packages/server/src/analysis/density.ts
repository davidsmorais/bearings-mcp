/**
 * Venue density in venues/km² for a count observed within a circular radius.
 * Density (not raw count) so a rating stays comparable across different `radiusM`
 * values. Rounded to 1 dp — the precision the thresholds are stated at.
 */
export const densityPerKm2 = (count: number, radiusM: number): number => {
  if (radiusM <= 0) {
    return 0;
  }
  const areaKm2 = Math.PI * (radiusM / 1000) ** 2;
  return Math.round((count / areaKm2) * 10) / 10;
};
