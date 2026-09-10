const RETRYABLE_STATUS_CODES = new Set([408, 429]);

export interface RetryContext {
  readonly didTimeout: boolean;
  readonly didCallerAbort: boolean;
}

export interface BackoffOptions {
  readonly attempt: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly status?: number;
  readonly retryAfterHeader?: string | null;
}

/** Parses Retry-After as delta-seconds or HTTP-date; returns milliseconds or undefined. */
export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (header === null || header === undefined || header.trim() === "") {
    return undefined;
  }

  const asSeconds = Number(header);
  if (!Number.isNaN(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1000;
  }

  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }

  return undefined;
}

/** Full jitter: uniform random in [0, capped exponential delay). */
export function computeBackoffDelay(options: BackoffOptions): number {
  const { attempt, baseDelayMs, maxDelayMs, status, retryAfterHeader } = options;

  if (status === 429 || status === 503) {
    const retryAfterMs = parseRetryAfter(retryAfterHeader);
    if (retryAfterMs !== undefined) {
      return Math.min(retryAfterMs, maxDelayMs);
    }
  }

  const capped = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return Math.floor(Math.random() * capped);
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as NodeJS.ErrnoException).code);
    return (
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "UND_ERR_CONNECT_TIMEOUT"
    );
  }

  return false;
}

function isRetryableStatus(status: number): boolean {
  if (RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }
  if (status >= 500) {
    return true;
  }
  if (status >= 400 && status < 500) {
    return false;
  }
  return false;
}

function isRetryableError(error: unknown, context: RetryContext): boolean {
  if (context.didCallerAbort) {
    return false;
  }
  if (context.didTimeout) {
    return true;
  }
  return isNetworkError(error);
}

export function isRetryable(status: number): boolean;
export function isRetryable(error: unknown, context: RetryContext): boolean;
export function isRetryable(statusOrError: number | unknown, context?: RetryContext): boolean {
  if (typeof statusOrError === "number") {
    return isRetryableStatus(statusOrError);
  }
  if (context === undefined) {
    return false;
  }
  return isRetryableError(statusOrError, context);
}
