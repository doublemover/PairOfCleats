# ONNX resource cleanup ownership

The embedding owner captures session release, optional tokenizer disposal and
qualification-capacity release methods from the actual acquired objects. Cleanup
attempts the session and tokenizer independently in reverse acquisition order.
Qualification capacity remains held until both and every reported independent
pending owner are confirmed released. A missing session release method, failed
method capture or missing/throwing pending-owner observer cannot prove closure.
A supported tokenizer with only JavaScript state need not expose `dispose`.

Cleanup failures preserve the exact primary error as `cause`, each actual failure
in `errors`, nonenumerable primary capabilities and the original qualification
lease. Causes are never mutated. `onnxSessionOwner` retains the original resource
context, while nonenumerable `onnxResourceOwner` provides the exact process-local
`release()` capability. Concurrent release calls join one attempt; successful
child releases are never repeated. A retry invokes the originally captured
method rather than reopening a model or adopting a replacement object/method.
`cacheOwnershipReleased()` confirms that owner, including reported independent
pending work, and becomes true only after successful capacity release.

The actual successful embedding load retains this owner through cache retirement.
Startup cleanup failures propagate their original reconciliation capability;
deferred adapter disposal must preserve a failed acquisition carrying pending
ownership. An ordinary acquisition failure with no pending owner still needs no
disposal. This does not close a reusable session while accepted operations run:
existing adapter-operation and shared queue draining precede native disposal.

The same cache owner now keeps a strong retired-entry set after lookup ownership
is removed. A failed background/finalizer close retains its original startup or
loaded `onnxResourceOwner`, exact failure, and qualification capacity. Background
retirement attempts cleanup once; a recorded failure is not retried by another
cache prune or a stale finalizer. Rejected close flights are cleared so explicit
disposal reconciliation can attempt the same owner again. Successful native and
tokenizer closes are still remembered by that original owner.

`getRetiredOnnxSessionOwners()` returns process-local capabilities for the actual
retired entries. Each reports its startup observation, remaining references,
pending state, last failure and original resource owner. Its `release()` targets
only that entry, coalesces concurrent attempts, and creates no model, tokenizer,
replacement cache entry or native session. Pending errors retain a nonenumerable
`onnxCacheOwner` alongside the original native capability. Releasing the original
resource capability directly also notifies the cache through `onSettled`, so a
confirmed closed entry with drained references is removed from strong retirement
ownership. Missing startup resource ownership never becomes empty successful
cleanup. Final release requires the original owner's explicit `true` confirmation
and its observed settled state.

Each adapter/finalizer reference releases once. A finalizer callback drains that
adapter's accepted operations before dropping the reference, then shared queue
settlement precedes native close. Disposing one shared adapter keeps cache lookup
available to other live references. The first reference is pinned before capacity
pruning, including a newly inserted entry selected after a backwards clock.
Failed direct and deferred disposal may be called again deliberately; acquisition
is never restarted by that disposal retry. A pending native startup error cannot
enter the existing low-memory create retry or the provider's Xenova fallback.

Authored controls call the actual provider with inert native/acquisition modules
and a controlled finalizer callback boundary. They cover shared-reference reuse,
stale finalization, accepted startup/inference work, capacity victim pinning,
frozen repeated close failure, sibling isolation, original-resource settlement,
deferred retry, provider fallback refusal, unknown startup owner and unconfirmed
release. They do not execute GC, real native initialization or model inference.

Retirement errors keep the exact native cleanup aggregate as the outer `cause`
and sole outer `errors` member, preserving nested frozen aggregate boundaries.
Direct original-resource settlement does not establish accepted-work or shared
queue settlement: cache closure also requires drained references, completed
startup and an explicit successful `queue.onIdle()` observation. Gated source
controls cover direct resource release during accepted work and before a queue
drain. These controls are authored and unrun.

October 29 Windows checks exercise actual ONNX initialization, inference,
disposal, selected-installation pinning and complete external-data loading.
The installer uses compact immutable generation names, retaining full SHA256
closure verification independently of the directory name. Long absolute Windows
paths use the native path owner; external-data paths that still exceed its budget
fail before selector publication. Existing generations remain valid for readers.
The [closeout receipt](../archived/p2-p3-closeout-2026-10-29.md) retains the actual
native long-path failure and passing replacement-layout observations.

Controlled close failures establish JavaScript ownership and original-cause
preservation. They do not prove that an arbitrary real native release rejection
can safely be retried. GC finalization, allocator behavior, production-model
quality, capacity and broader runtime/platform qualification remain separate.
