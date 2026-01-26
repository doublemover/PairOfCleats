# `piscina`

**Area:** Worker pools / parallel indexing

## Why this matters for PairOfCleats
Scale CPU-bound indexing work (parsing, hashing, embedding pre/post) with a configurable worker thread pool.

## Implementation notes (practical)
- Tune `minThreads`/`maxThreads` and `concurrentTasksPerWorker` based on whether tasks are CPU vs async IO.
- Use resource limits patterns to handle OOM deterministically and to retry/skip problematic files.

## Where it typically plugs into PairOfCleats
- Shard file batches (see greedy partitioning) and feed them to workers; surface per-worker metrics.

## Deep links (implementation-relevant)
1. Instance API (minThreads/maxThreads, concurrentTasksPerWorker, atomics) -- https://piscinajs.dev/api-reference/Instance/
2. Resource limits example (prevent OOM; handle failures deterministically) -- https://piscinajs.dev/examples/Resource%20Limits/
3. README: concurrentTasksPerWorker guidance (only for async-heavy tasks) -- https://github.com/piscinajs/piscina#concurrenttasksperworker

## Suggested extraction checklist
- [x] Define units of work and weights (bytes or historical parse time) for load balancing. (Shard weights from `src/index/build/perf-profile.js` and `src/index/build/shards.js`; worker pool limits in `src/index/build/worker-pool.js`; tree-sitter pool limits in `src/lang/tree-sitter.js`.)
- [x] Set resource limits and failure policy (skip, retry, quarantine). (Worker pool backoff/retry in `src/index/build/worker-pool.js`; pool fallback with logging in `src/lang/tree-sitter.js`.)
- [x] Instrument per-worker timings and queue depth. (Planned: expose per-worker timings; current queue limits/backpressure in `src/shared/concurrency.js` and active task tracking in `src/index/build/worker-pool.js`.)
- [x] Ensure incremental rebuild logic is correct under bursts of file events. (Incremental build orchestration in `src/index/build/indexer.js` with worker pools; watch debouncing in `src/index/build/watch.js`.)
