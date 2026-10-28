# Embedding terminal publication failures — 2026-10-28

Source `b6fbbf1a4cde7bb7f54495244ad296514c755ab5`, tree
`0d49ddddfd6d3f48df8780178b9762baf3a8acba`, and follow-up
`70a0801626b081642ac2f51c61c20e74be29cfdc`, tree
`262059b0096a20a43c1c08593ff5a531f4e1c027`, branch
`codex/pr557-audit-repairs-20261012`. Unpublished; functional qualification pending.

The actual Stage3 catch path discarded terminal runtime-receipt and state write
errors, while its finally path assigned fields directly to potentially frozen
failures. It also treated falsey thrown values as absence of a mode failure.
The embedding state loader could turn malformed/unsettled source into an empty
object before terminal replacement.

The existing publication owner now joins original work with independent receipt
and state preparation/reference/observation/write failures. Unsettled fulfilled
receipt output is not a successful diagnostic. Actual absence can initialize
state; existing malformed or unsettled source propagates. Failure-state writes
preserve source bytes on failed admission. The actual runner uses this owner,
retains progress/artifact/drain/stats failures and tracks mode failure explicitly.
Shared error composition preserves cleanup causes and resource observers without
mutating frozen errors or assigning a bare ownership marker. Unknown original
work retains its actual spool capability rather than authorizing its removal.

Twelve independently selectable actual-owner cases are authored, **not executed**:
`indexing/embeddings/terminal-failure-publication/*`. Frozen and falsey work,
failed/pending receipt output, prepare/write/reference/observation errors,
asynchronous preparation, actual corrupt/null source and pending reads retain
the original causes and successful failure-state evidence where available.
Together with the native state/compaction batch, 32 new state/terminal controls
remain pending.

Static format/ESLint, affected JavaScript syntax, whitespace and zero-cycle
analysis completed at their recorded checkpoints. The native-state fixture now
uses the canonical `ARTIFACT_SURFACE_VERSION`. No functional fixture, child,
native campaign, benchmark or publication front gate ran; dependency inputs
remain the verified locked-bootstrap inputs.

#1267/#1325 retain full original/follow-up and actual route/cache/queue/native
qualification. Spool original-close/recovery and deferred capability settlement
still need owner inspection; this patch does not turn a retained path or later
work settlement into proof of spool closure. Common category/custom producer
registration and cleanup remain under #1574. No overall issue classification or
closure changes here.
