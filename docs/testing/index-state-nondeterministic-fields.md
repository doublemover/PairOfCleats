# Index State Non-Deterministic Fields

This document records `index_state.json` fields that can differ between builds of the same
content (or between shard and non-shard runs). These fields should be ignored for deterministic
comparisons (for example, shard-merge tests) unless a test is explicitly validating them.

Each item below references the code paths that set the field so it is clear why the value is
not stable across runs.

## Time-derived fields (always non-deterministic)
- `generatedAt` (top-level). Written with `new Date().toISOString()` in:
  - `src/index/build/indexer/steps/write.js` (build index artifacts)
  - `src/index/build/piece-assembly.js` (assemble pieces)
- `updatedAt` (top-level). Written with `new Date().toISOString()` in:
  - `tools/build-embeddings/runner.js`
  - `tools/build-sqlite-index/index-state.js`
  - `tools/build-lmdb-index.js`
- `embeddings.updatedAt` (set per embeddings run in `tools/build-embeddings/runner.js`)
- `sqlite.updatedAt` (set in `tools/build-sqlite-index/index-state.js`)
- `lmdb.updatedAt` (set in `tools/build-lmdb-index.js`)

## Build/run identity and stage fields (run invocation dependent)
- `buildId` (timestamp + git short SHA + config hash). Computed in:
  - `src/index/build/runtime/runtime.js` (`formatBuildTimestamp(new Date())`)
- `stage` (stage1/stage2/stage3/stage4) and `enrichment.pending` / `enrichment.stage`:
  - Set in `src/index/build/indexer/steps/write.js`
  - Updated in `tools/build-embeddings/runner.js` (clears pending, sets stage)
- `assembled` (true for assembled piece sets) set in:
  - `src/index/build/piece-assembly.js`

## Environment and path dependent fields (machine/cache dependent)
- `repoId` (hash of absolute repo path) from:
  - `tools/dict-utils/paths/repo.js` (`getRepoId`)
- `sqlite.path` (absolute db path) set in:
  - `tools/build-sqlite-index/runner.js` -> `tools/build-sqlite-index/index-state.js`
- `lmdb.path` (absolute db path) set in:
  - `tools/build-lmdb-index.js`

## Runtime status, availability, and error fields (run outcome dependent)
- `embeddings.enabled`, `embeddings.ready`, `embeddings.pending`, `embeddings.service`:
  - Written in `src/index/build/indexer/steps/write.js` (initial build)
  - Updated in `tools/build-embeddings/runner.js` (stage3)
- `embeddings.lastError` (only set on failure in `tools/build-embeddings/runner.js`)
- `embeddings.backends.*` (availability, target, dims, counts):
  - Computed from filesystem + optional deps in `tools/build-embeddings/runner.js`
  - These vary if HNSW/LanceDB/sqlite-vec backends are missing or disabled.
- `sqlite.status`, `sqlite.error`, `sqlite.note`, `sqlite.elapsedMs`, `sqlite.bytes`,
  `sqlite.inputBytes`, `sqlite.threadLimits`:
  - Written via `tools/build-sqlite-index/runner.js` -> `tools/build-sqlite-index/index-state.js`
  - `threadLimits` depends on runtime envelope (CPU count and concurrency settings).
- `lmdb.pending`, `lmdb.ready`, `lmdb.buildMode`, `lmdb.mapSizeBytes`,
  `lmdb.mapSizeEstimatedBytes`:
  - Written in `tools/build-lmdb-index.js`
  - Map sizing is derived from a runtime estimate and may vary with library/version changes.

## Shard plan timing fields (performance dependent)
- `shards.plan[*].costMs` (and any plan fields derived from the perf profile):
  - Cost estimates come from `src/index/build/perf-profile.js` and
    `src/index/build/shards.js`, which use prior run timings.
  - If the perf profile changes or is regenerated, shard cost estimates can change.

## Guidance for tests
When comparing `index_state.json` between builds that should be content-equivalent:
1) Normalize or drop the fields listed above.
2) Compare the remaining payload for equality.

For exact build provenance tests, **do not** normalize these fields.
