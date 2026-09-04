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
    ToolSelector.tsx
    SchemaForm.tsx        generated from Zod, not hand-written per tool
    ResponsePanel.tsx      rendered / raw JSON toggle
    CostMeter.tsx           token + credit display
  lib/
    zodToForm.ts            zod-to-json-schema + field renderer
    tokenEstimate.ts        gpt-tokenizer wrapper, labelled approximate
  hooks/
    useToolCall.ts          @tanstack/react-query wrapper around the HTTP transport
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