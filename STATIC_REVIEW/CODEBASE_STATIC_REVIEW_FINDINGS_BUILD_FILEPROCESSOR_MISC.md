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

## Detailed findings

### 1) `src/index/build/file-processor.js` — a few correctness/perf footguns worth tightening

This file is large and generally well-structured; the items below are focused on correctness edge cases and high-cost paths.


## File-by-file smaller notes



## File-by-file notes (coverage)

This section is intentionally short per file; it exists to confirm review coverage and to note any smaller follow-ups.

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
