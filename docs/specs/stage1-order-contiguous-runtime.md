# Stage1 Order-Contiguous Runtime Spec

## Purpose
Define the normative Stage1 runtime that guarantees deterministic ordered commit with throughput-oriented parallel compute.

## Scope
- Stage1 file processing runtime.
- `seq` ledger lifecycle.
- Contiguous window planning and two-lane execution.
- Hard-fail invariant policy.

## Normative Model
1. Discovery assigns each eligible Stage1 entry exactly one immutable `seq` in monotonic order.
2. Planner emits deterministic contiguous windows over `seq`.
3. Compute lane may complete envelopes out of order within active windows.
4. Commit lane advances only on `nextCommitSeq`.
5. Each `seq` reaches exactly one terminal outcome.

## Runtime Entities
- `seqState[seq]`: dense state code (`UNSEEN`, `DISPATCHED`, `IN_FLIGHT`, `TERMINAL_SUCCESS`, `TERMINAL_SKIP`, `TERMINAL_FAIL`, `TERMINAL_CANCEL`, `COMMITTED`).
- `attempts[seq]`: retry count.
- `leaseOwner[seq]`, `leaseHeartbeatMs[seq]`: dispatch ownership and liveness.
- `envelopeBySeq`: sparse map for terminal envelopes and optional payload reference.
- `nextCommitSeq`: monotonic commit cursor.
- `terminalCount`: count of terminalized `seq`.
- `committedCount`: count of committed `seq`.
- `activeWindows`: at most two windows; `W0` commit-eligible and `W1` compute-prefetch only.

## Lane Semantics
### Compute Lane
1. Dispatch only from active windows.
2. Transition `UNSEEN -> DISPATCHED -> IN_FLIGHT`.
3. Produce exactly one terminal envelope per completed attempt.
4. Retryable failures re-enter `DISPATCHED` for the same `seq`.
5. Non-retryable failures terminalize immediately.

### Commit Lane
1. Reads only `nextCommitSeq`.
2. If `nextCommitSeq` envelope is non-terminal or missing, commit lane does not skip ahead.
3. Coalesces maximal contiguous terminal runs `[nextCommitSeq, k]`.
4. Applies micro-batched downstream writes for success envelopes.
5. Marks committed states and advances cursor by `+1` per `seq`.

## Deterministic Guarantees
1. Equivalent inputs and runtime config produce the same planner windows, commit order, and terminal summary.
2. Commit order is strictly `seq`-monotonic.
3. Retry does not allocate a new `seq`.
4. Cancellation outcomes are deterministic under fixed policy boundary.

## Invariants
1. `terminalCount === totalSeqCount` at Stage1 completion.
2. `nextCommitSeq` increases by exactly `1` steps only.
3. A `seq` may emit at most one terminal event.
4. `COMMITTED` requires a prior terminal state.
5. Window close requires all `seq` in window terminal and `nextCommitSeq > endSeq`.
6. Invariant violation is fatal and emits structured diagnostics.

## Diagnostics Snapshot Requirements
On invariant failure, snapshot includes:
- `nextCommitSeq`, `maxSeenSeq`, `terminalCount`, `inFlightCount`.
- Active window boundaries and occupancy.
- Oldest blocked `seq` and terminal state code.
- Buffered bytes and commit lag.

## Acceptance
Implementation is compliant when:
1. No ordered drain deadlock is possible without invariant failure.
2. Terminal count and commit cursor invariants are enforced at runtime.
3. Cancellation and retry behavior remain deterministic and auditable.
