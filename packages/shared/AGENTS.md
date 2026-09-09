# AGENTS.md — packages/shared

Read the [root AGENTS.md](../../AGENTS.md) first. This package is small on purpose: Zod schemas, domain types, and the error taxonomy. Nothing else belongs here.

This is the most sensitive package in the repo relative to its size. Both the server and the inspector import directly from it — a change here has cross-package blast radius by design (that's the point of the shared-schema architecture, per root Invariant 2), so treat edits here more carefully than the line count would suggest.

---

## Structure

```
packages/shared/src/
  schemas/              Zod input schemas, one per tool
  types/                 domain types: Location, Coordinates, CountryCode, TimeWindow, PoiCategory
  errors.ts              ToolErrorCode enum + discriminated union + per-code constructors
  toToolError.ts         zodErrorToToolError + toToolError (unknown-throw mapper)
  tokens/                estimateTokens — see the carve-out note below
  index.ts               barrel export — everything server and web import from
```

---

## Rules specific to this package

- **Nothing in here imports from `packages/server` or `packages/web`.** Dependency direction is one-way: shared → server, shared → web. If you find yourself importing a server type into `packages/shared`, the type belongs in `shared` in the first place — move it, don't import around the problem.
- **A schema change here is a change to two consumers, not one.** Before editing an existing schema, check what breaks in `packages/server` (validation) and `packages/web` (the generated form). If you can't see both call sites, ask before proceeding rather than guessing at the blast radius — this is exactly what `code-review-graph`'s `get_impact_radius` is for (see root AGENTS.md).
- **Never loosen a schema without being explicitly asked** — this is root Invariant 9, and it's worth restating here because this is the one package where it's most likely to happen accidentally: a bound that "seems too strict" during server-side testing is not license to widen it from this package.
- **Error codes are additive, not renamed.** If a new failure mode needs a code, add one to the `ToolError` union. Don't rename or repurpose an existing code — both consumers pattern-match on the literal string.
- **Every exported schema needs a domain type it validates into**, and the type name should read naturally in a tool response (`Location`, not `NominatimResult`). This package is the boundary where upstream vocabulary stops and domain vocabulary starts.
- **No business logic.** Density thresholds, classification rules, and cache TTLs are server concerns and belong in `packages/server/src/analysis` or `http/`, even though they're informed by types defined here.
- **No `.transform()` on input schema fields.** Transforms do not survive `zod-to-json-schema`, so the inspector form generator renders wrong defaults and types. Coerce or validate at the schema level instead.
- **`gpt-tokenizer` (`src/tokens/estimateTokens.ts`) is a deliberate, recorded exception to "schemas, domain types and the error taxonomy — nothing else"** (`DECISIONS.md`, 2026-09-09). It exists here because `packages/server` needs a tested shared utility and there's nowhere else that description is honest. It is exposed **only** via the `./tokens` subpath export (`@bearings/shared/tokens`) in `package.json` `exports` — never add it to the main barrel (`index.ts`) or import it from one. The tokenizer carries megabytes of rank data with module-level initialisation; `packages/web` imports the barrel, and the inspector reads the token count `packages/server` already computed rather than recomputing its own, so this must never reach that bundle. If a future change needs the estimator from `packages/web`, that's a new decision to raise, not a "helpful" move into the barrel.

---

## Format for a new schema

Keep the shape consistent so the web package's form generator has nothing unusual to special-case:

```ts
export const analyseNeighbourhoodInput = z.object({
  coordinates: coordinatesSchema,
  radiusM: z.number().int().min(100).max(5000).default(500),
  detail: z.enum(["brief", "full"]).default("brief"),
});
```

Bounded numbers, an explicit default, and `detail` on every tool schema. If a new schema can't follow this shape, that's worth a clarifying question before writing it (see root's "Before Starting a Plan").