# Kingfisher CPU embedding verification - 2026-10-09

One canonical current-repository CPU benchmark completed successfully in 8 minutes
23 seconds, within the existing 30-minute owned-process bound. Source checkout:
`onevcat/Kingfisher` at `656a75cd0eef3c542aecf2f522a1328637504176`.
Benchmark source: detached `ac1645f82984798f1430975c3b7d1729c6aa8245`.
No historical checkout, broad language wrapper, GPU or additional benchmark ran.

## Runtime and production resources

Node 26.8.1 used the isolated exact-lock runtime: Transformers.js 4.3.1,
better-sqlite3 13.0.3 and the existing native ONNX runtime. Shared dependencies
were preserved. The existing MiniLM-L12-v2 q8 graph SHA256 is
`f51725bc66b2bf5335cacb5c005763b57bcd741172372795819741cd945a9dd9`.
This normal-repository model differs from archive EG2 full-768 FP32.

Actual pinned English (370,105 words) plus current Kingfisher identifiers
(4,494 words) loaded an effective union of 372,301 words. Tiny synthetic packs
were excluded. Missing optional SourceKit remains explicit degraded semantic
coverage; the result does not certify full Swift project/toolchain acceptance.

Canonical dictionary/model config settings were rejected by the typed schema.
The schema now explicitly validates supported fields with strict property and
range checks; the focused regression and affected test-enrollment check passed.

## Observed build and retrieval

Index build took 442,334 ms and SQLite build 16,592 ms. Outputs include 265 code
files / 2,465 chunks, 30 prose files / 249 chunks, 3,788 extracted-prose chunks,
and 5,368 unique embedding-cache entries. All build stages completed.

Merged channels contain 6,502 valid finite 384-dimensional uint8 vectors.
Nonzero-channel dequantized norms range approximately 0.992645 to 1.008812;
quantization does not retain exact float unit norms. Document-only zero-channel
placeholders are distinguished from model outputs. All three persisted SQLite
indexes match vector counts and dimension 384. The readiness encode separately
verified finite 384-dimensional float output from the actual CPU model.

Eight predeclared source-backed queries ran per memory/SQLite backend with ANN
disabled. Mean query times were 507 ms and 1,282.125 ms respectively; each had
25% nonempty hit rate. A separate bounded correctness capture used only the same
eight queries per backend, without rebuilding or generating embeddings.
Source-path Recall@10, MRR@10 and expected function/anchor coverage were all zero.
All six returned citations had valid paths, offsets, line ranges and SHA1.
The eight expected source hashes and anchor lines were independently unchanged.

This miss follows existing sparse-only semantics: unquoted adjacency is implicit
AND and code search retains stopwords. Long natural sentences therefore require
all words. The existing ANN query-semantics regression explicitly distinguishes
this behavior from free-text vector search. No matching policy or judgments were
changed. This run establishes embedding production and sparse query behavior;
natural-language semantic retrieval accuracy remains unmeasured.

The owned supervisor bound was wired but active cancellation was not exercised.
Native model thread count and build peak RSS were not observed. CLI worker count
four does not prove four native inference threads. Earlier archive cancellation
receipts remain separate evidence, not proof for this normal benchmark.

## Preserved evidence and next phase

Private task folder: `kingfisher-benchmark-20261009` under the approved closeout
root. It retains initial schema failure, readiness correction, launch/exit logs,
canonical report, all ranked query payloads, source-anchor checks and vector checks.
Final `verification-summary.json` SHA256:
`fe3149136778e29f35a3d94380472baa2533af59a2ad868b37c02561d8b29325`.

The CPU lane is complete. Fresh original-catalog archive reprojection and actual
vocabulary are prepared; import/persistence checks and current exact EG2 tokenizer
counts precede current-policy archive qualification and inference. The frozen
422,794-input diagnostic plan is not the exact workload of the fresh derivative.
