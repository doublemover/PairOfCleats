# Benchmark evidence retention

A/B sweeps and embedding bakeoffs use unique invocation directories and the
existing storage reservation, atomic-write and file-lock owners. Admission counts
the complete family namespace, including active, unknown and referenced files,
against a fixed **2 GiB logical-byte budget**. Declared run allowances cover raw
reports, immutable output and settlement metadata. This is cooperative admission,
not a filesystem quota against unrelated writers. No public setting is added.

A final report, saved export or published resume checkpoint can be copied outside
the repository. A run therefore becomes permanently pinned before it first issues
such a reference. Final receipts also independently prevent retirement. Later
runs cannot invalidate the raw paths and digests in those reports. If protected
evidence fills the budget, new runs fail admission rather than deleting it.
Explicit user exports outside the family directory remain user-owned.

Only known, settled, unreferenced runs at least **seven days old** qualify for
automatic retirement. A complete flat inventory binds every producer file to its
exact native file identity, byte extent and SHA256, captured from one original
descriptor. The settlement record and run/root markers identify that same
directory and invocation. Copied markers, hard-linked files, extra or nested
children, missing records, changed bytes, legacy evidence and active or unconfirmed
writer fences remain protected. PID death alone never establishes settlement.

Collection holds the existing family maintenance lock and an actual per-run lock.
It admits the complete member set before deleting anything, rechecks each original
file before unlinking, and removes only an empty original directory. It never
recursively deletes benchmark directories. A late unknown child survives and
prevents directory removal. The scan has entry, byte and time bounds; incomplete
inspection grants no additional deletion authority.

Accepted child work, writes and their original resource observations must settle
before the run closes. Ordinary failed work can close its actual resources while
leaving evidence protected. An unconfirmed native operation or metadata release
retains its original owner for explicit settlement recovery; recovery does not
repeat a benchmark, child process or failed publication. A/B finalization also
checks raw files against the exact bytes admitted by the parent report reader.

Implementation is **functionally unqualified** at
`a073483b9668e58e5c52f9bc62d917814ca0c6e3`; the
[source receipt](../archived/benchmark-evidence-retention-implementation-2026-10-28.md)
lists authored controls and remaining acceptance. Historical author-workspace
`.testLogs/` and `.tmp/` files are not promised in clean checkouts.
