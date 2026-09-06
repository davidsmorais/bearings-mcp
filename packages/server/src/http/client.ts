import { createToolError, type ToolError } from "@bearings/shared";
import { createCache } from "./cache.js";
import { buildCacheKey, type CacheParams } from "./cacheKey.js";
import { HOST_CONFIG } from "./config.js";
import { mapHttpError } from "./mapError.js";
import { type Clock, createRateLimiter, type RateLimiter } from "./rateLimiter.js";
import { computeBackoffDelay, isRetryable } from "./retry.js";
import { createAttemptTimeout } from "./timeout.js";
import type { HostId, HttpResult, RequestMeta } from "./types.js";

export interface HttpCoreDeps {
  readonly fetch?: typeof fetch;
  readonly clock?: Clock;
  readonly maxEntries?: number;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface HttpCore {
  request<T>(
    hostId: HostId,
    path: string,
    params?: CacheParams,
    opts?: RequestOptions,
  ): Promise<HttpResult<T>>;
}

const defaultClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const buildUrl = (baseUrl: string, path: string, params: CacheParams): URL => {
  const url = new URL(path, baseUrl);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(name, item);
      }
    } else if (typeof value === "string") {
      url.searchParams.set(name, value);
    }
  }
  return url;
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const missingGeoapifyKey = (hostId: HostId): ToolError | undefined => {
  if (hostId === "geoapify" && !process.env.GEOAPIFY_API_KEY) {
    return createToolError(
      "UPSTREAM_ERROR",
      "GEOAPIFY_API_KEY environment variable is required for Geoapify requests",
      { hostId, attempts: 0 },
    );
  }
  return undefined;
};

const mapCallerAbort = (hostId: HostId, attempts: number): ToolError =>
  createToolError("UPSTREAM_ERROR", `${hostId} request was cancelled`, {
    hostId,
    attempts,
  });

export function createHttpCore(deps: HttpCoreDeps = {}): HttpCore {
  const fetchFn = deps.fetch ?? fetch;
  const clock = deps.clock ?? defaultClock;
  const cache = createCache<unknown>({
    maxEntries: deps.maxEntries,
    clock: { now: clock.now },
  });
  const limiters = new Map<HostId, RateLimiter>();
  const inFlight = new Map<string, Promise<HttpResult<unknown>>>();

  const getLimiter = (hostId: HostId): RateLimiter => {
    let limiter = limiters.get(hostId);
    if (limiter === undefined) {
      limiter = createRateLimiter(HOST_CONFIG[hostId].rateLimit, clock);
      limiters.set(hostId, limiter);
    }
    return limiter;
  };

  const executeRequest = async <T>(
    hostId: HostId,
    path: string,
    params: CacheParams,
    signal: AbortSignal | undefined,
    cacheKey: string,
  ): Promise<HttpResult<T>> => {
    const config = HOST_CONFIG[hostId];
    const startedAt = clock.now();
    let lastStatus: number | undefined;
    let lastBody: unknown;
    let attempts = 0;

    const missingKey = missingGeoapifyKey(hostId);
    if (missingKey !== undefined) {
      return missingKey;
    }

    for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt += 1) {
      attempts = attempt;

      try {
        await getLimiter(hostId).acquire(signal);
      } catch {
        return mapCallerAbort(hostId, attempts);
      }

      const attemptTimeout = createAttemptTimeout(config.timeoutMs, signal);

      try {
        const url = buildUrl(config.baseUrl, path, params);
        config.authenticate?.(url);

        const response = await fetchFn(url, {
          method: "GET",
          headers: config.headers,
          signal: attemptTimeout.signal,
        });

        lastStatus = response.status;
        lastBody = await parseResponseBody(response);

        if (response.ok) {
          const data = lastBody as T;
          cache.set(cacheKey, data, config.cacheTtlMs);
          const meta: RequestMeta = {
            hostId,
            cacheHit: false,
            attempts,
            durationMs: clock.now() - startedAt,
            status: response.status,
          };
          return { ok: true, data, meta };
        }

        if (isRetryable(response.status) && attempt < config.retry.maxAttempts) {
          const delayMs = computeBackoffDelay({
            attempt,
            baseDelayMs: config.retry.baseDelayMs,
            maxDelayMs: config.retry.maxDelayMs,
            status: response.status,
            retryAfterHeader: response.headers.get("Retry-After"),
          });
          await clock.sleep(delayMs);
          continue;
        }

        return mapHttpError({
          hostId,
          config,
          attempts,
          status: lastStatus,
          body: lastBody,
        });
      } catch (error) {
        const retryContext = {
          didTimeout: attemptTimeout.didTimeout(),
          didCallerAbort: attemptTimeout.didCallerAbort(),
        };

        if (retryContext.didCallerAbort) {
          return mapCallerAbort(hostId, attempts);
        }

        if (isRetryable(error, retryContext) && attempt < config.retry.maxAttempts) {
          const delayMs = computeBackoffDelay({
            attempt,
            baseDelayMs: config.retry.baseDelayMs,
            maxDelayMs: config.retry.maxDelayMs,
          });
          await clock.sleep(delayMs);
          continue;
        }

        if (retryContext.didTimeout) {
          return mapHttpError({
            hostId,
            config,
            attempts,
            timedOut: true,
            timeoutMs: config.timeoutMs,
          });
        }

        return mapHttpError({
          hostId,
          config,
          attempts,
          status: lastStatus,
          body: lastBody,
        });
      } finally {
        attemptTimeout.dispose();
      }
    }

    return mapHttpError({
      hostId,
      config,
      attempts,
      status: lastStatus,
      body: lastBody,
    });
  };

  const request = async <T>(
    hostId: HostId,
    path: string,
    params: CacheParams = {},
    opts: RequestOptions = {},
  ): Promise<HttpResult<T>> => {
    const cacheKey = buildCacheKey(hostId, path, params);
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      const meta: RequestMeta = {
        hostId,
        cacheHit: true,
        attempts: 0,
        durationMs: 0,
      };
      return { ok: true, data: cached as T, meta };
    }

    const existing = inFlight.get(cacheKey);
    if (existing !== undefined) {
      return existing as Promise<HttpResult<T>>;
    }

    const flight = executeRequest<T>(hostId, path, params, opts.signal, cacheKey).finally(() => {
      inFlight.delete(cacheKey);
    });

    inFlight.set(cacheKey, flight as Promise<HttpResult<unknown>>);
    return flight;
  };

  return { request };
}
