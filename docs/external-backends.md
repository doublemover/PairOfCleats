# External Backends (Prototype Notes)

This document captures an initial evaluation of external sparse/vector
backends. These are not integrated yet; the notes are meant to guide future
experiments and adopters.

Sparse backends
- Tantivy (Rust, Lucene-like): excellent performance and index size, but
  requires a Rust service or CLI integration.
- SQLite FTS5: already supported, fast to iterate, good default for most repos.

Vector backends
- LanceDB: good for vector search with local storage, Python-first but has
  Rust/JavaScript bindings. Suitable for a standalone ANN service.
- SQLite-based ANN: good for local/offline workflows, but large repos may need
  more tuning or server-backed vector stores.

Search UI backends
- Meilisearch: simple API, great for autocomplete and UI suggestions.
- Typesense: similar to Meilisearch, stronger schema controls.

Recommendation
1. Keep SQLite FTS5 + local ANN as the default for local and medium repos.
2. Add a Rust-based service (Tantivy) for large-scale deployments.
3. For UI-heavy use cases, evaluate Meilisearch or Typesense as a parallel
   suggestion index while retaining PairOfCleats for code-aware search.
