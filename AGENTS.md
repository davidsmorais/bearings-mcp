# AGENTS.md

Guidance for AI-assisted development on **Bearings**, an MCP server exposing destination and neighbourhood intelligence tools backed by public HTTP APIs.

This file is tool-agnostic. Cursor, Claude Code, OpenCode and Antigravity all read it; per-tool specifics are at the bottom.

> **Note for readers:** `rtk`, `graphify` and `code-review-graph` referenced below are the author's local development tools, not dependencies of this project. `pnpm install && pnpm build` is the complete setup. Nothing in this repo requires them.

---

## 📖 Project Memory

**Read `MEMORY.md` at the start of every session** before taking any action. It holds architecture decisions, active constraints, and context not derivable from the code.

- Update it when you learn something non-obvious
- Remove stale entries when facts change
- If `MEMORY.md` and this file disagree, `MEMORY.md` is newer and wins — then fix this file

---

## 📓 DECISIONS.md

A second file, `DECISIONS.md` at the project root, distinct from `MEMORY.md`:

| | `MEMORY.md` | `DECISIONS.md` |
|---|---|---|
| What it holds | Current state of the project | A history of why it got that way |
| Mutability | Edited freely, stale entries removed | Append-only, never edited or deleted |
| Written by | Whoever learns the fact | David only |

**Agents do not write to `DECISIONS.md`.** When a design decision gets made during a session — a library choice, an architecture trade-off, dropping or adding scope, picking one upstream over another — flag it back to David in your response rather than logging it yourself: *"Worth a DECISIONS.md entry: chose Geoapify over Overpass for POI data."* David writes the actual entry.

Format for each entry, oldest first:

```markdown
## 2026-09-04 — Geoapify over Overpass for POI data

**Decision:** Use Geoapify Places instead of Overpass for all neighbourhood POI queries.

**Why:** Overpass QL added a query-language learning cost and unpredictable
server-side timeouts for no credit gained. Geoapify is plain REST with a
documented category hierarchy, and its free tier (3,000 credits/day) covers
the take-home with margin.

**Alternatives considered:** Overpass (original plan), ohsome API (aggregation-only,
no individual place listing), Photon (too thin for category filtering).
```

Agents may read `DECISIONS.md` for context on why something is the way it is, and should check it before proposing to change something that a past entry explains. Agents should not infer new entries from git history or propose entries proactively — only flag the moment, David decides whether and how it gets logged.

---

## 🧭 What This Project Is

An MCP server with three tools. One resolves a place name into a structured location; the other two branch off it.

```
resolve_destination          fuzzy name → structured Location
    ├─→ get_destination_brief    forecast + public holidays for a stay
    └─→ analyse_neighbourhood    POI density profile around a point
```

Upstreams: Nominatim (geocoding), Open-Meteo (forecast), Nager.Date (holidays), Geoapify Places (POI).

The server runs over two transports from one registry: stdio for MCP clients, Streamable HTTP for the React inspector in `packages/web`.

---

## ❓ Before Starting a Plan

For anything beyond a one-line fix — a new tool, a schema change, a new upstream, a refactor spanning files — **ask 3 to 5 clarifying questions before proposing or executing a plan.** Do not fill gaps with assumptions and proceed silently.

Good candidates for these questions: which package the change belongs in, whether it touches the registry or a shared schema, expected behaviour on partial upstream failure, scope boundaries (what is explicitly out), and how the change will be verified.

Skip the questions only when the task is fully unambiguous (fix this exact typo, rename this exact variable) or when the user has already answered them in the same message.

---

## 🏛️ Architecture Invariants

These are not style preferences. Breaking one means the change is wrong, regardless of whether tests pass.

**1. The registry is the only place tools are defined.**
`packages/server/src/registry.ts`. Transports read from it. Neither transport may hold its own tool list, and no tool may be registered from anywhere else. Adding a tool must require zero changes to either transport file.

**2. Schemas live in `packages/shared` and are never duplicated.**
The server validates with them; the inspector generates its forms from them. If a schema is copied or re-declared in `packages/web`, the "forms are generated from the schema" property is a lie and the whole design argument collapses.

**3. No upstream call bypasses the HTTP client core.**
A bare `fetch()` to an upstream is a bug, always. The core owns rate limiting, caching, retry and timeouts. Nominatim enforces 1 req/sec and blocks offenders; the limiter is the only thing preventing that.

**4. Errors are returned, never thrown as strings.**
Everything resolves to the `ToolError` union in `packages/shared`. Messages are written so an LLM can recover:

```
❌ "invalid input"
✅ "radius must be 5000m or less, received 50000"
```

**5. Transports contain no tool logic.**
`stdio.ts` and `http.ts` are wiring. If business logic appears in either, it belongs in a handler.

**6. Derived values carry their evidence.**
Any rating, score or classification returns the data that produced it.

```
❌ { nightlife: "8/10" }
✅ { nightlife: "high", venues: 34, radiusM: 500 }
```

**7. Analysis thresholds are named constants in one block.**
No magic numbers scattered through the analysis layer. Thresholds are a documented decision, not an implementation detail.

**8. Never commit `GEOAPIFY_API_KEY`.**
`.env` is gitignored. `.env.example` carries the key name only. The server validates the key exists at boot, not on first call.

**9. Never loosen a schema to make something pass.**
Widening a bound, dropping a required field, relaxing an enum, or turning a strict check permissive — none of these happen unless explicitly instructed. If a schema appears to block a legitimate case, that is a question to ask, not a constraint to adjust. Schemas encode deliberate decisions (cost caps, validation guarantees); a schema that quietly got easier to satisfy is a regression even when the diff looks clean.

---

## ⚙️ Backend Conventions

### Structure

```
packages/server/src/
  registry.ts          tool definitions
  tools/               one file per tool handler
  upstream/            one client per API
  analysis/            derived logic (density, classification)
  http/                client core: cache, limiter, retry
packages/shared/src/
  schemas/             Zod input schemas
  types/               domain types
  errors.ts            ToolError union
```

### Rules

- **Async/await only.** No `.then()` chains.
- **Fan-out uses `Promise.allSettled`, never `Promise.all`.** A partial result beats a total failure. Every composed tool reports which upstreams succeeded via a `sources` block.
- **Upstream shapes never leak past `upstream/`.** Each client normalises into a domain type at its boundary. If a Geoapify field name appears in `analysis/` or a tool handler, the normalisation layer is incomplete.
- **Cache TTLs are per-host and justified.** Geocoding is effectively static; forecasts are not. The reasoning goes in `MEMORY.md`.
- **Empty is not an error.** A rural coordinate with no POIs returns a valid empty profile. Reserve `NOT_FOUND` for genuine lookup failure.
- **Every tool accepts `detail: "brief" | "full"`,** defaulting to `brief`. Response shaping happens once at the registry level, not in each handler.
- **Bound every input that costs money or time.** `radius` and `limit` are capped in the Zod schema, not merely documented. Geoapify bills per 20 places returned, so `limit` is a cost lever.

---

## 🎨 Frontend Conventions

`packages/web` is a **development inspector**, not a product. It exists so tool calls and structured responses can be examined, and so the schema-as-source-of-truth property is visible rather than claimed.

### Rules

- **No hand-written forms.** Inputs render from the tool's Zod schema via `zod-to-json-schema` and a thin renderer. Adding a tool must surface its form with zero UI changes. If you find yourself writing a `<ResolveDestinationForm>`, stop.
- **Validate client-side with the same schema the server uses.** The user should see the exact error an agent would receive.
- **No charting library.** Density bars are divs. Three bars do not justify a dependency.
- **No component library.** Tailwind only. A light custom layer keeps the surface count low.
- **No animation.** This is devtools chrome.
- **Do not let it become a travel app.** The moment it reads as a consumer product, the server becomes the sideshow. Plain naming, minimal styling, functional colour.
- **Show cost.** Approximate token count and Geoapify credit spend render next to every call. Label the token count approximate; it is not Claude's tokenizer.

### Components

- One component per file. Never nest component definitions.
- Arrow functions, functional components with hooks only.
- PascalCase components, camelCase functions.
- Separate presentational from container components.
- Aliased imports; no `../` or `./` traversal.
- **Never** modify a `useEffect` dependency array to satisfy exhaustive-deps. Fix the effect instead.

---

## 🔌 Upstream Quirks

Read this before touching any `upstream/` client. Each of these has bitten a prior session and is not obvious from the API docs alone.

| Upstream | Quirk | Consequence if ignored |
|---|---|---|
| **Nominatim** | 1 req/sec hard limit, enforced by IP | Ban, sometimes lasting hours. Route every call through the shared rate limiter, never a direct `fetch` |
| **Nominatim** | Requires a descriptive `User-Agent` header | Requests without one are rejected outright |
| **Nominatim** | Ambiguous queries return multiple results with no single "best" flag | Taking `results[0]` silently returns the wrong place. Must produce `AMBIGUOUS` |
| **Open-Meteo** | Forecast horizon is finite | Requests for dates beyond it fail; must be caught and surfaced clearly, not treated as a generic upstream error |
| **Open-Meteo** | Returns hourly arrays by default | Passing raw hourly data through as a "daily summary" is a normalisation bug, not a formatting choice |
| **Nager.Date** | Holiday data is per calendar year | A stay spanning 31 December requires two fetches, not one |
| **Nager.Date** | Not every country code is supported | Return `NOT_FOUND`, never an empty array pretending to be a complete answer |
| **Geoapify** | Billing is 1 credit per 20 places returned | `limit` is a cost lever, not just a page size. Wire it deliberately, don't default it high |
| **Geoapify** | Daily credit cap resets on their schedule, not a rolling window | Surface as `QUOTA_EXCEEDED`, distinct from a generic rate limit |
| **Geoapify** | Category taxonomy is documented but deep (400+) | Map only the categories the analysis layer actually uses; do not import the full tree speculatively |

When a new quirk surfaces during a session, add a row here in the same change, not as a follow-up. This table is more valuable current than complete.

---

## 🧪 Testing

Test the logic, not the internet.

```
✅ a 50000m radius is rejected with a recoverable message
✅ 34 nightlife venues in 500m classifies as high
✅ a weather timeout still returns holidays
❌ Open-Meteo returns weather
```

- Upstreams are mocked at the HTTP client core boundary.
- Response fixtures are committed so the suite is deterministic and runs offline.
- Cover: validation boundaries, each normaliser, threshold edges, partial-failure composition, ambiguous and empty geocoding.
- If a test needs the network to pass, it is the wrong test.

---

## ✅ Definition of Done

A change is not finished until all three pass, in this order:

1. **Tests pass** — `pnpm test`
2. **Type check** — `pnpm typecheck` (or `tsc --noEmit`), zero errors
3. **Lint clean** — `pnpm lint`, zero warnings treated as zero errors

An agent reporting a task complete without having run all three is reporting incorrectly. If any step wasn't run, say so explicitly rather than presenting the work as done.

---

## 🚫 Forbidden Practices

- Bare `fetch()` to an upstream
- Duplicating a schema outside `packages/shared`
- `Promise.all` for upstream fan-out
- Throwing strings or raw errors out of a handler
- Registering a tool outside the registry
- Magic numbers in the analysis layer
- Nested component definitions
- Updating `useEffect` deps to silence the linter
- Committing `.env`

---

## ⚡ Performance

- **No N+1 upstream calls.** If a tool needs POI data for six categories, fan them out in parallel through `Promise.allSettled`, never in a loop of sequential awaits.
- **Respect the cache before optimising anything else.** A slow first call is fine; a slow repeated call means the cache key or TTL is wrong, not that something needs a rewrite.
- **Composed tools should run in roughly the time of the slowest upstream, not the sum.** If `get_destination_brief` takes as long as Open-Meteo plus Nager.Date combined, the fan-out isn't actually parallel — check for an accidental `await` inside a loop before touching anything else.
- **Debounce, don't throttle, on form inputs in the inspector.** Client-side validation reruns on change; a debounce around 200–300ms keeps it from firing on every keystroke.
- **No premature caching in the React layer.** `@tanstack/react-query`'s defaults are enough for a 3-tool inspector. Don't add a second cache on top of it without a measured reason.
- **Bundle size is not a target for this project.** It's a local dev inspector, not a shipped app. Don't spend time code-splitting or lazy-loading three tool forms.

---

## 📝 Code Style

### Imports & Paths
- Aliased imports only; avoid `../` and `./`
- Biome handles sorting

### Functions
- Arrow function syntax throughout
- Descriptive, consistent naming

### Comments
- Only when logic is genuinely non-obvious
- Explain the WHY: hidden constraints, invariants, workarounds
- Never explain WHAT — naming handles that
- No references to issues, tickets or callers; those belong in commit messages

Two things in this codebase warrant a comment because they are non-obvious constraints rather than code:

```ts
// Nominatim blocks clients without a descriptive User-Agent.
// Geoapify bills 1 credit per 20 places, so limit is a cost lever, not just a page size.
```

---

## 📋 Commits

`<emoji><type>[(scope)]: <description>` — imperative mood, no trailing period.

| Prefix | Use for |
|--------|---------|
| `✨feat` | New feature |
| `🐛fix` | Bug fix |
| `📝docs` | Documentation |
| `🔮refactor` | No behaviour change |
| `🚀perf` | Performance |
| `🤖ci` | Build, deps, CI/CD |
| `🧪test` | Tests |
| `📦build` | Build system |
| `🧹chore` | Lint, logs, TS errors |

Scopes: `server`, `web`, `shared`, `upstream`, `analysis`.

---

## 🤖 AI Tooling

All four tools read this file. Subagents and skills live in `.claude/` and are shared; no duplicate copies per tool.

| What | Where | Notes |
|------|-------|-------|
| Project rules | `AGENTS.md`, `MEMORY.md` | Applied automatically |
| Subagents | `.claude/agents/<name>.md` | `@` mention by frontmatter `name` |
| Skills | `.claude/skills/<name>/SKILL.md` | `/` slash commands |

### Cursor
Loads `AGENTS.md` as project rules on every Agent chat. Reads `.claude/` paths directly. Cursor-specific rules in `.cursor/rules/*.mdc`. Full MCP support for `code-review-graph`.

### Claude Code
Reads `AGENTS.md` and `.claude/` natively. Preferred for multi-file refactors and anything touching the registry or shared schemas, where the blast radius spans packages.

### OpenCode
Reads `AGENTS.md`. Has `code-review-graph` MCP. Use for PR review, QA passes and documentation — the read-heavy work.

### Antigravity
Reads `AGENTS.md`. No MCP graph access, so give it explicit file paths rather than expecting it to discover structure. Best for long multi-step agentic tasks where the plan is already clear.

---

## 🛠️ rtk

Token-optimised CLI proxy. Prefix shell commands:

```bash
rtk git status
rtk pnpm test
rtk pnpm lint
```

Meta commands run directly, no double prefix:

```bash
rtk gain              # savings dashboard
rtk gain --history    # per-command history
rtk discover          # find missed opportunities
rtk proxy <cmd>       # raw run, still tracked
```

---

## 🕸️ Graph Tools

Two tools, complementary rather than redundant.

| | **graphify** | **code-review-graph** |
|---|---|---|
| Purpose | Knowledge graph: architecture, communities, god nodes | Dependency graph: blast radius, impact, PR context |
| Output | Static `graphify-out/` files | Live SQLite via MCP tools |
| Update | Manual `graphify update .` (AST-only, no API cost) | Auto-incremental, under 2s |
| Best for | Architecture questions, onboarding | Code review, impact analysis |
| Available in | All CLIs | Cursor, Claude Code, VSCode, OpenCode |

### graphify

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` first.

- For codebase questions, run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually far smaller than `GRAPH_REPORT.md` or raw grep.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review, or when query/path/explain return too little.
- If `graphify-out/wiki/index.md` exists, navigate it instead of raw source.
- Dirty `graphify-out/` files after hooks or incremental updates are expected and are not a reason to skip graphify. Skip only when the task is about stale graph output, or the user says not to.
- Run `graphify update .` after modifying code.

### code-review-graph

Use `query_graph`, `detect_changes` and `get_impact_radius` before large greps. Particularly relevant here: changes to `registry.ts` or `packages/shared` have cross-package blast radius that is not obvious from a single file view.

---

## 🔍 Manual Review Pending

Work an agent produces is not submission-ready until David has checked the following by hand. This list exists so nothing gets assumed verified just because an agent reported success.

- **Rate limiting against the live API, not a mock.** Fire real parallel requests at Nominatim and confirm the limiter actually holds 1 req/sec end to end, not just in a unit test double.
- **Geoapify credit accounting matches the real dashboard.** Compare the app's own credit counter against Geoapify's account usage page after a test session, not just against the documented cost-per-request formula.
- **API key handling.** Confirm the key never appears in a committed file, a client-side bundle, a log line, or an error message returned to the inspector.
- **Every number in the README is real.** Token counts, credit costs, and latency figures must come from an actual measured run, not an estimate an agent wrote to fill the section.
- **License check on any newly added dependency.** Especially anything pulled in for the inspector — confirm it's MIT/Apache/ISC-equivalent before it ships in a submission with David's name on it.
- **Read every AI-generated diff before commit.** The take-home brief explicitly requires the author to understand and validate generated code. This is not delegable to another agent — it's the one review step that has to be David, every time.
- **Final pass on `DECISIONS.md` and the README's decisions section for consistency.** They should tell the same story; agents draft both independently and drift is easy to miss.

---

## Learned Facts

-