# Indexing Stage Audit

This document describes the stage audit checkpoints emitted during index builds. The goal is to capture memory/timing snapshots at key stage boundaries and provide a compact summary for performance triage.

## Output Locations
- `metrics/stage-audit-<mode>.json` (per mode, per build)
- `build_state.json` under `stageCheckpoints` (per mode)
- `build_state.json` under `orderingLedger` (ordering hashes + seeds)

## Determinism
Stage audit files are append-only per build and MUST be deterministic for the same input and config. Checkpoint ordering follows the stage/step execution order and is stable across runs.

## Stages
- `stage1`: discovery + imports + processing + postings
- `stage2`: relations + artifact writes
- `stage3`: embeddings + ANN/LanceDB
- `stage4`: SQLite build

## Schema
Each stage audit file contains:
- `version`: schema version for checkpoints
- `generatedAt`: timestamp
- `buildId`: build identifier (when available)
- `mode`: `code`, `prose`, `extracted-prose`, or `records`
- `checkpoints`: ordered snapshots
- `stages`: per-stage summary
- `highWater`: global high-water marks for memory and extra counters

Checkpoint fields:
- `at`: ISO timestamp
- `elapsedMs`: time since checkpoint recorder start
- `stage`: stage identifier
- `step`: sub-step label
- `memory`: `rss`, `heapUsed`, `heapTotal`, `external`, `arrayBuffers`
- `extra`: stage-specific counters (files, chunks, vocab sizes, vector counts)

Stage summary fields:
- `startedAt`, `finishedAt`, `elapsedMs`
- `checkpointCount`
- `memoryHighWater`
- `extraHighWater`

## Interpreting Results
- Memory spikes are identified by high-water marks across `rss`/`heapUsed`.
- Stage1 counters highlight postings map growth and chunk retention.
- Stage2 counters highlight relation graph sizes and file relation counts.
- Stage3 counters track vector counts and backend availability.
- Stage4 counters track input/output sizes and row counts.

Use these reports to prioritize optimization work before implementing algorithmic changes.

## Stage1 Memory Notes
- Token sequences share the token array when no synonyms are present to reduce duplicate retention.
- Field/comment tokens are only materialized when fielded/phrase/chargram sources require them.
- Postings maps are cleared as soon as dense arrays are materialized to keep peak heap lower.
- Token IDs are canonicalized at tokenize time (64-bit hash); chunk meta can retain packed token IDs to reduce memory pressure.
- Chargram postings use rolling 64-bit hashes (`h64:`) with a max token length guard to cap per-chunk growth.
- Stable vocab ordering hashes are recorded in `vocab_order` and the ordering ledger for determinism audits.
- A bounded postings queue now applies backpressure between tokenization and postings apply; queue depth + wait time show up in checkpoint `extra.postingsQueue`.
- Tree-sitter stats are recorded in checkpoint `extra.treeSitter` (WASM loads/evictions + load modes, parser activations, query cache hits/misses, chunk cache hits/misses, worker fallbacks, parse timeouts/disable counts, batch sizing/deferrals, and cache sizes).

## Stage2 Memory Notes
- `graph_relations` is built from a streamed edge spill/merge pipeline and emitted as sharded JSONL to avoid materializing in-memory graph structures.
- Spill buffers are bounded by bytes/rows and use a staging directory under the index output that is cleaned up after finalization.
- Repo map construction dedupes entries within file/name/kind groups to reduce duplicate retention; legacy variants are removed only after successful writes to preserve rollback safety.
- Filter index maps/sets are released after serialization to reduce retention during artifact writes; filter_index build is best-effort and may be skipped on build errors.
- Filter index hydration builds bitmap sidecars (including per-file chunk bitmaps for large files) to accelerate file path prefiltering without changing serialized output.

## Stage3 Notes
- Embeddings cache uses append-only shards plus a per-cache lock (`cache.lock`) to prevent concurrent shard corruption when cache scope is global.
- Cache index updates are merged under the lock before atomic replace; pruning is best-effort and evictions are treated as cache misses by readers.
- Cache usage telemetry is recorded under `index_state.embeddings.cacheStats` (attempts/hits/misses/rejected/fastRejects).
- Cache writes are scheduled through a bounded writer queue to avoid retaining unbounded pending payloads while IO is backlogged.
  When saturated, embedding compute awaits before scheduling additional writes (backpressure).
- `build-embeddings` returns writer queue stats per mode (maxPending/pending/peakPending/waits/scheduled/failed) for tuning and regression checks.

## Stage4 Memory Notes
- SQLite inserts are chunked into bounded transactions based on input size to reduce WAL and statement retention.
- Bundle ingestion splits large files into smaller insert batches to avoid oversized transactions.
- Incremental updates only load chunk rows for changed/deleted files instead of scanning the full chunks table.

## Scheduler Notes
- When the build scheduler is enabled, queue depth, token usage, and starvation counters are exposed via scheduler stats.
- Stage progress reporting includes scheduler stats in its metadata payload for each stage transition.
- Stage wiring uses the scheduler queues (`stage1.cpu`, `stage1.io`, `stage1.proc`, `stage1.postings`, `stage2.relations`, `stage4.sqlite`) to ensure global backpressure.
- Stage3 embeddings uses scheduler queues (`embeddings.compute`, `embeddings.io`) for batch compute and artifact/cache IO.

## Stage1 Bench + Regression Coverage
- `tools/bench/index/postings-real.js`: end-to-end Stage1 `code` benchmark that generates a fixed corpus via `tests/fixtures/medium/generate.js` (default `--seed postings-real --count 500`) and compares baseline/current runs.
- `tools/bench/index/chargram-postings.js --rolling-hash`: microbench for chargram postings build throughput and key representation (`h64:`) with baseline/current compare.
- Regression tests:
- `tests/indexing/postings/postings-real-bench-contract.test.js`
- `tests/indexing/postings/chargram-bench-contract.test.js`
- `tests/indexing/postings/chunk-meta-determinism.test.js`
- `tests/perf/indexing/postings/postings-heap-plateau.test.js`
- `tests/perf/indexing/postings/stage1-memory-budget.test.js`
