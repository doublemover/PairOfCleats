# Codebase Static Review Findings — Pass 6 (Shared Utilities + Storage Backends)

This document is a static review of the **specific files listed in the request** (no code changes applied). It focuses on correctness, robustness, performance, and “sharp edges” that can cause silent failures, index corruption, or throughput regressions.

---

## Scope (files reviewed)

### Shared — schemas, CLI, and high-level helpers
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

### Shared — concurrency, embeddings, encoding, hashing, ANN
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

### Shared — JSON/streaming, optional deps, regex, tokenization
- `src/shared/json-stream.js`
- `src/shared/jsonc.js`
- `src/shared/jsonrpc.js`
- `src/shared/lancedb.js`
- `src/shared/lines.js`
- `src/shared/metrics.js`
- `src/shared/onnx-embeddings.js`
- `src/shared/optional-deps.js`
- `src/shared/postings-config.js`
- `src/shared/progress.js`
- `src/shared/safe-regex.js`
- `src/shared/safe-regex/backends/re2.js`
- `src/shared/safe-regex/backends/re2js.js`
- `src/shared/sort.js`
- `src/shared/stable-json.js`
- `src/shared/tantivy.js`
- `src/shared/threads.js`
- `src/shared/tokenize.js`

### Storage — backend policy + LMDB + SQLite schema/build/incremental
- `src/storage/backend-policy.js`
- `src/storage/lmdb/schema.js`
- `src/storage/sqlite/incremental.js`
- `src/storage/sqlite/schema.js`
- `src/storage/sqlite/utils.js`
- `src/storage/sqlite/vector.js`
- `src/storage/sqlite/build-helpers.js`
- `src/storage/sqlite/build/bundle-loader.js`
- `src/storage/sqlite/build/delete.js`
- `src/storage/sqlite/build/from-artifacts.js`
- `src/storage/sqlite/build/from-bundles.js`
- `src/storage/sqlite/build/incremental-update.js`
- `src/storage/sqlite/build/manifest.js`
- `src/storage/sqlite/build/pragmas.js`
- `src/storage/sqlite/build/statements.js`
- `src/storage/sqlite/build/validate.js`
- `src/storage/sqlite/build/vocab.js`

---

## Severity key

- **CRITICAL** — can silently produce wrong results, corrupt artifacts, or report success while failing.
- **HIGH** — likely to cause incorrect behavior, crashes, or major performance regressions in realistic workloads.
- **MEDIUM** — correctness edge cases, drift, or inefficiencies; may be acceptable short-term but should be addressed.
- **LOW** — polish, ergonomics, logging/UX, or minor risks.

---

## Executive summary

The most important issues found in this pass:

1. **CRITICAL:** `runWithQueue()` in `src/shared/concurrency.js` can **drop task failures** and can **return before all work is done** in common conditions due to removing settled promises from the tracking set before final awaiting. This is a foundational primitive used by other utilities and can lead to partial/incomplete outputs while reporting success.
2. **HIGH:** `mergeEmbeddingVectors()` in `src/shared/embedding-utils.js` can generate **NaNs** when vectors are different lengths, which can poison ANN indexing and similarity calculations.
3. **HIGH:** `writeJsonLinesSharded()` in `src/shared/json-stream.js` uses `JSON.stringify()` directly, bypassing the project’s custom JSON streaming serializer (which handles TypedArrays). This risks **incorrect JSON output** (esp. typed arrays), plus unnecessary memory churn in the hottest I/O path.
4. **HIGH:** `rankHnswIndex()` in `src/shared/hnsw.js` appears to treat HNSW “ip” space distances like cosine distances (`sim = 1 - distance`), which is likely wrong and can mis-rank neighbors.
5. **HIGH:** `showProgress()` in `src/shared/progress.js` divides by `total` without guarding `total === 0`, which can throw and crash non-structured progress reporting paths.
6. **HIGH:** `resolveBackendPolicy()` in `src/storage/backend-policy.js` appears to conflate “retrieval engine selection” (e.g., tantivy) with “storage backend selection” (sqlite/lmdb), and for `tantivy` forces `useSqlite:false`, which risks breaking any code path that still needs SQLite for metadata/lookup.

---

## Findings

### 1) CRITICAL — `runWithQueue()` can silently drop failures and/or return early
**Where**
- `src/shared/concurrency.js` — `runWithQueue()` / `runWithConcurrency()` (notably lines ~41–109 in the current file)

**What’s wrong**
- The implementation tracks scheduled work in a `pending` `Set`, but **removes each promise from the Set when it settles**:
  - `task.finally(() => pending.delete(task))` (lines ~95–96)
- The final wait is `await Promise.all(pending)` (line ~106), which only awaits whatever promises remain *at that exact moment*.
- Therefore:
  - If a task **completes (resolve or reject) while scheduling is still ongoing**, it will be removed from `pending` and **will not be awaited** at the end.
  - Rejections can be **fully swallowed** because `enqueue()` attaches `task.catch(() => {})` (line ~103) to avoid unhandled rejections, and the rejected task may never be awaited later due to removal.
- Net effect: **“success” can be reported with partially executed work and/or missed failures.**

**Why it matters**
- This is a shared concurrency primitive used by other utilities (for example, `src/shared/file-stats.js` calls `runWithConcurrency()`), so the blast radius is large:
  - Incorrect metrics, missing outputs, incomplete indexing steps, etc.
- The failure mode is especially dangerous because it can be **silent**.

**Suggestions**
- Do not remove settled promises from the tracked set *until* after the “global” await completes, or track all scheduled promises in a separate array for the final await.
- Alternatively (often cleaner), rely on `queue.onIdle()` **and** explicitly collect/propagate errors:
  - `onIdle()` alone does not propagate task failures unless failures are surfaced and aggregated.
- If you want bounded “pending” purely to throttle memory: keep a separate bounded-set for throttling but still maintain an “all scheduled tasks” list for final waiting/error propagation.

**Tests to add**
- A unit test where some tasks **fail quickly** while additional tasks are still being enqueued:
  - Assert that the function rejects.
- A unit test where tasks resolve quickly while many are enqueued:
  - Assert that **all** tasks ran (e.g., counter equals N).
- A test where `collectResults:false` is used:
  - Assert that completion waits for all tasks (no early return).

---

### 2) HIGH — `mergeEmbeddingVectors()` can produce NaNs on mismatched dimensions
**Where**
- `src/shared/embedding-utils.js` — `mergeEmbeddingVectors()` (lines ~10–29)

**What’s wrong**
- When both `codeVector` and `docVector` are present, `merged` length is:
  - `Math.max(code.length, doc.length)`
- But the loop adds `code[i] + (doc[i] ?? 0)` (line ~17), so if `i` exceeds `code.length - 1`, then `code[i]` is `undefined` and `undefined + number` becomes **NaN**.
- This creates NaN values in merged embeddings when dimensions do not match (which can occur if:
  - model configuration changes,
  - a fallback/stub embedder uses different dims,
  - some chunks are missing one side, or
  - a pipeline bug emits vectors inconsistently).

**Why it matters**
- NaNs are toxic:
  - Many ANN/vector libraries will error, drop rows, or treat NaNs inconsistently.
  - Even if stored, ranking becomes undefined.

**Suggestions**
- Treat missing components as 0 on both sides:
  - Use `(code[i] ?? 0) + (doc[i] ?? 0)` for merged mode.
- Consider asserting dimension equality for “merge” mode and logging a structured error if not equal (depending on desired tolerance).

**Tests to add**
- A unit test merging `[1,2]` and `[3,4,5]`:
  - Ensure output is finite (no NaN) and has expected length/values.

---

### 3) HIGH — `writeJsonLinesSharded()` bypasses TypedArray-safe streaming and increases memory churn
**Where**
- `src/shared/json-stream.js` — `writeJsonLinesSharded()` (lines ~356–517)

**What’s wrong**
- Unlike `writeJsonLinesFile()` (which uses `writeJsonValue()` and handles TypedArrays), `writeJsonLinesSharded()` does:
  - `const line = JSON.stringify(item);` (line ~413)
- Risks:
  1. **TypedArrays serialization mismatch**
     - JSON.stringify(TypedArray) typically serializes as an object with numeric keys (implementation-dependent) rather than a JSON array, which can corrupt the intended schema.
     - This undermines the existence of the custom serializer elsewhere in the file.
  2. **Higher memory overhead**
     - Converting each record to a full string defeats streaming’s ability to write incrementally without intermediate allocations.
     - In high-throughput indexing, this can create significant GC pressure.
  3. **Backpressure is not surfaced**
     - The current implementation uses `stream.write(...)` which likely buffers; for extreme throughput, you want to actively respect backpressure (await drain) especially when shard sizes are large.

**Why it matters**
- Sharded JSONL is explicitly a scaling strategy (piece sizes, incremental index state, streaming).
- This function is likely to sit in the hot path for writing large artifacts.

**Suggestions**
- Use the existing streaming JSON writer path (the `writeJsonValue()` logic) for each item instead of JSON.stringify:
  - Either refactor `writeJsonValue()` to support single-line JSON output (no whitespace) for JSONL, or write an equivalent “writeJsonLineValue()”.
- If TypedArrays are expected in sharded records, explicitly normalize them to arrays before writing, or extend the serializer consistently.
- Add optional backpressure handling:
  - If `stream.write()` returns false, wait for `'drain'`.

**Tests to add**
- A test writing sharded JSONL containing `Uint8Array` fields:
  - Ensure output parses to arrays (and matches expected schema).
- A test that enforces shard size boundaries:
  - Ensures shard rollover occurs at configured thresholds.

---

### 4) HIGH — HNSW “ip” similarity scoring is likely incorrect
**Where**
- `src/shared/hnsw.js` — `rankHnswIndex()` (lines ~126–160)

**What’s wrong**
- Similarity mapping:
  - `const sim = space === 'l2' ? -distance : 1 - distance;` (line ~156)
- This treats both `cosine` and `ip` the same way.
- In many ANN libraries, returned “distance” semantics differ by space:
  - Cosine: often `1 - cosine_similarity`
  - IP: often `-inner_product` or something not compatible with `1 - distance`
- If `ip` is misinterpreted, neighbor ordering and similarity scores become unreliable.

**Why it matters**
- Vector retrieval quality and ranking correctness are core product features. If IP behaves wrong, users get bad results with no obvious error.

**Suggestions**
- Verify hnswlib-node distance semantics per space and encode explicit mappings:
  - `cosine`: `sim = 1 - distance`
  - `l2`: `sim = -distance` (or `-sqrt(distance)` depending on what is returned)
  - `ip`: typically `sim = -distance` if distance is negative dot product; or `sim = distance` if distance is already similarity.
- Add unit tests with small synthetic vectors where expected top-1 is known.

**Tests to add**
- Build a tiny 2D index with 3 points and query known nearest for each space.
- Assert stable ordering and score monotonicity.

---

### 5) HIGH — `showProgress()` can crash when `total === 0`
**Where**
- `src/shared/progress.js` — `showProgress()` (lines ~138–161)

**What’s wrong**
- `const pct = ((i / total) * 100).toFixed(1);` (line ~144)
- If `total` is 0, `(i / 0)` is `Infinity`, and `Infinity.toFixed(...)` throws.

**Why it matters**
- Crashes during CLI operations are disproportionately harmful; users interpret them as index corruption or “tool unreliable”.
- Even if most callers pass non-zero totals, edge cases exist: empty repos, empty file lists, dry runs, filters excluding all files, etc.

**Suggestions**
- Guard `total <= 0`:
  - Use `pct = total > 0 ? ... : '0.0'` or `'-'`.
- Consider clamping `i` to `[0,total]` for display.

**Tests to add**
- `showProgress('step', 0, 0)` does not throw.
- `showProgress('step', 1, 0)` does not throw.

---

### 6) HIGH — `ensureNotSymlink()` can be bypassed if callers pass a non-lstat stat
**Where**
- `src/shared/encoding.js` — `ensureNotSymlink()` and `ensureNotSymlinkSync()` (lines ~95–115)

**What’s wrong**
- The symlink check uses:
  - `const stat = options.stat || await fsPromises.lstat(filePath);`
- If a caller passes `options.stat` obtained via `fs.stat()` (not `lstat()`), symlinks are resolved and `isSymbolicLink()` will be false, bypassing the intended guard.

**Why it matters**
- This is a correctness and safety issue:
  - You explicitly throw `ERR_SYMLINK` to prevent unintended traversal. The current API shape allows a foot-gun.

**Suggestions**
- If you accept `options.stat`, validate it is an lstat (or just ignore `options.stat` unless explicitly labeled `options.lstat`).
- Alternatively, always call `lstat` when `allowSymlink !== true` and remove the optimization entirely (it’s not typically a hot path compared to file reads).

**Tests to add**
- Passing an `fs.stat()` result for a symlink should still be rejected.

---

### 7) HIGH — `resolveBackendPolicy()` likely conflates “engine selection” with “storage selection”
**Where**
- `src/storage/backend-policy.js` — `resolveBackendPolicy()` (notably the `tantivy` forced branch)

**What’s wrong**
- For `backendArg === 'tantivy'` the function returns:
  - `useSqlite:false`, `useLmdb:false`, `backendLabel:'tantivy'`
- This assumes selecting Tantivy as the retrieval backend eliminates the need for SQLite/LMDB entirely.
- In most architectures:
  - Tantivy is a *search index engine*, not a complete replacement for all metadata storage (chunk metadata, relations, docmeta, etc.).
- There is also an early return when `needsSqlite` is false that drops everything (even if user requested sqlite explicitly), which may be correct for some modes but is risky as a policy layer.

**Why it matters**
- Risk of “backend selection” producing a runtime that cannot serve necessary metadata or which unexpectedly falls back to in-memory behavior.
- Hard to debug because the function returns a plausible policy object with a “reason”.

**Suggestions**
- Separate concerns:
  1. **Storage policy** (sqlite vs lmdb vs memory)
  2. **Search engine policy** (tantivy vs sqlite-fts vs JS BM25 vs etc.)
  3. **Vector backend policy** (HNSW vs LanceDB vs sqlite-vec)
- If you keep this function, rename it and make it explicitly “search backend policy” vs “storage backend policy”.
- If Tantivy still needs SQLite for chunk metadata, return `useSqlite:true` with `backendLabel:'tantivy'` (or provide a “hybrid” label) and document clearly.

**Tests to add**
- Policy unit tests asserting:
  - `--backend tantivy` does not disable required metadata store if metadata is needed.

---

### 8) MEDIUM — `auto-policy` repo scanning can leak directory handles on early break
**Where**
- `src/shared/auto-policy.js` — `scanRepoStats()` (uses `fsPromises.opendir()` and `for await`)

**What’s wrong**
- When truncation triggers, the code executes `break` out of the `for await` loop.
- Node’s `Dir` async iterator may not always close the directory handle promptly on early termination.
- There is no `try/finally { await dir.close(); }`.

**Why it matters**
- On large repos, especially with nested traversal and early exits, this can accumulate open file descriptors.

**Suggestions**
- Ensure `dir.close()` runs in a `finally`, including early breaks.

**Tests to add**
- Harder to unit-test portably, but you can add an integration test that:
  - runs scan against a directory tree with truncation enabled and asserts “too many open files” does not occur under stress.

---

### 9) MEDIUM — CLI display can leak task-related state in long-lived sessions
**Where**
- `src/shared/cli/display.js` — `createDisplay()`, internal maps:
  - `paletteSlots`, `rateMaxByTask`, `hueShiftByTask`, `tasksByMode` derived structures

**What’s wrong**
- `removeTask()` removes from `tasks` map and order tracking, but does not clean:
  - `paletteSlots`, `rateMaxByTask`, `hueShiftByTask`
- In long-lived processes (watch mode, server mode, integrations), the number of unique task IDs can grow, and these Maps can become unbounded.

**Why it matters**
- Memory growth over time; tricky to reproduce but painful in persistent processes.

**Suggestions**
- When a task is removed, also delete its associated entries from the task-scoped maps.
- Consider a small “eviction” policy if tasks are extremely dynamic.

**Tests to add**
- A unit test that creates/removes many tasks and asserts map sizes do not grow unbounded.

---

### 10) MEDIUM — CLI/build option schema drift and ambiguity
**Where**
- `src/shared/cli-options.js`

**What’s wrong**
- `INDEX_BUILD_OPTIONS` includes flags that are not obviously represented or constrained in `INDEX_BUILD_SCHEMA` (and similarly for bench schema).
- The schema does not set `additionalProperties:false`, which may be intentional, but then schema validation is “partial” and can allow silent typos.

**Why it matters**
- Configuration drift is a common source of “it doesn’t work but doesn’t error”.
- If schemas are meant to be authoritative, partial schema coverage undermines them.

**Suggestions**
- Decide explicitly:
  - Strict schema mode: `additionalProperties:false` + exhaustive properties.
  - Permissive mode: allow unknown keys but emit warnings.
- Add a “config inventory” generation test that ensures CLI flags have corresponding schema documentation entries (if that’s your intended posture).

---

### 11) MEDIUM — Embedding identity can omit ONNX config when provider string isn’t normalized
**Where**
- `src/shared/embedding-identity.js` — `buildEmbeddingIdentity()` (line ~65)

**What’s wrong**
- The ONNX config is included only if `provider === 'onnx'`.
- But earlier fields store `provider: normalizeString(provider)` (line ~50).
- If the caller passes provider values that normalize to `'onnx'` but are not exactly `'onnx'` (case/whitespace), `identity.onnx` becomes `null`.
- That can create **cache key collisions** across different ONNX configurations.

**Why it matters**
- Embedding identity keys are used to decide whether cached embeddings are valid.
- Collisions mean “wrong vectors reused”.

**Suggestions**
- Compare against normalized provider string, not raw input.

**Tests to add**
- Provider `'ONNX'` or `' onnx '` should still include ONNX identity details.

---

### 12) MEDIUM — `threads.js` can mis-report “source” when CLI threads is invalid
**Where**
- `src/shared/threads.js` — `resolveThreadBudget()`

**What’s wrong**
- If `--threads` is present but invalid (NaN/0), `cliThreadsProvided` can still become true.
- Then `requestedConcurrency` falls back to config/default because `cliConcurrency` isn’t finite, but `source` will still report `'cli'`.

**Why it matters**
- Debuggability: “why are we using X threads?” becomes confusing.
- This affects tuning efforts and performance investigations.

**Suggestions**
- Track “source” based on the actual selected numeric value, not simply “flag present”.

---

### 13) MEDIUM — `file-stats` line counting is off-by-one for trailing-newline files
**Where**
- `src/shared/file-stats.js` — `countFileLines()` (line ~17)

**What’s wrong**
- The function returns `count + 1` whenever any data was read.
- For files ending with a newline, this yields an extra line compared to common line-count semantics.

**Why it matters**
- Reported metrics (LOC) will disagree with common tools and can confuse users.
- If line counts are used as signals (ranking, chunking heuristics), it can skew behavior.

**Suggestions**
- Track whether the final byte is `\n` and only add 1 when the file is non-empty and does not end with a newline.

**Tests to add**
- “a” => 1 line
- “a\n” => 1 line (or 2 if you explicitly want newline-as-empty-line semantics; but then document it)
- “” => 0 lines

---

### 14) MEDIUM — `jsonrpc` framing is strict about `\r\n\r\n` and may reject `\n\n`
**Where**
- `src/shared/jsonrpc.js` — `createFramedJsonRpcParser()`

**What’s wrong**
- Header/body delimiter search uses `buffer.indexOf('\r\n\r\n')`.
- Some implementations may emit `\n\n` (less common, but seen in some embedded or non-compliant tooling).

**Why it matters**
- MCP/LSP toolchain stability depends on robustness against slight variations (especially when integrating external tools).

**Suggestions**
- Consider accepting `\n\n` as a fallback delimiter if `\r\n\r\n` isn’t found after a reasonable header limit.

---

### 15) MEDIUM — “timeoutMs” in SafeRegex does not actually enforce a timeout for blocking engines
**Where**
- `src/shared/safe-regex.js`

**What’s wrong**
- The “timeout” is measured as wall clock time after `backend.exec()` returns.
- If the underlying regex engine can block indefinitely (JS RegExp in pathological cases), this will not protect you.
- In fairness, the default backend is RE2/RE2JS, which *should* be safe, but the API suggests a guarantee it cannot enforce in all configurations.

**Why it matters**
- The API is likely to be treated as a hard safety boundary; if it’s not, callers may become over-confident.

**Suggestions**
- Document the guarantee precisely:
  - “Timeout is best-effort; catastrophic backtracking is prevented by RE2-based backends; JS backend not used.”
- If you ever add a JS-regex backend, do not offer `timeoutMs` without an interruptible mechanism.

---

### 16) MEDIUM — Tokenization dictionary/AC matching: potential offset semantics mismatch
**Where**
- `src/shared/tokenize.js` — `buildAhoMatches()` (lines ~133–146)

**What’s wrong**
- Callback uses `offset` as the match “start”:
  - `const start = Number(offset); const end = start + value.length;`
- Many Aho-Corasick implementations provide the **end offset** (or end index) of the match.
- If this library’s semantics are “end index”, matches will be placed at the wrong start positions, harming segmentation quality.

**Why it matters**
- Tokenization affects:
  - search recall (dictionary splitting),
  - indexing normalization,
  - compression effectiveness and vocabulary.

**Suggestions**
- Confirm the callback contract for `aho-corasick`:
  - If `offset` is the end index, compute `start = offset - value.length + 1`.
- Add a unit test with a tiny dictionary and known match positions.

---

### 17) MEDIUM — SQLite build from artifacts: compressed JSONL ingestion is non-streaming
**Where**
- `src/storage/sqlite/build/from-artifacts.js`

**What’s wrong**
- When `.jsonl.gz` / `.jsonl.zst` exists, the code calls `readJsonLinesArray(filePath)` which:
  - reads the entire decompressed content into memory and parses it into an array (via `readJsonLinesFile` with `asArray:true`).
- This defeats streaming for large chunk_meta JSONL and can be a major memory spike.

**Why it matters**
- For large repos, chunk_meta can be very large; decompression + parse into arrays is one of the worst memory patterns.

**Suggestions**
- Provide a streaming JSONL reader that can read compressed inputs incrementally:
  - `zlib.createGunzip()` pipeline + readline line splitting for gzip
  - zstd streaming decode if available (or optional dependency)
- Keep the “asArray” path only for small files or for tests.

**Tests to add**
- A test that reads compressed jsonl in streaming mode and does not exceed a memory threshold (can be approximated with “does not allocate >X MB” by instrumentation).

---

### 18) MEDIUM — SQLite build from bundles: file manifest key drift risk + bundle in-flight sizing
**Where**
- `src/storage/sqlite/build/from-bundles.js`

**What’s wrong**
1. **FileCounts key mismatch**
   - FileCounts is seeded with `record.normalized` (line ~128), but later updates using `normalizedFile = normalizeFilePath(fileKey)` (line ~274).
   - If the normalization is not identical, you can end up with:
     - “old” keys remaining at 0
     - “new” keys accumulating counts
     - duplicate/incorrect `file_manifest` rows (depending on insert semantics)
2. **In-flight bundle sizing can be large**
   - `maxInFlightBundles` is `bundleThreads * 2` capped at 64.
   - Each bundle may contain embeddings; holding many bundles simultaneously can balloon memory.

**Why it matters**
- Wrong manifest counts break incremental indexing correctness and can trigger unnecessary rebuilds or skipped updates.
- Memory spikes reduce throughput and increase crash risk.

**Suggestions**
- Use a single canonical normalized key: prefer the manifest’s normalized path consistently.
- Bound in-flight bundles by estimated bundle size (if known) rather than only thread count.

---

### 19) MEDIUM — Incremental update loads the entire chunks mapping into memory
**Where**
- `src/storage/sqlite/build/incremental-update.js` (lines ~299–307)

**What’s wrong**
- It executes:
  - `SELECT id, file FROM chunks WHERE mode = ? ORDER BY id`
- Then builds a full `Map(file -> [ids])` for the entire DB before applying changes.
- For large repos, this can be millions of rows and exceed memory.

**Why it matters**
- Incremental update should be the “fast path”; if it can’t handle large indexes, it undermines the feature.

**Suggestions**
- Only load doc IDs for the affected files:
  - query `WHERE mode = ? AND file IN (...)` in chunks using parameter chunking
  - or use `file_manifest` as a starting point if it contains enough to locate ids (if not, consider adding a mapping table)
- If you need free-id reuse, keep a simple “free list” table or compute free IDs differently (or do not reuse IDs at first—favor correctness and simplicity).

**Additional correctness note**
- The dimension consistency check appears to consider only float embeddings; if bundles carry `embedding_u8` without float, dims consistency can be missed.

---

### 20) MEDIUM — SQLite vector packing assumes native endianness
**Where**
- `src/storage/sqlite/vector.js` — `packUint32()` / `unpackUint32()`

**What’s wrong**
- `Buffer.from(Uint32Array)` and `new Uint32Array(buffer.buffer, ...)` rely on platform endianness.
- On non-little-endian architectures, the persisted bytes will not be portable.

**Why it matters**
- Likely low in practice (most deployments are little-endian), but this is a correctness hazard if portability is a goal.

**Suggestions**
- If you want strict portability, encode/decode with a fixed endianness (DataView + little-endian writes).

---

### 21) LOW/MEDIUM — Artifact schema coverage and enforcement posture is unclear
**Where**
- `src/shared/artifact-schemas.js`

**What’s wrong**
- `validateArtifact()` returns `{ ok: true }` when there is no schema for an artifact name.
- This may be intentional (partial coverage), but it creates a risk that new artifacts are emitted without any validation.

**Why it matters**
- Schema drift is a recurring problem in indexing pipelines.

**Suggestions**
- Add a “strict mode” option: unknown artifact names are errors during CI/tests, but allowed in production if desired.

---

### 22) LOW — Minor ergonomics and drift observations (not blockers)
**Where**
- `src/shared/cli/display/terminal.js` — normalizes `json` progress mode to `jsonl`, which may be surprising if users expect a single JSON object.
- `src/shared/dictionary.js` — normalization is strict and case-sensitive; may reduce match rate unless this is explicitly desired.
- `src/shared/capabilities.js` and `src/shared/optional-deps.js` — ensure `allowEsm` semantics are consistently matched by code paths that actually use `tryImport` when the module is ESM-only.

---

## Files reviewed with no major issues identified
These files appear generally sound (or issues are mostly stylistic/ergonomic), based on this static pass:

- `src/shared/bench-progress.js`
- `src/shared/cache.js`
- `src/shared/config.js`
- `src/shared/disk-space.js`
- `src/shared/embedding-batch.js`
- `src/shared/embedding.js`
- `src/shared/env.js`
- `src/shared/error-codes.js`
- `src/shared/files.js`
- `src/shared/hash.js`
- `src/shared/hash/xxhash-backend.js`
- `src/shared/jsonc.js`
- `src/shared/lancedb.js`
- `src/shared/lines.js`
- `src/shared/metrics.js`
- `src/shared/onnx-embeddings.js`
- `src/shared/optional-deps.js`
- `src/shared/postings-config.js`
- `src/shared/safe-regex/backends/re2.js`
- `src/shared/safe-regex/backends/re2js.js`
- `src/shared/sort.js`
- `src/shared/stable-json.js`
- `src/shared/tantivy.js`
- `src/storage/lmdb/schema.js`
- `src/storage/sqlite/incremental.js`
- `src/storage/sqlite/schema.js` (noting design assumptions; see findings)
- `src/storage/sqlite/build/*` (generally careful, but see memory/normalization findings)

---

## Recommended follow-up (cross-cutting)

1. **Fix `runWithQueue()` first** and then re-run indexing + retrieval test suites; it can invalidate conclusions about downstream correctness.
2. Add a “TypedArray roundtrip” test suite for artifact writers/readers:
   - JSON object writer, JSON lines writer, sharded JSONL writer.
3. Add deterministic small-fixture tests for:
   - HNSW similarity scoring per space,
   - incremental update correctness (added/changed/deleted files),
   - manifest diffing behavior with path normalization.
4. Add benchmark harnesses (not CI tests) that simulate:
   - large JSONL chunk_meta ingestion (compressed and uncompressed),
   - bundle-worker concurrency under memory pressure.

---

## Appendix: Notes on style/format anomalies

A few files (notably `src/storage/sqlite/build/from-bundles.js`) contain indentation/format anomalies that do not change runtime semantics but make code review harder and can hide logic errors. It’s worth running a formatter pass or enforcing lint rules for consistent indentation in the build pipeline.

