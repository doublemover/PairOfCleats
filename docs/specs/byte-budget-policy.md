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

## Configuration
- `indexing.artifacts.byteBudgets` or `indexing.artifacts.byteBudget` may override defaults per artifact.
- Each override supports `{ maxBytes, overflow, strict }`.
- `maxBytes` may be a number of bytes or `"maxJsonBytes"` / `"auto"` to bind to `MAX_JSON_BYTES`.
- `overflow` may be `fail`, `warn`, `trim`, `shard`, `drop`, or `skip`.
- `indexing.artifacts.byteBudgetPolicy.strict` enables strict enforcement across all artifacts.

## Enforcement
- If artifact exceeds budget, apply one of:
  - spill to disk
  - shard more aggressively
  - skip with warning (only if allowed)
- Perf lane enforces strict overflow behavior by default.

## Budget Table
- chunk_meta: maxJsonBytes, overflow=trim
- file_meta: maxJsonBytes, overflow=shard
- token_postings: maxJsonBytes, overflow=shard
- repo_map: maxJsonBytes, overflow=shard
- file_relations: maxJsonBytes, overflow=shard
- vfs_manifest: maxJsonBytes, overflow=fail
- symbol_occurrences: maxJsonBytes, overflow=trim
- symbol_edges: maxJsonBytes, overflow=trim
- call_sites: maxJsonBytes, overflow=trim
- chunk_uid_map: maxJsonBytes, overflow=shard
- graph_relations: maxJsonBytes, overflow=drop

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
- stage checkpoints record `stage=artifacts` and `step=byte-budget`.

## Build State
- build_state.byteBudgets stores the resolved policy map per build:
  - `generatedAt`
  - `maxJsonBytes`
  - `strict`
  - `policies` (artifact -> `{ maxBytes, overflow, strict }`)

## Breaking Changes
No backward compatibility; budgets are enforced strictly.
