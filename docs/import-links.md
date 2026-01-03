# Import Links

## What they are
`importLinks` are a best-effort co-import graph. For each file, PairOfCleats records the set of import specifiers it sees (language-specific). Each import specifier is then looked up in the repo-wide import map, producing a list of other files that import the same module. The flattened list of those files becomes `importLinks`.

## What they are not
- They do not resolve an import specifier to a canonical module path.
- They do not guarantee that the linked files *depend on* the current file.
- They do not attempt runtime or build-system resolution.

## How they are used
- `importLinks` is a lightweight related-files signal for search output and tooling.
- The links are computed during index build and are only as accurate as the static import collection.

## Format
`importLinks` is stored per file (in `file_relations.json`) as an array of repo-relative file paths. When present in search results, it is the same list projected onto the chunk's file.
