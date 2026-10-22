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

The scene-first shell exposes one active Explore, Inspect, Appearance or
Performance task surface. Core fit/focus/history/detail/help controls and compact
snapshot scope stay outside scrolling settings. Closing preserves panel DOM;
selection can reveal inspection without focus transfer and cannot reopen an
explicitly dismissed inspector. Optional empty, zero and unavailable fields have
separate labels under expandable details; lazy full-source evidence is retained.

Appearance tokens independently select palette, material, lighting, motion and
decorative quality. The default Tron composition uses dark local lighting and
saturated solid semantic cores. Bloom and refractive capture are explicitly
unavailable in this source slice; requesting high quality reports the effective
balanced path. This is an implementation starting point, not pixel/art approval.
Live edits preserve identity, query scope and camera without rebuilding topology.
Contrast, overlap, selection-rim treatment and graphics budgets remain open.

Versioned precedence is built-in defaults, report configuration, durable repository
preferences, then selected layout override, using the existing shared merger.
Only bounded viewer families are admitted. Saved evidence alone gets session-only
settings; an explicitly selected repository grants local session authority
independently of saved root fields. Preferences use the shared durable repository
state resolver, contained paths, ownership-safe locks, optimistic revision and
atomic writes. Random ports do not change that authority. Saves serialize; reset
cancels queued debounce and follows any accepted earlier revision. Failed saves
are visible. Legacy port-local settings require explicit import. Reset preserves
unrelated settings and does not reload away source interaction state.

Camera fit projects visible represented world bounds into the actual free viewport
after measured toolbar/status/task panels, with finite additional zoom-out room.
Fit cancels prior camera motion. Wheel zoom is multiplicative and cursor anchored.
Screen-space label collision/occlusion and full browser corner/pixel acceptance
remain open. Existing 20/200/500-file fixtures are regression workloads, not the
intended source admission architecture. Modern spatial draw packets, scalable
picking, width-capable physical paths, capture/refraction, incremental buffers and
worker-owned progressive source data remain separate uncompleted obligations in
the updated #729/#734/#742/#1302/#1367/#1296/#1297/#1381 contracts.
