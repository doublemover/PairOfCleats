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

Resource sessions preserve actual primary and settlement failures together.
Frozen or readonly errors use an aggregate whose exact original cause and
non-enumerable owner capabilities remain reachable. Nested sessions keep each
handle on its original cause. Original closure observers are captured before
composition; every pending owner must confirm, and missing/throwing observers
stay unknown. A supplied `pending:false` receipt cannot override an original
pending resource whose observer still returns false. Explicit session release
still needs that session's exact resource identity, settled:true and pending:false.

Authored controls use disposable ordinary storage roots and actual exclusion
owners with inert frozen/readonly failures, contradictory receipts, independent
pending observers, nested sessions and the normal successful release path. They
have not run; no resource runtime or current-source acceptance is claimed.

Partial admission constructs the same session owner before acquiring its leases.
If a later root refuses admission, rollback attempts every earlier exact handle.
Failed removals retain that partial session on the original admission failure;
reconciliation requires the exact resource receipt and retries only those original
handles. Normal release also attempts every owned lease before reporting failure.
Unsealed records that never yielded a known handle remain protected evidence.
The authored partial-admission fixture denies a later root, injects an actual
earlier metadata unlink failure, checks later cleanup and exact retry, and retains
the normal subsequent-admission positive. It is unexecuted.
