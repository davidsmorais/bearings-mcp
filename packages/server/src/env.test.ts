import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowedHosts,
  allowedOrigins,
  assertRequiredEnv,
  httpHost,
  httpPort,
  loadEnvFile,
} from "./env.js";

describe("loadEnvFile", () => {
  const cwd = process.cwd();
  let root: string;

  afterEach(() => {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
    delete process.env.BEARINGS_TEST_FROM_FILE;
  });

  /** Builds a throwaway tree with an optional `.env` at its root, then cds `depth` levels below it. */
  const chdirInto = (envBody: string | undefined, depth = 0): void => {
    root = mkdtempSync(join(tmpdir(), "bearings-env-"));
    if (envBody !== undefined) {
      writeFileSync(join(root, ".env"), envBody);
    }
    const leaf = join(root, ...Array.from({ length: depth }, (_, i) => `level-${i}`));
    mkdirSync(leaf, { recursive: true });
    process.chdir(leaf);
  };

  it("loads a .env sitting in the current directory", () => {
    chdirInto("BEARINGS_TEST_FROM_FILE=loaded\n");

    loadEnvFile();

    expect(process.env.BEARINGS_TEST_FROM_FILE).toBe("loaded");
  });

  it("walks up to find a .env in an ancestor directory", () => {
    chdirInto("BEARINGS_TEST_FROM_FILE=from-ancestor\n", 2);

    loadEnvFile();

    expect(process.env.BEARINGS_TEST_FROM_FILE).toBe("from-ancestor");
  });

  it("leaves a variable already present in the real environment untouched", () => {
    chdirInto("BEARINGS_TEST_FROM_FILE=from-file\n");
    process.env.BEARINGS_TEST_FROM_FILE = "from-shell";

    loadEnvFile();

    expect(process.env.BEARINGS_TEST_FROM_FILE).toBe("from-shell");
  });

  it("is a no-op when no .env exists on the path", () => {
    chdirInto(undefined);

    expect(() => loadEnvFile()).not.toThrow();
    expect(process.env.BEARINGS_TEST_FROM_FILE).toBeUndefined();
  });
});

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
      expect.stringContaining("GEOAPIFY_API_KEY environment variable is required but not set"),
    );
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("cp .env.example .env"));
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

describe("allowedHosts", () => {
  afterEach(() => {
    delete process.env.BEARINGS_ALLOWED_HOSTS;
    delete process.env.BEARINGS_HTTP_HOST;
  });

  it("defaults to loopback plus the resolved bind host, deduped", () => {
    expect(allowedHosts()).toEqual(["127.0.0.1", "localhost", "[::1]"]);
  });

  it("includes a non-loopback BEARINGS_HTTP_HOST in the default set", () => {
    process.env.BEARINGS_HTTP_HOST = "bearings.local";
    expect(allowedHosts()).toEqual(["127.0.0.1", "localhost", "[::1]", "bearings.local"]);
  });

  it("parses a comma-separated override, trimming whitespace", () => {
    process.env.BEARINGS_ALLOWED_HOSTS = " bearings.example.com , api.example.com ";
    expect(allowedHosts()).toEqual(["bearings.example.com", "api.example.com"]);
  });
});
