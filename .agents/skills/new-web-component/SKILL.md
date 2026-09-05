---
name: new-web-component
description: Scaffold a new React 19 functional component in packages/web/src/components/ adhering to Tailwind-only styling and inspector constraints.
---

# New Web Component

Scaffolds a React 19 component in `@bearings/web`.

## Rules & Invariants
- **Dev Inspector, Not Consumer Product** (Web AGENTS.md): The inspector is a development tool for calling Bearings MCP tools and inspecting structured responses. Avoid consumer product fluff.
- **No Charting Libraries**: Density bars are simple `<div>` elements with width percentages.
- **No Component Libraries**: Tailwind CSS only — no shadcn, radix, or heavy UI frameworks.
- **No Animation Libraries**: Standard CSS transitions only.
- **Component Architecture**:
  - One component per file. Never nest component declarations.
  - Functional components with hooks only.
  - Arrow function syntax throughout (`export const Component = () => { ... }`).
  - PascalCase for component filenames and exports.
  - Aliased imports; no traversal (`../`).
  - Strict `useEffect` integrity: never fake dependency arrays.

## Workflow
1. Create `packages/web/src/components/<ComponentName>.tsx`.
2. Implement using typed props and clean Tailwind utilities.
3. Keep presentation components separated from data/query hooks.
4. Verify: `rtk tsc`, `rtk lint`.
