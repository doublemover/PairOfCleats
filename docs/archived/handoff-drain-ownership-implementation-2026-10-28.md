# Original local handoff drain admission — 2026-10-28

**UNVALIDATED source:** `4e723e3f88cd0bdf4999ea79bbbfd004c9e7c915`, tree
`493ed21220d007592b042e99d9c0f19f1b03c87d`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

Local handoff preparation accepted a matching `drained: true` receipt without
inspecting original resource settlement. A rejected drain also immediately
resumed local readers, even when the original work remained outstanding.

Preparation now publishes an existing scoped resource lease before drain
dispatch. Its resource-settlement marker excludes it from normal process-reader
exit cleanup. The original reader stays suspended and present. Successful drain
results and thrown failures retain original observations before receipt-field
inspection; getter/observer failures remain independent prerequisites. Only a
matching settled drain receipt closes its exact fence and creates the existing
process-local token. Parent lease changes reject admission. No serialized field
can reconstruct the returned recovery owner or token.

Pending failure exposes the actual `repoCacheHandoffOwner`. Explicit
`resumeAfterSettlement()` requires original prerequisites and the original parent
lease, retires only its owned drain fence and resumes ordinary reading. It never
reruns drain work or converts a failed attempt into an admitted mutation token.
Failed fence removal is not automatically retried by failure handling; later
recovery is explicit. Confirmed ordinary falsey/invalid-receipt failures retain
their rejection and restore normal admission after fence settlement. Existing
handoff consumption/cancellation and delegated-child protocols remain.

Thirteen `shared/storage/handoff-drain-ownership/*` controls are authored,
**unexecuted**: real positive consume/cancel, wrong lease, pending result/error,
marker-only unknown work, original observer/field failures, getter revocation,
falsey error, changed parent, failed fence removal without automatic retry and
callback replacement. They assert the real resource fence exists before drain,
preserve receivers, suspend reader admission and retain one-call work semantics.
Marker-only is an intentionally unconfirmable metadata-only negative; its owner
is never acknowledged. Existing real delegated-native, handoff/category,
cross-process and original/follow-up qualification still needs execution.

Format/ESLint, two JavaScript syntax checks, whitespace and static module-cycle
analysis (zero cycles) passed. No functional fixture, child, native operation,
server or benchmark ran. No lease format, stale policy, public configuration or
deletion authority changed. #1267/#1574 remain open for broader producer/cleanup
integration and runtime acceptance. Counts remain **480 pending, 145 partial,
93 unresolved** of 718 open issues. Source and the publication gate remain local
and deferred during implementation.
