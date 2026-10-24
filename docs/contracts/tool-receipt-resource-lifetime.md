# Tool receipt publication and inventory resources

Status: **UNVALIDATED source and authored regressions**. No executable check,
fixture, format, bootstrap, installer or native acceptance has run for this
batch. Historical author-workspace release hashes are bookkeeping only.

The existing receipt API stays synchronous. Publication still uses an exclusive
same-directory temporary, flushed regular bytes, and an ordinary hardlink to the
immutable receipt filename. This creates no physical symlink. Identical existing
receipt bytes remain reusable; conflicting, unknown or invalid evidence is
preserved and refused. The persisted receipt vocabulary and versions are unchanged.

Publication tracks actual failure presence rather than truthiness. Null,
undefined, false, zero and an empty string remain exact wrapped causes. Cleanup
failure cannot replace the original error. The temporary becomes cleanup-owned
only after the original exclusive write call returns successfully and its actual
regular-file identity is captured. A write that throws can leave an unknown
temporary, which is preserved with its explicit diagnostic path rather than
adopted or searched for. This does not invent a FileHandle or numeric-FD
generation/closure proof for `writeFileSync` internals.

Owned temporary cleanup requires the captured parent directory and original
file dev/inode, birth time, size, mode and modification time. Hardlink publication
can change link count and change time, so those are not an unchanged-write proof.
Original stat/remove functions are captured for this cleanup. A replaced, missing,
unconfirmed or changed temporary is preserved; retry never discovers renamed
objects, republishes, overwrites a receipt or replays the original write.

Receipt inventory owns its actual opened `Dir`, original synchronous read and
close functions and receiver. Read and close failures are retained together.
Original independent observers, including observers with absent/false pending
markers, gate native close. A drained call or explicit false close result is not
confirmed close. Standard void fulfillment is valid; other synchronous return
values stay unknown and cannot become a promise-drain/native-close receipt.
A known failed close receives an explicit original-owner retry;
the original read is never replayed. Unknown original work remains pending.

`toolReceiptResourceSession` is nonenumerable diagnostic context. Only the actual
private producer map is accepted by `getToolReceiptResourceSession`; fields,
causes and copied receipts cannot forge it. The exact process-local session's
`releaseAfterClose()` returns `{resourceId, settled: true, pending: false}` after
original close and exact cleanup. Outward ownership predicates are immutable.
This owner creates no lease namespace or cross-process crash durability.

Before native close or removal, the owner prepares original diagnostics and
composes private storage-context inspection snapshots. A message/getter failure
can introduce independent native work. Its captured predicate and receiver stay
binding after field replacement. Bounds and unreadable evidence remain unknown.
Only exact same-owner failures are excluded from circular prerequisites.

The actual installer receipt-reporting catch now propagates unsettled ownership
instead of flattening it into a string and continuing. Settled ordinary receipt
failures still produce a verification failure. Lifecycle planning propagates
inventory ownership through its existing rejection path.

Authored `tool-receipt-resource-lifetime.test.js` controls cover actual disposable
receipt bytes/Dir handles, all falsey failures, frozen dual failures, original
observer replacement, message inspections, explicit close retry, unchanged target
bytes, temporary replacement, unknown ownership and forged capability fields.
The existing publication fixture retains normal/idempotent/conflict/bounded
inventory controls and adopts the actual cleanup retry. None has run. This does
not qualify hostile path mutation between identity check and remove, filesystem
crash recovery, arbitrary native work, cross-process ownership, Windows hardlink
behavior or the shared contained-file reader's separate descriptor-close scope.
