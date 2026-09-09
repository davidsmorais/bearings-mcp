# AGENTS.md — packages/web

Read the [root AGENTS.md](../../AGENTS.md) first. This package is the React inspector: a development tool for calling Bearings' MCP tools over HTTP and reading structured results, not a product.

---

## What this package is not

Before writing anything here, the constraint that shapes every decision below: this is not a consumer app, and it should never start looking like one. The moment it reads as a travel product, a reviewer evaluates it as one and the MCP server becomes the sideshow. If a change makes this look nicer as a standalone app rather than clearer as a debugging tool, it's the wrong change.

---

## Structure

```
packages/web/src/
  components/
    ToolSelector.tsx        names + descriptions from the live tools/list
    SchemaForm.tsx          generated from Zod, not hand-written per tool
    ResponsePanel.tsx       rendered / raw JSON toggle, loading and error states
    RenderedResult.tsx      shape-dispatched renderer (see below)
    RawJsonPane.tsx         react-json-view-lite over the whole envelope
    DensityBar.tsx          a div with a width percentage
    CostMeter.tsx           token + credit + latency display
    CallHistory.tsx         every call this session, pin two to compare
    ComparePanel.tsx        two pinned calls side by side with a token delta
    FaultToggle.tsx         upstream failure simulation, hidden unless armed
  lib/
    zodToForm.ts            zod-to-json-schema + field descriptors
    callMetrics.ts          reads tokens/credits off the response envelope
    callHistory.tsx         session call log + running Geoapify total
    mcpClient.ts            memoised SDK Client over Streamable HTTP
  hooks/
    useToolList.ts          tools/list
    useToolCall.ts          @tanstack/react-query wrapper around the HTTP transport
    useFaultInjection.ts    /__dev/faults, absent when the server did not arm it
```

## Running it

`packages/web` imports `@bearings/shared` through its `exports` map, which points at `dist/`.
**Build shared before starting the dev server**, or module resolution fails with an error
that does not say so:

```bash
pnpm --filter @bearings/shared build
pnpm --filter @bearings/server build && node packages/server/dist/cli.js --transport http
pnpm --filter @bearings/web dev
```

---

## Rules specific to this package

- **No hand-written forms.** Inputs render from the tool's Zod schema — imported from `packages/shared`, per root Invariant 2 — via `zod-to-json-schema` and a thin renderer. Adding a tool to the server registry must surface its form here with zero UI changes. If you find yourself writing a `<ResolveDestinationForm>`, that's the signal to stop and go back to the generator instead.
- **Validate client-side with the literal schema the server uses**, not a hand-copied version of it. The user should see the exact error an agent would receive from the same input.
- **No charting library.** Density bars are `<div>`s with a width percentage. Three or six bars don't justify a dependency.
- **No component library.** Tailwind only, no shadcn or similar. A light custom layer keeps the surface count low and avoids the tool looking like a templated dashboard.
- **No animation library.** CSS transitions cover the toggle states. This is devtools chrome, not a product with delight budget.
- **Show cost, always.** Approximate token count and Geoapify credit spend render next to every call result, not tucked into a details panel. Label the token count as approximate in the UI copy — it's not Claude's actual tokenizer.
- **`@tanstack/react-query` owns request state.** Loading, error, and success states come from it. Don't hand-roll a second state machine on top.
- **Never tokenise in the browser.** Token counts are read from `_meta["bearings/tokens"]` on the response, parsed with the shared `TokenMetaSchema`. `gpt-tokenizer` carries megabytes of rank data and must never enter this bundle — that is why it lives behind the `@bearings/shared/tokens` subpath and not the main barrel. Reading the server's number also means the two can never disagree.
- **The rendered response view dispatches on shape, never on tool name.** `RenderedResult` `safeParse`s values against schemas that already exist in `packages/shared` (`DomainRatingSchema`, `SourceOutcomeSchema`, `NeighbourhoodCreditsSchema`) and falls back to a generic key/value tree. This is what keeps "adding a tool needs zero UI changes" true for output as well as input: an unrecognised response degrades to readable, not to blank. A file in `components/` named after a tool means this approach has been abandoned.
- **An optional field with no schema default starts absent, not blank.** Seeding `""` or the first enum member dispatches a value the user never chose, and for a bounded optional like `CountryCode` it makes the form permanently invalid until they fill a field the tool never required.

---

## Component conventions

- One component per file. **Never** nest component definitions inside another component.
- Functional components with hooks only.
- Arrow function syntax throughout.
- PascalCase for component names, camelCase for functions and hooks.
- Separate presentational components (`ResponsePanel`) from container/data components (`useToolCall`).
- Aliased imports; no `../` or `./` traversal.
- **Never** modify a `useEffect` dependency array to satisfy the exhaustive-deps lint rule. If the rule is complaining, the effect's actual dependencies are wrong — fix the effect, not the array.

---

## When adding a new tool's form

This is the test that the schema-driven architecture actually works. If any of these require touching `packages/web`, something upstream is wrong:

1. Tool gets added to the registry in `packages/server`.
2. Its Zod schema exists in `packages/shared`.
3. The form should now appear in the inspector with zero changes in this package.

If step 3 doesn't hold, the bug is in `zodToForm.ts` being incomplete for some Zod type, not a reason to hand-write an exception for that one tool.