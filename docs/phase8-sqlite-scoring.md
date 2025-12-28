# Phase 8: SQLite-Only Scoring (FTS5)

## Goal
Provide a fully SQLite-driven sparse ranking path using FTS5 `bm25()`, while keeping the same renderer and optional ANN re-rank in JS.

## Usage
- CLI: `node search.js --backend sqlite-fts "query"`
- Config: `sqlite.scoreMode = "fts"` to default to FTS ranking when SQLite is available.
- Parity check: `npm run parity -- --sqlite-backend sqlite-fts`
 - Optional tuning: `search.sqliteFtsProfile` (`balanced`, `headline`, `name`) or `search.sqliteFtsWeights`.

## Query Path
- Query tokens are derived from the same tokenizer used by the JS ranker.
- FTS5 returns `rowid` + `bm25()` score; we invert the score so larger is better.
- Results are mapped back to chunk metadata using the mode-specific ID offset.

## Tradeoffs
- FTS5 is fast and self-contained but is less configurable than the custom BM25 path.
- Scores will not be numerically identical to the JS BM25 scoring.
- ANN re-rank still happens in JS when enabled.
- Treat FTS5 as experimental until parity improves on larger codebases.

## Optional normalization
Set `search.sqliteFtsNormalize` to true to scale FTS5 scores into a 0..1 range before weighting. This makes sqlite-fts scores easier to compare in parity reports, but it changes absolute score magnitudes.

## SQLite ANN extension (optional)
- Supports loadable SQLite vector extensions (ex: sqlite-vec) for ANN queries.
- Enable with `sqlite.annMode = "extension"` and rebuild the SQLite indexes.
- Falls back to the JS ANN path if the extension or vector table is missing.

## Future Work
- Evaluate SQLite ANN extension parity on larger benchmarks.
- Compare FTS5 ranking vs BM25 on a larger benchmark set.
