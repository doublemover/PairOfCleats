# Language benchmarks

Use the language benchmark harness to run search and performance baselines across large and typical repos. It reads `benchmarks/repos.json` for repo lists and `benchmarks/queries/*.txt` for per-language queries.

## Requirements
- GitHub CLI (`gh`) or `git` for cloning (authenticated if needed).
- Disk space for large repos (several are tens of GB).
- Windows: enable long paths or use a shorter `--root` path if cloning large repos fails.
- Existing models/dictionaries/extensions as needed for your setup.

## Quick usage
- List targets:
  - `npm run bench-language:list`
- Run only JavaScript repos (clone if missing, build indexes, write per-repo JSON):
  - `npm run bench-language:javascript -- --build`
- Run everything with builds (avoids npm CLI warnings for `--build`):
  - `npm run bench-language:build`
- Run only typical repos, skip cloning:
  - `npm run bench-language:typical -- --no-clone`
- Write an aggregate summary for Grafana:
  - `npm run bench-language:python -- --build --out docs/benchmarks-python.json --json`

## Convenience scripts
- `npm run bench-language:list` / `bench-language:list-json`
- `npm run bench-language:large` / `bench-language:typical` / `bench-language:dry-run`
- `npm run bench-language:build` (builds indexes and downloads models as needed)
- `npm run bench-language:build-stub` (builds with stub embeddings)
- Per-language: `bench-language:javascript`, `bench-language:python`, `bench-language:swift`, `bench-language:rust`, `bench-language:clike`, `bench-language:go`, `bench-language:java`, `bench-language:csharp`, `bench-language:kotlin`, `bench-language:ruby`, `bench-language:php`, `bench-language:lua`, `bench-language:sql`, `bench-language:perl`, `bench-language:shell`

## Output
- Per-repo reports are written under `benchmarks/results/<language>/` (JSON payload from `tests/bench.js`).
- Summary output is printed to the console; use `--json` and/or `--out` for a machine-readable aggregate.
- The runner shows a live progress line, a metrics line, and a small log window when stdout is a TTY. Use `--log-lines 3|4|5` to change the window height.
- A run log is appended to `benchmarks/results/bench-language.log` by default (override with `--log <file>`).
- Runs now log start/finish, termination signals, and in-progress indexing counters with elapsed time, rate, and ETA, plus recent file names during indexing (expect larger logs on large repos).
- If index artifacts are missing, the runner auto-enables build steps even if `--build` was not provided.

## Key flags
- `--config <path>`: repo list (default `benchmarks/repos.json`).
- `--language <csv>` / `--tier <csv>`: filter targets (tiers are `large` or `typical`).
- `--clone` / `--no-clone`: clone missing repos (default on).
- `--root <path>`: clone destination root (default `benchmarks/repos`).
- `--cache-root <path>`: cache root for all benchmark runs (default `benchmarks/cache`).
- `--build`, `--build-index`, `--build-sqlite`: build indexes before search. `--build-sqlite` requires file-backed indexes and will auto-enable `--build-index` when missing.
- `--backend <csv|all>`: control backends passed to `tests/bench.js`.
- `--ann` / `--no-ann`: toggle ANN for dense search.
- `--stub-embeddings`: run without model downloads.
- `--log <file>`: write run logs to a specific file (default `benchmarks/results/bench-language.log`).
- `--out <file>`: write aggregate JSON summary.

## Notes
- `tests/bench.js` is the underlying runner and supports extra tuning flags (`--bm25-k1`, `--bm25-b`, `--fts-profile`, `--fts-weights`).
- Queries are plain text, one query per line; lines starting with `#` are ignored.
