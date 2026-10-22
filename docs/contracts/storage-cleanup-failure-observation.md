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

The apply callback's existing exclusion release occurs before outer failure
reporting. This change therefore does not retain that exclusion for unknown
native work, repair coordinator cleanup failure composition, or repair the lower
contained-file descriptor-close lifetime. Those remain open implementation and
qualification work. A propagated pending error alone is not evidence of held
coordination or native closure. Cross-process, native, platform and CLI
acceptance remains deferred.
