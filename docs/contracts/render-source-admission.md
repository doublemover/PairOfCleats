# Render-owned source and summary admission

Current source, thirteen new cases and strengthened existing fixtures are
unvalidated. No project functional fixture ran during this implementation wave.

Human output previews and body summaries use one `createRenderSourceReader`
for the render. A refused source remains refused within that request. A supplied
preview without its actual source owner cannot authorize a new summary read.
Standalone summary calls use the same source owner with a fresh request scope.
Structured output and zero/negative summary word limits do not read summary
source. The fifth full hit no longer turns a negative word limit into an
almost-whole-body `slice`.

The existing 512 KiB per-file and 2 MiB/32-file request bounds remain. Attempts
consume file admission before open; source bytes are admitted before allocation.
Physical read requests consume their own allowance before I/O, including failed
or short reads; each file has at most sixteen captured read calls. Decode input
is bounded by admitted source bytes. Decoded text stays under a separate bound.
No selected UTF-16 character offset is treated as a physical byte offset: the
bounded complete source is decoded by the existing encoding owner first.

The existing contained-file owner captures original descriptor operations,
checks confinement/no-follow and regular-file identity, verifies before/after
device/inode/size/mtime/ctime generation and closes before cache publication.
An unsettled resource propagates through the existing failure owner rather than
becoming an optional missing-summary result. A changed source is refused by the
same render; a fresh render may admit its new generation.

Existing file-text and summary LRUs retain privately admitted frozen products.
Unknown cache objects are rejected before inspecting their payload. Matching
path/generation/policy identity and request byte admission still precede reuse.
Summary-cache hits require admitted source, rather than bypassing that owner.
Cache size accounting includes product text and metadata; TTL, explicit zero,
entry limits and byte caps keep their existing controls. No independent cache,
reader, public option or disk artifact format was added.

A separate request scan allowance bounds preview selection/line-prefix scanning
and summary normalization. Summaries admit at most 64 Ki UTF-16 input units per
selection, then reserve normalization/word-scan work before those operations.
Word and 4,096-character output caps are separate. Available, inactive,
unavailable and truncated summary states remain distinct; partial output is
explicitly labeled and partial/budget-dependent products are not globally cached.
Healthy comment-line cleanup, whitespace and requested-word output remain.

Thirteen new cases cover actual-render oversize/cumulative refusal, shared reads
with enabled/disabled caches, edits, scan/word bounds, failed/racing read charges,
UTF-16 BOM offsets, supplied refusal, hostile cache/owner values and JSON/no-summary
controls. Read instrumentation observes both original descriptor operations and
the retired independent whole-file path, so an unbudgeted fallback cannot hide.

Existing cache tests retain the one-physical-read assertion and now measure the
descriptor owner; a summary-cache hit also obtains source admission, changing the
expected file-cache lookup count. Canonical `root/.` spelling replaces physical
alias creation. Existing source-preview/summary authority negatives now inject
file/directory reparse metadata at the real no-follow boundary, assert its exact
`ERR_UNSAFE_FILE_PATH` result and prove no open occurred. They create no links and
do not skip when Windows privilege is absent. Real in-root/outside-root controls
remain. These are portable owner negatives, not native Windows reparse-resolution
or symlink-equivalence qualification; that external coverage remains distinct.

The old private preview reader had one caller, now migrated to the shared owner;
the independent summary reader had one production caller, now consuming that same
owner. Their duplicate read paths and the unused post-summary word-limit assignment
were removed after reference/dataflow inspection. Shared encoding/cache utilities
and all meaningful positive/negative assertions remain. Actual consumer/counter/
freshness/encoding checks and measured performance are still required for #1723.
