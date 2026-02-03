# Indexing Stage Audit

This document describes the stage audit checkpoints emitted during index builds. The goal is to capture memory/timing snapshots at key stage boundaries and provide a compact summary for performance triage.

## Output Locations
- `metrics/stage-audit-<mode>.json` (per mode, per build)
- `build_state.json` under `stageCheckpoints` (per mode)

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
