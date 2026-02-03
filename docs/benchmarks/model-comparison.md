# Model Comparison Harness

## Goal
Compare search latency and ranking differences across embedding models.

## Usage
- `node tools/compare-models.js --models Xenova/all-MiniLM-L12-v2,Xenova/all-MiniLM-L6-v2 --build`
- `node tools/compare-models.js --models Xenova/all-MiniLM-L12-v2,Xenova/all-MiniLM-L6-v2 --backend sqlite --build --build-sqlite`

- JSON output: add `--json` or `--out path/to/report.json`

## Notes
- The harness isolates per-model indexes under `<cache>/model-compare/<modelId>` by default.
- If `cache.root` is set in `.pairofcleats.json`, caches are shared; use `--build` to rebuild per model.
- SQLite backends require `--build-sqlite` when comparing multiple models (SQLite db paths are shared unless configured). If incremental bundles exist, rebuilds stream from them instead of loading `chunk_meta.json`.

## Options
- `--models`: Comma-separated list of models to compare.
- Config alternative: set `models.compare` to an array in `.pairofcleats.json`.
- `--baseline`: Model ID used as the comparison baseline (defaults to the first model).
- `--backend`: `memory`, `sqlite`, or `sqlite-fts`.
- `--top`: Number of results per query to compare.
- `--limit`: Limit the number of queries loaded from the query file.
- `--mode`: `code`, `prose`, or `both`.
- `--build` / `--build-index`: Rebuild file-backed indexes per model.
- `--build-sqlite`: Rebuild SQLite indexes per model.
- `--incremental`: Reuse incremental caches when building.
- `--stub-embeddings`: Use stub embeddings (no model download).
- `--cache-root`: Base cache root for model comparison runs.
- `--queries`: Path to the query list (alias `-q`).
- `--repo`: Repo root to benchmark (defaults to CWD).
- `--ann` / `--no-ann`: toggle ANN during comparisons.
- `--json`: Print the full JSON report to stdout.
- `--out`: Write the JSON report to disk.
