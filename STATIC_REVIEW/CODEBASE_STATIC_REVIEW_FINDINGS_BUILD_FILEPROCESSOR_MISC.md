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

1) **Schema validation can silently skip required/additionalProperties checks when `properties` is absent** (`src/config/validate.js`).
   - Object validation is currently gated behind `schema.type === "object" && schema.properties`.
   - If a schema uses `required` and/or `additionalProperties` but omits `properties`, the validator will not enforce those constraints.
   - Suggested fix: perform `required` + `additionalProperties` checks whenever `schema.type === "object"`, regardless of whether `properties` is present.
   - Suggested tests: fixtures where `properties` is omitted but `required` is present; fixtures where only `additionalProperties` is defined (both boolean and schema).

2) **Comment-to-chunk assignment assumes comments are pre-sorted** (`src/index/build/file-processor/chunk.js`).
   - `assignCommentsToChunks()` uses a forward-only `chunkIdx` pointer; if comments are not strictly increasing by `comment.start`, later smaller `start` values can be assigned to the wrong chunk.
   - Because comment ranges influence stripping and comment token fields, misassignment can distort chunk text and retrieval signals.
   - Suggested fix: either sort `comments` by `start` inside the function, or document/validate that the input list is sorted (and enforce upstream).
   - Suggested tests: intentionally shuffled comment ranges; verify assignment correctness and that stripping behaves deterministically.

### High / operational gaps

3) **Windows `.ps1` structural tools are “detected” but not runnable** (`src/experimental/structural/binaries.js`).
   - `findOnPath()` searches for `${candidate}.ps1`, but `runCommand()` only enables `shell: true` for `.cmd`/`.bat` and otherwise executes the file directly.
   - Executing a PowerShell script typically requires invoking `powershell.exe -File <script.ps1>` (or `pwsh`).
   - Suggested fix: treat `.ps1` as a special case that wraps in `powershell`/`pwsh` as the command with an args prefix.

4) **Discovery uses synchronous `lstat` for every file path in a potentially large list** (`src/index/build/discover.js`).
   - The loop does `await fs.lstat(filePath)` sequentially. This is simple but can become a wall-clock bottleneck on very large repos.
   - Suggested improvement: bounded concurrency for lstat, or leverage directory walker APIs that provide stats.
   - Suggested test/benchmark: large synthetic repo with N files; assert discovery remains under a target time budget (non-CI benchmark, excluded from test suites).

## Detailed findings

### 1) `src/config/validate.js` — object schema enforcement gaps

**What looks wrong**

- Object validation currently runs only when `schema.properties` is present.
- As written, schemas of the form `{ type: "object", required: [...], additionalProperties: false }` will not enforce either `required` or `additionalProperties`.

**Impact**

- Misconfigured configs can slip through validation and fail later in runtime in less obvious ways.
- This is a likely source of “config drift” bugs (schema/docs say something is required but the validator does not actually enforce it).

**Suggested improvements**

- Run `required` checks whenever `schema.required` is defined, not only when `properties` exists.
- Apply `additionalProperties` checks whenever `schema.additionalProperties` is defined (and `type === "object"`).
- Consider adding minimal support for `oneOf`/`anyOf` if the schema relies on them, but this is optional if the current schema is intentionally limited.

### 2) `src/index/build/file-processor/chunk.js` — comment assignment ordering assumption

**What looks wrong**

- `assignCommentsToChunks()` uses a monotonic `chunkIdx` pointer and does not sort inputs.
- If upstream comment extraction ever returns comments out of order (or if different comment sources are merged), the assignment can become incorrect.

**Impact**

- Incorrect comment tokens per chunk (affects comment field retrieval).
- Incorrect stripping behavior when comments are excluded from code text (could leave comment text in the chunk, or strip the wrong region).

**Suggested improvements**

- Sort `comments` by `start` inside the function (cheap relative to other work).
- Alternatively, assert monotonicity in debug builds and fix upstream ordering guarantees.

### 3) `src/experimental/structural/binaries.js` — `.ps1` invocation and existence checks

**What looks wrong**

- `.ps1` scripts are discovered but executed directly (will usually fail).
- `fsExists()` returns the result of `fs.statSync()` (a `Stats` object) rather than a strict boolean; directories will be treated as “exists” too.

**Suggested improvements**

- If a candidate ends in `.ps1`, return `{ command: "powershell", argsPrefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", <script>] }` (or `pwsh` if available).
- Replace `fsExists()` with a boolean existence check and (optionally) a file-type check.

### 4) `src/index/build/discover.js` — performance and subtle behavior notes

**What to watch for**

- Git-based discovery is only used when `root` is the repo toplevel. Indexing a subdirectory will fall back to filesystem crawling, which can surprise users who expect `.gitignore` + git tracked filtering semantics.
- The per-file lstat loop is sequential; bounded concurrency could significantly reduce discovery wall time on large repos.

### 5) `src/index/build/file-processor.js` — a few correctness/perf footguns worth tightening

This file is large and generally well-structured; the items below are focused on correctness edge cases and high-cost paths.

- Comment extraction + assignment depend on consistent comment ordering (see `assignCommentsToChunks()` issue). If multiple comment sources are merged, ensure they are globally sorted by offset before assignment.
- If the worker pool is disabled or returns `null`, tokenization falls back to main thread, which is correct — but it may be worth emitting a structured warning once per run so operators notice the throughput regression.
- `extractComments()` + comment tokenization happen even if comments are later excluded from token text. If performance becomes an issue, consider a fast-path to skip per-comment tokenization when comment fields are disabled (or when minTokens thresholds will exclude them anyway).

### 6) `src/index/build/file-scan.js` — binary detection semantics

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
