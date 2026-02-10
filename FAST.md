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

6. Area: Duplicate tree-sitter work
- Files: `src/index/language-registry/registry-data.js`, `src/index/build/file-processor/cpu.js`
- Opportunity: Prevent duplicate parse/chunk work between language prepare paths and scheduler paths.
- Impact: Material CPU reduction on JS/TS-heavy repos.
- Risk: Must keep identical chunk identities.

7. Area: Duplicate segment discovery
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

10. Area: Global build lock scope
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

21. Area: HNSW pending vector accumulation
- Files: `tools/build/embeddings/hnsw.js`
- Opportunity: Incremental insertion instead of keeping full `pending` vectors.
- Impact: Lower peak RSS and earlier failure detection.
- Risk: Must preserve deterministic insertion order.

22. Area: Full JSON vector loads in isolate paths
- Files: `tools/build/embeddings/hnsw.js`, `tools/build/embeddings/lancedb.js`
- Opportunity: Stream vectors instead of loading full JSON artifacts.
- Impact: Avoid OOM and reduce GC pressure.
- Risk: More complex streaming parser path.

23. Area: Full rewrite of SQLite dense tables
- Files: `tools/build/embeddings/sqlite-dense.js`
- Opportunity: Incremental upsert/update path for changed doc_ids.
- Impact: Large write-time reduction for partial rebuilds.
- Risk: Requires reliable change tracking and consistency checks.

24. [x] Area: Per-vector clamp logging
- Files: `src/storage/sqlite/vector.js`, `src/storage/sqlite/build/from-artifacts.js`, `src/storage/sqlite/build/incremental-update.js`, `src/storage/sqlite/build/from-bundles.js`
- Opportunity: Aggregate clamp warnings instead of per-vector logs.
- Impact: Lower log overhead in large ingestion runs.
- Risk: Slightly less granular diagnostics.

25. Area: SQLite artifact ingestion memory spikes
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

1. Area: Line-based chunker architecture
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

6. Area: Scheduler subprocess startup overhead
- Files: `src/index/build/tree-sitter-scheduler/runner.js`, `src/index/build/tree-sitter-scheduler/subprocess-exec.js`
- Opportunity: Reuse long-lived worker process(es) instead of one fresh process per grammar key.
- Impact: Lower startup/module-load overhead.
- Risk: Worker lifecycle and isolation complexity.

7. Area: Parser language switch churn
- Files: `src/index/build/tree-sitter-scheduler/plan.js`, `src/index/build/tree-sitter-scheduler/executor.js`, `src/lang/tree-sitter/native-runtime.js`
- Opportunity: Batch executor jobs to reduce `setLanguage` churn for mixed-language groups.
- Impact: Better parser throughput.
- Risk: Output order changes must remain deterministic.

8. Area: Duplicate plan/executor file reads
- Files: `src/index/build/tree-sitter-scheduler/plan.js`, `src/index/build/tree-sitter-scheduler/executor.js`
- Opportunity: Share cached text/hash across phases or skip re-hash on unchanged signatures.
- Impact: Reduced disk/hash cost.
- Risk: Stale-read prevention logic required.

9. Area: Scheduler result metadata repetition
- Files: `src/index/build/tree-sitter-scheduler/executor.js`, `src/index/build/file-processor/cpu.js`
- Opportunity: Segment metadata table + references instead of per-chunk duplication.
- Impact: Smaller artifacts and lower parse cost.
- Risk: Contract/schema changes.

10. Area: Piscina backpressure/cancellation
- Files: `src/lang/tree-sitter/chunking.js`, `src/lang/tree-sitter/worker.js`, `src/lang/workers/tree-sitter-worker.js`
- Opportunity: Add abort propagation + bounded queue controls.
- Impact: Better tail latency and cancellation behavior.
- Risk: Must not regress throughput defaults.

11. Area: Scheduler cancellation gaps
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

21. Area: Chunk meta hot/cold split
- Files: `src/shared/artifact-io/loaders.js`, `src/index/build/artifacts.js`
- Opportunity: Separate frequently used chunk fields from cold metadata.
- Impact: Smaller read footprint for common retrieval paths.
- Risk: Schema/migration complexity.

22. Area: Windowed packed-postings reads
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

1. Area: Binary columnar core artifacts
- Files: `src/index/build/artifacts/writers/chunk-meta.js`, `src/index/build/postings.js`, `src/shared/artifact-io/loaders.js`, `src/storage/sqlite/build/from-artifacts.js`
- Opportunity: Introduce binary columnar artifact formats (string tables + varints) for chunk/postings and direct SQLite ingestion.
- Impact: Large reductions in parse CPU, IO, and RSS.
- Risk: Significant schema/versioning and dual-reader migration work.

2. Area: Streaming chunk lifecycle
- Files: `src/index/build/indexer/steps/process-files.js`, `src/index/build/state.js`, `src/index/build/postings.js`
- Opportunity: Emit chunk artifacts incrementally instead of retaining full chunk payload graph in memory.
- Impact: Lower peak memory and better scalability.
- Risk: Requires reworking stage dependencies and deterministic ordering guarantees.

3. Area: File-level token stream reuse
- Files: `src/index/build/file-processor/process-chunks/index.js`, `src/index/build/tokenization.js`
- Opportunity: Tokenize once per file with range-based chunk views.
- Impact: Major CPU/allocation win for highly chunked files.
- Risk: Must preserve token semantics and postings parity.

4. Area: Typed-array postings hash structures
- Files: `src/shared/token-id.js`, `src/index/build/state.js`, `src/index/build/postings.js`
- Opportunity: Replace string-keyed postings maps with numeric typed-array/open-addressed structures.
- Impact: Better memory density and update throughput.
- Risk: Encoding/version migration complexity.

5. Area: Persistent tree-sitter chunk cache
- Files: `src/lang/tree-sitter/chunking.js`, `src/lang/tree-sitter/state.js`
- Opportunity: Cache parse/chunk results by file hash + grammar/options signature.
- Impact: Strong incremental build speedups.
- Risk: Invalidation bugs can corrupt chunk identity determinism.

6. Area: Phrase n-gram rolling hashes
- Files: `src/index/build/state.js`, `src/index/build/postings.js`
- Opportunity: Replace phrase-string concatenation with rolling token-id hash windows.
- Impact: Lower memory and less string churn.
- Risk: Collision handling and compatibility strategy required.

7. Area: Ordered appender bucketed-watermark scheduler
- Files: `src/index/build/indexer/steps/process-files/ordered.js`, `src/index/build/indexer/steps/process-files.js`
- Opportunity: Bucketed deterministic merge to reduce stalls when far-ahead work arrives.
- Impact: Better concurrency utilization.
- Risk: Any order drift impacts deterministic IDs/hashes.

8. Area: Shared-memory scheduler transport
- Files: `src/index/build/tree-sitter-scheduler/runner.js`, `src/index/build/tree-sitter-scheduler/executor.js`, `src/index/build/tree-sitter-scheduler/lookup.js`
- Opportunity: Replace disk JSONL roundtrip with shared-memory ring/pages.
- Impact: Large latency drop for scheduler result handoff.
- Risk: Cross-platform shm complexity and fallback needs.

9. Area: Binary scheduler row encoding
- Files: `src/index/build/tree-sitter-scheduler/executor.js`, `src/index/build/tree-sitter-scheduler/lookup.js`, `src/index/tooling/vfs.js`
- Opportunity: Binary row format with compact offsets and checksums.
- Impact: Lower parse CPU and index size.
- Risk: Contract and tooling migration burden.

10. Area: Parser pool / persistent grammar workers
- Files: `src/index/build/tree-sitter-scheduler/runner.js`, `src/lang/tree-sitter/native-runtime.js`
- Opportunity: Reuse warmed parser/grammar workers across grammar keys.
- Impact: Lower startup overhead and better throughput.
- Risk: Memory growth management and failure isolation.

11. Area: Cross-process scheduler row cache
- Files: `src/index/build/tree-sitter-scheduler/lookup.js`, `src/index/build/indexer/steps/process-files.js`
- Opportunity: Shared cache keyed by virtualPath+signature for multi-process reuse.
- Impact: Reduced repeated row I/O.
- Risk: Cache coherence and eviction correctness.

12. Area: Compressed result pages + 2-level index
- Files: `src/index/build/tree-sitter-scheduler/executor.js`, `src/index/build/tree-sitter-scheduler/lookup.js`
- Opportunity: Page-based result storage with intra-page row index.
- Impact: Better read locality and smaller index metadata.
- Risk: Random-access complexity and corruption handling.

13. Area: Zero-copy dense vector artifacts
- Files: `tools/build/embeddings/runner.js`, `src/storage/sqlite/build/from-artifacts.js`, `src/storage/sqlite/utils.js`, `src/retrieval/rankers.js`
- Opportunity: Add binary `dense_vectors_uint8.bin` artifacts with direct typed-array views.
- Impact: Remove JSON parse/materialization overhead for vectors.
- Risk: New artifact contract and back-compat readers.

14. Area: Quantized sqlite-vec ingestion path
- Files: `tools/sqlite/vector-extension.js`, `tools/build/embeddings/sqlite-dense.js`, `src/storage/sqlite/quantization.js`
- Opportunity: Ingest uint8/float16 directly when backend supports it; avoid dequantize->float32 duplication.
- Impact: Lower CPU/memory during stage3/stage4.
- Risk: Backend compatibility and quality drift validation.

15. Area: On-demand dense vector materialization at query time
- Files: `src/retrieval/sqlite-helpers.js`, `src/retrieval/ann/providers/dense.js`, `src/retrieval/cli/load-indexes.js`
- Opportunity: Load dense vectors by needed candidate IDs/topK only.
- Impact: Lower startup memory for large indexes.
- Risk: Higher per-query I/O unless well-batched.

16. Area: Candidate pushdown via temp tables/CTEs
- Files: `tools/sqlite/vector-extension.js`, `src/retrieval/cli-sqlite.js`
- Opportunity: Replace IN-limit fallback with temp-table join pushdown for large candidate sets.
- Impact: Better recall consistency and predictable latency.
- Risk: Temp-table management and contention.

17. Area: Adaptive ANN provider orchestration
- Files: `src/retrieval/pipeline.js`, `src/retrieval/ann/normalize-backend.js`, `src/shared/metrics.js`
- Opportunity: Dynamic provider ordering from live latency/failure telemetry.
- Impact: Better median/tail ANN performance.
- Risk: Potential nondeterminism without strict policy constraints.

18. Area: Background ANN maintenance/compaction
- Files: `tools/build/embeddings/runner.js`, `tools/build/compact-sqlite-index.js`, `src/retrieval/lancedb.js`
- Opportunity: Async compaction/rebuild triggers when drift/fragmentation thresholds are hit.
- Impact: Stabilizes long-run performance.
- Risk: Operational complexity and atomic swap requirements.

19. Area: Strict load-time embedding identity gating
- Files: `src/retrieval/cli/load-indexes.js`, `src/storage/sqlite/quantization.js`, `src/index/validate.js`
- Opportunity: Enforce quantization/identity compatibility on load to avoid mixed-vector states.
- Impact: Prevents subtle correctness and perf regressions from stale artifacts.
- Risk: May force rebuilds for previously tolerated states.

---

## Suggested execution order (if implementing)

1. Quick wins first: Sweep-1 items 1-5, 11-17, 23-26.
2. Medium refactors: Sweep-2 items 6-20, 23-28.
3. Heavy redesigns behind flags: Sweep-3 items (binary formats, streaming pipeline, adaptive orchestration).
