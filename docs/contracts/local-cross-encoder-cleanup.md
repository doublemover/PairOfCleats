# Local cross-encoder cleanup ownership

Status: **UNVALIDATED_PARTIAL** source and authored regression assertions. No
syntax/test/lint/format/bootstrap/build, native/model execution, or resource and
quality measurement was performed for this source slice.

The actual local adapter uses its existing run queue, artifact lease and storage
session. Each acquired input/output tensor captures its original `dispose`
method before later work can replace it. Disposal promises are awaited. Aliased
input/output objects close once per captured resource. A missing or throwing
required method leaves that exact object pending rather than assuming release.

A failed tensor disposal retains both the original tensor and captured disposal
capability. Its inference session remains owned until all failed tensors close.
The first pending scoring cleanup closes further model admission. Reconciliation
can retry those same tensors through `error.rerankerOwner.close()`, without
adopting a replacement tensor/session/tokenizer method or reopening model paths.

After queued work drains and original tensor/native-work prerequisites settle,
session release and an observed tokenizer disposal are attempted independently.
Successful closes are remembered across retries. The
pinned Transformers JavaScript tokenizer permits absence of `dispose`; when a
method exists, it is captured and awaited, and a throwing getter remains pending.
Artifact release and the existing storage-session settlement follow confirmed
native cleanup. The storage receipt includes the exact original `resourceId`,
`settled:true`, and explicit `pending:false`. A rejected exact storage release
can itself be retried without repeating successful native/artifact closes.

Frozen inference, cancellation, acquisition and close errors remain exact causes
inside an aggregate with actual `cleanupErrors`, the original native owner, and
the adapter owner. Nonenumerable reconciliation descriptors survive. Original
release observers are invoked with their original receiver, including through
unavailable-runtime wrapping. An original pending resource without a release
observer remains pending. An unrelated pending acquisition capability is exposed
to the caller; adapter cleanup does not call arbitrary descendant methods or
release its own artifact/storage leases while that original observer is false.

Controls substitute only acquisition and native boundaries while calling the
actual local adapter/scorer. They author normal cleanup, asynchronous tensor
failure with frozen inference cause, replaced methods, coalesced cleanup,
independent session/tokenizer failures, exact storage retry and nested acquisition
ownership cases. Synthetic profile hashes and revisions are fixture identities.
They are not model pins, legal provenance, compatibility evidence, or measured
model/quality/resource failures. Real local export and runtime qualification,
native disposal retry safety, thread/memory limits and held-out gains remain
separate work.

The scorer now retains an original pending native-work observer on its exact
input/output tensor capabilities before attempting cleanup. A rejected native
operation does not authorize disposing inputs still used by that operation.
Original observers, including an observer without a pending marker, keep their
original receiver/function after later property replacement. Session cleanup
drains its accepted queue, then reconciles captured tensors, and checks original
pending work before closing the session or tokenizer. Startup failures also
retain the tokenizer until their original native owner reports settlement.

An explicitly false child close result is unconfirmed. A fulfilled captured
native close is remembered while an independently retained observer remains
pending, so later reconciliation does not repeat that successful native close.
Existing explicit ordinary failed-close retry behavior remains; this does not
qualify native retry safety. A later cancellation during successful cleanup does
not replace an already caught inference failure, including a falsey value.

Private original cleanup-producer records identify a failure made by this owner;
copied `rerankerOwner`/`storageSession` fields cannot suppress an unrelated
original observer. Only a failure observed directly at the exact storage release
call receives that release's existing retry handling. Actual adapter/scorer and
inert resource controls for these paths are authored and **UNVALIDATED**. No
native runtime/model/thread/resource/memory/quality or performance qualification
was executed, and no model/tokenizer/license/revision/default policy changed.
