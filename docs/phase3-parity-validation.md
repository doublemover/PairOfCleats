# Phase 3: Parity + Performance Validation

## Goal
Validate that SQLite-backed candidate generation produces the same top-N results as the file-backed path and capture baseline latency/memory numbers.

## Harness
`tests/parity.js` compares the two backends by running the same query set twice and reporting overlap, score deltas, and runtime stats.

### Usage
```bash
npm run parity
npm run parity -- --no-ann
npm run parity -- --sqlite-backend sqlite-fts
npm run parity -- --queries tests/parity-queries.txt --top 10 --limit 5
npm run parity -- --write-report
node tests/parity.js --no-ann --write-report
node tests/parity.js --no-ann --search /path/to/search.js
```

### Inputs
- Query file: `tests/parity-queries.txt` (plain text, one query per line, `#` comments allowed).
- Index requirements: file-backed indexes in the cache or repo and SQLite indexes at `index-sqlite/index-code.db` + `index-sqlite/index-prose.db`.

### Outputs
- Console summary for overlap, rank correlation, score deltas, and latency.
- Optional JSON report at `docs/phase3-parity-report.json` when `--write-report` is used.
- Per-query diffs in the JSON report: `topMemory`, `topSqlite`, and missing IDs for each mode.

## Metrics
- Overlap: fraction of shared IDs in top-N for code and prose.
- Rank correlation: Spearman correlation of shared IDs between memory/sqlite ranks.
- Score delta: average absolute difference for matched IDs.
- Latency: `elapsedMs` from the search process plus wall-clock time for the CLI call.
- Memory: RSS and heap usage from the search process.

## Tolerances
- Overlap should typically be above 0.6 for top-N results on the same query set.
- Score deltas should be small for matched results; investigate if drift is consistent.
- If overlap is low, compare missing IDs in the report to see whether candidate generation differs.

## Notes
- Use `--no-ann` when the dense model is unavailable or to isolate sparse-only parity.
- Use `--sqlite-backend sqlite-fts` to compare the FTS5 scoring path.
- Expect some divergence if ANN introduces re-ranking differences.
- If overlap is unexpectedly low, rebuild the SQLite index to ensure it matches the latest file-backed indexes.
