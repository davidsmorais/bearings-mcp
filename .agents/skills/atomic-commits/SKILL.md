---
name: atomic-commits
description: Enforce one logical change per commit with emoji-prefixed conventional commit messages.
---

# Atomic Commits

Ensures every commit represents exactly one logical change, following conventional commit format. Prevents "WIP", "fix stuff", and 50-file mega-commits that are impossible to review or revert.

## When to use
- Before committing: review the diff for atomicity
- When reviewing a PR: check that individual commits are atomic
- When splitting a large PR: reorganize into logical atomic commits
- After a messy development session: rebase and restructure into clean commits
- When setting up a project: establish the commit convention in CONTRIBUTING.md

## Instructions
1. **Define "one logical change"**
   - A single bug fix (with its tests)
   - A single feature (complete but minimal)
   - A single refactor (no behavior change)
   - A single dependency update (with rationale)
   - A single doc improvement
   - NOT: "fix bugs and add feature and update deps" — that's three commits
   - NOT: "refactor utils.ts" if it also touches 10 unrelated files — scope it

2. **Use conventional commit format with emoji prefix**
   ```
   <emoji><type>(<scope>): <imperative summary>

   <optional body with motivation and rationale>

   <optional footer with breaking changes or issue references>
   ```
   - Every commit message starts with the emoji for its type, immediately followed by the type name (no space between emoji and type)
   - Types and emoji prefixes:

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
   | `🧹chore` | Lint, logs, TS errors, style-only changes |
   | `revert` | Reverts a prior commit — no emoji; use `revert(<scope>): <summary>` |

   - Scope: the module or package (optional but encouraged). Bearings scopes: `server`, `web`, `shared`, `upstream`, `analysis`
   - Summary: imperative mood, lowercase, no trailing period, max 72 chars including emoji and type
   - Body: wrap at 72 chars, explain *why* not just *what*
   - Breaking changes: add `BREAKING CHANGE:` in the footer
   - Issue references: `Fixes #123`, `Closes ENG-456`

   Examples:
   - `✨feat(server): add resolve_destination tool`
   - `🐛fix(web): keep SchemaForm state updater pure`
   - `🔮refactor(shared): extract CountryCodeSchema`

3. **Split a messy working state**
   - `git diff --stat` to see which files are changed
   - Group changed files by concern:
     - Files touched for bug A → commit 1
     - Files touched for feature B → commit 2
     - Files touched for refactor C → commit 3
   - Use `git add -p` to stage hunks selectively within files if needed
   - Use `git stash` to temporarily set aside unrelated changes
   - Do NOT split a change that would break tests or leave the code in a non-compiling state

4. **Write the commit message**
   - Summarize in under 72 characters
   - In the body, describe what and why. The diff shows how.
   - For brevity: "Add password hashing to User model. Uses bcrypt with cost factor 12. Fixes #89."

5. **Verify atomicity before pushing**
   - Each commit compiles and passes tests independently (or at minimum doesn't introduce errors that didn't exist)
   - Each commit has a coherent, complete message
   - No commit contains both a feature and a fix — those are separate concerns
   - No commit contains both a change and its revert in the same set
   - The commit history tells a readable story when viewed with `git log --oneline`

6. **Fix non-atomic history**
   - Use `git rebase -i` to squash, split, or reorder commits before pushing
   - Use `git reset` and re-commit with finer granularity for unpushed work
   - Do NOT rewrite published history unless the branch is a feature branch with no other contributors
   - If reviewing a PR with non-atomic commits, request the author to restructure
