# Nonrecursive adjacency delta pilot

The internal `views/adjacency-delta.js` owner implements one exact occurrence-to-edge
view. It reuses the existing prepared occurrence relation provider and its cursor;
it is not a general incremental database, publisher or recursive solver.

Bootstrap binds a source world, producer/epoch, rule/config/domain identity and
signed-occurrence-bag algebra. Rows retain immutable occurrence/support identities,
endpoints, source references and arbitrary-precision positive multiplicities (up
to 128 decimal digits). Two supports for one edge remain two supports. A payload
change requires a new occurrence identity. Incomplete input never authorizes
deletion by omission or a globally authoritative negative lookup.

Batches name the exact base root and from/to worlds. Edits coalesce under each
support identity; final negative accumulated support is an error, never clamped.
The snapshot and replay ledger are privately materialized together. Repeating an
identical producer/epoch/batch ID returns the current retained view without
reapplication; changed content under that ID is rejected. The ledger is scoped
by the immutable definition and bounded to 1024 batches. At that bound the batch
is unconsumed and explicit checkpoint work is required. No durable checkpoint or
restart deduplication is claimed by this in-memory pilot.

Every nonzero support change is returned even when edge membership is unchanged.
Membership changes are the separate accumulated-count zero crossings. Lookup
receipts retain the exact root/domain/key, including empty lookups, so consumers
can invalidate a prior negative observation when the world changes. The owner
does not itself confirm semantic observation equivalence across worlds.

Cancellation, insufficient work admission and support-count limits leave the old
view intact and the batch unconsumed. Invalid data and byte/coefficient overflow
throw before producing a replacement handle. Already returned handles remain
immutable and usable. Each view is explicitly `private-unpublished`; an existing
artifact/publication owner must admit and publish a compatible cohort. Captured
domain completeness, relation enumeration and semantic closure remain separate.

The bounded reference implementation permits 16384 supports/edits and 8 MiB
encoded snapshots by default. Input rows are byte-admitted before full cloning.
`maxWork` is an admission allowance for old supports plus incoming edits, not a
CPU accounting claim: coalescing, sorting, hashing, cloning, full membership
comparison and occurrence preparation still cost work proportional to retained
state. Encoded bytes are not heap/RSS. Old handles retain their own state; no
reader is revoked under memory pressure. This implementation establishes behavior
for a small view, not an incremental speedup.

Authored, unexecuted fixtures compare repeated additions/removals with independent
flat bag expansion and clean bootstrap. They cover one-of-many/last support
deletion, support-only replacement, duplicate/conflicting replay, stale worlds,
changed rules, unknown-to-present lookups, cancellation, work rejection and
coefficients above the exact Number range. Joins/anti-joins, arrangements, shared
publication, spill/checkpoint recovery, cost-based choice and qualified recursion
remain open issue #1516 obligations. No runtime qualification has been performed.
