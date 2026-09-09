# Bearings MCP

An MCP server exposing destination and neighbourhood intelligence tools, backed by public HTTP APIs, plus the React dev inspector that lives in the same repo and talks to it live.

```
resolve_destination          fuzzy name → structured Location
    ├─→ get_destination_brief    forecast + public holidays for a stay
    └─→ analyse_neighbourhood    POI density profile around a point
```

Upstreams: Nominatim (geocoding), Open-Meteo (forecast), Nager.Date (holidays), Geoapify Places (POI).

## Packages

| Package | Purpose |
|---|---|
| `packages/server` | MCP registry, transports, tool handlers, upstream clients, analysis logic |
| `packages/shared` | Zod schemas, domain types, error taxonomy — imported by both server and web |
| `packages/web` | Development inspector: schema-driven forms, response viewer, cost tracking |

See each package's `AGENTS.md` for structure and conventions specific to it; root `AGENTS.md` covers cross-cutting architecture invariants.

## Two transports, one registry

`packages/server/src/registry.ts` is the single place tools are defined. Both transports call the same `createServer()` and connect a transport to it — that is the whole of their job. Adding a tool requires zero changes to either transport file.

```
registry.ts (one definition)
  ├─→ transports/stdio.ts  → Claude Desktop, Cursor
  └─→ transports/http.ts   → the inspector
        both via createServer() in server.ts
```

`stdio` speaks JSON-RPC over stdout for desktop MCP hosts. Streamable HTTP is stateful — one session per connected client, keyed by `mcp-session-id` — and is what `packages/web`'s inspector connects to over the network (loopback only, by design; see `packages/server/AGENTS.md`).

## Running it

```bash
pnpm install
pnpm build
```

Copy `.env.example` to `.env` and set `GEOAPIFY_API_KEY` at minimum — the server validates it at boot, not on first call. `BEARINGS_HTTP_PORT`, `BEARINGS_HTTP_HOST`, and `BEARINGS_ALLOWED_ORIGINS` are optional and default to `3000`, `127.0.0.1`, and Vite's dev server (`http://localhost:5173,http://127.0.0.1:5173`) respectively.

```bash
node packages/server/dist/cli.js                        # stdio only — the default, for Claude Desktop / Cursor
node packages/server/dist/cli.js --transport http        # HTTP only — for the inspector
node packages/server/dist/cli.js --transport both         # both at once
```

`--transport` defaults to `stdio` with no flag at all, so every existing Claude Desktop / Cursor config that points at `dist/transports/stdio.js` or the `bearings-mcp` bin keeps working unmodified. `dist/transports/stdio.js` also stays valid as a direct, undocumented-but-unbroken second entry point.

To run the inspector against a live server:

```bash
node packages/server/dist/cli.js --transport http
pnpm --filter @bearings/web dev
```

For wiring Claude Desktop specifically, and a stdin-piped smoke test that doesn't need a client, see `packages/server/AGENTS.md`.

## Why a React app lives in an MCP server repo

The Zod schema is the single source of truth for a tool's input — the server validates against it and the inspector generates its input forms from that exact same object, so the two can never quietly drift apart; the inspector is there to prove that property live, not to ship as a product.

## Testing

```bash
pnpm test        # all packages
pnpm typecheck    # all packages
pnpm knip         # unused files, exports, dependencies
./node_modules/.bin/biome check .   # lint + format; root `pnpm lint` can be intercepted by a local wrapper, run biome directly to be certain
```

Upstreams are mocked at the HTTP client core boundary; the suite runs offline and deterministically. See root `AGENTS.md` for the full testing philosophy and Definition of Done.
