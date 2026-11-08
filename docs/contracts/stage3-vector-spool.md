# Stage3 ordinal vector spool

Stage3 stores completed quantized code, documentation and merged channels in an
attempt-owned nonce directory inside the selected mode's index directory. Three
fixed-width files are addressed by canonical ordinal. Five compact bit planes
track reservation, completed occupancy and per-channel presence. A missing row
does not become a present zero vector, and a true-zero row remains present.
Duplicate/out-of-range ordinals and invalid uint8 widths/values refuse admission.

Completed files copy contiguous ranges in bounded windows without transferring,
detaching or mutating cache/model buffers. Inputs remain borrowed until the write
promise settles. Completed files share a dispatcher-turn durability flush across
the three descriptors; a file transfers ownership only after all its channel
writes have been synced. The final seal requires no pending file ownership and
rechecks every descriptor's exact length. Failed or cancelled writes never seal.

Private read-only virtual arrays retain the existing length/ordinal/iterator and
Array.isArray contracts without allocating N array slots or retaining N row
views. Readers use a bounded window per channel and a fresh buffer when changing
windows, so an earlier borrowed view is never overwritten. Consumers must treat
these views as read-only and release them with their bounded range/bundle work.
Sealed-file replacement/length/metadata changes and zero/invalid read progress
fail closed. The default range is 1MiB, the maximum row/window is 16MiB, and all
occupancy/presence planes together are capped at 16MiB.

Generation hashing consumes ordered ranges with event-loop/cancellation checks.
Its version1 framing, source order, variant order, null-hole framing and vector
bytes remain identical to the existing synchronous digest. File completion order
is never hashed. Bundle refresh, JSONL/binary publication and backend inputs read
the same sealed ordinal sequences; binary backend ingestion retains its existing
manifest/identity/validity checks. No spool file is an admitted artifact.

Cross-file vector reuse is capped at 16MiB as well as the existing entry bound.
The global chunk promise memo is capped at 8MiB/2,048 entries using conservative
dimension-based payload charging. These caches must not retain an accidental
second corpus after vectors move into the spool. Existing file admission,
inference batching and cache writer admission still bound live file payloads.

The spool closes and removes its checked nonce directory after all consumers
settle and before manifest/ready publication. Ordinary failure and cancellation
drain spool writes and clean up outside cancelled production admission. Cleanup
errors preserve the original failure. An unconfirmed downstream resource lifetime
retains the spool handle/path on that pending-ownership error for reconciliation;
it is not reported as successful cleanup. Crash leftovers are unpublished and
grant no resume/publication authority.

Runtime work records logical disk bytes, bitmap bytes, durable rows, sync batches,
read/write calls/bytes, current/peak window buffers and zero retained corpus vector
bytes. These are owner work counts, not a process RSS bound: active files, bundle
serialization, cache writers, source metadata and native backends have their own
bounded lifetimes. Additional disk IO, sync cost and compatibility range reads can
outweigh memory savings on a particular workload.

Authored assertions compare shuffled/sparse/missing-channel/true-zero rows,
independent version1 generation framing and actual JSONL/binary writer output.
They also cover copied cache ownership, short/no progress, duplicate reservation,
sealing with active writes, cancellation and unpublished cleanup. All are unrun.
Crash/native integration, retained RSS slope and end-to-end wall/CPU qualification
remain open; no measured memory or latency improvement is claimed.
