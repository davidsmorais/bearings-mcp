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
  http/                 client core: cache, rate limiter, retry, timeout (see HTTP core below)
```

---

## HTTP client core (`src/http/`)

All upstream traffic routes through this module — no bare `fetch()` elsewhere (root Invariant 3).

| File | Role |
|---|---|
| `types.ts` | `HostId`, `HostConfig`, `RequestMeta`, `HttpResult<T>` |
| `config.ts` | `HOST_CONFIG` — declarative per-host TTL, rate limit, retry, timeout |
| `cacheKey.ts` | Credential-free, order-independent cache keys |
| `cache.ts` | Bounded in-memory LRU cache with lazy TTL expiry |
| `rateLimiter.ts` | FIFO token-bucket limiter per host |
| `timeout.ts` | Per-attempt `AbortController`, composed with caller signal |
| `retry.ts` | Retryability classification and backoff (`Retry-After` wins on 429/503) |
| `mapError.ts` | HTTP failure → `ToolError` (`classifyStatus` hook gets first refusal) |
| `client.ts` | `createHttpCore()` — composes cache, single-flight, limiter, retry |
| `index.ts` | Barrel + `getHttpCore()` lazy default instance |

### Production construction

`getHttpCore()` in `index.ts` is the **only** production construction site. Upstream clients call `getHttpCore().request(...)`. Tests build isolated cores via `createHttpCore({ fetch, clock })` — never share state across files.

Grep review: `createHttpCore(` must appear only in `client.ts`, `index.ts`, and `test/`.

### Request composition order

```
build cache key → cache hit? → return
               → in-flight for key? → await same promise
               → retry loop (up to maxAttempts):
                    rate limiter acquire   ← INSIDE the loop
                    authenticate(url)
                    fetch with per-attempt timeout
                    retryable? → backoff, continue
                    ok? → cache success, return
```

**The limiter is inside the retry loop.** Retries are requests and each attempt consumes a token. A request that retries twice consumes three tokens, not one.

### Timeout budget

Timeout is **per attempt**, not per overall call. Worst-case wall time is roughly `maxAttempts × timeoutMs + sum(backoff delays)`. Callers can pass `signal` to cancel early.

### `HttpResult<T>` contract

`request()` returns `{ ok: true, data, meta } | ToolError` — never throws. Upstream clients propagate with:

```ts
const res = await getHttpCore().request<MyType>("nominatim", "/search", params);
if (isToolError(res)) return res;
// use res.data, res.meta
```

`RequestMeta` carries `hostId`, `cacheHit`, `attempts`, `durationMs`, and optional `status`. Errors include `details.hostId`, `details.attempts`, and optional `details.status` — never the authenticated URL.

---

## Rules specific to this package

- **Async/await only.** No `.then()` chains.
- **Fan-out uses `Promise.allSettled`, never `Promise.all`.** A partial result beats a total failure. Every composed tool (`get_destination_brief`, `analyse_neighbourhood`) reports which upstreams succeeded via a `sources` block.
- **Upstream shapes never leak past `upstream/`.** Each client normalises into a domain type from `packages/shared` at its own boundary. If a raw Geoapify or Nominatim field name shows up in `analysis/` or a tool handler, the normaliser for that client is incomplete — fix it there, not downstream.
- **Cache TTLs are per-host and justified.** Geocoding is effectively static; forecasts are not. Set the TTL in the per-host config in `http/`, and put the reasoning in root `MEMORY.md`, not as a code comment that'll drift.
- **Empty is not an error.** A rural coordinate with no POIs returns a valid empty profile. Reserve `NOT_FOUND` for genuine lookup failure (place doesn't resolve, country code unsupported).
- **Every tool accepts `detail: "brief" | "full"`, defaulting to `brief`.** Shaping stays per-handler and typed — each `brief` projection is a typed mapping between two members of a discriminated union (`DestinationBriefFull → DestinationBriefBrief`, etc.), and the handler `safeParse`s its own output against that union before returning. A registry-level shaper would operate on `unknown` against a per-tool field-path config, trading the compiler's guarantee that a brief response still satisfies its schema for the same logic relocated and untyped (see `DECISIONS.md`, 2026-09-09). What *is* centralised, at `server.ts`, is token **measurement**: one approximate count computed from the already-serialised response and attached to `_meta["bearings/tokens"]` for every tool and every error — that part is genuinely uniform across handlers, unlike shaping.
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

**A test file lives in the same directory as the code it tests, named `<target>.test.ts`** — `src/tools/resolveDestination.ts` is tested by `src/tools/resolveDestination.test.ts`, `src/http/cache.ts` by `src/http/cache.test.ts`, and so on (the way `packages/shared` colocates its `*.test.ts`). The cross-cutting suite that exercises the whole registry through the transport is `src/server.integration.test.ts`, next to `src/server.ts`. `packages/server/test/` holds no test files — only what has no single target: the committed upstream fixtures (`test/fixtures/`) and shared test helpers (`test/fakeClock.ts`), which a colocated test imports via a relative path. `vitest.config.ts` scans `src/**/*.test.ts`; `passWithNoTests` is `false`, so a suite that collected nothing fails. Type-checking test files is a separate pass — `tsconfig.json` builds only `src/` into `dist/` (it excludes `src/**/*.test.ts`), and `tsconfig.test.json` (no emit) covers both `src/` and `test/`. The `typecheck` script runs both configs.

---

## stdio transport: stdout is the JSON-RPC channel

`transports/stdio.ts` speaks JSON-RPC over stdout. **Anything else written to stdout corrupts the framing and the client silently disconnects** — no `console.log`, no `process.stdout.write`, no stray `print`. All diagnostics go to `console.error` (stderr). This is why `src/index.ts` carries no top-level statements.

`main()`'s body lives in an exported `startStdioTransport(): Promise<StdioTransportHandle>` so `cli.ts` can start it without also running `main()`'s own signal-handling. `main()` itself only runs behind a direct-execution guard (`realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)` — `realpathSync`, not a bare `===`, because an installed `bin` entry is a symlink and a bare comparison would silently never match), so both `node dist/transports/stdio.js` and `node dist/cli.js` (below) work.

### Running it locally / wiring Claude Desktop

```bash
pnpm install
pnpm -r run build          # stdio.ts compiles to packages/server/dist/transports/stdio.js
```

Claude Desktop config (`claude_desktop_config.json`) — the path must be absolute and the build must exist first:

```json
{
  "mcpServers": {
    "bearings": {
      "command": "node",
      "args": ["/absolute/path/to/bearings-mcp/packages/server/dist/transports/stdio.js"]
    }
  }
}
```

Smoke-test without a client by piping frames in:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"message":"hi"}}}' \
  | node packages/server/dist/transports/stdio.js
```

---

## HTTP transport: session lifecycle and the CORS constraint

`transports/http.ts` serves the same registry over Streamable HTTP for `packages/web` (the inspector). Wiring only, same rule as `stdio.ts`: no tool, schema or upstream logic lives here.

**Loopback binding is the actual security boundary; CORS is the second layer, not the first.** `httpHost()` (`src/env.ts`) defaults to `127.0.0.1` — the server does not listen on the network by default, full stop. CORS only decides which *browser origins* may talk to that loopback listener; it does nothing for a client that can already reach the port directly.

**Session lifecycle** — stateful, one `StreamableHTTPServerTransport` and one fresh `createServer()`-built `Server` per session (see root `DECISIONS.md` for why a shared `Server` was rejected), held in an in-memory `Map<sessionId, { transport, server }>`:

- `POST /mcp`, no `mcp-session-id`, an initialize body → a new session: build the transport (`sessionIdGenerator: randomUUID`), register in `onsessioninitialized`, deregister in `transport.onclose`, `server.connect(transport)`, then `handleRequest`.
- `POST /mcp`, a known `mcp-session-id` → dispatch straight to that session's transport.
- `POST /mcp`, no session id, not an initialize body → `400` with a JSON-RPC error body.
- `GET /mcp` (the SSE stream) / `DELETE /mcp` (session termination), unknown or missing session id → `404`.
- Anything else → `404` (Express's default, since only the routes above are registered).
- A trailing 4-arg Express error-handling middleware, registered last, catches anything thrown above all of this (e.g. `server.connect()` itself failing) and returns `jsonRpcError(res, 500, "Internal server error")` — never the raw error's message or stack. Express only treats a handler as error-handling middleware when its arity is exactly 4; a 3-arg handler in that position is silently treated as ordinary middleware and never invoked on error.

**The one CORS header that silently breaks everything if it's missing:** `exposedHeaders: ["mcp-session-id"]`. The browser can always read a same-origin-allowed response's *body*, but a cross-origin response's *headers* are invisible to JS unless explicitly exposed. Miss this and the inspector's initialize call still succeeds — the session id is right there in the response header on the wire — but the SDK client can't read it, treats itself as sessionless, and every subsequent `POST` gets rejected as if initialize never happened. It looks like a server bug from the browser console; it is a CORS config bug. `express.json()` is scoped to `POST /mcp` only — putting it in front of the `GET` SSE route would make that route hang waiting on a body it never receives.

### Running it

```bash
pnpm install
pnpm -r run build                          # cli.ts and http.ts compile to packages/server/dist/
node packages/server/dist/cli.js --transport http    # HTTP only
node packages/server/dist/cli.js --transport both     # HTTP + stdio together
```

`GEOAPIFY_API_KEY` and, optionally, `BEARINGS_HTTP_PORT` / `BEARINGS_HTTP_HOST` / `BEARINGS_ALLOWED_ORIGINS` (see `src/env.ts`) must be set first; `--transport` defaults to `stdio` if omitted, so every existing Claude Desktop / Cursor config keeps working unmodified with no flag at all.