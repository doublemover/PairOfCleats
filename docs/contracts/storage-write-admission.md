# Storage write admission

Source and authored regressions are **UNVALIDATED**. No admission, child,
cleanup or user-cache operation has been executed as implementation evidence.

`acquireStorageWriteReservation()` requires an absolute launch-authorized root,
an explicit resource ID and exact nonnegative required-byte estimate. The
existing file-lock owner serializes admission under the explicit state
coordination root. Pending reservation files remain until exact resource
settlement; a dead parent PID, timeout or disconnected child cannot reap them.
Unknown, foreign or unreadable reservations defer new writes.

Admission compares native free space with declared new writes, the minimum-free
reserve and all pending reservations on the observed device using BigInt.
Optional hard budgets count unique logical file bytes, including unknown and
saved data, plus pending/new estimates. Incomplete inventory or unsafe aggregate
arithmetic defers admission. It never chooses saved data for eviction. These
are cooperative application estimates, not filesystem capacity reservations or
kernel-enforced limits against unrelated processes or an underestimating tool.

`runManagedChildWithStorage({plan, authorizedRoots, coordinationRoot,
admission:{writes:[{root,requiredBytes,minimumFreeBytes,hardBytes}]}}, execute,
{settlement})` acquires reservations before preparing directories or executing
the child. Each estimate uses the existing resource lifetime. Missing/invalid
settlement keeps both leases and reservations; errors expose the same
`storageSession` and `storageWriteReservations` handles for the actual owner's
later reconciliation. Existing callers without an admission policy preserve
their behavior and cannot claim quota coverage. Installer/model callers must
provide their real estimates and actual child/session settlement.

The actual command-probe writer now admits writes before publication. Its
existing 256-entry bound and 8 MiB bounded-reader limit constrain category bytes.
One exact-owner synchronous admission lock serializes producer writes while an
existing scoped repo-access lease excludes reviewed cleanup. Unknown files,
pinned/retention/reference fields, incomplete inventory and header-only objects
are preserved and block growth. Eviction uses the real complete producer key
and exact file identity; age alone grants nothing. Legacy read compatibility
does not grant overwrite, prune, invalidate or reviewed cleanup authority.

Quota plans distinguish proposed reclamation from actual admission. A plan that
would satisfy budgets after cleanup returns `defer-reviewed-cleanup-required`;
selected bytes have not already become available. Unsafe sums and incomplete
accounting never nominate eviction candidates.
