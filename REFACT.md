# Refactor Plan (Large JS Files)

## Goals
- Reduce single-file complexity and improve testability/ownership boundaries.
- Centralize repeated cross-cutting concerns (logging, retry/backoff, config normalization, artifact IO, filter selection) so behavior stays consistent.
- Keep refactors mechanical: move code + add thin adapters, preserve behavior, update imports/tests.

## Scope
Files targeted (>= ~500 LOC):
- `src/index/build/watch.js`
- `src/integrations/core/index.js`
- `src/index/validate.js`
- `src/index/build/artifacts.js`
- `tools/build-embeddings/run.js`
- `src/index/build/worker-pool.js`
- `tools/api/router.js`
- `src/index/build/runtime/runtime.js`
- `src/retrieval/output/filters.js`
- `tools/mcp/tools.js`
- `src/index/build/file-processor/cpu.js`
- `src/retrieval/cli.js`
- `src/index/language-registry/registry.js`
- `tools/config-inventory.js`
- `src/retrieval/pipeline.js`
- `tools/build-sqlite-index/run.js`
- `src/shared/json-stream.js`
- `src/map/isometric/client/edges.js`
- `src/index/build/piece-assembly.js`
- `tools/dict-utils/paths.js`

Line ranges below are from the current file versions and should be treated as the extraction anchors.

---

## Phase 0 — Shared modules to extract first (reduces repeated work)

### 0.1 `src/shared/retry.js`
- Extract generic backoff + jitter helper (used by watch lock backoff).
- Source: `src/index/build/watch.js` lines **74–113** (`acquireIndexLockWithBackoff`).
- Tasks:
  - [ ] Create `retryWithBackoff({ maxWaitMs, baseMs, maxMs, onRetry, onLog, shouldStop })`.
  - [ ] Replace inline backoff logic in `watch.js` with shared helper.
  - [ ] Add unit tests in `tests/shared/retry-backoff.test.js`.

### 0.2 `src/shared/scheduler/debounce.js`
- Extract debounced scheduler for reuse.
- Source: `watch.js` lines **133–159** (`createDebouncedScheduler`).
- Tasks:
  - [ ] Move helper into `src/shared/scheduler/debounce.js`.
  - [ ] Update watch import.
  - [ ] Add unit test `tests/shared/debounce-scheduler.test.js`.

### 0.3 `src/shared/fs/ignore.js`
- Centralize ignore matcher logic used by watchers and discover.
- Source: `watch.js` lines **231–247** (`buildIgnoredMatcher`).
- Tasks:
  - [ ] Extract as `buildIgnoredMatcher({ root, ignoreMatcher })`.
  - [ ] Reuse in `discover.js` (if applicable) to avoid drift.
  - [ ] Add tests for directory vs file ignore semantics.

### 0.4 `src/shared/filter/merge.js`
- Centralize merge semantics for CLI vs filter expressions (ext/lang/type/etc).
- Source: `src/retrieval/filters.js` merge helpers **~194–215** (exact function lines logged below in Phase 3).
- Tasks:
  - [ ] Provide `mergeFilterLists({ left, right }) -> { values, impossible }`.
  - [ ] Keep behavior consistent in retrieval CLI + filter code.
  - [ ] Update tests in `tests/lang-filter.js`.

---

## Phase 1 — File-by-file split plan

### 1.1 `src/index/build/watch.js` (849 LOC)
Current top-level functions and ranges:
- `resolveWatcherBackend` **47–73**
- `acquireIndexLockWithBackoff` **74–113**
- `waitForStableFile` **114–132**
- `createDebouncedScheduler` **133–159**
- `normalizeRoot` **160–164**
- `resolveRecordsRoot` **165–173**
- `readRecordSample` **174–191**
- `resolveMaxFilesCap` **192–196**
- `resolveMaxDepthCap` **197–201**
- `isIndexablePath` **202–224**
- `resolveMaxBytesForFile` **225–230**
- `buildIgnoredMatcher` **231–247**
- `watchIndex` **248–899**

Internal blocks inside `watchIndex` that can be lifted (line anchors within watch.js):
- Scheduler + shutdown handling: **317–366** (`stop`, `requestShutdown`, `scheduleBuild`).
- Tracked entries update queue: **368–416** (`applyTrackedUpdates`, `flushPendingUpdates`, `scheduleUpdateFlush`).
- Tracked/skip bookkeeping: **425–462** (`ensureModeMap`, `ensureSkipMap`, `recordSkip`, `clearSkip`, `incrementTracked`, `decrementTracked`, `removeEntryFromModes`).
- Discovery building and file classification: **470–607** (`buildDiscoveryForMode`, `classifyPath`, `updateTrackedEntry`).
- Build execution: **608–699** (`runBuild` and validation block).
- Event handlers: **764–876** (`recordAddOrChange`, `recordRemove`, `recordBurst`, `handleEvent`, `handleError`, watcher wiring).

Refactor tasks:
- [ ] Move watcher backend resolution to `src/index/build/watch/resolve-backend.js` (lines 47–73).
- [ ] Move lock backoff into shared `src/shared/retry.js` and adapt `acquireIndexLockWithBackoff` to call it.
- [ ] Move stability guard to `src/index/build/watch/stability.js` (lines 114–132).
- [ ] Move records path + sampling helpers to `src/index/build/watch/records.js` (165–191).
- [ ] Move guardrails caps and indexable path logic to `src/index/build/watch/guardrails.js` (192–230 + 202–224).
- [ ] Move ignore matcher to shared `src/shared/fs/ignore.js` (231–247).
- [ ] Split `watchIndex` into:
  - `createWatchContext` (inputs, runtime, guardrails, state) — **~258–316**
  - `registerShutdownHandlers` — **~324–360**
  - `createWatchScheduler` (debounce, queue) — **~363–416**
  - `createTrackedIndex` (tracked/skip bookkeeping) — **~425–607**
  - `runWatchBuild` — **~608–699**
  - `wireWatchEvents` — **~764–876**
- [ ] Keep `watchIndex` as orchestration glue; all heavy logic moves to `src/index/build/watch/*.js`.

Tests potentially affected:
- `tests/watch-atomicity.js`, `tests/watch-e2e-promotion.js`, `tests/watch-shutdown.js`
- Any tests importing watch internals (if any) — update paths.

### 1.2 `src/integrations/core/index.js` (823 LOC)
Top-level functions and ranges:
- `createOverallProgress` **37–75**
- `computeCompatibilityKey` **76–89**
- `resolveEmbeddingRuntime` **90–124**
- `teardownRuntime` **125–137**
- `createLineEmitter` **140–158**
- `runEmbeddingsTool` **159–192**
- `buildIndex` **193–789**
- `buildSqliteIndex` **790–816**
- `search` **817–840**
- `status` **841–844**

Refactor tasks:
- [ ] Extract `embeddings` helpers into `src/integrations/core/embeddings.js` (90–192).
- [ ] Extract `buildIndex` into `src/integrations/core/build-index.js` and split into sub-functions:
  - input normalization + runtime init (first ~80 lines of buildIndex)
  - discovery plan + build execution
  - post-build validation/promotion
  - final reporting
- [ ] Extract shared `search` + `status` into `src/integrations/core/search.js` and `status.js`.
- [ ] Keep `src/integrations/core/index.js` as re-export/wiring only.

Tests potentially affected:
- `tests/core-api.js`, `tests/build-index-all.js`, `tests/build-embeddings-cache.js`

### 1.3 `src/index/validate.js` (793 LOC)
Top-level:
- `validateIndexArtifacts` **56–823**

Refactor tasks (split into modules with line anchors):
- [ ] Extract manifest + checksum validation (approx **108–200**) into `src/index/validate/manifest.js`.
- [ ] Extract artifact presence + file loading (approx **200–420**) into `src/index/validate/artifacts.js`.
- [ ] Extract SQLite validation (approx **420–650**) into `src/index/validate/sqlite.js`.
- [ ] Extract LMDB validation (approx **650–780**) into `src/index/validate/lmdb.js`.
- [ ] `validateIndexArtifacts` becomes orchestration (inputs, report aggregation).

Tests potentially affected:
- `tests/index-validate.js`, `tests/storage/sqlite/*.test.js`, `tests/lmdb-*.js`

### 1.4 `src/index/build/artifacts.js` (759 LOC)
Top-level:
- `writeIndexArtifacts` **40–767**

Refactor tasks:
- [ ] Split artifact writer by artifact type into `src/index/build/artifacts/` modules:
  - chunk_meta, repo_map, file_meta, filter_index, postings, vectors, etc.
- [ ] Extract path resolution + atomic write helpers to `src/index/build/artifacts/io.js`.
- [ ] Keep `writeIndexArtifacts` as orchestration (build per-artifact spec list, call writers).

Tests potentially affected:
- `tests/artifact-formats.js`, `tests/artifact-size-guardrails.js`, `tests/format-fidelity.js`

### 1.5 `tools/build-embeddings/run.js` (755 LOC)
Top-level:
- `runBuildEmbeddings` **56–797**

Refactor tasks:
- [ ] Extract CLI parsing + argv normalization into `tools/build-embeddings/args.js`.
- [ ] Extract model + provider resolution into `tools/build-embeddings/runtime.js`.
- [ ] Extract batch processing + output writer into `tools/build-embeddings/runner.js`.
- [ ] Keep `run.js` as thin entrypoint.

Tests potentially affected:
- `tests/build-embeddings-cache.js`, `tests/embeddings-*.js`

### 1.6 `src/index/build/worker-pool.js` (738 LOC)
Top-level:
- `normalizeWorkerPoolConfig` **147–212**
- `resolveWorkerPoolConfig` **213–234**
- `createIndexerWorkerPool` **235–697**
- `createIndexerWorkerPools` **698–757**

Refactor tasks:
- [ ] Extract config normalization into `src/index/build/workers/config.js`.
- [ ] Extract worker lifecycle into `src/index/build/workers/pool.js`.
- [ ] Extract message protocol / error normalization into `src/index/build/workers/protocol.js`.

Tests potentially affected:
- `tests/worker-pool-windows.js`, `tests/worker-pool.js`

### 1.7 `tools/api/router.js` (734 LOC)
Top-level:
- `createApiRouter` **31–756**

Refactor tasks:
- [ ] Extract middleware stack into `tools/api/middleware/*.js`.
- [ ] Extract route registration into `tools/api/routes/*.js`.
- [ ] Create a `tools/api/responses.js` for JSON/error helpers.

Tests potentially affected:
- `tests/services/api/*.test.js`

### 1.8 `src/index/build/runtime/runtime.js` (715 LOC)
Top-level:
- `createBuildRuntime` **54–729**

Refactor tasks:
- [ ] Extract runtime envelope + config into `src/index/build/runtime/config.js`.
- [ ] Extract queue creation into `src/index/build/runtime/queues.js`.
- [ ] Extract policy toggles into `src/index/build/runtime/policy.js`.

Tests potentially affected:
- `tests/runtime/*`, `tests/concurrency/*`

### 1.9 `src/retrieval/output/filters.js` (707 LOC)
Top-level:
- `filterChunks` **21–710**

Refactor tasks:
- [ ] Extract filter index candidate selection into `src/retrieval/output/filter-index.js` (exact match + bitmap selection).
- [ ] Extract meta filters into `src/retrieval/output/meta-filters.js`.
- [ ] Extract file matcher + regex logic into `src/retrieval/output/file-filters.js`.
- [ ] Keep `filterChunks` as orchestration (compose filter predicates).

Tests potentially affected:
- `tests/retrieval/*`, `tests/filters/*`, `tests/lang-filter.js`

### 1.10 `tools/mcp/tools.js` (692 LOC)
Top-level functions and ranges:
- `normalizeMetaFilters` **26–55**
- `maybeRestoreArtifacts` **56–83**
- tool handlers **84–678**
- `handleToolCall` **679–718**

Refactor tasks:
- [ ] Extract per-tool handlers into `tools/mcp/tools/*.js` (buildIndex, runSearch, download models, etc.).
- [ ] Extract meta filter normalization into shared `tools/mcp/filters.js`.
- [ ] Extract tool registry mapping into `tools/mcp/registry.js`.

Tests potentially affected:
- `tests/services/mcp/*.test.js`

### 1.11 `src/index/build/file-processor/cpu.js` (692 LOC)
Top-level:
- `chunkSegmentsWithTreeSitterPasses` **25–114**
- `validateChunkBounds` **115–136**
- `sanitizeChunkBounds` **137–151**
- `processFileCpu` **152–705**

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
- `runSearchCli` **60–734**

Refactor tasks:
- [ ] Extract index loading to `src/retrieval/cli/load-indexes.js`.
- [ ] Extract option normalization to `src/retrieval/cli/options.js` (some already exists).
- [ ] Extract query execution to `src/retrieval/cli/run-search.js`.

Tests potentially affected:
- `tests/search-*`, `tests/retrieval/*`

### 1.13 `src/index/language-registry/registry.js` (687 LOC)
Top-level:
- Registry data **84–540**
- `getLanguageForFile` **632–638**
- `collectLanguageImports` **639–667**
- `buildLanguageContext` **668–678**
- `buildChunkRelations` **679–698**

Refactor tasks:
- [ ] Move registry data into `registry-data.js` and keep runtime helpers in `registry.js`.
- [ ] Extract linguist mapping to `registry-linguist.js`.

Tests potentially affected:
- `tests/lang/*`, `tests/segments/*`

### 1.14 `tools/config-inventory.js` (686 LOC)
Top-level:
- `buildInventory` **441–721**

Refactor tasks:
- [ ] Extract schema parsing helpers into `tools/config-inventory/schema.js`.
- [ ] Extract source scanning into `tools/config-inventory/scan.js`.
- [ ] Extract rendering into `tools/config-inventory/report.js`.

### 1.15 `src/retrieval/pipeline.js` (677 LOC)
Top-level:
- `createSearchPipeline` **22–707**

Refactor tasks:
- [ ] Split pipeline stages into `src/retrieval/pipeline/*` (pre-filter, sparse, ann, re-rank, output).
- [ ] Centralize stage metrics + trace into `src/retrieval/pipeline/metrics.js`.

### 1.16 `tools/build-sqlite-index/run.js` (667 LOC)
Top-level:
- `resolveOutputPaths` **44–76**
- `runBuildSqliteIndex` **77–688**

Refactor tasks:
- [ ] Split CLI parsing to `tools/build-sqlite-index/args.js`.
- [ ] Split execution to `tools/build-sqlite-index/runner.js`.
- [ ] Keep `run.js` as entrypoint.

### 1.17 `src/shared/json-stream.js` (662 LOC)
Top-level helpers and ranges listed in extraction log (see notes above).

Refactor tasks:
- [ ] Move compression helpers (`normalizeGzipOptions`, `createFflateGzipStream`, `createZstdStream`) into `src/shared/json-stream/compress.js`.
- [ ] Move atomic replace into `src/shared/json-stream/atomic.js`.
- [ ] Keep JSONL/array/object writers in `src/shared/json-stream/index.js`.

### 1.18 `src/map/isometric/client/edges.js` (650 LOC)
Top-level:
- `buildEdges` **4–679**

Refactor tasks:
- [ ] Split edge data model vs. rendering vs. layout into `edges/` submodules.

### 1.19 `src/index/build/piece-assembly.js` (647 LOC)
Top-level:
- `assembleIndexPieces` **296–687** plus helpers **19–295**.

Refactor tasks:
- [ ] Extract normalize/validate helpers into `piece-assembly/normalize.js` (19–136).
- [ ] Extract postings merge helpers into `piece-assembly/postings.js` (137–295).
- [ ] Keep `assembleIndexPieces` in `piece-assembly/index.js`.

### 1.20 `tools/dict-utils/paths.js` (644 LOC)
Top-level helpers and ranges already listed (14–685).

Refactor tasks:
- [ ] Split repo identity helpers into `tools/dict-utils/repo.js` (14–106).
- [ ] Split build/index path resolution into `tools/dict-utils/build-paths.js` (107–222).
- [ ] Split runtime/config resolution into `tools/dict-utils/runtime.js` (239–350).
- [ ] Split tooling/metrics paths into `tools/dict-utils/tooling.js` (362–510).
- [ ] Split dictionary path resolution into `tools/dict-utils/dictionaries.js` (598–685).

---

## Phase 2 — Tests and follow‑ups

- [ ] Update imports for any moved modules and keep exports stable.
- [ ] Run `npm run lint` and spot-check `node tests/run.js --match` for affected areas:
  - watch: `tests/watch-*`
  - retrieval: `tests/retrieval/*`, `tests/lang-filter.js`
  - sqlite/build: `tests/storage/sqlite/*`
  - mcp: `tests/services/mcp/*`
- [ ] Add minimal unit tests for extracted helpers (retry/debounce/ignore) to prevent regressions.

---

## Suggested sequencing (keeps risk low)
1. Extract shared helpers (retry/debounce/ignore) and update watch/filters.
2. Split `watch.js` into submodules.
3. Split `integrations/core/index.js` (embedding + build orchestration).
4. Split `validate.js` and `artifacts.js`.
5. Split retrieval `filters` + `cli` + `pipeline`.
6. Split tools scripts (`build-embeddings`, `build-sqlite-index`, `config-inventory`, `mcp/tools`).
7. Split remaining map + registry + CPU processor.

---

## Notes
- Keep exports stable to avoid broad ripples in consumers/tests.
- Avoid behavioral changes while extracting; defer logic changes to separate PRs.
- Validate line ranges before moving to ensure no hidden side effects (especially in watch and runtime).

---

# Appendix A — Mechanical refactor playbook (per file)

Use this template for every extraction so the refactor stays fast and safe:
1) Create new module file(s) in the target folder (empty export stubs).
2) Cut/paste the exact line range into the new file.
3) Add explicit exports in the new file (named exports only, same names).
4) Update old file imports to point at new module(s).
5) Keep the old file’s public exports unchanged (re-export if needed).
6) Run the smallest relevant tests (or unit-targeted test) for that file.
7) Commit per logical chunk (don’t mix refactors across unrelated files).

---

# Appendix B — Exact extraction steps (file-by-file)

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

### Exact moves (line ranges)
- Move **47–73** (`resolveWatcherBackend`) → `watch/resolve-backend.js`
- Move **74–113** (`acquireIndexLockWithBackoff`) → `watch/backoff.js` (or call shared retry helper)
- Move **114–132** (`waitForStableFile`) → `watch/stability.js`
- Move **133–159** (`createDebouncedScheduler`) → `shared/scheduler/debounce.js`
- Move **160–173** (`normalizeRoot`, `resolveRecordsRoot`) → `watch/records.js`
- Move **174–191** (`readRecordSample`) → `watch/records.js`
- Move **192–201** (`resolveMaxFilesCap`, `resolveMaxDepthCap`) → `watch/guardrails.js`
- Move **202–224** (`isIndexablePath`) → `watch/guardrails.js`
- Move **225–230** (`resolveMaxBytesForFile`) → `watch/guardrails.js`
- Move **231–247** (`buildIgnoredMatcher`) → `shared/fs/ignore.js`

### Internal block splits (within `watchIndex`)
- **317–366** → `watch/scheduler.js` (shutdown/schedule)
- **368–416** → `watch/tracked.js` (update queue + flush)
- **425–462** → `watch/tracked.js` (skip/tracked bookkeeping)
- **470–607** → `watch/tracked.js` (discovery + classify + update)
- **608–699** → `watch/runner.js` (run build + validate + promote)
- **764–876** → `watch/events.js` (event handlers + wiring)

### Minimal unit tests to add
- `tests/shared/debounce-scheduler.test.js` (existing behavior)
- `tests/shared/retry-backoff.test.js` (lock backoff)
- `tests/shared/ignore-matcher.test.js` (dir/file ignore rules)

### Existing tests to run after extraction
- `tests/watch-atomicity.js`
- `tests/watch-e2e-promotion.js`
- `tests/watch-shutdown.js`

---

## B.2 `src/integrations/core/index.js`

### New modules
- `src/integrations/core/progress.js` (createOverallProgress)
- `src/integrations/core/compat.js` (computeCompatibilityKey)
- `src/integrations/core/embeddings.js` (resolveEmbeddingRuntime, runEmbeddingsTool, createLineEmitter)
- `src/integrations/core/build-index.js`
- `src/integrations/core/search.js`
- `src/integrations/core/status.js`

### Exact moves
- **37–75** → `progress.js`
- **76–89** → `compat.js`
- **90–192** → `embeddings.js`
- **193–789** → `build-index.js` (split into internal helpers inside this file)
- **790–816** → `build-sqlite-index.js` (optional new file) or keep in `build-index.js`
- **817–840** → `search.js`
- **841–844** → `status.js`

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

---

## B.3 `src/index/validate.js`

### New modules
- `src/index/validate/manifest.js`
- `src/index/validate/artifacts.js`
- `src/index/validate/sqlite.js`
- `src/index/validate/lmdb.js`
- `src/index/validate/report.js` (optional: report build helpers)

### Exact extraction hints (line anchors)
- **108–200**: manifest load + checksum → `manifest.js`
- **200–420**: artifact load + presence → `artifacts.js`
- **420–650**: sqlite validation block → `sqlite.js`
- **650–780**: lmdb validation block → `lmdb.js`

### Tests
- `tests/index-validate.js`
- `tests/storage/sqlite/*`
- `tests/lmdb-*`

---

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
- `writeIndexArtifacts` stays as orchestrator (line **40–767**).

### Tests
- `tests/artifact-formats.js`
- `tests/artifact-size-guardrails.js`
- `tests/format-fidelity.js`

---

## B.5 `tools/build-embeddings/run.js`

### New modules
- `tools/build-embeddings/args.js`
- `tools/build-embeddings/runtime.js`
- `tools/build-embeddings/runner.js`
- `tools/build-embeddings/output.js`

### Extraction
- **56–~200**: args parsing + validation → `args.js`
- **~200–~360**: model/provider resolution → `runtime.js`
- **~360–~650**: batch processing → `runner.js`
- **~650–end**: output/write index state → `output.js`

### Tests
- `tests/build-embeddings-cache.js`
- `tests/embeddings-*`

---

## B.6 `src/index/build/worker-pool.js`

### New modules
- `src/index/build/workers/config.js` (normalize/resolve)
- `src/index/build/workers/protocol.js` (message encode/decode, error summarize)
- `src/index/build/workers/pool.js` (lifecycle / worker spawn)
- `src/index/build/workers/index.js` (re-export)

### Moves
- **12–146** → config/protocol
- **147–234** → config
- **235–697** → pool
- **698–757** → index.js

### Tests
- `tests/worker-pool.js`
- `tests/worker-pool-windows.js`

---

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

---

## B.8 `src/index/build/runtime/runtime.js`

### New modules
- `src/index/build/runtime/config.js`
- `src/index/build/runtime/queues.js`
- `src/index/build/runtime/policy.js`
- `src/index/build/runtime/index.js`

### Tests
- `tests/runtime/*`
- `tests/concurrency/*`

---

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

---

## B.10 `tools/mcp/tools.js`

### New modules
- `tools/mcp/tools/*.js` (one per handler)
- `tools/mcp/registry.js`
- `tools/mcp/filters.js`

### Tests
- `tests/services/mcp/*`

---

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

---

## B.12 `src/retrieval/cli.js`

### New modules
- `src/retrieval/cli/load-indexes.js`
- `src/retrieval/cli/run-search.js`
- `src/retrieval/cli/options.js`

### Tests
- `tests/search-*`
- `tests/retrieval/*`

---

## B.13 `src/index/language-registry/registry.js`

### New modules
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/linguist.js`
- `src/index/language-registry/registry.js` (exports only)

### Tests
- `tests/lang/*`
- `tests/segments/*`

---

## B.14 `tools/config-inventory.js`

### New modules
- `tools/config-inventory/schema.js`
- `tools/config-inventory/scan.js`
- `tools/config-inventory/report.js`

---

## B.15 `src/retrieval/pipeline.js`

### New modules
- `src/retrieval/pipeline/stages/*.js`
- `src/retrieval/pipeline/metrics.js`

---

## B.16 `tools/build-sqlite-index/run.js`

### New modules
- `tools/build-sqlite-index/args.js`
- `tools/build-sqlite-index/runner.js`

---

## B.17 `src/shared/json-stream.js`

### New modules
- `src/shared/json-stream/compress.js`
- `src/shared/json-stream/atomic.js`
- `src/shared/json-stream/index.js`

---

## B.18 `src/map/isometric/client/edges.js`

### New modules
- `src/map/isometric/client/edges/data.js`
- `src/map/isometric/client/edges/layout.js`
- `src/map/isometric/client/edges/render.js`

---

## B.19 `src/index/build/piece-assembly.js`

### New modules
- `src/index/build/piece-assembly/normalize.js`
- `src/index/build/piece-assembly/postings.js`
- `src/index/build/piece-assembly/index.js`

---

## B.20 `tools/dict-utils/paths.js`

### New modules
- `tools/dict-utils/repo.js`
- `tools/dict-utils/build-paths.js`
- `tools/dict-utils/runtime.js`
- `tools/dict-utils/tooling.js`
- `tools/dict-utils/dictionaries.js`

---

# Appendix C — Additional quick wins
- Consolidate CLI arg normalization patterns into a shared helper for tools that parse `process.argv` similarly (build‑embeddings, build‑sqlite, config‑inventory).
- Consolidate “load index state” and “read index root” helpers (used in `retrieval/cli`, `core/index`, `tools/mcp`).
- Centralize JSON output schema for diagnostics in `src/shared/diagnostics.js`.

---

# Appendix D — Minimal tests to add (non‑isometric)

Skip isometric/map tests for now (per request). Add only light‑touch tests that lock behavior during refactor.

## build‑embeddings (`tools/build-embeddings/*`)
- [ ] `tests/build-embeddings/args-parsing.test.js`
  - asserts unknown args are rejected
  - ensures `--model`, `--provider`, `--cache-root` normalize consistently
- [ ] `tests/build-embeddings/runtime-defaults.test.js`
  - validates defaults are set when flags absent

## build‑sqlite‑index (`tools/build-sqlite-index/*`)
- [ ] `tests/build-sqlite-index/args-parsing.test.js`
  - validates `--mode`, `--out`, `--config` parsing
- [ ] `tests/build-sqlite-index/output-paths.test.js`
  - ensures `resolveOutputPaths` produces expected file locations

## config‑inventory (`tools/config-inventory/*`)
- [ ] `tests/config-inventory/schema-scan.test.js`
  - validates schema keys are discovered
- [ ] `tests/config-inventory/report-format.test.js`
  - validates markdown output includes counts + sections

## API router (`tools/api/router.js`)
- [ ] `tests/api/router-smoke.test.js`
  - registers router and asserts critical routes exist
  - verifies JSON error response shape

## MCP tools (`tools/mcp/tools.js`)
- [ ] `tests/mcp/tools-registry.test.js`
  - ensures handler registry includes required tool names
- [ ] `tests/mcp/tools-normalize-meta.test.js`
  - validates meta filter normalization output shape

## shared json‑stream (`src/shared/json-stream.js`)
- [ ] `tests/json-stream/atomic-replace.test.js`
  - validates `replaceFile` behavior via small temp file
- [ ] `tests/json-stream/compress-options.test.js`
  - validates gzip/zstd option normalization

## dict‑utils paths (`tools/dict-utils/paths.js`)
- [ ] `tests/dict-utils/paths-repo-root.test.js`
  - resolves repo root from nested path
- [ ] `tests/dict-utils/paths-builds-root.test.js`
  - validates builds root for config overrides

## retrieval CLI split (`src/retrieval/cli.js` → modules)
- [ ] `tests/retrieval/cli-options-smoke.test.js`
  - parses `--lang`, `--ext`, `--filter` and ensures no throw

## validate split (`src/index/validate.js`)
- [ ] `tests/validate/manifest-checks.test.js`
  - validates checksum failure produces issue text
