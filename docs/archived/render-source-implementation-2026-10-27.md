# Shared render-source admission — 2026-10-27

Source `8e8088c4481ae125d654adc43dd177b4e30fb3b4`, tree
`9b9b1c09ec645ce8be999bd1700b005a189eb5d8`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Unpublished; functional and performance qualification is deferred.

Previews and summaries now share the actual render-owned source reader. The
previous summary path independently reopened a source that preview admission
could refuse. File attempts, admitted source bytes, physical read requests,
decode input and scan work now have one bounded owner; failed/racing reads remain
charged and refusals remain sticky within the request. Existing per-file 512 KiB
and request 2 MiB/32-file caps remain. Original contained-file operations supply
no-follow/confinement, regular-file identity, before/after generation checks and
confirmed descriptor close before cache publication. Unknown resource settlement
stays a failure, not an optional unavailable summary.

Existing LRUs retain privately admitted, generation-qualified frozen products;
unknown payloads are rejected before inspection. Source admission still precedes
a summary-cache hit. Text and product metadata count toward retention. No new
cache, public option, disk format or dependency was added. UTF-16 offsets still
select decoded text rather than being treated as byte positions.

Summary input/normalization work and output word/character limits are separate.
Truncation is explicit and partial products are not globally cached. The fifth
full result previously selected `10 - 3*4 = -2` words, so `slice(0, -2)` retained
almost the whole body. Negative/zero word limits are now inactive with no summary
source read. The unused later reassignment of that limit had no consumer and was
removed by local dataflow inspection. The old private preview reader had one
caller, now migrated to the shared owner; the standalone summary API delegates
to that owner as well. Shared encoding/cache utilities remain.

Thirteen new cases are authored, **unexecuted**: actual-render oversize/cumulative
refusal, enabled/disabled-cache read sharing, edits, scan/word bounds, failed/racing
read accounting, UTF-16 BOM offsets, supplied preview refusal, hostile cache/owner
values and JSON/no-summary controls. Instrumentation counts both captured-descriptor
reads and the retired whole-file route, preserving detection of an independent
fallback. Existing one-read/cache-limit checks remain; source admission now occurs
even for summary hits, so the expected file-cache lookup count changes from one
to two while physical reads remain one.

Three related fixtures no longer create physical links. Canonical `root/.`
spelling preserves portable alias lookup. File/directory virtual reparse metadata
reaches the actual no-follow owner; tests assert its exact
`ERR_UNSAFE_FILE_PATH`, positive inspection count and zero opens. This is a
mandatory negative instead of a privilege-dependent skip. Actual in-root and
outside-root files remain positive/negative controls. Native Windows reparse and
physical alias equivalence remain separate qualification; no such pass is claimed.

Format/ESLint, changed-JavaScript syntax, config budget, script inventory and
whitespace checks passed. Shared module analysis found zero cycles. No project
functional fixture, data-source experiment or benchmark ran. #1723 remains open
for actual consumer/read-counter, freshness, cache, encoding and serial resource/
performance qualification. See the [source contract](../contracts/render-source-admission.md).
