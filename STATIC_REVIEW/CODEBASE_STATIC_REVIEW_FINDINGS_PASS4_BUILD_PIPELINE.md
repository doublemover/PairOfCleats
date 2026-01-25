# Codebase Static Review Findings — Pass 4A (Index Build Pipeline)

Scope: This pass statically reviews **only** the following files:

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

This is a static analysis only (no code execution). The goal is to identify likely bugs, correctness gaps, configuration pitfalls, and performance hazards; and to provide concrete, testable suggestions.

---

## Executive summary

The build pipeline is generally well-structured (clear staging, good separation of discovery/process/write, sensible guardrails, and strong ergonomics around optional features). The main correctness risks in this set of files cluster around:

1. **Watch-mode shutdown ordering**: early SIGINT/SIGTERM can throw (or hang) due to `scheduler` / `resolveExit` lifecycle ordering.
2. **Piece assembly correctness + scalability**: current assembly path assumes monolithic JSON artifacts and full in-memory merges; it is likely to fail (or become prohibitively slow) as soon as artifacts are sharded and/or very large.
3. **Incremental signature coverage gaps**: some runtime toggles that materially change output are not captured in the incremental signature.
4. **Untrusted guardrails can be disabled unintentionally**: `0` / `false` yields “no limit”, which undermines the purpose of `untrusted.enabled`.
5. **Embedding runtime identity drift**: service mode can still mark identity as `stub:true` via env/argv override, creating mismatched cache/manifest expectations.

---

## Findings

### 1) Watch mode can crash or hang on early shutdown signals

**Severity:** High

**Where:** `src/index/build/watch.js`

**What’s wrong:** The SIGINT/SIGTERM handler calls `scheduler.cancel()` and `stop()` before `scheduler` and `resolveExit` are guaranteed to be initialized. If a signal fires early (e.g., during initial scan / before watcher fully starts), `scheduler` is still `undefined` and `resolveExit` is still `null`.

**Evidence:**

- `scheduler.cancel()` is invoked unguarded:
  - `src/index/build/watch.js` lines ~310–317:
    - `scheduler.cancel();` and `stop();` are called in `requestShutdown()`.
- `resolveExit` is only assigned later:
  - `src/index/build/watch.js` lines ~438–446:
    - `await new Promise((resolve) => { resolveExit = resolve; });`

**Why this matters:**

- Best case: watch mode throws on shutdown (`TypeError: Cannot read properties of undefined (reading 'cancel')`).
- Worse case: it does **not** crash, but it **hangs** because `stop()` cannot resolve the exit promise before `resolveExit` is assigned.

**Suggestions (no code changes provided):**

- Initialize `resolveExit` **before** registering signal handlers.
- Guard `scheduler` access: `scheduler?.cancel?.()`.
- If `shouldExit` is set before the exit promise exists, resolve immediately after `resolveExit` assignment (or structure the loop so `await exitPromise` happens before installing watchers).

**Test ideas:**

- A unit/integration test that starts watch mode and immediately sends SIGINT (or simulates `requestShutdown()` before watcher init). Assert the process exits and does not hang.

---

### 2) Parcel watcher ignore function likely mishandles directories

**Severity:** Medium

**Where:** `src/index/build/watch/backends/parcel.js` + `src/index/build/watch.js`

**What’s wrong:** The ignore matcher is constructed with a `(targetPath, stats)` signature (chokidar-style). Parcel watcher’s ignore callback does not provide `stats`, which means directory ignores are evaluated as if the path were a file (no `dir/` normalization).

**Evidence:**

- `buildIgnoredMatcher()` expects optional `stats` to detect directories and apply a trailing-slash normalization:
  - `src/index/build/watch.js` lines ~57–64.
- Parcel subscribe passes the ignore function but cannot supply stats:
  - `src/index/build/watch/backends/parcel.js` lines ~42–48.

**Why this matters:**

- Directory ignore patterns (e.g., `node_modules/`, `.git/`) may fail to match as intended in parcel mode, causing unnecessary event churn.

**Suggestions:**

- Provide a parcel-specific ignore function that:
  - treats paths ending with a separator as directories, or
  - performs a cheap cached `stat` for directories (only when needed), or
  - normalizes known directory patterns without requiring stats.

**Test ideas:**

- Run watch with parcel backend, create files under an ignored directory, and assert no `recordAddOrChange()` calls are triggered.

---

### 3) Piece assembly does not support sharded artifacts and will not scale

**Severity:** High

**Where:** `src/index/build/piece-assembly.js`

**What’s wrong:** Piece assembly reads a number of artifacts as single JSON blobs (`chunk_meta.json`, `token_postings.json`, `dense_vectors*.json`, etc.) and merges them fully in memory.

This is incompatible with (a) any future sharding strategy, and (b) large repos where these blobs become too large to load or merge.

**Evidence:**

- Reads monolithic JSON files via `readJsonOptional()`:
  - `chunk_meta.json`, `doc_lengths.json`, `token_postings.json`, `dense_vectors*.json`, etc.
- `readJsonOptional()` explicitly errors on `ERR_JSON_TOO_LARGE`:
  - `src/index/build/piece-assembly.js` lines ~21–30.

**Why this matters:**

- Assembly will fail outright once artifacts are sharded.
- Even before failing, assembly is likely to be memory-bound and slow (merging posting lists, sorting vocab, and remapping doc IDs in JS arrays).

**Suggestions:**

- Support **sharded + streaming** assembly for at least:
  - `chunk_meta` (JSONL shards)
  - `token_postings` (sharded postings + per-shard vocab ranges)
  - dense vectors (sharded vectors by docId range)
  - `file_relations` / `graph_relations` (JSONL)
- Enforce a strict assembly invariant:
  - “Each input piece must declare its shard bounds (docId start/end, vocab range, vector block range)”
  - assembly can then merge by concatenating shards + applying offset mapping without holding all postings in memory.

**Test ideas:**

- Fixture with 2–3 synthetic pieces where `token_postings` is sharded; assert assembly emits a correct merged manifest and correct docId remapping.

---

### 4) Piece assembly may emit inconsistent field doc-length arrays when pieces disagree on fields

**Severity:** High

**Where:** `src/index/build/piece-assembly.js`

**What’s wrong:** Field postings and field doc-lengths are merged opportunistically by taking the union of field names. If an input piece does not contain a given field, the merged arrays for that field will not include placeholders for that piece’s doc range.

This creates a high risk of **misaligned per-doc arrays** (doc lengths shifted relative to doc IDs), which can corrupt scoring.

**Evidence:**

- Field doc-lengths are appended only when present:
  - `src/index/build/piece-assembly.js` lines ~405–417 (`lengths.push(...fieldDocLengths)`)
- No “fill missing docs with 0 length” logic is applied when an input lacks a field.

**Why this matters:**

- Retrieval components expect per-doc arrays to be indexed by `docId`. If array length < totalDocs or offset mismatch occurs, field scoring and filters become incorrect.

**Suggestions:**

- Make field set a strict invariant: all pieces must include all configured fields (recommended).
  - If not true, fail assembly with a clear error.
- If partial field support must be allowed, then assembly must explicitly:
  - allocate per-field arrays of length `totalDocs` and fill missing ranges with 0.

**Test ideas:**

- Two-piece fixture where piece A has `title` field and piece B lacks it.
  - Assert assembly either fails with a clear error, or produces correct filled arrays.

---

### 5) Field tokens validation guard uses `input.fieldTokens` instead of normalized `fieldTokens`

**Severity:** Medium

**Where:** `src/index/build/piece-assembly.js`

**What’s wrong:** Validation is gated by `if (input.fieldTokens) { ... }` but `fieldTokens` is normalized to `Array.isArray(input.fieldTokens) ? input.fieldTokens : null`.

**Evidence:**

- `fieldTokens` computed:
  - `src/index/build/piece-assembly.js` lines ~359–362
- Validation uses `input.fieldTokens` rather than `fieldTokens`:
  - `src/index/build/piece-assembly.js` line ~360.

**Why this matters:**

- If the artifact format drifts to a wrapper object (e.g., `{ arrays: { fieldTokens: [...] } }`), `input.fieldTokens` is truthy but `fieldTokens` becomes null, and validation throws misleading “missing” errors.

**Suggestions:**

- Gate validation on the normalized variable (or support the wrapper structure consistently).

---

### 6) Incremental signature likely misses toggles that affect output

**Severity:** High

**Where:** `src/index/build/indexer/signatures.js`

**What’s wrong:** Incremental signature includes `pythonAstEnabled` and `pythonExecutable` (via `buildFeatureSettings`) but does **not** include other python AST config that can materially change output (e.g., parser mode, strategy knobs), nor does it include a dedicated “relations enabled”/“stage gating” flag.

**Evidence:**

- Feature settings only include `pythonAstEnabled` and `pythonExecutable`:
  - `src/index/build/indexer/signatures.js` lines ~12–20
- Signature body includes `features: buildFeatureSettings(...)`:
  - `src/index/build/indexer/signatures.js` lines ~39–56

**Why this matters:**

- If python AST output changes due to config beyond `.enabled`, caches may be reused incorrectly.
- Stage gating (`runtime.stage === 'stage1'` disables relations regardless of feature flags) is not explicitly represented; if a “stage1-like” run happens without setting `stage1`, signatures could collide.

**Suggestions:**

- Include a normalized snapshot of `runtime.languageOptions.pythonAst` (not just `.enabled`).
- Include an explicit `relationsEnabled` boolean (or include `runtime.stage` directly).

**Test ideas:**

- Toggle pythonAst sub-options (beyond enabled) and assert incremental reuse does not occur.

---

### 7) Early-return on reused incremental plan does not advance progress state

**Severity:** Low

**Where:** `src/index/build/indexer/pipeline.js`

**What’s wrong:** When `loadIncrementalPlan()` indicates `reused === true`, the function returns after `cacheReporter.report()` without advancing/closing progress stages.

**Evidence:**

- `if (reused) { cacheReporter.report(); return; }`:
  - `src/index/build/indexer/pipeline.js` lines ~137–140.

**Why this matters:**

- UI or logs that depend on stage completion may show confusing “stuck” progress for no-op runs.

**Suggestions:**

- Emit a final progress event (“reused/no-op build”) and advance/complete the progress tracker.

---

### 8) `untrusted.enabled` guardrails can be nullified by setting limits to 0/false

**Severity:** High

**Where:** `src/index/build/runtime/caps.js`

**What’s wrong:** `normalizeLimit()` treats `0` and `false` as “no limit” (`null`). When used for untrusted caps (`maxFiles`, `maxLines`, etc.), a user can unintentionally (or intentionally) disable guardrails while `untrusted.enabled === true`.

**Evidence:**

- `normalizeLimit(value, fallback)` returns `null` for `0` or `false`:
  - `src/index/build/runtime/caps.js` lines ~1–6.
- Untrusted caps use `normalizeLimit()`:
  - `src/index/build/runtime/caps.js` lines ~102–105.

**Why this matters:**

- The “untrusted” mode’s primary purpose is safety. Allowing “unlimited” via 0/false undermines that.

**Suggestions:**

- In untrusted mode, treat `0/false` as “use defaults” rather than unlimited, or reject with a config error.
- Add config validation ensuring untrusted limits are finite and positive when enabled.

**Test ideas:**

- With `untrusted.enabled:true`, set `untrusted.maxFiles: 0` and assert resolved guardrails remain finite (defaults), not null.

---

### 9) Embedding identity can become inconsistent in service mode

**Severity:** Medium

**Where:** `src/index/build/runtime/embeddings.js`

**What’s wrong:** `useStubEmbeddings` is computed as `resolvedEmbeddingMode === 'stub' || baseStubEmbeddings`. `baseStubEmbeddings` is influenced by env/argv, but does not override explicit `mode: 'service'` (only `mode:'auto'`).

This can result in:

- `embeddingService === true` (service mode)
- `useStubEmbeddings === true` (identity says “stub”)

**Evidence:**

- Mode resolution:
  - `src/index/build/runtime/embeddings.js` lines ~66–79.

**Why this matters:**

- Any cache keys / manifests derived from `embeddingIdentity` can claim embeddings are stubbed even when the service is expected to produce real vectors.

**Suggestions:**

- Decide precedence explicitly:
  - Either env/argv stub should force mode to stub (overrides service), or
  - When in service mode, ignore stub overrides for identity.
- Add a consistency assertion: `embeddingService => stub === false`.

---

### 10) Worker pool defaults may oversubscribe CPU and return a misleading config snapshot

**Severity:** Low

**Where:** `src/index/build/worker-pool.js`

**What’s wrong:**

- `normalizeWorkerPoolConfig` uses `os.cpus().length * 4` as a default `cpuLimit` (which can inflate default worker counts).
- The exported `runTokenize/runQuantize` return `{ config }` (the input config object) rather than the effective capped config (`poolConfig`).

**Why this matters:**

- In environments where runtime does not provide `cpuLimit`, defaults could lead to unexpectedly high worker counts.
- Debug output and diagnostics can be misleading if “effective” maxWorkers differs from the returned config.

**Suggestions:**

- Prefer CPU count as a default cap unless there is strong evidence oversubscription helps.
- Return an `effectiveConfig` view or always return the post-normalized `poolConfig`.

---

## Additional observations (lower priority)

- `src/index/build/runtime/hash.js`: JSON cloning of config via `JSON.parse(JSON.stringify(config))` will drop regex/function values. If any config fields evolve to include regex objects, hash stability and correctness may degrade.
- `src/index/build/lock.js`: lock release removes the lock file unconditionally. If a stale lock is removed and re-acquired by another process, a delayed release could remove the new lock. Consider validating lock ownership (pid + startedAt) before deletion.
- `src/index/build/preprocess.js`: `skippedByMode.records` can become very large because all non-record files are recorded as “unsupported”. Consider storing only summary counts unless verbose/debug.

