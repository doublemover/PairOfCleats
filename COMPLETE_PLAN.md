# Complete Plan

This document consolidates all phase docs and tracks implementation status. Phase markdown files are removed after merge; this is the single source of truth.
Completed phases live in `COMPLETED_PHASES.md` at the repo root. When a phase is marked done, move it there; that file is long, so scan in small chunks or append new completed phases to the end.

## Status key
- done: implemented and validated
- partial: implemented with known gaps or follow-ups
- todo: not implemented
- in-progress: actively being implemented

## Validation requirements (apply to every phase)
- [ ] Add or update targeted tests for new behavior.
- [ ] Update relevant docs and config schema entries.
- [ ] Run the smallest relevant test suite for the changes (and note skips).

## Deferred / Do Not Surface (status: deferred)
- [ ] Evaluate FTS5 vs BM25 parity on larger benchmarks and retune weights.
  - Do not prioritize or bring this up unless explicitly requested.

## Phase 18: Typical Repo Benchmark Matrix (status: todo)
Goal: Run typical-size repo benchmarks across configurations and summarize performance.
Work items:
- [ ] Run typical-tier benchmarks for each backend/configuration.
- [ ] Capture build/search metrics, throughput, and memory stats per repo/backend.
- [ ] Summarize results and key deltas (performance, accuracy, stability).
- [ ] Record errors/failures with repo/backend context and logs.
- [ ] Add follow-up fixes or investigation notes if regressions are found.
Notes (current failures to triage):
- [ ] bench-language run 2026-01-05T20:06:30.610Z: javascript/microsoft/vscode ended via SIGINT (code 130) after worker pool disabled due to worker failure.
- [ ] bench-language run 2026-01-05T20:07:43.847Z: javascript/microsoft/vscode build failed with TypeError `stmt.body.body.forEach is not a function` in `src/lang/typescript.js` (TSModuleDeclaration).
- [ ] csharp/AutoMapper/AutoMapper: build-index failed (bench-language.log, exit code 134).
- [ ] rust/BurntSushi/ripgrep: one run crashed (bench-language.log, exit code 3221225477) despite later success.
- [ ] kotlin/Kotlin/kotlinx.coroutines: build-index crashed (bench-language.log, exit code 3221225477).
- [ ] perl/mojolicious/mojo: sqlite build failed with ERR_JSON_TOO_LARGE loading chunk_meta.json (~3.41 GB); SQLite index build failed in bench log.
- [ ] Worker-tokenize crash logs with empty `{}` / `[object Object]` messages in bench cache (csharp/AutoMapper, kotlin/kotlinx.coroutines, perl/mojolicious); verify new error-normalization reduces noise and capture actionable details.
- [ ] Bench runs ended via SIGINT (code 130) due to cancellation; rerun required for missing metrics once failures are fixed.
- [ ] bench-language:matrix run 2026-01-04T01-08-37-988Z: all sqlite/sqlite-fts/memory configs failed (matrix.json exit code 1 or 3221226505); inspect per-config logs under benchmarks/results/matrix/2026-01-04T01-08-37-988Z/logs.
- [ ] bench-language:matrix memory backends (auto/on/off): perl/mojolicious/mojo search failed with ERR_STRING_TOO_LONG while loading JSON (artifact-io now converts ERR_STRING_TOO_LONG to ERR_JSON_TOO_LARGE; re-run to confirm).
- [ ] bench-language:matrix sqlite/sqlite-fts backends: perl/mojolicious/mojo build failed with ERR_STRING_TOO_LONG while reading JSON for sqlite build (artifact-io now converts ERR_STRING_TOO_LONG to ERR_JSON_TOO_LARGE; re-run to confirm).
- [ ] bench-language:matrix sqlite-fts-auto-headline: php/composer/composer failed due to missing export getKotlinFileStats from src/lang/kotlin.js (language-registry import error; re-run to confirm after module refactor).
- [ ] bench-language:matrix sqlite-fts-auto-balanced: kotlin/Kotlin/kotlinx.coroutines crashed with exit code 3221226505 (native crash; no JS stack in log).

## Phase 19: Performance-First Input Filtering + Caps (status: done)
Goal: Reduce indexing I/O and memory by skipping build outputs, minified files, and binaries while enforcing per-language size/line caps.
Work items:
- [x] Expand default skip lists and config-driven ignore patterns for build/output dirs (add to `src/index/constants.js`, `src/index/build/ignore.js`), with explicit docs/config schema updates.
  - [x] Add minified detection (filename heuristics + line length/ratio checks) and record skip reasons in `src/index/build/discover.js` or `src/index/build/file-processor.js`.
  - [x] Add binary detection (null-byte/high non-text ratio sampling) before read/parse to skip large binaries quickly.
  - [x] Verify per-language `maxBytes`/`maxLines` caps exist; if missing, add to `src/index/build/runtime.js` + `docs/config-schema.json`.
  - [x] Add regression tests for skip reasons and per-language caps (new/updated tests under `tests/`).
Notes:
- Performance is the top priority: optimize for fast reject paths and low per-file overhead.

## Phase 20: Aggressive Embedding Batching + Auto-Tuning (status: done)
Goal: Maximize embedding throughput while keeping memory stable on large repos.
Work items:
- [x] Add an auto-tuned batch size based on model dims + available memory (`indexing.embeddingBatchSize`, `src/index/build/runtime.js`).
- [x] Batch embeddings with adaptive sizing and throughput logging in `src/index/build/file-processor.js`.
- [x] Ensure batching cooperates with worker pool/thread limits (avoid oversubscription on Windows).
- [x] Add config schema + docs for new batching controls.
- [x] Add benchmarks/tests to validate speed gains without OOM.
Notes:
- Favor larger batches for performance; fall back safely when memory pressure is detected.

## Phase 21: Tokenization/Minhash Cache by File Hash (status: done)
Goal: Skip tokenization and minhash for unchanged files using incremental bundles keyed by content hash.
Work items:
- [x] Extend incremental bundle metadata to persist tokenization/minhash outputs (and version tags) in `src/index/build/incremental.js`.
- [x] Use file hash (content) to decide reuse in `src/index/build/file-processor.js`, skipping tokenization/minhash when unchanged.
- [x] Add invalidation rules when tokenization config changes (segmentation, chargrams, phrase n-grams).
- [x] Add tests for cache reuse and invalidation.
Notes:
- Keep hash computation cheap and avoid full-text reads when size/mtime already match.

## Phase 22: SQLite Bulk Build Optimization (status: done)
Goal: Improve SQLite build throughput with larger transactions and reduced fsyncs during build.
Work items:
- [x] Use WAL + `synchronous=OFF` during bulk build in `tools/build-sqlite-index.js`, then normalize to `synchronous=NORMAL` after.
- [x] Batch inserts with larger transactions and delay index creation until after bulk inserts.
- [x] Tune `temp_store`, `cache_size`, and `mmap_size` for build time, then reset to safe defaults.
- [x] Add safety checks/rollback on failure to avoid partial DB corruption.
- [x] Add performance regression tests or benchmarks for build time.
Notes:
- Optimize for speed during build; ensure final DB is consistent and portable.

## Phase 23: Two-Stage Indexing with Immediate Searchability (status: done)
Goal: Produce a fast sparse index first (searchable immediately), then enrich in the background.
Work items:
- [x] Stage 1: build tokens/postings + minimal metadata; skip tree-sitter, risk, lint, embeddings (`build_index.js`, `src/index/build/indexer.js`).
- [x] Stage 2: background enrichment pipeline for tree-sitter/risk/lint/embeddings with partial artifact updates.
- [x] Add artifact readiness flags so search uses the best available data and knows which enrichments are pending.
- [x] Add queueing for background enrichment with resumable state.
- [x] Add tests for immediate search correctness and staged enrichment.
Notes:
- Performance first: stage 1 should be dramatically faster on large repos.

## Phase 24: Streaming Tokenization + GC Reduction (status: done)
Goal: Reduce allocation/GC overhead in tokenization and chunk processing.
Work items:
- [x] Refactor tokenization to stream per file and reuse buffers (`src/index/build/tokenization.js`, `src/index/build/file-processor.js`).
- [x] Avoid repeated string/array allocations in hot loops (chargrams/minhash).
- [x] Add lightweight metrics for allocations/GC pressure in verbose mode.
- [x] Add targeted tests for token correctness and performance.
Notes:
- Tight inner loops and fewer allocations are key to large-repo performance.

## Phase 25: Sharded Indexing + Merge (dir -> language) (status: done)
Goal: Split indexing into shards for parallelism and lower peak memory, then merge deterministically.
Work items:
- [x] Build a shard planner that groups by top-level directory, then by language (configurable).
- [x] Implement per-shard index builds with a global concurrency cap and per-shard limits (Windows-safe defaults; e.g., 1 worker per dir/lang, max total threads).
- [x] Implement deterministic merge for postings/vocab/minhash/embeddings and resolve doc_id offsets (`src/index/build/artifacts.js` + new merge helper).
- [x] Add shard-aware incremental updates and shard cache invalidation.
- [x] Add tests for merge correctness + Windows multi-worker stability.
Notes:
- Concurrency must be bounded globally on Windows to avoid worker instability.

## Phase 26: Embedding Service Extension + Separate Queue (status: done)
Goal: Decouple embeddings from indexing via an indexer-service extension with its own queue + vector cache.
Work items:
- [x] Add an embedding queue under service mode (`tools/indexer-service.js` or new service module) with durable cache state.
- [x] Implement embedding workers that fetch tasks, compute vectors, and write cached outputs keyed by file hash.
- [x] Integrate indexer to enqueue embedding tasks and ingest results asynchronously.
- [x] Add config for worker concurrency, memory caps, and Windows-safe limits.
- [x] Add tests for queue behavior, cache hits, and failure recovery.
Notes:
- Keep indexing unblocked; embeddings should not slow core build throughput.

## Phase 75: Repo-Level Diagnostics (status: todo)
Goal: Expose quick health and performance indicators.
Work items:
- [ ] Emit index stats summary at build end.
- [ ] Add a `pairofcleats status --json` report.
- [ ] Include shard, cache, and stage status.

## Phase 76: Test Suite Rationalization (status: todo)
Goal: Reduce test sprawl while keeping coverage.
Work items:
- [ ] Consolidate overlapping tests into suites.
- [ ] Remove redundant fixtures.
- [ ] Add stage-based integration tests.

## Phase 77: Performance Baseline Suite (status: todo)
Goal: Establish a stable perf regression workflow.
Work items:
- [ ] Add “perf smoke” benchmarks for indexing and sqlite rebuild.
- [ ] Track time/throughput for key repos.
- [ ] Add thresholds for regressions.

## Phase 78: Migration + Rollout Plan (status: todo)
Goal: Ship changes safely with clear rollback.
Work items:
- [ ] Add a migration guide for CLI/config changes.
- [ ] Provide a fallback path for legacy artifacts.
- [ ] Stage rollout in opt-in mode first.

## Phase 79: Legacy Cleanup Pass (status: todo)
Goal: Remove legacy code after migration stability.
Work items:
- [ ] Delete deprecated CLI commands and flags.
- [ ] Remove unused artifact formats.
- [ ] Update docs and tests to match.

## Phase 80: Final Consolidation + Audit (status: todo)
Goal: Verify functionality is preserved with less code and higher performance.
Work items:
- [ ] Run full validation (tests + benchmarks).
- [ ] Confirm perf goals and shard policy targets.
- [ ] Document final architecture and maintenance rules.


