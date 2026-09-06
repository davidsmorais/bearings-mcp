export interface CreateCacheOptions {
  readonly maxEntries?: number;
  readonly clock?: { now(): number };
}

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttlMs: number): void;
}

const DEFAULT_MAX_ENTRIES = 500;

const defaultClock = {
  now: () => Date.now(),
};

/** Bounded in-memory cache with lazy TTL expiry and LRU eviction. */
export const createCache = <T>(options: CreateCacheOptions = {}): TtlCache<T> => {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const clock = options.clock ?? defaultClock;
  const store = new Map<string, CacheEntry<T>>();

  const evictOldest = (): void => {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) {
      store.delete(oldestKey);
    }
  };

  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (entry === undefined) {
        return undefined;
      }
      if (clock.now() >= entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },

    set(key: string, value: T, ttlMs: number): void {
      if (store.has(key)) {
        store.delete(key);
      } else if (store.size >= maxEntries) {
        evictOldest();
      }
      store.set(key, {
        value,
        expiresAt: clock.now() + ttlMs,
      });
    },
  };
};
