# Indexing Stage Audit

This document describes the stage audit checkpoints emitted during index builds. The goal is to capture memory/timing snapshots at key stage boundaries and provide a compact summary for performance triage.

## Output Locations
- `metrics/stage-audit-<mode>.json` (per mode, per build)
- `build_state.json` under `stageCheckpoints` (per mode)

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

## Stage2 Memory Notes
- Call-site edges are added directly during graph construction to avoid buffering large edge lists.
- Repo map construction dedupes entries within file/name/kind groups to reduce duplicate retention.
- Filter index maps/sets are released after serialization to reduce retention during artifact writes.

## Stage4 Memory Notes
- SQLite inserts are chunked into bounded transactions based on input size to reduce WAL and statement retention.
- Bundle ingestion splits large files into smaller insert batches to avoid oversized transactions.
- Incremental updates only load chunk rows for changed/deleted files instead of scanning the full chunks table.

## Scheduler Notes
- When the build scheduler is enabled, queue depth, token usage, and starvation counters are exposed via scheduler stats.
- Stage progress reporting includes scheduler stats in its metadata payload for each stage transition.
- Stage wiring uses the scheduler queues (`stage1.files`, `stage1.postings`, `stage2.relations`, `stage4.sqlite`) to ensure global backpressure.
