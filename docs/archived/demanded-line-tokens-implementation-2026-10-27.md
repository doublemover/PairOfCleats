# Demanded file-line tokens — 2026-10-27

Source `ee5e1cb13091cb510ab6028313d72b1e251abe57`, tree
`d319e0d7de8a87d28f172b89fddab383ca870a5c`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Unpublished; functional and performance qualification remains deferred.

The production chunk loop no longer passes the whole source into an unbounded
per-mode/language line-token Map. A file-local owner resolves only demanded lines
through the existing source line-offset index, with conservative admission before
preparation, immutable bounded retention, overlap reuse and exact chunk fallback.
It reserves preparation and window output alongside retained blocks. Large lines
or windows can refuse the optimization without dropping source tokens. Unexpected
producer failures and reservation overruns fail rather than retrying or returning
partial products. Logical byte accounting does not claim measured heap/RSS bounds.

Keys include exact source identity/offsets, effective mode/language/extension,
dictionary object and dependency receipt, normalized segmentation and lexical
version/policy. The existing build dependency receipt is passed separately from
incremental replay, so a nonincremental build can retain authorized reuse without
enabling unused replay checkpoints. The coarse worker contract carries the same
internal receipt. Missing authority uses ordinary chunk tokenization.

Source-ordered chunks retire completed lines before the next start; unordered
chunks use the bounded LRU. A current window pins its cached lines during
admission. Cancelled or failed windows publish no partial blocks. File completion,
early return and failure close the owner and release retained references. Existing
chunk boundary, comment-transform and lexical replay gates remain intact.

Lexical analyzer version 4 now enters the tokenization signature as well as the
shared semantic producer contract. Existing punctuation/synonym, token identity,
statistics and posting owners remain authoritative. The standalone full-file
stream helpers and meaningful tests remain; only their eager production caller
was replaced. No dependency, public knob or artifact-format relaxation was added.

Twelve cases are authored, **unexecuted**: a two-window/5,000-line recording
control, CRLF/empty/Unicode parity, analyzer/dictionary/source identities, admission
refusal, eviction/retirement, cancellation, failed/invalid/oversized output,
close/reentry and the actual chunk/postings pipeline with partial-line, huge-line
fallback and post-tokenization failure cleanup. Existing coarse-worker, heavy-file,
mixed-SCM and boundary fixtures remain required. Dense-overlap and sparse-demand
serial measurements still need raw work/byte, CPU/GC and wall samples. Eager
whole-file selection remains unnecessary in the current implementation; no claim
of a measured dense-workload speedup is made.

Format/ESLint, changed-JavaScript syntax, config budget, generated script inventory
and whitespace checks passed. Shared module analysis found zero cycles. No project
functional fixture or benchmark ran. #1603 remains open for the original and
follow-up acceptance. See the [source contract](../contracts/demanded-line-token-reuse.md).
