# Required closeout and cache authority

Status: source implementation and authored regressions, unvalidated (2026-10-22).

The existing closeout registry attempts required cleanup in order and retains
every failure. The stage cache-lock release step requires all prior required
steps to succeed. A heartbeat or build-state flush failure cannot be ignored
because runtime teardown later completed. Remaining teardown still runs; failed
prerequisites prevent lock release and retain explicit pending ownership.
Optional diagnostic steps retain their existing nonblocking meaning.

A generic cleanup timeout marks an unfinished operation as pending. Later promise
fulfillment alone cannot prove native or writer closure, so the timer creates no
release predicate. Recovery needs the actual resource owner's fresh evidence.
No elapsed deadline, discarded error or dead-PID inference grants replacement
write authority.

Runtime/closeout and operational/cleanup aggregates preserve every pending marker.
Where original resource owners supplied exact release observers, an aggregate
requires every observer to return true. Missing or throwing observers remain
unknown. Original primary errors and secondary diagnostic failures stay available.
These observers never bypass a failed drain or a prior required closeout failure.

Authored controls retain an actual disposable cache lock across required metadata
failure, verify attempt-all cleanup and optional behavior, and carry the existing
real delayed-child close through an aggregate into the exact lease release guard.
They have not run; no current-source Windows, native or final-tree pass is claimed.
