# Spec: Indexing Memory Pressure Policy

Status: Active implemented policy v1.0
Last audited: 2026-05-21
Implementation anchors: `src/index/build/workers/pool/pressure-controls.js`,
`src/index/build/workers/config.js`, `src/shared/concurrency/scheduler-core/*`,
and `src/index/build/indexer/steps/process-files/postings-queue.js`.

## Purpose

Define runtime pressure states and deterministic behavior for scheduler throttling and cache eviction.

## Pressure states

- `normal`
- `soft-pressure`
- `hard-pressure`

## Thresholds

Runtime exposes configurable watermarks:

- `memoryWatermarkSoft`
- `memoryWatermarkHard`

## Required behavior

1. In `soft-pressure`, reduce heavy-language parser concurrency.
2. In `hard-pressure`, block admission of new heavy jobs until pressure clears.
3. Eviction order is deterministic: largest-first, then oldest-first.
4. Pressure transitions are logged with reason metadata.

## Cache interaction

- Non-critical caches may be dropped under pressure.
- Critical correctness caches must preserve invalidation semantics when evicted/rebuilt.

## Telemetry

Required metrics:

- pressure state transitions,
- throttle activations,
- eviction counts/bytes,
- parse backlog during pressure.

## Compatibility policy

No unbounded memory mode is supported in active index builds.
