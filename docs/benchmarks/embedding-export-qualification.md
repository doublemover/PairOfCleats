# Actual embedding export qualification

These manual Windows campaigns qualify declared model bytes and real consumers.
Run after the locked bootstrap, implementation, formatting and source freeze.
Every original child has a30-second deadline and zero retries. Run measured
capsules serially; an interrupted campaign retains its failed invocation and
does not become passing evidence through a retry, provider fallback or stub.

Supply a new task-owned output directory and an explicitly frozen manifest.
The author's `.tmp/` and `.testLogs/` inputs and receipts are historical local
files, not prerequisites promised by a clean checkout. Model acquisition and
canonical opened-byte receipts establish available inputs; they do not prove
model loading, inference, disposal, quality or performance.

| Export/provider | Frozen qualification meaning |
| --- | --- |
| Xenova MiniLM q8 |32 saved source passages; raw tokenizer/model mask-mean/L2 reference and actual single/batch/query consumers |
| Xenova BGE-M3 q8 |Exact author graph/revision, unmodified inputs, independent raw CLS/L2 arithmetic |
| Instruct E5 fp32 |Exact author graph and external weights/revision, exact task/query template, raw mask-mean/L2 arithmetic |
| EG2 fp32/768 |Exact text-only profile/closure; actual single/batch/prepared/query consumers and route consistency |
| Direct ONNX MiniLM q8 |Canonical immutable graph installation plus exact tokenizer closure, root native runtime and independent raw-session mask-mean/L2 arithmetic |

The M3/E5 corpus has16 physical code/document passages, eight EN/ZH queries and
complete predeclared grades plus hard negatives. This is a closed-world judged
set, not representative retrieval improvement. Raw and product comparisons
retain identical input, batch and padding geometry with strict1e-5 component,
cosine, width, finite and norm checks. Sharing ONNX bytes/runtime does not prove
an independent PyTorch export conversion. Generic-main MiniLM acquisition has
exact byte hashes; do not invent an immutable author revision for that receipt.

## Native routes and judged retrieval

`node tests/perf/qualification/dense-export-reference.js <manifest> <fresh-output> quality`
runs four independent M3/E5 children: raw/product documents and raw/product
queries, then paired Recall, MRR and nDCG@1/3/5 overall and by language.
The separate `routes` selection retains raw/single/batch/query lifetimes.
Its16-document corpus does not qualify the32-row resource campaign.

`node tests/embeddings/run-actual-export-qualification.js --manifest <manifest> --route <route> --out <fresh-output>`
supervises the declared supported native route. Use an independently completed
matching reference through `--numerical-reference <receipt>` where supported.
EG2 route consistency does not supply an independent EG2 author reference.
Public prepared inputs belong to the qualified Xenova EG2 API; direct ONNX's
internal prepared-token reuse is a separate capability.

## Instruct E5 persisted consumers

`node tests/perf/qualification/e5-consumer-contract.js <manifest> <fresh-output> truncation`
checks independently authored511/512/513-token document/query boundaries,
retained EOS, discarded tail and a distinguishing admitted tail through real
tokenizers and models.

The `generation <raw-judged-query-receipt>` selection runs separately bounded
one-file inline Stage2, same-build Stage3 and generation-scoped query-vector
cache consumers. Each can also be selected independently using its prior real
stage receipt. Stage3 records actual inference or verified cache-only reuse;
cache-only work is never labeled inference. Cold misses, warm hits, exact
persisted identity, stale-template/version negatives and healthy reuse after
rejection remain asserted. These measurements describe the query-vector cache,
not a ranked-search-result cache.

## Admission and output costs

`node tests/perf/qualification/actual-adapter-costs.js --manifest <manifest> --numerical-reference <receipt> --cohort <cohort> --out <fresh-output>`
runs three alternating original/current pairs for one selected cohort.
Select `cold`, `warm`, `cold-copies`, `warm-copies`, `cold-allocations`,
`warm-allocations`, `cold-memory` or `warm-memory`. EG2 may separately select
`--route prepared`. Preserve all32–64 input rows and their order.

The comparison replaces exactly the saved adapter and normalizer owners at
their canonical module URLs; all other code, dependencies and assets stay
current. It is not a historical whole-tree benchmark. Clean operation clocks,
instrumented copy/disposal work, sampled JS allocations and memory have separate
passes. Sampled peaks are lower bounds, process maxRSS includes the entire
lifetime, and retained native allocator memory is not proof of a leaked tensor.
Original adapter/cache/resource cleanup and exact output parity remain required.
