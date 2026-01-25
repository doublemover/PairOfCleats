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

3) **Incremental/tokenization cache keys are vulnerable to nondeterminism and collisions**
- **Where:** `src/index/build/indexer/signatures.js`.
- **Evidence:**
  - Uses `sha1(JSON.stringify(payload))` for both tokenization and incremental signatures (lines ~7–23 and ~25–78).
  - Only includes `.source` for `licensePattern`/`generatedPattern`/`linterPattern` but not `.flags` (lines ~15–20).
- **Impact:**
  - **Regex flags collision** (e.g., `/foo/i` vs `/foo/g` hash the same) can incorrectly reuse cached artifacts.
  - JSON property order is typically stable for simple objects but is not a hard invariant across all object construction paths; for config objects assembled dynamically (or coming from different loaders), you can end up with avoidable cache misses (or—worse—wrong reuse if keys are dropped/normalized inconsistently elsewhere).

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

#### E1) Dictionary loading reads entire wordlists into memory
- **File:** `src/index/build/runtime/runtime.js`.
- **Details:** Wordlists are read completely and split into a `Set` (lines ~303–333).
- **Impact:** Large wordlists can become a major startup cost and memory footprint.
- **Suggested improvement:** Consider streaming parsing and/or on-demand dictionary usage, especially if you later move towards end-to-end streaming indexing.

#### E2) Piece assembly is inherently memory-heavy
- **File:** `src/index/build/piece-assembly.js`.
- **Details:** It loads all chunk metadata, token postings, and doc lengths into memory and then remaps postings based on a global ordering.
- **Impact:** For large repos, this step can become a practical OOM risk.
- **Suggested improvement:** If piece assembly remains a first-class operation, consider external sort / streaming remap strategies.

## Per-file quick notes

### `src/index/build/indexer/pipeline.js`
- **Potential drift:** early return on incremental reuse (`reused`) does not advance overall progress stages; if overall progress UI assumes each stage calls `advance`, you can end up with confusing progress output.

### `src/index/build/runtime/hash.js`
- **Hash stability risk:** `normalizeContentConfig()` uses `JSON.parse(JSON.stringify(config))` (line ~6). This will collapse/lose non-JSON values (e.g., `RegExp`, `undefined`, functions) and can create config-hash collisions.

### `src/index/build/indexer/embedding-queue.js`
- **Runtime compatibility:** uses `crypto.randomUUID()` (line ~15). Ensure Node version policy matches this requirement.

