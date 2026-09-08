import { describe, expect, it } from "vitest";
import { createCache } from "./cache.js";
import { buildCacheKey } from "./cacheKey.js";

describe("createCache", () => {
  it("returns a hit before TTL and misses after expiry", () => {
    let now = 0;
    const cache = createCache<string>({
      clock: { now: () => now },
    });

    cache.set("key", "value", 1000);
    expect(cache.get("key")).toBe("value");

    now = 999;
    expect(cache.get("key")).toBe("value");

    now = 1000;
    expect(cache.get("key")).toBeUndefined();
  });

  it("evicts the oldest entry when maxEntries is reached", () => {
    const cache = createCache<string>({ maxEntries: 2, clock: { now: () => 0 } });

    cache.set("a", "alpha", 10_000);
    cache.set("b", "beta", 10_000);
    cache.set("c", "gamma", 10_000);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("beta");
    expect(cache.get("c")).toBe("gamma");
  });

  it("promotes entries on read so recently used keys survive eviction", () => {
    const cache = createCache<string>({ maxEntries: 2, clock: { now: () => 0 } });

    cache.set("a", "alpha", 10_000);
    cache.set("b", "beta", 10_000);
    expect(cache.get("a")).toBe("alpha");
    cache.set("c", "gamma", 10_000);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("alpha");
    expect(cache.get("c")).toBe("gamma");
  });
});

describe("buildCacheKey", () => {
  it("treats param order as equivalent", () => {
    const left = buildCacheKey("nominatim", "/search", { a: "1", b: "2" });
    const right = buildCacheKey("nominatim", "/search", { b: "2", a: "1" });
    expect(left).toBe(right);
    expect(left).toBe("nominatim|/search|a=1&b=2");
  });

  it("never includes credential params in the cache key", () => {
    const key = buildCacheKey("geoapify", "/v2/places", {
      apiKey: "secret-key",
      api_key: "also-secret",
      categories: "catering.restaurant",
    });

    expect(key).not.toContain("secret");
    expect(key).not.toContain("apiKey");
    expect(key).not.toContain("api_key");
    expect(key).toBe("geoapify|/v2/places|categories=catering.restaurant");
  });
});
