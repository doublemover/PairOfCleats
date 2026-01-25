# Codebase Static Review Findings — Build Runtime / Indexer Orchestration / Watch / Worker Pool

This report is a static review of **only** the following files (relative to repo root):

- `src/index/build/ignore.js`
- `src/index/build/indexer.js`
- `src/index/build/indexer/embedding-queue.js`
- `src/index/build/indexer/pipeline.js`
- `src/index/build/indexer/signatures.js`
- `src/index/build/indexer/steps/discover.js`
- `src/index/build/lock.js`
- `src/index/build/perf-profile.js`
- `src/index/build/piece-assembly.js`
- `src/index/build/preprocess.js`
- `src/index/build/promotion.js`
- `src/index/build/records.js`
- `src/index/build/runtime.js`
- `src/index/build/runtime/caps.js`
- `src/index/build/runtime/embeddings.js`
- `src/index/build/runtime/hash.js`
- `src/index/build/runtime/logging.js`
- `src/index/build/runtime/runtime.js`
- `src/index/build/runtime/stage.js`
- `src/index/build/runtime/tree-sitter.js`
- `src/index/build/runtime/workers.js`
- `src/index/build/watch.js`
- `src/index/build/watch/backends/chokidar.js`
- `src/index/build/watch/backends/parcel.js`
- `src/index/build/watch/backends/types.js`
- `src/index/build/worker-pool.js`
- `src/index/build/workers/indexer-worker.js`

The goal here is **correctness and operational robustness**: identify bugs, footguns, drift, and missing invariants/tests. No code changes are made in this report; each item includes suggested fixes or implementation improvements.

## Executive summary (highest leverage issues)

### Critical / correctness-risk

### High / correctness + feature gaps

### Medium / operational footguns

## Detailed findings (with concrete suggestions)

## File-by-file notes

This section lists additional smaller observations per file to aid future cleanup and test planning.

### `src/index/build/indexer/pipeline.js`

### `src/index/build/indexer/signatures.js`

### `src/index/build/indexer/steps/discover.js`

### `src/index/build/lock.js`

### `src/index/build/preprocess.js`

### `src/index/build/runtime/caps.js`
- “Untrusted mode” caps can be disabled by setting numeric values to 0, because `normalizeLimit(0) -> null`. If untrusted mode is meant to always enforce safety caps, consider disallowing “disable via 0” there.

### `src/index/build/runtime/hash.js`
- Hash normalization uses `JSON.parse(JSON.stringify(...))`; if any config values are non-JSON (e.g., RegExp objects), they will be dropped, potentially weakening cache keys.

### `src/index/build/runtime/logging.js`
- Logger configuration is enabled only when `format !== "text"`. Confirm whether ring-buffer capture or structured logging is desired in text mode as well.

### `src/index/build/watch/backends/parcel.js`
- Parcel ignore callbacks may not receive `fs.Stats`; the ignore function currently supports missing stats, but directory-specific checks become less precise. Confirm behavior with upstream watcher APIs.

### `src/index/build/workers/indexer-worker.js`
- `validateCloneable()` runs on inputs/outputs for every task; verify the overhead is acceptable for very high throughput tokenization. Consider gating to debug mode if needed.
