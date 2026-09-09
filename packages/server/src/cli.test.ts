import { describe, expect, it } from "vitest";
import { parseTransportMode } from "./cli.js";

describe("parseTransportMode", () => {
  it("defaults to stdio when no --transport flag is given", () => {
    expect(parseTransportMode(["node", "cli.js"])).toBe("stdio");
  });

  it("returns stdio when explicitly requested", () => {
    expect(parseTransportMode(["node", "cli.js", "--transport", "stdio"])).toBe("stdio");
  });

  it("returns http when requested", () => {
    expect(parseTransportMode(["node", "cli.js", "--transport", "http"])).toBe("http");
  });

  it("returns both when requested", () => {
    expect(parseTransportMode(["node", "cli.js", "--transport", "both"])).toBe("both");
  });

  it("rejects an unknown value, naming all three valid values", () => {
    expect(() => parseTransportMode(["node", "cli.js", "--transport", "bogus"])).toThrow(
      '--transport must be one of stdio, http, both, received "bogus"',
    );
  });

  it("rejects a --transport flag with no value following it", () => {
    expect(() => parseTransportMode(["node", "cli.js", "--transport"])).toThrow(
      '--transport must be one of stdio, http, both, received ""',
    );
  });
});
