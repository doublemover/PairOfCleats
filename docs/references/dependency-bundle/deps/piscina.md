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
1. Instance API (minThreads/maxThreads, concurrentTasksPerWorker, atomics) — https://piscinajs.dev/api-reference/Instance/
2. Resource limits example (prevent OOM; handle failures deterministically) — https://piscinajs.dev/examples/Resource%20Limits/
3. README: concurrentTasksPerWorker guidance (only for async-heavy tasks) — https://github.com/piscinajs/piscina#concurrenttasksperworker

## Suggested extraction checklist
- [ ] Define units of work and weights (bytes or historical parse time) for load balancing.
- [ ] Set resource limits and failure policy (skip, retry, quarantine).
- [ ] Instrument per-worker timings and queue depth.
- [ ] Ensure incremental rebuild logic is correct under bursts of file events.