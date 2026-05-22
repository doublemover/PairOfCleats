# Spill/Merge Framework Spec

Status: Active implemented shared spill/merge contract.
Last audited: 2026-05-21

## Goals
- Provide a shared spill/merge core for postings, relations, VFS, and artifact sharding.
- Guarantee deterministic merges with bounded memory.

## Non-goals
- Backward compatibility with older spill formats.

## Current Core APIs
- `src/shared/merge.js`
  - `mergeSortedRuns`
  - `mergeSortedRunsToFile`
  - `mergeRunsWithPlanner`
  - `createMergeRunManifest`
  - `writeMergeRunManifest`
- `src/index/build/artifacts/helpers.js`
  - `createRowSpillCollector`
- `src/map/build-map/io.js`
  - `createSpillSorter`

The older generic names `createSpillWriter`, `spillRow`, `finalizeSpill`, and
`mergeRuns` are conceptual aliases from the initial design, not live exported
APIs. New callers should use the concrete APIs above.

## Merge Semantics
- K-way merge with bounded heap.
- Stable ordering by primary key and tie-breakers.
- Deterministic output across runs.

## Spill Triggers
- Byte-based thresholds (primary).
- Row-based thresholds (optional).

## File Naming
- spill-<runId>-<part>.jsonl
- meta.json includes row counts and byte counts.

## Cleanup
- Spill files removed after successful merge.
- Recovery: if merge fails, spill files remain for retry.

## Telemetry
- spill.count
- spill.bytes
- merge.durationMs
- merge.heapPeak

## Breaking Changes
No backward compatibility with older standalone spill formats. The archived
standalone SPIMI spill plan at `docs/archived/spimi-spill.md` is historical;
live postings, graph relation, symbol, chunk-meta, VFS manifest, and map
builder spill/merge behavior is covered by this shared contract.

## Implementation Anchors
- `src/index/build/postings/spill.js`
- `src/index/build/artifacts/graph-relations.js`
- `src/index/build/artifacts/writers/chunk-meta/writer.js`
- `src/index/build/artifacts/writers/symbol-edges.js`
- `src/index/build/artifacts/writers/symbol-occurrences.js`
- `src/index/build/artifacts/writers/vfs-manifest.js`
- `src/map/build-map/io.js`

## Validation
- `tests/shared/merge/contract-matrix.test.js`
- `tests/indexing/postings/spill-merge-unified.test.js`
- `tests/indexing/postings/spill-merge-compat.test.js`
- `tests/indexing/postings/spill-merge-planner-metadata-reuse.test.js`
- `tests/indexing/postings/spill-merge-unique-threshold.test.js`
- `tests/graph/spill-merge-deterministic.test.js`
