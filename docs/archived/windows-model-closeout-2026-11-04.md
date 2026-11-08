# Windows model closeout — 2026-11-04

Clean source `0a469b42f0c24e46c322c00155fff9d92e0f2bc1` passes six fresh
E5 capsules, two independent raw MiniLM references and all192 original/current
provider-cost children. Every child keeps30 seconds, zero retries and original
cleanup. All32 cost cohorts pass; the longest cost child is21.259s.

The [E5 receipt](windows-e5-warm-qualification-2026-11-04.json) retains actual
Stage2, inference Stage3, warm Stage3 and query-vector cache operations against
the exact fp32 author export. Warm Stage3 has one indexed cache hit and zero
indexed inference batches; readiness probing remains separately recorded.
Cold/warm generation-bound queries agree with the independent raw reference,
reject stale template/identity witnesses and recover healthy cache reuse after
negative cases. Exact task/whitespace and unprefixed passages remain unchanged.
Revision2 names the graph's actual token_embeddings output; tokenizer, mean/L2
math and weights match the [earlier numerical/truncation/judged observations](windows-real-model-qualification-2026-11-04.md).
That authored16-document/8-query bilingual set records Recall@3=.9375,MRR=1
and nDCG@3=.802878; it does not establish representative retrieval gains.

The [provider receipt](windows-provider-cost-qualification-2026-11-04.json)
contains all192 raw child receipts/invocations and all48 complete allocation
profiles. Its lossless shared/table encoding reconstructs every value; profile
serialization reconstructs the exact original bytes and SHA-256. Three fresh
paired repetitions alternate original/current starting order for each route and
cold/warm timing, copy, allocation and memory cohort. Both MiniLM routes use the
independent matching32-row raw reference. EG2 compares exact old/current owners
on its32-row fp32/768 profile, including its prepared route.

| Route | Cold median original/current ms | Warm median original/current ms | Owned output bytes per batch |
| --- | ---: | ---: | ---: |
| Hugging Face MiniLM |495.058 /449.931 |225.125 /221.022 |49,152 |
| Direct ONNX MiniLM |760.032 /790.741 |421.468 /399.157 |49,152 |
| EG2 batch |6170.374 /5682.906 |3335.014 /3266.447 |98,304 |
| EG2 prepared |6305.455 /5956.931 |3187.294 /3140.948 |98,304 |

All comparisons agree exactly and retain request ordering. Current admission
performs one owned Float32 copy per output row, with no second full output copy.
Original tensor disposal and artifact-lease/cache cleanup settle in every child.
The two historical adapter/utils Git blobs are the only owner overlays; current
direct ONNX decoding is held fixed, so its historical admission overhead is not
isolated. Cold medians have three samples per arm; warm medians have nine.
Imports and artifact hashing precede operation clocks. OS cache is uncontrolled.
Sampled V8 allocations and5ms JS memory observations are separate from clean
timing; OS maxRSS covers the process lifetime. Raw costs are descriptive, with
no universal speedup, isolated native peak or production-capacity claim.

This completes the bounded Windows acceptance for #1542 and #1544. The existing
formatting, identity, unsupported-profile, shape/cardinality, numerical and
cleanup negatives remain covered by the linked source-bound controls. Optional
backends, non-Windows/editor/release checks and SQLite acceptance remain separate.
All scratch paths are historical author-workspace evidence; raw model weights
are not committed.
