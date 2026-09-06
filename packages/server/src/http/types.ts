import type { ToolError, ToolErrorCode } from "@bearings/shared";

export type HostId = "nominatim" | "open-meteo" | "nager" | "geoapify";

export interface HostConfig {
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly rateLimit: { readonly capacity: number; readonly refillPerSecond: number };
  readonly cacheTtlMs: number;
  readonly timeoutMs: number;
  readonly retry: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
  };
  /** Injects credentials AFTER the cache key is computed. Never part of the key. */
  readonly authenticate?: (url: URL) => void;
  /** Host-specific status → code override (Geoapify quota vs. generic 429). */
  readonly classifyStatus?: (status: number, body: unknown) => ToolErrorCode | undefined;
}

export interface RequestMeta {
  readonly hostId: HostId;
  readonly cacheHit: boolean;
  readonly attempts: number;
  readonly durationMs: number;
  readonly status?: number;
}

export type HttpResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: RequestMeta }
  | ToolError;
