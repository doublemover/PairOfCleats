# External Backends (Prototype Notes)

This document captures an evaluation of external sparse/vector backends and
notes current integration status.

Sparse backends
- Tantivy (Rust, Lucene-like): excellent performance and index size, but
  requires a Rust service or CLI integration.
- SQLite FTS5: already supported, fast to iterate, good default for most repos.

Vector backends
- LanceDB: supported for local ANN search. Artifacts live alongside
  `dense_vectors*` in each index directory and are selected via
  `search.annBackend` + `indexing.embeddings.lancedb`.
- SQLite-based ANN: supported via the vector extension and/or dense vectors.

Search UI backends
- Meilisearch: simple API, great for autocomplete and UI suggestions.
- Typesense: similar to Meilisearch, stronger schema controls.

Recommendation
1. Prefer LanceDB for ANN-heavy workloads; keep SQLite vector extension as a
   fallback for small repos or environments without LanceDB.
2. Add a Rust-based service (Tantivy) for large-scale deployments.
3. For UI-heavy use cases, evaluate Meilisearch or Typesense as a parallel
   suggestion index while retaining PairOfCleats for code-aware search.
