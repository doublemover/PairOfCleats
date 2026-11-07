# Early embedding selection — 2026-10-27

Source `bba2c5c8dc039e2817602f4c38306c561597754c`, tree
`057834e208d01e28e975769116dec95fe0c45016`, branch
`codex/pr557-audit-repairs-20261012`. Functional execution is deferred.

The ordinary full-build parent now selects and captures a bounded immutable
embedding plan before Stage2. Explicit Stage3 captures at entry. Real enabled
model/profile/provider/normalization/dimension incompatibilities fail through
their existing contract during selection, and named-profile revision/precision/
dimension defaults are serialized as actual selected values. Disabled/stub
selections do not require real model profiles or local assets.

The previous per-mode queued/inline path reconstructed plans after Stage2 and
lock waits. It now binds generated root/build identity and mode subsets to the
same captured selection. Unknown binding keys, relative roots, changed bound
generation identity and widened modes fail. Model/config/environment/resources
and selection time do not get reselected; current enabled/stub/mode intent must
match. The strict version-2 digest/allowlist/redaction/32 KiB handoff remains.
Existing queue/observability/attempt ownership carries the resulting child plan.

Six new late-binding/profile/inactive cases are authored, **unexecuted**. The
existing actual inline/queue handoff fixture now changes parent config/environment
after capture and checks the child's original selection. Its scratch allocation
uses the marked isolated test-cache helper. A canonical `repo/.` spelling replaces
its physical junction creation; this keeps portable root-spelling coverage without
claiming physical-link equivalence. That separate positive qualification belongs
to workspace identity; no symlink/junction was created during this work.

Format/ESLint, changed-JavaScript syntax, config budget, generated inventory and
whitespace checks passed; shared module analysis found zero cycles. No model
download, native inference/probe or project functional fixture ran.

#1325 remains open for read-only asset/native availability states, authorized
fetch and cache-only distinction, original attempt preflight persistence,
watch/two-stage/recovery adoption, zero-parser failure controls and actual child
qualification. Selection is not runtime readiness. See the
[selection contract](../contracts/embedding-execution-selection.md).
