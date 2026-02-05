# Byte Budget Policy Spec

## Goals
- Enforce consistent byte budgets across artifacts and stages.
- Prevent memory spikes by enforcing spill, shard, or skip policies.

## Non-goals
- Backward compatibility with prior budget defaults.

## Budget Model
- Global budget pool per stage.
- Per-artifact budget allocations with defaults.
- A shared `resolveByteBudget(artifact, config)` helper returns effective caps.

## Enforcement
- If artifact exceeds budget, apply one of:
  - spill to disk
  - shard more aggressively
  - skip with warning (only if allowed)
- Perf lane enforces strict overflow behavior by default.

## Budget Table
- chunk_meta: medium
- file_meta: large
- postings: large
- relations: large
- VFS: medium

## Artifact Policy Mapping
- vfs_manifest: fail if any row exceeds maxJsonBytes; shard when totalBytes exceeds maxJsonBytes.
- symbol_occurrences / symbol_edges: trim oversized rows first; drop if still above MAX_ROW_BYTES.
- symbol_occurrences ordering: compare by host file/chunkUid, role, ref targetName, then status.
- symbol_edges ordering: compare by from chunkUid, type, to targetName, then status.
- chunk_meta: trim fields in priority order; if still above maxJsonBytes, drop tokens/contexts before final emit.
- file_relations / repo_map: shard by maxJsonBytes; fail on single-row overflow.

## Telemetry
- budget.usedBytes
- budget.limitBytes
- budget.action

## Breaking Changes
No backward compatibility; budgets are enforced strictly.
