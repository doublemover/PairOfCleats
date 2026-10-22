# Experimental local reranker pool and adapter

`createSearchPipeline` accepts an explicit `reranker` and `rerankPolicy` in its
programmatic context. `rerankPolicy.enabled:true` separates the fused candidate
cap (at most 4,096), production-ranked model pool (at most 64), and final output
cap (at most 64). The pool must cover final output and the candidate cap must
cover the pool. The opt-in defaults are 256 candidates, 32 pool members and a
2,000 ms scoring deadline. Disabled policy preserves existing candidate/output
selection. This adds no public CLI/config setting or automatically acquired model.

The candidate cap uses raw fused score, ordinal and source-rank ties before
production eligibility, boosts, diversity and graph ranking determine the model
pool. The adapter can score only that captured pool; each index must receive one
finite score in its declared range. Duplicate, missing, extra or malformed score
entries are rejected. Raw sparse/ANN scores and the pre-model selected score/type
remain on output alongside generation, stable source identity, pool rank and
policy/result identity. Equal model scores preserve pre-model order. Request
members and nested source context are immutable snapshots shared by the result
identity and adapter invocation.

`createLocalOnnxCrossEncoder` is an explicit local-only prototype for a
single-logit BERT export of `Xenova/ms-marco-MiniLM-L-6-v2`. The caller must supply
exact 40-hex model and tokenizer revisions, matching graph-closure, complete
artifact and tokenizer SHA-256 digests, verified Apache-2.0 license bytes and
exact supported Transformers/ONNX runtime identities in a strict profile. There
is no shipped revision or invented qualified pin. The graph/tokenizer bytes are
verified again after loading. The graph must expose BERT pair inputs and one
finite FP32 logit; the declared conversion is a stable sigmoid. A caller label
and license hash do not independently establish upstream provenance or legal
review. No local export has been downloaded, loaded or qualified by this change.

The source loader must return complete generation-bound UTF-16 spans matching
the captured member identity, start/end, exact text length and SHA-256 content
digest. Embedded previews and current-worktree reads cannot substitute for that
authority. The tokenizer uses query/passage pairs with no silent truncation;
query, passage, per-pair/total tokens and character work are bounded. One CPU
session admits one serialized operation with no queued requests. Requested
single-thread settings are configuration evidence; actual native thread/resource
use remains unmeasured. Weight closure is capped at 512 MiB.

Opt-in scoring errors and deadlines return the captured pre-model order with an
explicit diagnostic. Missing optional runtime/model reports
`ERR_RERANK_UNAVAILABLE` and `measuredModelFailure:false` during adapter creation.
Cancellation propagates as cancellation. A timed-out adapter that ignores abort
cannot mutate published fallback results; its settlement and owner remain on
the returned array. Cancellation/rejection with active work preserves the same
ownership on the error. A native cleanup failure is never converted into a
successful fallback. Callers retain and settle/dispose that owner before releasing
its resources. Adapter disposal closes admission, drains active work, retries
failed tensor/session/tokenizer cleanup, then releases artifact/storage leases.

Frozen immediate pending errors retain their original identity and nonenumerable
reconciliation capabilities. Late work receipts distinguish completed work
(`settled:true`) from pending native cleanup (`pending:true`), preserve the exact
late cause as nonenumerable `primaryError`, and retain its original release
observer. Cancellation errors expose the same dynamic `cacheOwnershipReleased()`
observation. A rejection or a plain resolved work promise cannot clear a nested
pending native owner. Without an explicit original release observer, that
ownership stays pending. A receipt with `pending:false` proves only the tracked
work and any reported nested ownership settled; it does not dispose a reusable
adapter's session on the caller's behalf.
The actual local scorer/adapter now captures tensor and session cleanup methods,
awaits disposal, retains failed tensor dependencies and closes scoring admission
after a pending cleanup failure. See [local cross-encoder cleanup](local-cross-encoder-cleanup.md)
for exact reconciliation and storage settlement behavior and its unvalidated limits.

Policy/result identities include adapter/model/tokenizer/profile/runtime,
formatting, source generation/selection, raw member scores and all candidate,
pool/output/deadline choices. This prototype adds no result cache. Source-authored
regressions cover pool rescue, immutable membership/context, invalid scores,
fallback/cancellation/late settlement, source-span admission and inert pair/tensor
behavior. They are unrun. Real model compatibility, held-out gains at matched
32/64 pools, cold load, p95 latency and retained memory remain separately scoped.
