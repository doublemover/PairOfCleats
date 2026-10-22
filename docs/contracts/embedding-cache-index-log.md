# Embedding cache index delta publication

The existing embedding cache lock and storage epoch own index mutations. New hot
batch writes use `cache.index.delta`, a version-1 sequence of length-prefixed JSON
records with SHA-256 checksums. A canonical `cache.index.json` checkpoint binds the
log generation and last included sequence. Each record carries the complete cache
identity, next sequence, current storage epoch and only changed pointers, aliases,
file owners and touched shard metadata. Frames are at most 16 MiB; replay and
checkpoint input are bounded to 64 MiB. Larger optional cache metadata is refused,
without changing required vector artifact publication.

Shard appends are synced before publishing their pointer delta. The locked writer
loads authoritative current state, appends and syncs the complete record, then
updates its caller's lookup inventory. Caller metadata is independent from the
private writer memo. Known content and unchanged input aliases do not publish a
second global chunk delta just because a new file references them. File index
publication still follows global chunk admission under the global lock.

The process reuses at most eight private parsed generations, capped at 64 MiB of
serialized checkpoint/log accounting. It replays only an appended suffix within
that generation. Concurrent readers serialize memo updates; public readers receive
independent metadata. Path eviction, generation replacement and capacity pressure
fall back to bounded authoritative replay. This memo assumes the private journal
prefix is immutable under its existing single-writer lock; arbitrary in-place
tampering is not an immutable-installation guarantee.

An incomplete final frame contributes no pointers. Ordinary lookup can reuse its
verified prefix; strict ownership readers reject the partial tail. The next locked
writer can truncate that uncommitted tail before appending. A complete record with
bad checksum, invalid identity, sequence discontinuity or stale epoch is an error,
not a silently skipped record. It blocks mutation and reference-aware cleanup.
These failures may turn optional cache lookup into a miss.

Checkpoints occur during explicit flush/prune/compaction and when log bytes reach
the larger of 256 KiB or the preceding checkpoint size. Growing snapshots therefore
do not run once per file. One JSON encoding supplies both canonical JSON and the
legacy `.bin` compatibility checkpoint. The compatibility copy is published first,
then canonical JSON, then the included log is truncated. Canonical JSON is authority
whenever it exists; legacy fallback is available only when canonical JSON is absent.
A crash after canonical publication but before truncation is safe because replay
ignores already included sequences. An older epoch cannot restore removed entries.

Physical inventory counts/protects the log as metadata. Shared-file reachability
uses the complete strict index reader, including deltas and legacy fallback; it
does not assume a possibly older JSON checkpoint enumerates every admitted file.
Unreadable or missing-checkpoint log ownership blocks shared-chunk pruning.
Whole-application inventory/migration/quota consumers must use the same reader.

`getEmbeddingIndexLogMetrics` counts checkpoint reads/bytes, checkpoint and delta
encodings, encoded bytes and log bytes read. Authored growth, concurrency, epoch,
partial/corrupt tail, post-checkpoint interruption and reference-retention fixtures
remain unrun. Actual cross-process crash recovery, native file/parent replacement,
fsync/lock costs, timing and RSS acceptance are open. No measured speedup is claimed.
