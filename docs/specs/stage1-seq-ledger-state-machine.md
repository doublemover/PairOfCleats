# Stage1 Seq Ledger State Machine Spec

## Purpose
Define legal `seq` state transitions, ownership leases, and failure handling for the Stage1 hot path.

## State Codes
- `0 UNSEEN`
- `1 DISPATCHED`
- `2 IN_FLIGHT`
- `3 TERMINAL_SUCCESS`
- `4 TERMINAL_SKIP`
- `5 TERMINAL_FAIL`
- `6 TERMINAL_CANCEL`
- `7 COMMITTED`

## Transition Contract
Only these transitions are legal:
1. `UNSEEN -> DISPATCHED`
2. `DISPATCHED -> IN_FLIGHT`
3. `IN_FLIGHT -> TERMINAL_SUCCESS`
4. `IN_FLIGHT -> TERMINAL_SKIP`
5. `IN_FLIGHT -> TERMINAL_FAIL`
6. `DISPATCHED -> TERMINAL_CANCEL` (cancellation before work begins)
7. `IN_FLIGHT -> TERMINAL_CANCEL` (forced cancellation after grace policy)
8. `TERMINAL_SUCCESS -> COMMITTED`
9. `TERMINAL_SKIP -> COMMITTED`
10. `TERMINAL_FAIL -> COMMITTED`
11. `TERMINAL_CANCEL -> COMMITTED`
12. `TERMINAL_* -> DISPATCHED` only for retryable fail classes and only when current state is `TERMINAL_FAIL`.

## Illegal Transition Policy
1. Any transition not listed above is illegal.
2. Illegal transitions hard-fail Stage1 immediately.
3. Failure output MUST include `seq`, prior state, attempted state, owner id, and wall-clock timestamp.

## Atomicity
1. Transition evaluation and write are atomic at `seq` granularity.
2. Terminal event emission is single-shot; second terminal event for same `seq` is fatal.
3. Commit marking is idempotent for replay but no-op only when prior state already `COMMITTED`.

## Lease Ownership
- `leaseOwner[seq]`: worker token that currently owns `seq`.
- `leaseHeartbeatMs[seq]`: monotonic heartbeat timestamp.
- `leaseExpiresMs`: configured timeout.

Rules:
1. Entering `IN_FLIGHT` requires lease ownership.
2. Active worker updates heartbeat on progress ticks.
3. Expired lease allows reclaim to `DISPATCHED` or `TERMINAL_FAIL` per retry policy.
4. Reclaim decision must be deterministic under fixed policy inputs.

## Retry Guard
1. Retry never changes `seq`.
2. Retry increments `attempts[seq]`.
3. Retry allowed only for classes marked retryable and while budget remains.
4. Retry exhaustion transitions to `TERMINAL_FAIL`.

## Constant-Time Counters
Ledger writes maintain:
- `terminalCount`
- `inFlightCount`
- `dispatchedCount`
- `committedCount`

No full ledger scan is allowed in steady-state hot path.

## Acceptance
Compliant implementation demonstrates:
1. Full legal transition coverage in tests.
2. Fatal behavior on illegal transition injection.
3. Deterministic lease reclaim and retry outcomes.
