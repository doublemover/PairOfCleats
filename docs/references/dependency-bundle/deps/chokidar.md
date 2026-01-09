# `chokidar`

**Area:** File watching / incremental indexing

## Why this matters for PairOfCleats
Watch repo files with robust cross-platform semantics; support `awaitWriteFinish` to avoid partial reads.

## Implementation notes (practical)
- Tune ignored patterns and debouncing to reduce event storms.
- Understand `awaitWriteFinish` caveats and adjust thresholds for large repos.

## Where it typically plugs into PairOfCleats
- Index watch: enqueue change events to an indexer queue; update per-file cache bundles.

## Deep links (implementation-relevant)
1. README: API + watch options (ignored, awaitWriteFinish, atomic) — https://github.com/paulmillr/chokidar#readme
2. awaitWriteFinish caveats (edge cases; tuning guidance) — https://github.com/paulmillr/chokidar/issues/513

## Suggested extraction checklist
- [ ] Define units of work and weights (bytes or historical parse time) for load balancing.
- [ ] Set resource limits and failure policy (skip, retry, quarantine).
- [ ] Instrument per-worker timings and queue depth.
- [ ] Ensure incremental rebuild logic is correct under bursts of file events.