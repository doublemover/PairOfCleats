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

Indexing, watch and standalone embedding writers acquire the existing index lock
with internal `resourceSettlementVersion: 1` before admitting work. A cache-writer
lease requires this same marker and exact lock identity on disk. Exit and signal
handlers cannot unlink it. The common stale-lock owner, including forced stale
cleanup, and the language benchmark's lock check preserve any settlement marker,
including unknown versions. Only explicit owner release after required drain
ends this exclusion. An unknown/lost owner remains blocked; this change does not
invent a resource census or an automatic orphan-recovery authority.

Process-scoped locks keep their existing exit cleanup and dead-owner recovery.
Stage4 pointer promotion remains process-scoped because it acquires that lock
after its SQLite work has completed. The benchmark no longer treats the age of
a live process as permission to delete its lock; age remains diagnostic.

Runtime/closeout and operational/cleanup aggregates preserve every pending marker.
Where original resource owners supplied exact release observers, an aggregate
requires every observer to return true. Missing or throwing observers remain
unknown. Original primary errors and secondary diagnostic failures stay available.
These observers never bypass a failed drain or a prior required closeout failure.

Authored controls retain an actual disposable cache lock across required metadata
failure, verify attempt-all cleanup and optional behavior, and carry the existing
real delayed-child close through an aggregate into the exact lease release guard.
They have not run; no current-source Windows, native or final-tree pass is claimed.

Fresh-process controls cover normal/forced parent exit, a controlled emitted
signal, explicit drained release, common forced-stale and benchmark admission,
and the retained process-only recovery positive. The existing killed-writer
fixture now keeps its recovery assertion on a process-scoped owner: the previous
assertion did not establish settlement for an outliving child. Existing actual
delayed-child-close coverage remains alongside these metadata lifetime controls.
