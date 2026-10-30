# Canonical JSX/TSX syntax ownership — 2026-10-27

**Unvalidated source:** `765026a3550eb4eebd9f141c1dc235997e5dedfe`, tree
`2c375802da30690c865396bd195ee79b0158663b`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Local implementation checkpoint; not pushed or functionally qualified.

#1650's old projection found JSX intervals, removed them from the JS/TS program,
and reparsed the remaining gaps. Source inspection proves the resulting slices
cannot contain an enclosing declaration that crosses a removed interval. The
private range collector/merger served only that superseded partition in
`segmentJsx`; its sole production caller is discovery. They are removed with the
partition. The module's exported entry point remains.

Discovery now retains one complete canonical program, including expression
islands, callbacks and markup. Its original chunk/AST preparation is retained
and the actual `.jsx`/`.tsx` extension survives both chunk dispatch and VFS
routing. Canonical component files bypass CDC segmentation; existing chunk-size
limits still apply. Independently sliced extra/comment/fence views retain their
cache isolation and strict range checks. No AST copies or per-element parse walk
are introduced, and the unused discovery-time Babel import disappears.

The original determinism fixture still checks stable IDs, valid ordered ranges
and the positive TypeScript source view; its stale HTML-partition requirement is
replaced by an exact complete-program assertion. Twelve new **unexecuted**
`indexing/segments/jsx-syntax-ownership/*` cases cover function/arrow components,
fragments, callbacks, map children, Unicode/CRLF, typed/generic TSX, one prepared
parser owner, markup insertion/removal, independent extra cache isolation and
malformed coarse fallback. They exercise actual declaration projection and VFS
targets, asserting the named complete component, exact expression offsets,
source-qualified evaluation ownership and original target slices/dialects. The
separate extra case retains the cache-isolation obligation formerly reached by
JSX gaps. The existing VFS regression retains all target/range assertions.

The [contract](../contracts/jsx-syntax-ownership.md) reserves optional overlapping
markup views for a separately admitted occurrence/deduplication policy. None is
currently emitted, and JSX is not presented as equivalent HTML. Existing
whole-file immutable semantic collection remains an independent producer; this
repair does not claim it previously lost every fact. Source chunking,
normalization and VFS routing advance to 38/15/7; compiler/LSP bindings to 28/55.

Static format/ESLint, changed JavaScript syntax, config budget, command inventory
generation and whitespace checks pass. Shared-module analysis finds zero cycles.
Generated configuration inventory was refreshed. No functional fixture, native
parser/server/index, benchmark or publication front gate ran. Actual component,
fence/extra/VFS/metadata/replay/detail consumers and original/follow-up acceptance
remain to execute on the resulting candidate; #1650 remains open.
