# FAST.md

Comprehensive optimization sweep for indexing/build, tree-sitter scheduling, artifact I/O, embeddings, and vector/sqlite paths.

Format:
- `Area` — subsystem
- `Files` — primary touchpoints
- `Opportunity` — optimization idea
- `Impact` — expected benefit
- `Risk` — rollout/correctness caveat

---

## Sweep 1: Core hotspots (high-confidence wins)

1. [x] Area: Chunk-to-call detail matching
- Files: `src/index/build/file-processor/process-chunks/dedupe.js`
- Opportunity: Replace O(chunks * callDetails) containment scans with interval/binary-search or sweep structure.
- Impact: Large CPU reduction on files with many call details.
- Risk: Must preserve “smallest containing span” semantics.

2. [x] Area: Per-chunk lint filtering
- Files: `src/index/build/file-processor/process-chunks/index.js`
- Opportunity: Replace per-chunk full `filter()` scans with pre-bucketed/sorted lint ranges.
- Impact: Avoid O(chunks * lintEntries) behavior.
- Risk: Maintain exact range inclusion behavior.

3. [x] Area: Repeated chunk text slicing
- Files: `src/index/build/file-processor/process-chunks/index.js`, `src/index/build/file-processor/process-chunks/enrichment.js`
- Opportunity: Pass already-sliced chunk text into enrichment/type/risk steps.
- Impact: Lower allocation and CPU in hot loops.
- Risk: None if chunk boundaries are unchanged.

4. [x] Area: Byte-bound chunk splitting
- Files: `src/index/chunking/limits.js`
- Opportunity: Replace repeated `Buffer.byteLength(text.slice(...))` in binary-search loops with precomputed byte-offset tables.
- Impact: Major speedup on large prose/text files.
- Risk: Must preserve UTF-8 boundary correctness.

5. [x] Area: Repeated line splitting/scanning
- Files: `src/index/chunking/dispatch.js`, `src/index/chunking/formats/*.js`
- Opportunity: Share line index/splits across format chunkers instead of repeated `split('\n')`.
- Impact: Lower memory churn and parsing CPU.
- Risk: Keep line-number semantics stable.

6. [x] Area: Duplicate tree-sitter work
- Files: `src/index/language-registry/registry-data.js`, `src/index/build/file-processor/cpu.js`
- Opportunity: Prevent duplicate parse/chunk work between language prepare paths and scheduler paths.
- Impact: Material CPU reduction on JS/TS-heavy repos.
- Risk: Must keep identical chunk identities.

7. [x] Area: Duplicate segment discovery
- Files: `src/index/build/tree-sitter-scheduler/plan.js`, `src/index/build/file-processor/cpu.js`
- Opportunity: Reuse plan segment metadata in processing instead of recomputing.
- Impact: Less parsing/scanning overhead.
- Risk: Ensure metadata freshness and signature checks.

8. [x] Area: Sync I/O in import resolution
- Files: `src/index/build/import-resolution.js`
- Opportunity: Replace frequent sync fs operations with async + memoized caches.
- Impact: Better throughput and less event-loop blocking.
- Risk: Cache invalidation (mtime/size) correctness.

9. [x] Area: VFS manifest collector serialization
- Files: `src/index/build/vfs-manifest-collector.js`
- Opportunity: Cache serialized rows during append/spill to avoid double stringify.
- Impact: Lower CPU in large manifest generation.
- Risk: Slight memory increase if cached strings are retained too long.

10. [x] Area: Global build lock scope
- Files: `src/index/build/lock.js`, `src/index/build/watch/lock.js`
- Opportunity: Narrow lock duration to write/finalization phases.
- Impact: Better parallelism and less watch contention.
- Risk: Need strict atomicity and promotion invariants.

11. [x] Area: Chunk meta multiple serializations
- Files: `src/index/build/artifacts/writers/chunk-meta.js`, `src/shared/json-stream.js`
- Opportunity: Single-pass scan+write or reuse cached JSONL lines.
- Impact: Lower CPU and temp allocations.
- Risk: Preserve ordering hash and metrics behavior.

12. [x] Area: Double-atomic shard writing
- Files: `src/shared/json-stream.js`, `src/index/build/artifacts/writers/chunk-meta.js`, `src/index/build/artifacts/token-postings.js`
- Opportunity: Avoid per-part atomic writes when parent temp-dir rename is already atomic.
- Impact: Fewer temp files/renames.
- Risk: Keep crash safety guarantees.

13. [x] Area: Post-write `stat()` fanout
- Files: `src/shared/json-stream.js`, `src/shared/json-stream/jsonl-batch.js`
- Opportunity: Use known bytes-written counters instead of per-part `stat`.
- Impact: Fewer syscalls.
- Risk: Ensure writer byte accounting is exact.

14. [x] Area: Token postings shard copies
- Files: `src/index/build/artifacts/token-postings.js`
- Opportunity: Use generators/ranges instead of per-shard array slices.
- Impact: Lower peak memory.
- Risk: Must keep deterministic shard boundaries.

15. [x] Area: Redundant size estimation
- Files: `src/index/build/artifacts/writer.js`, `src/index/build/artifacts.js`
- Opportunity: Plumb precomputed JSON byte estimates to avoid duplicate traversals.
- Impact: Lower CPU on large arrays.
- Risk: None if estimates are consistent.

16. [x] Area: Typed-array JSON encoding
- Files: `src/shared/json-stream/encode.js`
- Opportunity: Batch numeric array writes into larger chunks (not per-element writes).
- Impact: Lower write overhead for dense vectors/postings.
- Risk: Ensure valid JSON output and memory bounds.

17. [x] Area: Cached JSONL line reuse
- Files: `src/index/build/artifacts/writers/chunk-meta.js`
- Opportunity: Reuse `__jsonl` lines when already computed during spill paths.
- Impact: Lower serialization work.
- Risk: Must ensure line reflects final row content.

18. [x] Area: Manifest meta read cost
- Files: `src/shared/artifact-io/manifest.js`
- Opportunity: Cache parsed meta JSON.
- Impact: Faster repeated artifact resolution.
- Risk: Invalidation on file changes.

19. [x] Area: Embeddings cache index durability
- Files: `tools/build/embeddings/runner.js`, `tools/build/embeddings/cache-flush.js`
- Opportunity: Periodic index flush during long runs instead of only end-of-mode flush.
- Impact: Better crash resilience and lower flush spikes.
- Risk: More lock/I/O contention if too frequent.

20. [x] Area: Unindexed fallback cache entries
- Files: `tools/build/embeddings/cache.js`, `tools/build/embeddings/runner.js`
- Opportunity: Ensure lock-contention fallback entries are indexed/prunable.
- Impact: Lower long-term cache bloat and faster lookup hygiene.
- Risk: Migration of existing orphan entries.

21. [x] Area: HNSW pending vector accumulation
- Files: `tools/build/embeddings/hnsw.js`
- Opportunity: Incremental insertion instead of keeping full `pending` vectors.
- Impact: Lower peak RSS and earlier failure detection.
- Risk: Must preserve deterministic insertion order.

22. [x] Area: Full JSON vector loads in isolate paths
- Files: `tools/build/embeddings/hnsw.js`, `tools/build/embeddings/lancedb.js`
- Opportunity: Stream vectors instead of loading full JSON artifacts.
- Impact: Avoid OOM and reduce GC pressure.
- Risk: More complex streaming parser path.

23. [x] Area: Full rewrite of SQLite dense tables
- Files: `tools/build/embeddings/sqlite-dense.js`
- Opportunity: Incremental upsert/update path for changed doc_ids.
- Impact: Large write-time reduction for partial rebuilds.
- Risk: Requires reliable change tracking and consistency checks.

24. [x] Area: Per-vector clamp logging
- Files: `src/storage/sqlite/vector.js`, `src/storage/sqlite/build/from-artifacts.js`, `src/storage/sqlite/build/incremental-update.js`, `src/storage/sqlite/build/from-bundles.js`
- Opportunity: Aggregate clamp warnings instead of per-vector logs.
- Impact: Lower log overhead in large ingestion runs.
- Risk: Slightly less granular diagnostics.

25. [x] Area: SQLite artifact ingestion memory spikes
- Files: `src/storage/sqlite/build/from-artifacts.js`, `src/storage/sqlite/utils.js`
- Opportunity: Stream token postings and dense vectors by default.
- Impact: Lower RSS and improved stability on large indexes.
- Risk: More complex error handling/recovery.

26. [x] Area: SQLite ANN candidate limit fallback
- Files: `tools/sqlite/vector-extension.js`
- Opportunity: Replace `topN * 5` fallback with stronger candidate pushdown strategy.
- Impact: Better recall and less wasted work for large candidate sets.
- Risk: Query complexity and temp structure management.

---

## Sweep 2: Additional non-overlapping opportunities

1. [x] Area: Line-based chunker architecture
- Files: `src/index/chunking/dispatch.js`, `src/index/chunking/formats/yaml.js`, `src/index/chunking/formats/json.js`, `src/index/chunking/formats/markdown.js`
- Opportunity: Shared streaming line iterator + shared line index.
- Impact: Better memory locality and fewer repeated full-text scans.
- Risk: Keep exact heading/range behavior.

2. [x] Area: Markdown heading detection allocations
- Files: `src/index/chunking/formats/markdown.js`
- Opportunity: Avoid materializing full `[...matchAll()]` arrays.
- Impact: Reduced intermediate object retention.
- Risk: None if iteration order preserved.

3. [x] Area: JSON chunk parsing allocations
- Files: `src/index/chunking/formats/json.js`
- Opportunity: Avoid repeated substring/search allocations in per-key loops.
- Impact: Lower CPU/GC in large JSON files.
- Risk: Must preserve parser correctness around escapes.

4. [x] Area: Per-chunk lookup reuse
- Files: `src/index/build/file-processor/process-chunks/index.js`
- Opportunity: Cache language + dictionary resolution per file/effective ext.
- Impact: Lower hot-loop overhead.
- Risk: None with file-local cache lifetime.

5. [x] Area: Span grouping key overhead
- Files: `src/index/build/file-processor/process-chunks/ids.js`
- Opportunity: Avoid repeated key-array creation/join and eager array promotion.
- Impact: Lower allocation pressure.
- Risk: Keep deterministic dedupe/grouping behavior.

6. [x] Area: Scheduler subprocess startup overhead
- Files: `src/index/build/tree-sitter-scheduler/runner.js`, `src/index/build/tree-sitter-scheduler/subprocess-exec.js`
- Opportunity: Reuse long-lived worker process(es) instead of one fresh process per grammar key.
- Impact: Lower startup/module-load overhead.
- Risk: Worker lifecycle and isolation complexity.

7. [x] Area: Parser language switch churn
- Files: `src/index/build/tree-sitter-scheduler/plan.js`, `src/index/build/tree-sitter-scheduler/executor.js`, `src/lang/tree-sitter/native-runtime.js`
- Opportunity: Batch executor jobs to reduce `setLanguage` churn for mixed-language groups.
- Impact: Better parser throughput.
- Risk: Output order changes must remain deterministic.

8. [x] Area: Duplicate plan/executor file reads
- Files: `src/index/build/tree-sitter-scheduler/plan.js`, `src/index/build/tree-sitter-scheduler/executor.js`
- Opportunity: Share cached text/hash across phases or skip re-hash on unchanged signatures.
- Impact: Reduced disk/hash cost.
- Risk: Stale-read prevention logic required.

9. [x] Area: Scheduler result metadata repetition
- Files: `src/index/build/tree-sitter-scheduler/executor.js`, `src/index/build/file-processor/cpu.js`
- Opportunity: Segment metadata table + references instead of per-chunk duplication.
- Impact: Smaller artifacts and lower parse cost.
- Risk: Contract/schema changes.

10. [x] Area: Piscina backpressure/cancellation
- Files: `src/lang/tree-sitter/chunking.js`, `src/lang/tree-sitter/worker.js`, `src/lang/workers/tree-sitter-worker.js`
- Opportunity: Add abort propagation + bounded queue controls.
- Impact: Better tail latency and cancellation behavior.
- Risk: Must not regress throughput defaults.

11. [x] Area: Scheduler cancellation gaps
- Files: `src/index/build/tree-sitter-scheduler/runner.js`, `src/index/build/tree-sitter-scheduler/subprocess-exec.js`
- Opportunity: Add abort checks in index loading and child cleanup paths.
- Impact: Less wasted work on canceled builds.
- Risk: Partial-output cleanup must stay safe.

12. [x] Area: Manifest piece-index rebuilds
- Files: `src/shared/artifact-io/manifest.js`
- Opportunity: Cache `name -> entries` index per manifest object.
- Impact: Faster repeated artifact lookups.
- Risk: Must not cache across stale manifest objects.

13. [x] Area: Small-file JSONL read fast path
- Files: `src/shared/artifact-io/json.js`
- Opportunity: For small files, use buffered parse path instead of stream setup.
- Impact: Lower overhead on frequent small artifact reads.
- Risk: Need strict size threshold.

14. [x] Area: Small gzip buffered parse path
- Files: `src/shared/artifact-io/json.js`
- Opportunity: Buffered decompress+parse for tiny gzip files.
- Impact: Less stream overhead.
- Risk: Cap memory usage.

15. [x] Area: Offsets validation memoization
- Files: `src/shared/artifact-io/offsets.js`, `src/shared/artifact-io/loaders.js`
- Opportunity: Persist validation cache keyed by size/mtime signatures.
- Impact: Faster repeated startup/load paths.
- Risk: Robust invalidation required.

16. [x] Area: File descriptor reuse for row reads
- Files: `src/shared/artifact-io/offsets.js`, `src/shared/artifact-io/loaders.js`
- Opportunity: Keep handles open and reuse buffers for repeated `readOffsetAt`/`readJsonlRowAt`.
- Impact: Fewer syscalls and lower latency.
- Risk: FD lifecycle/leak management.

17. [x] Area: Coalesced row read batches
- Files: `src/shared/artifact-io/loaders.js`
- Opportunity: Group sorted offsets and read contiguous spans.
- Impact: Better I/O locality for symbol/chunk reads.
- Risk: Complexity in mapping responses back to original order.

18. [x] Area: Index signature fanout
- Files: `src/retrieval/cli-index.js`
- Opportunity: Use manifest-level stats/signature caching instead of per-part stat scans.
- Impact: Faster repeated index signature computation.
- Risk: Avoid stale cache when parts mutate.

19. [x] Area: VFS index map cache
- Files: `src/index/tooling/vfs.js`
- Opportunity: Cache parsed `.vfsidx` map by path+mtime.
- Impact: Lower repeated load cost.
- Risk: Small memory overhead.

20. [x] Area: VFS offset reader coalescing
- Files: `src/index/tooling/vfs.js`
- Opportunity: Coalesce offset reads and use shared buffers.
- Impact: Less random I/O.
- Risk: Maintain ordering guarantees.

21. [x] Area: Chunk meta hot/cold split
- Files: `src/shared/artifact-io/loaders.js`, `src/index/build/artifacts.js`
- Opportunity: Separate frequently used chunk fields from cold metadata.
- Impact: Smaller read footprint for common retrieval paths.
- Risk: Schema/migration complexity.

22. [x] Area: Windowed packed-postings reads
- Files: `src/shared/artifact-io/loaders.js`
- Opportunity: Avoid full `.bin` loads by windowed reads.
- Impact: Lower memory spikes.
- Risk: More complex random-access logic.

23. [x] Area: ANN candidate fallback type mismatch
- Files: `src/retrieval/pipeline.js`, `tools/sqlite/vector-extension.js`, `src/retrieval/bitmap.js`
- Opportunity: Normalize candidate set types (`Set` vs bitmap) before ANN query pushdown.
- Impact: Prevent unnecessary full scans and truncation artifacts.
- Risk: Must preserve existing candidate semantics.

24. [x] Area: ANN provider preflight unused
- Files: `src/retrieval/pipeline.js`, `src/retrieval/ann/providers/*.js`
- Opportunity: Implement provider `preflight` hooks to avoid repeated expensive failures.
- Impact: Lower cold/misconfigured query cost.
- Risk: Preflight must be cheap and deterministic.

25. [x] Area: Dims mismatch policy inconsistency
- Files: `src/retrieval/rankers.js`, `src/retrieval/lancedb.js`, `tools/sqlite/vector-extension.js`
- Opportunity: Standardize mismatch behavior across providers (reject/clip policy).
- Impact: Predictable results and fewer surprise fallbacks.
- Risk: Behavior change needs explicit contract update.

26. [x] Area: Search-side SQLite pragmas
- Files: `src/retrieval/cli-sqlite.js`, `src/storage/sqlite/build/pragmas.js`
- Opportunity: Apply read-optimized runtime pragmas (`cache_size`, `mmap_size`, `temp_store`, `busy_timeout`).
- Impact: Better query latency on larger DBs.
- Risk: Platform tuning variance.

27. [x] Area: WAL checkpoint/journal tuning for embedding updates
- Files: `tools/build/embeddings/sqlite-dense.js`, `src/storage/sqlite/build/pragmas.js`
- Opportunity: Tune `wal_autocheckpoint`/`journal_size_limit` for heavy vector writes.
- Impact: Smoother write latency and less WAL burst behavior.
- Risk: Must avoid excessive checkpoint frequency.

28. [x] Area: Cache-hit path overhead
- Files: `src/retrieval/query-cache.js`, `src/retrieval/sqlite-cache.js`, `src/retrieval/index-cache.js`, `src/retrieval/cli/run-search-session.js`
- Opportunity: Avoid full query-cache JSON parse and frequent sync stats on hit paths.
- Impact: Lower P95 for repeated queries.
- Risk: Need safe cache format migration.

---

## Sweep 3: Expert/tricky opportunities (high complexity, high payoff)

Implementation policy for Sweep 3:
- Every change ships behind an explicit flag, with legacy path fallback.
- Every binary/storage contract change is dual-read before dual-write, then default-flip.
- Every step must include deterministic parity tests and benchmark deltas.

1. Area: Binary columnar core artifacts
- Files: `src/index/build/artifacts/writers/chunk-meta.js`, `src/index/build/postings.js`, `src/shared/artifact-io/loaders.js`, `src/storage/sqlite/build/from-artifacts.js`
- Decision: Add `binary-columnar` artifact mode for `chunk_meta` and postings with varint lengths, offsets, and string tables; keep packed postings as baseline.
- Rollout: `artifacts.binaryColumnar=true`; dual-write with ordering hash/checksum parity; reader preference flipped only after parity soak.
- Target: 2x+ load speedup and 40%+ lower load RSS.

2. Area: Streaming chunk lifecycle
- Files: `src/index/build/indexer/steps/process-files.js`, `src/index/build/state.js`, `src/index/build/postings.js`
- Decision: Stream `chunk_meta` writes during processing and retain only minimal per-chunk stats needed by postings and quality signals.
- Rollout: `indexer.streamingChunks=true`; compare counts/hashes against legacy path before default enablement.
- Target: 40-70% lower peak heap on large builds.

3. Area: File-level token stream reuse
- Files: `src/index/build/file-processor/process-chunks/index.js`, `src/index/build/tokenization.js`
- Decision: Build one per-file token stream plus offsets, then map chunk ranges into it when token text is semantically identical to per-chunk tokenization.
- Rollout: `tokenization.fileStream=true` gated by safe mode checks; fallback to per-chunk path.
- Target: 30%+ tokenization CPU reduction on high-chunk files.

4. Area: Typed-array postings hash structures
- Files: `src/shared/token-id.js`, `src/index/build/state.js`, `src/index/build/postings.js`
- Decision: Move postings internals to typed-array/open-addressed structures keyed by token ids; preserve external artifact compatibility until contract flip.
- Rollout: `postings.typed=true`; dual-build parity with current postings writer.
- Target: 40%+ postings memory reduction.

5. Area: Persistent tree-sitter chunk cache
- Files: `src/lang/tree-sitter/chunking.js`, `src/lang/tree-sitter/state.js`
- Decision: Persist chunk outputs keyed by `{contentHash, grammarKey, optionsSignature}` with strict invalidation and determinism checks.
- Rollout: `treeSitter.cachePersistent=true`; reuse only when signature + hash match.
- Target: 2-5x faster incremental tree-sitter stage for unchanged files.

6. Area: Phrase n-gram rolling hashes
- Files: `src/index/build/state.js`, `src/index/build/postings.js`
- Decision: Replace phrase string concatenation with rolling token-id hash windows, with collision fallback checks.
- Rollout: `postings.phraseHash=true`; dual-write phrase strings + hashes until collision telemetry stays clean.
- Target: 20%+ phrase build CPU reduction and lower phrase memory.

7. [x] Area: Ordered appender bucketed-watermark scheduler
- Files: `src/index/build/indexer/steps/process-files/ordered.js`, `src/index/build/indexer/steps/process-files.js`
- Decision: Add deterministic bucketed watermark flush policy to reduce long-tail stalls while preserving exact global order.
- Rollout: `indexer.orderedBuckets=true`; enforce strict order assertions in tests.
- Target: 50% lower pending buffer spikes and materially fewer stall warnings.

8. Area: Shared-memory scheduler transport
- Files: `src/index/build/tree-sitter-scheduler/runner.js`, `src/index/build/tree-sitter-scheduler/executor.js`, `src/index/build/tree-sitter-scheduler/lookup.js`
- Decision: Defer until paged scheduler store is implemented and benchmarked; keep as optional backend only.
- Rollout: `treeSitter.scheduler.transport=shm` experimental fallback to disk.
- Target: Pursue only if disk handoff remains dominant after items 9 and 12.

9. Area: Binary scheduler row encoding
- Files: `src/index/build/tree-sitter-scheduler/executor.js`, `src/index/build/tree-sitter-scheduler/lookup.js`, `src/index/tooling/vfs.js`
- Decision: Implement binary row pages with stable schema/versioning and checksums.
- Rollout: `treeSitter.scheduler.format=binary-v1`; dual-read with JSONL/page-json fallback.
- Target: Lower scheduler lookup parse CPU and reduce artifact bytes.

10. [x] Area: Parser pool / persistent grammar workers
- Files: `src/index/build/tree-sitter-scheduler/runner.js`, `src/lang/tree-sitter/native-runtime.js`
- Decision: Keep single-process parser caching as default; defer daemonized persistent worker pool until measured need.
- Rollout: optional tuning first (`MAX_PARSER_CACHE_SIZE`, warmup list) before long-lived pool.
- Target: lower startup churn without introducing lifecycle fragility.

11. Area: Cross-process scheduler row cache
- Files: `src/index/build/tree-sitter-scheduler/lookup.js`, `src/index/build/indexer/steps/process-files.js`
- Decision: Defer until paged store lands; evaluate shared page cache design only after in-process page cache metrics plateau.
- Rollout: optional `treeSitter.scheduler.sharedCache=true` after correctness soak.
- Target: only pursue if multi-process repeated lookup is a proven bottleneck.

12. Area: Compressed result pages + 2-level index
- Files: `src/index/build/tree-sitter-scheduler/executor.js`, `src/index/build/tree-sitter-scheduler/lookup.js`
- Decision: Introduce page store first (JSON rows in pages + page index), then add compression per-page.
- Rollout: `treeSitter.scheduler.store=paged-json`; add `codec` metadata and checksum verification.
- Target: lower random I/O and faster lookup tail latency.

13. Area: Zero-copy dense vector artifacts
- Files: `tools/build/embeddings/runner.js`, `src/storage/sqlite/build/from-artifacts.js`, `src/storage/sqlite/utils.js`, `src/retrieval/rankers.js`
- Decision: Add `dense_vectors_uint8.bin` plus meta describing dims/count/quantization; use direct typed-array views.
- Rollout: `embeddings.binaryDenseVectors=true`; dual-read with current JSON artifacts.
- Target: materially lower vector load time and startup RSS.

14. Area: Quantized sqlite-vec ingestion path
- Files: `tools/sqlite/vector-extension.js`, `tools/build/embeddings/sqlite-dense.js`, `src/storage/sqlite/quantization.js`
- Decision: Ingest quantized data directly when backend capability advertises support; fallback to float32 path.
- Rollout: `sqliteVec.ingestEncoding=auto`; strict capability gating.
- Target: reduce stage3/4 CPU and memory overhead.

15. Area: On-demand dense vector materialization at query time
- Files: `src/retrieval/sqlite-helpers.js`, `src/retrieval/ann/providers/dense.js`, `src/retrieval/cli/load-indexes.js`
- Decision: Load vectors lazily for candidate/topK windows with bounded LRU cache.
- Rollout: `retrieval.dense.lazyLoad=true`; keep eager mode fallback.
- Target: lower index load RSS and startup latency for large repos.

16. [x] Area: Candidate pushdown via temp tables/CTEs
- Files: `tools/sqlite/vector-extension.js`, `src/retrieval/cli-sqlite.js`
- Decision: Standardize temp-table candidate pushdown as primary large-set strategy, with explicit telemetry for fallback modes.
- Rollout: `sqliteVec.candidatePushdown=temp-table`.
- Target: stable recall and predictable latency for large candidate sets.

17. Area: Adaptive ANN provider orchestration
- Files: `src/retrieval/pipeline.js`, `src/retrieval/ann/normalize-backend.js`, `src/shared/metrics.js`
- Decision: Use bounded adaptive ordering from rolling latency/failure telemetry with stable session ordering guarantees.
- Rollout: `retrieval.ann.adaptiveProviders=true`; strict deterministic guardrails.
- Target: improve p95 ANN latency without destabilizing result quality.

18. Area: Background ANN maintenance/compaction
- Files: `tools/build/embeddings/runner.js`, `tools/build/compact-sqlite-index.js`, `src/retrieval/lancedb.js`
- Decision: Add threshold-triggered background maintenance with atomic artifact swap.
- Rollout: `embeddings.maintenance.background=true`; explicit thresholds for WAL growth, fragmentation, and drift.
- Target: stabilize long-run ANN throughput and tail latency.

19. [x] Area: Strict load-time embedding identity gating
- Files: `src/retrieval/cli/load-indexes.js`, `src/storage/sqlite/quantization.js`, `src/index/validate.js`
- Decision: Enforce strict identity and quantization compatibility across dense/hnsw/sqlite artifacts at load time.
- Rollout: default strict; non-strict mode warns but never mixes incompatible providers in one run.
- Target: eliminate subtle stale-artifact correctness/perf regressions.

---

## Refined Sweep 3 execution waves

1. Wave A (lowest risk, immediate wins): 7, 12, 13, 16, 19.
2. Wave B (medium risk, major throughput): 2, 3, 5, 6, 14, 15, 17.
3. Wave C (high complexity/core format): 1, 4, 9.
4. Wave D (only if proven needed): 8, 10, 11, 18.
