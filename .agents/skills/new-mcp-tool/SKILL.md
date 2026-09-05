---
name: new-mcp-tool
description: Scaffold a new MCP tool in Bearings MCP, registering it in packages/server/src/registry.ts and implementing its handler in tools/.
---

# New MCP Tool

Scaffolds a new tool in `@bearings/server` following the architecture invariants.

## Rules & Invariants
- **Registry is the only place tools are defined** (Root Invariant 1): Transports (`stdio.ts`, `http.ts`) read from `packages/server/src/registry.ts`. Never register tools in transport files.
- **Transports contain no tool logic** (Root Invariant 5): Handlers belong in `packages/server/src/tools/<tool-name>.ts`.
- **Schemas come from shared** (Root Invariant 2): Use Zod schemas from `@bearings/shared`.
- **Errors are returned, never thrown as strings** (Root Invariant 4): Return `ToolError` union items.
- **Derived values carry evidence** (Root Invariant 6): Always include raw counts/radius along with ratings.
- **Detail toggle**: Every tool accepts `detail: "brief" | "full"`, defaulting to `"brief"`.

## Workflow
1. Ensure the input schema and response domain types exist in `packages/shared`.
2. Create `packages/server/src/tools/<tool_name>.ts` implementing the tool logic with error handling.
3. Register the tool in `packages/server/src/registry.ts` with description, input schema, and handler.
4. Add unit tests in `packages/server/test/tools/<tool_name>.test.ts` using committed fixtures.
5. Verify: `rtk vitest`, `rtk tsc`, `rtk lint`.
