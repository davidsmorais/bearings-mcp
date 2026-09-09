# Manual verification checklist

The automated suite (`pnpm test`) covers the logic — validation, normalisers,
threshold edges, partial-failure composition — with every upstream mocked at the
HTTP client core boundary. The checks below are the ones that **can only be done
by hand**: real network behaviour, the Nominatim rate limiter, the MCP handshake
over a real transport, the inspector UI, and a clean-clone startup. They are
deliberately *not* in the automated suite (`AGENTS.md`: "if a test needs the
network to pass, it is the wrong test").

Run them before a senior review, after any change to an upstream client, a tool
schema, response shaping, or a transport.

**Keeping this current:** every new tool, and every change to an existing tool's
shaping or output, adds or updates a step here in the same PR. The expected
values below are drawn from the committed fixtures in
`packages/server/test/fixtures/` so this document and the suite agree on what a
healthy response looks like; if a fixture is recaptured, update the numbers here
too.

## Setup

```bash
pnpm install
pnpm build
cp .env.example .env          # then set GEOAPIFY_API_KEY
node packages/server/dist/cli.js --transport both
```

`GEOAPIFY_API_KEY` is validated at boot, not on first call — a missing key fails
fast. `BEARINGS_HTTP_PORT` / `BEARINGS_HTTP_HOST` / `BEARINGS_ALLOWED_ORIGINS`
are optional (`3000` / `127.0.0.1` / Vite's dev origins).

Several steps drive tools through a client. Use whichever is handy: Claude
Desktop / Cursor over stdio, the inspector over HTTP, or the stdin-piped frames
in `packages/server/AGENTS.md`.

---

## 1. Geocoding — `resolve_destination`

### 1.1 A confident single match

- [ ] Call `resolve_destination` with `{ "query": "Lisbon" }`.

**Expected:** a single `ResolvedLocation`, not an error.

| Field | Value |
| --- | --- |
| `name` | `Lisbon` |
| `countryCode` | `PT` |
| `displayName` | `Lisbon, Portugal` |
| `coordinates` | `{ lat: 38.7077507, lon: -9.1365919 }` (approx — live data drifts slightly) |
| `kind` | `city` |
| `admin` | `{ county: "Lisbon", municipality: "Lisbon" }` |

The top hit beats the runner-up by more than the 0.15 importance gap, so the
client returns it directly rather than asking for disambiguation.

### 1.2 An ambiguous query

- [ ] Call `resolve_destination` with `{ "query": "Springfield" }`.

**Expected:** a `ToolError` with `code: "AMBIGUOUS"` carrying a `candidates`
array (not a thrown error, not a silent pick):

- every candidate's `location.name` is `Springfield`
- candidates are ranked by `importance` **descending**
- the field spans multiple US states — Illinois (~`39.80, -89.64`),
  Massachusetts (~`42.10, -72.59`), Missouri (~`37.21, -93.29`), and more
- no single hit clears the 0.15 importance gap over the next, which is exactly
  why it comes back ambiguous

### 1.3 A query that matches nothing

- [ ] Call `resolve_destination` with `{ "query": "asdkjhasd" }`.

**Expected:** a `ToolError` with `code: "NOT_FOUND"`. Never an empty successful
result — zero normalised hits is an error, by design.

### 1.4 Nominatim rate limiting — no IP ban

Nominatim's usage policy is 1 request/second; exceeding it risks an IP ban. The
HTTP core holds a per-host token bucket in front of it.

- [ ] Fire two `resolve_destination` calls back to back (e.g. `"Porto"` then
  `"Braga"`), with the server logging at debug level, or watch the wall clock.

**Expected:** the second Nominatim request leaves **at least ~1 second** after
the first. Both calls succeed; no `429`, no ban. Repeating the exercise a dozen
times in a loop stays clean.

---

## 2. Stay brief — `get_destination_brief`

Resolve a real destination first (or pass a known `location`), then:

### 2.1 Both upstreams healthy

- [ ] Call `get_destination_brief` for a stay **within the next ~14 days** at a
  real location (so the forecast horizon covers it), e.g. Vienna,
  `{ start: "<soon>", end: "<soon+3>" }`.

**Expected:**

- `forecast` present — one entry per day of the stay, each with a temperature
  range, a precipitation figure and a condition
- `holidays` present — an array (possibly `[]` if none fall in the window)
- `sources.openMeteo.status === "ok"` **and** `sources.nager.status === "ok"`

### 2.2 One upstream host blocked → partial

- [ ] Block one upstream and repeat. Either add `0.0.0.0 api.open-meteo.com` to
  `/etc/hosts`, **or** start the server with `BEARINGS_FAULT_INJECTION=1` and arm
  a fault (`POST /__dev/faults` `{ "open-meteo": "upstream_error" }`, or the
  inspector's fault panel).

**Expected:** the call still returns a brief, not an error:

- `forecast` absent, `sources.openMeteo.status === "unavailable"` carrying its
  `error`
- `holidays` still present, `sources.nager.status === "ok"`
- reverse the blocked host and the mirror holds — holidays absent, forecast
  intact

### 2.3 Stay spanning a year boundary

- [ ] Call `get_destination_brief` for a stay that crosses New Year, e.g.
  `{ start: "2026-12-28", end: "2027-01-03" }` for an Austrian location.

**Expected:** `holidays` contains entries from **both** calendar years — e.g.
`2026-12-26` (St. Stephen's Day) and `2027-01-01` (New Year's Day). Nager is
queried once per year the window touches and the results are merged.

---

## 3. Neighbourhood profile — `analyse_neighbourhood`

### 3.1 Dense centre vs. rural point

- [ ] Call `analyse_neighbourhood` for a dense city centre (e.g. Paris,
  `{ lat: 48.8566, lon: 2.3522 }`, `radiusM: 500`).
- [ ] Call it again for a rural point (open countryside, same radius).

**Expected:** contrasting profiles.

- the city-centre response rates several of the seven domains (`dining`,
  `cafes`, `nightlife`, `groceries`, `transit`, `parks`, `culture`) `medium` or
  `high`; the rural one rates most `none` or `low`
- every domain rating carries its `count`, `radiusM`, `density` and per-ring
  breakdown, in both responses
- `detail: "brief"` (the default) omits `samplePois` and location coordinates;
  `detail: "full"` adds up to 10 nearest sample POIs per domain
- `credits.consumed` is reported with a per-domain breakdown; an identical repeat
  call within the Geoapify cache window reports `0`

### 3.2 Geoapify at or over the daily credit cap

- [ ] Exhaust the Geoapify daily quota (or arm `BEARINGS_FAULT_INJECTION=1` with
  `{ "geoapify": "quota_exceeded" }`) and call `analyse_neighbourhood`.

**Expected:** a `ToolError` with `code: "QUOTA_EXCEEDED"` — **not** `RATE_LIMITED`,
and not a crash or an unhandled rejection. Geoapify signals quota exhaustion as a
`429` with a quota message in the body; the host config's classifier separates it
from a plain rate limit.

---

## 4. Transports and the MCP handshake

### 4.1 stdio in a desktop MCP host

- [ ] Point Claude Desktop or Cursor at `node packages/server/dist/cli.js` (no
  flag — stdio is the default) with `GEOAPIFY_API_KEY` in the env. See
  `packages/server/AGENTS.md` for the exact config block.
- [ ] Open the host and inspect its tool list.

**Expected:** `tools/list` shows all four tools — `echo`, `resolve_destination`,
`get_destination_brief`, `analyse_neighbourhood` — each with a description and a
JSON Schema for its input. Diagnostics go to stderr; stdout stays clean JSON-RPC.

### 4.2 Streamable HTTP from the inspector

- [ ] `node packages/server/dist/cli.js --transport http`
- [ ] `pnpm --filter @bearings/web dev`, open the inspector in a browser.

**Expected:** the inspector connects (one session, `mcp-session-id`), and its
tool selector lists the **same four tools** reachable over stdio. Names and
descriptions come from the live `tools/list`; the input forms are generated from
the shared Zod schemas.

---

## 5. The inspector UI

### 5.1 Every tool round-trips

- [ ] For each of the four tools: select it, fill the generated form, submit.

**Expected:** each call shows both a **rendered** result panel and the **raw
JSON** response. A rejected input shows the exact `ToolError` message an agent
would receive (produced by the same `zodErrorToToolError` the server uses).

### 5.2 Cost meter reflects `detail`

- [ ] Call a tool with `detail: "brief"`, then the same tool and inputs with
  `detail: "full"`. Pin both in the call history.

**Expected:** the cost meter reads its token count off
`_meta["bearings/tokens"]` (labelled approximate, tokenizer `o200k_base`), and
the pinned pair shows a real, non-zero delta with `full` always the larger.

### 5.3 Token delta matches `measure:tokens`

- [ ] Run `pnpm --filter @bearings/server measure:tokens` and compare its table
  to what the inspector shows per call.

**Expected:** they agree (the inspector shows the server-computed number, not a
browser estimate). Current reference figures — `brief` vs `full` approximate
tokens:

| Tool | `brief` | `full` | Δ |
| --- | ---: | ---: | ---: |
| `resolve_destination` | 51 | 111 | −54% |
| `get_destination_brief` | 233 | 286 | −19% |
| `analyse_neighbourhood` | 468 | 1451 | −68% |

A regression guard in `server.integration.test.ts` already asserts
`brief < full` for every real tool; this step confirms the magnitudes are still
what the README describes.

---

## 6. Clean-clone onboarding

- [ ] In a fresh directory: `git clone <repo>`, `cd` in, then
  `pnpm install && pnpm build`, `cp .env.example .env`, set `GEOAPIFY_API_KEY`,
  `node packages/server/dist/cli.js`.

**Expected:** from clone to a server accepting an `initialize` frame in **under
two minutes** on a warm pnpm store, with no step not written down here or in the
README.
