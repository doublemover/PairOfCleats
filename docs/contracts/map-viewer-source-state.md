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

The source-only progressive slice now gives an explicitly selected identity
priority in a bounded render working set. Member pages can reach beyond initial
display prefixes; the canonical saved-payload inventory and adjacency remain
unchanged. Detached preparation preserves the prior scene until a source/layout/
residency/selection/camera-qualified transaction commits. A failed or superseded
candidate retires only its own allocations. File-level pipes can retain exact
relations whose member detail is nonresident; fine-detail anchors are never
invented. A zero effective budget fails with an actionable explanation.

Stack picking uses a resident-object spatial broad phase followed by exact Three
geometry/instance testing. The index belongs to the source and geometry revision;
visibility is checked on each query, and a bounded traversal overflow falls back
to exact resident testing. Result fences include source, slot/geometry revision,
camera, viewport/DPR and latest pointer request. Legacy layouts keep their prior
exact target path. Candidate upper bounds are separate from unavailable exact
instance-test counts. Selected instance colors request changed attribute ranges;
the counters describe requested bytes, not observed driver uploads.

The renderer boundary exposes capabilities independently of measured acceptance.
No new backend or spatial batch size is selected by this slice. Worker transport,
whole-snapshot overview/proxy loading, spatial packet adoption and browser latency,
GPU resources and culling/overlap qualification remain partial or deferred.

Local preview sessions now offer a token-qualified `/map-snapshot` endpoint over
the same immutable admitted map. It preserves the selected manifest/producer when
known, source revision as unknown when unavailable, upstream drops and export-only
coverage. It is a consumption view, not another index service or a way around
artifact admission. Responses are at most 256 KiB, requests 16 KiB, two in flight,
and rows at most 256 per page. A row too large for a page fails explicitly; it is
not truncated. Cursors continue exact source order, and every result carries
protocol, snapshot, request and revision. Session retirement releases its indexes.

A module worker builds compact file/member/directed-adjacency/search rows from
these pages, keeping rich fields in the session's lazy detail operation. It reports
a manifest overview before row loading and publishes a new accepted store only
after exact continuation succeeds. Failed replacement retains the prior store;
teardown aborts fetches, messages, queries and owned maps. The current retention
budget counts compact wire bytes (32 MiB), not measured heap. Source IDs retain
their types and punctuation; row indices and render slots are local addresses.
Search computes bounded pages cooperatively in the worker, and source navigation
uses it once ready. It falls back to the retained compatibility source after a
worker failure. Progressive layout also runs in that worker and reconnects exact
original evidence objects before committing its bounded scene transaction.

The preview still parses and retains the admitted compatibility artifact on the
server and embeds it for the eager client fallback. The new worker store therefore
adds a retained representation in this migration stage. Manifest-first rendered
overview, demand-driven compact-page eviction, indexed substring acceleration,
streaming canonical artifact ingestion and retirement of eager paths are open;
this slice does not establish bounded total heap or complete-index consumption.
No browser/worker-host or latency/resource acceptance has been run.
