# Retained source authority for canonical call sites

A canonical `call_sites` row retains its own occurrence identity and resolution
state. Its optional source-detail authority uses the existing semantic family;
it never depends on a current worktree file or enables semantic indexing.

`extensions.semanticRef` follows `CALL_SITE_SEMANTIC_REF_SCHEMA`. An available
value has `schemaVersion: 1`, `status: "available"`, the existing `recordRef`,
`sourceUnitId`, SHA-256 `sourceHash`, exact semantic `generation` and
`coordinateUnit: "utf16"`. An unavailable value contains only the schema version,
`status: "unavailable"` and one exported reason. Unavailable retention is distinct
from an unresolved target and from unsupported syntax.

The actual association runs in the existing production ownership pass. It joins
native call details to retained invocation-expression records by exact UTF-16
range in the same unmapped source. Overlapping ranges, a non-invocation node or
multiple distinct invocation IDs for one range cannot establish a link. Local
record ID zero is valid. The join attaches portable references after the
ownership partition finalizes; parser trees and full source payloads remain with
their existing owners. File-local lookup indexes contain spans and references to
already admitted call details, not another source/facts copy. This does not
qualify a new hard byte bound on the upstream per-file occurrence array.

Before writing a canonical row, the call-site artifact owner opens the existing
semantic syntax partition through the artifact semantic store. It checks the
build ID/revision, generation root, exact source header/file/hash and the actual
retained invocation record/range. A stale syntax partition is explicitly
unavailable. A contradictory retained record or source header fails publication
with `ERR_CALL_SITE_SEMANTIC_REF`; it cannot fall back to worktree text. The
writer reuses one file header and the existing bounded verified-reader scope.
The complete semantic family still passes its normal publication reconciliation.

Generation-pinned call-site pages expose the reference unchanged. Existing
semantic detail/source APIs consume that generation plus record reference;
`getSourceSpans` reads checksum-qualified retained bytes and enforces its normal
decoded-source and response limits. Large source detail that exceeds those limits
fails explicitly. It does not substitute a small preview or current file. Mapped
and non-UTF-16 sources require their existing explicit coordinate adapter and
remain unavailable here. Semantic indexing is disabled by default, so native
call capture alone does not claim retained full-source availability.

Recursive calls remain real call/usage adjacency. Supported dynamic native
occurrences remain individual unresolved summaries with ranges and reasons;
their display spelling is never passed to static target resolution. Ambiguous
candidate sets remain separate from definite targets. Admission accounts for
unresolved, ambiguous, dynamic and self observations independently. These changes
require the shared `callFlow` producer identity to advance before replay reuse.

Authored controls cover exact record ID zero, stale/overlapping and ambiguous
span refusal, recursion, repeated dynamic occurrences and ambiguity. A further
control follows the actual ownership pass, canonical writer, pieces manifest,
cold graph page and existing published semantic source reader without creating a
worktree source file. All controls are unexecuted development source. Public
schema registration, shared producer identity integration, complete upstream
syntax qualification, disk-working-set accounting and durable propagation resume
remain separate acceptance obligations for #1348/#1484.
