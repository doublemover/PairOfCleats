# VFS cold-cache live and input bounds

The optional cold cache owns metadata candidates. `ensureVfsDiskDocument` retains
current root/content authority; a cached absolute path or recorded hash is not a
verified file URI. Lookups with the expected current path reject another root
before probing its existence. Metadata hits/misses and verified disk reuse remain
separate observations.

`maxBytes` is a finite nonnegative safe integer document-payload budget; zero
disables admission, including zero-byte entries. `maxAgeDays` is finite,
nonnegative and bounded; zero disables age expiry. Existing defaults remain.
Separate internal bounds cap a live instance at 50,000 entries and 8 MiB of
serialized row metadata, with 32 KiB maximum row bytes. Count bounds object/index
overhead; serialized accounting is not an absolute V8 heap or RSS measurement.
Oversized/invalid entries bypass the cache without changing document generation.

Admission and expiry update one authoritative live set with running payload and
metadata totals. The shared min-heap selects old entries, with admission order
breaking equal-time ties. Updated heap tombstones rebuild at a bounded amortized
threshold. No insertion sorts the full cache. Expiry, updates, zero/tiny entries
and repeated flushes cannot leave a larger hidden live map. Payload accounting
uses exact integer arithmetic before conversion back to admitted public totals.

Loading validates at most 64 KiB of contained metadata, then reads contained data
through one 64 KiB raw chunk and one bounded line. File admission is 8 MiB; at most
50,000 physical lines and 32 KiB per line precede UTF-8/JSON parsing. Rows enter
bounded admission immediately. There is no initial full-file text/row array.
Malformed/changed/over-budget input, unsupported versions, stale source identity
or count/byte mismatch yields an explicit cache-miss state and no partial live
cache. Original pending read/close failures remain retained instead of being
reported as an ordinary advisory miss.

Flush captures at most one bounded immutable snapshot. Concurrent calls serialize
publication and each caller waits through the revision visible when it started;
sets during an awaited write remain dirty and cannot be erased by an old flush.
The shared atomic JSONL/JSON owners retain publication/close behavior. Failed
original publication work must settle before another flush can begin. Metadata
candidates still use their existing source identity; immutable reader/session
lifetime ownership remains the separate #1643 follow-up.

Statistics expose live counts/payload/metadata, admissions, updates, evictions,
expiry/oversize/invalid bypasses, heap entries/rebuilds, loaded rows/input bytes,
retained loaded entries, miss reasons, flush counts/revisions and bounded snapshot
high-water observations. They do not turn count or boundary measurements into
measured process peaks. Existing persisted/reloaded compaction assertions remain;
dedicated single-instance and concurrent-flush fixtures cover the additional owners.
