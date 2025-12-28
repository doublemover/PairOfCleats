# Phase 11: Parallel Indexing + Backpressure

## Goal
Speed up indexing by processing files in parallel while preserving deterministic chunk ordering.

## Concurrency controls
Configure in `.pairofcleats.json`:
```json
{
  "indexing": {
    "concurrency": 4,
    "importConcurrency": 4
  }
}
```

CLI override:
- `node build_index.js --threads 6` (only used when explicitly set).

## Behavior
- A worker pool processes files concurrently, but results are appended in sorted file order.
- This preserves deterministic chunk IDs and keeps parity stable.
- Import scanning uses a separate concurrency limit for backpressure.

## Notes
- Higher concurrency can increase memory pressure; tune per machine.
- Incremental caching and git metadata extraction still work within the pool.
