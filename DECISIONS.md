# DECISIONS.md

A chronological log of architecture, tooling, and design decisions made on Bearings MCP.
Append-only, oldest first; entries are never edited or deleted.

---

## 2026-09-04 — Geoapify over Overpass for POI data

**Decision:** Use Geoapify Places instead of Overpass for all neighbourhood POI queries.

**Why:** Overpass QL added a query-language learning cost and unpredictable
server-side timeouts for no credit gained. Geoapify is plain REST with a
documented category hierarchy, and its free tier (3,000 credits/day) covers
the take-home with margin.

**Alternatives considered:** Overpass (original plan), ohsome API (aggregation-only,
no individual place listing), Photon (too thin for category filtering).

---

## 2026-09-04 — Three-package monorepo split and dual transports (stdio & HTTP)

**Decision:** Structure the project as a pnpm monorepo with three packages (`packages/shared`, `packages/server`, `packages/web`) and serve tools over two transports (`stdio` and Streamable HTTP) wired to a single tool registry.

**Why:**
- `packages/shared` serves as the sole source of truth for Zod schemas, domain types, and error structures. This guarantees zero schema duplication between server-side validation and the React inspector's dynamic form generation (Architecture Invariant 2).
- `packages/server` remains decoupled from UI concerns, housing only MCP server logic, tool handlers, upstream HTTP clients, and spatial analysis.
- `packages/web` is isolated as an internal React 19 dev inspector, preventing frontend dependencies from bleeding into the server runtime.
- Dual transports from a single registry (`src/server.ts` / `src/registry.ts`) satisfy two distinct consumers without duplicate wiring: `stdio` connects directly to desktop MCP hosts (Claude Desktop, Cursor), while Streamable HTTP enables browser-based dev inspector queries over standard HTTP streaming without needing child-process spawns or custom proxy layers.

**Alternatives considered:**
- Single monolithic package (pollutes server build with React/Vite dependencies and blurs architectural boundaries).
- Stdio-only transport (would require complex local process bridging or CLI harnesses to inspect and test interactively in a web UI).
- HTTP-only transport (breaks compatibility with standard MCP clients that rely on stdin/stdout JSON-RPC framing).

---

## 2026-09-06 — Knip for dead code and dependency audit

**Decision:** Use Knip at the monorepo root to detect unused files, unused dependencies, and non-entry exports across all workspace packages, validated as an early CI step in GitHub Actions.

**Why:** In a multi-package monorepo (`shared`, `server`, `web`), dead code, orphaned exports, and unused dependencies accumulate easily. While Biome and TypeScript catch local unused variables, they cannot detect unreferenced module exports, abandoned files, or superfluous packages across workspace boundaries. Knip automatically resolves our pnpm workspaces and plugins (Biome, Vite, Vitest, TypeScript), running fast-fail in CI right after linting.

**Alternatives considered:** depcheck (lacks modern TypeScript/ESM and export detection), ts-prune (deprecated and single-project focused), manual code reviews (error-prone and does not prevent regressions).
