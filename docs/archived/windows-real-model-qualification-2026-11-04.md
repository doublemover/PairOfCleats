# Windows real-model qualification — 2026-11-04

At clean `20e274f99a642ae1b452b3ad8faee70fd0c3f13c`, **24 actual-model
capsules pass**, serially, with original30-second bounds, zero retries and no
native-status redo. Runtime is Node26.13.0, Windows x64/ABI147, Transformers4.3.2
and shared ONNX Runtime1.30.0. The original offline graph/tokenizer closures
are SHA256/size verified before inference and rechecked after original cleanup.
No new model downloads, stub substitution or backend disabling is involved.

| Model / acceptance | Result |
| --- | --- |
| Instruct-E5 reference/product documents and queries | Four passes; strict1e-5 component and cosine agreement |
| E5 independent511/512/513-token boundaries | Four passes; exact IDs/masks, EOS retained, discarded/admitted-tail discrimination |
| E5 real Stage2 → Stage3 → query-cache | Three passes,19.009/16.872/20.958s; original snapshots, identities, cache hits/misses and stale-format/version negatives |
| BGE-M3 reference/product judged documents and queries | Four passes; correct raw text,1024-dimensional CLS/L2 vectors |
| BGE-M3 reference/single/batch/query routes | Four passes; matching batch geometry, reordering, masks and original cleanup |
| EmbeddingGemma2 single/batch/prepared/query/resources | Five passes; actual fp32/768-dimensional export, owned outputs and32-row large batches |

Both bilingual quality campaigns use the frozen16-document/eight-query corpus
and all128 predeclared judgments. Product/reference rankings match exactly.
At k=3, E5 Recall=.9375/MRR=1/nDCG=.802878; M3 Recall=.875/MRR=.9375/nDCG=.655620.
These describe this authored closed-world set, not a representative quality gain.
M3 uses its exact q8 export; E5 uses its exact author fp32/external-data export.
The scalar references share the verified ONNX model/runtime while independently
implementing the author's CLS or mask-mean/L2 arithmetic. They do not prove a
PyTorch conversion or semantics for another model/export.

The [durable machine receipt](windows-real-model-qualification-2026-11-04.json)
preserves complete source/runtime/model identities, measurements, vectors,
judgments, original invocation receipts and negative controls. Repeated values
and regular observation tables are encoded losslessly; reconstruction was
checked against every original report. Raw author paths under `.tmp/` remain
historical, not promised clean-checkout assets.

## Additional output-contract repair

Audit of the actual pinned E5 graph exposes a separate production mismatch:
the shared dense contract names `last_hidden_state`, but the graph declares
`token_embeddings` plus its already-pooled `sentence_embedding`. Xenova's
pipeline handles that name; the strict direct-ONNX output selector rejects
the real declaration before inference. The new metadata/decoder regression
fails184ms with the original contract and passes228ms after the repair.

The finite E5 contract now binds `token_embeddings` and advances to revision2.
Its task/query/passage bytes, mean/L2 arithmetic, graph and precision stay exact.
Old revision1 formatting/identities reject with rebuild guidance. Positive
selective fetch and masked mean, wrong-name and legacy-identity negatives remain;
M3's output name and unrelated generic/model recipes remain independently covered.
All four affected encoding/reference/metadata controls pass. The revision2
generation follow-up below records its subsequent actual-model acceptance;
the successful earlier cases retain source20e.

The direct-provider cost fixture also retained an obsolete1.31.1 assertion.
It now uses the canonical direct-reference runtime pin; the controller compares
the verified manifest version. Original historical adapter sources and model
inputs remain unchanged. This repairs fixture admission, not a model fallback.

Same-source original/current large-batch copy/allocation/memory/latency trials,
full SQLite trials and remaining optional/platform scope still need execution.

## Revision2 generation follow-up

At clean `2e87f986a`, the new raw/product judged-query pair and actual Stage2
pass. Stage3 publishes its successful original attempt, but its final Git
witness returns unavailable; that original capsule remains failed. The helper
previously discarded the underlying Git outcome, so its exact cause cannot be
attributed. A diagnostic load-boundary observation keeps both original Git
commands and errors without relaxing source admission or adding retries.

Repeated diagnostic Stage3 work exposes a separate fixture assumption: a real
provider probe may be ready while every indexed vector comes from verified
cache reuse. Original telemetry records zero indexed inference batches,
one cache hit/one chunk and no misses/rejections. The fixture now checks these
work counters independently of provider readiness and reports cache-only
indexed-vector work explicitly. Ready/probe metadata alone cannot pass; missing
hits, unverified/missed/rejected cache work, stub readiness and empty work retain
negative controls. Two focused cache/source-witness controls pass.

Future E5 receipts retain bounded initial/final Git command outcomes and errors,
with the original5-second command bounds and unchanged strict source equality.
Diagnostic runs do not qualify the failed case. Its original failure and the
subsequent source-bound generation checks remain distinct.
The [witness follow-up receipt](windows-model-source-witness-2026-11-04.json)
retains the failed invocation, diagnostic Git outcomes and focused controls.

At `6c739774a`, the raw/product judged-query pair and all three original
generation/cache cases pass:14.753/12.733s and23.156/20.627/24.870s respectively.
Both boundary Git witnesses are captured and clean; the
[revision2 receipt](windows-e5-v2-qualification-2026-11-04.json) retains full observations.
The generation controller additionally retains a separately bounded warm Stage3 reuse case;
it requires zero indexed inference batches and verified cache-only work before
the query-cache case. That new warm case remains pending execution.
