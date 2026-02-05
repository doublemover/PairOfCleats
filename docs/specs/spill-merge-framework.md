# Spill/Merge Framework Spec

## Goals
- Provide a shared spill/merge core for postings, relations, VFS, and artifact sharding.
- Guarantee deterministic merges with bounded memory.

## Non-goals
- Backward compatibility with older spill formats.

## Core API
- createSpillWriter(config)
- spillRow(row)
- finalizeSpill()
- mergeRuns(config, runs)

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
No backward compatibility; all spill/merge uses shared core.
