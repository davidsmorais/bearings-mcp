# AGENTS.md — packages/server

Read the [root AGENTS.md](../../AGENTS.md) first. This file only covers what's specific to the server package: MCP registry, transports, tool handlers, upstream clients, analysis logic. Architecture invariants, upstream quirks, testing philosophy, Definition of Done, and forbidden practices all live at root and apply here without repetition.

---

## Structure

```
packages/server/src/
  registry.ts          tool definitions — the only place tools are registered (root Invariant 1)
  tools/                one file per tool handler
  transports/
    stdio.ts            for Claude Desktop, Cursor
    http.ts              Streamable HTTP, for packages/web
  upstream/             one client per API (nominatim, open-meteo, nager, geoapify)
  analysis/              derived logic — density calculation, category adapter, classification
  http/                 client core: cache, rate limiter, retry, timeout
```

---

## Rules specific to this package

- **Async/await only.** No `.then()` chains.
- **Fan-out uses `Promise.allSettled`, never `Promise.all`.** A partial result beats a total failure. Every composed tool (`get_destination_brief`, `analyse_neighbourhood`) reports which upstreams succeeded via a `sources` block.
- **Upstream shapes never leak past `upstream/`.** Each client normalises into a domain type from `packages/shared` at its own boundary. If a raw Geoapify or Nominatim field name shows up in `analysis/` or a tool handler, the normaliser for that client is incomplete — fix it there, not downstream.
- **Cache TTLs are per-host and justified.** Geocoding is effectively static; forecasts are not. Set the TTL in the per-host config in `http/`, and put the reasoning in root `MEMORY.md`, not as a code comment that'll drift.
- **Empty is not an error.** A rural coordinate with no POIs returns a valid empty profile. Reserve `NOT_FOUND` for genuine lookup failure (place doesn't resolve, country code unsupported).
- **Every tool accepts `detail: "brief" | "full"`, defaulting to `brief`.** Response shaping happens once, at the registry or a shared response-shaping helper — not reimplemented per handler.
- **Bound every input that costs money or time.** `radius` and `limit` are capped in the Zod schema (owned by `packages/shared`, but the cap value is a server-side decision), not merely documented. Geoapify bills per 20 places returned, so `limit` is a cost lever, not a display preference.
- **Transports stay thin.** `stdio.ts` and `http.ts` translate protocol, nothing else. Business logic that ends up in a transport file is misplaced — move it to `tools/`.

---

## Where things belong when you're not sure

| You're writing... | It goes in... |
|---|---|
| A new upstream API call | `upstream/<name>.ts`, wrapped by the HTTP client core |
| Logic that turns raw POI counts into "high/medium/low" | `analysis/` |
| The actual tool function an agent calls | `tools/<tool-name>.ts` |
| A retry, timeout, or rate-limit rule | `http/` — never inline in an upstream client |
| A Zod schema or domain type | Not here — `packages/shared` |

---

## Testing notes for this package

Follows the root testing philosophy exactly. The server-specific fixtures live in `packages/server/test/fixtures/`, one captured response per upstream. When an upstream API response shape changes, update the fixture and note it as a `MEMORY.md` entry, since a silently stale fixture is worse than no fixture.