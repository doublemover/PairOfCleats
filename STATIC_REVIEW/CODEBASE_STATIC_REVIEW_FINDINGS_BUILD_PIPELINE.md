# Static Review Findings — Build/Indexer Pipeline Sweep

## Scope
This sweep reviewed **only** the following files from the provided zip:

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

## Executive summary
This portion of the codebase is generally well-structured (clear runtime normalization, explicit stage controls, and a coherent indexing pipeline), but there are a handful of **high-impact correctness and “drift” issues** that will cause surprising behavior at scale.

### Highest-impact issues

4) **`waitForStableFile()` is not a true stability check**
- **Where:** `src/index/build/watch.js`.
- **Evidence:**
  - Function returns `true` even if the file never stabilizes across the requested checks (lines ~59–76). It only returns `false` when `fs.stat()` fails.
- **Impact:**
  - On fast rebuild loops, this can index partially-written files (or files being written in multiple bursts) while giving the appearance that a stability guard is active.

5) **`current.json` promotion logic can point outside the intended repo cache root**
- **Where:** `src/index/build/promotion.js`.
- **Evidence:**
  - `relativeRoot = path.relative(repoCacheRoot, buildRoot)` (line ~24). If `buildRoot` is not under `repoCacheRoot`, this will contain `..` segments.
  - `normalizeRelativeRoot()` also accepts absolute paths and joins relative paths without any explicit “must be within repo cache root” enforcement.
- **Impact:**
  - Index selection can become surprising (or dangerous) if a misconfigured buildRoot or a malformed `current.json` points to unintended directories.
  - Even if this is “only local”, it’s a correctness and operator-safety issue, especially when multiple repos/build roots exist.

## Detailed findings

### A) Crash and correctness bugs

#### A3) `waitForStableFile()` does not detect sustained instability
- **File:** `src/index/build/watch.js` (lines ~59–76)
- **Details:** If the file changes on every poll, the loop completes and returns `true` anyway.
- **Why this is wrong:** The function name and the call site (`if (!stable) return;`) imply “do not proceed until stable.” The current behavior is “delay a bit and then proceed regardless.”
- **Suggested fix:** Return `false` when stability is not observed within `checks` polls (or rename to reflect “best-effort delay” semantics).
- **Suggested test:** Create a file that is rewritten multiple times across the guard window; assert that indexing does not proceed until stable (or assert the renamed semantics).

#### A4) Promotion can allow `current.json` to reference unintended paths
- **File:** `src/index/build/promotion.js`.
- **Details:** `relativeRoot` may contain `..` segments when buildRoot is outside repoCacheRoot. There’s no explicit validation that the resolved root is within the cache root.
- **Why this is wrong:** Build promotion should be a strict mapping to known build roots under the cache directory, not an arbitrary filesystem pointer.
- **Suggested fix:**
  - Enforce: `buildRoot` must be within `repoCacheRoot` (or within `repoCacheRoot/builds`).
  - Validate that normalized resolved roots do not start with `..` after `path.relative`.
- **Suggested test:** Force a buildRoot outside repoCacheRoot and assert promotion rejects with a clear message.

### B) Cache signatures, incremental invariants, and reproducibility

### C) Robustness, path safety, and operator expectations

### D) Worker pool resilience and failure modes

### E) Performance and scalability concerns (not necessarily “bugs”, but likely to surface as failures)

## Per-file quick notes

### `src/index/build/indexer/pipeline.js`

### `src/index/build/runtime/hash.js`

### `src/index/build/indexer/embedding-queue.js`
- **Runtime compatibility:** uses `crypto.randomUUID()` (line ~15). Ensure Node version policy matches this requirement.
