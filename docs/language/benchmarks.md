# Language benchmarks

Use the language benchmark harness to run search and performance baselines across large and typical repos. It reads `benchmarks/repos.json` for repo lists and `benchmarks/queries/*.txt` for per-language queries. For microbench definitions and warm/cold timing conventions, see `docs/benchmarks/overview.md`.

## Requirements
- GitHub CLI (`gh`) or `git` for cloning (authenticated if needed).
- Disk space for large repos (several are tens of GB).
- Windows: enable long paths or use a shorter `--root` path if cloning large repos fails.
- Existing models/dictionaries/extensions as needed for your setup.

## Quick usage
- List targets:
  - `node tools/bench/language-repos.js --list`
- Run only JavaScript repos (clone if missing, build indexes, write per-repo JSON):
  - `node tools/bench/language-repos.js --language javascript --build`
- Run everything with builds:
  - `node tools/bench/language-repos.js --build`
- Run only typical repos, skip cloning:
  - `node tools/bench/language-repos.js --tier typical --no-clone`
- Run only typical Python repos:
  - `node tools/bench/language-repos.js --language python --tier typical --build`
- Write an aggregate summary for Grafana:
  - `node tools/bench/language-repos.js --language python --build --out benchmarks/results/benchmarks-python.json --json`

## Convenience note
The old `bench-language:*` npm scripts were removed; use `node tools/bench/language-repos.js` with flags instead.
The matrix runner is `node tools/bench/language-matrix.js`.

## Output
- Per-repo reports are written under `benchmarks/results/<language>/` (JSON payload from `tests/perf/bench/run.test.js`).
- Summary output is printed to stdout; use `--json` and/or `--out` for a machine-readable aggregate.
- Progress/logging renders to stderr via the unified CLI display. Use `--progress=auto|off|jsonl` (default `auto`).
- TTY runs show the interactive progress UI with a log window; non-TTY runs emit periodic single-line progress summaries. Use `--log-lines <n>` (3-50, default 20) to change the log window height.
- Use `--verbose` for per-file/line progress and shard detail; `--quiet` suppresses routine non-error logs while retaining checkout coverage warnings and the final summary.
- Logs are written under `benchmarks/results/logs/bench-language/` by default:
  - `run-<YYYYMMDD>-<HHMMSS>-all.log`: the full run log across all repos.
  - `run-<YYYYMMDD>-<HHMMSS>-<repo>.log`: per-repo logs (repo name slug; disambiguates collisions by expanding the slug).
  - Override with `--log <file>` to force a single log file and disable per-repo log files.
- Runs now log start/finish, termination signals, and in-progress indexing counters with elapsed time, rate, and ETA, plus recent file names during indexing (expect larger logs on large repos).
- If index artifacts are missing, the runner auto-enables build steps even if `--build` was not provided.

## Key flags
- `--config <path>`: repo list (default `benchmarks/repos.json`).
- `--language <csv>` / `--tier <csv>`: filter targets (tiers are `small`, `medium`, `large`, `huge`; positional tiers are allowed).
- `--clone` / `--no-clone`: clone missing repos (default on).
- `--root <path>`: clone destination root (default `benchmarks/repos`).
- `--cache-root <path>`: cache root for all benchmark runs (default `<shared-cache-root>/bench-language`, where shared cache root resolves via `PAIROFCLEATS_CACHE_ROOT`/`LOCALAPPDATA`).
- `--cache-suffix <name>` / `--cache-run`: append a suffix or auto-generate a run id to isolate caches per run.
- `--keep-cache`: preserve per-repo caches after each run (default: cleanup after each repo).
- `--strict-submodules`: require the repository contract's required submodules to be available. By default, unavailable submodules warn and the runner continues with available files; optional modules retain their existing contract policy.
- `--dry-run`: print the per-repo command plan without executing.
- `--results <path>`: override the results root (default `benchmarks/results`).
- `--build`, `--build-index`, `--build-sqlite`: build indexes before search. `--build-sqlite` uses incremental bundles when available; otherwise it will auto-enable `--build-index` to create file-backed indexes.
- `--backend <csv|all>`: control backends passed to `tests/perf/bench/run.test.js`.
- `--ann` / `--no-ann`: toggle ANN for dense search.
- `--repos <csv>` / `--only <csv>`: limit to explicit repo slugs (case-insensitive).
- `--languages <csv>`: alias for `--language`.
- `--queries <path>`: override query file per run (defaults to repo config).
- `--heap-mb <n>`: override Node heap size for bench subprocesses.
- `--lock-mode <fail-fast|wait|stale-clear>`: handle existing index locks (default `fail-fast`).
- `--lock-wait-ms <ms>` / `--lock-stale-ms <ms>`: tune wait and stale thresholds when lock mode is `wait`/`stale-clear`.
- `--stub-embeddings`: forward stub embeddings to the bench runner (no model download).
- `--real-embeddings`: forward real embeddings to the bench runner.
- `--log <file>`: write run logs to a specific file (default `benchmarks/results/logs/bench-language/run-<YYYYMMDD>-<HHMMSS>-all.log`).
- `--out <file>`: write aggregate JSON summary.

## Notes
- Submodule preparation works through independent modules and their available nested checkouts. A missing repository, authentication failure, or incomplete checkout does not prevent a healthy sibling or the main repository from being benchmarked. Warnings name the unavailable path and reason, including in quiet mode. No unavailable source is counted as indexed. Aggregate reports and the run ledger retain checkout coverage under `diagnostics.checkout`; incomplete coverage produces `repo_partial_checkout` and a `passed_with_degradation` verdict, and fails the production-clean gate by default. A failed main clone, invalid repository root, unsafe path, or interrupted preparation remains a failure. Existing checkout revisions are preserved rather than forcibly overwritten. Git authentication and transport checks remain in effect.
- Submodule preparation shares a bounded timeout across discovery and individual initialization commands, and uses one Git initialization job at a time. [Git submodule documentation](https://git-scm.com/docs/git-submodule) describes the explicit checkout operation; [Git configuration documentation](https://git-scm.com/docs/git-config) describes the bounded metadata snapshot's NUL-delimited parsing without includes.
- Queries are plain text, one query per line; lines starting with `#` are ignored.
- The runner uses `execa` for child processes and terminates trees via `taskkill` on Windows and `SIGTERM` elsewhere; we avoid `tree-kill` due to past Windows command-injection advisories and only pass trusted PIDs.
- Use `--verbose` to emit shard plan diagnostics (top shard sizes and split summaries) during builds.
- Shard planning uses line counts: subdirs with <3 files merge unless a file is at least half the size of the 10th largest shard (by lines), and oversized shards are split by line totals for balance.
