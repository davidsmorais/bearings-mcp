import { describe, expect, it } from "vitest";
import {
  ambiguous,
  internalError,
  invalidInput,
  isToolError,
  notFound,
  quotaExceeded,
  rateLimited,
  ToolErrorCode,
  upstreamTimeout,
} from "./errors.js";

describe("errors", () => {
  it("invalidInput creates a well-formed INVALID_INPUT error", () => {
    const error = invalidInput("radiusM must be 5000 or less, received 50000", "radiusM");
    expect(error).toEqual({
      code: ToolErrorCode.INVALID_INPUT,
      message: "radiusM must be 5000 or less, received 50000",
      field: "radiusM",
    });
    expect(isToolError(error)).toBe(true);
  });

  it("ambiguous carries candidate locations", () => {
    const candidates = [
      {
        name: "Paris",
        coordinates: { lat: 48.8566, lon: 2.3522 },
        countryCode: "FR",
      },
    ];
    const error = ambiguous("multiple matches for Paris", candidates);
    expect(error).toEqual({
      code: ToolErrorCode.AMBIGUOUS,
      message: "multiple matches for Paris",
      candidates,
    });
    expect(isToolError(error)).toBe(true);
  });

  it("rateLimited carries upstream and retryAfterMs", () => {
    const error = rateLimited("Nominatim rate limit hit", "nominatim", 900);
    expect(error).toEqual({
      code: ToolErrorCode.RATE_LIMITED,
      message: "Nominatim rate limit hit",
      upstream: "nominatim",
      retryAfterMs: 900,
    });
    expect(isToolError(error)).toBe(true);
  });

  it("upstreamTimeout carries upstream and timeoutMs", () => {
    const error = upstreamTimeout("Open-Meteo timed out", "open-meteo", 5000);
    expect(error).toEqual({
      code: ToolErrorCode.UPSTREAM_TIMEOUT,
      message: "Open-Meteo timed out",
      upstream: "open-meteo",
      timeoutMs: 5000,
    });
    expect(isToolError(error)).toBe(true);
  });

  it("quotaExceeded carries upstream and optional resetsAt", () => {
    const withReset = quotaExceeded(
      "Geoapify daily cap reached",
      "geoapify",
      "2026-09-07T00:00:00Z",
    );
    expect(withReset).toEqual({
      code: ToolErrorCode.QUOTA_EXCEEDED,
      message: "Geoapify daily cap reached",
      upstream: "geoapify",
      resetsAt: "2026-09-07T00:00:00Z",
    });

    const withoutReset = quotaExceeded("Geoapify daily cap reached", "geoapify");
    expect(withoutReset).toEqual({
      code: ToolErrorCode.QUOTA_EXCEEDED,
      message: "Geoapify daily cap reached",
      upstream: "geoapify",
    });
    expect(isToolError(withReset)).toBe(true);
    expect(isToolError(withoutReset)).toBe(true);
  });

  it("notFound creates a message-only error", () => {
    const error = notFound("destination could not be resolved");
    expect(error).toEqual({
      code: ToolErrorCode.NOT_FOUND,
      message: "destination could not be resolved",
    });
    expect(isToolError(error)).toBe(true);
  });

  it("internalError creates a message-only error", () => {
    const error = internalError("unexpected failure");
    expect(error).toEqual({
      code: ToolErrorCode.INTERNAL_ERROR,
      message: "unexpected failure",
    });
    expect(isToolError(error)).toBe(true);
  });

  it("rejects non-ToolError values with isToolError", () => {
    expect(isToolError(null)).toBe(false);
    expect(isToolError(undefined)).toBe(false);
    expect(isToolError("error")).toBe(false);
    expect(isToolError(new Error("oops"))).toBe(false);
    expect(isToolError({ code: "FAIL", message: "fail" })).toBe(false);
    expect(isToolError({ code: 123, message: "fail" })).toBe(false);
    expect(isToolError({ code: "US", message: "United States" })).toBe(false);
    expect(
      isToolError({
        code: ToolErrorCode.INVALID_INPUT,
        message: "bad input",
        field: "query",
      }),
    ).toBe(true);
  });

  it("rejects a real ToolErrorCode whose variant-specific fields are missing", () => {
    // A domain object that merely happens to carry a recognised `code` must not be
    // mistaken for an error — each variant's own fields have to be present too.
    expect(isToolError({ code: ToolErrorCode.INVALID_INPUT, message: "bad input" })).toBe(false);
    expect(isToolError({ code: ToolErrorCode.AMBIGUOUS, message: "multiple matches" })).toBe(false);
    expect(
      isToolError({
        code: ToolErrorCode.RATE_LIMITED,
        message: "slow down",
        upstream: "nominatim",
      }),
    ).toBe(false);
    expect(
      isToolError({
        code: ToolErrorCode.UPSTREAM_TIMEOUT,
        message: "timed out",
        upstream: "open-meteo",
      }),
    ).toBe(false);
    expect(isToolError({ code: ToolErrorCode.QUOTA_EXCEEDED, message: "over quota" })).toBe(false);
  });
});
