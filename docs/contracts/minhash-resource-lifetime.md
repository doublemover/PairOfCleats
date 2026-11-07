# Packed MinHash iterator resource lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

Packed `loadMinhashSignatureRows` now borrows the existing async contained-file
resource owner across yields in both contained and legacy path modes. The owner
captures the actual FileHandle's original read/stat/close methods and receiver,
tracks admitted native operations through the existing scheduler suspension, and
drains them before close. A generator object is not treated as completed callback
work. Acquisition stays lazy; return/throw before first next opens no data handle.

Admission reads the actual opened descriptor's regular-file extent instead of a
preceding pathname stat. Safe shape products, exact u32 byte alignment, expected
total extent, maxBytes, heap/batch caps and positive short-read accumulation stay
mandatory. Batch allocation follows opened-extent admission while the owner
protects cleanup on allocation failure. Each yielded signature remains a copy
of the reusable batch buffer. Final dev/ino/size/mtime/ctime must remain stable,
and strict mode rechecks descriptor containment before normal close.

Normal exhaustion, return, early break and explicit throw close through this same
owner. Original falsey/frozen read/stat/checksum/throw failures compose with
independent close failures. Original independent native observations gate actual
destruction, including false/absent pending markers and later method replacement.
The private existing capability map recognizes only actual failures and completed
borrowed iterators. A live suspended iterator exposes no close-only handle. There
is no second registry, metadata deletion or category/index authorization.

Failed FileHandle close can be retried only through its actual
`containedFileSession.releaseAfterClose()`. The captured original method and
receiver must fulfill their standard void result, and all captured independent
observations must confirm settlement, before an exact receipt is returned.
Recovery never reads, rehashes, resumes yielded rows or replays checksum verify.
Nonvoid close is unconfirmed. Ordinary termination never retries a failed native
close automatically. Concurrent explicit recovery shares the owner's actual
close attempt.

The existing streaming checksum contract is unchanged: rows may have been
yielded before checksum verification on final exhaustion. Early return does not
claim full-file checksum verification or publish a witness. Materialized MinHash
and JSON fallback/reporting paths have not adopted this async iterator lifetime.
External loop-body throw still reaches an iterator only as return and may
suppress a second close error; hidden external native work cannot be inferred.
An abandoned suspended iterator does not clean up or establish settlement. These
limits match the [binary frame iterator contract](binary-frame-resource-lifetime.md).

The authored actual public-loader fixture uses canonical MinHash hash identity,
packed metadata/manifests, real checksum bytes and disposable FileHandles in both
path modes. Controls cover lazy unstarted return/throw, copied rows under bounded
short reads, original method replacement across yields, early break/return/body
throw, falsey/frozen read and delegated throw plus independent close, original
native observer replacement, first close-only recovery, nonvoid close, final
checksum-plus-close failure, opened extent mismatch and final stamp mutation.
The actual contained iterator adapter additionally covers admitted native read
drain, late-operation refusal, private completed iterator identity and normal-only
post-close completion. Existing allocation-cap, row-stability and checksum
fixtures are retained. No executable checks have run; native/platform,
cross-process, full-index, performance and completed-issue acceptance remain open.
