# Dependency ownership

The manifest and lockfile describe installation; a dependency reference sheet is
not evidence that application code consumes a package. The curated
[ownership inventory](../tooling/dependency-ownership.json) records five audited
retirements and the dynamic/native/CLI/peer exceptions that must remain.

On 2026-10-27, the five retired roots each had only the root manifest as an
incoming lockfile declaration. Tracked source, configuration, editor/CI tooling
and fixtures contained no consumer of ast-grep NAPI, SWC, the MDX compiler or
bundled ripgrep. Review also followed the actual dynamic/native/command owners:

- Structural search uses a separately identified managed/external ast-grep CLI.
  Its NAPI package has no executable export and is not that command owner.
- JavaScript parsing selects Babel, Acorn and Esprima. MDX source follows the
  Markdown chunking route; no MDX compiler or SWC adapter is selected.
- Dictionary discovery invokes PATH `rg --files` and falls back to a filesystem
  walk. It has no `rgPath` consumer and makes no bundled-ripgrep fallback promise.
- The native Lua registry and its derived bootstrap list select
  `@tree-sitter-grammars/tree-sitter-lua`. Existing `tree-sitter-lua` route/caps
  strings identify a language route, not the retired unscoped npm package.

The five direct declarations and three stale Lua/SWC/ripgrep install permissions
were removed. npm regenerated the lockfile offline without running install
scripts: 110 package records disappeared, and every retained package kept its
version, resolved source and integrity. These are graph changes, not measured
install/startup speedups or a complete dependency-health qualification.

Arrow remains an explicit peer provision for LanceDB. Esquery's real
jsdoccomment/ESLint consumers remain. NAN remains for optional RE2; removal of the
obsolete Lua edge does not justify deleting it. No supported parser/CLI route,
test or shared transitive dependency was removed to obtain a passing check.

The [inventory regression](../../tests/tooling/install/dependency-ownership-inventory.test.js)
checks actual manifest/lock/native-registry ownership, stale permissions and
these retained edges. It does not infer obsolescence from a string search. New
retirements require the same consumer/loader/CLI/peer audit. Native activation,
Lua chunking/relations, parser/MDX, structural CLI, dictionary PATH/fallback and
LanceDB acceptance belong to bootstrap and their existing focused owners.

The January 2026 dependency bundle and coverage totals are historical research
snapshots, including suggested integrations that were never production consumers.
They remain for their provenance; use current owners and
[dependency security](dependency-security.md) for setup and maintenance.
