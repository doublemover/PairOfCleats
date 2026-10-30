# Original scene render observation — 2026-10-27

Source `5da4c257857f6118b89960f8220e35448af432f1`, tree
`fb344b5124a762934193efb031756965ef5c4ec3`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Unpublished; functional/browser/raster qualification is deferred.

The previous browser frame helper replaced `renderer.render` after controls had
captured its original function. The actual controls callback therefore bypassed
that replacement. It also waited for another frame without requesting ordinary
invalidation, which is insufficient for an idle viewer. This is a source-derived
observation defect; no browser hang or blank raster was executed in this wave.

Controls now adopt an internal single-frame submission observer alongside their
original captured renderer operation. The controls lifetime revokes it before
retirement, and a pending observation has bounded ownership and explicit
cancellation. Actual render failure remains primary. Before/after identity binds
scene/camera, committed model/layout, geometry revision and three scene groups;
changed, preparing or lost-context generations cannot publish a frame witness.

The explicit browser helper requests the existing invalidation owner, samples
pixels synchronously after the actual call, checks advancing native counters and
useful geometry, hashes the captured committed model and rechecks identity before
handoff. It no longer replaces the renderer or hashes unrelated original HTML as
the committed model. Observation cleanup is explicit on every outcome, retaining
both primary and cleanup failures. Receipts distinguish submission/raster smoke
from hardware completion, fidelity and FPS.

Expected negative requests and cancellation have their own diagnostic phases.
Late diagnostics revoke provisional success. Browser cleanup now precedes a
final check of every page's diagnostics, including fallback. Requested/effective
renderer modes remain phase-local and source-only fallback cannot erase a 3D
failure. Existing bounded HTTP/console/page/resource error classification stays.

Seven submission controls are authored, **unexecuted**, including late method
replacement, generation changes, native failure, cancellation/retirement,
unchanged no-op counters and actual controls-lifetime/captured-render/RAF-owner
composition. Phase diagnostics add late-after-clean and expected-failure scope
controls. Existing scene construction/shutdown/enhancement/context tests remain.

Format/ESLint, changed-JavaScript syntax, config budget, script inventory and
whitespace checks passed; shared-module analysis found zero cycles. No browser,
project functional fixture, GPU or performance experiment ran. #1372 remains open
for actual browser fault injection and original/follow-up acceptance, including
shader/module/fallback/no-op negatives. Depth/compositing/fog and hardware
qualification remain separate. See the [contract](../contracts/scene-render-observation.md).
