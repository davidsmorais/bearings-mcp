import { type Coordinates, CoordinatesSchema } from "@bearings/shared";

export const parseCoordinates = (input: unknown): Coordinates => {
  return CoordinatesSchema.parse(input);
};

const sample = parseCoordinates({ lat: 0, lon: 0 });
console.log(`Bearings MCP server ready @ ${sample.lat},${sample.lon}`);
