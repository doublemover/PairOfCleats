# Outer embedding cache retirement

`embedding-adapter.js` owns the existing adapter and Transformers pipeline lookup
caches. Removing a lookup, expiring a retention timer, returning one lease, or
rejecting a close promise does not release another lease's resource ownership.
The existing caches now retain their actual retired entries until their own
closure is confirmed. This adds no model identity, fallback policy, cache
namespace, storage session or automatic native failure retry.

Each entry captures the exact acquired adapter/pipeline object and its original
optional `dispose` method once. A fulfilled captured method is the existing
outer disposal contract; JavaScript stubs may have no disposer. An explicitly
false disposer result is
unconfirmed, retains that exact entry and follows the existing no-automatic-retry
policy. Void fulfillment and the optional absent disposer keep their prior
contract. Reported pending child ownership still prevents closure. A child marker without its original
release observer remains unknown. A throwing observer also remains pending.
Returning a fulfilled outer disposer cannot erase that evidence. Successful
disposal is remembered, so later child-observer reconciliation does not repeat
it. Independent retired owners are attempted independently and shutdown joins
all their outcomes before reporting failure.

The existing cache owner's `getRetiredEmbeddingCacheOwners()` returns scoped
capabilities for those exact entries. An error's nonenumerable
`embeddingCacheOwner` identifies its entry; `resource`, `references`, `startup`,
`pending` and `lastError` expose observations. Explicit `release()` joins an
active close or retries only that existing entry after a prior close failure.
The same failed adapter or pipeline lease can explicitly retry `dispose()`.
Lookup eviction, TTL callbacks, finalizer delivery and global shutdown do not
retry a previously observed failure. Reconciliation never calls an acquisition
factory or adopts a sibling. This is a source contract, not native retry safety
qualification.

Finalizer held values contain the original reference and its accepted operation
set. Both ordinary disposal and controlled finalizer delivery drain accepted
operations before decrementing that reference exactly once. Accepted
`embedderPromise` startup work is included. A stale delivery or repeated release
preserves an owned sibling's lookup. The first reference is pinned before
capacity pruning, including when a backwards clock makes a new entry its own
LRU victim. Cache retirement closes admission to new lookups while existing
leases retain their work and can finish independently.

Xenova's loaded-byte artifact verification retains its acquired pipeline and
original cleanup method when verification cleanup fails. Its pending startup
error remains the original rejected initialization; another method cannot erase
it by loading a new pipeline. The first subsequent provider disposal reports
that observed cleanup failure without retrying it. Explicit later reconciliation
can target the same captured pipeline. Successful child closes are remembered.
Unknown startup ownership does not become successful empty cleanup.

Warmup and query retrieval preserve immutable primary and cleanup errors in a
new aggregate. Its `cause` is the exact primary error, its `errors` retain both
original objects, and `cleanupErrors` retains the exact cleanup outcome. Original
observer functions keep their original receivers. Pending cleanup propagates
through both actual consumers even when ordinary model unavailability would
return `null`. A successfully cleaned ordinary unavailable result keeps that
existing behavior. No immutable error is modified.

The authored fixtures `outer-cache-retirement-ownership.test.js` and
`warmup-query-cleanup-ownership.test.js` use inert factories, controlled registry
delivery and held promises at the actual cache/provider/consumer boundaries.
All source and assertions are **UNVALIDATED**. No native model, real GC, editor
host, browser, GPU, resource/thread/memory, allocator, timing or performance
qualification was performed. Existing prepared encoder component acquisition,
tensor lifetime and provider-specific disposal details retain their separate
owners and qualification requirements.

The outer owner now captures diagnostic message/name/code once, preserves
readonly data fields and original receivers for unrelated accessors, and skips
lazy stack descriptors before lookup. Exact falsey or frozen diagnostic failures
remain independent causes. A retained snapshot bounds recorded diagnostic errors
and projected fields; overflow is unknown. Caller/Proxy own-key allocation is
outside that bound. No arbitrary error-object coercion is needed.

Independent diagnostic work captured during failure recording gates the original
outer disposer before invocation. Original observer functions and receivers remain
binding after property replacement. After that work settles, explicit existing
owner reconciliation can continue; successful disposal remains remembered. The
composition helper keeps both primary and cleanup diagnostic observations.
`outer-cache-diagnostic-prerequisites.test.js` authors these actual-owner controls
with inert resources and no execution or native qualification.

This scoped change does **not** move all operation-failure observers before
disposal. Some existing provider failures describe that same provider's own
captured child-close capability; treating those as unrelated work would strand
legitimate explicit recovery. Proving exact producer delegation and gating every
independent original operation remains separate work. Existing provider/native
retry safety, original observer-getter diagnostic propagation, hostile property
enumeration, all-consumer lifetime and real memory/GC qualification remain open.
