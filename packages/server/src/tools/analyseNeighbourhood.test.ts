import { AnalyseNeighbourhoodInputSchema, isToolError } from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyseNeighbourhoodTool } from "./analyseNeighbourhood.js";

const mockedAnalyseNeighbourhood = vi.fn();

vi.mock("../analysis/analyseNeighbourhood.js", () => ({
  analyseNeighbourhood: (...args: unknown[]) => mockedAnalyseNeighbourhood(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("analyseNeighbourhoodTool", () => {
  it("is registered under the name analyse_neighbourhood", () => {
    expect(analyseNeighbourhoodTool.name).toBe("analyse_neighbourhood");
  });

  it("does not advertise a stub description", () => {
    expect(analyseNeighbourhoodTool.description).not.toMatch(/^Not yet implemented — /);
    expect(analyseNeighbourhoodTool.description).toContain("sources");
  });

  it("delegates to analyseNeighbourhood with the caller signal", async () => {
    mockedAnalyseNeighbourhood.mockResolvedValue({
      detail: "brief",
      location: { name: "38.7115, -9.1449", countryCode: "ZZ" },
      radiusM: 500,
      requestedCategories: ["culture"],
      domains: {},
      sources: {},
    });

    const controller = new AbortController();
    const input = AnalyseNeighbourhoodInputSchema.parse({
      coordinates: { lat: 38.7115, lon: -9.1449 },
      categories: ["culture"],
    });

    await analyseNeighbourhoodTool.handler(input, { signal: controller.signal });

    expect(mockedAnalyseNeighbourhood).toHaveBeenCalledWith(input, {
      signal: controller.signal,
    });
  });

  it("returns the composition result unchanged", async () => {
    const profile = {
      detail: "brief" as const,
      location: { name: "38.7003, -9.4210", countryCode: "ZZ" },
      radiusM: 500,
      requestedCategories: ["parks" as const],
      domains: {
        greenSpace: {
          rating: "none" as const,
          count: 0,
          radiusM: 500,
          densityPerKm2: 0,
          countCapped: false,
          rings: [{ radiusM: 500, count: 0 }],
        },
      },
      sources: { greenSpace: { status: "ok" as const } },
    };
    mockedAnalyseNeighbourhood.mockResolvedValue(profile);

    const input = AnalyseNeighbourhoodInputSchema.parse({
      coordinates: { lat: 38.7003, lon: -9.421 },
      categories: ["parks"],
      detail: "brief",
    });

    const result = await analyseNeighbourhoodTool.handler(input);
    expect(isToolError(result)).toBe(false);
    expect(result).toEqual(profile);
  });
});
