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
- Index build (no embeddings): `pairofcleats index build --stub-embeddings` (defaults to code mode).
- Search sparse-only: `--no-ann`.
- Search dense-only: `--ann` plus blend weights that fully weight ANN.
- Search hybrid: `--ann` plus balanced blend weights.

Note: dense-only still performs sparse candidate generation; the blend weights
zero out sparse contributions in scoring. The dense/hybrid presets use the
`bench-dense` and `bench-hybrid` profiles under `profiles/`.

### Warm vs cold
- Cold run: first execution after clearing in-process caches.
- Warm runs: repeated executions in the same process (index cache reused).

The suite reports the cold time and warm p50/p95 stats.

### Expected runtime
With the default fixtures and stub embeddings, the microbench suite should finish
well under 5 minutes on a typical dev machine.

### Options
- `--repo <path>`: benchmark a different repo.
- `--mode <code|prose>`: choose index/search mode.
- `--runs <n>`: warm run count (default 5).
- `--warmup <n>`: warmup runs excluded from stats (default 1).
- `--backend <memory|sqlite|sqlite-fts>`: search backend.
- `--no-build`: skip building indexes before search benchmarks.
- `--no-clean`: keep cache for the cold build run.
- `--out <file>`: write JSON results to a file.

## Language benchmarks

Language benchmarks focus on larger repos and end-to-end indexing + search runs.
See `docs/language-benchmarks.md` for tiered repo lists and recommended commands.
