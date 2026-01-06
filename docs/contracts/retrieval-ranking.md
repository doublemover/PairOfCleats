# Retrieval ranking and explain contract

## Ranking modes
- Sparse ranking uses BM25 over token/posting artifacts.
- Dense ranking uses ANN when available (HNSW or sqlite extension).
- When both sparse and ANN are active, results combine via RRF or blend.

## Explainability
- `scoreType` is one of `bm25`, `bm25-fielded`, `fts`, `ann`, `rrf`, `blend`, `context`, or `none`.
- `scoreBreakdown` includes `selected`, plus the component blocks used (`sparse`, `ann`, `rrf`, `blend`, `symbol`, `phrase`).
- `--explain` and `--why` must render identical content.

## References
- `docs/search-contract.md`
- `docs/benchmarks.md`
