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
encoded snapshots by default. Bootstrap and each incoming batch use one bounded
passive canonical JSON capture. The aggregate allowance includes definitions,
worlds, IDs, rows/edits and container overhead, before parsing/cloning the owned
value. Accessors, sparse/decorated arrays, hidden decorations and invalid typed
fields are rejected without invoking getters. Bootstrap's byte limit itself must
be an own passive value. The resulting snapshot is also encoded under its byte
allowance before allocation of a replacement handle.
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

Delta validation, digest, coalescing, destination world, completeness and replay
ledger consume the same private capture. Option getters and the original
cancellation source are consulted only after that capture. Mutating caller-owned
input from a cancellation poll cannot change applied work. Cancellation is polled
once at initial admission, before each distinct support update, and before next
view construction; a cancelled transition remains unconsumed. Identical replay
still returns before cancellation polling, preserving its established ordering.
The normal algebra and valid-input identities are unchanged; this private
in-memory owner has no indexed semantic producer or durable replay cache to bump.

Additional authored controls mutate multiplicity, endpoints/source references,
world, completeness, batch ID and definition at first/later/final polls. They
compare old/new cursor bags against hand-computed counts and clean bootstrap,
check exact original replay and changed-content rejection, preserve native
cancellation/work rejection, and prove aggregate byte overflow precedes JSON
parsing. Those controls remain unexecuted with the existing flat multiset oracle.
