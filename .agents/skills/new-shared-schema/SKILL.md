---
name: new-shared-schema
description: Scaffold a new Zod schema and domain types in packages/shared/src/ adhering to strict bounds, barrel exports, and cross-package impact rules.
---

# New Shared Schema

Scaffolds a new Zod schema and domain types in `@bearings/shared`.

## Rules & Invariants
- **Single Source of Truth** (Root Invariant 2): Schemas live only in `packages/shared` and are imported by both `packages/server` and `packages/web`.
- **Never loosen a schema** (Root Invariant 9): Widening bounds or relaxing constraints requires explicit instruction.
- **Explicit bounds & defaults**: Every schema defining cost/time parameters (e.g. `radiusM`, `limit`) must have bounded numbers (`min`, `max`) and explicit defaults.
- **Detail toggle**: Tool input schemas must include `detail: z.enum(["brief", "full"]).default("brief")`.
- **No business logic in shared**: Thresholds and analysis belong in `packages/server/src/analysis/`.
- **Direction of dependencies**: `packages/shared` imports nothing from `server` or `web`.

## Workflow
1. Create `packages/shared/src/schemas/<tool-name>.ts`.
2. Define the Zod schema and infer the TypeScript type.
3. Export domain types from `packages/shared/src/types/<type-name>.ts` if applicable.
4. Export through `packages/shared/src/index.ts`.
5. Check blast radius with `get_impact_radius` before and after modifying.
6. Verify: `rtk tsc`, `rtk vitest`, `rtk lint`.
