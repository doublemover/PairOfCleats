# Embedding manifest ownership and required observations — 2026-10-28

**UNVALIDATED source:** `9f08e6f0ffe8f9ddfaecd00d1a43dd838d838eb4`, tree
`d9b0d2496b8c5f0edfaf9dff3289bdfdcdd3a2f8`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

The actual embedding manifest writer previously read/wrote outside the shared
state mutex, so it could replace a freshly corrected state checksum. It also
silently converted metadata, stat and checksum failures into fallback counts or
null receipts. Present null/string counts could become invented observations.

The writer now captures producer backend-piece data before lock admission and
reads the latest manifest under the same existing owner as SQLite, LMDB and
embedding state. Both runner publication sites supply the actual original state
capability. Generation/invocation checks run under that lock before manifest and
validation admission. The validation-to-ready-receipt interval needs the subsequent
source follow-up recorded below.

Present legacy HNSW metadata passes its authoritative schema plus safe integer
count/dimension checks; a measured zero remains zero. Only observed absence
uses legacy defaults. Explicit new-generation backend pieces do not consult old
unselected metadata. Contained UTF-8 metadata reads, optional-file probes and
required hashes propagate failures. An unmarked original observer that remains
pending cannot authorize fallback to a backup. Existing settled-primary failure
recovery from a valid explicit backup is retained. Regular-file checksums and
byte extents come from the same original contained descriptor after closure.

Twenty-two `indexing/embeddings/manifest-publication-ownership/*` controls are
authored and **unexecuted**: valid/zero/null/string/negative/unsafe counts,
malformed/unreadable/pending and missing metadata, unselected legacy files,
required state/vector hash failure, same-descriptor byte extent, concurrent
native publication, queued request capture, stale manifest/validation attempts,
unmarked primary-read work, backup recovery, binary metadata and malformed
shards. They exercise actual owners and real files without native decoding.
The original manifest-preservation/access-denial assertions remain, with the
denial injected at the actual contained synchronous open boundary.

Format/ESLint, six JavaScript syntax checks, whitespace and static module-cycle
analysis (zero cycles) passed. No functional fixture, child, native operation,
server or benchmark ran. This is cooperative writer ownership, not a crash-atomic
state/manifest transaction or whole-execution lease. Initial-generation adoption,
paired-publication recovery, broader cleanup and runtime acceptance remain.
#1267/#1574/#284 stay open; counts remain **480 pending, 145 partial, 93 unresolved**
of 718 open issues. Source/publication gate remain deferred and unpublished.

Follow-up source `f4c8f384345020dce06a764f6446e490be314acf`, tree
`47e7fc50df2218e4caf840111dacdac5ffcbee6c`, keeps validation and ready-receipt
commitment inside one actual publication owner. Original successful validation
and receipt observations remain prerequisites through actual metadata release;
callback/getter failure cannot discard them. The validation decision is captured
once under ownership while the public return retains the original object.
Five additional controls (`receipt-lock`, `validation-pending`, `receipt-pending`,
`receipt-revokes-validation`, `validation-getter`) raise the group to **27 authored,
unexecuted cases**. They check actual lock contention, retained original causes,
pending state and explicit metadata recovery without replay. Format/ESLint, two
JavaScript syntax checks and whitespace passed. No functional case ran.
