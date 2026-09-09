import { afterEach, describe, expect, it } from "vitest";
import { clearFaults, faultFor, getFaults, parseFaultMap, setFaults } from "./faults.js";

afterEach(clearFaults);

describe("fault registry", () => {
  it("starts empty and reports no fault for any host", () => {
    expect(getFaults()).toEqual({});
    expect(faultFor("geoapify")).toBeUndefined();
  });

  it("arms and reads a fault per host", () => {
    setFaults({ geoapify: "upstream_error" });
    expect(faultFor("geoapify")).toBe("upstream_error");
    expect(faultFor("nominatim")).toBeUndefined();
  });

  it("replaces rather than merges, so unsetting a host clears it", () => {
    setFaults({ geoapify: "timeout", nominatim: "rate_limited" });
    setFaults({ geoapify: "timeout" });
    expect(faultFor("nominatim")).toBeUndefined();
  });

  it("hands out a copy — a caller cannot mutate the registry through it", () => {
    setFaults({ geoapify: "timeout" });
    const snapshot = getFaults();
    snapshot.geoapify = "quota_exceeded";
    expect(faultFor("geoapify")).toBe("timeout");
  });
});

describe("parseFaultMap", () => {
  it("accepts a valid map", () => {
    expect(parseFaultMap({ geoapify: "quota_exceeded" })).toEqual({
      geoapify: "quota_exceeded",
    });
  });

  it("treats an empty object as clearing every fault", () => {
    expect(parseFaultMap({})).toEqual({});
  });

  it("drops a null value rather than storing it", () => {
    expect(parseFaultMap({ geoapify: null })).toEqual({});
  });

  it.each([
    ["a non-object", "geoapify"],
    ["null", null],
    ["an array", ["geoapify"]],
    ["an unknown host", { mystery: "timeout" }],
    ["an unknown fault kind", { geoapify: "explode" }],
    ["a non-string kind", { geoapify: 7 }],
  ])("rejects %s", (_label, value) => {
    expect(parseFaultMap(value)).toBeUndefined();
  });
});
