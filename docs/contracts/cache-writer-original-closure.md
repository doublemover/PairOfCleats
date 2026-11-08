# Original cache writer closure observations

The cache-writer release guard consults the original resource closure function
even when a separate pending flag is absent or false. A true observation must
precede lease assertion, invalidation and release. Missing/throwing observers
on a pending marker, or unreadable marker/observer getters, remain unknown and
retain ownership.

Combining an operation failure with a cleanup failure captures each original
function and receiver. Changing the error properties afterward cannot replace
those observations. Every independent original owner must confirm. Frozen or
unreadable diagnostics preserve the exact original failures and cause; diagnostic
formatting cannot replace them with a getter exception.

The existing drained-state requirement and resource owners still determine
whether work has actually stopped. This guard grants no native retry, child
termination, stale-lock cleanup or new resource identity. Its authored actual
guard/composition regression uses inert lease/resource controls and preserves
normal, undrained and unknown negatives. It is unvalidated; actual scoped child,
Windows/native lifecycle and stage-closeout acceptance remain separate.
