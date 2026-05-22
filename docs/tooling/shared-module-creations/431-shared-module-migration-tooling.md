# Shared Module Creation: #431

- Issue: `#431`
- Title: `Shared-module migration tooling and codemod support`
- Created: `2026-03-26`

## What landed

- New migration tool: [shared-module-migration.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\testing\shared-module-migration.js)
- New recipe manifest: [shared-module-migration-recipes.json](C:\Users\sneak\Development\DOUBLECLEAT\docs\tooling\shared-module-migration-recipes.json)

## Why this approach is best

- The repeated seam in the current shared-module program is exact import-specifier replacement, not broad semantic AST rewriting.
- A manifest-driven codemod keeps the automation reviewable, dry-runnable, and easy to constrain to proven migration patterns.
- `--check` mode turned the same tooling into a validation helper for migration slices and remains reusable when a fresh roadmap/audit item reopens a concrete migration.

## Initial recipes

- `search-request-tools-to-src`
- `dict-utils-tools-to-src`

## What intentionally stayed manual

- argument-shape or call-site rewrites that need semantic review
- deletion of superseded local utilities
- migrations that do not yet have a single canonical shared destination
