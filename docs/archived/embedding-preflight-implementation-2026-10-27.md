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

## Rejected-attempt follow-up

Unvalidated source `d0484a6a719e79c875a2fff4d25383e8d8d2feeb`, tree
`1d4d179eec83b6225a1317ec041960f9d23f3b7b`, records known-fatal ordinary
full-build/explicit Stage3 preflight through the existing runtime attempt and
initialization/category teardown. A private association retains actual failed
graph selection without modifying original typed errors; invalid plans do not
invent a complete selected request. Original selected/error identity survives
recording and cleanup failures. Unknown original work prevents more native or
metadata dispatch.

The diagnostic path checks captured configuration and canonical cache selection
before storage admission. It uses a fresh normal build root and rejects
immediately after attempt admission, before source discovery, dictionary/model/
worker work. Calibration, daemon reuse and SCM execution are omitted on this
path; normal initialization is unchanged. Failed lifecycle persistence and exact
category release remain with the actual existing owners. No new receipt store,
public configuration flag, model initialization, embedding child or promotion
was introduced. An inaccessible/drifting receipt selection remains an explicit
recording failure rather than a fabricated durable success.

Five **unexecuted** `indexing/runtime/rejected-preflight-receipt/*` cases cover
real attempt write/readback, invalid plans, configuration drift, the ordinary
core boundary and independently pending model inspection. Actual production
operation guards require zero parser, worker, dictionary, model, calibration,
daemon and Tree-sitter-preload calls. The expected missing-root diagnostic is
asserted in the drift case. Existing missing-graph preflight assertions now also
verify private failure association, retained typed causes and copied-data
rejection. Together with the original nine preflight cases, fourteen controls
are authored, not run. Existing initialization/receipt/handoff/recovery controls
remain required.

Format/ESLint, changed JavaScript syntax, config budget, command inventory
generation and whitespace checks pass; shared-module analysis finds zero cycles.
No functional fixture, child fixture, model, native campaign or publication front
gate ran. Other build-route evaluation/adoption, wider native/fetch/cache-only
states, failed-recording recovery and complete original/follow-up qualification
remain open under #1325; this source checkpoint does not close that issue.
