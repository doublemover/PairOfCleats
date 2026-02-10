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
- Overflow `fail`/`abort` throws `ERR_BYTE_BUDGET`.
- Other overflow modes record checkpoint telemetry and log warnings unless strict mode is enabled.

## Budget Table
- chunk_meta: maxJsonBytes, overflow=shard
- file_meta: maxJsonBytes, overflow=shard
- token_postings: maxJsonBytes, overflow=shard
- repo_map: maxJsonBytes, overflow=shard
- file_relations: maxJsonBytes, overflow=shard
- vfs_manifest: maxJsonBytes, overflow=fail
- symbol_occurrences: maxJsonBytes, overflow=shard
- symbol_edges: maxJsonBytes, overflow=shard
- call_sites: maxJsonBytes, overflow=shard
- chunk_uid_map: maxJsonBytes, overflow=shard
- graph_relations: maxJsonBytes, overflow=drop

## Artifact Policy Mapping
- vfs_manifest: fail if any row exceeds maxJsonBytes; shard when totalBytes exceeds maxJsonBytes.
- symbol_occurrences / symbol_edges: shard outputs when over budget; strict mode converts warnings to failures.
- symbol_occurrences ordering: compare by host file/chunkUid, role, ref targetName, then status.
- symbol_edges ordering: compare by from chunkUid, type, to targetName, then status.
- chunk_meta: switch to JSONL sharding and enforce row-size guardrails.
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

## Tests
- `tests/indexing/runtime/byte-budget-enforcement.test.js`

## Breaking Changes
No backward compatibility; budgets are enforced strictly.
