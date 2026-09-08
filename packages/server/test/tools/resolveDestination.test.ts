import { ambiguous, isToolError, type ResolvedLocation, ToolErrorCode } from "@bearings/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDestinationTool } from "../../src/tools/resolveDestination.js";
import { resolveDestination } from "../../src/upstream/nominatim.js";

vi.mock("../../src/upstream/nominatim.js", () => ({
  resolveDestination: vi.fn(),
}));

const mockedResolve = vi.mocked(resolveDestination);

const lisbon: ResolvedLocation = {
  name: "Lisbon",
  coordinates: { lat: 38.7077507, lon: -9.1365919 },
  countryCode: "PT",
  displayName: "Lisbon, Portugal",
  admin: { county: "Lisbon", municipality: "Lisbon" },
  kind: "city",
  importance: 0.76,
  placeRank: 14,
  boundingBox: [38.69, 38.79, -9.22, -9.08],
  osmType: "relation",
  osmId: 5400890,
};

const enrichmentKeys = [
  "kind",
  "importance",
  "placeRank",
  "boundingBox",
  "osmType",
  "osmId",
] as const;

describe("resolveDestinationTool", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("brief shaping drops the enrichment fields, keeping the core location", async () => {
    mockedResolve.mockResolvedValue(lisbon);

    const result = (await resolveDestinationTool.handler({
      query: "Lisbon",
      limit: 5,
      detail: "brief",
    })) as Record<string, unknown>;

    for (const key of enrichmentKeys) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result).toEqual({
      name: "Lisbon",
      coordinates: { lat: 38.7077507, lon: -9.1365919 },
      countryCode: "PT",
      displayName: "Lisbon, Portugal",
      admin: { county: "Lisbon", municipality: "Lisbon" },
    });
  });

  it("full shaping returns the whole ResolvedLocation", async () => {
    mockedResolve.mockResolvedValue(lisbon);

    const result = await resolveDestinationTool.handler({
      query: "Lisbon",
      limit: 5,
      detail: "full",
    });

    expect(result).toEqual(lisbon);
  });

  it("passes an AMBIGUOUS error through, shaping each candidate's location", async () => {
    mockedResolve.mockResolvedValue(
      ambiguous('"Springfield" matched 2 places; specify which', [
        { location: lisbon, importance: 0.61, kind: "city" },
        { location: { ...lisbon, name: "Springfield" }, importance: 0.6, kind: "city" },
      ]),
    );

    const brief = await resolveDestinationTool.handler({
      query: "Springfield",
      limit: 6,
      detail: "brief",
    });

    expect(isToolError(brief)).toBe(true);
    if (!isToolError(brief) || !("candidates" in brief)) return;
    expect(brief.code).toBe(ToolErrorCode.AMBIGUOUS);
    expect(brief.candidates).toHaveLength(2);
    for (const candidate of brief.candidates) {
      expect(typeof candidate.importance).toBe("number");
      expect(candidate.kind).toBe("city");
      for (const key of enrichmentKeys) {
        expect(candidate.location).not.toHaveProperty(key);
      }
    }

    const full = await resolveDestinationTool.handler({
      query: "Springfield",
      limit: 6,
      detail: "full",
    });
    if (!isToolError(full) || !("candidates" in full)) return;
    expect(full.candidates[0]?.location).toHaveProperty("kind", "city");
  });

  it("passes a NOT_FOUND error through untouched", async () => {
    const notFoundError = {
      code: ToolErrorCode.NOT_FOUND as const,
      message: 'Nominatim found no match for "nowhere"',
    };
    mockedResolve.mockResolvedValue(notFoundError);

    const result = await resolveDestinationTool.handler({
      query: "nowhere",
      limit: 5,
      detail: "brief",
    });

    expect(result).toBe(notFoundError);
  });

  it("forwards countryCode, limit and context.signal to the upstream", async () => {
    mockedResolve.mockResolvedValue(lisbon);
    const controller = new AbortController();

    await resolveDestinationTool.handler(
      { query: "Lisbon", countryCode: "PT", limit: 3, detail: "brief" },
      { signal: controller.signal },
    );

    expect(mockedResolve).toHaveBeenCalledWith("Lisbon", {
      countryCode: "PT",
      limit: 3,
      signal: controller.signal,
    });
  });

  it("rejects a 1-character query at the schema, before the handler can call the upstream", () => {
    const parsed = resolveDestinationTool.inputSchema.safeParse({ query: "a" });
    expect(parsed.success).toBe(false);
    expect(mockedResolve).not.toHaveBeenCalled();
  });
});
