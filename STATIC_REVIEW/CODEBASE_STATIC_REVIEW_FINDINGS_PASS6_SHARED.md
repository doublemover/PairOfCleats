# Codebase Static Review Findings — Shared Utilities (CLI/Progress, Concurrency, Embeddings, Hashing, and Common Helpers)

This report is a focused static review of **shared utilities** used across indexing, retrieval, and integrations: concurrency helpers, caching, bundling, capability probing, CLI progress rendering, hashing/HNSW helpers, and shared encoding/dictionary utilities.

All file references are relative to the repo root.

## Scope

Files reviewed:

- `src/shared/artifact-schemas.js`
- `src/shared/auto-policy.js`
- `src/shared/bench-progress.js`
- `src/shared/bundle-io.js`
- `src/shared/cache.js`
- `src/shared/capabilities.js`
- `src/shared/cli-options.js`
- `src/shared/cli.js`
- `src/shared/cli/display.js`
- `src/shared/cli/display/bar.js`
- `src/shared/cli/display/colors.js`
- `src/shared/cli/display/terminal.js`
- `src/shared/cli/display/text.js`
- `src/shared/cli/progress-events.js`
- `src/shared/concurrency.js`
- `src/shared/config.js`
- `src/shared/dictionary.js`
- `src/shared/disk-space.js`
- `src/shared/embedding-adapter.js`
- `src/shared/embedding-batch.js`
- `src/shared/embedding-identity.js`
- `src/shared/embedding-utils.js`
- `src/shared/embedding.js`
- `src/shared/encoding.js`
- `src/shared/env.js`
- `src/shared/error-codes.js`
- `src/shared/file-stats.js`
- `src/shared/files.js`
- `src/shared/hash.js`
- `src/shared/hash/xxhash-backend.js`
- `src/shared/hnsw.js`

## Severity Key

- **Critical**: likely to cause incorrect results, crashes, or major production breakage.
- **High**: significant correctness/quality risk, major performance hazard, or security foot-gun.
- **Medium**: correctness edge cases, meaningful perf waste, or confusing UX.
- **Low**: minor issues, maintainability concerns, or polish.

---

## Executive Summary

- **Queue backpressure is “fail-fast” in a way that can terminate scheduling mid-stream**: `runWithQueue()` uses `Promise.race(pending)` to enforce `maxPending`, but *any* rejected task can cause the scheduler itself to throw early and stop enqueuing further work (`src/shared/concurrency.js:55–89`). This behavior might be intentional, but it also makes it easy to end up with partial work, confusing logs, and “dangling” in-flight tasks that keep running after the caller has already failed.

- **HNSW fallback behavior may be masking correctness issues**: `loadHnswIndex()` passes a boolean as the second argument to `readIndexSync()` (`src/shared/hnsw.js:111`). Depending on the exact `hnswlib-node` API version, this could be the wrong parameter (some builds expect `maxElements` or have different flags). If mismatched, this would cause *silent, persistent ANN fallback* to the JS provider. Additionally, the similarity mapping `1 - distance` for non-`l2` spaces (`src/shared/hnsw.js:156`) is likely correct for cosine but is questionable for `ip` (inner product).

- **The CLI advertises a progress mode that isn’t actually implemented**: CLI help describes `progress=tty`, but `normalizeProgressMode()` only recognizes `json/jsonl/off` and maps everything else to `auto` (`src/shared/cli/display/terminal.js:5–9`). This undermines the ability to force a particular UI mode and complicates reproducible runs.

- **Cache API shape can create subtle correctness issues**: `createLruCache().get()` returns `null` for a miss (`src/shared/cache.js:144–152`). If callers ever want “negative caching” (`null` as a real cached value), they cannot distinguish **miss** vs **cached-null**, and stats can become misleading.

- **Capabilities can be optimistic for ESM-only packages**: `getCapabilities()` treats `@lancedb/lancedb` as available when `tryRequire()` fails for “unsupported” module format (`allowEsm: true`) (`src/shared/capabilities.js:5–9,43–45`). This is only correct if downstream code path uses `import()` (ESM dynamic import) and not `require()`. If not consistently handled, backend selection may be incorrect.

- **File line counting appears to overcount trailing-newline files**: `countFileLines()` returns `count + 1` whenever any data exists (`src/shared/file-stats.js:17`). This yields behavior closer to `split("\n").length` rather than `wc -l`, and may inflate line counts on the common “file ends with newline” case.

---

## 1) Concurrency and Queueing

### 1.1 **[High]** `Promise.race(pending)` backpressure makes task rejection terminate scheduling early

**Where**
- `src/shared/concurrency.js:55–89` (`runWithQueue()`)
  - backpressure loop: `await Promise.race(pending);` (`:56–60`)
  - tasks are added to `pending` as raw promises returned from `queue.add()` (`:61–83`)

**Why it’s a problem**
- `Promise.race()` rejects if the “first settled” promise rejects.
- In the presence of any failures (e.g., transient I/O errors), this can:
  - throw *during scheduling*, not just during final `Promise.all()`,
  - stop enqueuing later items, even though you may want to keep going (best-effort mode),
  - produce confusing behavior where tasks already in `pending` continue running even as the caller unwinds.

This is especially risky if `maxPending` is low (tight backpressure), because the scheduler will frequently hit the `race()` path, making early failure more likely.

**Suggestion**
- Decide explicitly whether `runWithQueue()` is intended to be **fail-fast** or **best-effort**. If fail-fast is intended, it should be explicit in naming/docs and should still ensure clean shutdown semantics (e.g., cancellation or draining).
- If the goal is backpressure only (not early error propagation), the backpressure `race()` should wait for *any completion*, not propagate rejection (e.g., “race on settled” pattern, or race on wrapped promises that never reject).
- Consider an option like `stopOnError` (default true/false) to control this behavior.

**Test ideas**
- A unit test with `maxPending=2`, 10 items, and worker failing on item #3:
  - Assert whether items after #3 are still attempted (best-effort) or not (fail-fast).
  - Ensure no unhandled rejections and no “hung” queue (i.e., function returns/rejects deterministically).

### 1.2 **[Medium]** `runWithQueue()` assumes `items` is an array-like with `.length`

**Where**
- `src/shared/concurrency.js:42–44`

**Why it’s a problem**
- `if (!items.length)` throws when `items` is null/undefined or a non-array iterable.
- Several call sites may pass `Set`, generator, or “maybe-array” values over time.

**Suggestion**
- Normalize to `Array.isArray(items) ? items : Array.from(items || [])` (or reject with a clear error message), and add a small test to lock in behavior.

### 1.3 **[Medium]** Attaching a no-op `queue.on('error', () => {})` can suppress useful diagnostics

**Where**
- `src/shared/concurrency.js:44–47`

**Why it’s a problem**
- If `p-queue` emits `error` events for certain internal conditions, this handler makes them “handled” and effectively silent.
- That can make debugging concurrency overload conditions harder.

**Suggestion**
- Prefer:
  - logging errors with a structured logger, or
  - exposing an `onQueueError` hook to integrate with the project’s logging/telemetry.

### 1.4 **[Low]** `queue.maxPending` is an ad-hoc convention that could drift

**Where**
- `src/shared/concurrency.js:24–31` and `:54–58`

**Why it’s a problem**
- `maxPending` is not a standard `p-queue` option; it’s a custom property used by this project.
- If other modules set `queue.maxPending` with different semantics (queued-only vs queued+running), behavior will drift.

**Suggestion**
- Consider standardizing this as a wrapper type (e.g., `{ queue, maxPending }`) or documenting the semantic in JSDoc at the queue creation site.

---

## 2) CLI Options and Progress Rendering

### 2.1 **[Medium]** CLI advertises `progress=tty`, but normalization never returns a “tty forced” mode

**Where**
- CLI option description: `src/shared/cli-options.js:19`
- Normalization: `src/shared/cli/display/terminal.js:5–9`

**Why it’s a problem**
- Users reading `--help` will assume `progress=tty` exists as a meaningful choice.
- Currently:
  - `json`/`jsonl` → `jsonl`
  - `off/none/false` → `off`
  - everything else → `auto`

So `progress=tty` behaves like `auto`, which in turn depends on TTY detection and other flags.

**Suggestion**
- Implement a distinct `tty` progress mode:
  - `tty`: force interactive display (even if stdout isn’t TTY, where feasible), or
  - `tty`: force interactive when possible and otherwise degrade to plaintext (but with a predictable rule).
- Alternatively, remove `tty` from help text and document only `auto/jsonl/off` if that is the intended surface.

**Test ideas**
- A test for `normalizeProgressMode('tty')` returning a distinct value.
- A CLI snapshot test ensuring `--progress tty` actually produces the expected output style.

### 2.2 **[Medium]** Render rate limiting can drop the final UI update

**Where**
- `src/shared/cli/display.js:790–798` (`scheduleRender()`)

**Why it’s a problem**
- `scheduleRender()` simply returns if called too soon after the last render.
- If updates stop shortly after a skipped call, the UI can remain stale until some later event triggers another call (which may never happen).

**Suggestion**
- Use an “edge-triggered” scheduling approach:
  - If you skip a render due to rate limit, schedule a `setTimeout` for the earliest permitted time (if one isn’t already scheduled).
- This typically improves UX and reduces “missing final state” flakiness in CI logs.

### 2.3 **[Low]** Log classification heuristics may mislabel output as “status”

**Where**
- `src/shared/cli/display.js` (`appendLog()` and line heuristics)

**Why it’s a problem**
- If a normal log happens to start with `[` or `error:` etc, it can be treated as a status line and rendered differently.
- This can make debugging harder if real stderr is visually compressed.

**Suggestion**
- Prefer explicit `meta.kind` from callers whenever possible, and only use heuristics as a fallback.

### 2.4 **[Low]** Progress event schema is permissive; malformed payloads can leak through

**Where**
- `src/shared/cli/progress-events.js`

**Why it’s a problem**
- `writeProgressEvent()` will serialize any object and does not verify it’s in the `PROGRESS_EVENTS` set.
- Downstream consumers that assume event names are constrained can break.

**Suggestion**
- Optionally enforce `event ∈ PROGRESS_EVENTS` in write mode, and/or include a strict mode for integrations.

---

## 3) Caching (`lru-cache` wrapper)

### 3.1 **[Medium]** Cache “miss” is indistinguishable from “cached null”

**Where**
- `src/shared/cache.js:144–152` — `get()` returns `null` on miss.

**Why it’s a problem**
- Any caller that wants to cache “no result” as `null` cannot distinguish:
  - `null` returned because value was cached
  - `null` returned because it was a miss
- This often produces subtle bugs where a “negative cached” value is treated as “miss” and triggers repeated work, while stats count it as a hit or miss inconsistently.

**Suggestion**
- Prefer returning `undefined` on miss and letting cached values include `null`.
- Or add an API shape like `{ hit: boolean, value }` or `has(key)`.

**Test ideas**
- Add a test that caches `null` and verifies the caller can distinguish it from a miss (whatever semantics you choose).

### 3.2 **[Low]** Size estimation is heuristic and can under/over-evict

**Where**
- `src/shared/cache.js:32–75` (`estimateJsonBytes()`)

**Why it’s a problem**
- The estimator intentionally limits depth and sampling; large objects may be severely under-estimated.
- Under-estimation leads to oversized cache entries and memory pressure.

**Suggestion**
- Provide per-cache `sizeCalculation` overrides in call sites for known object shapes (e.g., file text uses `estimateStringBytes()`).

---

## 4) Bundle IO (JSON / MsgPack) and Checksums

### 4.1 **[Low]** Checksum verification can be skipped for large payloads

**Where**
- `src/shared/bundle-io.js` (`checksumBundlePayload()` / read path)

**Why it’s a problem**
- Payloads above the size threshold do not get a checksum, and checksum verification is also skipped when the estimate exceeds the max.
- This weakens corruption detection for the cases where corruption is most likely to be costly (large outputs, long runs, more I/O).

**Suggestion**
- Consider chunk-level checksums (per chunk or per N KB blocks) so integrity checking remains feasible for large payloads.

### 4.2 **[Low]** `normalizeBundlePayload()` is recursive and not cycle-safe

**Where**
- `src/shared/bundle-io.js` (`normalizeBundlePayload()`)

**Why it’s a problem**
- If any caller passes a cyclic object graph, this will recurse indefinitely and overflow.
- Even without cycles, deeply nested objects can exceed call stack.

**Suggestion**
- Either enforce “bundle payload must be JSON-safe acyclic” at boundaries (assertions in write path) or implement a bounded traversal with cycle detection.

---

## 5) Capabilities and Optional Dependencies

### 5.1 **[High]** ESM-only packages are treated as “available” without confirming the runtime can actually load them

**Where**
- `src/shared/capabilities.js:5–9` (`allowEsm`)
- `src/shared/capabilities.js:43–45` (`lancedb` with `allowEsm: true`)

**Why it’s a problem**
- `tryRequire()` failing with “unsupported” typically means the module exists but cannot be `require()`’d from CommonJS.
- Marking it as available is only correct if the rest of the codebase uses `import()` for that package consistently.

If backend selection relies on this capability and later attempts a `require()`, the result is “capability says yes, runtime crashes”.

**Suggestion**
- Split capability reporting into:
  - `installed: boolean`
  - `loadable: boolean` (under current module system)
  - `loadMethod: 'require' | 'import' | null`
- Then downstream selection can choose a backend that is both installed and loadable.

**Test ideas**
- A test matrix that simulates:
  - `tryRequire` returns `{ ok:false, reason:'unsupported' }`
  - backend selection should either:
    - pick a different backend, or
    - use dynamic import path (if implemented).

### 5.2 **[Low]** Capabilities caching can mask changes across the run

**Where**
- `src/shared/capabilities.js:11–13` caches results unless `refresh: true`.

**Why it’s a problem**
- In long-lived processes where optional deps can appear after startup (e.g., user runs tooling installer), a stale cache may be confusing.

**Suggestion**
- Provide a small helper that can “refresh when install scripts run” or document that a restart is needed.

---

## 6) Hashing and Checksums

### 6.1 **[Low]** `sha1()` JSDoc claims string input, but code uses buffers too

**Where**
- `src/shared/hash.js:17–24` JSDoc says `{string} str`

**Why it’s a problem**
- Call sites like `readTextFileWithHash()` compute `sha1(buffer)` (`src/shared/encoding.js`), which is valid for Node’s crypto API.
- The doc is misleading and can cause incorrect TypeScript typings or refactor regressions.

**Suggestion**
- Update docs to indicate `string | Buffer | Uint8Array`.

### 6.2 **[Low]** Backend selection caches rejected promises and does not recover automatically

**Where**
- `src/shared/hash.js:12–34` (`getBackend()` memoization)
- `src/shared/hash/xxhash-backend.js` caches `wasmStatePromise` and `wasmBackendPromise`

**Why it’s a problem**
- If `xxhash-wasm` fails once (e.g., transient environment issue), subsequent calls will keep returning the same rejected promise.
- In a CLI tool this is usually acceptable, but it makes “retry after fix” impossible without process restart.

**Suggestion**
- Consider clearing cached promises on failure or offer a “reset backend state” helper (similar to `setXxhashBackend()`).

---

## 7) HNSW ANN Helper

### 7.1 **[High]** Potential `readIndexSync()` signature mismatch may cause persistent fallback to JS ANN

**Where**
- `src/shared/hnsw.js:111`

**Why it’s a problem**
- The second argument passed is `normalized.allowReplaceDeleted` (boolean).
- The exact signature of `hnswlib-node`’s `readIndexSync()` varies across versions/builds; if the second arg is not that flag (or if the binding expects a numeric max elements), this call can fail and trigger fallback.
- Because the failure is swallowed (captured as `lastErr`), the system degrades silently.

**Suggestion**
- Verify the installed `hnswlib-node` API and make the call version-safe:
  - detect supported arity / option shape,
  - store the binding version in metadata,
  - or wrap the call with a compatibility adapter and strong tests.

**Test ideas**
- A fixture test that writes an index with your build path and then immediately reads it back via `loadHnswIndex()`:
  - assert it returns a working index (not null),
  - assert queries return stable neighbors.

### 7.2 **[High]** Similarity conversion for `ip` is likely incorrect

**Where**
- `src/shared/hnsw.js:156` — `const sim = space === 'l2' ? -distance : 1 - distance;`

**Why it’s a problem**
- For cosine, many ANN libs return distance = `1 - cosine_similarity`, so `1 - distance` is reasonable.
- For inner-product (`ip`), the returned “distance” may be:
  - negative inner product,
  - or some other transformed distance.
- Using `1 - distance` risks producing:
  - inverted ordering,
  - similarity values outside expected range,
  - poor hybrid merging/ranking if other components assume `sim ∈ [-1,1]` or `[0,1]`.

**Suggestion**
- Confirm the `ip` distance semantics in `hnswlib-node` and implement a correct transformation for that space.
- Consider emitting `rawDistance` alongside `sim` in debug mode so downstream ranking bugs are easier to diagnose.

### 7.3 **[Medium]** Candidate filtering assumes `searchKnn(query, k, filterFn)` exists

**Where**
- `src/shared/hnsw.js:148` — `index.searchKnn(queryVec, limit, filter);`

**Why it’s a problem**
- Some builds of the library do not support a filter callback.
- If unsupported, this will throw and cause ANN fallback behavior in higher layers (or return empty).

**Suggestion**
- Feature-detect support (e.g., call signature length or try/catch once and cache the capability) and apply filtering in JS as a fallback.

---

## 8) Embeddings and Identity

### 8.1 **[Medium]** Adapter caches rejected module/pipeline promises and cannot recover in-process

**Where**
- `src/shared/embedding-adapter.js:11–38` caches `transformersModulePromise` and `pipelineCache`.

**Why it’s a problem**
- A transient import error (missing optional deps, broken install, temporary filesystem issue in models cache) will poison the cache for the entire run.

**Suggestion**
- Clear cache entries on failure, or include a “retry” option for callers that know they’ve remediated the environment.

### 8.2 **[Medium]** ONNX fallback only triggers on `ERR_DLOPEN_FAILED`

**Where**
- `src/shared/embedding-adapter.js:19–28` and `:80–118`

**Why it’s a problem**
- ONNX load failures can present as other errors (missing model files, ABI mismatch, missing providers, segmentation faults avoided via thrown error, etc.).
- Restricting fallback to only `ERR_DLOPEN_FAILED` may cause hard failures in environments where xenova fallback would otherwise work.

**Suggestion**
- Expand fallback detection logic or offer a config flag like `onnx.fallbackToXenovaOnAnyLoadFailure`.

### 8.3 **[Low]** Console warnings bypass structured logging

**Where**
- `src/shared/embedding-adapter.js:75–79` and `src/shared/hnsw.js:12`

**Why it’s a problem**
- CLI logging and JSONL event streams may want consistent routing.
- Direct `console.warn` is harder to capture and test.

**Suggestion**
- Route warnings through a shared logger abstraction or the CLI progress event stream when enabled.

### 8.4 **[Low/Medium]** Identity hashing depends on JSON stringification ordering

**Where**
- `src/shared/embedding-identity.js:73–77`

**Why it’s a problem**
- `JSON.stringify()` is stable for the object shape produced by `buildEmbeddingIdentity()`, but if a caller constructs an equivalent identity with different key insertion order, hash differs.
- This can cause cache-key mismatches across process boundaries.

**Suggestion**
- Use stable key ordering when hashing (e.g., stable stringify) or enforce that only `buildEmbeddingIdentity()` outputs are hashed.

### 8.5 **[Low]** `mergeEmbeddingVectors()` silently truncates mismatched dimension vectors

**Where**
- `src/shared/embedding-utils.js:7–27`

**Why it’s a problem**
- If code and doc vectors have different dims (misconfiguration or model drift), merge will:
  - use the code vector length if present, truncating the doc vector, or
  - use the doc vector length otherwise.
- This produces merged embeddings with inconsistent dims, which can break ANN insertion/search downstream.

**Suggestion**
- Validate dims match before merging and either:
  - refuse to merge, or
  - explicitly pad/truncate with a logged warning.

---

## 9) Encoding, File IO, and Disk Space Helpers

### 9.1 **[Medium]** Symlink protection is susceptible to TOCTOU (check-then-use) races

**Where**
- `src/shared/encoding.js:90–131`

**Why it’s a problem**
- The code checks with `lstat()` and then separately reads the file.
- An attacker (or accidental filesystem change) could potentially replace a path between check and read.

**Suggestion**
- If you need strong symlink safety, consider reading via a file descriptor opened with flags that disallow symlinks (platform-dependent), or accept this as “best-effort safety” and document it.

### 9.2 **[Low]** Disk free checks are skipped on platforms without `statfs`

**Where**
- `src/shared/disk-space.js:33–52`

**Why it’s a problem**
- On unsupported platforms, the tool silently skips disk checks. That can lead to confusing “out of disk” failures later.

**Suggestion**
- Document this behavior, and/or add an optional fallback (shelling out to `df` on Unix-like systems) behind a feature flag.

### 9.3 **[Medium]** Line counting likely overcounts files ending with a newline

**Where**
- `src/shared/file-stats.js:17`

**Why it’s a problem**
- The count equals `(# of newline bytes) + 1` for any non-empty file.
- This overcounts relative to `wc -l` for common files that end with a newline.
- If line counts are used for heuristics (cost estimates, chunk sizing, telemetry), this bias can skew decisions.

**Suggestion**
- Decide which semantic you want:
  - `wc -l` semantics (lines = newlines),
  - or “split” semantics (lines = newlines+1 when non-empty).
- Implement intentionally and document it (and add tests for both `a` and `a\n`).

---

## 10) Shared Dictionary (SharedArrayBuffer wordlist)

### 10.1 **[Medium]** Input normalization and sizing are not byte-accurate and duplicates are not deduplicated

**Where**
- `src/shared/dictionary.js`

**Why it’s a problem**
- `maxLen` uses JavaScript string length, not encoded byte length. This is likely fine for ASCII token sets, but can be wrong for non-ASCII dictionaries.
- Duplicates are not removed, inflating buffers and slightly slowing lookups.

**Suggestion**
- Either:
  - explicitly constrain dictionary to ASCII and document that, or
  - compute `maxLenBytes` (or `maxCodeUnits`) consistently with how comparisons happen.
- Deduplicate by string/bytes before building the shared buffers.

### 10.2 **[Low]** No validation of offsets monotonicity / bounds in view creation

**Where**
- `src/shared/dictionary.js:55–101` (`createSharedDictionaryView()`)

**Why it’s a problem**
- If a corrupted payload is passed, offsets could be out of bounds and lead to incorrect comparisons or exceptions.

**Suggestion**
- Add minimal sanity checks: offsets must be non-decreasing and final offset must be <= bytes length.

---

## 11) Config Merge and Env Helpers

### 11.1 **[Low]** `isPlainObject()` considers many non-plain objects as “plain”

**Where**
- `src/shared/config.js:1–3`

**Why it’s a problem**
- `Date`, `Map`, etc. will be treated as plain objects for merge purposes, which can produce unexpected merges.

**Suggestion**
- Use a stricter check (e.g., `Object.getPrototypeOf(value) === Object.prototype`) if you rely on “true plainness”.

### 11.2 **[Medium]** `getEnvConfig()` ignores most env overrides unless `PAIROFCLEATS_TESTING` is set

**Where**
- `src/shared/env.js:20–45`

**Why it’s a problem**
- If the intent is that environment variables can configure runtime behavior in production usage, this currently won’t work.
- If the intent is “env overrides are for tests only,” this is fine but should be explicitly documented (because many users will assume `PAIROFCLEATS_CACHE_ROOT` etc work).

**Suggestion**
- Clarify intent in docs, and (if needed) implement non-test env overrides with careful precedence rules.

---

## 12) Error Codes

### 12.1 **[Low]** `isErrorCode()` is O(N) with allocation per call

**Where**
- `src/shared/error-codes.js:17–19`

**Why it’s a problem**
- It calls `Object.values(ERROR_CODES)` each time, which allocates an array and scans it.
- Not a correctness issue, but it’s a cheap optimization if used on hot paths.

**Suggestion**
- Precompute a `Set` of allowed values.

---

## 13) Artifact Schema Validation

### 13.1 **[Medium]** Unknown artifact names are treated as valid

**Where**
- `src/shared/artifact-schemas.js:328–335`

**Why it’s a problem**
- `validateArtifact(name, data)` returns `{ ok: true }` if `validators[name]` is missing.
- This makes it easy for new/renamed artifacts to drift without tests catching it, especially during incremental indexing and new artifact writers.

**Suggestion**
- In strict validation modes, return `ok:false` for unknown artifact names (or at least include a warning).
- Alternatively, require callers to pass `allowUnknown: true` explicitly.

### 13.2 **[Low]** Many schemas allow `additionalProperties: true`, limiting their ability to catch drift

**Where**
- `src/shared/artifact-schemas.js` (multiple schema definitions)

**Why it’s a problem**
- This is likely intentional to keep schemas tolerant.
- However, for “invariants” artifacts (e.g., manifests, meta), you may want a stricter mode.

**Suggestion**
- Introduce a dual-mode validator:
  - permissive for user-run validation,
  - strict for CI fixtures to catch unexpected changes.

---

## Appendix: Suggested “Minimum Test Additions” for This Area

Even without implementing new features, a small set of tests would materially reduce regressions:

1. **Concurrency**: failing task with `maxPending` backpressure (defines fail-fast vs best-effort).
2. **Progress mode**: `normalizeProgressMode('tty')` behavior + CLI snapshot.
3. **Cache**: cache `null` value behavior (miss vs hit semantics).
4. **HNSW**: write-then-read smoke test and `ip`/`cosine` similarity sanity checks.
5. **Line counting**: `a`, `a\n`, empty file fixture semantics.
6. **Artifact schemas**: unknown artifact name should be rejected (strict mode) or explicitly allowed.

