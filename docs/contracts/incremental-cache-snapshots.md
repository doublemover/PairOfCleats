# Incremental cache snapshot ownership

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

Bundle source keys normalize separators and dot aliases to safe repository
relative POSIX keys. Absolute paths, root escapes and NUL bytes are rejected.
Explicit chunk IDs and chunk/shard order remain unchanged.

Incremental manifest schema 6 stores repeated dependencies once in a normalized
table. Both build and SQLite/embedding consumers use the same codec. Previous
persisted layouts reject explicitly and require a source rebuild; there is no
compatibility migration. Manifest publication has a strict 8 MiB encoded bound.
Capacity refusal happens before atomic replacement, preserves the prior readable
manifest and its snapshots, and never quarantines valid oversized metadata as
corruption. Coarse-timestamp whole-index reuse verifies source content rather than
relying on equal size and mtime alone.
