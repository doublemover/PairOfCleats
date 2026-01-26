# Retrieval ranking and explain contract

## Ranking modes
- Sparse ranking uses BM25 over token/posting artifacts.
- Dense ranking uses ANN when available (HNSW or sqlite extension).
- When both sparse and ANN are active, results combine via RRF or blend.

## Explainability
- `scoreType` is one of `bm25`, `bm25-fielded`, `fts`, `ann`, `rrf`, `blend`, `context`, or `none`.
- `scoreBreakdown` includes `selected`, plus the component blocks used (`sparse`, `ann`, `rrf`, `blend`, `symbol`, `phrase`).
- `--explain` and `--why` must render identical content.

## Context expansion
- Context expansion is computed after initial ranking and appends `scoreType=context` hits.
- Defaults: `maxPerHit=4`, `maxTotal=40`, `includeCalls=true`, `includeImports=true`, `includeExports=false`, `includeUsages=false`.
- Call expansion: for each `codeRelations.calls` entry, resolve by symbol name first (chunk `name`), and fall back to `repoMap` name→file if no chunk matches.
- Import expansion: uses `fileRelations.importLinks` to pull all chunks from imported files.
- Usage/Export expansion: resolve names via the chunk `name` index (`fileRelations.usages` / `fileRelations.exports`).
- Same-file and cross-file hits are allowed; de-dup prevents adding the same chunk twice or re-adding primary hits.
- When `contextExpansionRespectFilters` is true, expansion only includes chunks passing the active filters.

## References
- `docs/contracts/search-contract.md`
- `docs/benchmarks/overview.md`

