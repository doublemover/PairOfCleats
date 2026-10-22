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

These source changes and inert regressions are unvalidated. Capturing an exact
native method does not establish whether a real native release rejection permits
a safe retry, or prove native handle state. Runtime-specific failure/retry safety,
real model initialization/inference/disposal, allocator behavior, queue and cache
retirement races and resource/performance measurements require separate evidence.
