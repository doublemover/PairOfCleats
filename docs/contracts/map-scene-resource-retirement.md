# Scene resource retirement

The map scene uses captured exact-resource capabilities for renderer objects,
instanced mesh bindings, owned geometries/materials/textures, scene buffer owners,
light shadows and environment conversion resources. Each capability captures its
original object, method, receiver and arguments once. Successful cleanup is
remembered. An exception keeps the actual object strongly reachable through
`getPendingSceneResourceOwners()` after its group, lookup or scene is removed.

Each failed outcome retains `sceneResourceOwner` or `sceneResourceOwners` and the
exact original failure as its aggregate `cause`/`errors`. Explicit `release()`
targets only that resource. `retire()` reports an already observed failure
without retrying it. An unresolved original child observer, including an unknown
pending marker, prevents a fulfilled outer disposer from claiming closure.
Thenable cleanup remains pending until its actual settlement. None of these
capabilities establish that retrying a real throwing GPU listener is safe.

Object retirement attempts independent bindings, geometry, material and texture
cleanup even when one throws. Group clearing detaches children after attempting
their independent cleanup; the strong pending set retains failed resources.
Shared resources keep their separate owner. Deduplication within one traversal
and remembered successful object/material retirement prevent repeated closes.
Objects/materials declared retired are not a supported resource revival path.

The environment owner separately owns each input texture, PMREM generator and
produced render target. A conversion error remains the primary failure when
independent transient cleanup also fails. A newly published environment remains
the accepted environment if retiring its previous target fails. Later replacement
does not retry previous cleanup failures. Retired late callbacks release only
their received input and cannot create a new generator. Original captured
resources remain available to explicit scoped reconciliation.

Resident candidate retirement attempts every independent group/buffer owner and
preserves a preparation failure alongside cleanup errors. Retirement admission
and successful resource closure are separate observations. Committing a new
resident scene retains the full previous cleanup failure and pending owner
capabilities, rather than only an error message.

The actual `disposeScene` path attempts listeners, controls, residency, environment,
shadows, scene objects, buffers, shared caches, renderer and canvas independently.
It captures the current scene's ownership snapshot before callbacks mutate state.
A stale closure cannot adopt another scene's controls or shared caches. Repeated
shutdown reports an observed failure until exact capabilities settle; it does
not automatically retry failed GPU cleanup. Display messages retain their full
failure and scoped owner observations separately in state.

The new `scene-retirement-failure-ownership.test.js` and
`scene-shutdown-failure-ownership.test.js` author inert controls at actual owners,
including frozen/nested causes, independent failures, original method capture,
late environment input, async settlement, resident aliases and stale scene
shutdown. All source and assertions are **UNVALIDATED**. No Three import, browser
host, WebGL context, actual GPU release/retry, raster, memory, timing or hardware
qualification was performed. Partial renderer construction before the scene
shutdown owner is installed remains separate work.

Captured getter failures and caught conversion/preparation failures use explicit
presence observations, so `undefined`, `null`, `false`, zero and empty-string
throws remain exact aggregate causes rather than successful cleanup. A cleanup
failure represented by a primitive is normalized into an aggregate with that
exact value. If an original error provides both scene and cache release
observers, both original functions/receivers are retained independently and
both must report release. Copying an observer onto a wrapper with a different
receiver cannot establish settlement. The additional falsey/observer fixture is
also authored and unrun.

Renderer transactions preserve their original prepare/commit failure separately
from candidate retirement and operation completion failures. Each independent
cleanup is attempted even when another throws, including falsey throws. Async
candidate retirement settles before the accepted operation is finished. Boundary
disposal attempts cancellation for every currently pending operation; it is a
cancellation request and does not itself assert that detached preparation or GPU
work has drained.

The resident producer marks a candidate published before follow-up callbacks.
Failure after that point retains the published scene and still attempts previous
groups and buffer retirement. Transaction failures carry the observed committed
state, phase and original revision stamp. The reveal consumer keeps that state,
the full error and pending scoped owners instead of reporting that publication
did not happen. Its revision and callback retirement run independently when
boundary cancellation fails. Late failures from a prior source/revision owner
remain in their operation result and cannot overwrite the current scene's
status, failure or callbacks. Wrapper transaction metadata belongs to the current
transaction even when its original cause is an immutable older transaction.

The actual viewer failure path attempts the captured current scene disposer and
preserves its failure alongside the original construction/enhancement error.
Source capabilities and source-fallback status are restored before awaiting
cleanup, including when it later fails; failed owners remain available through
their existing exact capabilities.
Displaying fallback or retry does not itself retry an observed failed native
close. The boundary, actual resident commit, reveal consumer and source fallback
fixtures use inert objects and remain **UNVALIDATED**. No host, Three, GPU,
allocator, retry-safety, latency or quiescence acceptance was performed.

A source fallback owns only its original source, scene, renderer and captured
disposer. A new enhancement invalidates that fallback before loading assets, and
overlapping fallbacks have separate publication owners even when they share a
source/disposer. After cleanup awaits, a superseded fallback returns its full old
failure and retains existing pending resource capabilities without replacing the
current renderer's failure, retirement state or status. Gated sibling replacement
and overlapping fallback controls are also authored and unrun.
