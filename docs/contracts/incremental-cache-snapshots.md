# Incremental cache snapshot ownership

Canonical bundle and VFS source keys preserve filename case on every platform.
Segment rebasing copies metadata before adjusting coordinates; reusing one source
chunk cannot compound offsets or mutate a prior result. Future ordering-ledger
versions retain their format identity through compatible patches.

Registry operations accept borrowed locks only as live capabilities minted by
the registry lock owner, bound to the exact root, domain and on-disk lock UUID.
Domains are single safe path tokens. Release-shaped impostors, released leases
and cross-domain handles cannot bypass lock acquisition. Checkpoint mode and
grammar filenames retain raw-key digests when sanitization changes spelling;
duplicate persisted checkpoint slice descriptors fail closed before new writes.

Cache ownership ends only after the file-task registry and scheduler/pool owners
confirm drain. Scheduler deadline expiry raises `ERR_SCHEDULER_DRAIN_TIMEOUT`
for enabled and disabled execution; it never reports completion. An ordinary
idle watch cycle retains reusable runtime controls. A live-writer failure forces
teardown and stops that watcher. Incomplete teardown retains the cache lease and
reports the original operational error together with cleanup failure.

The repository index lock owns incremental manifest loading, source work,
bundle publication and cache collection. Ordinary builds and watch attempts use
the same lock. A streamed Stage3 borrows the outer build's lease; it cannot
release or reacquire it. Cleanup must confirm writer drain before ownership is
released. Failed or timed-out teardown retains ownership until the process exits
or the existing dead-process lock recovery can reclaim it.

Bundle admission requires the selected manifest entry's canonical source key,
source hash, dependency identity and complete contiguous shard inventory. Each
shard has an immutable content identity. Stage1 `resume-*` snapshots remain pinned
independently of richer Stage2/Stage3 `snapshot-*` replacements. Changes to current
dependencies still use the existing per-stage refresh policy after snapshot
admission. A bad file is a cache miss; intact siblings remain reusable.
After durable manifest publication and writer drain, the same collector retires
unreferenced ordinary `snapshot-*` files even when semantic indexing is disabled.
This recovers snapshots abandoned between bundle write and manifest publication;
the nonsemantic sweep leaves retained Stage1 descriptors and semantic objects alone.

Bundle source keys normalize separators and dot aliases to safe repository
relative POSIX keys. Absolute paths, root escapes and NUL bytes are rejected.
Explicit chunk IDs and chunk/shard order remain unchanged.

SQLite incremental reuse additionally binds the full finalized immutable shard
inventory and dependencies through schema-17 `file_manifest.bundle_hash`.
Risk-only, docmeta-only and neighbor-driven inferred-type changes replace affected
snapshots and rows while source/hash/stat identity stays fixed. Unchanged finalized
snapshots do not require reserialization or row updates. Schema mismatch or unknown
finalized authority requires rebuild/refresh rather than a source-only no-op.

Incremental manifest schema 6 stores repeated dependencies once in a normalized
table. Both build and SQLite/embedding consumers use the same codec. Previous
persisted layouts reject explicitly and require a source rebuild; there is no
compatibility migration. Manifest publication has a strict 8 MiB encoded bound.
Capacity refusal happens before atomic replacement, preserves the prior readable
manifest and its snapshots, and never quarantines valid oversized metadata as
corruption. Coarse-timestamp whole-index reuse verifies source content rather than
relying on equal size and mtime alone.


New immutable snapshots may publish a `parseCheckpointDescriptor` locator containing schema version, exact encoded byte count and SHA256. The sidecar name is derived from the first selected immutable bundle name plus `.parse-checkpoint.json`; arbitrary locator paths are not accepted. Its envelope binds current artifact identity, canonical source path/hash, parse dependency signature and the complete selected bundle inventory. It contains parse geometry/diagnostics only, never the lexical chunk payload. The locator joins the manifest only after descriptor durability. Existing bundle retention and post-manifest garbage collection own its lifetime and disk credits. Missing older locators use ordinary parser scheduling.

Checkpoint planning streams eligible descriptors with at most four concurrent reads and a shared encoded-descriptor plus fixed source-read-buffer allowance. It retains only eligible path names, removes the arbitrary first-1,000-entry cutoff, and reports verified descriptor bytes and observed source verification bytes. Source hashing remains necessary on mutable filesystems; equal size/mtime is insufficient. Descriptor corruption is a planning miss; permission/resource errors and cancellation remain errors, and all started reads drain on failure. These counters are not heap/RSS measurements.

A parse descriptor is an independent source/parse-qualified product, not proof that lexical shards or a semantic generation are complete. Nonsemantic processing may recover its geometry after a lexical shard miss, but freshly reads and verifies the source before supplying that geometry to the ordinary chunk validator. It does not mark lexical/enrichment lanes reused. Semantic scheduling continues through the full native/fact owner unless the existing durable completion verifier admitted that file. Ordinary whole-bundle replay still validates every selected shard. Authored descriptor, beyond-first-1,000 eligibility, same-stat mutation, corruption, cancellation and cleanup controls are unexecuted.


SQLite bundle ingestion consumes immutable shards in selected manifest order through one writer and one enclosing database transaction. Each manifest-owned shard is checked against the same source/dependency/index/count/content identity as ordinary incremental replay; an independently valid shard checksum is insufficient. Explicit legacy bundle names retain their existing reader contract. A later corrupt shard rolls back earlier shard insertions and cannot publish a partial file/database. Fallback document IDs follow manifest then shard order.

Decode admission keeps encoded-input scratch and two bounded logical decoded projections charged until ordered consumption. At most the existing worker count is pending; memory-derived byte limits constrain read-ahead, with one indivisible oversize shard permitted alone. Projection accounting traverses actual returned values (including typed-array backing stores/Map/Set), with a pre-admitted per-shard allowance and explicit resource failure on excess. These units are conservative modeled bytes, not measured V8 heap or RSS. Raw input reads enforce their expected encoded byte length before decoding.

Parser workers start lazily, are bounded by effective memory and the existing thread request, and use the shared heap-launch/acknowledgment contract. Unsupported parent heap topology uses a reported ordered-inline route. Worker qualification fixtures must run under an enforceable parent heap; inline execution is not worker acceptance. Cancellation and early failure close the pool before draining outstanding decode promises. Teardown failure preserves the primary error, retains modeled credit/worker ownership, quarantines new loader startup, and never authorizes overlapping inline retry. The standalone full-file loader API remains explicit compatibility; production ingestion does not retain every shard of a file. All newly authored ordered-window, late-shard rollback, selected-snapshot binding and resource/cancellation controls remain unexecuted.


The decode reservation includes observed patch bytes and bounded checksum metadata scratch. Primary and patch input lengths are pinned before decode, so a patch that appears, grows or disappears after admission fails closed. Patch/checksum reads enforce fixed byte limits through the contained descriptor reader; permission errors propagate through worker transport rather than becoming an empty successful patch stream. Encoded-byte counters cover successful primary reads; auxiliary metadata and modeled projection units remain separately bounded, not advertised as complete I/O or RSS measurements.
