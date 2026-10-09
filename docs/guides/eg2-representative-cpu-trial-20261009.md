# Representative EG2 CPU trial — 2026-10-09

The owner-authorized CPU campaign measured current implementation
`e5ff487d9d29577e112e53de586d407efc3ffade`, sequentially, on Windows / AMD Ryzen
7 5800X3D (8 cores, 16 logical processors). No historical checkout, GPU, DirectML,
full indexing or automatic restart was used. The measured campaign lasted
209.5 seconds including three configurations, judged retrieval, cancellation and
replay. No implementation defect was found; trial-harness problems were corrected
and their original failure receipts retained.

## Recommendation and measured configurations

Recommend **FP32, 768 dimensions, 4 requested intra-op threads, 1 inter-op thread,
sequential execution, spinning disabled, batch 8, lookahead 32**, with padded-token
budget 32,768, attention-work budget 67,108,864 and batch-character budget 16,000.
One owned native CPU child admits one request at a time, with 8 GiB heap bound.
This recommends a configuration; it does not authorize starting a full run.

| Configuration | Sample indexing seconds | Unique inputs/s | Useful tokens/s | Padding | Sampled peak child RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| FP32 / 2 threads / batch 4 | 63.21 | 1.63 | 387.34 | 16.25% | 2.17 GiB |
| FP32 / 4 threads / batch 8 | 40.73 | 2.53 | 601.09 | 29.99% | 3.07 GiB |
| W8 NBits accuracy level 4 / 4 threads / batch 8 | 74.49 | 1.38 | 328.70 | 29.99% | 2.66 GiB |

All runs encoded the same 103 unique inputs / 24,484 useful tokens, retained 110
actual source occurrences and reused seven actual duplicate inputs. Timings include
prepared tokenization, worker IPC, inference and transactional persistence; model
load/warmup and retrieval queries are separate. W8 uses the existing verified
custom `model_w8a8.onnx` graph: the loader dtype selector is `fp32` to select that
exact unsuffixed custom graph, while the explicit numerical recipe and graph hash
identify its quantized weights. It is not an FP32 precision result or integer-kernel
dispatch proof. W8 was slower and is not promoted.

## Corpus coverage, deduplication and ETA

The read-only corpus census covered 89,059 visible units and 377,093 occurrences.
Complete prefixed effective-input hashing found 345,299 unique inputs: 31,794
encodings saved, **8.43%**. Character lengths refer to production 1,000-character
spans / 200-character overlap, including its surrogate-boundary handling.

Sampling used deterministic bottom-hash reservoirs across code, document,
metadata and tool-activity content and character-length strata, then actual
prefixed tokenizer lengths to cover 16–1,009 tokens. Topical additions support the
retrieval judgments. Corpus token estimates exclude those topical additions and
use only the deterministic reservoir: approximately 127.86 million unique-input
tokens, with sampling-only estimated interval 110.23–145.50 million.

ETA reconstructs the exact measured batch plans, allocates batch latency by useful
token contribution, and weights each content/character stratum by its exact corpus
unique-input count. It also scales measured non-inference pipeline overhead by
occurrence count. For the recommended configuration the estimate is **57.18 hours**,
with sampling-only band **46.72–67.63 hours**; simple token scaling independently
gives 59.09 hours. Plan approximately **50–80 hours** at similar machine conditions.
The other estimates were 88.34 hours for 2-thread FP32 and 103.38 hours for W8.

These are estimates, not full-run completion guarantees. Real source-unit grouping
and future padding may differ; this trial stores isolated sampled spans with their
original provenance, rather than importing all corpus units. Statistical bands do
not capture background load, filesystem costs or sustained thermals. Initial CPU
load snapshot was 2%, mid-run 40%, post-run 33%; external load was not continuously
isolated, so the run is not certified uncontended. Sampled child CPU averages were
1.97, 3.56 and 3.15 core equivalents respectively; native effective pool sizes remain
unknown rather than inferred from requested thread counts. Memory is 500 ms RSS
sampling, not an allocator-level or full-corpus peak guarantee.

## Retrieval checks beyond vector agreement

Eight operator-authored paraphrased queries and graded relevance judgments were
locked before inference, covering authoritative vehicle velocity, generated car
render capabilities, corrupt prose bundles, missing SQLite vector extensions,
embedding progress, parsing watchdogs, Rust development packages and lockfile
dependencies. The source snippets remain private in the operator receipt folder.

All configurations achieved mean Recall@10 **1.00**, MRR@10 **1.00**, nDCG@10
**0.96284** on the 103-document judged pool. The actual persistent semantic adapter
also achieved Recall@10 / MRR@10 1.00 with source occurrences retained. A same-pool
FTS5 BM25 OR-term baseline achieved Recall@10 **0.9375**, MRR@10 **0.84375**.
These are pooled sanity judgments, not an external held-out product-quality test or
proof of full-corpus relevance. The lexical baseline is explicitly a simple FTS5
comparison, not the complete production hybrid retrieval policy.

Four-thread FP32 maximum document cosine drift versus two-thread FP32 was
`3.50e-13`; W8 maximum document drift was `0.0004813`, query drift `0.0001191`.
All candidate vectors were finite normalized full-768 outputs. Mean top-10 agreement
was 1.00, but that agreement is supplementary to the actual relevance judgments.

## Actual cancellation and durable replay

Cancellation was requested while a child-recorded native call was active, with one
prior batch of eight inputs already transactionally committed. Parent-owned native
handle termination confirmed child exit in **1,085.94 ms**. Receipt mode was
`parent-forced`, signal `SIGKILL`; interrupted results were not committed. The eight
prior committed vector byte strings remained identical.

A fresh authorized worker reopened the disposable trial DB and encoded only the
remaining 16 inputs in two batches, completing all 24 long-input units. Native
replay interval was 14.451 seconds; the worker then exited cooperatively. A focused
no-inference reopen/retest confirmed all 24 vectors unchanged and zero additional
encoding calls. Completed one-span units are skipped by the pending-unit query;
`reusedSpans` counts partial or referenced spans, not skipped complete units. The
initial overly broad trial assertion for that counter failed after successful replay
and byte checks; its receipt remains intact beside the passing focused retest.

## Runtime and remaining limits

Pinned model revision: `daa72c51243991dfcaf9f9137d2c573d8f7790c0`.
Runtime: existing Transformers.js 4.3.1 / ONNX Runtime Node 1.30.0 / Node 26.8.1.
FP32 graph SHA256: `bc47de15f81208a5c99e5ab10f746d5e33b51ea228b7dc0bef9c133a94f1c1c3`.
W8 derivative SHA256: `903fc9c1df518dc50e0f2c12765203e31386754a3c6afd3c231c463e9af6ac0e`.
Existing weights were hash-verified before inference; no software or artifacts were
installed or downloaded.

The trial harness explicitly imported the stale parent-directory better-sqlite3
12.6.2 binary (Node ABI 137), which failed under Node 26.8.1 (ABI 147) before model
loading. Its disposable databases therefore used Node's built-in SQLite with a
transaction/Buffer adapter and an explicit qualified local Transformers loader.
The original failure and all measurement receipts remain preserved. A Windows
trial-only `--import` path was also corrected to a file URL before model load.

A subsequent focused no-model readiness check used the actual production service
and its existing project-contained, lock-matching better-sqlite3 13.0.3 dependency.
Its Windows x64 N-API prebuild loads under Node 26.8.1; the supported native SQLite
probe also passed. No dependency install, rebuild or runtime change was necessary.
The production service imported two synthetic artifacts, searched lexically, closed
and reopened with stable citations, and retained exactly two units and one import.
Native SQLite integrity and foreign-key checks passed, DELETE journaling remained
active, and the embedding schema contained no vectors. Both runtime instances
reported unloaded with no child PID or active native calls; the nonexistent model
directory stayed absent and the source bytes stayed unchanged. This resolves the
reported SQLite packaging blocker for the current production dependency path;
it does not retroactively replace the trial's SQLite adapter or certify a full
corpus run. The focused fixture's initial unsupported `lookaheadUnits` key was
corrected to the production allowlisted `lookahead` key before its passing run.

Binding SHA256: `e21e5efd71fba66578e95b62554d9028064a80dafd7221bf8a8ef155de8d240a`.
Regression: `tests/integrations/inference-history/sqlite-readiness.test.js`.
Private readiness receipt: `eg2-sqlite-readiness-20261009/production-no-model-hs8RCb/receipt.json`.
No further inference, full indexing, GPU work or corpus changes were performed.

Final process verification found no task-owned inference worker. The shared corpus
remains at 89,059 units with no embedding tables reintroduced. Original data, logs,
receipts and all isolated campaign artifacts remain preserved. No full run was started.
Private evidence lives under the approved operator task folder
`eg2-representative-cpu-20261009/measured-current`: per-configuration receipts,
native-call/RSS logs, paired outputs, judged retrieval summary, ETA analysis,
cancellation receipt, focused durable replay retest and final process/source checks.
