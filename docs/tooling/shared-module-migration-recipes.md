# Shared Module Migration Recipes

These recipes drive [shared-module-migration.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\testing\shared-module-migration.js).

## Current recipes

- `search-request-tools-to-src`
  - rewrites `tools/shared/search-request.js` imports to `src/shared/search-request.js`
- `dict-utils-tools-to-src`
  - rewrites `tools/shared/dict-utils.js` imports to `src/shared/dict-utils.js`

## Intended use

- dry-run the codemod first
- review the JSON or text summary
- use `--write` only after confirming the recipe targets are correct
- keep recipes narrow and exact-specifier based

## Non-goals

- broad AST transforms that attempt to infer semantics
- automatic rewriting of unrelated local helper usage without a stable shared destination
