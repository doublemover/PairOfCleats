# Byte Budget Policy Spec

## Goals
- Enforce consistent byte budgets across artifacts and stages.
- Prevent memory spikes by enforcing spill, shard, or skip policies.

## Non-goals
- Backward compatibility with prior budget defaults.

## Budget Model
- Global budget pool per stage.
- Per-artifact budget allocations with defaults.

## Enforcement
- If artifact exceeds budget, apply one of:
  - spill to disk
  - shard more aggressively
  - skip with warning (only if allowed)

## Budget Table
- chunk_meta: medium
- file_meta: large
- postings: large
- relations: large
- VFS: medium

## Telemetry
- budget.usedBytes
- budget.limitBytes
- budget.action

## Breaking Changes
No backward compatibility; budgets are enforced strictly.
