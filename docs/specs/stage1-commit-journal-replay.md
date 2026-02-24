# Stage1 Commit Journal and Replay Spec

## Purpose
Define single-writer journal behavior for deterministic commit replay and crash recovery.

## Journal Model
- One append-only writer tied to the commit cursor lane.
- Records are idempotent by `seq`.
- Record types:
  - `terminal`
  - `commit`
  - `checkpoint`

## Record Schema
Required fields:
- `runId`
- `seq`
- `recordType`
- `terminalOutcome`
- `attempt`
- `offsets` (downstream write offsets or ids)
- `checksums` (artifact/sqlite validation hashes)
- `timestampMs`

## Write Policy
1. Write record before mutating durable downstream state where required by crash semantics.
2. Fsync policy is configurable but deterministic per config tier.
3. Checkpoint records summarize safe replay position (`nextCommitSeq`, terminal bitmap hash).

## Replay Algorithm
1. Load planner seed/config hash and validate against current run config.
2. Read journal in append order.
3. For each `seq`, apply idempotent reduction: latest valid terminal + commit record wins.
4. Rebuild:
  - `nextCommitSeq`
  - terminal bitmap
  - retry counters
5. Skip already committed `seq` during resumed dispatch.

## Idempotence Contract
1. Duplicate `commit` for same `seq` is ignored after checksum/offset verification.
2. Conflicting terminal outcomes for same `seq` is fatal corruption.
3. Replay never emits additional commit writes for already committed `seq`.

## Truncation and Compaction
1. Compaction may occur only at checkpoint boundaries.
2. Compaction output must preserve replay-equivalent state.
3. Corrupt tail handling truncates to last valid record boundary and emits warning/failure policy outcome.

## Acceptance
Compliant implementation proves:
1. Restart after simulated crash does not double-commit.
2. Replay restores commit cursor and terminal state deterministically.
3. Corruption detection is explicit and testable.
