# LanceDB query and retired resource ownership

Status: source implementation and regression assertions are **UNVALIDATED_PARTIAL**.
No native import, test, editor host, benchmark, or model qualification was run for this change.

The retrieval connection cache owns each original native connection and table until its captured
`close` (or existing `closeSync` fallback) fulfills. It captures the method at acquisition. A later
property replacement, a path reused for a new connection, or a sibling resource does not change
that capability. A missing or throwing close getter leaves ownership pending.

Queries pin a connection before connect or table-open work is awaited. Cache capacity, TTL, and
explicit clear remove lookup ownership; active query leases retain their original native objects.
Connect, open, count, and query work is fully awaited. Cancellation does not race native work or
close a handle beneath a still-running operation.

Retirement tries every table independently. A failed table close retains that exact table and its
parent connection; the parent is attempted only after all its tables close. Successfully closed
tables are removed immediately and are not closed again if another table or the connection fails.
The cache retains failed retirement entries for the next explicit clear. A global clear attempts
every entry in its captured batch even if an earlier entry rejects.

A cleanup error exposes a nonenumerable `lanceDbOwner` capability and exact `cleanupErrors`.
`lanceDbOwner.close()` retries only that original entry (or the original failed entries of a global
clear batch). Concurrent calls share each entry's close flight. It never reopens the directory,
adopts a later native object, or drains newly admitted siblings. A leased entry returns
`{ settled: false, pending: true }`; a fully closed entry returns `{ settled: true, pending: false }`.

When query, table-open, or cancellation failure overlaps a close rejection, an `AggregateError`
retains the original primary cause and actual close error. Frozen errors are not modified.
Nonenumerable primary reconciliation descriptors are preserved. `cacheOwnershipReleased()` is
true only after the original native owner settles and every original nested ownership observer
explicitly reports release. Pending ownership without an observer remains pending. Provider
fallback does not consume a pending native cleanup error.

Cancellation arriving while the final lease closes also prevents result publication. The caller
must retain a nonserializable pending error/capability until reconciliation settles. This is a
resource ownership contract, not proof that a rejected native close is safe to retry in every
LanceDB runtime. Real dependency/runtime close behavior, cancellation timing, memory use,
filtered ANN recall, and performance acceptance remain separate qualification work.
