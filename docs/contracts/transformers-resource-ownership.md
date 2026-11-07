# Transformers component and tensor ownership

The qualified text component loader captures each actual tokenizer/model object
and its original optional disposal method before returning it. A model creation
failure releases the already acquired tokenizer. Independent cleanup failures
retain the exact primary and cleanup objects, including frozen nested aggregates
and falsey thrown values. A pending native acquisition marker remains dependent
on its original release observer; an unknown or throwing observer cannot become
successful empty cleanup. Reconciliation never repeats model/tokenizer loading.

The actual adapter passes that existing component owner into the prepared text
encoder. The encoder refuses a closed owner or an owner of different component
objects. The downloader also releases the actual returned component owner, so a
model disposal failure does not skip tokenizer disposal or replace an earlier
metadata/receipt error. Generic pipeline download cleanup captures that pipeline
directly. No acquisition plan, immutable revision, dtype, tokenizer identity,
license, readiness requirement or default quality policy changes here.

`captureTransformersResource` remembers a method, getter failure and receiver
once. Absence of an optional JS disposer is permitted; an observed invalid method
or explicit `false` disposal result remains a failure. Successful API completion
is remembered. Retrying a failed native close is available only through explicit
existing-owner `release()` or a later explicit encoder/provider disposal. The
ordinary `retire()` path reports a prior failure without retrying it. This does
not qualify native close retry safety or prove underlying allocator settlement.

Prepared inference owns all observed input/output tensor objects in its existing
operation. The scope captures each assembled input immediately, including before
a later constructor can fail. It also captures tokenizer tensors and every
observed output before shape/vector validation. Aliases share one captured owner.
The projected output vectors are copied before tensors are retired. Ordinary
failure and malformed output still attempt independent observed tensor cleanup.

An original pending native-work observer gates tensor retirement, rather than
treating a rejected JS operation as proof of native settlement. Pending tensor
cleanup stops new inference admission and retains the encoder's original model
and tokenizer. Accepted inference and preparation drain through the existing
run queue. Accepted profiling work also drains before component closure. No
global cache teardown or sibling resource adoption is used to close one encoder.

`transformersResourceOwner` on failures identifies the exact resource, operation
scope or encoder. The existing module keeps strong pending owner references in
`getPendingTransformersResourceOwners()` until their actual scoped closure.
Scopes and the encoder retain parent ownership while child cleanup remains
pending. Explicit reconciliation joins active flights, preserves original child
observers/receivers and never repeats a successful child close. The outer cache
still requires its own accepted-work/reference drain before its own closure.

The exported direct Xenova adapter uses the same captured pipeline owner even
when its supplied pipeline disposer throws an ordinary unbranded error. Artifact
verification failure retains that plain cleanup failure as pending ownership.
Its first later disposal reports the observed failure; another explicit disposal
can target the same original object/method. Pending initialization does not load
a new pipeline, and ordinary existing unavailable handling remains separate.

The authored component, prepared tensor, direct Xenova and downloader controls
use inert JS components/module hooks. Existing outer/query controls additionally
cover falsey getter and primary failures. All new source and assertions are
**UNVALIDATED**. No model download, native import, real inference, browser/GPU,
GC, memory/allocator/thread/resource, numerical quality, latency or performance
qualification was executed. Tensor ownership follows the observed upstream
object/disposal contract; native internal child release and retry safety retain
their separate qualification requirements.

Generic Xenova inference also captures disposable output tensors, including
aliases in returned arrays/records. Vectors backed by those outputs are copied
before disposal; plain JS vectors keep their existing identity without that
extra copy. Accepted direct-provider work includes async output cleanup before
its pipeline lease can close. A failed output keeps that original pipeline and
provider strongly retained, stops new inference and uses explicit existing-owner
reconciliation. Original unknown native-work observers gate closure.

Known prepared encoder/component/tensor capabilities delegate to that same
encoder's guarded closure, identified by private original encoder/lease bindings
and original failure-producer records. Copied owner fields and causal membership
alone are not closure authority. Producer records split only their own composed
receipt; every independent original child observer remains a prerequisite.
An empty generic output scope cannot become a prerequisite for the prepared
cleanup it must drive. The original captured pipeline cleanup capability also
delegates through that pipeline. No sibling capability is adopted. The startup
observer is captured once with its original receiver.

The mixed known-owner/unknown-child negative retains the unknown observer even
after the known child settles. Original pending observers are cached by exact
error identity, so a later getter/property replacement cannot supply a different
closure receipt. An earlier absence is not cached as settlement: a later actual
owner can supply its first observation on that same error. These controls remain
authored and unrun.

Warm lookup retirement treats pending cleanup as ownership failure even when its
primary name/code still represents cancellation or queue admission. Ordinary
admission cancellation retains the existing warm policy. The additional generic
output/delegation/cancellation controls are inert, authored and **UNVALIDATED**.
