# Copy and replacement resource lifetime

Status: UNVALIDATED source and authored controls; runtime/native/physical-link,
cross-process, coupling and performance acceptance remain deferred.

Durable copy and atomic write now share one parent-directory sync helper, using
the existing descriptor resource owner and exact admitted directory identity.
Durable copy keeps the native copy operation, then owns the actual target
FileHandle/numeric descriptor through original stat, sync and close. The target
pathname and source identity are checked against sealed exact native observations;
target durability is not acknowledged before close. Original pending sync/close
or parent work propagates its actual private descriptor capability.

Replacement's generated backup and cross-device staging names use exclusive copy
creation. The actual copied-target identity is reported synchronously to the
existing replacement owner while the descriptor remains owned; cleanup still
requires every original native prerequisite to settle. Names without such a seal
are evidence, never adopted from a failed copy's pathname afterward. Source and
staged identity are rechecked immediately before each existing rename attempt.
Atomic writers pass their original descriptor prerequisite into that boundary.

Rename retries keep their existing bounds and supported-error set. Original
resource observations across admitted attempts are captured before code
projection and checked before retry/fallback, after projection and before later
cleanup. Getter replacement or a false/absent marker cannot turn unknown native
work into an ordinary retry or EXDEV copy. Nonvoid syscall results are not success
receipts. Bounded observation overflow is retained as unknown ownership.

Failed replacement composes original and cleanup failures, forwarding only actual
descriptor capabilities. No `finally` removes an unsealed name or ignores failed
close. Sealed cleanup rechecks identity and all original prerequisites after
lookup and before removal. Unconfirmed publication preserves backup evidence
unless the original source and original visible target still match. A confirmed
commit is retained even when source cleanup or reporting fails. Error context
records committed/unconfirmed state and retained paths; close-only reconciliation
never recopies, renames, publishes, reports or cleans metadata automatically.

`tests/shared/io/persistence-resource-lifetime.test.js` authors actual durable
copy and replacement consumers for captured methods, backup/EXDEV target failed
close, pending original sync, no-replay recovery, retry/classification observer
replacement, cleanup prerequisites and unknown synchronous descriptor generation.
The original visibility fixture retains every complete-old-or-new, one-rename,
retained backup, final payload and abrupt-exit assertion. Its interrupted-copy
hook creates a partial name *before* the original copy opens it. That path now
has an explicit preservation assertion: it is unsealed external evidence,
whereas sealed failed-commit staging and backup still must be removed. Exclusive
flags pass through its native wrappers. No crash/child case was executed here.

These comparisons do not provide an atomic portable compare-and-unlink/rename
syscall, make externally mutable input an immutable snapshot, settle unreported
native work, or add category/coordinator authority. Native copy's own internal
descriptors remain governed by its fulfilled/rejected API result; a rejected
unsealed copy cannot grant deletion authority over a partial pathname. Directory
replacement's independent catches and other raw stream consumers remain separate
work; no JSON-stream source or token-postings loader is edited by this owner.

The October 24 Windows repair corrects directory EXDEV fallback: the exclusively
created staging root is enumerated through the existing directory owner, and
each child is copied into its own absent destination with `force:false` and
`errorOnExist:true`. Copying the source onto the already-created root rejects
that root on Node 26. Child copying retains all original observation and root
identity checks, including nested/empty directories. Pending copy work retains
the actual directory recovery capability as well as the original backup; its
closure cannot be inferred from copy settlement. The focused directory fixture
passes; broader platform, publication and persistence qualification stays separate.
