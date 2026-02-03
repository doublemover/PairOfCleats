
---

## Confirmed correctness bugs

### 1) Stateful global RegExp breaks filter parsing across multiple calls
- **Severity:** High
- **File:** `src/retrieval/filters.js`
- **Where:** `FILTER_TOKEN_RE` (~L63) + `splitFilterTokens()` loop (~L74–82)
- **Problem:** `FILTER_TOKEN_RE` is declared with the global (`g`) flag and reused across calls. Using `.exec()` advances `lastIndex`, so subsequent calls can start scanning mid-string or immediately return `null`, producing empty/partial token lists.
- **Impact:** In long-running processes (API server / MCP), filters can silently stop working after a previous query.
- **Fix:** Reset `FILTER_TOKEN_RE.lastIndex = 0` at the start of `splitFilterTokens()`, or instantiate a fresh regex inside the function.

---

### 2) CLI wrapper mis-parses `--repo` (ignores `--repo=...` and can misread query text)
- **Severity:** Medium
- **File:** `bin/pairofcleats.js`
- **Where:** `extractRepoArg()` (~L661–665)
- **Problems:**
  1. Only supports `--repo <path>`, not `--repo=<path>`.
  2. Does not respect the `--` end-of-options sentinel. If a user searches for the literal token `--repo` after `--`, the wrapper can incorrectly treat it as a flag and grab the next token as the repo path.
- **Impact:** Wrong repo root selection → wrong config/runtime envelope and confusing failures.
- **Fix:** Only scan args before `--`, and support both `--repo value` and `--repo=value`.

---

### 3) API server breaks for IPv6 hosts (e.g. `--host ::1`)
- **Severity:** Medium
- **Files:**
  - `tools/api/router.js`
  - `tools/api-server.js`
- **Where:**
  - `tools/api/router.js`: `new URL(req.url..., \`http://${host}\`)` (~L63)
  - `tools/api-server.js`: `baseUrl = \`http://${host}:${actualPort}\`` (~L94)
- **Problem:** IPv6 literals must be bracketed in URLs (`http://[::1]:7345`). As written, `http://::1` is invalid.
- **Impact:** API becomes unusable under IPv6 host settings (invalid URL / 500s).
- **Fix:** Bracket IPv6 in URL contexts or avoid interpolating host into the parsing base (use a fixed base like `http://localhost` for request URL parsing).

---

## Major performance / scalability issues

### 4) Per-chunk duplication of file-level lint/complexity bloats memory & artifacts
- **Severity:** Medium–High
- **Files:**
  - `src/index/build/file-processor/process-chunks/index.js` (~L381–420)
  - `src/index/build/file-processor/assemble.js` (~L96–130)
- **Problem:** `processChunks()` computes `fileComplexity` / `fileLint` once per file, but attaches them to **every chunk**. `buildChunkPayload()` stores them verbatim (`complexity`, `lint`).
- **Impact:** Larger in-memory `chunks[]`, larger serialized artifacts / SQLite rows, slower IO and load/search on large repos.
- **Fix options:**
  1. Store lint/complexity once per file (e.g., `file_meta`) and reference by file id.
  2. If chunk-level details are needed, filter lint/complexity down to the chunk’s line range.
  3. Gate behind a config flag (default off).

---

### 5) Index cache validation always recomputes a full signature (expensive with sharded artifacts)
- **Severity:** High (latency)
- **File:** `src/retrieval/index-cache.js`
- **Where:**
  - `buildIndexSignature()` (~L128–142)
  - `loadIndexWithCache()` (~L200–213), signature computed at ~L205 even on cache hits
- **Problem:** Every `loadIndexWithCache()` call computes a signature requiring `readdirSync()` + `statSync()` on *many* shard files.
- **Impact:** Even warm cache searches can do lots of synchronous filesystem work, blocking the Node event loop and dominating request latency on large builds.
- **Fix options:**
  1. Use a single build marker / build id file for validation (e.g., `index_state.json` build id).
  2. Cache signatures with a TTL.
  3. Avoid per-shard stats if the `.meta.json` reliably changes whenever shards change.

---

### 6) File discovery materializes and sorts full candidate lists; then per-file `lstat` (heavy on huge repos)
- **Severity:** Medium
- **Files:** `src/index/build/file-scan.js`, `src/index/build/discover.js`
- **Problem:** Candidate paths are collected into memory, sorted, then `fs.lstat()` is called per candidate.
- **Impact:** Big repos → high peak memory, lots of metadata IO, long wall time.
- **Potential improvements:** Use fdir’s stats mode if possible, apply max-files earlier, and stream candidates rather than fully materializing.

---

### 7) Watch-mode fallback can run unbounded async work (`Promise.all`) if IO queue missing
- **Severity:** Medium
- **File:** `src/index/build/watch.js` (~L170–190)
- **Problem:** If `runtimeRef.queues?.io` is absent, it does `Promise.all(absPaths.map(handleUpdate))`.
- **Impact:** Large change bursts can spawn thousands of concurrent operations (CPU + IO contention, process instability).
- **Fix:** Ensure an IO queue always exists in watch mode, or cap concurrency in the fallback.

---

## Reliability / maintainability issues

### 8) Queue lock can become permanently blocking after crashes (no stale-lock recovery)
- **Severity:** Medium
- **File:** `tools/service/queue.js`
- **Where:** `withLock()` (~L9–41)
- **Problem:** Lock is a simple file created with `open(...,'wx')`. If a process dies while holding it, the lock file remains; others wait 5s then throw `Queue lock timeout`. There is no stale lock cleanup.
- **Impact:** Queue can deadlock until manual deletion.
- **Fix:** Add PID/timestamp + stale-lock detection (a similar pattern exists in `src/index/build/lock.js`).

---

### 9) Redundant AbortController + duplicated listeners in API routes
- **Severity:** Low
- **File:** `tools/api/router.js`
- **Where:**
  - `/search/stream`: unused `abortController` (~L159–164) then separate `controller` used later
  - `/search`: similar pattern (~L254–258 then ~L305+)
- **Impact:** Unnecessary complexity/overhead; makes abort logic harder to reason about.
- **Fix:** Keep one controller per request and wire its `signal` consistently.

---

### 10) SCM annotate timeout wrapper doesn’t cancel underlying work
- **Severity:** Medium
- **File:** `src/index/build/file-processor/cpu.js`
- **Where:** `annotateWithTimeout()` (~L321–339)
- **Problem:** Uses `Promise.race()`; when the timer wins, underlying annotate work may continue unless the provider truly enforces timeouts.
- **Impact:** Potential background work continuing past timeouts.
- **Fix:** Ensure underlying annotate supports cancellation / kill; don’t rely solely on `Promise.race()`.

---

### 11) Sync filesystem usage on request-time paths can block the event loop
- **Severity:** Medium
- **Examples:** `src/retrieval/index-cache.js` signature logic; some API server path checks that use sync fs.
- **Impact:** Head-of-line blocking under concurrent requests.
- **Fix:** Use async FS on hot paths or move heavy work to workers / background processes.

---

### 12) Streaming JSON-RPC parser does `Buffer.concat()` on every chunk (potential O(n²) copying)
- **Severity:** Medium
- **File:** `src/shared/jsonrpc.js`
- **Where:** `createFramedJsonRpcParser().push()` (~L161–172), esp. ~L170
- **Problem:** `Buffer.concat([buffer, incoming])` repeatedly copies as payload grows.
- **Impact:** Lower throughput for many small incoming chunks (stdio pipes/LSP/MCP).
- **Fix:** Use chunk arrays + offsets (buffer list) and only concatenate when needed.

---

## Additional findings from extended pass

### 13) Index lock can be “stolen” from a still-running build after 30 minutes
- **Severity:** High
- **File:** `src/index/build/lock.js` (~L141–L151)
- **Problem:** If a lock exists and is “stale” by mtime (>30 min), the code can delete it *before* verifying whether the owning PID is still alive. A legitimate long-running build can lose its lock.
- **Impact:** Two builds can run concurrently against the same output/cache directories → race conditions and inconsistent artifacts.
- **Fix:** If lock is stale, also check PID liveness before deleting; or have the owner periodically refresh (touch) the lock.

---

### 14) Index lock `release()` can mark “released” even if deletion failed
- **Severity:** Medium
- **File:** `src/index/build/lock.js` (~L127–L137)
- **Problem:** `released = true` is set even if `fs.rm(lockPath)` fails; cleanup handlers are detached.
- **Impact:** Lock file can remain behind and block future builds until stale cleanup kicks in or manual deletion occurs.
- **Fix:** Only set `released = true` after successful deletion; keep cleanup active/log hard on failure.

---

### 15) `createJsonWriteStream(maxBytes)` enforces size limit **after** committing the file atomically
- **Severity:** High
- **File:** `src/shared/json-stream/streams.js` (~L67–L86)
- **Problem:** Byte counter sets `overLimit`, but the stream isn’t aborted. `replaceFile(tempPath, finalPath)` is called and then `done()` throws if overLimit.
- **Impact:** Oversized artifact may already be promoted to its final location even though the function throws (callers may assume nothing was written).
- **Fix:** Abort the pipeline immediately when maxBytes is exceeded; or at minimum check `overLimit` before `replaceFile()`.

---

### 16) Atomic replace waits for `'finish'`, not `'close'` — rename race risk on Windows
- **Severity:** Medium
- **File:** `src/shared/json-stream/streams.js` (`waitForFinish` ~L10–L13)
- **Problem:** `'finish'` can fire before the fd is closed on `fs.WriteStream`. Renames can fail if the file is still open.
- **Impact:** Intermittent failures on Windows (`EPERM`/`EBUSY`).
- **Fix:** Await `'close'` on the write stream (or ensure fd closure) before renaming.

---

### 17) Temp-file cleanup gaps on abort/error paths during JSON streaming writes
- **Severity:** Low–Medium
- **File:** `src/shared/json-stream/streams.js`
- **Problem:** Temp files may be left behind on errors prior to `replaceFile()`.
- **Impact:** Disk clutter and confusing artifacts over time.
- **Fix:** Ensure tempPath cleanup in `catch/finally` unless promoted to final.

---

### 18) Zstd stream buffering uses repeated `Buffer.concat()` in hot path
- **Severity:** Medium (performance)
- **File:** `src/shared/json-stream/compress.js` (~L88–L124, esp. ~L99)
- **Problem:** Repeated concatenations can be costly with many small input chunks.
- **Impact:** Unnecessary CPU/memory churn while compressing.
- **Fix:** Use a buffer list strategy and concatenate only when flushing.

---

### 19) Zip extraction can still be vulnerable to zip-bomb style memory spikes
- **Severity:** Medium–High (resource exhaustion)
- **File:** `tools/download-extensions.js` (~L266–L296)
- **Problem:** `entry.getData()` decompresses entries fully into memory. Declared-size limit checks don’t prevent decompression allocation spikes.
- **Impact:** Potential OOM / severe slowdown if extension zips are untrusted or compromised.
- **Fix:** Use a streaming zip reader and enforce decompressed-byte limits while streaming (plus compression ratio heuristics).

---

### 20) Git SCM annotate ignores `timeoutMs`; outer timeout wrapper can leave `git blame` running
- **Severity:** Medium–High
- **File:** `src/index/scm/providers/git.js` (~L112–L119)
- **Related:** `src/index/build/file-processor/cpu.js` (`annotateWithTimeout`)
- **Problem:** `timeoutMs` is accepted but not used by the git provider. `Promise.race` timeout doesn’t cancel the underlying blame work.
- **Impact:** Many concurrent long-running `git blame` processes can keep running after timeouts, causing CPU/disk contention and long tail latency.
- **Fix:** Use a subprocess runner with timeout + abort support; ensure process-tree kill.

---

### 21) Path-prefix checks using `.startsWith()` without boundary checks can misclassify paths
- **Severity:** Low–Medium (hardening)
- **Files:**
  - `src/index/git.js` (`filePathResolved.startsWith(baseDir)`)
  - `src/index/build/import-resolution.js` (`dir.startsWith(rootAbs)`)
- **Problem:** String prefix checks can treat `/repo2` as within `/repo`.
- **Impact:** Usually limited by call-site constraints, but can lead to incorrect relpaths/caches if a weird path enters.
- **Fix:** Use `path.relative()` and ensure it doesn’t start with `..` and isn’t absolute.

---

### 22) Incremental caching trusts `(size, mtimeMs)` too much — can miss edits on coarse timestamp FS
- **Severity:** Medium
- **File:** `src/index/build/incremental.js` (~L200–L320 range)
- **Problem:** Unchanged detection often relies on “same size and same `mtimeMs`”.
- **Impact:** On coarse timestamp filesystems or tooling that preserves timestamps, edits can be missed → cached results reused → stale index.
- **Fix:** Add content hash checks in more cases; or sample hashes when `(size,mtime)` matches; or detect coarse FS and adjust.

---

### 23) Bundle reads have no max size; corrupted/huge bundle files can OOM
- **Severity:** Medium
- **File:** `src/shared/bundle-io.js` (`readBundleFile` ~L80–L124)
- **Used by:** `src/index/build/incremental.js`, `src/storage/sqlite/build/*`
- **Problem:** Reads whole bundle into memory (`readFile`) then parses (JSON.parse/msgpack) without size checks.
- **Impact:** A huge or corrupted bundle can crash the process or cause very high memory usage.
- **Fix:** `stat()` first; enforce max bundle size; consider streaming parse for JSON if large bundles are expected.

---

### 24) Exclude-filtering builds per-chunk Sets (avoidable allocations/GC)
- **Severity:** Low
- **File:** `src/retrieval/output/filters.js` (~L140–L190)
- **Problem:** For each chunk, builds `Set`s of normalized tokens/ngrams when exclude filters are present.
- **Impact:** Higher GC pressure for large result sets.
- **Fix:** Prefer linear scan or cache normalized representations per chunk when reused.

---


## Critical / high-severity issues

### 1) Zstd decompression fallback can OOM the process (output limit is not enforced during execution)

- **Files / locations**
  - `src/shared/artifact-io/json.js`
    - `readJsonFile()` calls `decompressBuffer(...)` during JSON reads (L16–74; call at L35–39).
    - `readJsonLinesArray()` falls back to `decompressBuffer(...)` for `.jsonl.zst` if streaming zstd isn’t available (L185–204; fallback at L199–203).
    - `readJsonLinesArraySync()` also uses `decompressBuffer(...)` for compressed candidates (L279–299).
  - `src/shared/artifact-io/compression.js`
    - `zstdDecompressSync()` buffers stdin and decompresses in a child process (L17–58).
  - `src/shared/subprocess.js`
    - `spawnSubprocessSync()` uses `spawnSync()` and only trims output *after* completion (L320–395).

- **Root cause**
  - `.zst` decoding ultimately uses `zstdDecompressSync()`, which runs a child Node process and returns decompressed data via stdout.
  - In the parent, `spawnSubprocessSync()` relies on `child_process.spawnSync()`, which buffers stdout in memory without a true max-buffer cap.
  - `maxOutputBytes` is applied after-the-fact via `trimOutput()`, which cannot prevent OOM if stdout was huge.

- **Impact**
  - A malicious or accidental “decompression bomb” `.zst` artifact can crash the process (or the child) with OOM.
  - The current safety checks mostly examine **compressed size**, which does not bound decompressed size.

- **Why this is tricky**
  - The code *looks* like it enforces limits (`MAX_JSON_BYTES`, `maxOutputBytes`), but the limit is not effective for `spawnSync()`-captured output.

- **Recommended fixes**
  1) Prefer in-process streaming zstd (`createZstdDecompress`) with an inflated-bytes counter that aborts at `maxBytes` (similar to the gzip streaming path).
  2) If subprocess fallback is required, avoid `spawnSync()`; use the async `spawnSubprocess()` collector so memory is bounded while reading.
  3) In the child, avoid buffering full stdin/output; stream and enforce an output byte cap in the child too.

---

### 2) `expectedExitCodes` normalization is incorrect (string exit codes never match numeric exit codes)

- **File:** `src/shared/subprocess.js`
- **Location:** `resolveExpectedExitCodes()` (L45–56), used by `spawnSubprocess()` (L174+) and `spawnSubprocessSync()` (L331+).

- **Problem**
  - The function filters by `Number.isFinite(Number(entry))` but returns the original entries (potentially strings).
  - Later comparisons use `expectedExitCodes.includes(exitCode)` where `exitCode` is numeric, so `'0'` will not match `0`.

- **Impact**
  - Callers that pass exit codes as strings (common if values flow from CLI/env/JSON) will see false failures.

- **Fix**
  - Normalize to numbers:
    - `return value.map((v) => Math.trunc(Number(v))).filter(Number.isFinite)`

---

### 3) `spawnSubprocessSync()` drops the real cause for spawn failures (ENOENT, EACCES, etc.)

- **File:** `src/shared/subprocess.js`
- **Location:** `spawnSubprocessSync()` (L320–395).

- **Problem**
  - `spawnSync()` sets `result.error` when the process cannot be spawned.
  - The code does not check `result.error`, and instead throws a generic “exited with code unknown” `SubprocessError`.

- **Impact**
  - “Missing binary” failures become unnecessarily hard to diagnose (especially in CI).

- **Fix**
  - If `result.error` exists, throw a `SubprocessError` that wraps it (or rethrow with context), rather than reporting an “unknown exit code”.

---

## Medium-severity correctness / cross-platform reliability issues

### 4) Atomic JSON writes may rename the temp file before the file descriptor is closed (Windows/AV/FS edge cases)

- **File:** `src/shared/json-stream/streams.js`
- **Locations:**
  - `waitForFinish()` listens to `finish` (L15–18).
  - `createJsonWriteStream().done` waits for `finish` then calls `replaceFile()` (L62–69, L85–92, L106–113).

- **Problem**
  - `finish` means all data has been flushed to the writable stream, but **does not guarantee** the fd is closed.
  - Renaming an open file is unreliable on Windows and can fail intermittently with `EPERM`/`EBUSY`.

- **Fix**
  - For the final `fs.createWriteStream(...)`, await `close` (or use `pipeline()` and await its callback), then rename.

---

### 5) `replaceSqliteDatabase()` deletes WAL/SHM sidecars unconditionally (risky if WAL still contains needed pages)

- **File:** `src/storage/sqlite/utils.js`
- **Location:** `replaceSqliteDatabase()` (L146–206); sidecar cleanup at L166–168.

- **Risk**
  - If WAL contains committed-but-not-checkpointed data (or another process has an open connection), deleting WAL/SHM can corrupt or lose data.

- **Mitigation / fix ideas**
  - Ensure all writers checkpoint and close before replacement.
  - Consider moving sidecar cleanup until after successful replacement (or skipping it unless explicitly requested).

---

## Performance / memory issues that become big in real workloads

### 6) `createFflateGzipStream()` needlessly copies every incoming Buffer chunk

- **File:** `src/shared/json-stream/compress.js`
- **Location:** `createFflateGzipStream()` transform (L28–55); `Buffer.from(chunk)` copy at L34–35.

- **Impact**
  - For large JSON streams, this doubles memory traffic and increases GC pressure.

- **Fix**
  - Use `Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)`.

---

### 7) `createZstdStream()` repeatedly `Buffer.concat()`s pending data (can approach quadratic copying with many small writes)

- **File:** `src/shared/json-stream/compress.js`
- **Location:** `pending = Buffer.concat([pending, buffer])` (L99).

- **Impact**
  - Many small writes → repeated copies of the pending buffer.

- **Fix**
  - Accumulate chunks in an array and concat only when you have ≥ `chunkSize` (or use a small ring buffer).

---

### 8) JSONL sync reader cache never hits when only the compressed form exists

- **File:** `src/shared/artifact-io/json.js`
- **Location:** `readJsonLinesArraySync()` (L262–349)
  - Cache lookup uses `readCache(filePath)` (L266–270).
  - Cache write uses `writeCache(targetPath, parsed)` (L296–297).

- **Problem**
  - If `filePath` doesn’t exist and only `filePath.gz` / `filePath.zst` exists, `readCache(filePath)` always misses because it stats `filePath`.
  - The parsed result is cached under the candidate path, but never consulted on subsequent calls.

- **Fix**
  - Cache using the resolved candidate path (or cache under both keys).

---

### 9) SQLite compaction disk-space estimate is likely too low for `VACUUM` in worst cases

- **File:** `tools/compact-sqlite-index.js`
- **Locations:**
  - required bytes computation (L87–93)
  - `outDb.exec('VACUUM')` (L444)

- **Risk**
  - `VACUUM` often needs temporary space roughly comparable to the DB size (sometimes more), depending on SQLite and temp-store configuration.

- **Fix**
  - Increase the estimate (often ~2× DB size worst-case), or make it configurable and document the requirement.

---
