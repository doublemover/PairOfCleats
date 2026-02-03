# VFS Benchmarks

This folder contains micro‑benchmarks for VFS‑related hot paths. Each script is runnable on its own and supports JSON output for easy comparison.

## Datasets

Use consistent datasets to compare runs. Suggested tiers:

- Small: ~1k rows or docs (quick sanity check)
- Medium: ~50k rows or docs (default for local perf work)
- Large: ~200k+ rows or docs (stress tests; not CI‑friendly)

When a benchmark supports `--input`, prefer a saved JSON fixture so runs are repeatable. Otherwise, use `--seed` and record it in the results.

## Standard Command Format

```bash
node tools/bench/vfs/<bench>.js --json --out .bench/vfs/<bench>.json
```

Recommended options:
- `--samples 5` for stable medians
- fixed `--seed` where supported
- `--out` to persist results

## JSON Output Schema (recommended)

Every bench should emit at least:

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "bench": { "stats": { "mean": 0, "p50": 0, "p95": 0, "p99": 0 } }
}
```

Include additional fields when applicable:
- `rows`, `docs`, `lookups`, `segments`, `items`
- `opsPerSec` or `rowsPerSec`
- `samples`, `seed`

## Required Metrics

At minimum record wall‑time timing stats (mean/p50/p95/p99). When feasible, add:
- CPU time (if available)
- peak RSS/heap (use `process.memoryUsage()` before/after)
- IO bytes written/read (if a bench reads/writes files)
- file count

## Baseline + Delta Rules

- Take the median of 5 runs for baseline.
- Ignore the first run (warmup) when computing deltas.
- Record both baseline and delta in any summary notes.

## CI‑Safe Mode

When running in CI or constrained environments:
- reduce dataset size by 10x
- use `--samples 1`
- use fixed seeds
- avoid any network or external dependencies

## Suggested Benchmarks

- `hash-routing-lookup.js`
- `vfsidx-lookup.js`
- `segment-hash-cache.js`
- `merge-runs-heap.js`
- `token-uri-encode.js`
- `coalesce-docs.js`
- `cdc-segmentation.js`
- `bloom-negative-lookup.js`
- `parallel-manifest-build.js`
- `io-batching.js`
- `partial-lsp-open.js`
- `cold-start-cache.js`
