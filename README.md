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

Concretely: `packages/shared/src/schemas/getDestinationBrief.ts` exports one `z.object`. `packages/server` calls `safeParse` on it before a handler runs, and advertises it as JSON Schema in `tools/list`. `packages/web` runs `zodToJsonSchema` over the same import to lay out the form — the nested `location.coordinates` fieldset, the date inputs, the `detail` dropdown and its default all come from that object, not from a file describing the form. Adding a tool to the registry surfaces its form with no change in `packages/web`; a rejected input shows the developer the exact `ToolError` message an agent would have received, produced by the same `zodErrorToToolError` the server uses.

The inspector reads its token counts off the response envelope (`_meta["bearings/tokens"]`) rather than tokenising in the browser, so the number it shows is the number the server computed. It is labelled approximate and names its tokenizer, because `o200k_base` is a GPT encoding and not Claude's — good for comparing two shapes of the same payload, not for predicting a bill.

### What `detail: brief` actually saves

Measured with `pnpm --filter @bearings/server measure:tokens`; the inspector shows the same figures per call, and pinning two calls in its history puts them side by side with the delta.

| Tool | `brief` | `full` |
|---|---|---|
| `resolve_destination` | 5 candidates, no coordinates or evidence fields | adds coordinates and per-candidate detail |
| `get_destination_brief` | drops `weatherCode`, coordinates, holiday `countryCode` | keeps them |
| `analyse_neighbourhood` | ratings and ring counts only | adds up to 10 sample POIs per domain and location coordinates |

A regression guard in `server.integration.test.ts` asserts `brief` costs strictly fewer tokens than `full` for every real tool, so the distinction cannot quietly stop paying for itself.

### Simulating an upstream failure

The partial-result path — one upstream down, the response still carrying what the others returned — is one of the more interesting things this server does, and waiting for Geoapify to actually fail is a poor way to demonstrate it. Start the server with `BEARINGS_FAULT_INJECTION=1` and the inspector grows a fault panel:

```bash
BEARINGS_FAULT_INJECTION=1 node packages/server/dist/cli.js --transport http
```

Faults are raised inside the HTTP client core, before the cache is consulted, and are mapped through the same `mapHttpError` a real failure takes — so nothing downstream can tell an injected failure from a genuine one. Faulting Open-Meteo and calling `get_destination_brief` returns `sources.openMeteo: "unavailable"` carrying its error, `sources.nager: "ok"`, and the holidays intact.

Granularity is per upstream **host**, not per domain: `analyse_neighbourhood` queries Geoapify for all six domains, so faulting Geoapify takes all six down together. Without the flag the `/__dev/faults` route is never registered — a 404, not a 403.

## Testing

```bash
pnpm test        # all packages
pnpm typecheck    # all packages
pnpm knip         # unused files, exports, dependencies
pnpm lint        # biome check . — lint + format
```

Upstreams are mocked at the HTTP client core boundary, so the suite is deterministic. See root `AGENTS.md` for the full testing philosophy and Definition of Done.

Some checks can only be run by hand — real network behaviour, the Nominatim rate limiter, the MCP handshake, the inspector UI, a clean-clone startup. Those live in [`docs/manual-checks.md`](docs/manual-checks.md) as a runnable checklist with the expected output for each step.
