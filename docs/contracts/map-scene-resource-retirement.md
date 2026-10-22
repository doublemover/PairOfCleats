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
qualification was performed. The construction owner described below extends
ownership to observed returned resources before shutdown installation.

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

The viewer's enhancement owner now fences each module/environment import and
scene-initialization await by its original request, source and document owner.
Imported modules remain local until that owner is current. The actual scene
producer reports its installed scene/renderer/disposer synchronously; the
enhancement captures that original function and receiver for later retirement.
An older initializer failure cannot look up a newer scene's disposer or enter a
new fallback against that scene. A stale import which acquired no scene does
not retire the shared scene it observed before importing. Page retirement stops
later publication without claiming that dynamic imports have been cancelled.

The authored enhancement controls cover out-of-order imports/environment loads,
source replacement, page retirement, original disposer capture and the actual
inert `initScene` producer followed by a delayed older rejection. They remain
unrun. The separate construction owner below covers returned resources before
shutdown installation. Reentrant browser/Three callbacks and GPU/native
quiescence or retry safety still require separate qualification.

Scene construction captures the renderer and its original canvas immediately,
returned scene groups and every returned light shadow, including a shadow whose
light has not yet been attached. Listener removal captures the original method,
event and callback before registration, so a partially admitted registration can
still be retired. Before shutdown installation, independent resource retirement
runs through that construction owner and preserves the exact original falsey or
immutable construction failure alongside every cleanup failure. Original pending
native-work observers gate pre-installation retirement; neither rejection nor a
replacement observer establishes settlement. Failed scopes retain their exact
resources through the existing strong scene resource inventory.

After shutdown installation, constructor cleanup delegates to that same captured
shutdown function. Renderer, canvas and initial shadow capabilities are reused;
known initial shadows are retained even if later detached or replaced. A scene
that was successfully closed after an initialization failure remains owned by
that attempt for source fallback, without adopting another scene or repeating
successful native closes. The new actual-constructor inert controls are authored
and unrun. Native allocations hidden inside a throwing constructor before an
object is returned, inaccessible native children, post-installation native-work
semantics and real resource/retry/quiescence/host acceptance remain unqualified.

The normal-map loader now captures the texture returned by `TextureLoader.load`
before completion, and deduplicates a synchronous completion callback with that
returned object. Shutdown and material-owner replacement use the factory's
original retirement closure. A later callback retires only that loader's actual
received texture and cannot replace a newer scene's normal map or diagnostics.
Failed callback cleanup remains strongly reachable through the existing scene
resource inventory. Ordinary retirement reports known failures without retrying
them; explicit exact capabilities remain available for reconciliation. Normal-map
textures require an original callable disposer; an absent or throwing required
method cannot establish closure. Other existing optional scene actions retain
their original absence contract.

An original loader/configuration failure, including a falsey value, remains the
primary failure alongside later captured cleanup outcomes. Observed original
native work gates its texture, including when the failure callback runs before
the allocated texture is returned. Private original composition records delegate
only known local failures; copied public owner/cause fields do not authorize
dropping an independent observer. Published textures remain published if previous
texture retirement or a post-publication callback fails. Async completion also
assigns the accepted normal map to already created glass materials before render
invalidation. Explicit `false` from synchronous or asynchronous captured scene
disposal remains unconfirmed. Actual original scene/cache observer functions are
memoized once present; absent evidence can still receive its first actual owner.

The new normal-map loader/material, actual shutdown, false-result and dual-owner
controls are authored and **UNVALIDATED**. They use inert boundaries only. This
does not establish cancellation of image loading, native/GPU quiescence,
constructor-internal allocation coverage, driver retry safety, browser delivery,
raster appearance, memory/resource bounds or performance acceptance.

Scene diagnostic projection now captures original message/name/code, scoped owner
fields and transaction fields once. It requests individual remaining descriptors
after skipping `stack`, so a lazy Error stack cannot reread a throwing original
message. Display, partial-construction prerequisites, exact resource failures and
source fallback share this snapshot. Frozen and falsey operation/inspection
values remain exact causes or `sceneInspectionErrors` entries. Cleanup lists
continue to contain actual cleanup outcomes separately.

Independent getter/own-key/descriptor and ownership-inspection failures retain
their original scene/cache observations alongside the original operation.
Original channel functions and receivers remain captured; absent channels may
receive their first actual evidence later. A throwing ownership getter remains
unknown even if the separately thrown inspection value later settles. Inspection
chains exceeding the local 128-observation bound report `sceneInspectionOverflow`
and remain unconfirmed. Snapshotting does not adopt any copied owner property as
closure authority. The additional inert actual construction/resource/fallback
and lazy-stack/proxy/falsey/nested aggregate controls are authored and unrun.
Native/environment post-installation work semantics, retry safety and real
host/GPU resource and performance acceptance remain unqualified.
