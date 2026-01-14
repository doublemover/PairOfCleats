# Performance Profiling

This document describes a repeatable workflow for profiling PairOfCleats indexing and retrieval performance. The intent is to help you distinguish CPU-bound work from I/O-bound work, identify the hottest call paths, and validate that optimizations are real (and do not regress correctness).

The recommendations below assume you are running PairOfCleats via Node.js.

## Quick triage checklist

Before collecting deep profiles, capture:

- Repo size: number of files scanned, number skipped, chunk count (see `preprocess.json`).
- Index mode: file-backed vs SQLite, incremental vs full.
- Embeddings: enabled/disabled, provider, dims, batching.
- Wall clock time and peak RSS (roughly).

Then classify the bottleneck:

- **CPU-bound**: a single core is pegged for long stretches, and a CPU profile shows large self-time in parsing/tokenization/JSON/Hashing.
- **I/O-bound**: many threads are waiting on filesystem reads, libuv threadpool is saturated, CPU is not continuously pegged.
- **Memory pressure**: heavy GC, frequent allocations, or out-of-memory crashes.

## CPU profiling (Node built-in)

Node can emit a `.cpuprofile` file that you can open in Chrome DevTools.

### Index build (CPU profile)

Run:

```bash
node --cpu-prof --cpu-prof-name poc-index.cpuprofile build_index.js --repo /path/to/repo
```

Notes:

- The output profile will be written to the current working directory.
- If you need additional memory headroom, add `--max-old-space-size=...`.

### Viewing the profile

1. Open Chrome (or Chromium).
2. Open DevTools → **Performance**.
3. Use **Load profile...** and select `poc-index.cpuprofile`.
4. Focus on:
   - **Bottom-Up** view for the heaviest call stacks.
   - **Self time** to find functions that dominate execution.

### What to look for

Typical hotspots during indexing:

- File reading and UTF-8 decoding.
- Tokenization/chunking (tree-sitter parsing, fallback tokenization).
- JSON parsing/stringification in artifact writing.
- Hashing (content hashing, signature computation).

If the majority of samples are inside GC (garbage collection), address allocations and buffering before micro-optimizing algorithmic code.

## I/O profiling and libuv threadpool saturation

Indexing can become I/O-bound for large repos, especially when scanning and reading many small files.

### Relevant configuration knobs

- `runtime.uvThreadpoolSize` (or `PAIROFCLEATS_UV_THREADPOOL_SIZE`): libuv threadpool size.
- `runtime.ioConcurrencyCap`: caps I/O concurrency at the application layer.

General guidance:

- Increasing `uvThreadpoolSize` can improve throughput on fast SSDs, but may regress performance on slow disks due to contention.
- `ioConcurrencyCap` is the first lever to adjust when you see excessive parallel reads and OS-level throttling.

### Trace events (optional)

For deeper analysis you can emit Node trace events:

```bash
node --trace-event-categories node,libuv,v8 \
  --trace-event-file-pattern=trace-events-%p.json \
  build_index.js --repo /path/to/repo
```

You can load the resulting JSON in Chrome DevTools (Performance tab) to correlate CPU activity with event timing.

## Measuring improvements safely

When you implement an optimization:

1. Re-run the exact same workload (same repo, same config).
2. Compare:
   - total wall time
   - chunk count and artifacts (sanity)
   - CPU profile hot paths
3. Prefer changes that reduce total work (fewer parses, fewer allocations, fewer redundant reads) over changes that only shift costs.

## When to consider native I/O acceleration

If profiling shows that a large fraction of wall time is spent in libuv threadpool work (filesystem reads, compression, crypto), and you have exhausted configuration tuning, a native module may help by bypassing certain JavaScript overheads.

If you reach that point, treat native work as an opt-in acceleration layer, gated behind a feature flag and accompanied by:

- deterministic correctness checks
- a fallback path to the pure-JS implementation
- robust CI coverage for the “native present” and “native absent” configurations
