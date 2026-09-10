import { createToolError, type ToolError } from "@bearings/shared";
import { faultInjectionEnabled } from "../env.js";
import { createCache } from "./cache.js";
import { buildCacheKey, type CacheParams } from "./cacheKey.js";
import { HOST_CONFIG } from "./config.js";
import { type FaultKind, faultFor } from "./faults.js";
import { mapHttpError } from "./mapError.js";
import { abortError, type Clock, createRateLimiter, type RateLimiter } from "./rateLimiter.js";
import { computeBackoffDelay, isRetryable, isTerminalClassification } from "./retry.js";
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

interface InFlightFlight<T = unknown> {
  readonly controller: AbortController;
  promise: Promise<HttpResult<T>>;
  subscribers: number;
  attempts: number;
}

const defaultClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal));
        return;
      }
      let onAbort: (() => void) | undefined;
      const timer = setTimeout(() => {
        if (signal && onAbort) {
          signal.removeEventListener("abort", onAbort);
        }
        resolve();
      }, ms);
      if (signal) {
        onAbort = () => {
          clearTimeout(timer);
          reject(abortError(signal));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }),
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

/**
 * Turns an injected fault into the *same* `ToolError` the real failure path produces, by
 * routing it through `mapHttpError` rather than hand-constructing an error. That is the
 * whole point of injecting here in the core: everything downstream — the per-domain
 * partial composition, the sources block, the credit accounting — cannot tell an injected
 * Geoapify failure from a genuine one, so what the demo shows is the real path, not a
 * simulation of it.
 */
const mapInjectedFault = (hostId: HostId, kind: FaultKind): ToolError => {
  const config = HOST_CONFIG[hostId];

  switch (kind) {
    case "timeout":
      return mapHttpError({
        hostId,
        config,
        // A real timeout exhausts the retry budget before surfacing; reporting one
        // attempt would understate what a timeout actually costs in wall-clock time.
        attempts: config.retry.maxAttempts,
        timedOut: true,
        timeoutMs: config.timeoutMs,
      });
    case "rate_limited":
      return mapHttpError({ hostId, config, attempts: 1, status: 429 });
    case "quota_exceeded":
      // Geoapify signals quota exhaustion as a 429 with a quota message in the body;
      // the host config's classifier is what separates it from a plain rate limit, and
      // it must be the thing that runs here too.
      return mapHttpError({
        hostId,
        config,
        attempts: 1,
        status: 429,
        body: { message: "Daily quota limit exceeded" },
      });
    case "upstream_error":
      return mapHttpError({ hostId, config, attempts: 1, status: 502 });
  }
};

export function createHttpCore(deps: HttpCoreDeps = {}): HttpCore {
  const fetchFn = deps.fetch ?? fetch;
  const clock = deps.clock ?? defaultClock;
  const cache = createCache<unknown>({
    maxEntries: deps.maxEntries,
    clock: { now: clock.now },
  });
  const limiters = new Map<HostId, RateLimiter>();
  const inFlight = new Map<string, InFlightFlight<unknown>>();

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
    onAttempt?: (attempt: number) => void,
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
      onAttempt?.(attempt);

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

        // A host classifier gets first look: a Geoapify 429 that carries a daily-quota
        // message is `QUOTA_EXCEEDED`, which does not recover within a backoff window, so
        // it must break the loop here rather than be retried as a plain rate limit. The
        // fall-through below hands the same status and body to `mapHttpError`, which runs
        // the classifier again — so the returned `ToolError` is identical to a retried
        // one, only `attempts` differs.
        const classified = config.classifyStatus?.(response.status, lastBody);

        if (
          isRetryable(response.status) &&
          !isTerminalClassification(classified) &&
          attempt < config.retry.maxAttempts
        ) {
          const delayMs = computeBackoffDelay({
            attempt,
            baseDelayMs: config.retry.baseDelayMs,
            maxDelayMs: config.retry.maxDelayMs,
            status: response.status,
            retryAfterHeader: response.headers.get("Retry-After"),
          });
          try {
            await clock.sleep(delayMs, signal);
          } catch {
            return mapCallerAbort(hostId, attempts);
          }
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
          try {
            await clock.sleep(delayMs, signal);
          } catch {
            return mapCallerAbort(hostId, attempts);
          }
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
    // Checked before the cache read on purpose: a warm cache entry would otherwise
    // satisfy the request and the armed fault would silently never fire, which is the
    // most confusing possible behaviour for a debugging control.
    if (faultInjectionEnabled()) {
      const fault = faultFor(hostId);
      if (fault !== undefined) {
        return mapInjectedFault(hostId, fault);
      }
    }

    if (opts.signal?.aborted) {
      return mapCallerAbort(hostId, 0);
    }

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

    let flight = inFlight.get(cacheKey);
    if (flight === undefined) {
      const flightController = new AbortController();
      const flightEntry: InFlightFlight<unknown> = {
        controller: flightController,
        promise: undefined as unknown as Promise<HttpResult<unknown>>,
        subscribers: 0,
        attempts: 1,
      };

      const promise = executeRequest<unknown>(
        hostId,
        path,
        params,
        flightController.signal,
        cacheKey,
        (attempt) => {
          flightEntry.attempts = attempt;
        },
      ).finally(() => {
        if (inFlight.get(cacheKey) === flightEntry) {
          inFlight.delete(cacheKey);
        }
      });

      flightEntry.promise = promise;
      flight = flightEntry;
      inFlight.set(cacheKey, flight);
    }

    const currentFlight = flight;
    const signal = opts.signal;
    currentFlight.subscribers += 1;

    if (!signal) {
      return currentFlight.promise as Promise<HttpResult<T>>;
    }

    return new Promise<HttpResult<T>>((resolve) => {
      let settled = false;

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        currentFlight.subscribers = Math.max(0, currentFlight.subscribers - 1);
        if (currentFlight.subscribers === 0) {
          if (inFlight.get(cacheKey) === currentFlight) {
            inFlight.delete(cacheKey);
          }
          currentFlight.controller.abort();
        }
        resolve(mapCallerAbort(hostId, currentFlight.attempts));
      };

      signal.addEventListener("abort", onAbort, { once: true });

      if (signal.aborted) {
        onAbort();
        return;
      }

      currentFlight.promise
        .then((result) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result as HttpResult<T>);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(
            createToolError(
              "UPSTREAM_ERROR",
              `Unexpected error calling ${hostId}: ${error instanceof Error ? error.message : String(error)}`,
              { hostId, attempts: currentFlight.attempts },
            ),
          );
        });
    });
  };

  return { request };
}
