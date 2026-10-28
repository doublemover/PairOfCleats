# Storage cleanup failure observation

Status: UNVALIDATED source and authored controls, 2026-10-22.

Cleanup preview authority errors, blocked qualification rows and apply failure
rows use the shared original-resource diagnostic guard. Pending original work
or an unreadable resource marker propagates instead of becoming an ordinary
row followed by qualification or deletion of the next operation. The captured
original observer and receiver remain authoritative even if a diagnostic field
or later assignment changes the pending marker or observer method. Independent
code/message inspection failures retain their original causes and observations.

Ordinary falsey failures produce typed `ERR_STORAGE_CLEANUP` records through the
existing blocked/failed row vocabulary. Preview identity, supplied launch
authority, command-probe producer qualification, content revalidation and
preserved evidence classes are unchanged. This adds no deletion authority or
automatic retry. Existing positive deletion coverage remains in
`cleanup-authority.test.js`.

The authored `cleanup-failure-observation` fixture creates actual disposable
producer bytes, authority marker and reviewed cleanup plans. Inert pre-open and
authority-stat failures cover every falsey value, original marker/observer
combinations, receiver and replacement negatives, stopping before a second
cleanup operation, independently pending diagnostic inspectors, unknown native
markers and unchanged candidate bytes. Nothing has been executed for this batch.

The original checkpoint did not retain exclusion for unknown native work or
repair lower resource ownership. The
[2026-10-28 source follow-up](../archived/cleanup-original-results-implementation-2026-10-28.md)
now captures original successful results and failures before generic/composed
exclusion release. It retains actual lock prerequisites, parent-reader suspension
and category leases. Explicit owners recover exact metadata after original work
settles, with no cleanup replay or circular aggregate predicate. A propagated
pending error alone still proves neither coordination nor native closure.
Seventeen additional controls are authored, unexecuted; broader custom producer,
cross-process, native, platform and CLI acceptance remains deferred.
