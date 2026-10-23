# Embedding cache profiles and chunk references

Persistent embedding indexes write beneath the existing configured embedding
cache root. Layout 3 appends `profiles-v3/<complete identity key>` after the
readable provider/model/dimensions labels. The complete key retains model artifact,
revision, formatting, pooling, normalization, quantization and execution identity.
Sanitized labels cannot merge two profiles. Canonical index and metadata files
remain independently validated against that full identity.

Layout 2 profile directories and legacy tuples are read-only compatibility tiers. Index, standalone
entry and metadata reuse still require matching identities. New writes never
overwrite a legacy profile inventory. This compatibility tier is not a whole-app
relocation or cleanup transaction. `resolveEmbeddingCacheProfile` exposes both
locations and lifecycle ownership for the shared storage descriptor, migration
and quota owners. V3 adds a bounded eight-entry profile budget catalog, using the
existing file-lock and shared storage session/exclusion/lifecycle owners. Earlier
writers did not acquire these leases, so their V2 and tuple bytes are preserved
for migration rather than granted new deletion authority.

Managed V3 history admits at most eight profiles and defaults to a finite 2 GiB
ordinary-file-length budget. Existing positive `cache.maxGb` and `cache.maxAgeDays`
values supply the byte and age policies. Admission reserves encoded payloads,
index projections and replacement overhead before publication. Active, unknown,
unreadable, linked or changed candidates block optional persistence when no safe
retirement satisfies the bound. Whole-profile retirement revalidates a complete
producer/reference closure under shared exclusive storage admission.

The catalog is at most eight records/64 KiB. Hot appends update this bounded
metadata rather than scan every file index. Dirty/crash recovery and settled
maintenance use bounded inventory (8,192 entries/two seconds); incomplete scans
deny admission. Live native owners retain their prepaid byte reservations through
reconciliation. Profile access uses bounded advisory touches, and retained shard
descriptors are capped at sixteen with confirmed original closure required before
their profile leases release. Reservations can conservatively deny a cache write;
the required vector artifact producer continues independently.

This budget describes managed V3 ordinary file lengths. Older compatibility
bytes, filesystem allocation, compressed/sparse allocation and deleted-open bytes
remain separate observations, not inferred free space or whole-app quota proof.

New file-cache records contain ordered references and file hashes/signatures,
rather than a second copy of all three vector channels. Immutable chunk keys
include the complete embedding identity, chunk input and quantized channel-content
digest. Duplicate positions retain order and channel lengths. Identical payloads
can share bytes, while different quantized results for one input remain distinct.
An input alias selects a compatible current payload for cross-file reuse.

The existing global shard lock covers chunk append/index publication through the
dependent file-index publication. File-index projections are reference authority
for pruning. Shared chunk cleanup retains referenced entries and their physical
shards; missing or unreadable reference ownership blocks cleanup. A reader leases
the same lock while materializing references. Retired file keys release retention;
quota pressure that cannot evict protected bytes reports an exceeded budget.
Canonical chunk payloads precede file admission, so interruption can leave
reclaimable chunks without publishing a dangling dependent file record.

Reads coalesce chunk ranges, materialize bounded batches and verify identity,
input, channel lengths and content digest. Missing or corrupt content is a
repairable cache miss. File records are bounded to 32,768 references and 64 MiB of
materialized vector data, with bounded transient hydration admission. Required
published vector artifacts keep their separate owners. No native speedup, corpus
compression ratio, cross-process crash qualification or whole-app quota acceptance
is claimed by these source changes.

Canonical metadata must match the complete profile key as strictly as the legacy
tier. Repeated references to one immutable chunk must agree on its hash, digest
and channel lengths before any read. Hydration accepts only complete bounded
read batches; cancellation and unresolved resource failures remain failures.
The compressed codec limits native decompression output to the caller's entry
allowance (at most 64 MiB), caps row count at 32,768, and rejects trailing bytes or
noncanonical section metadata. Shard and standalone consumers pass their actual
read allowance through this boundary before admitting rows.
Empty documentation rows survive prior-file, global-chunk and in-memory reuse;
they do not require another inference or replace already admitted code bytes.

The locked index journal uses read/write handles with explicit offsets. This
allows Windows to truncate a checkpointed or interrupted tail while retaining
the existing checksum, sequence and cleanup-failure contracts.

Prune/compaction builds a generation-local physical-path summary after logical
retention. Each shard carries its live entries/bytes and newest access timestamp;
physical eviction compares these scalars and removes the recorded keys only after
successful file deletion. An orphan uses its file modification time. A compaction
that moves pointers triggers one explicit summary rebuild before physical eviction.
Inventory visits each resolved path once per phase, retaining regular-file,
symlink, realpath and root-containment checks. Protected metadata and shared-file
reference pins remain independent eviction barriers. `work.summaryEntryVisits`
reports summary construction visits; it is operation accounting, not elapsed-time
or lock-duration qualification.

The runner connects the configured persistent text cache to its existing batched
write/coalesced-touch store. A connection prepays a 64 MiB SQLite page capacity and
bounded rollback-journal allowance before opening. DELETE journaling and the exact
native page limit must be confirmed. The original database closer and profile
lease survive failed teardown; a retry cannot replace that closer or omit an
original pending-resource prerequisite. Pending vector writes remain capped at
256 keys/4 MiB, touch keys at 1,024, and digest memoization at 4,096 keys. Native
SQLite limits, crash behavior, accuracy and throughput still require external
qualification; authored source controls are not executed evidence.
