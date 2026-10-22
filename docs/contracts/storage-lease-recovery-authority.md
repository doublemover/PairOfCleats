# Storage lease recovery authority

Source and regressions are **UNVALIDATED**. No real lease recovery, process
inspection, native host or user-cache operation was executed for this change.

Repo-access payloads and default coordination directories retain their existing
protocol. Known ordinary reader/exclusion records contain scope, hostname,
PID, lock ID, start timestamp and optional resource ID. Unknown fields,
reference/retention annotations, orphan delegated-child records, foreign or
malformed metadata and noncanonical reader filenames remain protected evidence.
Diagnosis is read-only and never reaps a record.

Local ESRCH is the required death proof. Permission errors, invalid or
out-of-range PIDs, PID reuse and every other unknown liveness result retain
ownership. Ordinary reader and collector recovery uses only the exact existing
lock ID; elapsed age and failed owner removal cannot enter a force fallback.
An unsettled child delegation blocks recovery even when its parent is dead.

Both default and explicitly supplied coordination paths are checked for links
and containment. Bounded lease inventory returns protected state on unknown,
unreadable, incomplete or unconfirmed-close paths. Ordinary admission removes
only its own exact new lease when it observes exclusion; cache/user evidence is
never part of metadata recovery.
