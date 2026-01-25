# Codebase Static Review Findings — Tools & Bench/Build Utilities (Pass 7)

This report is a focused static review of **tooling scripts** and **bench harnesses** (under `tools/`) plus the lightweight API server helpers used by integrations. The emphasis is on **correctness**, **scaling/throughput**, **artifact/index invariants**, and **operational safety** (avoiding foot-guns in scripts that delete, download, or rebuild large artifacts).

All file references are relative to the repo root.

## Scope

Files reviewed (as requested):

### API server utilities
- `tools/api/response.js`
- `tools/api/sse.js`
- `tools/api/validation.js`
- `tools/api-server.js`
- `tools/assemble-pieces.js`

### Bench harness (language)
- `tools/bench/language/cli.js`
- `tools/bench/language/config.js`
- `tools/bench/language/locks.js`
- `tools/bench/language/metrics.js`
- `tools/bench/language/process.js`
- `tools/bench/language/progress/parse.js`
- `tools/bench/language/progress/render.js`
- `tools/bench/language/progress/state.js`
- `tools/bench/language/report.js`
- `tools/bench/language/repos.js`

### Bench harness (micro + wrappers)
- `tools/bench/micro/compression.js`
- `tools/bench/micro/extractors.js`
- `tools/bench/micro/hash.js`
- `tools/bench/micro/index-build.js`
- `tools/bench/micro/regex.js`
- `tools/bench/micro/run.js`
- `tools/bench/micro/search.js`
- `tools/bench/micro/tinybench.js`
- `tools/bench/micro/utils.js`
- `tools/bench/micro/watch.js`
- `tools/bench-dict-seg.js`
- `tools/bench-language-matrix.js`
- `tools/bench-language-repos.js`
- `tools/bench-query-generator.js`

### Bootstrap + embedding build tools
- `tools/bootstrap.js`
- `tools/build-embeddings.js`
- `tools/build-embeddings/atomic.js`
- `tools/build-embeddings/cache.js`
- `tools/build-embeddings/chunks.js`
- `tools/build-embeddings/cli.js`
- `tools/build-embeddings/embed.js`
- `tools/build-embeddings/hnsw.js`
- `tools/build-embeddings/lancedb.js`
- `tools/build-embeddings/manifest.js`
- `tools/build-embeddings/run.js`
- `tools/build-embeddings/sqlite-dense.js`

### Index build/export tools
- `tools/build-lmdb-index.js`
- `tools/build-sqlite-index.js`
- `tools/build-sqlite-index/cli.js`
- `tools/build-sqlite-index/index-state.js`
- `tools/build-sqlite-index/run.js`
- `tools/build-sqlite-index/temp-path.js`
- `tools/build-tantivy-index.js`

### Maintenance + CI + config inventory tools
- `tools/cache-gc.js`
- `tools/check-env-usage.js`
- `tools/ci-build-artifacts.js`
- `tools/ci-restore-artifacts.js`
- `tools/clean-artifacts.js`
- `tools/cli-utils.js`
- `tools/combined-summary.js`
- `tools/compact-pieces.js`
- `tools/compact-sqlite-index.js`
- `tools/compare-models.js`
- `tools/config-dump.js`
- `tools/config-inventory.js`
- `tools/ctags-ingest.js`
- `tools/default-config-template.js`
- `tools/default-config.js`
- `tools/download-dicts.js`
- `tools/download-extensions.js`
- `tools/download-models.js`

## Severity Key

- **Critical**: likely to cause incorrect results, crashes, corrupted artifacts, or major production breakage (or a high-risk foot-gun).
- **High**: significant correctness/quality risk, major perf hazard, or security foot-gun.
- **Medium**: correctness edge cases, meaningful perf waste, confusing UX, or latent scaling hazards.
- **Low**: minor issues, maintainability concerns, or polish.

---

## Executive Summary

- **[Critical] `download-extensions.js` downloads archives into RAM and lacks hard download-size limits.** The current `requestUrl()` buffers the full response body (`Buffer.concat`) and then writes it to disk. With a 200MB archive limit (and no enforced response limit), this can OOM on modest CI runners and is easy to regress. It also omits timeouts and backpressure considerations. See §4.1.

- **[Critical] `build-lmdb-index.js` does not configure LMDB map size, so real indexes will likely fail with `MDB_MAP_FULL`.** The script opens LMDB with defaults and then writes multi-megabyte (or gigabyte) artifacts into a single environment. This will not scale past toy repos without explicit `mapSize` planning. See §3.3.

- **[High] Bench process runner likely buffers unlimited stdout/stderr in memory.** `tools/bench/language/process.js` uses `execa()` with piped streams but does not disable buffering (`buffer: false`) or set `maxBuffer`. For verbose index builds, this can exhaust memory and distort benchmark results. See §2.1.

- **[High] LanceDB embedding export dequantizes using default params, which can silently corrupt vectors if quantization is configured.** `tools/build-embeddings/lancedb.js` calls `dequantizeUint8ToFloat32(vec)` without passing the active `{minVal,maxVal,levels}`. This is inconsistent with `build-embeddings/run.js` and can yield incorrect ANN behavior. See §3.2.

- **[High] HNSW vector normalization is inconsistent between “fresh build” vs “cache load”.** `build-embeddings/embed.js` normalizes merged vectors unconditionally before feeding HNSW, while `build-embeddings/run.js` normalizes only when `hnswConfig.space === 'cosine'`. This creates metric-dependent correctness drift. See §3.1.

- **[Medium] Multiple tools mis-detect index state by checking only `chunk_meta.json` and ignoring `chunk_meta.parts/` + JSONL/manifest forms.** This creates false “index missing” errors and unnecessary rebuilds on large repos where the code intentionally shards artifacts. See §1.4, §2.4, §5.1.

---

## 1) API Server Utilities

### 1.1 **[High]** `download-extensions`-style memory risk pattern also exists in SSE “write ordering” (interleaving)

**Where**
- `tools/api/sse.js:53–58`

**What’s wrong**
- `sendEvent()` performs two separate writes (`event:` then `data:`) with awaits.
- If a caller triggers multiple `sendEvent()` calls concurrently, writes can interleave and corrupt event framing:
  - `event: A` → `event: B` → `data: ...A...` → `data: ...B...`

**Why this matters**
- Streaming APIs tend to evolve toward higher concurrency; this is a fragile contract to leave implicit.
- When it fails, it fails nondeterministically and is painful to debug.

**Suggested fix direction**
- Serialize writes inside the responder (simple promise chain/queue), or explicitly document the requirement that callers must `await sendEvent()` sequentially.
- Consider adding `sendComment()` keep-alives / `retry:` and optional `id:` support (not required for correctness, but improves clients).

**Tests to add**
- A unit/integration test that calls `sendEvent()` concurrently and asserts the output stream remains well-formed (or asserts that an internal queue exists).

---

### 1.2 **[Medium]** API search request schema is likely to drift from CLI/options; “additionalProperties: false” makes drift break clients

**Where**
- `tools/api/validation.js`

**What’s wrong**
- The schema hard-codes many enum lists and field shapes (e.g., `format`, `ranker`, `backend`, graph options).
- With `additionalProperties: false`, any new client field will be rejected even if the server could safely ignore it.

**Why this matters**
- The project is rapidly evolving; strict request validation tends to “break forward-compatibility” unless versioned.
- Drift between CLI defaults/options and API defaults/options is already a recurring theme in the repo.

**Suggested fix direction**
- Introduce explicit API versioning (`/v1/search`, `schemaVersion`) and allow “unknown-but-ignored” fields in request bodies unless they are known-dangerous.
- Generate the schema from the same central option registry used by CLI (or import the relevant option definitions) so the contract stays aligned.

**Tests to add**
- Contract tests that compare a small set of canonical CLI option sets to API request shapes.
- A forward-compat test that adds an unknown field and asserts it is either ignored (with warning) or rejected with a clear “unknown field” list.

---

### 1.3 **[Medium]** `api-server.js` has sharp edges around host/CORS/auth combinations

**Where**
- `tools/api-server.js:63–134`

**What’s wrong**
- Default host is `127.0.0.1`, which is safe-ish. But if the operator binds to `0.0.0.0` (or another non-loopback) and forgets `--auth`, the server:
  - Enables permissive CORS (`Access-Control-Allow-Origin: *`),
  - Exposes repo search/index access to any network client.

**Why this matters**
- This is an “operator foot-gun” that can unintentionally expose source code search and metadata to a network.

**Suggested fix direction**
- If host is not loopback, require `--auth` (or require explicit `--insecure-no-auth`).
- Restrict CORS by default (no wildcard) unless explicitly requested.
- Consider binding to loopback by default even if host is omitted.

**Tests to add**
- A small integration test verifying non-loopback host requires auth (or at least logs a prominent warning).

---

### 1.4 **[Low/Medium]** `assemble-pieces.js` deletes output dirs with minimal guardrails

**Where**
- `tools/assemble-pieces.js:17–30`

**What’s wrong**
- `--out` is user-controlled. The script unconditionally `rm(outDir, { recursive: true, force: true })` before writing.
- There is no “is this path safe” check (e.g., refuse `/`, refuse repo root, refuse home).

**Why this matters**
- Tool scripts get copy/pasted in CI. One typo in `--out` can delete the wrong directory tree.

**Suggested fix direction**
- Add a conservative safety check (similar to `isRootPath()` patterns elsewhere):
  - Refuse empty path / filesystem root.
  - Refuse deleting a directory outside a known cache root unless `--force`.
- Print a “deleting: <path>” confirmation unless `--yes` in interactive contexts.

---

## 2) Bench Harness

### 2.1 **[High]** `execa()` output buffering likely causes OOM and invalid benchmark results

**Where**
- `tools/bench/language/process.js:45–52`

**What’s wrong**
- `execa(command, args, { stdout: 'pipe', stderr: 'pipe' })` buffers stdout/stderr by default.
- Although listeners are attached, execa can still accumulate output into internal buffers unless `buffer: false` (or `maxBuffer`) is set.

**Why this matters**
- Indexing can emit huge logs in verbose modes, and a benchmark harness must be resilient to that.
- If buffering triggers memory pressure, your benchmark measures GC thrash and OOM behavior, not indexing throughput.

**Suggested fix direction**
- Set `buffer: false` (preferred) and/or set an explicit `maxBuffer` sized for expected output.
- Write raw output to log files (already done) and treat execa as a streaming subprocess wrapper.

**Tests to add**
- A stress test that pipes a large amount of output through `runProcess()` and verifies memory does not explode (can be a lightweight unit test using a child process that prints many lines).

---

### 2.2 **[Medium]** Lock semantics are “best effort” and can misbehave under PID reuse / cross-machine caches

**Where**
- `tools/bench/language/locks.js`

**What’s wrong**
- Stale lock determination is based on:
  - `pid` liveness (`process.kill(pid, 0)`),
  - mtime age threshold.
- PID reuse can lead to false “alive” results.
- The lock path is inside cache roots; copying caches between machines can leave stale locks with PIDs that coincidentally exist.

**Why this matters**
- Bench tooling is often run by CI agents that reuse workspaces and caches.
- A stale lock can block runs indefinitely (wait mode) or cause confusing failures.

**Suggested fix direction**
- Store additional lock metadata: hostname, start timestamp, command line.
- Treat mismatched hostname as stale immediately.
- Add a hard maximum wait duration (even in wait mode) with a clear error.

---

### 2.3 **[Medium]** Bench progress parsing is coupled to log text formats (high drift risk)

**Where**
- `tools/bench/language/progress/parse.js`
- `tools/bench/language/progress/render.js`

**What’s wrong**
- The bench harness infers state using regex patterns against human-oriented log lines (e.g., “Indexed file …”, “Line …”).
- This is brittle; minor log wording changes break progress tracking and “rate” calculations.

**Why this matters**
- The repo already has a structured progress/events system (see other passes). Bench harness should consume a stable machine-readable stream.

**Suggested fix direction**
- Switch to structured progress events emitted as JSON lines (you already have `progress-events` in shared) and reserve regex parsing as a fallback.

**Tests to add**
- Golden tests for the parser given a representative set of progress event lines.
- A “structured-first” test that verifies the harness continues to work even if human log wording changes.

---

### 2.4 **[Medium]** Several bench scripts assume `chunk_meta.json` exists and ignore sharded/meta+parts layouts

**Where**
- `tools/bench/language/repos.js: needsIndexArtifacts()`
- `tools/bench/micro/run.js` (index existence checks)
- `tools/bench/micro/tinybench.js` (indexDir resolution)

**What’s wrong**
- Index existence is checked via:
  - `fs.existsSync(path.join(indexDir, 'chunk_meta.json'))`
- The core indexer can emit:
  - `chunk_meta.jsonl`, `chunk_meta.meta.json`, `chunk_meta.parts/`
- Bench scripts can falsely rebuild or falsely declare “missing index”.

**Why this matters**
- Large repos are exactly where you need benchmarks the most; those are also the repos that tend to use sharded artifacts.

**Suggested fix direction**
- Centralize “artifact presence” checks in a single helper and import it.
- Prefer `src/shared/artifact-io.js` helpers rather than duplicating filesystem checks in tools.

**Tests to add**
- A fixture index directory containing only `chunk_meta.parts/` and verify “index exists” logic passes.

---


### 2.5 **[Medium]** `bench-query-generator.js` likely under-collects return types (field name drift)

**Where**
- `tools/bench-query-generator.js:~56–71` — `c.docmeta?.returnType || c.metaV2?.returns`

**What’s wrong**
- Several language extractors (notably C-like) commonly emit return types under `docmeta.returns` rather than `docmeta.returnType` (this drift was already noted elsewhere in the repo).
- The generator therefore misses many valid return types and produces a narrower query distribution than intended.

**Why this matters**
- Bench/query generation influences ranking evaluation; missing return types biases the benchmark set toward simpler queries.

**Suggested fix direction**
- Accept both shapes:
  - `c.docmeta?.returnType || c.docmeta?.returns || c.metaV2?.returnType || c.metaV2?.returns`
- For `metaV2.returns` that is structured (not a string), normalize to a stable string representation before `formatQueryValue()`.

**Tests to add**
- A fixture `chunk_meta` row with `docmeta.returns` and ensure generator emits `returnType:` queries.


## 3) Embeddings & Index Export Tools

### 3.1 **[High]** HNSW vector normalization semantics differ depending on cache path

**Where**
- `tools/build-embeddings/embed.js:95–99` (always normalizes merged vectors before `addHnswVector`)
- `tools/build-embeddings/run.js:510–520` (only normalizes dequantized vectors for cosine space)

**What’s wrong**
- When embeddings are computed fresh:
  - merged vectors are normalized and fed into HNSW *unconditionally*.
- When embeddings are loaded from cache:
  - vectors are dequantized and normalized *conditionally* (`space === 'cosine'`).

**Why this matters**
- This produces different ANN geometry depending on whether a file hit cache:
  - L2 / inner-product HNSW can become silently wrong if vectors are normalized unexpectedly.
- It also makes perf/correctness comparisons nondeterministic across runs.

**Suggested fix direction**
- Make “vector normalization for HNSW” a single policy:
  - Either normalize always and force `space: 'cosine'` (or document that other spaces are unsupported),
  - Or normalize only when `space === 'cosine'` in both code paths.
- Unit test: build one vector, write cache, reload, ensure float vectors fed into HNSW are identical.

---

### 3.2 **[High]** LanceDB export dequantizes with default params, risking incorrect float vectors

**Where**
- `tools/build-embeddings/lancedb.js:43–55`

**What’s wrong**
- `dequantizeUint8ToFloat32(vec)` is called without passing quantization parameters.
- `build-embeddings/run.js` supports configurable quantization via `resolveQuantizationParams()` and passes those params to dequantization elsewhere.

**Why this matters**
- Any change to quantization range/levels will silently corrupt the LanceDB embedding table.
- This can manifest as “LanceDB backend is bad” when it’s actually bad dequantization.

**Suggested fix direction**
- Thread the active quantization params into `writeLanceDbIndex()` and pass them to `dequantizeUint8ToFloat32`.
- Add a cross-backend invariance test: quantize→dequantize in LanceDB path must match SQLite/HNSW path.

---

### 3.3 **[Critical]** LMDB builder likely fails on real data due to missing `mapSize` planning

**Where**
- `tools/build-lmdb-index.js:265` — `open({ path: targetPath, readOnly: false })`

**What’s wrong**
- LMDB requires a pre-sized memory map (`mapSize`). Defaults are typically small.
- This tool stores large artifacts (chunk meta, postings, vectors) in LMDB without configuring `mapSize`.
- Expect `MDB_MAP_FULL` on non-trivial repos.

**Why this matters**
- This makes LMDB support effectively unusable for intended workloads.
- Failures are late (after doing lots of work) and can appear nondeterministic based on repo size.

**Suggested fix direction**
- Compute a required map size from artifact byte sizes (you already compute sizes in other tools), then:
  - `open({ mapSize, ... })`
- Optionally allow `--map-size-mb` override.
- Consider storing large artifacts in separate named databases or as external blob files referenced by LMDB keys.

**Tests to add**
- A test that builds an LMDB index from a fixture with a moderately large postings payload and asserts it succeeds with the computed map size.

---

### 3.4 **[Medium]** Build-embeddings preflight cache scan can become the dominant cost

**Where**
- `tools/build-embeddings/run.js` — “cached dims detection” pass that iterates all cache files and parses JSON

**What’s wrong**
- When `configuredDims` is not provided, the tool scans all `*.json` in cacheDir and `JSON.parse()`s them to infer dims.
- On large repos with many files, cacheDir can be enormous; this becomes a startup tax.

**Why this matters**
- It directly conflicts with the “high throughput streaming pipeline” goal—preflight is doing large random reads before any useful work begins.

**Suggested fix direction**
- Store a small `cache.meta.json` file at cache root containing dims + identityKey + model id; update it atomically.
- Avoid parsing per-file caches on startup.

---

### 3.5 **[Medium]** SQLite dense writer deletes ANN table without a mode filter (verify intended isolation)

**Where**
- `tools/build-embeddings/sqlite-dense.js:114–140`

**What’s wrong**
- The script deletes all rows from `dense_vectors_ann` with `DELETE FROM <annTable>` (no `WHERE mode = ...`).
- This is likely okay if each sqlite file is per-mode, but it is brittle if schemas evolve to store multiple modes in one DB.

**Suggested fix direction**
- Either:
  - Encode mode into the ANN table name (explicit isolation), or
  - Ensure ANN table includes a mode column and delete by mode.

---

### 3.6 **[Medium]** Tantivy builder does not support sharded/huge artifacts the way core build does

**Where**
- `tools/build-tantivy-index.js`

**What’s wrong**
- It loads `chunk_meta` and `token_postings` directly into memory with `loadChunkMeta` / `loadTokenPostings`.
- It does not attempt to read:
  - `chunk_meta.parts/`,
  - postings shards,
  - incremental bundles.

**Why this matters**
- Tantivy export will fail or become unusable on exactly the repos where you need it most.

**Suggested fix direction**
- Mirror the “pieces-first” strategy used in `build-sqlite-index/run.js`.
- If Tantivy builder is meant to be “small repo only”, document that hard constraint.

---


### 3.7 **[High]** `build-sqlite-index` “index presence” logic is too permissive and can fall through to null inputs

**Where**
- `tools/build-sqlite-index/run.js:260–273` — `hasIndex = (index, pieces, incremental) => !!(index || pieces || incremental?.manifest)`
- `tools/build-sqlite-index/run.js:310–358` — selects “bundles vs artifacts” based on manifest *existence* and file count, not on bundle availability.

**What’s wrong**
- An incremental manifest file existing on disk counts as “index exists”, even if:
  - it is empty,
  - it refers to bundles that were cleaned,
  - the corresponding `chunk_meta` (json or parts) is missing.
- In these states, `runMode()` can be invoked with `index === null` and `pieces === null`, and still attempt a build path that expects artifacts.

**Why this matters**
- This creates confusing operator experience:
  - “index exists” passes the early guard,
  - then later build steps fail with less actionable errors.
- It also increases the chance of “partial state” bugs during incremental indexing experiments.

**Suggested fix direction**
- Tighten `hasIndex()` to validate that at least one usable source exists:
  - `index != null`, or
  - `pieces != null`, or
  - `manifest.files` non-empty **and** the referenced bundle directory exists **and** at least one bundle file exists.
- When `--incremental` is requested, fail fast with a clear message if the manifest exists but bundles are missing.

**Tests to add**
- Fixture directories that contain:
  1) manifest exists, no bundles, no chunk_meta ⇒ must fail fast with “incremental manifest present but bundles missing”
  2) chunk_meta.parts exists, no chunk_meta.json ⇒ must still succeed
  3) bundles exist but chunk_meta too large ⇒ must succeed without loading chunk_meta.json


### 3.8 **[Medium]** `build-sqlite-index` compaction flag handling appears drifted (config branch is effectively dead)

**Where**
- `tools/build-sqlite-index/cli.js` — `compact` option defaults to `true`
- `tools/build-sqlite-index/run.js` — `const compactFlag = argv.compact === true ? true : argv.compact === false ? false : Boolean(userConfig.storage?.sqlite?.compact || false);`

**What’s wrong**
- Because CLI defaults `argv.compact` to `true`, the “use config value” branch is never taken.
- This is not necessarily wrong (maybe “always compact” is desired), but the code implies a three-way precedence model that cannot occur.

**Why this matters**
- This is a classic “config mess” symptom: the source of truth becomes unclear.
- Operators may believe `storage.sqlite.compact=false` will change behavior; it won’t unless they also pass `--no-compact`.

**Suggested fix direction**
- Decide the intended model:
  - If compaction is always-on by default: remove the config branch entirely and document `--no-compact`.
  - If config should control: set CLI default to `undefined` and let config decide unless user explicitly sets a flag.

**Tests to add**
- Precedence test: config false + no flag ⇒ expected behavior (compact or not) should be deterministic and asserted.


## 4) Download/Bootstrap & External Assets

### 4.1 **[Critical]** `download-extensions.js` buffers large downloads in memory and does not enforce response size/timeouts

**Where**
- `tools/download-extensions.js:494–517` — collects chunks and `Buffer.concat()`
- `tools/download-extensions.js:601–603` — writes full buffer to disk

**What’s wrong**
- Archives can be large; the script accumulates the entire response body in RAM.
- There is no “maxBytes” check on download itself (limits exist for extraction, not for response).
- There is no request timeout, so a stalled connection can hang CI.

**Why this matters**
- OOM/timeout failures in CI are hard to diagnose and wasteful.
- The tool is part of dependency acquisition; if it is flaky, everything is flaky.

**Suggested fix direction**
- Stream downloads directly to a temp file:
  - `res.pipe(fileStream)` with backpressure-aware `pipeline()`.
  - Hash while streaming (crypto hash update per chunk) and enforce maxBytes while streaming.
- Add timeouts on socket and overall request.

**Tests to add**
- A test server that serves an over-limit response and verifies the downloader aborts early.
- A test that simulates a slow/stalled response and verifies timeout behavior.

---

### 4.2 **[Medium]** `download-dicts.js` does not handle write backpressure

**Where**
- `tools/download-dicts.js` — `out.write(chunk)` without awaiting drain

**What’s wrong**
- For large dicts (or slow disks), ignoring backpressure can spike memory.

**Suggested fix direction**
- Switch to `pipeline(res, out)` for streaming writes (and make maxBytes enforcement streaming-aware).

---

### 4.3 **[Medium]** `download-models.js` treats non-existent target directories as file paths (surprising UX)

**Where**
- `tools/download-models.js:89–101`

**What’s wrong**
- If `--onnx-target` points to a directory that does not exist yet, the script treats it as a *file* target because `statSync` fails.
- This is surprising; many tools accept a directory path and create it.

**Suggested fix direction**
- If `--onnx-target` ends with path separator or has no file extension, treat it as a directory and `mkdirp`.
- Or add `--onnx-target-dir` explicitly.

---

### 4.4 **[Low/Medium]** `bootstrap.js` chains many scripts but does not propagate repo/index-root consistently

**Where**
- `tools/bootstrap.js`

**What’s wrong**
- Some commands rely on `cwd` implicit resolution; others pass `--root`.
- In a codebase with multiple index roots/config layers, “implicit cwd” is an avoidable ambiguity.

**Suggested fix direction**
- Pass `--repo <root>` and (when relevant) `--index-root <...>` explicitly to every tool invoked by bootstrap.

---

## 5) Maintenance, CI, Config Inventory

### 5.1 **[High]** Several tools resolve index dirs inconsistently (indexRoot propagation drift)

**Where**
- `tools/ci-build-artifacts.js`
- `tools/ci-restore-artifacts.js`
- `tools/combined-summary.js`
- `tools/bench/micro/*` (`getIndexDir(repoRoot, mode)` without config/indexRoot context)

**What’s wrong**
- Some tools call `getIndexDir(root, mode, userConfig, { indexRoot })`.
- Others call `getIndexDir(root, mode)` or omit `{ indexRoot }`.
- This makes tools disagree on where index artifacts “should” be, especially with non-default config.

**Why this matters**
- CI pipelines become non-reproducible: one tool builds to one location, another tool packages from a different location.

**Suggested fix direction**
- Standardize: every tool accepts `--repo` and `--index-root` and passes those through to shared helpers.
- Create a single helper `resolvePaths({repoRoot,indexRoot,userConfig})` and import it everywhere.

---

### 5.2 **[Medium]** `cache-gc.js` uses directory mtime as “last used” (likely incorrect)

**Where**
- `tools/cache-gc.js:52–86` (mtime-based recency)

**What’s wrong**
- Reading from a cache does not update directory mtime; writes do.
- A cache can be “hot” (read frequently) and still appear old and get deleted.

**Suggested fix direction**
- Maintain an explicit `last_access.json` marker updated by retrieval/index load paths.
- GC should consult that marker rather than filesystem mtime.

---

### 5.3 **[Medium]** `check-env-usage.js` misses many env access patterns

**Where**
- `tools/check-env-usage.js`

**What’s wrong**
- Only matches `process.env.PAIROFCLEATS_...` dot accesses in `.js` files.
- Misses bracket accesses (`process.env['PAIROFCLEATS_X']`), destructuring, indirection, `.mjs`, `.cjs`, `.ts`.

**Suggested fix direction**
- Either:
  - Use a real parser (babel/esbuild) to find env accesses, or
  - Expand regex coverage and file extensions and treat output as “best effort”.

---

### 5.4 **[Medium]** `ctags-ingest.js` ignores stream backpressure when writing JSONL

**Where**
- `tools/ctags-ingest.js:97–118` — `writeStream.write(...)` in a tight loop

**What’s wrong**
- For large tagsets, the write stream can apply backpressure; ignoring it can balloon memory.

**Suggested fix direction**
- When `writeStream.write()` returns false, `await once(writeStream, 'drain')`.

---

### 5.5 **[Low/Medium]** `config-inventory.js` is heuristic and can misparse modern JS syntax

**Where**
- `tools/config-inventory.js`

**What’s wrong**
- It does not use an AST parser. It uses regex + brace matching. This will be fooled by:
  - template strings containing braces,
  - nested object literals in strings,
  - JS with newer syntax forms.

**Suggested fix direction**
- Treat it explicitly as “best effort”, or switch to a parser-based approach (even esbuild parse) for robustness.

---


### 5.6 **[Medium]** `compact-pieces.js` can accidentally de-stream compressed shards (OOM risk on large pieces)

**Where**
- `tools/compact-pieces.js` — `readJsonLinesFile()` chooses `readJsonLinesArray()` for `.gz` / `.zst`

**What’s wrong**
- For compressed JSONL parts, the compactor appears to fall back to a helper that loads the full decompressed content into memory.
- This undermines the whole reason you shard: to keep peak memory bounded.

**Why this matters**
- The compactor is supposed to improve throughput and reduce overhead. If it rehydrates shards into RAM, it becomes a scaling cliff.

**Suggested fix direction**
- Implement streaming decompression for `.gz` and `.zst` inputs (pipe through decompressor + readline parser).
- Keep the memory model: “bounded per line”.

**Tests to add**
- A compressed JSONL part with many lines; assert the compactor does not exceed a small memory ceiling (can be approximated by running under a low `--max-old-space-size` in CI for this test only).


### 5.7 **[Medium]** `compact-sqlite-index.js` assumes `token_postings.doc_id` maps to `chunks.id` (verify invariant)

**Where**
- `tools/compact-sqlite-index.js` — `docIdMap.set(row.id, nextDocId)` and then rewrites postings doc ids via that map.

**What’s wrong**
- The compactor assumes a stable identity relation between:
  - `chunks.id` (the primary key read from the SQLite DB), and
  - `token_postings.doc_id` (stored postings doc id).
- If the actual invariant is `doc_id == chunks.rowid` or `doc_id == chunkIndex` rather than `chunks.id`, compaction will silently corrupt search results.

**Why this matters**
- This is correctness-critical and can be hard to detect; searches will “work” but return wrong documents.

**Suggested fix direction**
- Verify the invariant against the authoritative schema:
  - If `token_postings.doc_id` references `chunks.id`, document it and add an assertion in the compactor.
  - If it references `rowid`, use `rowid` explicitly.
  - If it references `chunkIndex`, rewrite based on a stable `chunk_id` → new id map instead.
- Add a post-compaction validation query: pick a token, ensure it returns the same chunk IDs before vs after.

**Tests to add**
- A fixture DB with known postings → chunk mapping; run compaction; assert query equivalence.


## Coverage Notes and “No Material Defect” Files

The following files were reviewed and did not show correctness hazards beyond minor polish/ergonomics:

- `tools/api/response.js` (simple JSON helpers)
- `tools/bench/language/config.js` (JSONC loader)
- `tools/bench/micro/*` modules are generally acceptable for microbench usage, with the main caveat being **index-dir resolution drift** (§5.1) and **index existence checks that ignore sharded artifacts** (§2.4).
- `tools/default-config-template.js` / `tools/default-config.js` are largely policy decisions rather than correctness code; the main risk is **drift from actual schema/behavior** (ongoing theme).

---

## Recommended Next Refactors (Tooling Layer)

These are not code changes—just the “what” and “why” implied by the findings above.

1. **Centralize “index path + artifact presence” resolution for tools.**
   - Single helper that answers: “Where is index X? Does it exist? In what form (json / parts / bundles)?”
   - Remove bespoke `existsSync(chunk_meta.json)` checks.

2. **Adopt a standard streaming pattern for downloads and JSONL writes.**
   - Use `pipeline()` end-to-end.
   - Enforce maxBytes and timeouts during streaming, not after buffering.

3. **Make quantization/normalization policy explicit and shared.**
   - One module defines: merge strategy, normalization rules, and backend export dequantization.

4. **Add a small suite of tool-level regression tests.**
   - These can be fixtures (small index dirs) + node scripts in CI that validate:
     - “tools detect sharded artifacts”
     - “downloaders enforce limits”
     - “embedding exports agree on dims/quantization”
     - “LMDB build computes mapSize”

