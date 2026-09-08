import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRequiredEnv } from "./env.js";

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
