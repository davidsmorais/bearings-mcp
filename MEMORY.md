# MEMORY.md — Persistent Memory Index

*Read at the start of every session before taking action. Contains architecture decisions, active constraints, and context not derivable from code.*

---

## 🏛️ Current State of the Project

- **Monorepo Structure**: Managed via `pnpm` workspaces (`packages/shared`, `packages/server`, `packages/web`).
- **Tooling**: Biome 2.0 (linter & formatter), TypeScript 5.8.2 (ESM modules throughout), Vitest 3.0.9 for testing.
- **Active Phase**: Foundation & core infrastructure setup. Agents, specialized skills, battle plans (`_spells/`), and foundational documentation established.
- **Harness scaffolding closed 2026-09-05**: `.claude/agents/*.md` (compiled subagent frontmatter for all 8), `.claude/skills/new-*` (copied from `.agents/skills/`), `CLAUDE.md`, and `hocus.md` were the remaining gaps from the initial build; all now present. See `hocus.md` for the full build queue and `AGENTS.md`'s Learned Facts for what was missing and why.
- **`.claude/{agents,skills}` are symlinks into `.agents/` (2026-09-06)**: every `.claude/agents/*.md` and `.claude/skills/*` (except the four hand-written skills `debug-issue`, `explore-codebase`, `refactor-safely`, `review-changes`) is a relative symlink to the corresponding file/dir under `.agents/`. `.agents/` is the source of truth; edit there.
- **Walking-skeleton MCP server delivered (`_spells/002`, 2026-09-06)**: `packages/server` now boots end to end over stdio. `src/registry.ts` (`tools` array + `assertUniqueToolNames`) is the single tool source; `src/server.ts` `createServer()` is the shared factory both transports use; `src/transports/stdio.ts` is the entrypoint (`dist/transports/stdio.js`, also the `bin`). One tool: `echo` (diagnostic, permanent). HTTP transport and the three real tools remain `_spells/001` work.
  - `@modelcontextprotocol/sdk@^1.30.0`; it needs `zod@^3.25`, so `packages/shared` and `packages/server` moved from `zod@^3.24.2` → `zod@^3.25.76`.
  - `defineTool` `handler` uses **method syntax** (not an arrow property) so concrete tools stay assignable to `ToolDefinition<z.ZodObject<z.ZodRawShape>>` in the registry array.
  - Tool handlers return a **plain value**; the MCP `{ content, structuredContent }` envelope is applied once in `createServer()`. That adapter is where a returned `ToolError` will map to `isError: true` when `_spells/001` Phase 1 lands.
  - **`echo` is exempt from the "every tool accepts `detail: brief|full`" rule** (server `AGENTS.md`) — it is a diagnostic with nothing to shape. Not a precedent for the real tools.
  - stdio stdout is the JSON-RPC channel — all diagnostics go to stderr; `src/index.ts` has no top-level statements. Tests live in `packages/server/test/`, typechecked via `tsconfig.test.json` (the `typecheck` script runs both configs).
- **`typecheck` script now exists**: `pnpm typecheck` → `pnpm -r run typecheck` → `tsc --noEmit` per package (server also runs `tsconfig.test.json`). `packages/web` has none yet. Root `pnpm lint` may be intercepted by a local tool wrapper that mislabels output — run `./node_modules/.bin/biome check .` directly to be certain.
- **Active Invariant Enforcement**:
  - `packages/shared` is the sole source for Zod input schemas and domain types.
  - `packages/server/src/registry.ts` is the single source for tool registration.
  - All upstream traffic must route through the HTTP client core (`packages/server/src/http/`).

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
