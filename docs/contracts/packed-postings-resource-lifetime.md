# Packed postings resource lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

The packed token-postings loader uses the shared contained descriptor owner for
its bounded decode windows. Strict loading borrows `withContainedFileSync` and
its original stat/read/final verification operations. Legacy non-strict loading
adopts its actual opened fd into the same resource owner while preserving its
existing path-admission behavior. Neither path swallows descriptor-close errors.
Decoded postings are returned only after the original close confirms its native
void result and independent original resource observations are settled.
The same synchronous callback entry also serves the tooling cache reader, so
successful admission need not detach and create another owner for that borrower.

Offset/vocabulary cardinality, exact initial/terminal offsets, monotonic extent,
safe varints, sorted postings admission, bounded windows, positive short-read
loops and manifest checksum verification are unchanged. Data still streams
through bounded windows; there is no whole-file packed-data fallback. A failed
close or explicit recovery never replays decode windows or checksum verification.

Primary read/decode/checksum failures and independent close failures retain exact
causes and the actual resource capability. A pending original native read blocks
actual close even with a false pending marker or later observer replacement.
Once numeric close has failed, its generation remains unknown and cannot be
recovered from matching fd/path/inode or external fixture cleanup. A first close
blocked before invocation can occur after original work confirms settlement.

The authored `packed-postings-resource-lifetime` fixture creates actual packed
codec bytes, canonical manifest/metadata/offset sidecars and tiny disposable fds.
Both strict modes cover positive bounded short reads and checksums, all falsey
read plus independent close failures, successful-decode close failure, checksum
plus close failure, original native prerequisites, replacement negatives,
close-only counters and unchanged bytes. Existing cardinality, safe-integer,
offset admission, bounded-window, short-read and traversal fixtures remain. No
executable checks have run for this source batch.

The descriptor capability does not retain an index/category coordinator lease on
behalf of the caller or qualify other binary-columnar/checksum raw borrowers.
Cross-process resource ownership, platform/native performance and full index
acceptance remain deferred. No issue completion or stronger numeric-generation
settlement proof is claimed.
