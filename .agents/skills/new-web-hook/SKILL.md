---
name: new-web-hook
description: Scaffold a TanStack React Query hook in packages/web/src/hooks/ to interact with Bearings MCP Streamable HTTP transport.
---

# New Web Hook

Scaffolds a custom React hook in `@bearings/web/src/hooks/` powered by `@tanstack/react-query`.

## Rules & Invariants
- **TanStack Query owns request state** (Web AGENTS.md): `useQuery` / `useMutation` manages loading, error, and success states. Do not hand-roll secondary state machines.
- **Client-side validation with literal server schema**: Validate inputs with schemas from `@bearings/shared` prior to submission.
- **Cost tracking**: Track request payload and response token estimates and Geoapify credit consumption.
- **CamelCase naming**: Name hook file `use<Purpose>.ts` and export function `use<Purpose>`.

## Workflow
1. Create `packages/web/src/hooks/use<Purpose>.ts`.
2. Import tool schemas and types from `@bearings/shared`.
3. Wrap Streamable HTTP transport endpoint with `useMutation` or `useQuery`.
4. Surface typed errors, data payload, and timing/cost metadata.
5. Verify: `rtk tsc`, `rtk lint`.
