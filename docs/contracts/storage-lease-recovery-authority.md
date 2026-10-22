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

If the new lease itself cannot be removed after observing cleanup/delegation
exclusion, its actual admitting owner retains a process-local failed-admission
capability. Serialized or copied properties cannot recreate that capability.
The outer storage session adopts this exact last lease even though acquisition
threw before returning normally. Its rollback attempts all earlier admissions;
unknown metadata never becomes an inferred owner. Authored direct/outer refusal,
unlink failure, exact retry and forged/copy refusal controls remain unexecuted.

Index metadata release now retains one actual file-lock removal operation across
its cleanup deadline. The deadline producer binds an error to a process-local
owner token; matching error codes, labels or serialized properties cannot supply
that identity. Only that owned metadata deadline gains an observer for eventual
successful release. A late exact unlink is therefore observed before retrying
category lease release, without attempting to remove an already-absent lock.
Independent child/native pending markers still require their original observers.
The generic cleanup timeout still makes no native resource settlement claim.

Path-only index lock consumers load no storage launch-resolution adapter. The
category bridge is imported only for explicit launch context. Authored actual
file-lock/gated-unlink/deadline controls, an unbranded pending-marker negative
and the import-boundary fixture remain UNVALIDATED.

Managed physical installation retention now uses that same storage session for
its explicit tooling category and selected installation owner. A second-root
refusal retains failed rollback of the first root and any actual final refused
lease; release attempts every original handle before reporting failure. Failure
of the second byte inspection also preserves its primary error and the exact
session if rollback fails. The second inspection pins both the originally
selected descriptor and install identities. Returned `release()` stays owned by
the concrete child/resource consumer; a successful version probe alone cannot
authorize calling it. An exact nonenumerable `storageSession` remains available
for failed metadata settlement. The shared failure-composition function is
reused rather than introducing another multi-root rollback implementation.
Actual disposable receipt/inspection/exclusion controls with injected unlink and
post-admission read failures are authored only, including successful re-admission.
No installation, native probe, physical link or user-cache operation was run.
