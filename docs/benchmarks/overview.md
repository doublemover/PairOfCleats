# Benchmarks

This project has two layers of benchmarking:
- Microbenchmarks for fast component-level timing.
- Language benchmarks for full-size repo comparisons.

For bounded CPU sampling, timeline traces and CPU/I/O diagnosis, see the
[performance profiling guide](profiling.md).

Language reports distinguish observed extraction quality from missing evidence.
Stage 1's quality record is retained in `index_state.json` even when PDF/DOCX
reporting is disabled or a tiny-repository profile omits auxiliary reports. Older
stage timing records remain readable. Source-extraction admission and stage 3
bundle synchronization are recorded separately; skipped synchronization is not
counted as source-content recall loss.

The production-clean gate requires observed extraction-quality evidence for
successful tasks. Unknown evidence fails its zero-default
`maxUnobservedQualityRepos` threshold; it does not establish zero recall loss.
Ordinary partial runs keep their existing exit policy. Reports retain actual
skipped-file counts separately from estimated suppressed files and recall loss.

SCM metadata recovery retains bounded failure codes and messages, batch counters,
per-file attempted/completed/unavailable counts, and unresolved-file counts in
stage timings under `scmMetadata`. This distinguishes a fully recovered provider
that intentionally lacks batch support from a real batch failure, and keeps the
failure evidence available after benchmark cache cleanup.

An empty primary SQLite mode no longer removes a usable sibling mode from the
query benchmark. A code-only SQLite index is queried with an explicit code
selector; the reverse case selects prose. Reports name the selected primary
modes per backend and count executed searches, so results with different scope
can be compared deliberately. An entirely empty SQLite workload is recorded as
unexercised. Empty-mode receipts must match their checksum, current ready state,
generation and database target; an unknown or missing nonempty mode remains an
error. Confirmed empty receipts also prevent unnecessary automatic rebuilds.

Incremental JSON bundles and their patches now use the same byte-vector and
omitted-field representation as their checksums. Buffer vectors, typed-array
patches and omitted optional fields round-trip without false corruption
reports. Existing MessagePack checksum representations remain readable. This
fix has a small deterministic write/read fixture; it does not establish the
cause of checksum mismatches in earlier repository campaigns.

Cross-file inference also checks complete chunk coverage before reusing a
whole-run cache result. Size-truncated or incomplete entries trigger fresh
inference before any cached rows alter its inputs. Complete entries retain
their existing reuse path, so warm results do not silently lose updates that
were omitted from a bounded cache.

A configured path alone no longer counts as an installed SQLite ANN extension.
Setup and benchmark preparation check the actual artifact before reporting it
ready, including in check-only mode. This verifies installation data; native
compatibility and actual ANN query coverage still need runtime checks.

## Query generation

Use `node tools/bench/query-generator.js` to generate a deterministic query suite from the
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
- JSON mode: `benchmarks/results/benchmarks-queries.json`

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

## Embedding model bakeoff

Run embedding bakeoff with:

```
node tools/bench/embeddings/model-bakeoff.js
```

The default profile is fast-path (`sampled`, `resumable`, compare skipped). Use
`--full-run` to opt into full-fidelity defaults (unsampled + compare enabled),
and then override specific flags as needed.

### Matrix runner
To sweep multiple backend/ANN combinations across the repo matrix, use:

```
node tools/bench/language-matrix.js --tier typical --backends sqlite,sqlite-fts --ann-modes auto,on,off
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
