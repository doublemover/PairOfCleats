# Scene render observation

The controls owner submits frames through its originally captured renderer
operation. Replacing a renderer method after controls initialization cannot
intercept that operation. The internal submission owner therefore observes the
real call, after it returns and before the render callback releases its frame.
It adds no public setting, separate RAF loop or GPU resource.

At most one next-frame observer belongs to a renderer. It is consumed once,
explicitly cancelled by its caller, or rejected on original controls retirement.
The original controls lifetime owns and revokes the observer bridge. A newer
renderer owner cannot be removed by an older disposer. Native render failures
remain the primary error; no successful frame is manufactured from a thrown call.

A frame observation binds the original scene/camera, committed model/layout,
geometry revision and file/member/edge groups before and after submission.
Preparing, lost-context or changed-generation work cannot qualify a frame. The
bounded receipt contains native frame counters, draw counts and three group
identities. It does not prove a useful raster, GPU completion or latency.

The explicit browser qualification helper requests an ordinary invalidation,
observes this original operation and samples pixels synchronously in that frame.
It additionally requires an advancing native counter, useful geometry and
known-scene color variation. It hashes the captured committed model rather than
the original HTML payload, rechecks generation before receipt handoff and cancels
the observation on every outcome. No-op submissions must fail this browser
contract, even when the canvas/context/hierarchy exist.

Browser phase success remains provisional until page cleanup. Late page errors
reopen diagnostics; final receipt publication rechecks all pages after closure.
Intentional request failures and no-WebGL fallback have separate phase rules.
Requested/effective renderer mode and source-only fallback remain distinct.

Seven submission-owner controls and expanded phase diagnostics are authored;
execution is deferred. Actual browser fault injection, raster/depth/fog fidelity,
hardware qualification and performance remain separate acceptance obligations.
