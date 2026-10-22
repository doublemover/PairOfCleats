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

The existing category session lease covers preparation and probe lifetime. A
failed unlink after confirmed file close leaves recovery evidence. An
unconfirmed close retains the resource lease and returns an actionable session
for its real close owner to reconcile. A syscall promise failing is not assumed
to prove that its resource is disposed. Windows junction/UNC/antivirus sharing
and directory-replacement qualification are still required; this source does
not assert native dirfd/create-by-handle guarantees that Node does not expose.

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
