# Import Links

## What they are

Import collection advances block-comment state before directive prechecks,
including nested Dart/Scala/Nix comments and multiline Razor comments. A trailing
slash is a directory hint even when the directory name contains a dot. Unknown
reason strings always receive the complete unknown decision; object-prototype
names are not registry entries.

TypeScript configuration is parsed by TypeScript's existing config owner, with
ordered multi-base inheritance and paths resolved relative to their defining
configuration. The winning exact/most-specific paths key owns all of its ordered
replacement attempts. A missing winner does not select a weaker key.
Package `#imports` retain their leading hash and resolve in the nearest package
scope. External package targets remain external. Resolver cache admission binds
consulted package manifests by content, including absent ancestor manifests;
lookup snapshots record the filesystem case policy. Linked prefixes omitted
from an existence scan remain unknown and require bounded fallback probes.
Fixture location alone does not suppress a missing source-module dependency.
`importLinks` represent **true dependency edges**: importer → resolved in-repo target. Raw specifiers are resolved to repo-local file paths (relative specifiers and TS path aliases) and only internal targets become `importLinks`.

See `docs/contracts/artifact-schemas.md` for the Import Resolution Graph (IRG)
artifact contract and `docs/archived/import-resolution.md` for historical
Phase 3 resolution-rule context.

## What they are not
- They do not include external package edges (those remain as raw specifiers).
- They do not attempt runtime evaluation of dynamic imports beyond literal cases.

## How they are used
- `importLinks` is a lightweight related-files signal for search output and tooling.
- The links are computed during index build and reflect static resolution rules from the IRG.

## TypeScript runtime extensions
Source imports may name an emitted JavaScript file, such as `./config.js`
when the indexed file is `config.ts`. The shared resolver tries the literal
indexed file first, then these source counterparts in order:

- `.js`: `.ts`, `.tsx`, `.d.ts`
- `.jsx`: `.tsx`, `.ts`, `.d.ts`
- `.mjs`: `.mts`, `.d.mts`
- `.cjs`: `.cts`, `.d.cts`

This also applies to TS path aliases and cross-file call-link resolution.
Explicit runtime extensions do not expand into `index.*` directory candidates
or cross module formats (for example, `.mjs` does not fall back to `.ts`).
Indexed matches do not consume filesystem-probe budgets. If no indexed match
exists, the existing bounded filesystem fallback uses the same candidates;
an existing non-indexed target remains an external import rather than an
internal dependency edge. Incomplete existence indexes retain filesystem
fallback, and genuinely missing targets retain unresolved diagnostics.

## Format
`importLinks` is stored per file (in `file_relations.json`) as an array of repo-relative file paths. When present in search results, it is the same list projected onto the chunk's file.


