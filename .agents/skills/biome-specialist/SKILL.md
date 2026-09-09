---
name: biome-specialist
description: Diagnose and fix Biome (biome.json, CLI, formatter/linter/assist) configuration and troubleshooting issues — deprecated config fields, monorepo/nested config, VCS integration, CI wiring, rule suppression vs. fixing, and tool-wrapper interference that makes biome's own output lie. Use whenever `biome check`/`lint`/`format`/`ci` misbehaves, biome.json needs a field you're not sure of, a `--write` didn't change anything, or output and exit code disagree.
---

# Biome Specialist

This repo's linter, formatter, and import-organizer is Biome, invoked as `biome check` (root `pnpm lint` / `pnpm format` map to it — see `package.json` and root `AGENTS.md`'s Definition of Done). This skill is for **troubleshooting and configuring** Biome — not for routine day-to-day lint fixes, which is just running the tool and acting on its output.

Grounded 2026-09-09 against Biome's own docs (`biomejs.dev/guides/getting-started`, `/configure-biome`, `/reference/cli`, `/linter`, `/guides/integrate-in-vcs`) and against this repo's actual installed version (`npx biome --version` → **2.5.12**, matching `biome.json`'s `$schema`). Field names below are current as of that version; re-check `--version` before trusting anything here against a different install.

## When to use

- `biome.json` needs a new or changed field and you're not sure of the current schema
- `biome check` prints something confusing: a `deserialize DEPRECATED` block, an unexpected exit code, or `--write` that reports success but changes nothing on disk
- Setting up Biome in a new package, or deciding whether a monorepo package needs its own nested `biome.json`
- Wiring `biome ci` into a pipeline, or picking a `--reporter`
- **Biome's own output looks wrong** — clean-looking output with a non-zero exit code, or vice versa — before concluding Biome is buggy, suspect something between you and it (see step 2)
- Migrating from ESLint/Prettier, or catching a `biome.json` up after a version bump
- Someone asks to relax, suppress, or widen a lint/format rule

## Instructions

### 1. Confirm the actual installed version before touching config

```bash
npx biome --version
```

Compare that to the `$schema` URL at the top of `biome.json` and to the version range in `package.json`'s `devDependencies`. Biome config is versioned by that schema URL — don't trust a memorized field name against a version you haven't confirmed.

**This repo, as of 2026-09-09:** resolved version is `2.5.12`, `biome.json`'s `$schema` correctly points at `2.5.12`, but root `package.json` pins only `"@biomejs/biome": "^2.0.0"` — a floating range. Biome's own install docs recommend the exact-pin flag (`-E`) specifically because a minor bump can add new deprecations or default-on rules mid-project, silently changing what `pnpm lint` reports between two `pnpm install`s with no diff in this repo's own files. Flag this if asked to touch dependency versions here; it hasn't been fixed as of this writing.

### 2. Run Biome unfiltered before editing any config, and read the exit code explicitly

```bash
npx biome check . ; echo "EXIT=$?"
```

**Known local footgun, confirmed in this exact repo (2026-09-09):** the Claude Code RTK `PreToolUse` hook silently rewrites any `biome …` invocation — and the ambiguous `pnpm lint` package script — onto `rtk lint`, which is hardcoded as an **ESLint** wrapper, not a Biome one. Symptoms: `Lint: No issues found` printed while the process exits `1` and real errors are hidden, or `--write` reporting success while changing nothing on disk (because `rtk lint` shelled out to `eslint`, found it missing, and never touched Biome at all).

If output and exit code disagree, or a `--write` didn't touch the file it should have — **suspect a command rewrite before suspecting Biome.**

- Audit what a command will actually become, without running it: `rtk hook check "<command>"`.
- The fix (already applied in this repo) lives in `~/.config/rtk/config.toml`'s `[hooks] exclude_commands`. Matching is prefix-based, so each invocation shape needs its own entry: `biome`, `npx biome`, `pnpm exec biome`, `pnpm biome`, `pnpm dlx biome`, `bunx biome`, plus the ambiguous script forms `pnpm lint`, `pnpm run lint`, `npm run lint`, `yarn lint` (rtk can't tell whether a `lint` script is eslint or biome, so all of them are excluded from rewriting here).
- Full incident writeup: this session's `MEMORY.md` entry "RTK hook filters lint output" and the personal-memory note `rtk-hook-filters-lint-output.md`.
- This class of bug generalizes past RTK: any shell wrapper, Husky pre-commit script, or CI step that pipes Biome through something else (`| tee`, a summarizer, a "compact output" wrapper) can produce the same disagreement. The tell is always the same — exit code and printed text don't match reality.

### 3. Reading `biome check` output correctly

- `Checked N files in Xms` + `Found 0 errors` (possibly with some `Found N infos`) = clean, exit `0`.
- A violation block names `file:line:col`, the rule id (`lint/<group>/<ruleName>`, or `format` for a formatting diff), a severity glyph, and — for a format finding — the exact diff `--write` would produce.
- A `biome.json:L:C deserialize DEPRECATED` block is about **the config file itself**, not your source. Prefer `biome migrate` over hand-editing (step 5) — Biome computes the exact field rewrite; guessing the new shape risks getting it subtly wrong.
- `biome explain <rule-name>` prints that rule's documentation and rationale. Run it before deciding whether to fix or suppress a finding — don't guess what a rule is for from its name alone.

### 4. Fixing vs. suppressing a finding

- **Formatting diffs**: `biome check --write .` (or a scoped path) — always safe to apply.
- **Lint errors Biome marks as a safe fix**: `--write` applies them.
- **Lint errors that need `--unsafe`**: read the diff Biome shows first. An unsafe fix can change behavior, not just style — it's not "format but for logic," it's a judgment call the tool is flagging as risky.
- **Suppressing one finding in place**: `// biome-ignore lint/<group>/<rule>: <reason>` directly above the offending line, always with a reason — this repo already does this (see `packages/web/src/components/RenderedResult.tsx`'s `biome-ignore lint/suspicious/noArrayIndexKey: static, never-reordered list`). Match that style rather than inventing a new suppression comment format.
- **Changing severity or scope repo-wide**: edit `linter.rules.<group>.<rule>` (or the whole group) in `biome.json`. Values are `"off" | "on" | "warn" | "error"` (`"warn"` doesn't fail the run unless `--error-on-warnings` is passed).
- **Never loosen a rule to make a run go green without asking first.** This repo's root `AGENTS.md` (Architecture Invariant 9) already forbids loosening a *schema* without being asked; the same reasoning applies one layer up — a lint rule that got quietly easier to satisfy is a regression even when the diff looks clean. Widening `linter.rules` is a decision to surface, not a workaround to apply silently.

### 5. `biome.json` structure (schema 2.x)

- Top level: `$schema`, `vcs`, `files`, `formatter`, `linter`, `assist`, plus per-language overrides (`javascript`, `json`, `css`, …). `formatter`, `linter`, and `assist` each toggle independently via `.enabled`.
- `vcs.enabled: true` + `vcs.clientKind: "git"` + `vcs.useIgnoreFile: true` (this repo's setting) makes Biome respect `.gitignore` and Git's local exclude file (`.git/info/exclude`) — for a linked worktree, it reads that file from the **common** git directory, matching Git's own behavior — without duplicating ignore patterns into `files.includes`.
- `files.includes` is a glob array. A `!pattern` entry excludes; `!!pattern` excludes from indexing entirely (stronger than a lint/format exclude). A `<tool>.includes` (e.g. `linter.includes`) narrows further per-tool but cannot re-include something `files.includes` already dropped.
- Language-specific config (e.g. `javascript.formatter.quoteStyle`) overrides the top-level `formatter`/`linter` block **for that language only**. General settings go at the top level; per-language overrides nest under `<language>.<tool>`. Biome treats every JS variant — TS, JSX, TSX included — as `"javascript"` for this purpose.
- **Monorepos**: Biome supports nested `biome.json` files per subdirectory, letting a package override the root config. Before adding one, check whether the repo already centralizes config on purpose — this one does: a single root `biome.json` covers all of `packages/*`, and root `AGENTS.md` treats a package-level config drift as something to reconcile, not something to add casually.
- **The `linter.rules.recommended` deprecation** — confirmed live against this repo's `biome.json` at schema `2.5.12`: `biome check` emits a `deserialize DEPRECATED` warning naming `recommended` and pointing at a replacement field, with a note that hand-editing is unnecessary — run the migration instead:
  ```bash
  npx biome migrate --write
  npx biome check .   # confirm the warning is gone
  ```
  This repo has not run that migration as of 2026-09-09 (root `AGENTS.md` Manual Review Pending doesn't yet list it — worth adding if you're the one who fixes it). Don't hand-guess the replacement field's exact shape from memory or from docs that may lag a specific patch version; let `biome migrate` compute it and diff the result before committing.

### 6. CLI command cheatsheet

| Command | Does | Notes |
|---|---|---|
| `biome check [--write] [--unsafe] [path...]` | format + lint + import organization (assist) | What this repo's `pnpm lint` maps to |
| `biome lint [--write] [path...]` | lint only | |
| `biome format [--write] [path...]` | format only | |
| `biome ci [path...]` | `check`, tuned for pipelines | No `--staged` (CI has no staging area); prefer this over `check` in a pipeline so failures read cleanly in CI logs |
| `biome init` | scaffolds a starter `biome.json` | Don't re-run blind against an existing config — check the diff |
| `biome migrate [--write]` | previews (default) or applies config rewrites for deprecations | Run whenever `check` prints a `deserialize DEPRECATED` block |
| `biome migrate prettier` / `biome migrate eslint` | one-time import of an existing config into `biome.json` | Review the result; don't trust it blind |
| `biome explain <rule>` | prints a rule's documentation | Use before fixing vs. suppressing |

Useful flags across the file-processing commands:

- `--only=<rule|group|domain>` / `--skip=<...>` — scope a run to specific rules
- `--changed` (needs `vcs.defaultBranch` set) — only touch files that differ from the default branch. Biome determines "changed" from the diff, not semantics: a whitespace-only edit counts, and a file that only *imports* a changed file does not get re-checked automatically
- `--staged` — process staged files only (available on `check`/`lint`/`format`; not on `ci`, since commits aren't expected mid-pipeline)
- `--reporter=default|json|github|gitlab|junit|sarif|…` — machine- or CI-host-readable output
- `--error-on-warnings` — makes `"warn"`-level rule violations fail the run (default: only `"error"` does)

### 7. Installing / bootstrapping Biome in a new package

```bash
pnpm add -D -E @biomejs/biome   # -E pins exact — Biome's own docs recommend this
npx @biomejs/biome init          # or: pnpm exec biome init
```

Then trim the scaffolded config to match the surrounding monorepo's conventions rather than accepting Biome's defaults wholesale. This repo's baseline (`biome.json` at the root): double-quoted strings, semicolons required, 100-column line width, `assist.actions.source.organizeImports: "on"`.

### 8. Editor / CI integration

- First-party editor extensions exist for VS Code, IntelliJ, and Zed; community extensions cover Vim/Neovim/Sublime. Point a user there rather than hand-rolling a save-on-format script.
- In CI, run `biome ci .`, not `biome check .`. If the pipeline should annotate a PR directly, pass the reporter matching the CI host (e.g. `--reporter=github`).

## Related

- Root `AGENTS.md` — Definition of Done (`pnpm lint`), Architecture Invariant 9 (never loosen a schema/rule without being asked)
- `atomic-commits` skill — commit message format if a Biome config change needs its own commit (`🧹chore(<scope>): …` for lint/format-only changes, per that skill's type table)
- `MEMORY.md` — "RTK hook filters lint output" entry (2026-09-09) for the full incident this skill's step 2 is built from
