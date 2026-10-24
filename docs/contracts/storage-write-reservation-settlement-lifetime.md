# Storage write reservation settlement lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

The actual returned write-reservation owner retains every caught operation and
coordinator cleanup error, including null, undefined, false, zero and empty
string. Existing frozen/readonly code and reason descriptors remain attached to
their original cause and preserved projection. A secondary cleanup failure does
not replace or mutate the primary. Bounded diagnostic overflow stays unknown.

Captured original resource observations apply before metadata reads and unlink,
after awaited record checks, before coordinator release and before every explicit
retry. An observer is required even if its pending marker was absent or false.
Replacing an observer property or presenting another exact recipe receipt cannot
settle its original work. A receipt getter's thrown native/inspection error is
also retained before any metadata mutation. Ordinary invalid receipts retain the
existing rejection and cannot authorize settlement.

A failed current-reservation read can retain its actual FileHandle close owner.
The existing coordinator stays held until that original owner confirms closure.
The outward nonenumerable capability fields contain only sessions validated by
the existing descriptor/directory producers. After exact descriptor close-only
recovery, reservation reconciliation rechecks the still-owned metadata once
before removing it. That metadata check is part of settlement; descriptor
recovery itself never rereads or rehashes. No install, child, application write or
free-space probe is replayed.

Settlement failures expose the same actual returned reservation through
`storageWriteReservations` and `storageAdmissionSession`. There is no new owner,
resource registry, group identity or generic cleanup capability. Only exact
privately produced settlement errors are excluded from that owner's independent
prerequisite history, preventing its own unreleased-state predicate from blocking
the metadata reconciliation needed to settle it. Arbitrary marker fields, causes
or IDs cannot bypass an independent original observation.

Record removal requires the standard void fulfillment of the actual unlink
operation after the existing sealed hash/object checks. If removal succeeded and
coordinator cleanup failed, the owner retains its original coordinator handle and
retries only that metadata release; it never unlinks or reads the removed record
again. Concurrent explicit calls continue to share one settlement operation.
Original-work changes during unlink likewise retain the coordinator until they
confirm settlement. The outward error observer becomes true only after actual
owner release and all captured independent observations.

The authored actual-consumer fixture uses canonical disposable reservations and
real FileHandles/coordinators. It covers every falsey/frozen primary and cleanup,
readonly fields, actual reservation descriptor failure and exact recovery,
pending unlink observations across absent/false/true markers, a failed receipt
inspection and original state change during actual unlink, metadata-only retry
without double unlink, all nonvoid unlink results and no admission/probe replay.
Existing acquisition and concurrent-release fixtures remain authored unchanged.

The existing cooperative namespace and cross-process limits remain. Metadata
release wrapper propagation, atomic receipt publication, uncertain unlink
side-effects followed by missing metadata, hostile concurrent replacement and
durable native settlement require separate evidence/repair; this owner never
infers success from absence, PID death or a later recipe receipt. Unknown or
changed metadata can remain retained. No tests, syntax/lint/format, bootstrap,
native/platform/full-index or performance acceptance has run. No issue completion
or executable qualification is claimed.
