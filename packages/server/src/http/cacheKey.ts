import type { HostId } from "./types.js";

/** Param names that must never appear in a cache key, even if a caller passes them. */
const CREDENTIAL_PARAM_NAMES = new Set(["apikey", "api_key", "access_token", "token"]);

export type CacheParams = Readonly<Record<string, string | readonly string[] | undefined>>;

const isCredentialParam = (name: string): boolean => CREDENTIAL_PARAM_NAMES.has(name.toLowerCase());

const formatQuerySegment = (params: CacheParams): string => {
  const pairs: Array<[string, string]> = [];

  for (const [name, value] of Object.entries(params)) {
    if (isCredentialParam(name) || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        pairs.push([name, item]);
      }
    } else if (typeof value === "string") {
      pairs.push([name, value]);
    }
  }

  pairs.sort(([leftName, leftValue], [rightName, rightValue]) => {
    const byName = leftName.localeCompare(rightName);
    return byName !== 0 ? byName : leftValue.localeCompare(rightValue);
  });

  return pairs
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
};

/** Builds a stable, credential-free cache key for an upstream request. */
export const buildCacheKey = (hostId: HostId, path: string, params: CacheParams = {}): string =>
  `${hostId}|${path}|${formatQuerySegment(params)}`;
