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

Memory validation freshness is measured from the last canonical observation,
independently of the sliding hit timestamp. Repeated hits cannot postpone that
validation forever. An expired or malformed timestamp is a miss and publishes no
touch. Each local session owns its entry metadata. Cached payloads are immutable;
hit rendering receives an independent mutable copy, so enrichment and caller
mutation cannot alter a later hit.

Hot retention orders newest write timestamps first. Overflow preserves the stable
order established by the preceding overflow, including equal timestamps; reading
an entry is not access-LRU. The cache-owned balanced index reconciles caller-mutated
timestamps in one pass and updates changed nodes. It does not sort every resident
entry on each overflow. Local parsed and hot caches each retain at most 128 paths
and 16 MiB of accounted serialized input or entries. These are serialized-byte
budgets, not process RSS guarantees. Local canonical checkpoints remain below
their reader's 8 MiB input limit.

Hits publish an awaited metadata-only `<cache>.touches.json` under the existing
canonical `<cache>.lock`. Repeated identities coalesce to their newest timestamp.
The journal is limited to 4,096 identities and 256 KiB, and the configured entry
limit can be lower. Admission failure falls back to a full checkpoint. There are
at most 128 pending paths, and each finite flight drains at most two batches.
Concurrent callers await the same flight; an already durable equal or newer
timestamp requires no new publication. Queued bytes have the same 256 KiB bound.
There are no detached flush tasks or shutdown-only promises. A process interruption before
the awaited atomic touch publication may lose that hit's recency update; the
already published immutable result remains usable under its previous timestamp.

Full checkpoints hold that same writer lock, reload current disk authority, fold
matching touches, merge concurrent entries, apply retention and publish canonical
data before clearing touches. Only explicitly changed payloads may replace disk
authority; recency-only submissions cannot overwrite a replacement or resurrect
an evicted entry. Equal timestamps preserve the established stable order. A
leftover touch journal after interruption is safe
to replay by exact payload identity. Optional cache-write failure can leave a hit
usable in memory without establishing persisted recency. Failed checkpoints keep
their dirty receipt for a deliberate retry. Cancellation checks precede hot miss
publication and canonical writes. Checkpoints join earlier touch publication
before taking the canonical lock, and an unresolved publication resource blocks
both touch retries and checkpoint fallback until its original settlement
prerequisite confirms release.

Federated parsed generations retain at most eight paths and 16 MiB of serialized
input. Each request owns its entry metadata while sharing frozen result payloads.
Immutable payload byte estimates are memoized; changing recency alone does not
serialize result payloads again. Canonical result replacement invalidates parsed
generation reuse. Relative-time and generation verification remain enforced by
the federated search coordinator.

The source and authored fixtures have not been executed or benchmarked during the
current development pass. These operation changes do not establish latency,
allocation, cross-process crash qualification or a production speedup.
