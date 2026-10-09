# Archive retrieval checkpoint - 2026-10-09

Historical evidence; current status is in [the active roadmap](../roadmap.md).

## Retrieval improvement queue (October 9, 2026)

Extend the existing retrieval and archive paths in this order. Keep completed local archive persistence, citations, chunk context, declared relationships, original bytes and CLI behavior.

- [x] Preserve SQLite BM25 postings through weighted fallback and report actual field capability.
- [x] Retain ordered literal phrase evidence and apply sparse Boolean eligibility before top-N.
- [x] Reserve embedding writer count and encoded-byte capacity before yielding; release after settlement.
- [x] Reuse checksums from committed packed artifact bytes.
- [x] Rank/filter archive candidates before caps; add generation-bound continuation and generation-cached coverage.
- [x] Build/maintain/route optional Porter and trigram FTS tables, retain omitted-limit defaults, push large selective allowlists into SQLite, and report executed tokenizer identity.
- [x] Reuse bounded persisted chunk geometry for lexical/enrichment changes and body tokens when lexical identity is unchanged; refresh enrichment analysis and invalidate vectors independently. Per-file dependency tags survive interrupted refreshes and cross-file finalization. Batch/scheduling and blame-disabled HEAD changes retain bundles; output-only changes rebuild artifacts. Signature v4 cuts over older manifests once.
- [x] Feed cross-file embedding microbatches concurrently with count/byte admission bounds; build HNSW afterward from canonical chunk-ID slots without an additional reorder buffer.
- [x] Batch live per-file/global vector-cache I/O; budget actual encoded/shard/index bytes; compact registered shards within an I/O budget and prevent stale worker pointer resurrection.
- [x] Discover independent sparse/vector hybrid candidates by default; apply structured, phrase, exclusion and explicit Boolean eligibility before ANN top-N. Expose explicit lexical reranking through --ann-candidates lexical-rerank.
- [x] Route before resolving lazy query embeddings; reuse bounded normalized query/model/provider/generation embedding entries across sessions and provider health/preflight state for each cached index generation.
- [x] Use shared Unicode/ICU-versioned scoring boundaries for index and query; preserve complete Unicode identifiers and ASCII identifier splits. Canonically normalize literal phrase evidence; analyzer changes require rebuilding affected indexes.
- [x] Select modest source-span diversity before graph ranking fixes membership; accept a bounded supplied real reranker without synthetic scores or model acquisition. Use rank contributions for cross-mode bundles and label federated RRF while retaining native scores.
- [x] Map fast/hybrid/investigate presets, all/any/auto query matching, separate candidate/final counts, cooperative deadlines and explicit JSON byte budgets to execution; retain identity/span/generation/followup fields in compact output.
- [x] Add native archive title/path/facet discovery, preserved-source SHA grouping and role-aware context presets, with explicit derived-index rebuilds retaining citation identities. Persistent semantics and selective media execution remain conditional on supplied adapters and explicit use; no adapter/model/media input was supplied for this pass.

Use focused behavioral checks for each slice. No hosted CI wait, historical comparison campaign, model download or new local access/audit layer is required. The original conversation transfer remains a separate input blocker for real conversation/artifact examples; it does not block generic changes or DAT retrieval.

## Archive EG2 completion (October 9, 2026)

- [x] Wire the existing pinned real CPU EG2 encoder into the selected-source archive factory with explicit offline cache selection and archive-specific prompt/default controls.
- [x] Persist model/runtime/dtype/dimension/prompt identity and resumable bounded embedding batches in the archive database; invalidate changed sources/model spaces and gate partial-unit publication.
- [x] Use independently discovered persisted semantic candidates in existing archive hybrid retrieval with pre-cap eligibility and truthful coverage.
- [x] Complete real fp32/768 EG2 acceptance on Windows Node 26.8.1 with pinned Transformers.js 4.3.1 and SHA256-verified official model weights. Eleven preserved DAT units produced 55 finite normalized vectors; semantic/hybrid retrieval succeeded with zero lexical candidates, reopened persistence retained all units, and resume encoded zero additional spans.
- [ ] Complete selected DAT corpus indexing (89,059 units). The 600-second resumable fp32/768 job stopped at its deadline with 340 complete units, 1,468 durable spans, and 88,719 units pending. The selected manifest, archive generation, and checked citation were preserved; full-corpus completion remains separate from the successful 11-unit acceptance. Media remains outside this text integration.

## Archive EG2 acceleration audit (October 9, 2026)

Source: [independent acceleration audit](https://chatgpt.com/space/page_a02fd879bed08191a5a62a64a07f2759).
The old CPU/fp32/768d batch-4 job was stopped at owner request on October 9 at 15:53:39 UTC.
Its native process and descendants exited after cancellation, with 2,442 units / 10,326 spans retained.
Do not restart full indexing or trial GPU paths. Original DATs and extracted corpus remain preserved.
The old archive database also contains source units; permanent derived-table cleanup awaits explicit approval.

- [x] Add bounded actual-token-length scheduling over complete prefixed inputs; cap padded linear and
  attention work, preserve Unicode offsets/output mapping, flush tails fairly, and avoid tokenizing twice.
- [x] Coalesce exact effective inputs and persist computation reuse while keeping every source occurrence,
  citation and visibility rule. Collect unused derived vectors on redaction/deletion; do not drop artifacts.
- [x] Separate document computation, query policy and representation identities. Retain full 768d vectors
  and derive approved lower dimensions without inference. An explicit copy-only converter is supplied and synthetically checked;
  no real checkpoint conversion or duplicate run copy was performed.
- [x] Expose allowlisted CPU session options and requested/observed telemetry, including model/session
  lifecycle, actual token padding, preparation/inference/output/commit timings, and profiling/optimized graphs.
- [ ] Complete CPU numerical/relevance qualification. A separate real W8 accuracy-level4 trial
  recorded optimized operators and fallback logs for 32 documents / two queries.
  Missing MatMulNBits accuracy_level=0 and predicted q8 unpacked-FP32 fallback remain source inference
  until actual dispatch is qualified. Prepare explicit W8A8/W4A8 graph derivatives with hashes and test
  one candidate at a time against finite outputs, drift and judged retrieval quality.
- [x] Prepare a bounded loopback EG2 GGUF adapter and LM Studio command flow. Gate every use on exact
  engine architecture support, local model instance/backend, GGUF/tokenizer hashes, canonical prompts,
  learned 768d projection/pooling and query/document parity. Research/preparation only; no GPU trial.
- [x] Preserve single-flight admission after uncertain native/transport timeouts; timeout is not proof
  that native work stopped. Diagnose before resubmission and keep crash-safe batch checkpoints.
- [x] Implement bounded task-owned CPU worker cancellation. Report requestAccepted
  separately from workerStopped; keep the host responsive, allow 1000 ms cooperative
  grace, then terminate the original owned child handle and verify exit within 2000 ms.
  Bind the live process handle and nonce/PID handshake; never kill by process name or
  stale ancestry. The CPU entry creates no descendants; its native threads end on exit.
- [x] Validate cancellation lifecycle with blocked-child fixtures: cooperative and
  forced exits, accepted versus stopped reporting, finite exit-verification failure,
  IPC-loss self-exit and no automatic restart. Preserve committed batch transactions,
  replay only uncommitted interrupted spans on explicit resume, and reject late
  invocation/generation/content results. Existing real CPU pilot evidence is unchanged.
- [ ] Evaluate OS-enforced parent-death lifetime if future worker code can synchronously
  block JS while its parent also dies. Current IPC-loss watchdog requires a running child
  event loop; normal live-parent cancellation uses external handle termination.
- [ ] Reduce output copies and repeated statement/status preparation where safe; measure accumulated
  checkpoint-prefix scans before introducing a queue. Retain secure deletion and DELETE journaling.
- [x] Collect a read-only effective-input duplication census and representative token inventory:
  377,093 spans / 345,299 unique inputs, with 31,794 encodings saved (8.43%). The bounded
  103-input CPU trial measured useful versus padded tokens (16.25% padding at batch4;
  29.99% at batch8). No corpus re-embedding was performed.
- [ ] Complete independent singleton/mixed/bucketed scheduling parity qualification beyond the
  matched-input thread comparison; do not infer full-corpus quality from the bounded sample.
- [x] Evaluate two capped FP32 settings and one explicit W8 setting in one bounded sequential
  campaign. FP32 / 4 intra-op / 1 inter-op / sequential / spinning off / batch8 / lookahead32
  won at 601 useful tokens/s, 2.529 unique spans/s and sampled peak child RSS 3.073 GiB.
  Keep one owned worker. The 2-thread/batch4 alternative reached 387 tokens/s; W8 reached
  329 tokens/s and is not promoted. Matched FP32 output drift was below 3.51e-13.
- [x] Verify current Windows Node 26.8.1 production SQLite readiness using the existing locked
  better-sqlite3 13.0.3 N-API binding: synthetic import/search, durable close/reopen, idempotent
  import, stable citations and native integrity checks passed without any model or worker load.
  The previous ABI failure came from the trial harness's explicit stale parent 12.6.2 import,
  not the current production resolution; no installation or rebuild was needed.
- [ ] Plan separate full-index search scaling (typed/native vectors or ANN with exact reranking), preserving
  hard filters and source visibility. Dimensional truncation improves storage/search, not transformer speed.
- [ ] Keep alternative compiled PyTorch, LiteRT-LM, OpenVINO, ROCm and MLX routes as qualified fallback
  research; no new installs, machine transfers or runtime changes are implied by this backlog.

The first explicit CPU pilot used the pinned q8 graph derivative (146 NBits nodes, accuracy_level=4),
2 intra-op / 1 inter-op threads, sequential execution, spinning off, batch 4 and single-flight.
All 34 outputs were finite normalized 768d vectors; top-10 overlap with exact-input FP32 was 100%.
Maximum cosine drift was 0.000155105 for documents and 0.000144067 for queries. The 66.17-second
run contended with the old CPU index, so this establishes no uncontended speedup. The observed
CPU profile retained MatMulNBits and ordinary MatMul; operator names do not prove integer-kernel
execution. Zero held-out judged queries means Recall/MRR/nDCG qualification and promotion remain open.
W4 was not tried. Full-index restart, GGUF/LM Studio execution and GPU work remain unperformed.

The later representative CPU campaign used eight predeclared operator-pooled graded queries:
all three candidates achieved Recall@10=1, MRR=1 and nDCG@10=0.96284; the actual persistent
semantic adapter also achieved Recall/MRR=1. These are not external held-out relevance results.
Corpus-weighted FP32 winner ETA is 57.18 hours (46.72-67.63 sampling-only interval; plan
50-80 hours for unmeasured contention/disk effects). Active cancellation confirmed worker exit
in 1.086 seconds and replay preserved committed vectors. The shared 89,059-unit corpus remains
stopped with legacy derived embedding tables removed under owner authorization and no new
embedding tables introduced. All original trial/cleanup receipts remain intact. No further
inference, full indexing or GPU work is authorized by these tracking updates. Evidence and
limits: [representative CPU report](../guides/eg2-representative-cpu-trial-20261009.md).

### Recovered archive structure and vocabulary audit — 2026-10-09

- [x] Connect structural source reconstruction, bounded contextual document inputs and exact tokenizer-budget fallback; preserve current-source citations and cross-fragment invalidation.
- [x] Unify archive body/discovery/query lexical analysis with explicit effective vocabulary receipts; preserve whole identifiers, acronyms, Unicode and literal constraints.
- [x] Add original-source diversity and metadata-reference hybrid rehydration; report real reranker availability and preserve hard filters/privacy.
- [x] Validate six integrated no-model acceptance checks and the owning runtime regressions. Production SQLite13.0.3 remains verified on Windows Node26.8.1.
- [x] Freeze final read-only diagnostic corpus plan: 422,794 contextual inputs / 135,924,462 fixed-tokenizer tokens; metadata packing corrects tiny-field amplification. All 24 large-source admission checks pass. Preserve intermediate receipts and unchanged originals. Actual current-policy reprojection/vocabulary regeneration remains required.
- [ ] Run the verified Kingfisher normal-repository CPU embedding benchmark after readiness gates, using current source, judged queries and bounded supervision. It is now medium; no historical comparison or extra guardrail campaigns.
- [ ] Use the normal-repository results plus separate archive integration acceptance and final workload plan before the authorized recovered-corpus sequence; fix/report material quality or workload problems first. CPU only.

Policy, limits and evidence: [archive pipeline integration](../guides/archive-pipeline-integration-20261009.md).

- [ ] Eliminate repeated whole-source reconstruction with bounded generation/content-aware source-plan reuse before the costly corpus stage; validate call counts and privacy invalidation without inference.

### CLI, Setup and Generated-Artifact Acceptance

The [October 6 record](../guides/cli-acceptance-2026-10-06.md) preserves the 58-route
CLI/setup/service acceptance, strict option controls, subprocess cleanup and
staged ingest output preservation. Input/dependency/producer failures retain old
output and summary; successful publication is not a crash-atomic two-file transaction.
Closed setup input reports an actionable error; explicit strict search remains opt-in.

Optional-tool degradation produces one bounded, deduplicated summary per pass,
with redacted provider details in the application-owned default cache. The integrated
source retains 48 underlying checks and a healthy contribution; current hosted
lane receipts are linked above. Trust, chunk identity and required output contracts remain strict. No
tool install/upgrade or generic automatic binary fallback is enabled.

The current ordered CI-lite manifest has 887 entries, preserving the earlier
prefix and additions. Platform receipts identify pass and declared-skip counts
for their exact revision; they do not establish every optional backend or SDK.
The no-ANN forwarding regression remains mandatory. Node24 is retained and
better-sqlite3 is 13.0.3; older 827/837-entry and SQLite 12.6.2 statements describe
historical checkpoints only.

Map/core/cache classification follows the [ownership contract](../guides/generated-artifact-ownership.md),
[core contract](../guides/generated-core-artifact-metadata.md) and
[object-cache contract](../guides/generated-object-cache-metadata.md). Fifteen audited
object/runtime families carry first-field provenance. Explicit record roots/globs
win; malformed/unrecognized input remains indexable. Ordinary paths add no marker
I/O; renamed admission uses the existing content read. Bounded prefix validation,
legacy cache reads, keys/TTL/health, complete payloads and streaming byte caps are
preserved. Native descendants are not excluded by manifest claims.

Remaining artifact batches cover exact-member linkage, remaining runtime state,
reports/editor output and native/package/TUI surfaces. Preserve schemas, JSONL/array
shapes, checksums and useful searchable reports. The [Mac checklist](../guides/mac-acceptance-2026-10-06.md)
and [archived checkpoints](archived/ordinary-integration-roadmap-2026-10-06.md) are
historical plans/results. Final native, snapshot recovery, dependency bootstrap,
retrieval quality, watch readiness and representative performance require current
evidence; isolated SQLite/Node26 measurements do not authorize runtime promotion.
