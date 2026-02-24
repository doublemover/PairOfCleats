# Stage1 Cancellation and Shutdown Spec

## Purpose
Define deterministic cancellation and shutdown behavior for Stage1 ordered runtime.

## Cancellation Flow
1. Receive cancellation signal.
2. Stop new dispatch immediately.
3. Allow in-flight tasks bounded grace period.
4. Terminalize undispatched `seq` entries as `TERMINAL_CANCEL`.
5. Terminalize expired in-flight entries by policy.
6. Drain commit cursor to policy boundary.
7. Emit deterministic stage summary and exit.

## Grace Policy
- `cancelGraceMs`: max wait for in-flight completion.
- `forceTerminalizeInFlight`: whether to force cancel at grace expiry.
- `drainBoundary`: `all_terminal` or configured partial policy boundary.

## Invariants During Cancellation
1. No new `seq` dispatch after cancel latch.
2. Every `seq` reaches a terminal state.
3. Commit cursor remains monotonic.
4. No orphan in-flight lease survives stage exit.

## Shutdown Ordering
1. Stop dispatch timers and window prefetch loops.
2. Drain commit loop.
3. Flush journal/checkpoint.
4. Release queues/resources.
5. Emit final telemetry.

## Acceptance
Compliant implementation demonstrates:
1. Deterministic final terminal counts for equivalent cancellation timing buckets.
2. No hangs during cancel + drain path.
3. Consistent final summary and checkpoint replay behavior.
