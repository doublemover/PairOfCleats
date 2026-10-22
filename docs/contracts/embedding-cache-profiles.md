# Embedding cache profiles and chunk references

Persistent embedding indexes write beneath the existing configured embedding
cache root. Layout 2 appends `profiles-v2/<complete identity key>` after the
readable provider/model/dimensions labels. The complete key retains model artifact,
revision, formatting, pooling, normalization, quantization and execution identity.
Sanitized labels cannot merge two profiles. Canonical index and metadata files
remain independently validated against that full identity.

Legacy tuple directories are a read-only compatibility tier. Index, standalone
entry and metadata reuse still require matching identities. New writes never
overwrite a legacy profile inventory. This compatibility tier is not a whole-app
relocation or cleanup transaction. `resolveEmbeddingCacheProfile` exposes both
locations and lifecycle ownership for the shared storage descriptor, migration
and quota owners. Cross-profile quota/retention acceptance belongs to that shared
policy; new layout isolation does not establish a bounded history of profiles.

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
