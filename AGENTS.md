# AGENTS.md

Guidance for AI-assisted development on **Bearings**, an MCP server exposing destination and neighbourhood intelligence tools backed by public HTTP APIs.

This file is tool-agnostic and applies repo-wide. Cursor, Claude Code, OpenCode and Antigravity all read it. Each package also has its own `AGENTS.md` with conventions specific to that package — read this file first, then the one for whichever package you're working in.

```
/AGENTS.md                  ← you are here: cross-cutting rules, all packages
/packages/server/AGENTS.md  ← backend-specific
/packages/shared/AGENTS.md  ← schema/type-specific
/packages/web/AGENTS.md     ← inspector-specific
```

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

Package split:

| Package | Purpose |
|---|---|
| `packages/server` | MCP registry, transports, tool handlers, upstream clients, analysis logic |
| `packages/shared` | Zod schemas, domain types, error taxonomy — imported by both server and web |
| `packages/web` | Development inspector: schema-driven forms, response viewer, cost tracking |

---

## ❓ Before Starting a Plan

For anything beyond a one-line fix — a new tool, a schema change, a new upstream, a refactor spanning files — **ask 3 to 5 clarifying questions before proposing or executing a plan.** Do not fill gaps with assumptions and proceed silently.

Good candidates for these questions: which package the change belongs in, whether it touches the registry or a shared schema, expected behaviour on partial upstream failure, scope boundaries (what is explicitly out), and how the change will be verified.

Skip the questions only when the task is fully unambiguous (fix this exact typo, rename this exact variable) or when the user has already answered them in the same message.

---

## 🏛️ Architecture Invariants

These apply across every package. Breaking one means the change is wrong, regardless of whether tests pass. Package-specific rules live in that package's `AGENTS.md`; these are the ones that hold everywhere.

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

## 🔌 Upstream Quirks

Read this before touching any `upstream/` client. Each of these has bitten a prior session and is not obvious from the API docs alone. Lives at root, not in `packages/server`, because it's referenced from the README and from `DECISIONS.md` too.

| Upstream | Quirk | Consequence if ignored |
|---|---|---|
| **Nominatim** | 1 req/sec hard limit, enforced by IP | Ban, sometimes lasting hours. Route every call through the shared rate limiter, never a direct `fetch` |
| **Nominatim** | Requires a descriptive `User-Agent` header | Requests without one are rejected outright |
| **Nominatim** | Ambiguous queries return multiple results with no single "best" flag | Taking `results[0]` silently returns the wrong place. Must produce `AMBIGUOUS` |
| **Open-Meteo** | Forecast horizon is finite | Requests for dates beyond it fail; must be caught and surfaced clearly, not treated as a generic upstream error |
| **Open-Meteo** | Returns hourly arrays by default | Passing raw hourly data through as a "daily summary" is a normalisation bug, not a formatting choice |
| **Nager.Date** | Holiday data is per calendar year | A stay spanning 31 December requires two fetches, not one |
| **Nager.Date** | Not every country code is supported | Return `NOT_FOUND`, never an empty array pretending to be a complete answer |
| **Geoapify** | Billing is `ceil(places / 20)` credits per request, and the ceiling is now gated by `detail` (DMS-501): `limitPerCategory` maxes at 20 for `brief`, 40 for `full` — default unchanged at 20 | `limit` is a cost lever, not just a page size. Wire it deliberately, don't default it high, and don't let `brief` opt into the second credit bucket |
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

If `pnpm lint` (Biome) reports something confusing — a `biome.json` deprecation warning, a `--write` that changed nothing, or output and exit code that disagree — **read the `biome-specialist` skill** (`.agents/skills/biome-specialist/SKILL.md`, invokable as `/biome-specialist`) before hand-editing config or assuming the tool is broken. It documents this repo's known footgun where a shell hook can silently rewrite a `biome …` command onto something else entirely.

---

## 🚫 Forbidden Practices (repo-wide)

- Bare `fetch()` to an upstream
- Duplicating a schema outside `packages/shared`
- `Promise.all` for upstream fan-out
- Throwing strings or raw errors out of a handler
- Registering a tool outside the registry
- Magic numbers in the analysis layer
- Committing `.env`
- Loosening a schema without being asked (see Invariant 9)
- Importing `@tanstack/*` from `packages/server` — it is a `packages/web` dependency only

Package-specific forbidden practices (React nesting, `useEffect` rules, etc.) live in `packages/web/AGENTS.md`.

---

## ⚡ Performance

- **No N+1 upstream calls.** If a tool needs POI data for six categories, fan them out in parallel through `Promise.allSettled`, never in a loop of sequential awaits.
- **Respect the cache before optimising anything else.** A slow first call is fine; a slow repeated call means the cache key or TTL is wrong, not that something needs a rewrite.
- **Composed tools should run in roughly the time of the slowest upstream, not the sum.** If `get_destination_brief` takes as long as Open-Meteo plus Nager.Date combined, the fan-out isn't actually parallel — check for an accidental `await` inside a loop before touching anything else.
- **Debounce, don't throttle, on form inputs in the inspector.** Client-side validation reruns on change; a debounce around 200–300ms keeps it from firing on every keystroke.
- **No premature caching in the React layer.** `@tanstack/react-query`'s *caching* defaults are enough for a 3-tool inspector — don't add a second cache on top without a measured reason. This does **not** extend to its *retry* default: the inspector configures `retry: false` on purpose, so a failing Geoapify call shows the developer one failure, not three silent attempts burning three credits. Caching defaults: keep. Retry default: off. See `DECISIONS.md`.
- **Bundle size is not a target for this project.** It's a local dev inspector, not a shipped app. Don't spend time code-splitting or lazy-loading three tool forms.

---

## 📝 Code Style (repo-wide)

### Imports & Paths
- Aliased imports only; avoid `../` and `./`
- Biome handles sorting

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

Language-specific style (function syntax, component rules) lives in each package's `AGENTS.md`.

---

## 📋 Commits

One logical change per commit. **Read the `atomic-commits` skill** (`.agents/skills/atomic-commits/SKILL.md`, invokable as `/atomic-commits`) before committing or splitting a PR — it defines atomicity rules, the emoji-prefixed conventional format, scopes, and verification steps.

Format: `<emoji><type>(<scope>): <imperative summary>` — e.g. `✨feat(server): add resolve_destination tool`. Imperative mood, no trailing period.

---

## 🤖 AI Tooling

All four tools read this file. Subagents and skills live in `.claude/` and are shared; no duplicate copies per tool.

| What | Where | Notes |
|------|-------|-------|
| Project rules | `AGENTS.md`, `MEMORY.md` | Applied automatically |
| Subagents | `.claude/agents/<name>.md` | `@` mention by frontmatter `name` |
| Skills | `.claude/skills/<name>/SKILL.md` | `/` slash commands |

### 👥 Active Agent Roster & Registry

The project uses 8 specialized sub-agents rooted in `.hocus/personas/`:

| Agent Name | Soul / Character | Role | Glyph | Primary Responsibilities | Allowed Tools |
|---|---|---|---|---|---|
| **`orchestrator`** | Roger Bacon (`jared`) | Orchestrator | `[#]` | Maintains battle plans in `_spells/`, delegates task queue, tracks progress & blockers | `read`, `write`, `edit`, `grep`, `glob`, `bash` |
| **`planner`** | Merlin (`richard`) | Architect / Planner | `(*)` | Drafts `_spells/*.md`, invariant enforcement, upstream architecture | `read`, `grep`, `glob` |
| **`server-dev`** | Flamel (`dinesh`) | Server Developer | `</>` | Implements MCP tools, upstream clients, HTTP client core, shared schemas | `read`, `write`, `edit`, `bash`, `grep`, `glob` |
| **`web-dev`** | Nostradamus (`monica`) | Web Developer | `[UI]` | Implements React 19 inspector, dynamic Zod form generator, cost tracking | `read`, `write`, `edit`, `bash`, `grep`, `glob` |
| **`reviewer`** | Zoroaster (`gilfoyle`) | Reviewer / Security | `(o)` | Audits code, PRs, security (API keys), error taxonomy, schema strictness | `read`, `grep`, `bash` |
| **`qa`** | Cagliostro (`jian-yang`) | QA / Tester | `[~]` | Real-world testing, edge case coordinates, upstream rate limit stress tests | `read`, `bash` |
| **`costs-cleaner`** | Prospero (`russ`) | Quota & Costs Cleaner | `[$]` | Audits Geoapify credit consumption (1 credit / 20 places), token trimming | `read`, `grep` |
| **`founder`** | Midas (`peter-gregory`) | Founder | `[0]` | Stack interrogation, hotel enterprise constraints, architectural governance | `read`, `write`, `bash` |


### Cursor
Loads `AGENTS.md` as project rules on every Agent chat, and resolves the nearest `AGENTS.md` to whatever file is open — so a session working in `packages/web` picks up that package's file automatically. Reads `.claude/` paths directly. Cursor-specific rules in `.cursor/rules/*.mdc`. Full MCP support for `code-review-graph`.

### Claude Code
Reads `AGENTS.md` and `.claude/` natively, resolving nested `AGENTS.md` files the same way. Preferred for multi-file refactors and anything touching the registry or shared schemas, where the blast radius spans packages — in that case it will have read root plus every package file involved.

### OpenCode
Reads `AGENTS.md`. Has `code-review-graph` MCP. Use for PR review, QA passes and documentation — the read-heavy work. If working across multiple packages, confirm it picked up both the root file and the relevant package file rather than assuming nested resolution happened silently.

### Antigravity
Reads `AGENTS.md`, but nested-file resolution is less reliable than the other three. No MCP graph access either. Give it explicit paths to the relevant package `AGENTS.md` rather than expecting it to discover structure on its own. Best for long multi-step agentic tasks where the plan and file scope are already clear.

---


<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->

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

Use `query_graph`, `detect_changes` and `get_impact_radius` before large greps. Particularly relevant here: changes to `registry.ts` or `packages/shared` have cross-package blast radius that is not obvious from a single file view — this is exactly the situation the four-file split is meant to catch, so treat a flagged cross-package impact as a signal to also re-read the affected package's `AGENTS.md`.

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

#### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

#### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

#### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

---

## 🔍 Manual Review Pending

Work an agent produces is not submission-ready until David has checked the following by hand. This list exists so nothing gets assumed verified just because an agent reported success.

- **Rate limiting against the live API, not a mock.** Fire real parallel requests at Nominatim and confirm the limiter actually holds 1 req/sec end to end, not just in a unit test double.
- **Geoapify credit accounting matches the real dashboard.** Compare the app's own credit counter against Geoapify's account usage page after a test session, not just against the documented cost-per-request formula.
- **API key handling.** Confirm the key never appears in a committed file, a client-side bundle, a log line, or an error message returned to the inspector.
- **Every number in the README is real.** Token counts, credit costs, and latency figures must come from an actual measured run, not an estimate an agent wrote to fill the section.
- **License check on any newly added dependency.** Especially anything pulled in for the inspector — confirm it's MIT/Apache/ISC-equivalent before it ships in a submission with David's name on it. `react-json-view-lite` was added in DMS-504 and has not been licence-checked by hand.
- **Click through the inspector by hand, end to end.** DMS-504 verified live against a running HTTP server: page load and connection, `tools/list` populating the selector with server-side descriptions, nested form generation for `get_destination_brief`, client-side validation messages, and one successful `echo` call rendering its cost meter and history row. The browser-automation harness then stopped delivering synthetic click events (even a plain toggle button), so **the click-driven parts beyond that — the raw/rendered toggle, pinning two calls, the compare panel's token delta, and driving the fault panel from the UI — were verified by component tests and a scripted MCP client, not by a human clicking.** Those specific interactions still want a real pair of hands.
- **Read every AI-generated diff before commit.** The take-home brief explicitly requires the author to understand and validate generated code. This is not delegable to another agent — it's the one review step that has to be David, every time.
- **Final pass on `DECISIONS.md` and the README's decisions section for consistency.** They should tell the same story; agents draft both independently and drift is easy to miss.
- **Confirm the four AGENTS.md files haven't drifted from each other.** If root and a package file disagree on something that's stated in both, root wins and the package file needs fixing.

---

## Learned Facts

- 2026-09-05: The 8 agents in `.agents/agents/` were documented but never compiled to `.claude/agents/` — Claude Code could not actually spawn them via the `Agent` tool. Fixed by writing compiled `.claude/agents/<name>.md` frontmatter files for all 8. If a soul in `.agents/agents/` changes, regenerate its `.claude/agents/` counterpart in the same change.
- 2026-09-05: The 5 repo-specific skills (`new-mcp-tool`, `new-upstream-client`, `new-shared-schema`, `new-web-component`, `new-web-hook`) existed in `.agents/skills/` but their `.claude/skills/` counterparts were empty stub directories. Fixed by copying `SKILL.md` into each. Keep both directories in sync when either changes.
- 2026-09-05: `CLAUDE.md` and `hocus.md` were missing at repo root despite being part of the original harness scaffolding scope; both created.
- 2026-09-09: Ran `biome migrate --write` — the deprecated `linter.rules.recommended: true` (schema 2.5.12) is now `linter.rules.preset: "recommended"`. Also re-pinned `@biomejs/biome` from `^2.0.0` to exact `2.5.12` in root `package.json` (Biome's docs recommend exact pins so a minor bump can't silently change lint results with no repo diff); lockfile specifier updated to match. `biome check .` is now clean — no more `deserialize DEPRECATED` info.