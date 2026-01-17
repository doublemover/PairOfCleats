# Benchmarks

This project has two layers of benchmarking:
- Microbenchmarks for fast component-level timing.
- Language benchmarks for full-size repo comparisons.

## Query generation

Use `npm run bench-queries` to generate a deterministic query suite from the
current index metadata. The generator writes to `benchmarks/queries/` by default
and accepts `--mode`, `--count`, and `--seed` for reproducibility.

## Microbench suite

Run the microbench suite with:

```
pairofcleats bench micro
```

By default it targets `tests/fixtures/sample` with stub embeddings and runs the
index build plus three search modes.

### Components
- Index build (no embeddings): `pairofcleats index build --stub-embeddings` (defaults to code, prose, and extracted-prose).
- Search sparse-only: `--no-ann`.
- Search dense-only: `--ann` plus blend weights that fully weight ANN.
- Search hybrid: `--ann` plus balanced blend weights.

Note: dense-only still performs sparse candidate generation; the blend weights
zero out sparse contributions in scoring. The dense/hybrid presets use the
Use the standard profiles under `profiles/` if you need to override defaults.

### Warm vs cold
- Cold run: first execution after clearing in-process caches.
- Warm runs: repeated executions in the same process (index cache reused).

The suite reports the cold time and warm p50/p95/p99 stats.

### Expected runtime
With the default fixtures and stub embeddings, the microbench suite should finish
well under 5 minutes on a typical dev machine.

### Options
- `--repo <path>`: benchmark a different repo.
- `--mode <code|prose>`: choose index/search mode.
- `--runs <n>`: warm run count (default 5).
- `--warmup <n>`: warmup runs excluded from stats (default 1).
- `--backend <memory|sqlite|sqlite-fts|lmdb>`: search backend.
- `--no-build`: skip building indexes before search benchmarks.
- `--no-clean`: keep cache for the cold build run.
- `--out <file>`: write JSON results to a file.

### Tinybench harness
For tighter microbench loops, use the Tinybench runner:

```
npm run bench-micro:tiny
```

The runner stores baselines at `benchmarks/baselines/microbench.json` (override
with `--baseline`). Use `--write-baseline` to capture a new baseline, and `--compare`
to print deltas against the stored file. It reports p50/p95/p99 latencies for
each component.

## Language benchmarks

Language benchmarks focus on larger repos and end-to-end indexing + search runs.
See `docs/language-benchmarks.md` for tiered repo lists and recommended commands.

### Cache policy
Language benchmarks delete each repo's cache after it finishes (default) to keep disk usage bounded.
Use `--keep-cache` when you need to inspect artifacts or debug a specific run. The cleanup only removes
repo-specific caches under `benchmarks/cache/repos/<repo-id>` and does not touch shared downloads/models.
