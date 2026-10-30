# Published lock metadata reader lifetime

Status: source and authored regressions are **UNVALIDATED**. No test, syntax,
format, bootstrap, child/native or filesystem qualification has run.

The actual published lock release consumer reads metadata through
`file-lock-release-reader.js`, instead of the diagnostic `readLockInfo` helper's
catch-to-null fallback. The helper borrows an actual FileHandle through the
existing contained-file resource owner, preserving captured original native
read/stat/close methods and receiver. Its maximum allocation is the exact
original serialized lock byte extent. Positioned positive short reads complete
that extent in windows of at most 64 KiB; premature EOF or invalid progress is
a release failure. The opened descriptor's regular-file, link and sealed stat
identity must agree before and after reading. JSON parsing and owner checks
occur only after confirmed standard void close.

The existing publication owner checks original prerequisites before the read
and again after lazy import before admitting the new descriptor, after the
read, and before metadata removal. Its pathname identity checks remain in
place. The read helper has no metadata deletion, category or parent authority.
Its descriptor is new and never borrowed to an earlier release operation;
its own admitted read/stat errors and native observers govern actual close.

Read and independent close failures propagate without catch-to-null conversion,
including falsey/frozen originals. Failed close or pending original read work
withholds unlink and parent settlement. The parent records only capabilities
recognized by the existing private contained-file owner and exposes them as
non-enumerable `containedFileSession`/`containedFileSessions` on its retained
errors and authenticated release wrapper context. Serialized or field-shaped
capabilities cannot authorize native close. Each actual resource has its
existing own session; this introduces no group resource or alternate registry.

Reconciliation order is the exact read descriptor first, then the existing
published metadata owner. Explicit FileHandle close recovery uses the captured
original method without rereading, parsing, or removing metadata. Once the child
confirms, explicit parent retry performs a fresh physical/owner read before
removal. A valid parent recipe cannot override an unknown child observer.
No failed read value or successful release is replayed by close-only recovery.

The reader is imported only by the actual release consumer. Existing path-only
lock imports retain lazy descriptor/scheduler coupling; the shared diagnostic
and stale `readLockInfo` fallback behavior is unchanged and remains a separate
opaque-descriptor/read-error qualification gap.

`tests/shared/locks/file-lock-release-reader-lifetime.test.js` authors actual
published-lock FileHandle controls for close rejection and every nonvoid result,
original read work with absent/false/true flags, original method replacement,
falsey/frozen read plus close failures, positive short-read completion, invalid
progress, withheld unlink, explicit descriptor-before-parent recovery and
unchanged diagnostic fallback. Existing generic publication/release/falsey
fixtures remain. Native platform behavior, cross-process ownership, the final
non-atomic compare-and-unlink window, other raw readers, first-release worker
settlement and atomic publishers remain open; no issue completion is claimed.
