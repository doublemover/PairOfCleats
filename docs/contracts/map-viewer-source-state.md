# Map viewer source state and rendering boundaries

The isometric viewer indexes the available saved map payload before loading
optional renderer modules. This source inventory is independent of display and
draw caps. Its paged hierarchy and indexed directed adjacency can inspect an
available entity without allocating its geometry. Missing evidence in a saved
payload stays unavailable; source indexing does not fetch an index or expand an
export's scope.

Semantic selection is authoritative. A rendered hit is a transient projection
of that selection and is cleared when an undrawn entity is inspected. Inspector,
source action and selected neighborhood use the same source identity. Rebuilds
reconcile that identity against the source inventory. History retains its source
snapshot identity and cannot silently rebind an old selection to another payload.
Camera focus is a separate capability; selecting undrawn evidence does not move
the camera to an unrelated overview or old hit.

Three/WebGL startup progressively enhances the usable evidence browser. Failed
assets or construction leave source inspection available and offer a local retry.
This does not yet qualify context-loss restoration, transactional chunked rebuilds
or a worker-owned streaming graph pipeline. Source indexing still processes the
available in-memory payload eagerly; no larger-graph capacity is claimed.

The scene owns the complete PMREM output render target, separately from transient
input textures and generator scratch state. A successful replacement publishes
the new target before retiring the old one. Failure keeps the accepted target;
late callbacks after disposal retire their input without reviving scene state.
Scene teardown retires its cached geometry, normal texture and renderer.

Height fog follows each representation's world coordinates: transformed mesh
vertices pass through batch, instance and model/parent transforms; wide lines
derive world coordinates from their view-space segment/extrusion. Unsupported
shader chunk layouts fail explicitly. World grid and structural rims depth-test
against opaque foreground geometry. This does not establish physically correct
intersecting-glass refraction or transparency sorting.

These are source contracts. Authored lifecycle, shader-generation and semantic
selection regressions have not been executed in the development-first repair
batch. Browser pixels, WebGL compilation, context recovery, GPU resource plateau,
keyboard interaction, frame/interaction timing and the proposed renderer/batching
decision gates remain required qualification.
