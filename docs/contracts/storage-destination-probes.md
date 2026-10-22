# Explicit destination checks

Source authored, **UNVALIDATED**. No user cache, index, installer or actual
destination was probed. Runtime and platform acceptance remain deferred.

`src/shared/storage/destination.js` supplies the explicit write check requested
by a configuration workflow. Its read-only `inspectStorageFreeSpace()` locates
the nearest existing ordinary ancestor, rejects link traversal and uses native
statfs available-block accounting. Unsupported/inexact accounting remains
unknown. The timestamped observation is not a disk reservation, allocated-file
measurement or reclaim receipt. The migration engine can consume it through its
explicit free-space owner and must continue to handle disk-full races.

`probeStorageDestination()` requires launch-authorized absolute storage roots,
an owned state coordination root and an explicit call. It cannot probe machine
storage inside a project or a filesystem root. Missing destinations remain
missing unless directory creation is explicitly selected. The probe uses a
unique exclusive file, verifies its opened descriptor/directory before payload
write, fsyncs and checks the read-back, then unlinks only that exact singly linked
file. Replaced or unreadable probe files are preserved with a recovery receipt.
Directory creation is reported and retained; it is never undone recursively.
No ownership marker, configuration update, migration or asset cleanup occurs.

The existing category session lease covers preparation, the exact descriptor,
the owned probe file and metadata cleanup. An unconfirmed close, failed unlink
or failed category-lease removal retains the lease and a non-enumerable
`storageDestinationProbeSession.releaseAfterClose()` capability on the returned
receipt. It retries the originally captured descriptor close with its original
receiver, then rechecks the exact singly linked file identity before unlinking,
then releases the original session. Concurrent retries share that work. An
exclusive-open refusal does not adopt or remove the colliding file. Missing or
changed file identity preserves evidence and cannot authorize cleanup.

The original receipt reports `writable:false` and `cleanupPending:true` until
the full cleanup settles; its getters follow a successful exact retry. Cleanup
cannot turn a failed write/read-back into a writable result. Frozen operation
and cleanup failures remain available as exact causes; retry failure retains
the same capability. Diagnostic cleanup history is bounded independently from
captured native observations. A pending original observation must confirm with
its captured receiver before file or category cleanup, even after successful
descriptor close. Missing/throwing observers remain unknown. Only the matching
session producer's privately branded metadata-release failure is exempt from
that independent-resource gate, so its own metadata removal remains retryable.
A syscall promise failing is not assumed to prove that its resource is
disposed. Windows junction/UNC/antivirus sharing
and directory-replacement qualification are still required; this source does
not assert native dirfd/create-by-handle guarantees that Node does not expose.

The authored `destination-probe-resource-recovery` regression uses disposable
actual FileHandles and category leases with injected close, unlink and metadata
removal faults. It covers frozen causes, concurrent original-close retry,
bounded diagnostics, independent known/unknown observations, replacement-file
preservation and exclusive-open refusal. The existing free-space/probe fixture
continues to cover ordinary success and explicit directory creation. Neither
fixture has been executed for this change.

Quota planning now requires explicit `inventoryComplete:true` before admission
can be satisfied. An empty or partially supplied item list cannot become proof
of zero usage. Unknown allocation, physical identity, references or leases
continues to defer/deny eviction while preserving evidence.

Migration crash recovery keeps stages without a valid exact owner marker as
unknown evidence. Resume records that path, selects a fresh run stage and
retains the old bytes. It does not rename, adopt, recursively remove or merge
the unknown stage. The journal bounds retained unknown stage references and
requires review once that bound is reached. A single crash between mkdir and
marker publication can therefore resume without sacrificing the ambiguous
directory or the source.
