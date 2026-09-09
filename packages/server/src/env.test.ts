import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedOrigins, assertRequiredEnv, httpHost, httpPort } from "./env.js";

describe("assertRequiredEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEOAPIFY_API_KEY;
  });

  it("passes when GEOAPIFY_API_KEY is set", () => {
    process.env.GEOAPIFY_API_KEY = "test-key";
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    expect(() => assertRequiredEnv()).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits when GEOAPIFY_API_KEY is missing", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    assertRequiredEnv();

    expect(stderr).toHaveBeenCalledWith(
      "GEOAPIFY_API_KEY environment variable is required but not set",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("httpPort", () => {
  afterEach(() => {
    delete process.env.BEARINGS_HTTP_PORT;
  });

  it("defaults to 3000 when unset", () => {
    expect(httpPort()).toBe(3000);
  });

  it("uses an explicit override", () => {
    process.env.BEARINGS_HTTP_PORT = "8080";
    expect(httpPort()).toBe(8080);
  });

  it("rejects a non-integer value", () => {
    process.env.BEARINGS_HTTP_PORT = "not-a-port";
    expect(() => httpPort()).toThrow(
      'BEARINGS_HTTP_PORT must be an integer between 1 and 65535, received "not-a-port"',
    );
  });

  it("rejects an out-of-range value", () => {
    process.env.BEARINGS_HTTP_PORT = "70000";
    expect(() => httpPort()).toThrow(
      'BEARINGS_HTTP_PORT must be an integer between 1 and 65535, received "70000"',
    );
  });
});

describe("httpHost", () => {
  afterEach(() => {
    delete process.env.BEARINGS_HTTP_HOST;
  });

  it("defaults to 127.0.0.1 when unset", () => {
    expect(httpHost()).toBe("127.0.0.1");
  });

  it("uses an explicit override", () => {
    process.env.BEARINGS_HTTP_HOST = "0.0.0.0";
    expect(httpHost()).toBe("0.0.0.0");
  });
});

describe("allowedOrigins", () => {
  afterEach(() => {
    delete process.env.BEARINGS_ALLOWED_ORIGINS;
  });

  it("defaults to Vite's dev server on both loopback spellings", () => {
    expect(allowedOrigins()).toEqual(["http://localhost:5173", "http://127.0.0.1:5173"]);
  });

  it("parses a comma-separated override, trimming whitespace", () => {
    process.env.BEARINGS_ALLOWED_ORIGINS = " https://example.com , https://foo.example.com ";
    expect(allowedOrigins()).toEqual(["https://example.com", "https://foo.example.com"]);
  });
});
