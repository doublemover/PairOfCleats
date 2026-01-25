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

6) **Promotion metadata can encode build roots outside the cache root if a non-contained path is written** (`src/index/build/promotion.js`).
   - `relativeRoot = path.relative(repoCacheRoot, buildRoot)` can start with `..` when `buildRoot` is outside `repoCacheRoot`. Loading that later can walk outside the cache root.
   - Suggested fix: validate that `buildRoot` resolves under `repoCacheRoot` before persisting; treat violations as errors.

7) **Tree-sitter runtime config has a surprising invalid-value fallback for `deferMissingMax`** (`src/index/build/runtime/tree-sitter.js`).
   - If the config explicitly sets `deferMissingMax` but it is invalid/non-numeric, the code uses `normalizeOptionalLimit(...) ?? 0`, which forces it to `0` (rather than a safe default like `DEFAULT_DEFER_MISSING_MAX`).
   - Suggested fix: on invalid numeric overrides, fall back to the default constant, not zero.

8) **Embedding queue enqueue path is not clearly “best-effort”** (`src/index/build/indexer/embedding-queue.js`).
   - `ensureQueueDir()` / `enqueueJob()` errors bubble up and can fail indexing. If the embedding service is optional, enqueue should be “best effort” with clear logging and a non-fatal failure mode.
   - The job payload does not include the promoted build root or explicit artifact paths; if multiple indexes exist per repo/mode, the embedding worker may need more identifiers to find the correct target.

## Detailed findings (with concrete suggestions)

### 5) Stage overrides clarity
**File:** `src/index/build/runtime/stage.js`

- Consider validating stage invariants explicitly:
  - Stage1/Stage2 should never attempt embeddings.
  - Stage3 should require embeddings artifacts input and/or enabled embeddings mode.
  - Stage4 should require embeddings to already exist (even if embeddings computation is disabled).

### 6) Promotion safety
**File:** `src/index/build/promotion.js`

- Validate that build roots recorded in `current.json` resolve within `repoCacheRoot` to avoid “../” traversal risks.
- Consider adding a checksum/identifier alongside the path (e.g., buildId) to detect stale pointers.

### 7) Tree-sitter config fallback behavior
**File:** `src/index/build/runtime/tree-sitter.js`

- Avoid turning invalid `deferMissingMax` into `0` if the property is present but invalid; default to `DEFAULT_DEFER_MISSING_MAX` instead.
- Add a config validation test covering invalid numeric overrides.

### 8) Embedding enqueue is not clearly best-effort
**File:** `src/index/build/indexer/embedding-queue.js`

- If the embedding queue/service is optional, enqueue failures should be non-fatal by default (with a clear warning).
- Include a more explicit “index identity” in queued jobs (buildId + mode + output dir) so the embedding worker can unambiguously locate the right artifacts.
- Add tests: queue full behavior, enqueue error handling, and payload completeness.

## File-by-file notes

This section lists additional smaller observations per file to aid future cleanup and test planning.

### `src/index/build/indexer/pipeline.js`
- Stage progress advancement advances the *previous* stage when entering the next stage; verify this matches desired UX and does not double-advance in edge cases.
- Index reuse path exits early; ensure any “late” artifacts (e.g., embedding queue jobs, metrics emission) are not required for correctness when reuse occurs.

### `src/index/build/indexer/signatures.js`
- Incremental signature includes many runtime toggles; verify embedding service identity/config (endpoint/model) is included if it can vary between runs.

### `src/index/build/indexer/steps/discover.js`
- When reusing `discovery.entries`, the code mutates entries by assigning `orderIndex`. If the same entry objects are reused across modes, ensure this cannot cause subtle cross-mode coupling.

### `src/index/build/lock.js`
- Stale lock handling is reasonable; consider logging when stale locks are detected/removed to aid operational debugging.

### `src/index/build/preprocess.js`
- Contains an unused `normalizeLimit()` helper (dead code). Removing reduces drift and lint noise.
- Preprocess collects per-language line counts but does not yet emit a language-grouped ordering plan (needed for WASM grouping / streaming passes).

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
