# External Backends (Prototype Notes)

This document captures an evaluation of external sparse/vector backends and
notes current integration status.

Sparse backends
- SQLite FTS5: supported today and the default for most repos.
- Tantivy (Rust, Lucene-like): planned (Phase 26). No integration shipped yet.

Vector backends
- LanceDB: implemented for local ANN search (optional dependency). Artifacts
  live alongside `dense_vectors*` in each index directory and are selected via
  `search.annBackend` + `indexing.embeddings.lancedb`.
- SQLite-based ANN: supported via the vector extension and/or dense vectors.

Search UI backends
- Meilisearch: simple API, great for autocomplete and UI suggestions.
- Typesense: similar to Meilisearch, stronger schema controls.

Recommendation
1. Prefer LanceDB for ANN-heavy workloads; keep SQLite vector extension as a
   fallback for small repos or environments without LanceDB.
2. Track Tantivy as the large-scale sparse option once Phase 26 lands.
3. For UI-heavy use cases, evaluate Meilisearch or Typesense as a parallel
   suggestion index while retaining PairOfCleats for code-aware search.
