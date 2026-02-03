# Benchmarks

This project has two layers of benchmarking:
- Microbenchmarks for fast component-level timing.
- Language benchmarks for full-size repo comparisons.

## Query generation

Use `node tools/bench-query-generator.js` to generate a deterministic query suite from the
current index metadata.

Common flags:
- `--repo <path>`: repo root (defaults to CWD).
- `--mode <code|prose>`: which chunk metadata to sample (default `code`).
- `--count <n>`: number of queries (clamped to 10–200).
- `--seed <value>`: deterministic seed (defaults to a hash of index path + mode + chunk count).
- `--index-root <path>`: override index root resolution.
- `--json`: emit JSON output instead of a text list.
- `--out <path>`: override output file path.

Default outputs:
- Text mode: `benchmarks/queries/generated-<mode>.txt`
- JSON mode: `docs/benchmarks-queries.json`

## Microbench suite

Run the microbench suite with:

```
node tools/bench/micro/run.js
```

By default it targets `tests/fixtures/sample` with stub embeddings and runs the
index build plus three search modes. Use `--repo-current` to target the current
repo without specifying a path.

### Components
- Index build uses core `buildIndex` logic (stub embeddings by default).
- Search sparse-only: internal `scoreMode=sparse` (ANN disabled).
- Search dense-only: internal `scoreMode=dense` (blend weights: sparse=0, ann=1).
- Search hybrid: internal `scoreMode=hybrid` (blend weights: sparse=0.5, ann=0.5).

Note: dense/hybrid still generate sparse candidates; the blend weights control scoring.

### Warm vs cold
- Cold run: first execution after clearing in-process caches.
- Warm runs: repeated executions in the same process (index cache reused).

The suite reports the cold time and warm p50/p95/p99 stats.
Results include `cache.sqliteEntries` to indicate SQLite cache reuse.

### Expected runtime
With the default fixtures and stub embeddings, the microbench suite should finish
well under 5 minutes on a typical dev machine.

### Options
- `--repo <path>`: benchmark a different repo.
- `--repo-current`: use current working repo instead of the fixture default.
- `--mode <code|prose>`: choose index/search mode.
- `--query <text>`: query used for search benchmarks.
- `--backend <memory|sqlite|sqlite-fts>`: search backend.
- `--components <list>`: component list (`index-build,sparse,dense,hybrid,ann-backends`).
- `--ann-backends <list>`: ann backend list for the ann-backends component.
- `--runs <n>`: warm run count (default 5).
- `--warmup <n>`: warmup runs excluded from stats (default 1).
- `--build` / `--no-build`: build indexes before search benchmarks.
- `--clean` / `--no-clean`: clean repo cache before the cold build run.
- `--sqlite`: enable SQLite builds during index benchmark.
- `--threads <n>`: index build worker threads (0 = default).
- `--stub-embeddings`: use stub embeddings for index build.
- `--json`: emit JSON output only.
- `--out <file>`: write JSON results to a file.

Thread defaults:
- `--threads 0` (or omitted) lets `buildIndex` resolve concurrency from CPU count and config/env
  (`src/shared/threads.js`), with CLI `--threads` taking priority when set.

Bench harness note:
- The bench harness used by `tests/perf/bench/run.test.js` also accepts `--query-concurrency`
  to control parallel query evaluation for large query sets.

### Tinybench harness
For tighter microbench loops, use the Tinybench runner:

```
node tools/bench/micro/tinybench.js
```

The runner stores baselines at `benchmarks/baselines/microbench.json` (override
with `--baseline`). Use `--write-baseline` to capture a new baseline, and `--compare`
to print deltas against the stored file. It reports p50/p95/p99 latencies for
each component.

Tinybench flags:
- `--iterations`, `--warmup-iterations`
- `--time`, `--warmup-time`
- `--components <list>` (search-sparse, search-ann, search-dense, search-hybrid)
- Standard repo/query/backend flags: `--repo`, `--mode`, `--backend`, `--query`
- Build toggles: `--build`, `--stub-embeddings`
- Output: `--json`, `--out`, `--baseline`, `--write-baseline`, `--compare`

Tinybench creates the baseline/output directory if it is missing.

## Language benchmarks

Language benchmarks focus on larger repos and end-to-end indexing + search runs.
See `docs/language/benchmarks.md` for tiered repo lists and recommended commands.

### Matrix runner
To sweep multiple backend/ANN combinations across the repo matrix, use:

```
node tools/bench-language-matrix.js --tier typical --backends sqlite,sqlite-fts --ann-modes auto,on,off
```

Matrix runner flags:
- `--backends <list>` / `--backend <single>` (supports `all`)
- `--ann-modes <list>` (default `auto,on,off`)
- `--out-dir <path>` / `--log-dir <path>` (override run/log roots)
- `--fail-fast` (stop on the first failing bench run)

### Cache policy
Language benchmarks delete each repo's cache after it finishes (default) to keep disk usage bounded.
Use `--keep-cache` when you need to inspect artifacts or debug a specific run. The cleanup only removes
repo-specific caches under `benchmarks/cache/repos/<repo-id>` and does not touch shared downloads/models.
