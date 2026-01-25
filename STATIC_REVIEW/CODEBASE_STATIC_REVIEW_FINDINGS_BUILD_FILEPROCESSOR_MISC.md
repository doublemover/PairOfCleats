# Codebase Static Review Findings — Config Validation / Experimental Structural / Discovery + File Processor

This report is a static review of **only** the following files (relative to repo root):

- `src/config/validate.js`
- `src/experimental/compare/config.js`
- `src/experimental/structural/binaries.js`
- `src/experimental/structural/io.js`
- `src/experimental/structural/parsers.js`
- `src/experimental/structural/registry.js`
- `src/experimental/structural/runner.js`
- `src/index/build/args.js`
- `src/index/build/context-window.js`
- `src/index/build/crash-log.js`
- `src/index/build/discover.js`
- `src/index/build/embedding-batch.js`
- `src/index/build/failure-taxonomy.js`
- `src/index/build/feature-metrics.js`
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/chunk.js`
- `src/index/build/file-processor/incremental.js`
- `src/index/build/file-processor/meta.js`
- `src/index/build/file-processor/read.js`
- `src/index/build/file-processor/relations.js`
- `src/index/build/file-processor/timings.js`
- `src/index/build/file-scan.js`

The goal here is to identify bugs, edge cases, and correctness/performance footguns, with concrete suggestions and test ideas. No code changes are made in this report.

## Executive summary (highest leverage issues)

### Critical / correctness-risk

### High / operational gaps

3) **Discovery uses synchronous `lstat` for every file path in a potentially large list** (`src/index/build/discover.js`).
   - The loop does `await fs.lstat(filePath)` sequentially. This is simple but can become a wall-clock bottleneck on very large repos.
   - Suggested improvement: bounded concurrency for lstat, or leverage directory walker APIs that provide stats.
   - Suggested test/benchmark: large synthetic repo with N files; assert discovery remains under a target time budget (non-CI benchmark, excluded from test suites).

## Detailed findings

### 1) `src/index/build/discover.js` — performance and subtle behavior notes

**What to watch for**

- Git-based discovery is only used when `root` is the repo toplevel. Indexing a subdirectory will fall back to filesystem crawling, which can surprise users who expect `.gitignore` + git tracked filtering semantics.
- The per-file lstat loop is sequential; bounded concurrency could significantly reduce discovery wall time on large repos.

### 2) `src/index/build/file-processor.js` — a few correctness/perf footguns worth tightening

This file is large and generally well-structured; the items below are focused on correctness edge cases and high-cost paths.

- Comment extraction + assignment depend on consistent comment ordering (see `assignCommentsToChunks()` issue). If multiple comment sources are merged, ensure they are globally sorted by offset before assignment.
- If the worker pool is disabled or returns `null`, tokenization falls back to main thread, which is correct — but it may be worth emitting a structured warning once per run so operators notice the throughput regression.
- `extractComments()` + comment tokenization happen even if comments are later excluded from token text. If performance becomes an issue, consider a fast-path to skip per-comment tokenization when comment fields are disabled (or when minTokens thresholds will exclude them anyway).

### 3) `src/index/build/file-scan.js` — binary detection semantics

- The scanner still performs binary heuristics even when `wantsBinary` is false (because a sample buffer is loaded for other checks). This may be intended, but it makes `sampleMinBytes` feel less like a gate and more like a tuning knob.
- If `sampleMinBytes` is meant as a “don’t even try” threshold, consider short-circuiting detection when size < sampleMinBytes (except for obvious magic-number detection via `file-type`).

## File-by-file smaller notes

- `src/experimental/structural/runner.js`: good use of JSON modes; consider capturing stderr output snippets for diagnostics when a tool fails (helps triage why results are empty).
- `src/index/build/context-window.js`: uses `chunk.text.slice(...).split("
")` repeatedly; this is correct but allocates heavily. If this ever becomes hot, a newline-count scan can reduce allocations.
- `src/index/build/failure-taxonomy.js`: the categorizer is heuristic; ensure tests cover common failure message patterns so classification doesn’t regress.


## File-by-file notes (coverage)

This section is intentionally short per file; it exists to confirm review coverage and to note any smaller follow-ups.

### `src/experimental/compare/config.js`
- Looks correct for its purpose (load/merge config + compute hashes). If you expand compare tooling, consider writing fixtures that include nested objects, arrays, and absent keys to ensure hash behavior is stable.

### `src/index/build/args.js`
- Straightforward CLI parsing and mode normalization. Consider a test for the `mode=both` alias and for invalid modes raising a validation error (via `validateBuildArgs`).

### `src/index/build/crash-log.js`
- The crash logger is practical and likely very useful operationally.
- Consider a targeted test that writes a failure event and asserts the crash state file contains `{ phase, lastFile, lastError }` and that log files are created even when the directory didn’t exist.

### `src/index/build/embedding-batch.js`
- Batch helpers look coherent. If embedding providers change behavior across versions, consider a test ensuring the batch splitter produces stable batch sizes (especially when `maxBatchSize` is derived from model/provider).

### `src/index/build/failure-taxonomy.js`
- Classification is heuristic by nature. If you rely on these categories for alerting/telemetry, add a snapshot test suite with a set of representative errors so categories don’t drift silently.

### `src/index/build/feature-metrics.js`
- Metric accounting looks consistent and uses share-of-lines to apportion duration/bytes across languages.
- Minor note: `mergeFeatureMetrics()` clones via `JSON.parse(JSON.stringify(...))` (same caveat as elsewhere: this drops non-JSON values). Metrics objects should stay JSON-safe, so this is fine.

### `src/index/build/file-processor/incremental.js`
- Incremental reuse decisions are clear (prefer stable `fileHash`, else fall back to size+mtime).
- Consider tests that cover: (1) hash matches, (2) hash missing but mtime/size match, (3) file content changed but same size, (4) deleted files in bundles.

### `src/index/build/file-processor/meta.js`
- External docs linking for `node_modules` is helpful. Consider tests for scoped packages and Windows path handling.

### `src/index/build/file-processor/read.js`
- UTF-8 truncation logic is careful and avoids splitting multibyte sequences.
- If you have very large UTF-8 codepoints near chunk boundaries, add a regression test to ensure truncated reads do not produce replacement characters.

### `src/index/build/file-processor/relations.js`
- Relation extraction normalization is good (dedupe, sort, avoid self-import).
- If you later add cross-file callsite/args extraction universally, this module will be a key integration point for per-file relation bundles; consider adding schema checks for relation payloads.

### `src/index/build/file-processor/timings.js`
- Clamping and finalization look solid.
- If you display timings in UI/CLI, consider emitting a “total parse time vs total tokenize time” summary per mode to make bottlenecks obvious.
