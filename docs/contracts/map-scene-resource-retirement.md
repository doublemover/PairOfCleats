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
