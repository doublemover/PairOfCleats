# Import Links

## What they are
`importLinks` represent **true dependency edges**: importer → resolved in-repo target. Raw specifiers are resolved to repo-local file paths (relative specifiers and TS path aliases) and only internal targets become `importLinks`.

See `docs/specs/import-resolution.md` for the Import Resolution Graph (IRG) contract and resolution rules.

## What they are not
- They do not include external package edges (those remain as raw specifiers).
- They do not attempt runtime evaluation of dynamic imports beyond literal cases.

## How they are used
- `importLinks` is a lightweight related-files signal for search output and tooling.
- The links are computed during index build and reflect static resolution rules from the IRG.

## Format
`importLinks` is stored per file (in `file_relations.json`) as an array of repo-relative file paths. When present in search results, it is the same list projected onto the chunk's file.


