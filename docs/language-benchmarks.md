# Language benchmarks

Use the language benchmark harness to run search and performance baselines across large and typical repos. It reads `benchmarks/repos.json` for repo lists and `benchmarks/queries/*.txt` for per-language queries. For microbench definitions and warm/cold timing conventions, see `docs/benchmarks.md`.

## Requirements
- GitHub CLI (`gh`) or `git` for cloning (authenticated if needed).
- Disk space for large repos (several are tens of GB).
- Windows: enable long paths or use a shorter `--root` path if cloning large repos fails.
- Existing models/dictionaries/extensions as needed for your setup.

## Quick usage
- List targets:
  - `pairofcleats bench language --list`
- Run only JavaScript repos (clone if missing, build indexes, write per-repo JSON):
  - `pairofcleats bench language --language javascript --build`
- Run everything with builds:
  - `pairofcleats bench language --build`
- Run only typical repos, skip cloning:
  - `pairofcleats bench language --tier typical --no-clone`
- Run only typical Python repos:
  - `pairofcleats bench language --language python --tier typical --build`
- Write an aggregate summary for Grafana:
  - `pairofcleats bench language --language python --build --out docs/benchmarks-python.json --json`

## Convenience note
The old `bench-language:*` npm scripts were removed; use `pairofcleats bench language` with flags instead.
The matrix runner is now `pairofcleats bench matrix`.

## Output
- Per-repo reports are written under `benchmarks/results/<language>/` (JSON payload from `tests/bench.js`).
- Summary output is printed to the console; use `--json` and/or `--out` for a machine-readable aggregate.
- The runner shows a live progress line, a metrics line, and a scrolling log window when stdout is a TTY. Use `--log-lines <n>` (3-50, default 20) to change the window height.
- The log window coalesces tagged updates (debounced) to reduce noise; file progress lines use `[shard <index>/<total>]` prefixes with file counts and line totals.
- A run log is written to `benchmarks/results/logs/bench-language/<timestamp>.log` by default (override with `--log <file>`).
- Runs now log start/finish, termination signals, and in-progress indexing counters with elapsed time, rate, and ETA, plus recent file names during indexing (expect larger logs on large repos).
- If index artifacts are missing, the runner auto-enables build steps even if `--build` was not provided.

## Key flags
- `--config <path>`: repo list (default `benchmarks/repos.json`).
- `--language <csv>` / `--tier <csv>`: filter targets (tiers are `large` or `typical`).
- `--clone` / `--no-clone`: clone missing repos (default on).
- `--root <path>`: clone destination root (default `benchmarks/repos`).
- `--cache-root <path>`: cache root for all benchmark runs (default `benchmarks/cache`).
- `--cache-suffix <name>` / `--cache-run`: append a suffix or auto-generate a run id to isolate caches per run.
- `--build`, `--build-index`, `--build-sqlite`: build indexes before search. `--build-sqlite` uses incremental bundles when available; otherwise it will auto-enable `--build-index` to create file-backed indexes.
- `--backend <csv|all>`: control backends passed to `tests/bench.js`.
- `--ann` / `--no-ann`: toggle ANN for dense search.
- `--index-profile <name>` / `--no-index-profile`: apply a configuration profile for indexing during benchmarks (default `full`; bench-* profiles are ignored for language runs).
- `--lock-mode <fail-fast|wait|stale-clear>`: handle existing index locks (default `fail-fast`).
- `--lock-wait-ms <ms>` / `--lock-stale-ms <ms>`: tune wait and stale thresholds when lock mode is `wait`/`stale-clear`.
- `--stub-embeddings`: ignored for language benchmarks (always uses real embeddings).
- `--real-embeddings`: retained for compatibility (real embeddings are already forced).
- `--log <file>`: write run logs to a specific file (default `benchmarks/results/logs/bench-language/<timestamp>.log`).
- `--out <file>`: write aggregate JSON summary.

## Notes
- `tests/bench.js` is the underlying runner and supports extra tuning flags (`--bm25-k1`, `--bm25-b`, `--fts-profile`, `--fts-weights`).
- Queries are plain text, one query per line; lines starting with `#` are ignored.
- Language benchmarks run with the `full` profile by default to keep all enrichment steps enabled; use `--no-index-profile` if you want the repo's base config instead.
- The runner uses `execa` for child processes and terminates trees via `taskkill` on Windows and `SIGTERM` elsewhere; we avoid `tree-kill` due to past Windows command-injection advisories and only pass trusted PIDs.
- Set `PAIROFCLEATS_VERBOSE=1` to emit shard plan diagnostics (top shard sizes and split summaries) during builds.
- Shard planning uses line counts: subdirs with <3 files merge unless a file is at least half the size of the 10th largest shard (by lines), and oversized shards are split by line totals for balance.
