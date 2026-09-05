---
name: new-upstream-client
description: Scaffold a new upstream HTTP client in packages/server/src/upstream/ adhering to rate limits, cache TTL, and domain normalization.
---

# New Upstream Client

Scaffolds a new client under `packages/server/src/upstream/<name>.ts`.

## Rules & Invariants
- **No bare fetch** (Root Invariant 3): All calls must route through the HTTP client core (`packages/server/src/http/`), which manages rate limiting, caching, retries, and timeouts.
- **Upstream shapes never leak past boundary** (Server AGENTS.md): Upstream responses must be normalized directly into domain types from `@bearings/shared`.
- **Cache TTLs justified in MEMORY.md**: Every upstream must have a dedicated per-host TTL configuration documented in `MEMORY.md`.
- **Known Quirks**:
  - Nominatim: 1 req/sec hard limit, descriptive `User-Agent` header required, returns multiple ambiguous results (return `AMBIGUOUS`).
  - Open-Meteo: finite horizon, hourly arrays normalised to daily summary.
  - Nager.Date: calendar-year based, stays spanning Dec 31 require 2 queries, unsupported country codes return `NOT_FOUND`.
  - Geoapify: billed 1 credit per 20 places; `limit` is a cost lever; daily quota reset surfaces as `QUOTA_EXCEEDED`.

## Workflow
1. Add host entry, rate limit, and TTL configuration in `packages/server/src/http/config.ts`.
2. Document TTL reasoning in `MEMORY.md`.
3. Create `packages/server/src/upstream/<name>.ts` with normalized domain type return signatures.
4. Record sample JSON response in `packages/server/test/fixtures/<name>.json`.
5. Write unit tests in `packages/server/test/upstream/<name>.test.ts` mocking the HTTP core.
