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

## Detailed findings

### A) Crash and correctness bugs

### B) Cache signatures, incremental invariants, and reproducibility

### C) Robustness, path safety, and operator expectations

### D) Worker pool resilience and failure modes

### E) Performance and scalability concerns (not necessarily “bugs”, but likely to surface as failures)

## Per-file quick notes

### `src/index/build/indexer/pipeline.js`

### `src/index/build/runtime/hash.js`

### `src/index/build/indexer/embedding-queue.js`
- **Runtime compatibility:** uses `crypto.randomUUID()` (line ~15). Ensure Node version policy matches this requirement.
