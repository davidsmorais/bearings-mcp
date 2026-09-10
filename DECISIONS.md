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

---

## 2026-09-06 — AGENTS.md split per package rather than one root file

**Decision:** Keep four `AGENTS.md` files — a root file for cross-cutting rules and one per
package (`server`, `shared`, `web`) — instead of a single root file covering everything. An agent
reads root plus the file for the package it is working in, and root wins wherever the two disagree.

**Why:** Token economics. Guidance is not read once per session; it is resident in context and
re-sent on every turn of a conversation, so its cost is per-turn and compounds with conversation
length. A monolithic file would make a one-line change in `packages/web` carry the Nominatim rate
limit, the Geoapify billing model, the analysis threshold conventions and the upstream quirk table
on every one of those turns. Splitting the file means a `packages/shared` edit pays for
cross-cutting invariants plus roughly forty lines of schema conventions, and nothing else.

The secondary gain is that specificity survives. In one file, package-specific rules have to be
hedged so they do not read as repo-wide law; in four, `packages/web/AGENTS.md` can flatly forbid a
component library without qualifying which package it means.

**Alternatives considered:** a single root `AGENTS.md` (simplest to keep consistent, but every
session pays for every package's rules on every turn); per-package files with no root (the nine
architecture invariants would be duplicated four times and drift silently); one root file with the
package sections collapsed behind headings (the tools read raw markdown — collapsing is a rendering
convention and saves no tokens at all).

---

## 2026-09-06 — TypeScript enum for error codes, not a string-literal union

**Decision:** `ToolErrorCode` is a TypeScript string enum, and the `ToolError` discriminated union
keys on its members (`ToolErrorCode.QUOTA_EXCEEDED`) rather than on bare string literals
(`"QUOTA_EXCEEDED"`).

**Why:** Readability and TypeScript DX. `ToolErrorCode.QUOTA_EXCEEDED` at a call site announces
both what the value is and where it is defined; `"QUOTA_EXCEEDED"` is an anonymous string that
reads identically to a typo right up until the compiler rejects it — and inside an untyped context
such as a test fixture or a `details` bag, never gets rejected at all. The enum gives one
declaration to jump to, autocomplete everywhere an error is constructed, exhaustiveness checking on
a `switch` over the union, and a runtime list via `Object.values(ToolErrorCode)` that the
`isToolError` type guard uses to tell a real error from any object that happens to carry a `code`
field. A string-literal union offers the first and third of those and none of the rest.

`isolatedModules: true` is set repo-wide, which rules out `const enum` but leaves plain string
enums fine, and `erasableSyntaxOnly` is deliberately not set. If Biome's `noEnum` rule objects, the
rule is disabled in `biome.json` — the ergonomics are the decision, and the lint rule is a default
opinion about a different codebase.

Note the deliberate asymmetry with `PoiCategory`, which stays a `z.enum`: that one is an input
value that has to round-trip through JSON Schema into a `<select>` in the inspector, and `z.enum`
is what `zod-to-json-schema` renders natively. Enums are for discriminants that never leave
TypeScript; Zod enums are for values that cross the wire.

**Alternatives considered:** a string-literal union (zero runtime footprint, but no single
definition to navigate to and no runtime value list for the type guard); a `const` object with
`as const` and a derived type (recovers the runtime list and erases cleanly, but the call-site
ergonomics are unchanged and the declaration is noisier for no gain); `const enum` (rejected
outright — it breaks under `isolatedModules`, which this repo sets).

---

## 2026-09-06 — React Query for the inspector, custom core for upstreams

**Decision:** Adopt `@tanstack/react-query` as the request-state layer in `packages/web` (the inspector), and leave `packages/server/src/http/` — the custom HTTP client core — exactly as it is. React Query is a `packages/web` dependency only; `packages/server` must never import `@tanstack/*` (now a repo-wide Forbidden Practice in `AGENTS.md`).

**Why:**
- `@tanstack/react-query` needs a React component tree; the MCP server is a plain Node process with none. The framework-agnostic `@tanstack/query-core` would run there, but provides none of the four things `packages/server/src/http/` exists for: per-host token-bucket rate limiting (Nominatim's 1 req/sec IP ban), `Retry-After` header precedence on retry, per-attempt `AbortSignal` timeout with a typed `TIMEOUT` error, and `ToolError` mapping. Adopting it server-side would be a net capability loss while still requiring every custom layer to be rebuilt on top.
- In the inspector, the opposite is true: loading/error/success state, request de-duplication, and cache invalidation are exactly what React Query does well, and hand-rolling a second state machine on top of it is explicitly forbidden by `packages/web/AGENTS.md`.
- The inspector configures `retry: false`, `refetchOnWindowFocus: false`, `staleTime: 0`. React Query's product defaults (3 retries, refetch on focus) are wrong for a debugging tool — a failed Geoapify call must show the developer one failure, not three silent attempts burning three credits. `AGENTS.md`'s "caching defaults are enough" guidance was amended in the same change to make clear it covers caching, not retry.

**Alternatives considered:**
- Rebuild the upstream core on `@tanstack/query-core` (loses rate limiting, `Retry-After`, per-attempt timeout, and `ToolError` mapping; still needs every custom layer anyway).
- Delete the custom core entirely (violates the standing "no bare `fetch()` to an upstream" invariant).
- Raw `fetch` in the hooks instead of the MCP SDK `Client` (re-implements JSON-RPC framing, session-id handling, and SSE parsing that the SDK already does correctly, and drifts the moment the SDK's session handling changes).

**Status:** React Query layer, `QueryClient`, MCP client singleton, and `useToolList` / `useToolCall` hooks delivered under `_spells/004`. End-to-end verification against a running server is deferred to Linear DMS-503 (Streamable HTTP transport), which does not yet exist — the hooks are pinned by mocked-client unit tests in the meantime.

---

## 2026-09-09 — Stateful sessions: one transport, one `createServer()`, per session

**Decision:** The Streamable HTTP transport (`packages/server/src/transports/http.ts`) is stateful. Each MCP session gets its own `StreamableHTTPServerTransport` *and* its own `createServer()`-built `Server`, keyed by `mcp-session-id` in an in-memory `Map`. No request is served by a shared, module-level `Server` instance.

**Why:** The inspector holds a long-lived `Client` (`packages/web/src/lib/mcpClient.ts`, memoised across React StrictMode's double-mount) and relies on the GET SSE stream for server-initiated messages — both assume a session that persists across calls, which only a stateful transport provides. It is also the SDK's own canonical shape (`sessionIdGenerator`, `onsessioninitialized`, `transport.onclose`), so the code reads like the reference examples instead of fighting them. A single `Server` shared across sessions would interleave JSON-RPC request ids between unrelated clients; since the tool registry is module-level and cheap to wire, constructing a fresh `Server` per session costs nothing and removes that risk entirely.

**Alternatives considered:** A stateless server-per-request (`sessionIdGenerator: undefined`) — fewer moving parts and no session map to clean up, but the SDK returns `405` on `GET` for a stateless transport, which would silently break the SSE stream the inspector may come to depend on, and it discards the server→client channel a stateful session gets for free. One shared `Server` across all sessions — rejected outright: it interleaves request ids and makes two concurrent inspector tabs cross-contaminate each other's in-flight calls.

---

## 2026-09-09 — `stdio` stays the default transport mode

**Decision:** `cli.ts`'s `--transport` flag defaults to `stdio` when omitted. Switching a deployment to `http` or `both` is opt-in via an explicit flag; it is never the default.

**Why:** Every Claude Desktop and Cursor config that already points at this server does so with no flag at all — either at `dist/transports/stdio.js` directly, or (after this ticket) at the `bearings-mcp` bin, which resolves to `dist/cli.js`. Flipping the default to anything other than `stdio` would silently change what those existing configs boot the moment someone rebuilds and reinstalls, with no local signal that behavior changed. `stdio` costs nothing extra to keep as default — the HTTP transport is additive, not a replacement — so there is no upside to defaulting anywhere else.

**Alternatives considered:** Default to `both` (so a fresh `bearings-mcp` invocation always serves the inspector too) — rejected because it changes the resource footprint and network-listening behavior of every existing headless install without anyone asking for it, and because `both` mode requires `BEARINGS_HTTP_PORT` to be free, which a `stdio`-only deployment has no reason to guarantee. Default to `http` — rejected outright; it would break every desktop MCP client on the next rebuild.

## 2026-09-09 — Per-handler response shaping, registry-level token measurement

**Decision:** `detail: "brief" | "full"` projection logic stays in each tool's own
handler — a typed mapping between two members of a discriminated union
(`DestinationBriefFull → DestinationBriefBrief`, `NeighbourhoodProfileFull →
NeighbourhoodProfileBrief`) that the handler `safeParse`s its own output against
before returning. What moves to a single shared seam is *measurement*: `server.ts`
computes one approximate token count per response, from the already-serialised text,
and attaches it to `_meta["bearings/tokens"]` for every tool and every error — the one
thing that genuinely is uniform across tools.

**Why:** DMS-501 opened this as a question — should shaping be centralised at the
registry, or stay per handler — and the answer is that a registry-level shaper would
have to operate on `unknown` against a per-tool list of field paths, trading the
compiler's guarantee that a brief response still satisfies its schema for a config file
that is the same logic relocated and untyped. The fields each tool drops differ in
*kind* (echoed request input for `resolve_destination`, upstream evidence for
`get_destination_brief`, bulk samples for `analyse_neighbourhood`), so there is no
shared rule to factor out. Token counting has no such per-tool variation — it only
needs the text a handler already produced — so it is the one part of this that
belongs at the seam both transports share.

**Alternatives considered:** a generic shaper keyed by field paths (untyped, and the
per-tool config is the code again, just relocated); `.omit()`-derived brief schemas in
`packages/shared` (closer to typed, but the projections are not pure omissions — the
forecast's nested `days[].weatherCode` and the domain profiles' nested `samplePois`
need per-level handling that `.omit()` can't express).

---

## 2026-09-09 — `gpt-tokenizer` in `packages/shared`, behind a subpath export

**Decision:** Add `gpt-tokenizer` as a `packages/shared` dependency and expose
`estimateTokens` via a `./tokens` subpath export (`@bearings/shared/tokens`), not the
main barrel. The encoding submodule is imported directly
(`gpt-tokenizer/encoding/o200k_base`) rather than the package's default export.

**Why:** `packages/shared/AGENTS.md` scopes that package to "Zod schemas, domain types,
and the error taxonomy — nothing else," and a token estimator is none of those — this
is a deliberate, recorded exception, not a quiet expansion of the package's job. It
lives here anyway because `packages/server` needs the count and "a tested shared
utility" is the honest description of what it is; the subpath keeps it out of the main
barrel that `packages/web` imports, since the tokenizer carries megabytes of rank data
with module-level initialisation that the inspector's bundle must never pay for — the
inspector reads the count the server already computed instead of recomputing it.
Pinning the encoding submodule import means a future `gpt-tokenizer` major that changes
the package's default encoding can't silently move every recorded number.

**Alternatives considered:** `packages/server/src/tokens/` (respects the shared-package
scope exactly, but then "shared, tested utility" is a fiction the moment the inspector
needs its own estimate); the shared barrel (bundle risk in `packages/web` for zero
benefit); `chars/4` heuristic instead of a real tokenizer (no dependency at all, but the
measured delta this ticket exists to produce would be an estimate of an estimate);
`@anthropic-ai/tokenizer` (deprecated, Claude-2 era — no more accurate for current
models while adding a heavier dependency).

---

## 2026-09-09 — `detail` gates the Geoapify credit ceiling; `full` returns ten samples

**Decision:** Two schema widenings, both explicitly authorised by David against
Invariant 9's default of never loosening a bound without being asked:

1. `limitPerCategory`'s cap rises from 20 to 40, default unchanged at 20, with a new
   refinement rejecting `detail: "brief"` above 20. `detail` gates the ceiling rather
   than deriving the limit from it: under `ceil(places / 20)` billing every value from
   1 to 20 costs exactly one credit, so lowering the `brief` default would save nothing
   while only capping counts lower. Credits can only move upward — `full` may now opt
   into a second credit bucket for a higher honest-count ceiling; the default stays 20
   so nobody spends double by accident.
2. `DomainProfileSchema.samplePois` rises from `.max(5)` to `.max(10)`, and the
   server's `SAMPLE_POI_LIMIT` constant matches. This is a *response* bound, not an
   input bound — it caps nothing that costs money or admits bad input. With
   `limitPerCategory` reaching 40, five samples out of forty is a thinner window on the
   data than five out of twenty was, and `full` is the mode whose purpose is depth.

**Why these are recorded together but are not the same kind of change:** the first
widens what a caller may spend; the second widens what a response may contain for free.
Folding them into one ticket is fine because both exist for the same reason (`full`
trading more cost/size for more depth), but a future reviewer should not read the
credit-ceiling reasoning as justifying the sample-count change or vice versa — they are
independent knobs, and the docs should not imply `limitPerCategory` and `samplePois`
scale together (twenty places already yield ten samples; the second credit buys a
higher honest-count ceiling, not a richer sample).

**Alternatives considered:** lowering the `brief` default instead of raising the `full`
ceiling (reads as wired, saves zero credits under per-20 billing, and degrades ratings
by capping counts lower — the worst of the options considered); leaving the cap at 20
and documenting that `detail` cannot move Geoapify spend (honest and zero-risk, but
closes the ticket's acceptance criterion by explaining it away rather than meeting it);
scaling `samplePois` with `limitPerCategory` instead of a flat 10 (couples two
independent knobs and makes the response shape a function of a cost lever, harder to
document than it's worth); leaving `samplePois` at 5 (keeps the brief-vs-full token
delta more flattering, which is not a reason to pick a sample size).

---

## 2026-09-09 — Comparison is history-based, not a compare button

**Decision:** The inspector records every call in a session history with its token count,
Geoapify credits and latency, and comparison happens by pinning two of those entries side
by side. There is no "compare brief vs full" button that fires both calls.

**Why:** The acceptance criterion is that brief and full can be compared with token
counts. A button that dispatches both would satisfy it literally while doubling Geoapify
spend on every press — in a tool whose stated purpose is making cost visible, that is the
wrong instinct to build in. Pinning reuses calls already paid for. It also generalises for
free: the same mechanism compares two radii, two queries, or a successful call against the
failure that preceded it, none of which a brief-vs-full button would have covered.

Failures are recorded alongside successes, because a failed call still burned latency and
may have burned credits before the failing upstream, and it is exactly the call a
developer goes looking for.

**Alternatives considered:** an explicit compare action firing both calls (literal, and
costs a credit every time someone is curious); rendering only the latest response and
leaving comparison to the developer's memory (which is what the token numbers exist to
replace).

**Consequence worth knowing:** the running credit total is accumulated in the history
reducer rather than summed over the visible entries, because the entry list is capped at
50. A total derived from surviving entries would start *decreasing* after the cap — the
one behaviour a spend counter must never have.

---

## 2026-09-09 — Fault injection lives in the HTTP client core, behind an env flag

**Decision:** Simulated upstream failures are raised inside `packages/server/src/http/client.ts`,
before the cache read, and mapped through the same `mapHttpError` a real failure takes.
State lives in `src/http/faults.ts`; the `/__dev/faults` control route is registered only
when `BEARINGS_FAULT_INJECTION` is set.

**Why:** The partial-result path is one of the more interesting behaviours in this repo and
was previously undemonstrable without unplugging the network. Injecting at the core means
everything downstream — the per-domain composition, the `sources` block, credit accounting
— cannot distinguish an injected failure from a genuine one, so what gets demonstrated is
the real path rather than a mock of it. Root Invariant 3 already says nothing bypasses the
core, which makes the core the only place a fault can be raised without lying.

The check runs **before** the cache lookup deliberately: a warm cache entry would otherwise
answer the request and the armed fault would silently never fire, which is the most
confusing possible behaviour for a debugging control.

Registering the route conditionally rather than having it refuse when disarmed means an
unset flag leaves no surface at all — a 404, not a 403 that advertises the feature exists.

**Alternatives considered:** carrying a fault directive in the MCP `tools/call` `_meta`
(threads a debug-only parameter through every handler signature down to the upstream
clients — production code paying for a demo feature); setting it as a header at transport
construction (global, and changing it needs a reconnect); a mocked `fetch` swapped into
`getHttpCore()` (bypasses the retry, timeout and error-mapping layers that make the
simulated failure resemble a real one at all).

**Known limitation, accepted:** faults are per upstream **host**, which is the granularity
the core knows. `analyse_neighbourhood` queries Geoapify for all six domains, so faulting
Geoapify takes all six down together rather than one; the mixed ok/unavailable case is
`get_destination_brief`, which composes two genuinely different upstreams. Per-domain
granularity would mean threading a domain concept into the HTTP core, which is a real
architectural cost for a demo affordance. The fault registry is also module-level and
therefore shared across sessions — two inspector tabs share one setting, which is
acceptable for a loopback development tool.

---

## 2026-09-09 — `react-json-view-lite` is the inspector's one component dependency

**Decision:** Add `react-json-view-lite` for the raw JSON pane. Density bars stay plain
`<div>`s; no charting library, no component library, no animation library.

**Why:** `packages/web/AGENTS.md` forbids dependencies that exist to make the inspector
look like a product. A collapsible JSON tree is not that — the `analyse_neighbourhood`
`full` response is genuinely too deep to read unfolded, and hand-rolling collapse state for
arbitrary nesting is more code than the dependency. It ships no design system of its own,
so it cannot drag the tool's appearance toward a templated dashboard.

**Alternatives considered:** a `<pre>` with `JSON.stringify` (zero dependencies, and fine
for `echo` or `resolve_destination`, but unreadable for the response that most needs
reading); `@rjsf/core` for the forms, rejected earlier and still rejected — reskinning it
costs more than the thin renderer in `zodToForm.ts`.

---

## 2026-09-09 — Manual verification checklist as a committed document; fixture provenance made explicit

**Decision:** The DMS-502 manual checks live in `docs/manual-checks.md` as a
runnable checklist with the expected output for each step, sourced from the
committed fixtures so the doc and the automated suite cannot drift. Every new
tool or shaping change updates it in the same PR. Separately, all four upstream
fixtures now carry a `_note`: `nominatim.json` and `nager.json` record a live
capture (URL, params, date); `open-meteo.json` and `geoapify-places.json` state
that they are shaped to the documented response schema rather than captured
verbatim, and why.

**Why:** A senior submission is expected to show both an automated suite and a
written list of the checks that can only be done by hand (real network, the
Nominatim rate limiter, the MCP handshake, the inspector UI, clean-clone
startup). Open-Meteo only serves a rolling 16-day window, so any verbatim capture
ages out of range within weeks and its values drift on every request — a
committed capture would make the per-day assertions in `openMeteo.test.ts`
non-deterministic. Geoapify needs a keyed, credit-spending request, so a
committed live capture is neither free nor reproducible. In both cases a
schema-faithful hand-shaped fixture is the honest choice for a normaliser test,
and the real-response contract is what `docs/manual-checks.md` exists to check.

**Note:** the "automated suite runs offline with no network access" acceptance
criterion is not claimed. The suite mocks every upstream at the HTTP client core
boundary and is deterministic, but no guard enforces the absence of network
access, and asserting an offline guarantee the repo does not enforce would be
misleading. The README and `AGENTS.md` were adjusted to drop the offline claim.

**Alternatives considered:** folding the checklist into the README (kept the
README short instead, linked out); recapturing Open-Meteo live (rejected —
non-deterministic and date-fragile); adding a `setupFiles` network tripwire to
back an offline claim (out of scope for this slice, and the user's call).


---

## 2026-09-10 — Terminal classification for quota exhaustion in the retry loop

**Decision:** A host `classifyStatus` verdict of `QUOTA_EXCEEDED` breaks the HTTP
core retry loop immediately, instead of the raw 429 being retried to
`maxAttempts`.

**Why:** A Geoapify daily-quota 429 carries a quota message in the body, and
`config.ts` already classifies it — but only inside `mapHttpError`, after the
retry loop had exhausted its budget. Six domains fanning out meant eighteen
requests and up to ~16 s of backoff for an answer the first response already
gave. A daily quota does not recover within a backoff window, so retrying it is
pure waste.

**Alternatives considered:** treating any `classifyStatus` hit as terminal
(rejected — over-broad; a classified 401 is already terminal via the status
check, and other classifications may be transient); a separate non-retryable
status set (rejected — the quota case is a body check, not a status check, so it
has to run where the body is in scope).

---

## 2026-09-10 — Neighbourhood rating is read at a fixed 500 m ring

**Decision:** `classifyDomain` rates each domain from the ring at
`CALIBRATION_RADIUS_M` (500 m) regardless of the request `radiusM` — or the
request's outer ring when `radiusM` is below 500 m. The ring used is reported as
`DomainRating.ratingRadiusM`.

**Why:** `DENSITY_THRESHOLDS` is calibrated at exactly one radius, and MEMORY.md
concedes the reference readings are hand-derived estimates never measured live.
POI density genuinely falls off with radius and the fixed `limitPerCategory` cap
makes it collapse — a nightlife sample saturated at 20 places rated `high` at
500 m and `low` at 1000 m+ for the same neighbourhood, and a test asserted that
degradation as correct. Pinning classification to the calibration point gives
`rating` one stable meaning: venue density within a ~6-minute walk.

**Alternatives considered:** scaling thresholds per radius (rejected — needs
multi-radius calibration data that does not exist and cannot be produced without
live Geoapify runs); returning `rating: null` when `radiusM > 500` and the count
is capped (rejected — empties the flagship tool's headline field for a common
input and pushes a null onto every caller). `radiusM` stays unrestricted; it is
now a sample-width and evidence knob, not a rating input.
