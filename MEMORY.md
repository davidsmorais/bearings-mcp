# MEMORY.md — Persistent Memory Index

*Read at the start of every session before taking action. Contains architecture decisions, active constraints, and context not derivable from code.*

---

## 🏛️ Current State of the Project

- **Monorepo Structure**: Managed via `pnpm` workspaces (`packages/shared`, `packages/server`, `packages/web`).
- **Tooling**: Biome 2.0 (linter & formatter), TypeScript 5.8.2 (ESM modules throughout), Vitest 3.0.9 for testing.
- **Active Phase**: Foundation & core infrastructure setup. **HTTP client core delivered (`_spells/003`, 2026-09-06)** — `packages/server/src/http/` with `createHttpCore()`, per-host rate limiting, bounded TTL cache, retry, and timeout. Production callers use `getHttpCore()`; upstream clients land in `_spells/001` Phase 2.
- **Harness scaffolding closed 2026-09-05**: `.claude/agents/*.md` (compiled subagent frontmatter for all 8), `.claude/skills/new-*` (copied from `.agents/skills/`), `CLAUDE.md`, and `hocus.md` were the remaining gaps from the initial build; all now present. See `hocus.md` for the full build queue and `AGENTS.md`'s Learned Facts for what was missing and why.
- **`.claude/{agents,skills}` are symlinks into `.agents/` (2026-09-06)**: every `.claude/agents/*.md` and `.claude/skills/*` (except the four hand-written skills `debug-issue`, `explore-codebase`, `refactor-safely`, `review-changes`) is a relative symlink to the corresponding file/dir under `.agents/`. `.agents/` is the source of truth; edit there.
- **Walking-skeleton MCP server delivered (`_spells/002`, 2026-09-06)**: `packages/server` now boots end to end over stdio. `src/registry.ts` (`tools` array + `assertUniqueToolNames`) is the single tool source; `src/server.ts` `createServer()` is the shared factory both transports use; `src/transports/stdio.ts` is the entrypoint (`dist/transports/stdio.js`, also the `bin`). One tool: `echo` (diagnostic, permanent). HTTP transport and the three real tools remain `_spells/001` work.
  - `@modelcontextprotocol/sdk@^1.30.0`; it needs `zod@^3.25`, so `packages/shared` and `packages/server` moved from `zod@^3.24.2` → `zod@^3.25.76`.
  - `defineTool` `handler` uses **method syntax** and `AnyToolSchema` (`z.ZodTypeAny`), cleanly supporting `.refine()` / `ZodEffects` while preserving inferred types and assignability in the registry.
  - `ToolContext` provides execution context (e.g. `signal?: AbortSignal`) forwarded from the transport to tool handlers.
  - Tool handlers return a **plain value** or `ToolError`; the MCP `{ content, structuredContent, isError }` envelope is applied once in `createServer()`. It discriminates `isToolError()` returns and catches thrown exceptions, mapping both through `toToolError(...)` (`INTERNAL_ERROR` for throws). Validation failures use `zodErrorToToolError(...)` with the raw input so messages name the field and echo the received value. For `.refine()` schemas it passes the unwrapped `ZodObject` to the SDK for JSON-Schema/field validation and re-runs the full schema (`safeParse`) in the wrapper to enforce refinements → `INVALID_INPUT`. No schema object is mutated.
  - `packages/shared/src/errors.ts` holds `ToolErrorCode` (string enum), the `ToolError` discriminated union, per-code constructors (`invalidInput`, `ambiguous`, …), and `isToolError`. `toToolError.ts` maps `ZodError` and unknown throws into that union.
- **Domain types & tool input schemas delivered (`_spells/004`, 2026-09-06)**: `packages/shared/src/` split into `types/` (`Coordinates`, `Location`, `TimeWindow`, `PoiCategory`), `schemas/` (one bounded input schema per tool + `toolInputSchemas` map in `index.ts`), and the error helpers above. Four tools registered (echo + three stubs). Inspector forms generated from shared schemas via `zod-to-json-schema`.
  - **`packages/web` new deps**: `tailwindcss` + `@tailwindcss/vite` (Tailwind v4 via Vite plugin), `zod-to-json-schema` (schema → JSON Schema for form fields). Both referenced from `vite.config.ts` / CSS — verify with `pnpm knip`.
  - **`echo` is exempt from the "every tool accepts `detail: brief|full`" rule** (server `AGENTS.md`) — it is a diagnostic with nothing to shape. Not a precedent for the real tools.
  - stdio stdout is the JSON-RPC channel — all diagnostics go to stderr; `src/index.ts` has no top-level statements. Tests live in `packages/server/test/`, typechecked via `tsconfig.test.json` (the `typecheck` script runs both configs).
- **Nager.Date client + holiday overlap logic delivered (`DMS-496`, 2026-09-08)**: first `packages/server/src/upstream/` client. `Holiday` domain type + `HolidaySchema` in `packages/shared` (`{ date, name, localName, countryCode }` — minimal, no global/counties scope fields). `fetchHolidaysInWindow(countryCode, window, { core?, signal? })` in `upstream/nager.ts`: derives every calendar year the `TimeWindow` touches (at most 2, given the 30-night cap), fans them out with `Promise.allSettled` through the shared HTTP core (`GET /api/v3/PublicHolidays/{year}/{cc}`), normalises, filters to the window **inclusive of both ends**, sorts ascending. `countryCode` on each result comes from the validated argument, never the upstream payload. Returns `HolidayLookup | ToolError`. Unsupported country (404 on every year) → `NOT_FOUND` with the code in the message, never `[]`. Year-boundary window where one year fails but the other succeeds → returns what it got plus `partial: { missingYears, reason }`; every year failing → propagates the first `ToolError`. The client takes an optional `core` for test injection (`createHttpCore({ fetch, clock })`); production omits it. Fixture: `packages/server/test/fixtures/nager.json` (captured AT 2026 + 2027). **Not wired into `get_destination_brief` — that is DMS-497** (also needs the Open-Meteo client, DMS-495). knip's temporary `src/http/index.ts` entry stays: upstream clients now import `getHttpCore` from the barrel but the rest of its surface is still test-only until DMS-497.
- **Nominatim client + `resolve_destination` disambiguation delivered (`DMS-494`, 2026-09-08)**: `upstream/nominatim.ts` — `resolveDestination(query, { countryCode?, limit, core?, signal? })` → `ResolvedLocation | ToolError`. Endpoint `GET /search` with `q, format=jsonv2, addressdetails=1, accept-language=en, limit=<n>` and `countrycodes=<lower>` only when `countryCode` is set. `accept-language=en` is a named constant — pins `name`/`displayName` so committed fixtures don't rot. Disambiguation heuristic (the point of the ticket, lives in the client like `nager.ts` owns its `NOT_FOUND`): 0 normalised hits → `NOT_FOUND` (never empty success); 1 → return it; multiple → return the top only if `top.importance - runnerUp.importance >= CONFIDENT_IMPORTANCE_GAP` (**0.15**, named constant), else `AMBIGUOUS`. Missing `importance` sorts as 0 and can't satisfy the gap (falls to `AMBIGUOUS`, the safe direction). No result-count ceiling. `normalisePlace` drops a hit (returns `undefined`) on missing/invalid `country_code`, out-of-range lat/lon, or empty name. `admin.state ← address.state ?? region`; `municipality ← municipality ?? city ?? town ?? village`. `NOMINATIM_KIND` maps `addresstype` → `PlaceKind` (`aerodrome`→`airport`, `administrative`→`region`, `hamlet`/`locality`→`locality`, unmapped→`other`).
  - **New shared types** (`packages/shared/src/types/resolvedLocation.ts`, barrel-exported): `PlaceKindSchema` (`z.enum([city,town,village,suburb,locality,airport,region,country,other])`), `ResolvedLocationSchema` = `LocationSchema.extend({ admin{state?,county?,municipality?} (object always present), kind?, importance? 0–1, placeRank? 0–30, boundingBox? [S,N,W,E] tuple, osmType? node|way|relation, osmId? })` — a **response-only superset** of `Location`, still structurally assignable to it, **not** added to `toolInputSchemas`. `LocationCandidateSchema` = `{ location: ResolvedLocation, importance 0–1, kind: PlaceKind }`.
  - **Widened `AMBIGUOUS` error**: `candidates` is now `readonly LocationCandidate[]` (was `readonly Location[]`); `ambiguous()` constructor signature updated. Additive to the variant, not a renamed code. `isToolError`'s `Array.isArray(record.candidates)` branch unchanged. Type-only reach into `packages/web` (`ToolError` — no code reads `candidates`).
  - **Tool handler** (`tools/resolveDestination.ts`, registry unchanged — was already wired): thin. Calls the client, passes `context.signal`, returns errors as-is except it re-shapes each `AMBIGUOUS` candidate's `location`. `shapeResolvedLocation(loc, detail)`: `brief` → `{ name, coordinates, countryCode, displayName, admin }`; `full` → the whole `ResolvedLocation`. Helper lives in the handler for now; promote to a shared shaper when `get_destination_brief` needs it (DMS-497).
  - Fixtures: `packages/server/test/fixtures/nominatim.json` — `lisbon` (confident, dominant hit), `springfield` (6 near-tied US hits → `AMBIGUOUS`), `asdkjhasd` (`[]` → `NOT_FOUND`). **Captured live** from `nominatim.openstreetmap.org/search` on 2026-09-08 with the exact params + the `config.ts` User-Agent (`_note` key records this). Forward geocoding only; no downstream wiring (DMS-497). `http/config.ts` `nominatim` host entry was already present from the HTTP-core ticket — untouched.
- **`typecheck` script now exists repo-wide**: `pnpm typecheck` → `pnpm -r run typecheck` → `tsc --noEmit` across all workspace packages (`shared`, `server` with both configs, and `web`). Root `pnpm lint` may be intercepted by a local tool wrapper that mislabels output — run `./node_modules/.bin/biome check .` directly to be certain.
- **Inspector React Query layer delivered (`_spells/004`, 2026-09-06)**: `packages/web` now has `@tanstack/react-query` v5 (mandated by `packages/web/AGENTS.md` since inception, never installed until now). `src/lib/queryClient.ts` (`retry: false`, `refetchOnWindowFocus: false`, `staleTime: 0`), `src/lib/mcpClient.ts` (`getMcpClient()` — lazy `Client` + `StreamableHTTPClientTransport`, memoises the connection *promise* for StrictMode double-mount), `src/lib/queryKeys.ts` (typed `toolKeys` factory), `src/hooks/useToolList.ts` (`useQuery`, `staleTime: Infinity`), `src/hooks/useToolCall.ts` (`useMutation`: client-side `@bearings/shared` schema validation before dispatch, `isError`/`structuredContent` → typed `ToolError`, `durationMs`). `@/*` → `./src/*` alias added to `tsconfig.json` + `vite.config.ts`. Vitest + `@testing-library/react` + happy-dom infra added; root `test` script filter fixed to include `@bearings/web` (was a live bug — web tests never ran in CI). **Boundary decided (see `DECISIONS.md`):** React Query for the inspector, custom core for upstreams; `@tanstack/*` is a `packages/web` dep only and is now a Forbidden Practice to import from `packages/server`. **Live end-to-end verification pending Linear DMS-503** (Streamable HTTP transport — does not exist yet); hooks are pinned by mocked-client unit tests, not a click-through.
- **`knip` configured repo-wide (2026-09-06)**: Monorepo cleanliness tool installed at root (`knip.jsonc`). Verifies unused files, dependencies, and non-entry exports across `packages/shared`, `packages/server`, and `packages/web`. Wired to root `pnpm knip` script and validated in GitHub Actions CI right after Biome linting.
- **Active Invariant Enforcement**:
  - `packages/shared` is the sole source for Zod input schemas and domain types.
  - `packages/server/src/registry.ts` is the single source for tool registration.
- **All upstream traffic must route through the HTTP client core** (`packages/server/src/http/`). Delivered 2026-09-06: `createHttpCore()` factory, `getHttpCore()` as the single production instance, bounded in-memory LRU cache, FIFO token-bucket rate limiter (Nominatim pinned to 1 req/sec), per-attempt timeout with typed `TIMEOUT` error, retry with `Retry-After` precedence. No disk persistence — in-memory only.

---

## ⏱️ Upstream Cache TTL Policies & Justifications

*Per packages/server/AGENTS.md, cache TTL configurations must be per-host and justified in this file.*

| Host / Upstream | Cache TTL | Justification |
|---|---|---|
| `nominatim.openstreetmap.org` (Nominatim Geocoding) | **30 days** | Geocoding coordinates, administrative boundaries, and canonical place names are effectively static geographic facts. Long TTL prevents repeat lookups and protects against Nominatim's strict 1 req/sec rate limit. |
| `api.open-meteo.com` (Open-Meteo Weather) | **6 hours** | Weather forecasts evolve through standard meteorological model updates (typically 4 times daily). A 6-hour TTL guarantees freshness while preventing repetitive roundtrips during an active user stay query. |
| `date.nager.at` (Nager.Date Public Holidays) | **365 days** | Official national and regional public holiday schedules are gazetted annually and remain invariant across a calendar year. |
| `api.geoapify.com` (Geoapify Places POI) | **7 days** | POI density (restaurants, bars, parks, transit stops) changes slowly over weeks/months. A 7-day TTL strikes the optimal balance between spatial currency and conserving our 3,000 credit/day free-tier quota (1 credit burned per 20 places). |

---

## 🔌 Upstream Rate Limit & Operational Constraints

- **Nominatim IP Hard Limits**:
  - Max 1 request per second strictly enforced on IP level. Violations result in automatic IP bans lasting hours.
  - Every request must provide a descriptive `User-Agent` header.
  - When Nominatim returns multiple candidate places, the tool must return a structured `AMBIGUOUS` response listing alternatives; never assume `results[0]`.
- **Open-Meteo Horizon**:
  - Forecasts are only valid within a finite forward horizon (typically 16 days). Queries beyond this horizon must be rejected early with clear error messaging.
  - Hourly output arrays must be normalised to daily aggregates before returning to tool consumers.
- **Open-Meteo client & normalisation decisions** (`upstream/openMeteo.ts`, DMS-495, 2026-09-08):
  - `fetchForecast(coordinates, range, deps?)` requests the **hourly** series (`temperature_2m,precipitation,weather_code`, `timezone=auto`) and aggregates it ourselves — we do not use Open-Meteo's server-side `daily` block, so the daily `condition` is our decision.
  - Horizon = **16 days**: `today .. today+15` (UTC). Range **entirely** outside (fully past, or starting past `today+15`) → `NOT_FOUND` with the latest available date, no upstream call. Range **partly** outside → clamped to the covered window, `truncated: true` + `truncationReason` on the `Forecast`; `requestedRange` vs `coveredRange` both reported.
  - Daily `condition`: **modal WMO code among daytime hours (06:00–20:00 local)**, ties broken toward the higher (more disruptive) code; falls back to all 24h if a day has no daytime samples. Temp min/max and precipitation total use all 24h.
  - WMO code → `WeatherCondition` map lives in `upstream/weatherCode.ts`; only codes Open-Meteo emits are mapped, an unmapped code logs to stderr and falls back to `overcast`.
  - Coordinates are sent (and cache-keyed) at **4 dp** (~11 m) via `toFixed(4)` so trivial float differences don't fragment the cache.
  - `get_destination_brief` is still a stub — wiring it (with Nager holidays + partial-failure `sources`) is DMS-497, blocked on DMS-496.
- **Nager.Date Multi-Year Boundaries**:
  - API accepts queries strictly per calendar year. A stay spanning December 31 to January 2 requires two parallel queries merged in the normaliser.
  - Unsupported country codes must return `NOT_FOUND`, never an empty array pretending to be a complete calendar.
- **Geoapify Places Billing Model**:
  - Billed at 1 credit per 20 places returned. Setting `limit: 100` costs 5 credits per call.
  - `limit` is a cost lever, not just a layout option. Default to small limits (e.g. 20) for `"brief"` responses.
  - Daily credit cap resets on Geoapify's UTC midnight schedule. Cap exhaustion must surface as `QUOTA_EXCEEDED`.

---

## 🏨 Hotel Chain Code Challenge Context & Founder Strategic Decisions

- **Evaluation Context**: Bearings MCP is developed as a code challenge technical interview submission for a major hotel chain enterprise engineering team.
- **Founder Decisions (Midas)**:
  1. **Ditched Product Strategist**: Hotel chain technical evaluators prioritize architectural soundness, API rate-limit resilience, and strict type safety over marketing copy. Eliminating marketing overhead reduces noise.
  2. **Split Developers (`server-dev` & `web-dev`)**: Strict separation between the backend protocol engineer (Flamel) and the devtool engineer (Nostradamus). Proves architectural boundary discipline between MCP services and inspector instrumentation.
  3. **Domain Alignment with Hotel Guest Workflows**:
     - `resolve_destination`: Eliminates geocoding ambiguity for hotel properties, airports, and city centers.
     - `get_destination_brief`: Directly serves guest stay planning with meteorological forecasts and local public holiday awareness affecting hotel operations.
     - `analyse_neighbourhood`: Provides hotel concierges and booking platforms with an honest, walking-distance POI density profile (dining, nightlife, transit, culture) with evidence-backed venue counts.
  4. **Cost & Rate-Limit Safeguards**: Enterprise hotel scale would cause financial leakage if Geoapify POI page sizes were unconstrained (1 credit / 20 places), or operational downtime if Nominatim blacklisted the hotel's IP cluster (1 req/sec hard limit). Strict caps and token-bucket limiters are mission-critical.

---

## 📌 Architectural Invariants Reminder
1. Single tool registry in `packages/server/src/registry.ts`.
2. Zod schemas in `packages/shared` only; no duplicates in `packages/web`.
3. No bare `fetch()` to upstreams; route through HTTP client core.
4. Errors returned as `ToolError` union; never thrown as strings.
5. Transports (`stdio`, `http`) contain zero business logic.
6. Derived scores carry raw evidence (counts + radius).
7. Analysis thresholds defined as named constants in a single block.
8. Never commit `GEOAPIFY_API_KEY`.
9. Never loosen a schema without explicit instruction.
