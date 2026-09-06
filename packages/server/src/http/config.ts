import { ToolErrorCode } from "@bearings/shared";
import type { HostConfig, HostId } from "./types.js";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const DEFAULT_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
} as const;

const DEFAULT_TIMEOUT_MS = 10_000;

function isGeoapifyQuotaExceeded(body: unknown): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const message = String(
    (body as Record<string, unknown>).message ??
      (body as Record<string, unknown>).statusMessage ??
      "",
  ).toLowerCase();
  return message.includes("quota") || (message.includes("daily") && message.includes("limit"));
}

function classifyGeoapifyStatus(status: number, body: unknown): ToolErrorCode | undefined {
  if (status === 429 && isGeoapifyQuotaExceeded(body)) {
    return ToolErrorCode.QUOTA_EXCEEDED;
  }
  return undefined;
}

function authenticateGeoapify(url: URL): void {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (apiKey) {
    url.searchParams.set("apiKey", apiKey);
  }
}

export const HOST_CONFIG: Record<HostId, HostConfig> = {
  nominatim: {
    baseUrl: "https://nominatim.openstreetmap.org",
    headers: {
      "User-Agent": "BearingsMCP/0.1.0 (destination intelligence MCP server)",
    },
    // capacity must stay 1: a bucket above 1 lets that many requests through instantly —
    // e.g. capacity 5 refilling at 1/s is a 5-request burst, not a 1 req/sec limiter.
    rateLimit: { capacity: 1, refillPerSecond: 1 },
    cacheTtlMs: 30 * MS_PER_DAY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: DEFAULT_RETRY,
  },
  "open-meteo": {
    baseUrl: "https://api.open-meteo.com",
    rateLimit: { capacity: 10, refillPerSecond: 10 },
    cacheTtlMs: 6 * MS_PER_HOUR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: DEFAULT_RETRY,
  },
  nager: {
    baseUrl: "https://date.nager.at",
    rateLimit: { capacity: 10, refillPerSecond: 10 },
    cacheTtlMs: 365 * MS_PER_DAY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: DEFAULT_RETRY,
  },
  geoapify: {
    baseUrl: "https://api.geoapify.com",
    rateLimit: { capacity: 5, refillPerSecond: 5 },
    cacheTtlMs: 7 * MS_PER_DAY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: DEFAULT_RETRY,
    authenticate: authenticateGeoapify,
    classifyStatus: classifyGeoapifyStatus,
  },
};
