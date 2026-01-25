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

1) **Worker pool restart/disable can leave a dead-but-still-allocated pool in memory** (`src/index/build/worker-pool.js`).
   - `scheduleRestart()` and `disablePermanently()` only call `shutdownPool()` when `activeTasks === 0` *at the moment the error is handled*. In the common case (error thrown inside an active task), `activeTasks` is still > 0 when these functions run, so the pool is never destroyed after the task completes.
   - Result: the pool can remain allocated while `disabled === true`, consuming threads/memory, and subsequent calls return `null` (fallback path) without reclaiming resources.
   - Suggested fix: when a restart/permanent-disable is requested while tasks are active, **defer `shutdownPool()` until `activeTasks` reaches 0** (e.g., in the `finally` block of `runTokenize()` and/or in `maybeRestart()` when `disabled` is true). Add a regression test that simulates a worker failure and asserts `pool.destroy()` is called once the task unwinds.

2) **Watch mode can thrash on locks and re-run expensive repo-wide discovery on each rebuild** (`src/index/build/watch.js`).
   - `acquireIndexLock()` is called with default `waitMs=0`. If another index build holds the lock, watch immediately reschedules another build (debounced), potentially producing a tight loop of repeated lock attempts while the lock owner is still running.
   - Each build currently calls `buildIndexForMode({ mode, runtime })` without supplying a discovery subset, so watch rebuilds re-scan the repo each time (even if only a few files changed).
   - Suggested fix: implement an exponential backoff or a minimum retry interval when a lock is busy; also add a “changed paths discovery” mode that feeds only `pendingPaths` (+ necessary dependency neighborhoods) into indexing discovery for incremental updates.

### High / correctness + feature gaps

3) **Piece assembly drops `hash_algo` into a black hole and may force token postings even in non-token/vectors-only scenarios** (`src/index/build/piece-assembly.js`).
   - `file_meta.json` parsing records `entry.hash_algo || entry.hashAlgo` (snake or camel), but chunk fill logic only checks `meta.hashAlgo` (camel) when populating `chunk.fileHashAlgo`. If the writer emits `hash_algo` (snake), assembled chunks can lose `fileHashAlgo`.
   - The assembler unconditionally loads `token_postings.json` via `loadTokenPostings(dir)`. If you later support “vector-only” or “postings-off” indexes, piece assembly will currently fail unless it learns to treat postings artifacts as optional based on `indexState` / stage.
   - Suggested fix: accept both `hashAlgo` and `hash_algo` in the chunk fill path, and make postings artifacts optional when the stage/mode disables them.

4) **Stage defaults may not match intent for “stage3/embeddings”** (`src/index/build/runtime/stage.js`).
   - Stage 3 defaults disable tree-sitter/lint/risk/type inference but do **not** force embeddings on. If a user invokes stage3 with embeddings disabled in config, the run can become a confusing no-op or partial stage.
   - Suggested fix: either (a) force `embeddings.enabled=true` (and mode) in stage3 defaults, or (b) explicitly validate and error when stage3 is requested but embeddings are disabled.

### Medium / operational footguns

5) **`buildIgnoreMatcher()` assumes `userConfig` is always a non-null object and silently swallows ignore-file read errors** (`src/index/build/ignore.js`).
   - If `userConfig` is ever `null/undefined`, property access will throw. Even if that “should never happen”, a defensive default (`userConfig ?? {}`) avoids brittle call sites.
   - The broad `catch {}` around ignore file reads hides permission/IO errors; it is fine to ignore missing files, but other errors should be surfaced (or at least optionally logged) to avoid “why is .gitignore not working?” confusion.

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

### 1) Worker pool: restart/disable lifecycle edge cases
**Files:** `src/index/build/worker-pool.js`, `src/index/build/workers/indexer-worker.js`

**What looks wrong / risky**

- `scheduleRestart()` and `disablePermanently()` only call `shutdownPool()` if `activeTasks === 0` at call time.
  - See `disablePermanently()` (around lines ~327–336) and `scheduleRestart()` (around lines ~338–358).
  - In `runTokenize()`, failures are caught *before* `activeTasks` is decremented in `finally`, so `activeTasks` is usually > 0 when restart/disable is scheduled.
- `maybeRestart()`/`ensurePool()` do not attempt to destroy the pool while waiting for the restart time (`restartAtMs`). When `disabled` is true and `pendingRestart` is true, the pool can sit idle in memory until either (a) a later call arrives after `restartAtMs` or (b) the process exits.

**Impact**

- Memory/threads retained after a worker failure, even though the system has shifted into fallback mode.
- Potentially confusing diagnostics: logs say “disabled (retry in N ms)”, but resources are not reclaimed.

**Suggested improvements**

- When scheduling restart/permanent disable while `activeTasks > 0`, set a flag like `shutdownWhenIdle = true`. In the `finally` path (when `activeTasks` decrements to 0), if `shutdownWhenIdle` is set, call `shutdownPool()` immediately.
- Consider separating “disable usage” from “destroy pool”: destroy-on-disable is usually correct after fatal errors.
- Add targeted tests:
  - Simulate a worker throwing (mock Piscina `run()` to reject) and assert: (1) fallback returns `null`, (2) once the task settles, `pool.destroy()` is called, (3) subsequent calls after `restartAtMs` recreate the pool.

### 2) Watch mode: lock retry thrash and incremental efficiency
**File:** `src/index/build/watch.js`

**What looks wrong / risky**

- If the lock is held, watch immediately schedules another build (debounced). With `debounceMs` small and a long-running index build, this can produce repeated lock attempts for the duration of the build.
- Watch rebuilds do not pass a discovery subset; each rebuild can trigger repo-wide discovery and preprocessing again.

**Impact**

- Unnecessary CPU/IO churn during active indexing (especially on monorepos).
- Reduced perceived responsiveness, since watch spends time re-discovering instead of focusing on the changed file set.

**Suggested improvements**

- Add lock backoff: if lock not acquired, wait `minRetryMs` (and optionally exponential backoff up to `maxRetryMs`) before rescheduling.
- Add a “changed files discovery” path:
  - Maintain `pendingPaths` and feed it into discovery as `discovery.entries` (or a specialized discovery mode) so incremental plans can be computed without crawling the full tree.
  - Include a dependency neighborhood expansion option (imports/adjacent config files) so changes that affect indexing (e.g., tsconfig) still trigger wider rebuilds when needed.
- Add tests:
  - Ensure watch does not call full discovery when `pendingPaths` is non-empty and “changed-only” mode is enabled.
  - Ensure lock contention yields bounded retry frequency.

### 3) Piece assembly: metadata compatibility and optional artifacts
**File:** `src/index/build/piece-assembly.js`

**What looks wrong / risky**

- Mixed snake_case vs camelCase: `hash_algo` is recognized when building `fileInfoByPath`, but chunk fill only reads `meta.hashAlgo` and ignores `meta.hash_algo`.
- The assembler unconditionally requires token postings artifacts; stage-aware optionality is not present.
- Cross-file inference is applied during piece assembly when enabled, but the call does not appear to gate on `mode === "code"`. If other modes are assembled, cross-file inference may run unnecessarily or encounter unexpected chunk shapes.

**Suggested improvements**

- Normalize file_meta fields once (e.g., convert `hash_algo` → `hashAlgo`) and use the normalized form consistently.
- Make artifact loading conditional on stage/features:
  - If stage/postings disabled, treat `token_postings.json` and other postings artifacts as optional, and clearly validate “what must exist” for that mode/stage.
- Explicitly gate cross-file inference to `mode === "code"` and document that behavior in the assembler.

### 4) Ignore config robustness
**File:** `src/index/build/ignore.js`

**Issues / improvements**

- Defensive default: treat `userConfig` as `{}` when absent to avoid brittle call sites.
- Replace blanket `catch {}` with: ignore missing files, but surface other errors (or optionally log them under `--verbose`).
- Ensure the ignore matcher receives POSIX-style relative paths everywhere; if any call sites pass platform separators, ignores may fail silently on Windows.

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
