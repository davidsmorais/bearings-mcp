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
  - stdio stdout is the JSON-RPC channel — all diagnostics go to stderr; `src/index.ts` has no top-level statements. **Every test file colocates with its target as `<target>.test.ts`** (see `packages/server/AGENTS.md`) — including `src/server.integration.test.ts`. `packages/server/test/` holds no test files, only `fixtures/` and shared helpers (`test/fakeClock.ts`). Test files are typechecked via `tsconfig.test.json` (the `typecheck` script runs both configs).
- **Nager.Date client + holiday overlap logic delivered (`DMS-496`, 2026-09-08)**: first `packages/server/src/upstream/` client. `Holiday` domain type + `HolidaySchema` in `packages/shared` (`{ date, name, localName, countryCode }` — minimal, no global/counties scope fields). `fetchHolidaysInWindow(countryCode, window, { core?, signal? })` in `upstream/nager.ts`: derives every calendar year the `TimeWindow` touches (at most 2, given the 30-night cap), fans them out with `Promise.allSettled` through the shared HTTP core (`GET /api/v3/PublicHolidays/{year}/{cc}`), normalises, filters to the window **inclusive of both ends**, sorts ascending. `countryCode` on each result comes from the validated argument, never the upstream payload. Returns `HolidayLookup | ToolError`. Unsupported country (404 on every year) → `NOT_FOUND` with the code in the message, never `[]`. Year-boundary window where one year fails but the other succeeds → returns what it got plus `partial: { missingYears, reason }`; every year failing → propagates the first `ToolError`. The client takes an optional `core` for test injection (`createHttpCore({ fetch, clock })`); production omits it. Fixture: `packages/server/test/fixtures/nager.json` (captured AT 2026 + 2027). Now consumed by `get_destination_brief` (DMS-497). knip's temporary `src/http/index.ts` entry **still stays** (re-checked DMS-497): production imports only `getHttpCore` from the barrel; `createHttpCore` / `HOST_CONFIG` and the re-exported http types are still test-only, so removing the entry makes knip flag them as unused exports.
- **Nominatim client + `resolve_destination` disambiguation delivered (`DMS-494`, 2026-09-08)**: `upstream/nominatim.ts` — `resolveDestination(query, { countryCode?, limit, core?, signal? })` → `ResolvedLocation | ToolError`. Endpoint `GET /search` with `q, format=jsonv2, addressdetails=1, accept-language=en, limit=<n>` and `countrycodes=<lower>` only when `countryCode` is set. `accept-language=en` is a named constant — pins `name`/`displayName` so committed fixtures don't rot. Disambiguation heuristic (the point of the ticket, lives in the client like `nager.ts` owns its `NOT_FOUND`): 0 normalised hits → `NOT_FOUND` (never empty success); 1 → return it; multiple → return the top only if `top.importance - runnerUp.importance >= CONFIDENT_IMPORTANCE_GAP` (**0.15**, named constant), else `AMBIGUOUS`. Missing `importance` sorts as 0 and can't satisfy the gap (falls to `AMBIGUOUS`, the safe direction). No result-count ceiling. `normalisePlace` drops a hit (returns `undefined`) on missing/invalid `country_code`, out-of-range lat/lon, or empty name. `admin.state ← address.state ?? region`; `municipality ← municipality ?? city ?? town ?? village`. `NOMINATIM_KIND` maps `addresstype` → `PlaceKind` (`aerodrome`→`airport`, `administrative`→`region`, `hamlet`/`locality`→`locality`, unmapped→`other`).
  - **New shared types** (`packages/shared/src/types/resolvedLocation.ts`, barrel-exported): `PlaceKindSchema` (`z.enum([city,town,village,suburb,locality,airport,region,country,other])`), `ResolvedLocationSchema` = `LocationSchema.extend({ admin{state?,county?,municipality?} (object always present), kind?, importance? 0–1, placeRank? 0–30, boundingBox? [S,N,W,E] tuple, osmType? node|way|relation, osmId? })` — a **response-only superset** of `Location`, still structurally assignable to it, **not** added to `toolInputSchemas`. `LocationCandidateSchema` = `{ location: ResolvedLocation, importance 0–1, kind: PlaceKind }`.
  - **Widened `AMBIGUOUS` error**: `candidates` is now `readonly LocationCandidate[]` (was `readonly Location[]`); `ambiguous()` constructor signature updated. Additive to the variant, not a renamed code. `isToolError`'s `Array.isArray(record.candidates)` branch unchanged. Type-only reach into `packages/web` (`ToolError` — no code reads `candidates`).
  - **Tool handler** (`tools/resolveDestination.ts`, registry unchanged — was already wired): thin. Calls the client, passes `context.signal`, returns errors as-is except it re-shapes each `AMBIGUOUS` candidate's `location`. `shapeResolvedLocation(loc, detail)`: `brief` → `{ name, coordinates, countryCode, displayName, admin }`; `full` → the whole `ResolvedLocation`. Helper lives in the handler for now; promote to a shared shaper when `get_destination_brief` needs it (DMS-497).
  - Fixtures: `packages/server/test/fixtures/nominatim.json` — `lisbon` (confident, dominant hit), `springfield` (6 near-tied US hits → `AMBIGUOUS`), `asdkjhasd` (`[]` → `NOT_FOUND`). **Captured live** from `nominatim.openstreetmap.org/search` on 2026-09-08 with the exact params + the `config.ts` User-Agent (`_note` key records this). Forward geocoding only; no downstream wiring (DMS-497). `http/config.ts` `nominatim` host entry was already present from the HTTP-core ticket — untouched.
- **`typecheck` script now exists repo-wide**: `pnpm typecheck` → `pnpm -r run typecheck` → `tsc --noEmit` across all workspace packages (`shared`, `server` with both configs, and `web`). Root `pnpm lint` may be intercepted by a local tool wrapper that mislabels output — run `./node_modules/.bin/biome check .` directly to be certain.
- **Inspector React Query layer delivered (`_spells/004`, 2026-09-06)**: `packages/web` now has `@tanstack/react-query` v5 (mandated by `packages/web/AGENTS.md` since inception, never installed until now). `src/lib/queryClient.ts` (`retry: false`, `refetchOnWindowFocus: false`, `staleTime: 0`), `src/lib/mcpClient.ts` (`getMcpClient()` — lazy `Client` + `StreamableHTTPClientTransport`, memoises the connection *promise* for StrictMode double-mount), `src/lib/queryKeys.ts` (typed `toolKeys` factory), `src/hooks/useToolList.ts` (`useQuery`, `staleTime: Infinity`), `src/hooks/useToolCall.ts` (`useMutation`: client-side `@bearings/shared` schema validation before dispatch, `isError`/`structuredContent` → typed `ToolError`, `durationMs`). `@/*` → `./src/*` alias added to `tsconfig.json` + `vite.config.ts`. Vitest + `@testing-library/react` + happy-dom infra added; root `test` script filter fixed to include `@bearings/web` (was a live bug — web tests never ran in CI). **Boundary decided (see `DECISIONS.md`):** React Query for the inspector, custom core for upstreams; `@tanstack/*` is a `packages/web` dep only and is now a Forbidden Practice to import from `packages/server`. **Live end-to-end verification was blocked on Linear DMS-503 not existing — DMS-503 is now delivered** (see the Streamable HTTP transport entry below), so the transport `getMcpClient()` connects to is real. The hooks are still pinned primarily by mocked-client unit tests; an actual live browser click-through against a running server is a separate manual step (root `AGENTS.md` Manual Review Pending) and has not run yet.
- **React inspector delivered (`DMS-504`, 2026-09-09)**: closes the loop `packages/web` had been waiting on since DMS-503 — `SchemaForm`'s submit button was still literally disabled with the title "HTTP transport is not wired yet". **Blocker found first: `packages/server/package.json` was invalid JSON** (missing comma after `"start:http"`, introduced in `eaf8677`), so `pnpm install` failed at the workspace root and there was no `node_modules` at all. `packages/shared` gains `src/tokens/tokenMeta.ts` (`TOKEN_META_KEY`, `TokenMetaSchema`, `TokenMeta`) exported from the **main barrel** — safe there because it imports only zod; `estimateTokens` stays behind the `@bearings/shared/tokens` subpath, and `tokenMeta.ts` must never import it or the tokenizer's rank data reaches the web bundle. `server.ts` now builds its `_meta` from that shared contract (byte-identical output; all 215 pre-existing server tests unchanged). **Verified early, because the whole metrics layer rests on it: the MCP SDK's `client.callTool()` does preserve `_meta` over the real Streamable HTTP transport, on both the success and `isError` paths.** New in `packages/web`: `lib/callMetrics.ts` (tokens off `_meta`, credits `safeParse`d with `NeighbourhoodCreditsSchema` — `undefined`, never `0`, for a tool that cannot spend them), `lib/callHistory.tsx` (context + reducer, 50-entry cap, pin up to 2), `components/` gains `ResponsePanel`, `RenderedResult`, `RawJsonPane`, `DensityBar`, `CostMeter`, `CallHistory`, `ComparePanel`, `FaultToggle`; `ToolSelector` now reads names **and descriptions** from the live `tools/list` (descriptions exist only server-side) while the form schema still comes from `packages/shared`, which retires `useToolList` as dead code knip was about to flag. `react-json-view-lite` is the one new dependency. **Two real bugs found while building:** (1) `buildDefaultValues` seeded optional string/enum fields with `""` / the first enum member — `resolve_destination` was therefore **unsubmittable** without filling `countryCode`, because `""` fails `CountryCodeSchema`; optional fields with no schema default now start `undefined`. (2) the running Geoapify total, if derived by summing the visible history entries, would start *decreasing* once entries aged out past the 50 cap — it is accumulated in the reducer instead. `useToolCall` records on `onSettled` (failures included — they burned latency and possibly credits) and now formats client-side validation failures through `zodErrorToToolError`, the same function the server uses, so the form's message and the mutation's cannot diverge. Fault injection (`DECISIONS.md`) lands in `packages/server/src/http/faults.ts` + a check in `client.ts` **before the cache read** (a warm cache entry would otherwise silently mask an armed fault) mapped through the real `mapHttpError`; `/__dev/faults` is registered only when `BEARINGS_FAULT_INJECTION` is set, so an unset flag yields 404 not 403. **Faults are per upstream host, not per domain** — faulting Geoapify takes all six neighbourhood domains down together; the mixed ok/unavailable demo is `get_destination_brief`. Suite: shared 177, web 59, server 240. **Live verification (partially by hand):** page load, connection, `tools/list`, nested `get_destination_brief` form generation, validation messages and one successful `echo` call with its cost meter and history row were confirmed in a real browser; the automation harness then stopped delivering click events entirely (a plain toggle button stopped responding too), so pinning/compare/raw-toggle and the fault panel's UI were confirmed by component tests plus a scripted MCP client that proved the partial-result path over the real transport (`sources.openMeteo: unavailable` carrying its error, `sources.nager: ok`, holidays present, forecast absent). Recorded in root `AGENTS.md` Manual Review Pending.
- **Inspector UX & David Morais dark theme enhancements (2026-09-09)**:
  - Date fields (e.g. `TimeWindow.start` / `end` matching `z.string().date()`, identified by `format: "date"` in `zodToForm.ts`) render as native HTML5 datepicker inputs (`type="date"` with dark calendar color scheme).
  - Schema-aware numeric stepping: float numbers (e.g. `CoordinatesSchema.lat` and `lon`) receive `step="any"`, allowing arbitrary decimal coordinates, while integer schemas (`type: "integer"`, e.g. `radiusM`, `limitPerCategory`) preserve `step=1`.
  - Response panel content area has `max-h-[70vh] overflow-y-auto` inner scroll, keeping the header and cost meter pinned at top while scrolling long responses.
  - Complete dark theme on brand with davidmorais.com applied across inspector components: `#030810` background, `#06101e` surface, `#0a1829` elevated cards, `#00ffd5` neon cyan accents, `#ff2d6a` magenta alerts, `#e0eaf5` text, and customized dark JSON view and subtle scrollbars.
  - Suite: 507 tests (shared 177, web 78, server 252). Typecheck and Biome lint clean repo-wide.
  - **HTTP Client Concurrency Defects Resolved (2026-09-10, `_potions/fix-concurrency-defects.md`)**:
    - `computeBackoffDelay` clamps `Retry-After` to `maxDelayMs` (`Math.min(retryAfterMs, maxDelayMs)`), preventing anomalous or adversarial rate-limit headers from holding the retry loop indefinitely.
    - `Clock.sleep` accepts optional `signal?: AbortSignal`. `defaultClock.sleep` races `setTimeout` against `signal`'s `abort` event, clearing the pending timer and rejecting immediately; `FakeClock.sleep` unregisters pending sleeps on abort. Both retry backoff sites in `executeRequest` forward `signal` to `clock.sleep`, catching cancellations to immediately return `mapCallerAbort`.
    - Single-flight deduplication refactored with reference counting: `inFlight` stores `InFlightFlight` holding an internal flight `AbortController`, the underlying promise, subscriber count, and attempt tracking. Callers race the shared flight against their individual `opts.signal`. Caller cancellation is fully isolated: one caller aborting mid-flight leaves sibling callers untouched. The underlying fetch aborts only when all active subscribers have cancelled (`subscribers === 0`). Pre-aborted callers exit immediately with `mapCallerAbort(hostId, 0)` without affecting active flights.
  - **Local environment bug found and fixed (2026-09-09)**: the RTK `PreToolUse` hook was rewriting every Biome invocation onto `rtk lint`, which is hardcoded as an *ESLint* wrapper. `npx biome check .` became `rtk lint check .`, printing `Lint: No issues found` while exiting 1 and hiding 17 real errors, and `biome check --write` reported success while applying nothing. Fixed by adding `biome` (and its `npx`/`pnpm exec` forms, plus the ambiguous `pnpm lint` / `npm run lint` script forms) to `exclude_commands` in `~/.config/rtk/config.toml`. Verify a rewrite with `rtk hook check "<cmd>"`; `rtk proxy "<cmd>"` still bypasses filtering ad hoc. `pnpm lint` now reports truthfully (exit 0 clean, exit 1 with the diff on a violation) and direct `eslint` calls are still optimised.
- **`knip` configured repo-wide (2026-09-06)**: Monorepo cleanliness tool installed at root (`knip.jsonc`). Verifies unused files, dependencies, and non-entry exports across `packages/shared`, `packages/server`, and `packages/web`. Wired to root `pnpm knip` script and validated in GitHub Actions CI right after Biome linting.
- **Streamable HTTP transport delivered (`DMS-503`, 2026-09-09, `_spells/005`)**: `packages/server` now serves the registry over two transports from one `createServer()` — stdio for desktop MCP hosts, Streamable HTTP for the inspector. `src/env.ts` gains `httpPort()` (`BEARINGS_HTTP_PORT`, default **3000** — matches `packages/web/src/lib/mcpClient.ts`'s `DEFAULT_MCP_URL`, throws rather than silently falling back on a non-integer or out-of-range value), `httpHost()` (`BEARINGS_HTTP_HOST`, default **127.0.0.1** — the actual local-only guarantee; CORS is the second layer, not the first), `allowedOrigins()` (`BEARINGS_ALLOWED_ORIGINS`, comma-separated, default `http://localhost:5173,http://127.0.0.1:5173` — Vite's dev server on both loopback spellings, which the browser treats as distinct origins). New `src/transports/http.ts`: `express` + `cors` are now direct dependencies (both were already resolved in the lockfile as an SDK transitive — this makes an existing phantom dependency honest). A `Map<sessionId, { transport, server }>` holds one `StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })` **and** one fresh `createServer()` per session (never a shared `Server` — see `DECISIONS.md`), registered in `onsessioninitialized`, deregistered in `transport.onclose`. `express.json()` is scoped to `POST /mcp` only, never in front of the `GET` SSE route. **CORS must set `exposedHeaders: ["mcp-session-id"]`** — without it the browser can read the initialize response body but not that header, so the client looks sessionless and every following POST 400s; commented in code as the hidden constraint it is. A trailing 4-arg Express error-handling middleware catches anything thrown above session/validation handling (e.g. `server.connect()` itself failing) and returns a fixed `jsonRpcError(res, 500, "Internal server error")` instead of Express's default HTML page with a leaked stack trace (caught in review, reproduced by mocking `createServer()` to throw). `src/transports/stdio.ts` refactored: `main()`'s body extracted into exported `startStdioTransport(): Promise<StdioTransportHandle>`; `main()` now runs only behind a direct-execution guard. **The guard compares `realpathSync(process.argv[1])` to `fileURLToPath(import.meta.url)`, not a bare `===`** — a `bin` entry (`package.json`'s `bearings-mcp` → `dist/cli.js`) is a symlink, so `process.argv[1]` is the symlink path while `import.meta.url` resolves to the real file; a bare comparison silently never runs `main()` under the installed/symlinked invocation this same diff adds (caught in review, reproduced against the exact symlink shape pnpm/npm create). New `src/cli.ts` (now `bin`/`start`, `dist/cli.js`): `parseTransportMode(argv)` reads `--transport`, defaults to **`stdio`** so every existing Claude Desktop / Cursor config keeps working with zero changes (see `DECISIONS.md`), throws naming all three valid values on anything else; installs one shared `SIGINT`/`SIGTERM` handler that closes every handle actually started, in `both` mode included — the HTTP side only ever writes to `console.error`, so stdout stays the JSON-RPC channel even with both transports live. Acceptance criterion 1 (both transports behave identically) is proven, not just asserted: `src/transports/http.test.ts` includes a parity `describe` block asserting deep-equal `CallToolResult`s for the same `echo` call and the same validation failure through `InMemoryTransport` vs. the real HTTP transport. Manual regression: piped the `packages/server/AGENTS.md` smoke-test frames into both `dist/transports/stdio.js` and `dist/cli.js` (default, no flag) — byte-identical stdout and stderr. A live browser + Claude Desktop verification pass is a separate manual step (root `AGENTS.md` Manual Review Pending / DMS-502), not yet run as of this entry.
- **Test suite + manual checklist (`DMS-502`, in progress, 2026-09-09)**: Part 1 (automated suite) was already substantially done — 476 tests (`shared` 177, `web` 59, `server` 241), all four upstream fixtures wired in, radius/limit boundaries, density thresholds, ambiguous/empty geocoding and partial-failure composition all covered. This slice closed the self-serviceable gaps: (1) an explicitly-named partial-failure test — `"a weather timeout still returns holidays"` in `packages/server/src/http/faultPartialResult.test.ts`, pinned to `ToolErrorCode.TIMEOUT` via `setFaults({ "open-meteo": "timeout" })`; (2) fixture provenance — every fixture in `packages/server/test/fixtures/` now carries a `_note`: `nominatim.json` + `nager.json` are live captures (URL/params/date), `open-meteo.json` + `geoapify-places.json` are documented as schema-faithful hand-shapes (Open-Meteo's 16-day window makes a verbatim capture date-fragile; Geoapify needs a keyed credit-spending request); (3) the Zod-rejection audit — the few schema tests that only asserted `success === false` (`echo`, `getDestinationBrief` missing-location, `timeWindow` bad date formats) now run the error through `zodErrorToToolError` and assert a recoverable message string. **Part 2 (manual checklist) written: `docs/manual-checks.md`** — 6 sections / 16 steps with per-step expected output sourced from the committed fixtures, plus a "keep current" note. README gained a Testing → manual-checks link. **The "runs offline with no network access" acceptance criterion is deliberately not claimed** (David's call): the suite mocks every upstream at the HTTP core boundary and is deterministic, but nothing enforces network absence, so the offline wording was removed from the README and `AGENTS.md` rather than asserted. Executing the checklist (real network, Geoapify quota, Claude Desktop handshake, inspector click-through, clean-clone timing) stays a human step. See `DECISIONS.md` 2026-09-09.
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

## 🏙️ Neighbourhood density thresholds (DMS-499)

*The answer to "why is this many venues `high`". `analyse_neighbourhood` groups the 7-value
`PoiCategorySchema` into six domains, queries Geoapify once per domain at `input.radiusM`,
partitions the returned POIs into walking rings client-side, and rates each domain by
**venue density in venues/km² at the 500 m ring** — the `CALIBRATION_RADIUS_M` walk.*

**Category leaves, never parents (corrected 2026-09-10, DMS review).** `nightlife` queried
the bare `entertainment` parent. Geoapify returns a feature's full category ancestry, so
that string matched every museum, theatre, cinema and zoo in the radius — all counted as
nightlife against thresholds calibrated on bars, and museums/theatres came back a second
time on the culture query, billing one venue to two domains. `nightlife` is now
`catering.bar, catering.pub, adult.nightclub`; `entertainment.cinema` moved to `culture`,
where the threshold note already said cinemas belonged. Two module-load guards in
`analysis/categoryAdapter.ts` make it unrepeatable: every queried string must classify back
to its own domain, and no domain's string may be a dotted ancestor of another's. The
nightlife reference reading below ("20 bars") is now what the code actually counts.

**Rating radius (corrected 2026-09-10, DMS review).** Density normalises for area but POI
density genuinely falls off with radius, and the fixed `limitPerCategory` cap makes it
collapse: 20 venues is 25.5/km² at 500 m and 1.6/km² at 2000 m for the *same*
neighbourhood, so classifying a wide-radius sample against 500 m thresholds returned
`low` for a dense centre. `classifyDomain` now reads the rating off the ring at
`CALIBRATION_RADIUS_M` (`analysis/thresholds.ts`) regardless of `radiusM` — or, when
`radiusM < 500`, the request's outer ring, which is tighter and so higher-density (the
safe direction). The ring used is reported as `DomainRating.ratingRadiusM`; `radiusM` and
`count` stay in the payload as the requested width and the total within it. Earlier text
here claimed a rating was "comparable across radii" — it was not, and that was the bug.

*Distanceless POIs (follow-up fix).* A feature with no `distanceM` is within `radiusM`
(the circle filter guarantees it) but can't be placed in an inner ring, so
`partitionByRing` counts it only at the outer ring. When the rating ring is an inner one
its count omitted those — a domain of 20 distanceless venues rated `none`. `classifyDomain`
now takes `missingDistance` and, if placing every missing POI at the rating ring would
change the bucket, falls back to rating at the outer ring (count complete there) and sets
`countCapped` — the outer-ring rating is a hard lower bound. A single missing distance that
can't swing the bucket leaves the 500 m rating alone.

**Walking-ring ladder** — `WALKING_RADII_M = [250, 500, 1000]` m (`analysis/rings.ts`),
≈ 3 / 6 / 12 min walk. `ringsWithin(radiusM)` keeps the ladder entries `≤ radiusM` and
always appends `radiusM` itself as the outer ring. Counts are **cumulative** (a POI at
300 m is in the 500 m and 1000 m rings). One Geoapify call per domain at the widest
radius; inner rings cost no extra credits (Geoapify returns `distance` per feature).

**`countCapped`** — `limitPerCategory` defaults to **20** (1 Geoapify credit per domain;
the `.max(100)`→`.max(20)` tightening was the signed-off schema change of 2026-09-08).
The ceiling itself is now detail-gated at **40** for `detail: "full"` (`DMS-501`, see
below) — `brief` stays capped at 20. `DomainRating.countCapped` is now scoped to the
**rating ring**: `true` only when the whole response was capped *and* every returned POI
fell inside the rating ring, so that ring's count — hence its density and rating — is a
floor. When the capped response also has POIs beyond the rating ring, the sub-ring slice
was not truncated by the limit, so the flag clears. (Leans on Geoapify `bias=proximity`
returning near POIs first — a ranking preference, not a strict sort, so on equal counts
the flag stays `true`.) The classifier still only ever *raises* a floored rating — a later
uncapped call moves density up, never down, and the buckets are monotonic.

**Thresholds** — the single named-constant block is `DENSITY_THRESHOLDS` in
`analysis/thresholds.ts` (root Invariant 7), alongside `CALIBRATION_RADIUS_M`; no density
or rating-radius number lives anywhere else. Per-domain because a walkable dining scene
and a walkable museum scene are different densities. `none` is a **zero rating-ring
count**; otherwise `density >= high` → `high`, `>= medium` → `medium`, else `low`, all read
at the rating ring. `high` for every domain sits at or below **25.5 venues/km²** — the
density a domain capped at 20 places still reports within a 500 m ring — so a genuinely
dense but count-capped domain is never under-rated.

| Domain | Dense reference (venues/km² @ 500 m) | Quiet reference | `medium` | `high` | Why |
|---|---|---|---|---|---|
| `nightlife` | Bairro Alto, Lisbon `38.7115,-9.1449` — sample saturates (≥25.5) | Cascais residential `38.7003,-9.4210` ≈ 1 | 8 | 20 | 20 bars inside a 6-min walk is unambiguously a nightlife district; residential grids sit near zero. |
| `dining` | Baixa-Chiado `38.7108,-9.1394` — sample saturates (≥25.5) | quiet suburb ≈ 5 | 10 | 22 | Restaurants + cafés are the densest domain; `high` set just under the capped-sample ceiling. |
| `transit` | central Lisbon metro/rail/bus ≈ 16 | suburban coverage ≈ 2 | 6 | 15 | A handful of stops within a 3-min walk already means "well connected". |
| `greenSpace` | beside a major park ≈ 6 | elsewhere ≈ 1 | 2 | 5 | Municipal gardens are sparse even where present; one park inside the ring is meaningful. |
| `retail` | retail core ≈ 16 | suburb ≈ 3 | 6 | 13 | Supermarkets and markets are a low-count domain; a cluster signals a shopping district. |
| `culture` | museum / gallery quarter ≈ 14 | suburb ≈ 1 | 3 | 8 | Museums, galleries and cinemas concentrate heavily; a few in the ring marks a cultural quarter. |

**Calibration status** — the reference readings above are **hand-derived estimates**, not
live Geoapify measurements: the HTTP transport that would let `analyse_neighbourhood` run
end-to-end does not exist yet (deferred with DMS-503 and the root `AGENTS.md` manual-review
list). The committed fixture `packages/server/test/fixtures/geoapify-places.json` is
likewise hand-built (synthetic `place_id`s). Re-calibrate against two named coordinates
per domain — one dense, one quiet, at `radiusM: 500` — once a live run is possible; the
classifier's "capped ratings only rise" guarantee holds regardless of the exact numbers.
Because the rating is now always read at 500 m, `radiusM` no longer needs its own
per-radius calibration — a wider request only changes the sample and the ring breakdown.

---

## 📊 Response shaping token & credit budget (DMS-501)

*Real numbers from `pnpm --filter @bearings/server run measure:tokens`, driving all
three real tools through `createServer()` over `InMemoryTransport` with the committed
fixtures. The token count is the same `_meta["bearings/tokens"]` block an agent
actually receives — the script reads it off the wire rather than computing a second,
private estimate. `analyse_neighbourhood`'s `full` figures reflect the DMS-501 sample
count of **ten** per domain (raised from five — see "Neighbourhood density thresholds"
above), so the delta below is a delta of *that* larger `full`, not the pre-DMS-501 one.*

| Tool | Detail | Bytes | Approx. tokens | Worst-case tokens | Δ vs full | Geoapify credits |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `resolve_destination` | brief | 171 | 51 | 102 | −54% | — |
| `resolve_destination` | full | 329 | 111 | 222 | — | — |
| `get_destination_brief` | brief | 689 | 233 | 466 | −19% | — |
| `get_destination_brief` | full | 841 | 286 | 572 | — | — |
| `analyse_neighbourhood` | brief | 1403 | 468 | 936 | −68% | 6 |
| `analyse_neighbourhood` | full | 4200 | 1451 | 2902 | — | 6 |

- `analyse_neighbourhood`'s two rows use the default `limitPerCategory` (20) and all
  seven categories on both sides, so credits are identical (6 = one per domain × six
  domains) — the raised 40-place/2-credit ceiling from Phase 3 is a separate,
  unit-tested cost lever, not part of this brief-vs-full comparison. (The script's two
  `analyse_neighbourhood` calls use coordinates ~1 km apart so the second call isn't a
  free Geoapify cache hit off the first — the fixture response is identical either way.)
- `worstCaseTokens` is `contentTokens * 2`: every response is serialised twice on the
  wire (`content[0].text` and `structuredContent`, identical JSON when the handler
  returns a plain object) per the MCP spec's own compatibility recommendation — the
  real spend if a host forwards both to the model. Not changed by this ticket; see
  `DECISIONS.md` and the Risks section of `_spells/005`.
- The Geoapify fixture (`test/fixtures/geoapify-places.json`) is hand-shaped, not
  captured live (same caveat as "Neighbourhood density thresholds" above) — the
  `analyse_neighbourhood` bytes/tokens are a real serialisation cost of a real (if
  synthetic) payload shape, not a live measurement of Geoapify's actual response size.
- `tokenizer: "o200k_base"` — a GPT BPE, not Claude's (no public Anthropic tokenizer
  exists); an order-of-magnitude comparison between two shapes of the same JSON, not an
  exact cost. See `packages/shared/src/tokens/estimateTokens.ts`.
- Both composed tools clear the ~10% sanity threshold David asked to flag on
  (`get_destination_brief` 19%, `analyse_neighbourhood` 68%) — nothing here needed
  raising as a finding.
- **Handed to DMS-505** (README, decisions doc, AI usage note) to lift this table
  verbatim alongside the two-axis cost paragraph (context tokens move freely with
  `detail`; Geoapify credits move only upward, by explicit opt-in) — see `_spells/005`'s
  "Handover to DMS-505".

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
- **`get_destination_brief` composed & delivered (`DMS-497`, 2026-09-08)**: `tools/getDestinationBrief.ts` `composeDestinationBrief(input, { core?, signal?, now? })` fans out to `fetchForecast` + `fetchHolidaysInWindow` via **`Promise.allSettled`** (both promises built before either is awaited → wall time ≈ slower upstream), then degrades gracefully. New shared output schema `DestinationBriefSchema` in `packages/shared/src/types/destinationBrief.ts` — a **discriminated union on `detail`**; the handler `safeParse`s its own composed result before returning (like the upstream clients self-check).
  - `sources` block: `{ openMeteo, nager }`, each `{ status: "ok" | "partial" | "unavailable", note?: string, error?: ToolError }`. `error` validated with the structural `isToolError` guard (`z.custom`), not a Zod mirror of the `ToolError` union. Empty holidays list ⇒ `status: "ok"` (never `unavailable`) — the whole point of the issue. Truncated-but-usable forecast ⇒ `status: "ok"` with `note` = the truncation reason.
  - One upstream failing still returns the other's data. **Both** failing ⇒ the more-severe `ToolError` (named `ERROR_SEVERITY` block: NOT_FOUND 1 … INTERNAL_ERROR 7), returned as `{ ...worst, isError: true, details: { ...worst.details, alsoFailed: other } }` so the worst error's own structured fields survive; equal severity ⇒ Open-Meteo's error wins. A `rejected` settled outcome (client threw) ⇒ `upstreamError("<client> threw", "<host>")`.
  - `detail: "brief"` (the default) is a **lossy `.strict()` projection** of the assembled `full` object — `toBriefDetail` drops `forecast.coordinates`, `forecast.requestedRange`, each `forecast.days[].weatherCode`, each `holidays[].countryCode`. `location` + `stay` stay at both levels. One set of upstream calls regardless of `detail`. `BriefForecastSchema` / `BriefHolidaySchema` are `.strict()` so a projection that forgets a field fails validation instead of silently passing it through.
  - The tool takes an already-resolved `Location` — it does **not** call `resolve_destination`. Forecast keys off `location.coordinates`, holidays off `location.countryCode`.
  - Its unit test is `packages/server/src/tools/getDestinationBrief.test.ts` (colocated with the handler per the now-repo-wide `<target>.test.ts` rule — see `packages/server/AGENTS.md`), mocked at the HTTP-core boundary, fixtures reused from `test/fixtures/`.
- **`analyse_neighbourhood` composed & delivered (`DMS-499`, 2026-09-08)**: replaces the stub. `analysis/analyseNeighbourhood.ts` `analyseNeighbourhood(input, { core?, signal? })` → `NeighbourhoodProfile | ToolError`. New `packages/server/src/analysis/` layer: `categoryAdapter.ts` (7→6 domain grouping + the Geoapify category-string map, both directions — moved here from `upstream/geoapify.ts`, which imports it back), `rings.ts` (walking-ring ladder + cumulative partition), `density.ts` (venues/km²), `thresholds.ts` (the `DENSITY_THRESHOLDS` named block — see "Neighbourhood density thresholds" above), `classifyDensity.ts` (`DomainRating` assembly), `errorSeverity.ts` (`ERROR_SEVERITY` + `moreSevereError` + `worstOfErrors`, extracted from `getDestinationBrief.ts` which now imports it).
  - Fans out **one** Geoapify query per requested domain via `Promise.allSettled` (never `Promise.all`), at `input.radiusM` with `limit: input.limitPerCategory` — one set of upstream calls regardless of `detail`. Each domain: `partitionByRing` → `classifyDomain` (`countCapped = returnedCount >= limitPerCategory`) → `DomainProfile` with `samplePois` = 10 nearest by `distanceM` (raised from 5, `DMS-501` — see below).
  - `sources` block keyed by the six domains, `SourceOutcome` shape (`{ status: "ok" | "partial" | "unavailable", note?, error? }`) — the type is now shared, moved out of `destinationBrief.ts` into `packages/shared/src/types/sourceOutcome.ts` (two consumers). A domain whose call fails → `domains[d] = null`, `sources[d].status = "unavailable"` carrying the `ToolError`; a `missingDistance > 0` partition → `status: "partial"`. **Every** domain failing → the `worstOfErrors`-reduced `ToolError` (a Geoapify quota surfaces as `QUOTA_EXCEEDED`, not a generic wrap). A rural coordinate where every domain returns `[]` → a valid all-`none` profile, every source `ok` — **not** an error.
  - New shared output schema `packages/shared/src/types/neighbourhoodProfile.ts` — `DomainRatingSchema` (every field required — a rating without its `count`/`radiusM`/`rings` fails validation), `DomainProfileSchema` (`= DomainRating` + `samplePois`), `NeighbourhoodProfileSchema` = **discriminated union on `detail`**. `brief` is a lossy `.strict()` projection — drops `samplePois` and `location.coordinates`, keeps the full per-ring `rings` array / `count` / `radiusM` / `densityPerKm2` (that evidence is the point of the ticket). Handler `safeParse`s its own composed output before returning (the `get_destination_brief` pattern). `NeighbourhoodDomainSchema` and the profile schemas are **not** in `toolInputSchemas` (output-only).
  - `z.record` over the `NeighbourhoodDomain` enum infers a **partial** record — reads of `domains[d]` / `sources[d]` are `T | undefined` in TS even though the composition always populates every requested domain.
  - Tests: `analysis/*.test.ts` colocated per target; `analysis/analyseNeighbourhood.test.ts` + `tools/analyseNeighbourhood.test.ts` mocked at the HTTP-core boundary. The composition test's fake clock **advances on `sleep`** — a frozen `now()` starves the shared Geoapify rate limiter (capacity 5) once ≥ 6 acquires (2 domains × 3 retry attempts) drain it, since it only refills on elapsed time.
  - `packages/web` unchanged and unverifiable end-to-end: the inspector only generates input forms from `toolInputSchemas` (submit is still disabled pending the HTTP transport, DMS-503) and consumes no output schema. The `analyse_neighbourhood` input form still renders — the only input change is `limitPerCategory` `.max(100)`→`.max(20)`.
- **`analyse_neighbourhood` credit accounting delivered (`DMS-500`, 2026-09-08)**: the last open DMS-500 acceptance criterion — the response now reports what it cost. `upstream/geoapify.ts` gains `GEOAPIFY_PLACES_PER_CREDIT = 20`, `creditsForResponse(cacheHit, returnedCount)` (`ceil(returnedCount / 20)`, 0 on cache hit), and `credits: number` on `SearchPlacesResult`. `NeighbourhoodProfileSchema` (both arms, `packages/shared`) gains a required top-level `credits: { consumed, byDomain }` (`NeighbourhoodCreditsSchema`) — **not** a nested `cost` envelope; DMS-501 folds tokens + credits into an envelope later if it wants one. `byDomain` is `z.record` over the domain enum ⇒ partial: a failed domain is **absent** (adds 0), a cache-served domain is an explicit **0**; `consumed` = sum of `byDomain`. The composition sums by explicit assignment in the existing domain loop; `toBriefDetail` carries the block through untouched (brief drops bulk, not evidence). An all-domains-fail `ToolError` carries no credit block (nothing was billed). With `limitPerCategory` capped at 20 every successful domain query costs 1 credit; raising the cap makes `limit` a direct cost lever again. Live calibration against the real Geoapify dashboard is still pending (root AGENTS.md manual-review list, blocked on the HTTP transport DMS-503). README cost section: DMS-505.
- **Response shaping & token accounting delivered (`DMS-501`, 2026-09-09)**: closes the measurement half of `detail: brief | full` — the shaping itself shipped with DMS-494/497/500. `packages/shared/src/tokens/estimateTokens.ts` (`estimateTokens`, `TOKENIZER_ENCODING = "o200k_base"`) wraps `gpt-tokenizer/encoding/o200k_base`'s `countTokens`, exposed via the `@bearings/shared/tokens` subpath export (not the main barrel — the tokenizer's rank data must never reach `packages/web`'s bundle). `server.ts` attaches `_meta["bearings/tokens"] = { approximate: true, tokenizer, contentTokens, structuredContentDuplicated, worstCaseTokens }` on every response, success or error — `worstCaseTokens` is `contentTokens * 2` when `structuredContent` is also present (identical JSON to `content[0].text`), the honest cost if a host forwards both. `detail` now gates the Geoapify credit ceiling: `limitPerCategory` `.max(20)` → `.max(40)` (default unchanged at 20), with a new `.refine()` rejecting `detail: "brief"` above 20 — `full` may opt into a second credit bucket, `brief` cannot spend more by accident. `DomainProfileSchema.samplePois` `.max(5)` → `.max(10)` (server `SAMPLE_POI_LIMIT` matched) — a response bound, not a cost cap; see the numbers table above for what these widenings measured. Both widenings are explicitly authorised (Invariant 9) and recorded in `DECISIONS.md`. New `dense` fixture key (40 features, `_note`) in `test/fixtures/geoapify-places.json` exercises the 2-credit/10-sample paths. `scripts/measureTokenBudget.ts` (`measure:tokens`) produced the table above; `server.integration.test.ts` gained a strict-inequality regression guard (brief tokens < full tokens per real tool, no percentage floor). README criterion handed to DMS-505 with the table already written.
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
