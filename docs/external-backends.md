# External Backends (Prototype Notes)

This document captures an evaluation of external sparse/vector backends and
notes current integration status plus current backend-selection behavior.

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

Backend selection
- `--backend auto` (default) uses SQLite when indexes are available; falls back
  to LMDB if configured and SQLite is unavailable.
- Auto SQLite gating uses `search.sqliteAutoChunkThreshold` and
  `search.sqliteAutoArtifactBytes`; set either to `0` to disable that threshold.
- `--backend sqlite` / `sqlite-fts` require SQLite indexes; if missing, the
  search falls back to file-backed artifacts unless SQLite is forced.
- `--backend lmdb` requires LMDB indexes; if missing, the search falls back to
  file-backed artifacts unless LMDB is forced.
- `--backend memory` bypasses SQLite/LMDB and uses file-backed artifacts.
- Records-only mode always uses the file-backed records index, even when a
  backend is forced (a warning is emitted).

Recommendation
1. Prefer LanceDB for ANN-heavy workloads; keep SQLite vector extension as a
   fallback for small repos or environments without LanceDB.
2. Track Tantivy as the large-scale sparse option once Phase 26 lands.
3. For UI-heavy use cases, evaluate Meilisearch or Typesense as a parallel
   suggestion index while retaining PairOfCleats for code-aware search.
