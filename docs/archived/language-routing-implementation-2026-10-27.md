# Lightweight language routing — 2026-10-27

Source `7394e4ba1d6fb6f258350d695609bf2ede8886a8`, tree
`33ba879f42e3d5da2dfa679984f873a5b9dcda5e`, branch
`codex/pr557-audit-repairs-20261012`. Functional execution deferred.

The registry previously constructed extension/filename/prefix routing from full
adapter objects. Metadata-only callers therefore imported parser implementation
families merely to read an ID. One lightweight chooser now reuses the canonical
immutable descriptors and Linguist mapping. It preserves exact filename →
extension → prefix → Linguist filename → Linguist extension precedence, ordered
ownership and normalization. Real adapter lookup delegates to that same chooser
with its actual supported IDs and still returns the existing concrete adapter.

Eleven reviewed ID-only consumers now import metadata directly: discovery, watch
classification, preprocessing, sharding, scheduler shadow, Tree-sitter discovery/
runtime hints, file-analysis hints, metrics and token routing. Their immediate
import does not construct adapters. Prepared parser methods/fallback behavior
are untouched; metadata has no adapter methods, Promise or readiness claim.
Private routing maps retain only bounded static metadata, never source/AST state.

Four `indexing/language-registry/metadata-import-boundary/*` cases are authored,
**unexecuted**. They register their guard before any repository import and cover
canonical extension and special-file precedence, filtered availability, unknown
routes and immutable warm identity. The existing descriptor/actual-adapter parity
fixture checks both inventories and retains its concrete assertions. Static
format/ESLint, syntax, config budget, generated inventory and whitespace checks
passed; shared module analysis found zero cycles.

No actual loaded-module count, initialization, CPU/heap/RSS or latency result is
claimed. Complete consumer checks remain required. #1607 remains open for selected
family loading, independent prose dispatch and worker initialization/measurement;
the full operation registry is still eager when imported. See the
[routing contract](../contracts/language-routing-metadata.md). The earlier
[comment-only leaf extraction](comment-pipeline-implementation-2026-10-27.md)
remains a separate scoped repair.
