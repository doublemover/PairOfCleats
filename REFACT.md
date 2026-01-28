# Refactor Plan (Large JS Files)

## Goals
- Reduce single-file complexity and improve testability/ownership boundaries.
- Centralize repeated cross-cutting concerns (logging, retry/backoff, config normalization, artifact IO, filter selection) so behavior stays consistent.
- Keep refactors mechanical: move code + add thin adapters, preserve behavior, update imports/tests.
- All line ranges are approximate and should not be treated as truth blindly, for convenience only

## Progress update (2026-01-26)

Remaining refactors:
- `src/retrieval/output/filters.js` (still monolithic).
- `tools/mcp/tools.js` (handlers not yet split into per-tool modules).
- `src/index/build/file-processor/cpu.js` (partial extraction only).
- `src/retrieval/pipeline.js` (partial extraction only).
- `src/map/isometric/client/edges.js` (partial extraction only).
- `src/index/build/piece-assembly.js` (still monolithic).

## Scope
Files remaining (>= ~500 LOC):

- `src/retrieval/output/filters.js`
- `tools/mcp/tools.js`
- `src/index/build/file-processor/cpu.js`
- `tools/config-inventory.js`
- `src/retrieval/pipeline.js`

---

## Phase 0 -- Shared modules to extract first (reduces repeated work)

### 0.1 `src/shared/retry.js`
- Extract generic backoff + jitter helper (used by watch lock backoff).
- Source: `src/index/build/watch.js` lines **74-113** (`acquireIndexLockWithBackoff`).
- Tasks:
  - [ ] Add unit tests in `tests/shared/retry-backoff.test.js`.

### 0.2 `src/shared/scheduler/debounce.js`
- Extract debounced scheduler for reuse.
- Source: `watch.js` lines **133-159** (`createDebouncedScheduler`).
- Tasks:
  - [ ] Add unit test `tests/shared/debounce-scheduler.test.js`.

### 0.3 `src/shared/fs/ignore.js`
- Centralize ignore matcher logic used by watchers and discover.
- Source: `watch.js` lines **231-247** (`buildIgnoredMatcher`).
- Tasks:
  - [ ] Reuse in `discover.js` (if applicable) to avoid drift.
  - [ ] Add tests for directory vs file ignore semantics.

### 0.4 `src/shared/filter/merge.js`
- Centralize merge semantics for CLI vs filter expressions (ext/lang/type/etc).
- Source: `src/retrieval/filters.js` merge helpers **~194-215** (exact function lines logged below in Phase 3).
- Tasks:
  - [ ] Update tests in `tests/lang-filter.js`.

---

## Phase 1 -- File-by-file split plan

### 1.1 `src/index/build/watch.js` (849 LOC)
Current top-level functions and ranges:
- `resolveWatcherBackend` **47-73**
- `acquireIndexLockWithBackoff` **74-113**
- `waitForStableFile` **114-132**
- `createDebouncedScheduler` **133-159**
- `normalizeRoot` **160-164**
- `resolveRecordsRoot` **165-173**
- `readRecordSample` **174-191**
- `resolveMaxFilesCap` **192-196**
- `resolveMaxDepthCap` **197-201**
- `isIndexablePath` **202-224**
- `resolveMaxBytesForFile` **225-230**
- `buildIgnoredMatcher` **231-247**
- `watchIndex` **248-899**

Internal blocks inside `watchIndex` that can be lifted (line anchors within watch.js):
- Scheduler + shutdown handling: **317-366** (`stop`, `requestShutdown`, `scheduleBuild`).
- Tracked entries update queue: **368-416** (`applyTrackedUpdates`, `flushPendingUpdates`, `scheduleUpdateFlush`).
- Tracked/skip bookkeeping: **425-462** (`ensureModeMap`, `ensureSkipMap`, `recordSkip`, `clearSkip`, `incrementTracked`, `decrementTracked`, `removeEntryFromModes`).
- Discovery building and file classification: **470-607** (`buildDiscoveryForMode`, `classifyPath`, `updateTrackedEntry`).
- Build execution: **608-699** (`runBuild` and validation block).
- Event handlers: **764-876** (`recordAddOrChange`, `recordRemove`, `recordBurst`, `handleEvent`, `handleError`, watcher wiring).

Refactor tasks:
- [ ] Split `watchIndex` into:
  - `createWatchContext` (inputs, runtime, guardrails, state) -- **~258-316**
  - `registerShutdownHandlers` -- **~324-360**
  - `createWatchScheduler` (debounce, queue) -- **~363-416**
  - `createTrackedIndex` (tracked/skip bookkeeping) -- **~425-607**
  - `runWatchBuild` -- **~608-699**
  - `wireWatchEvents` -- **~764-876**
- [ ] Keep `watchIndex` as orchestration glue; all heavy logic moves to `src/index/build/watch/*.js`.

Tests potentially affected:
- `tests/watch-atomicity.js`, `tests/watch-e2e-promotion.js`, `tests/watch-shutdown.js`
- Any tests importing watch internals (if any) -- update paths.

### 1.2 `src/integrations/core/index.js` (823 LOC)

Tests potentially affected:
- `tests/core-api.js`, `tests/build-index-all.js`, `tests/build-embeddings-cache.js`

## 1.8

- [ ] Extract queue creation into `src/index/build/runtime/queues.js`.

Tests potentially affected:
- `tests/runtime/*`, `tests/concurrency/*`

### 1.9 `src/retrieval/output/filters.js` (707 LOC)
Top-level:
- `filterChunks` **21-710**

Refactor tasks:
- [ ] Extract filter index candidate selection into `src/retrieval/output/filter-index.js` (exact match + bitmap selection).
- [ ] Extract meta filters into `src/retrieval/output/meta-filters.js`.
- [ ] Extract file matcher + regex logic into `src/retrieval/output/file-filters.js`.
- [ ] Keep `filterChunks` as orchestration (compose filter predicates).

Tests potentially affected:
- `tests/retrieval/*`, `tests/filters/*`, `tests/lang-filter.js`

### 1.10 `tools/mcp/tools.js` (692 LOC)
Top-level functions and ranges:
- `normalizeMetaFilters` **26-55**
- `maybeRestoreArtifacts` **56-83**
- tool handlers **84-678**
- `handleToolCall` **679-718**

Refactor tasks:
- [ ] Extract per-tool handlers into `tools/mcp/tools/*.js` (buildIndex, runSearch, download models, etc.).
- [ ] Extract meta filter normalization into shared `tools/mcp/filters.js`.
- [ ] Extract tool registry mapping into `tools/mcp/registry.js`.

Tests potentially affected:
- `tests/services/mcp/*.test.js`

### 1.11 `src/index/build/file-processor/cpu.js` (692 LOC)
Top-level:
- `chunkSegmentsWithTreeSitterPasses` **25-114**
- `validateChunkBounds` **115-136**
- `sanitizeChunkBou nds` **137-151**
- `processFileCpu` **152-705**

Refactor tasks:
- [ ] Move chunk bounds helpers to `src/index/build/file-processor/bounds.js`.
- [ ] Split `processFileCpu` into:
  - chunker (segments + tree-sitter)
  - analyzer (docmeta/relations/risk)
  - tokenizer (tokens + sequence)

Tests potentially affected:
- `tests/segment-pipeline.js`, `tests/format-fidelity.js`, `tests/type-inference-*`

### 1.12 `src/retrieval/cli.js` (691 LOC)
Top-level:
- `runSearchCli` **60-734**

- [ ] Extract query execution to `src/retrieval/cli/run-search.js`.

Tests potentially affected:
- `tests/search-*`, `tests/retrieval/*`

### 1.13 `src/index/language-registry/registry.js` (687 LOC)
Top-level:
- Registry data **84-540**
- `getLanguageForFile` **632-638**
- `collectLanguageImports` **639-667**
- `buildLanguageContext` **668-678**
- `buildChunkRelations` **679-698**

- [ ] Extract linguist mapping to `registry-linguist.js`.

Tests potentially affected:
- `tests/lang/*`, `tests/segments/*`

### 1.15 `src/retrieval/pipeline.js` (677 LOC)
Top-level:
- `createSearchPipeline` **22-707**

Refactor tasks:
- [ ] Split pipeline stages into `src/retrieval/pipeline/*` (pre-filter, sparse, ann, re-rank, output).
- [ ] Centralize stage metrics + trace into `src/retrieval/pipeline/metrics.js`.

### 1.17 `src/shared/json-stream.js` (662 LOC)
Top-level helpers and ranges listed in extraction log (see notes above).

Refactor tasks:
- [ ] Keep JSONL/array/object writers in `src/shared/json-stream/index.js`.

### 1.18 `src/map/isometric/client/edges.js` (650 LOC)
Top-level:
- `buildEdges` **4-679**

Refactor tasks:
- [ ] Split edge data model vs. rendering vs. layout into `edges/` submodules.

### 1.19 `src/index/build/piece-assembly.js` (647 LOC)
Top-level:
- `assembleIndexPieces` **296-687** plus helpers **19-295**.

Refactor tasks:
- [ ] Extract normalize/validate helpers into `piece-assembly/normalize.js` (19-136).
- [ ] Extract postings merge helpers into `piece-assembly/postings.js` (137-295).
- [ ] Keep `assembleIndexPieces` in `piece-assembly/index.js`.

---

## Phase 2 -- Tests and follow‑ups

- [ ] Add minimal unit tests for extracted helpers (retry/debounce/ignore) to prevent regressions.

---

## Notes
- Keep exports stable to avoid broad ripples in consumers/tests.
- Avoid behavioral changes while extracting; defer logic changes to separate PRs.
- Validate line ranges before moving to ensure no hidden side effects (especially in watch and runtime).

---

# Appendix A -- Mechanical refactor playbook (per file)

Use this template for every extraction so the refactor stays fast and safe:
1) Create new module file(s) in the target folder (empty export stubs).
2) Cut/paste the exact line range into the new file.
3) Add explicit exports in the new file (named exports only, same names).
4) Update old file imports to point at new module(s).
5) Keep the old file's public exports unchanged (re-export if needed).
6) Run the smallest relevant tests (or unit-targeted test) for that file.
7) Commit per logical chunk (don't mix refactors across unrelated files).

---

# Appendix B -- Exact extraction steps (file-by-file)

## B.1 `src/index/build/watch.js`

### New modules
- `src/index/build/watch/resolve-backend.js`
- `src/index/build/watch/backoff.js` (or reuse shared `src/shared/retry.js`)
- `src/index/build/watch/stability.js`
- `src/index/build/watch/records.js`
- `src/index/build/watch/guardrails.js`
- `src/index/build/watch/tracked.js`
- `src/index/build/watch/scheduler.js`
- `src/index/build/watch/runner.js`
- `src/index/build/watch/events.js`
- `src/shared/fs/ignore.js` (shared)
- `src/shared/scheduler/debounce.js` (shared)

### Minimal unit tests to add
- `tests/shared/debounce-scheduler.test.js` (existing behavior)
- `tests/shared/retry-backoff.test.js` (lock backoff)
- `tests/shared/ignore-matcher.test.js` (dir/file ignore rules)

### Existing tests to run after extraction
- `tests/watch-atomicity.js`
- `tests/watch-e2e-promotion.js`
- `tests/watch-shutdown.js`

## B.2 `src/integrations/core/index.js`

### New modules
- `src/integrations/core/progress.js` (createOverallProgress)
- `src/integrations/core/compat.js` (computeCompatibilityKey)
- `src/integrations/core/embeddings.js` (resolveEmbeddingRuntime, runEmbeddingsTool, createLineEmitter)
- `src/integrations/core/build-index.js`
- `src/integrations/core/search.js`
- `src/integrations/core/status.js`

### Internal splits inside `buildIndex`
- Input normalization + runtime bootstrap
- Discovery plan build
- Build loop per mode
- Optional embeddings tool run
- Post-build validation / promotion
- Final reporting + teardown

### Tests to run
- `tests/build-index-all.js`
- `tests/build-embeddings-cache.js`
- `tests/core-api.js`

## B.3 `src/index/validate.js`

### New modules
- `src/index/validate/manifest.js`
- `src/index/validate/artifacts.js`
- `src/index/validate/sqlite.js`
- `src/index/validate/lmdb.js`
- `src/index/validate/report.js` (optional: report build helpers)

### Tests
- `tests/index-validate.js`
- `tests/storage/sqlite/*`
- `tests/lmdb-*`

## B.4 `src/index/build/artifacts.js`

### New modules
- `src/index/build/artifacts/chunk-meta.js`
- `src/index/build/artifacts/repo-map.js`
- `src/index/build/artifacts/file-meta.js`
- `src/index/build/artifacts/filter-index.js`
- `src/index/build/artifacts/postings.js`
- `src/index/build/artifacts/vectors.js`
- `src/index/build/artifacts/io.js`

### Plan
- Split each artifact writer into its own file (each exports a `write*` function).
- `writeIndexArtifacts` stays as orchestrator

### Tests
- `tests/artifact-formats.js`
- `tests/artifact-size-guardrails.js`
- `tests/format-fidelity.js`

## B.5 `tools/build-embeddings/run.js`

### New modules
- `tools/build-embeddings/args.js`
- `tools/build-embeddings/runtime.js`
- `tools/build-embeddings/runner.js`
- `tools/build-embeddings/output.js`

### Tests
- `tests/build-embeddings-cache.js`
- `tests/embeddings-*`


## B.6 `src/index/build/worker-pool.js`

### New modules
- `src/index/build/workers/config.js` (normalize/resolve)
- `src/index/build/workers/protocol.js` (message encode/decode, error summarize)
- `src/index/build/workers/pool.js` (lifecycle / worker spawn)
- `src/index/build/workers/index.js` (re-export)

### Tests
- `tests/worker-pool.js`
- `tests/worker-pool-windows.js`

## B.7 `tools/api/router.js`

### New modules
- `tools/api/routes/*.js`
- `tools/api/middleware/*.js`
- `tools/api/responses.js`

### Tasks
- Break `createApiRouter` into sub‑routers per route group (search/status/index).
- Centralize JSON error response helper.

### Tests
- `tests/services/api/*.test.js`

## B.8 `src/index/build/runtime/runtime.js`

### New modules
- `src/index/build/runtime/config.js`
- `src/index/build/runtime/queues.js`
- `src/index/build/runtime/policy.js`
- `src/index/build/runtime/index.js`

### Tests
- `tests/runtime/*`
- `tests/concurrency/*`

## B.9 `src/retrieval/output/filters.js`

### New modules
- `src/retrieval/output/filter-index.js`
- `src/retrieval/output/file-filters.js`
- `src/retrieval/output/meta-filters.js`
- `src/retrieval/output/predicates.js`

### Tests
- `tests/retrieval/*`
- `tests/filters/*`
- `tests/lang-filter.js`

## B.10 `tools/mcp/tools.js`

### New modules
- `tools/mcp/tools/*.js` (one per handler)
- `tools/mcp/registry.js`
- `tools/mcp/filters.js`

### Tests
- `tests/services/mcp/*`

## B.11 `src/index/build/file-processor/cpu.js`

### New modules
- `src/index/build/file-processor/bounds.js`
- `src/index/build/file-processor/chunker.js`
- `src/index/build/file-processor/analyzer.js`
- `src/index/build/file-processor/tokenizer.js`

### Tests
- `tests/segment-pipeline.js`
- `tests/format-fidelity.js`
- `tests/type-inference-*`

## B.12 `src/retrieval/cli.js`

### New modules
- `src/retrieval/cli/load-indexes.js`
- `src/retrieval/cli/run-search.js`
- `src/retrieval/cli/options.js`

### Tests
- `tests/search-*`
- `tests/retrieval/*`

## B.13 `src/index/language-registry/registry.js`

### New modules
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/linguist.js`
- `src/index/language-registry/registry.js` (exports only)

### Tests
- `tests/lang/*`
- `tests/segments/*`

## B.14 `tools/config-inventory.js`

### New modules
- `tools/config-inventory/schema.js`
- `tools/config-inventory/scan.js`
- `tools/config-inventory/report.js`

## B.15 `src/retrieval/pipeline.js`

### New modules
- `src/retrieval/pipeline/stages/*.js`
- `src/retrieval/pipeline/metrics.js`

## B.16 `tools/build-sqlite-index/run.js`

### New modules
- `tools/build-sqlite-index/args.js`
- `tools/build-sqlite-index/runner.js`

## B.17 `src/shared/json-stream.js`

### New modules
- `src/shared/json-stream/compress.js`
- `src/shared/json-stream/atomic.js`
- `src/shared/json-stream/index.js`

## B.18 `src/map/isometric/client/edges.js`

### New modules
- `src/map/isometric/client/edges/data.js`
- `src/map/isometric/client/edges/layout.js`
- `src/map/isometric/client/edges/render.js`

## B.19 `src/index/build/piece-assembly.js`

### New modules
- `src/index/build/piece-assembly/normalize.js`
- `src/index/build/piece-assembly/postings.js`
- `src/index/build/piece-assembly/index.js`

## B.20 `tools/dict-utils/paths.js`

### New modules
- `tools/dict-utils/repo.js`
- `tools/dict-utils/build-paths.js`
- `tools/dict-utils/runtime.js`
- `tools/dict-utils/tooling.js`
- `tools/dict-utils/dictionaries.js`

---

# Appendix C -- Additional quick wins
- Consolidate CLI arg normalization patterns into a shared helper for tools that parse `process.argv` similarly (build‑embeddings, build‑sqlite, config‑inventory).
- Consolidate "load index state" and "read index root" helpers (used in `retrieval/cli`, `core/index`, `tools/mcp`).
- Centralize JSON output schema for diagnostics in `src/shared/diagnostics.js`.

---

# Appendix E -- Spot-check list (under 10s)

Add these to the refactor spot-check rotation:
- `query-cache-extracted-prose`
- `retrieval/filters/behavioral.test`
- `retrieval/filters/control-flow.test`
- `retrieval/filters/file-selector.test`
- `retrieval/filters/risk.test`
- `retrieval/filters/types.test`
- `search-missing-index`
- `services/mcp/errors.test`
- `watch-debounce`
- `parity`
- `smoke-sqlite`
- `core-api`
- `extracted-prose`
- `search-windows-path-filter`
- `services/api/cors-allow.test`
- `smoke-section1`
- `smoke-workers`
- `sqlite-cache`
- `worker-pool`
- `worker-pool-restart`
- `worker-pool-windows`

---