# Resident map picking

The semantic stacks caller uses a resident instance index. Source evidence is
still owned by the pinned canonical inventory; the picking index contains only
represented geometry. An index record pairs the original mesh and mutable
instance slot with its transformed world bounds. It does not mint a source ID.

The shared bounds grid admits candidates before exact tests. Standard Three
instances use a borrowed Mesh proxy and the original instance/world transforms,
geometry, material, raycaster layers and near/far constraints. The exact result
is restored to the original mesh and instance slot. The live batch's count,
transforms and metadata are never temporarily rewritten to narrow the test.
Custom raycasters and morph-capable instances retain their original exact path.
An oversized bound or traversal overflow returns exact resident candidates;
overflow does not silently miss a selectable entity.

Index ownership follows source plus geometry revision, including accepted packet
slot changes and full resident scene replacement. Publication also checks camera,
viewport, DPR and latest pointer request. Old slot results cannot be rebound to a
new symbol after compaction. Ancestor visibility and raycaster layers are checked
when queried. Rebuild, scene retirement and control disposal retire the index.

Counters distinguish known candidate-slot exact tests from upper bounds for a
custom instance raycaster. They do not estimate triangle tests, GPU pick latency,
heap or interaction performance. The full resident instance bounds are currently
rebuilt on a geometry revision; incremental spatial repair, background index
construction and asynchronous GPU-ID picking remain open. The source-only
4096-instance regression is a workload, not a source admission cap or a measured
performance result. No fixture or browser/WebGL qualification was run in this
development-first implementation batch.
