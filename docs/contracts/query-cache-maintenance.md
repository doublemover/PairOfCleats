# Query cache maintenance

Result payload identity includes the query/configuration/filter and index generation
signatures. A new persisted result receives a distinct payload ID. Recency metadata
can extend sliding TTL only when its key, signature and payload ID all match. It
cannot extend a replacement result or transfer between generations.

Local query-cache prewarming tracks the disk file generation and warm-prefix limit.
An unchanged generation and limit do not repeat the full prefix sort. A new prefix
merges newer disk entries into resident read-through entries. Capacity, finite
memory freshness and disk-first validation still apply. Missing or corrupt disk
data invalidates both parsed and hot state. File generation includes device,
inode, size and nanosecond modification/change metadata; externally forged identical
metadata is outside the local file-signature contract.

Hot retention orders newest write timestamps first. Overflow preserves the stable
order established by the preceding overflow, including equal timestamps; reading
an entry is not access-LRU. The cache-owned balanced index reconciles caller-mutated
timestamps in one pass and updates changed nodes. It does not sort every resident
entry on each overflow. Parsed/hot path counts remain bounded.

Hits publish an awaited metadata-only `<cache>.touches.json` under the existing
canonical `<cache>.lock`. Repeated identities coalesce to their newest timestamp.
The journal is limited to 4,096 identities and 256 KiB, and the configured entry
limit can be lower. Admission failure falls back to a full checkpoint. There are
no detached flush tasks or shutdown-only promises. A process interruption before
the awaited atomic touch publication may lose that hit's recency update; the
already published immutable result remains usable under its previous timestamp.

Full checkpoints hold that same writer lock, reload current disk authority, fold
matching touches, merge concurrent entries, apply retention and publish canonical
data before clearing touches. A leftover touch journal after interruption is safe
to replay by exact payload identity. Optional cache-write failure can leave a hit
usable in memory without establishing persisted recency.

Federated parsed generations retain at most eight paths and 16 MiB of serialized
input. Each request owns its entry metadata while sharing frozen result payloads.
Immutable payload byte estimates are memoized; changing recency alone does not
serialize result payloads again. Canonical result replacement invalidates parsed
generation reuse. Relative-time and generation verification remain enforced by
the federated search coordinator.

The source and authored fixtures have not been executed or benchmarked during the
current development pass. These operation changes do not establish latency,
allocation, cross-process crash qualification or a production speedup.
