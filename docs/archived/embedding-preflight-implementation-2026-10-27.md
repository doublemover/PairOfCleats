# Local embedding graph preflight and attempt evidence — 2026-10-27

Branch `codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.
Unpublished, functionally unqualified source checkpoints:

| Source | Tree | Change |
| --- | --- | --- |
| `b8915d74041262bd7539f0b189a2929e23f17f8a` | `906fde794267f0e71935e0c021633f7b3085947f` | Read-only local ONNX graph admission before Stage2 and at Stage3 entry |
| `65f8f1c79b4deeb23e409e03e6cd0ee5d4847f86` | `17097ad93aa3fd08d8ea2a0859f6cca2e1368614` | Parent selection/preflight evidence and submitted/bound child digest linkage |

The graph check reuses the existing model selection/installation owner: bounded
small closure receipts, regular/nonempty/readable file checks and existing error
settlement. No graph hashing, native import/initialization, inference or download
is performed. A real local ONNX request with no selected/default graph fails
before Stage2. Explicit selected-path errors retain their original typed error
and cause. The selected absolute graph enters the existing plan field and digest;
later revalidation cannot silently switch to an available sibling graph.

Presence means ready to attempt; runtime/inference remain unverified. Off/stub
requests remain inactive. Deferred/service execution and fetch-capable providers
remain unverified without parent-host graph admission or new fetch authority.
Source review of the existing artifact-identity/cache-only owners establishes
that native ONNX cache-only reuse needs reusable local model-artifact identity;
a missing graph cannot qualify that lane. Missing native runtime is not rejected
here because a qualified cache-only hit may avoid loading it.

The ordinary Stage2 attempt retains a bounded diagnostic selection summary and
preflight through the existing runtime receipt owner. Full selection identity
and profile/resource/environment digests accompany explicit model/provider/mode/
dimension and graph display. Raw config/environment containers are not persisted.
A private observation association binds preflight to its selected plan digest
and timestamp; copied or mismatched evidence is refused. Child launch context
carries the submitted selection digest, separately from the final bound-plan
digest, and existing parent attempt identity links eventual child results.
Malformed submitted digest metadata fails before child attempt writes.

Nine preflight/evidence cases are authored, **unexecuted**. Existing actual runtime
initialization, Stage3 receipt and inline/queue handoff fixtures now assert
selection persistence, parent/child links, invalid metadata refusal and retained
requested selection. Fake nonempty graph bytes deliberately test presence only;
they are not model validity or native inference evidence.

Format/ESLint, changed-JavaScript syntax, config budget, script inventory and
whitespace checks passed. Shared module analysis found zero cycles. No project
functional fixture or model operation ran. The prior valid locked bootstrap is
unchanged by these source edits.

#1325 remains open for failure recording when fatal selection/asset admission
precedes a durable attempt root, watch/two-stage/recovery adoption, broader
native/asset/fetch/cache-only states and actual zero-parser/child/TOCTOU
qualification. See the [selection contract](../contracts/embedding-execution-selection.md).
