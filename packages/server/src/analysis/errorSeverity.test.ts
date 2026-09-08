import { notFound, quotaExceeded, ToolErrorCode, upstreamError } from "@bearings/shared";
import { describe, expect, it } from "vitest";
import { ERROR_SEVERITY, moreSevereError, worstOfErrors } from "./errorSeverity.js";

describe("ERROR_SEVERITY", () => {
  it("ranks QUOTA_EXCEEDED below UPSTREAM_ERROR", () => {
    expect(ERROR_SEVERITY[ToolErrorCode.QUOTA_EXCEEDED]).toBeLessThan(
      ERROR_SEVERITY[ToolErrorCode.UPSTREAM_ERROR],
    );
  });
});

describe("moreSevereError", () => {
  it("returns the worse error with the other in details.alsoFailed", () => {
    const forecastError = upstreamError("Open-Meteo failed", "open-meteo");
    const holidayError = notFound("country ZZ not supported");

    const result = moreSevereError(forecastError, holidayError);

    expect(result.code).toBe(ToolErrorCode.UPSTREAM_ERROR);
    expect(result.details?.alsoFailed).toEqual(holidayError);
  });

  it("keeps the first error on equal severity", () => {
    const first = upstreamError("first", "open-meteo");
    const second = upstreamError("second", "nager");

    const result = moreSevereError(first, second);

    expect(result.message).toBe("first");
    expect(result.details?.alsoFailed).toEqual(second);
  });
});

describe("worstOfErrors", () => {
  it("returns QUOTA_EXCEEDED over NOT_FOUND", () => {
    const result = worstOfErrors([
      notFound("empty"),
      quotaExceeded("Geoapify daily quota exceeded", "geoapify"),
    ]);
    expect(result.code).toBe(ToolErrorCode.QUOTA_EXCEEDED);
  });

  it("keeps the earliest error on equal severity", () => {
    const first = upstreamError("first", "geoapify");
    const second = upstreamError("second", "geoapify");
    expect(worstOfErrors([first, second]).message).toBe("first");
  });
});
