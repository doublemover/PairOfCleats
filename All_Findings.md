# PairOfCleats — Master Consolidated Static Review Findings (All Reviews & Re-reviews)

This file combines **all** findings from:
- the original A→O review,
- subsequent targeted re-reviews,
- and conversation follow-ups.

---

## Part 1 — Original A→O review (baseline)

# PairOfCleats — Consolidated Static Review Findings (Sections A–O)

> **Method:** Static read-through (no execution). Findings focus on correctness bugs, subsystem conflicts, incomplete implementations, resource/memory leaks (especially in long-lived processes), and tricky edge cases.
>
> **Format:** Each section includes a severity bucket list. Each finding includes the **primary file(s)** where the issue occurs.

---

## A) Entry points, command routing, UX surfaces

### Critical / High
- **`pairofcleats index --help` does not show help; it dispatches into an index build.**  
  Files: `bin/pairofcleats.js`
- **CLI router backend allowlist is out of sync with supported backends (conflicts with core and editor integrations).**  
  Files: `bin/pairofcleats.js`, `src/storage/backend-policy.js`, `sublime/PairOfCleats/lib/config.py`
- **Router allowlist validation blocks real flags supported by subcommands (setup/bootstrap/api server), causing “help shows options you can’t use”.**  
  Files: `bin/pairofcleats.js`, `tools/setup/setup.js`, `tools/setup/bootstrap.js`, `tools/api/server.js`
- **`search.js` help/version detection ignores `--` end-of-options sentinel (breaks searching for literal `--help`, etc.).**  
  Files: `search.js`
- **VS Code extension uses `async` callback in `execFile` and can produce unhandled promise rejections + unresolved progress UI.**  
  Files: `extensions/vscode/extension.js`
- **VS Code extension swallows `{ok:false}` JSON payloads as “no results” (hides real CLI errors).**  
  Files: `extensions/vscode/extension.js`, `src/retrieval/cli.js` (JSON error contract)
- **Sublime plugin calls a CLI subcommand that doesn’t exist (`config dump`).**  
  Files: `sublime/PairOfCleats/lib/indexing.py`, `bin/pairofcleats.js`, `tools/config/dump.js` (exists but not routed)

### Medium
- **CLI router’s `readFlagValue()` does not stop at `--`, which can misinterpret query literals as flags.**  
  Files: `bin/pairofcleats.js`
- **`validateArgs()` accepts empty values like `--repo=` without error, leading to confusing fallback behavior.**  
  Files: `bin/pairofcleats.js`
- **VS Code uses VS Code’s embedded Node (`process.execPath`) to run repo-local `.js` CLI, which can violate project Node engine requirement.**  
  Files: `extensions/vscode/extension.js`, `package.json`
- **Sublime subprocess runner accumulates unbounded output in memory (`output_lines` list).**  
  Files: `sublime/PairOfCleats/lib/runner.py`
- **Multi-root workspace handling chooses the first workspace folder by default.**  
  Files: `extensions/vscode/extension.js`

### Low
- **Help/version stream inconsistencies (stderr vs stdout).**  
  Files: `bin/pairofcleats.js`, `search.js`

---

## B) Configuration, policy, runtime envelope

### Critical / High
- **Normalization drops large parts of schema-supported config, making many “valid” config keys have no runtime effect (search tuning, tooling cache/vfs options, indexing concurrency, etc.).**  
  Files: `tools/dict-utils/config.js`, `docs/config/schema.json`, `src/shared/runtime-envelope.js`, `src/retrieval/cli/normalize-options.js`
- **Schema/docs/code conflict: `cache.runtime` is referenced in code/specs but rejected by schema.**  
  Files: `tools/dict-utils/config.js`, `docs/config/schema.json`, `docs/specs/import-resolution.md`
- **Prototype pollution risk in deep merge (`__proto__`, `constructor`, `prototype` keys not guarded).**  
  Files: `src/shared/config.js`

### Medium
- **Validator caching likely ineffective due to schema being parsed into new objects each call.**  
  Files: `tools/dict-utils/config.js`, `src/config/validate.js`
- **Optional dependency detection uses `process.cwd()` and may misreport install state.**  
  Files: `src/shared/optional-deps.js`
- **Thread sizing bug: `procConcurrency` effectively capped at 4 due to redundant `Math.min` chain.**  
  Files: `src/shared/threads.js`
- **Repo stats scan (`scanRepoStats`) may not close directory handles explicitly on early break.**  
  Files: `src/shared/auto-policy.js`

### Low
- **Env boolean parsing is strict/case-sensitive.**  
  Files: `src/shared/env.js`
- **JSDoc type mismatches in runtime envelope helpers.**  
  Files: `src/shared/runtime-envelope.js`

---

## C) Index build orchestrator (stages, lifecycle, locks, promotion)

### Critical / High
- **Build runtime not torn down if lock acquisition fails (“Index lock unavailable” path leaks resources).**  
  Files: `src/integrations/core/build-index/stages.js`
- **Index lock installs SIGINT/SIGTERM handlers that call `process.exit()`, undermining graceful abort and cleanup logic in callers.**  
  Files: `src/index/build/lock.js`
- **Build ID collision risk due to timestamp formatting (milliseconds removed).**  
  Files: `src/index/build/runtime/config.js`, `src/index/build/runtime/runtime.js`
- **Debounced patch merge is shallow for `progress`, which can drop nested progress keys.**  
  Files: `src/index/build/build-state.js`
- **Build-state module uses module-level Maps that never prune; risk in watch/service scenarios (soft memory leak).**  
  Files: `src/index/build/build-state.js`

### Medium
- **Handle close not in `finally` after lock file creation; potential fd leak on error.**  
  Files: `src/index/build/lock.js`
- **Delta-log writes are fire-and-forget and can race with rotation, losing ordering.**  
  Files: `src/index/build/build-state.js`
- **Queue dir coupling: stage2 background jobs use embeddings queue dir config (surprising/brittle).**  
  Files: `src/integrations/core/build-index/index.js`
- **Promotion safety checks use case-sensitive `startsWith` and can misbehave on Windows/macOS.**  
  Files: `src/index/build/promotion.js`

---

## D) File discovery, preprocessing, ignore rules, incremental/watch

### Critical / High
- **Watch mode hard failure: `normalizeRoot` is referenced but not defined/imported.**  
  Files: `src/index/build/watch.js`
- **Watch attempts retention can grow unbounded on repeated failures (memory + disk leak).**  
  Files: `src/index/build/watch/attempts.js`
- **Minified detection differs between cold discovery and watch classification, producing inconsistent indexing across time.**  
  Files: `src/index/build/discover.js`, `src/index/build/watch.js`

### Medium
- **Ignore “inside root” checks use `startsWith` and are case-sensitive; false “outside root” on Windows/macOS.**  
  Files: `src/index/build/ignore.js`, `src/index/build/discover.js`
- **Potential symlink traversal depends on crawler behavior; skip is at accept-time, not necessarily traversal-time.**  
  Files: `src/index/build/discover.js`
- **Line counting may be off-by-one for files ending with newline (borderline file caps).**  
  Files: `src/shared/file-stats.js`

---

## E) Language frontends: parsing/chunking/imports/relations, tree-sitter

### High
- **Tree-sitter token classification can leak `Tree` objects on early returns and doesn’t `reset()` parser consistently.**  
  Files: `src/index/build/tokenization.js`
- **Per-file timing arrays can grow unbounded in large repos / long-lived processes.**  
  Files: `src/index/build/indexer/steps/process-files.js`

### Medium
- **Best-effort empty catches in analysis pipelines can hide operational failures (needs debug logging or metrics).**  
  Files: various under `src/index/*`, `src/lang/*`

### Low
- **Dead/meaningless condition in shard runtime destroy (`baseWorkerPools` comparison never true).**  
  Files: `src/index/build/indexer/steps/process-files/runtime.js`

---

## F) Tokenization, postings, filter indexes

### Critical / High
- **Packed postings varint decode uses 32-bit bitwise ops; can corrupt larger varints.**  
  Files: `src/shared/packed-postings.js`
- **Packed postings can allocate huge arrays on corrupt buffers (`new Array(count)` with no plausibility checks).**  
  Files: `src/shared/packed-postings.js`
- **Delta encoding clamps negative deltas to 0, silently masking ordering bugs and corrupting postings.**  
  Files: `src/shared/packed-postings.js`
- **Phrase separator mismatch (`\u0001` vs `_`) in fallback logic can break exclude/range inference paths.**  
  Files: `src/shared/tokenize.js`, `src/index/build/state.js`, `src/retrieval/pipeline/candidates.js`, `src/retrieval/output/filters.js`
- **File prefilter uses sentinel-wrapped trigrams; can be over-restrictive and can produce false negatives for substring/regex literal prefiltering.**  
  Files: `src/shared/tokenize.js`, `src/retrieval/filter-index.js`, `src/retrieval/output/filters/file-prefilter.js`
- **Postings merge/normalize can preserve duplicates (sorted lists returned early; boundary duplicates introduced).**  
  Files: `src/index/build/postings.js`

### Medium
- **Filter-index build hard-fails when chunk language metadata is missing; brittle for partial/legacy meta.**  
  Files: `src/retrieval/filter-index.js`
- **Token-ID collisions detected but not mitigated (rare but catastrophic correctness if hit).**  
  Files: `src/index/build/state.js`
- **Offsets decoding ignores trailing bytes; corruption may be masked.**  
  Files: `src/shared/packed-postings.js`, `src/shared/artifact-io/offsets.js`

---

## G) Enrichment features: types, risk, lint/complexity, structural ingestion, triage/records

### High
- **Cross-file risk severity ranking ignores `critical`, causing under-reporting / failed propagation.**  
  Files: `src/index/type-inference-crossfile/pipeline.js`
- **Interprocedural risk can waste budget in cycles (visited key includes depth; no strong cycle guard).**  
  Files: `src/index/risk-interprocedural/engine.js`
- **Cross-file file text caches can retain many full file contents simultaneously (memory spike risk).**  
  Files: `src/index/type-inference-crossfile/pipeline.js`
- **Structural matches ingestion can hard-fail on malformed results; should degrade gracefully.**  
  Files: `src/index/structural.js`

### Medium
- **Call summary dedupe ignores args/callsite and can discard valuable inference evidence.**  
  Files: `src/index/type-inference-crossfile/pipeline.js`
- **Type inference candidate explosion risk (no caps on union parts/object keys).**  
  Files: `src/index/type-inference.js`
- **ESLint integration can silently degrade to “no lint” with limited observability.**  
  Files: `src/index/analysis.js`

### Low
- **Minor duplication/typo-like issues in default value normalizer.**  
  Files: `src/index/type-inference.js`

---

## H) Artifact I/O, schemas/contracts, compatibility

### High
- **Module-level “warned/validated” Sets/Maps can grow without bound in long-lived processes (soft memory leak).**  
  Files: `src/shared/artifact-io/loaders.js`, `src/shared/artifact-io/manifest.js`
- **Offsets readers ignore trailing bytes; corruption may be silently accepted.**  
  Files: `src/shared/artifact-io/offsets.js`
- **Decompression limit allows >maxBytes by a small margin; safety boundary inconsistent.**  
  Files: `src/shared/artifact-io/compression.js`

### Medium
- **Index presence checks miss compressed artifact variants; can mis-detect indexes as missing.**  
  Files: `src/storage/sqlite/utils.js`, `tools/build/tantivy-index.js`, `tools/build/lmdb-index.js`

---

## I) Storage backends (SQLite / LMDB / Tantivy) + maintenance

### Critical / High
- **SQLite compaction tool is schema-incompatible and likely unusable: inserts a non-existent `mode` column into `chunks_fts` and drops `metaV2_json`, breaking runtime loader.**  
  Files: `tools/build/compact-sqlite-index.js`, `src/storage/sqlite/schema.js`, `src/retrieval/sqlite-helpers.js`
- **SQLite replacement can delete a live DB without creating a fresh backup if a stale backup already exists.**  
  Files: `src/storage/sqlite/utils.js`
- **SQLite build runner installs per-invocation `process.once('exit')` listener (leak in repeated builds).**  
  Files: `src/storage/sqlite/build/runner.js`
- **LMDB build clears DB before writing without atomic swap; interruption can wipe the store.**  
  Files: `tools/build/lmdb-index.js`

### Medium
- **Temp SQLite build failure cleanup can leave sidecar `-wal/-shm` files.**  
  Files: `src/storage/sqlite/build/runner.js`, `src/storage/sqlite/utils.js`
- **Vector ANN query path swallows errors entirely (silent ANN failure).**  
  Files: `tools/sqlite/vector-extension.js`
- **LMDB map size estimation is fragile; no retry on `MDB_MAP_FULL`.**  
  Files: `tools/build/lmdb-index.js`
- **Tantivy handle cache has no close/eviction; leaks handles/memory in long-lived processes.**  
  Files: `src/retrieval/sparse/providers/tantivy.js`

---

## J) Retrieval/search engine (query → candidates → sparse/dense rank → fusion → output)

### Critical / High
- **SQLite FTS bm25 weight construction is misaligned with actual `chunks_fts` columns (extra leading weight), shifting all weights and likely ignoring the final weight.**  
  Files: `src/retrieval/fts.js`, `src/storage/sqlite/schema.js`
- **Tantivy sparse provider appears not exposed via CLI normalization (feature exists but may be unreachable without additional plumbing).**  
  Files: `src/retrieval/pipeline.js`, `src/retrieval/cli-args.js`, `src/retrieval/cli/normalize-options.js`, `src/retrieval/cli/resolve-run-config.js`
- **Bitmap → Set conversion can explode memory (allowed set converted eagerly when candidateSet is null).**  
  Files: `src/retrieval/pipeline.js`
- **Query-plan cache size accounting differs from persistence format (pretty JSON on disk exceeds trimmed estimate).**  
  Files: `src/retrieval/query-plan-cache.js`

### Medium
- **SQLite FTS token safety filter excludes punctuation-heavy code tokens, reducing recall.**  
  Files: `src/retrieval/sqlite-helpers.js`
- **Options normalization drift: some values accepted in one place but normalized differently elsewhere.**  
  Files: `src/retrieval/pipeline/graph-ranking.js`, `src/retrieval/cli/normalize-options.js`

---

## K) Embeddings + ANN infrastructure

### Critical / High
- **(Cross-cutting with J) Candidate-set type contract inconsistencies between pipeline and ANN providers (Set vs bitmap-like), especially in fallback paths.**  
  Files: `src/retrieval/pipeline.js`, `src/retrieval/ann/providers/*`
- **LanceDB connection cache retains rejected promises (transient failure becomes sticky until restart).**  
  Files: `src/retrieval/lancedb.js`
- **Embedding adapters mutate global `@xenova/transformers` env cacheDir; multi-dir/model scenarios can interfere.**  
  Files: `src/shared/embedding-adapter.js`, `src/shared/onnx-embeddings.js`

### Medium
- **HNSW build holds all vectors in memory before building (OOM risk on large repos).**  
  Files: `tools/build/embeddings/hnsw.js`, `src/shared/hnsw.js`
- **ANN error swallowing makes “dense is broken” indistinguishable from “no results”.**  
  Files: `tools/sqlite/vector-extension.js`, some provider paths under `src/retrieval/ann/providers/*`

---

## L) Graph subsystem + analyses (neighborhood, impact, architecture, suggest-tests)

### Critical / High
- **CSR loader non-strict “repair” can corrupt adjacency if nodes are reordered without remapping edges.**  
  Files: `src/shared/artifact-io/graph.js`
- **Symbol seed traversal is broken (symbolEdges traversal does not enqueue chunk neighbors; edges can reference missing nodes).**  
  Files: `src/graph/neighborhood.js`
- **Witness path edges can violate schema for symbolEdges due to storing candidate refs without `type`.**  
  Files: `src/graph/neighborhood.js`, schema: `src/contracts/schemas/analysis.js`
- **GraphIndex mismatch check is by object identity; can drop CSR/cache optimizations even for semantically identical inputs.**  
  Files: `src/graph/neighborhood.js`

### Medium
- **Call-site evidence can be missed in inbound traversal due to edge orientation vs evidence keying.**  
  Files: `src/graph/neighborhood.js`, `src/graph/indexes.js`
- **Unbounded cache: compiled architecture rule cache grows without limit.**  
  Files: `src/graph/architecture.js`
- **Reverse CSR caching can double memory footprint with no eviction.**  
  Files: `src/graph/neighborhood.js`
- **Edge window merge is O(n·W); heap-based k-way merge would be faster.**  
  Files: `src/graph/neighborhood.js`
- **`suggest-tests` stores full trail arrays per visited node (O(N²) potential).**  
  Files: `src/graph/suggest-tests.js`

### Low
- **Unused/unfinished prefix table utilities.**  
  Files: `src/graph/store.js`, `src/graph/indexes.js`

---

## M) Context packs (assembly, streaming/non-streaming, graph/type slices)

### Critical / High
- **File descriptor leak risk (`if (fd)` doesn’t close fd=0).**  
  Files: `src/context-pack/assemble.js`, `src/shared/files.js`
- **Non-streaming assembly builds chunk index without `repoRoot`, causing normalization inconsistencies.**  
  Files: `src/context-pack/assemble.js`
- **Repo boundary check does not defend against symlink escapes (local file disclosure risk).**  
  Files: `src/context-pack/assemble.js`
- **Schema issues: `primary.range` can contain null fields, and `primary.ref` fallback is invalid (`chunkUid:null`).**  
  Files: `src/context-pack/assemble.js`, schema: `src/contracts/schemas/analysis.js`

### Medium
- **Excerpt truncation can be misreported when reads are clamped by `maxBytes` before slicing (warnings suppressed).**  
  Files: `src/context-pack/assemble.js`
- **Streaming seed resolution scans `chunk_uid_map` linearly; repeated requests scale poorly without indexing/caching.**  
  Files: `src/context-pack/assemble.js`
- **`includeRisk` is explicitly stubbed (returns empty flows with a warning; easy to misinterpret as “no risk”).**  
  Files: `src/context-pack/assemble.js`
- **Context-pack CLI loads all graphs when includeGraph is enabled; may load heavy symbol_edges/call_sites unnecessarily.**  
  Files: `src/integrations/tooling/context-pack.js`

---

## N) Service layer: HTTP API + MCP + indexer service

### HTTP API (`tools/api/*`)

#### Critical / High
- **Request schema and arg mapping diverge: schema defines `path`/`file`, router reads `paths`, and router uses `filter` which schema disallows; filters can be broken or impossible to express.**  
  Files: `tools/api/validation.js`, `tools/api/router/search.js`
- **SSE shutdown can hang indefinitely because `server.close()` waits for long-lived connections; no socket/SSE termination.**  
  Files: `tools/api/server.js`, `tools/api/router/search.js` (stream), `tools/api/router/status.js` (stream)

#### Medium
- **Body size exceeded does not destroy/pause request; continues consuming data.**  
  Files: `tools/api/router/body.js`
- **Build pointer parse errors can leave stale caches in place.**  
  Files: `tools/api/router/cache.js`

### MCP (`tools/mcp/*`)

#### High
- **Cancellation only works for in-flight requests, not queued requests (queued cancels are ignored).**  
  Files: `tools/mcp/transport.js`

### Indexer service (`tools/service/*`)

#### High
- **Queue writes are not atomic; corruption can silently drop jobs.**  
  Files: `tools/service/queue.js`
- **Stale job requeue logic is stage-limited; some running jobs can become stuck forever.**  
  Files: `tools/service/queue.js`
- **Locking can wedge if PID is alive but lock is stale/hung; timeout is short and fixed.**  
  Files: `tools/service/queue.js`
- **Subprocess logs captured fully in memory (no explicit max), OOM risk on noisy builds.**  
  Files: `tools/service/indexer-service.js`

#### Medium
- **Queue file growth and frequent heartbeat rewrites increase IO/lock contention over time.**  
  Files: `tools/service/queue.js`
- **Repo branch enforcement after clone is incomplete; pull may not track configured branch.**  
  Files: `tools/service/repos.js`

---

## O) Tooling, benchmarks, tests

### Medium
- **Contract/placeholder tests indicate unimplemented modules (CDC segments, VFS variants). Risk: “green suite” may overstate coverage if placeholders are not clearly skipped/segregated.**  
  Files: `tests/unit/segments/segment-cdc.contract.test.js`, `tests/unit/vfs/vfs-*.contract.test.js`
- **Test runner timeout kill path can still hang if process-tree kill fails; no secondary watchdog.**  
  Files: `tests/runner/run-execution.js`
- **Widespread “capture everything into memory” pattern in tooling scripts (bench/service helpers) can OOM on large output.**  
  Files: various under `tools/*` (e.g., `tools/bench/*`, `tools/service/indexer-service.js`)

### Low
- **CI-lite placeholder test exists; ensure meaningful smoke tests are added to that lane over time.**  
  Files: `tests/ci-lite/placeholder.test.js`

---

## Notes on completeness

- Sections **A–N** above compile findings previously produced across the conversation for all subsystems.  
- Section **O** is inherently broader; it focuses on patterns and the most obvious placeholder coverage gaps visible in the repository.

---

## Suggested “global” follow-ups (cross-cutting)

If you’re prioritizing fixes for maximum leverage, these are the top cross-cutting repairs:

1. **Schema drift cleanup:** align SQLite FTS schema ↔ FTS weights ↔ compaction tool ↔ loader requirements.  
   Files: `src/storage/sqlite/schema.js`, `src/retrieval/fts.js`, `tools/build/compact-sqlite-index.js`, `src/retrieval/sqlite-helpers.js`
2. **Stop “process.exit()” from library primitives:** remove signal-based hard exits from lock + improve service shutdown.  
   Files: `src/index/build/lock.js`, `tools/api/server.js`
3. **Fix API schema vs router mapping:** ensure HTTP API is a faithful wrapper around CLI/MCP semantics.  
   Files: `tools/api/validation.js`, `tools/api/router/search.js`, `tools/mcp/tools/search-args.js`
4. **Eliminate correctness footguns in packed postings and file prefiltering.**  
   Files: `src/shared/packed-postings.js`, `src/retrieval/output/filters/file-prefilter.js`
5. **Add bounded caches + atomic writes in long-lived services.**  
   Files: `tools/service/queue.js`, `src/graph/architecture.js`, `src/graph/neighborhood.js`, `src/shared/artifact-io/*`



---

## Part 2 — Re-review findings documents (as generated during follow-ups)

### Part 2A — Additional findings (Sections C & E)

# PairOfCleats — Additional Static Review Findings (Sections C & E)

This document contains **new** findings from a second-pass static review of:
- **Section C** (index build orchestration / lifecycle / background worker/service plumbing)
- **Section E** (language frontends: imports/relations + chunking)

Previously reported items in Sections C/E are intentionally **omitted** here.

---

## Section C — Index build orchestration (additional findings)

### High severity

#### C-H1: Queue persistence is non-atomic; parse errors silently drop queued jobs
**Files**
- `tools/service/queue.js`

**Evidence**
- `readJson()` returns a fallback value on *any* JSON parse error (jobs are lost): `tools/service/queue.js:L7-L13`
- Queue state is saved with `fs.writeFile(...)` directly (no temp + rename): `tools/service/queue.js:L120-L123`

**Why this is a problem**
- A partial write (crash, power loss, SIGKILL, disk-full, etc.) can corrupt `queue.json`.
- On the next read, the corruption path returns `{ jobs: [] }` and the service proceeds as if the queue is empty, effectively **dropping outstanding work** with no hard failure.

**Suggested fix**
- Write queue state **atomically**:
  - write to `queue.json.tmp` (or include a PID/nonce), `fsync` if practical, then `rename`/`replace`.
- On parse failure, prefer **failing loudly** or attempting recovery:
  - keep the corrupted file (rename to `.corrupt.<timestamp>`), and refuse to proceed unless explicitly told to reset.

---

#### C-H2: `spawnSubprocess` schedules a delayed SIGKILL that is not canceled; PID reuse can kill unrelated processes
**Files**
- `src/shared/subprocess.js`

**Evidence**
- `killProcessTree()` always schedules a SIGKILL after `killGraceMs` and does not cancel it if the child exits quickly: `src/shared/subprocess.js:L144-L159`

**Why this is a problem**
- If the target process group exits quickly after SIGTERM, the delayed SIGKILL still fires.
- On busy systems, **PID reuse** within the grace window is possible; a later process group with the same PID could receive SIGKILL unintentionally.

**Suggested fix**
- Track the timeout handle and **clearTimeout** it on `child.once('close'|'exit')`.
- Optionally, before sending SIGKILL, re-check liveness (best-effort) and/or only SIGKILL if the original child is still running.

---

### Medium severity

#### C-M1: Two-stage background Stage2 can ignore `options.modes` (array) and run “all modes” unexpectedly
**Files**
- `src/integrations/core/build-index/index.js`
- `src/integrations/core/args.js`

**Evidence**
- `buildIndex()` supports `options.modes` and uses it for in-process stage execution: `src/integrations/core/build-index/index.js:L45-L61`
- But `buildStage2Args()` only propagates `argv.mode` (single string) to Stage2, and omits `--mode` when it is `all`: `src/integrations/core/args.js:L33-L36`
- In the two-stage **background** path, Stage2 is launched using these args: `src/integrations/core/build-index/index.js:L261-L279`

**Why this is a problem**
- If a programmatic caller uses `options.modes = ['code']` (or any subset) without setting `options.mode`, Stage1 runs that subset, but Stage2 background may run **all** modes.
- That can cause:
  - surprising extra work (time/cost),
  - output directories created for modes the caller explicitly did not request,
  - or mismatches if Stage1/Stage2 assumptions diverge.

**Suggested fix**
- When `options.modes` is provided and background Stage2 is enabled:
  - either **disable background Stage2** automatically (fallback to in-process Stage2), or
  - extend Stage2 invocation to accept a multi-mode argument (e.g., repeated `--mode` flags or a new `--modes=code,prose`).

---

#### C-M2: Stage2 background failures can be effectively silent (no success handshake + non-zero exit not surfaced)
**Files**
- `src/integrations/core/build-index/index.js`

**Evidence**
- Stage2 is spawned detached/unref’d and the returned promise is not awaited: `src/integrations/core/build-index/index.js:L261-L279`
- Spawn uses `rejectOnNonZeroExit: false`, so a non-zero exit does not reject: `src/integrations/core/build-index/index.js:L266-L278`

**Why this is a problem**
- If Stage2 dies quickly (config error, missing permissions, runtime crash), Stage1 will still return `background: true`.
- There is no handshake (“Stage2 started successfully”) and no best-effort reporting of early non-zero exit.

**Suggested fix**
- Consider a “started” handshake:
  - Stage2 writes a small `stage2.started` file, or updates build state, once initialization succeeds.
- If you keep `rejectOnNonZeroExit: false`, attach a `.then(...)` to log non-zero exits (best-effort) when the parent stays alive long enough.

---

#### C-M3: Indexer service spawns `build_index` while buffering full stdout/stderr in memory
**Files**
- `tools/service/indexer-service.js`

**Evidence**
- `spawnWithLog()` uses `captureStdout: true`, `captureStderr: true`, `outputMode: 'string'`: `tools/service/indexer-service.js:L216-L236`

**Why this is a problem**
- For large repos, `build_index` output can be substantial; capturing it fully can lead to:
  - elevated memory usage,
  - potential OOM termination in the daemon/service.

**Suggested fix**
- Stream stdout/stderr directly to a log file (or rotating logs) instead of buffering:
  - pipe child streams into `fs.createWriteStream`,
  - optionally keep a bounded tail in memory for quick diagnostics.

---

#### C-M4: `buildIndex` does not validate `mode` / `modes` inputs before feeding them into stage execution
**Files**
- `src/integrations/core/build-index/index.js`
- `src/integrations/core/build-index/stages.js`

**Evidence**
- `requestedModes` is accepted as-is; `mode` is accepted as-is: `src/integrations/core/build-index/index.js:L45-L61`
- `runStage` iterates `modes` directly and passes `modeItem` into `buildIndexForMode`: `src/integrations/core/build-index/stages.js:L443-L465`

**Why this is a problem**
- For CLI usage, argument parsing likely constrains values, but for **programmatic callers** (or config mistakes), invalid mode strings can:
  - trigger late failures deep in indexing,
  - create odd directory layouts,
  - or lead to misleading partial results.

**Suggested fix**
- Validate early in `buildIndex()`:
  - allowed set: `code`, `prose`, `extracted-prose`, `records`, `all`
  - dedupe + normalize casing
  - hard-fail with a clear error if invalid.

---

### Low severity

#### C-L1: Dict signature normalization uses case-sensitive path prefix checks
**Files**
- `src/index/build/runtime/normalize.js`

**Evidence**
- `startsWith()` checks against `repoRoot` and `dictDir` are case-sensitive: `src/index/build/runtime/normalize.js:L16-L28`

**Why this is a problem**
- On case-insensitive file systems (Windows/macOS default), the same path can appear with different casing across runs or call sites.
- A case-sensitive prefix check can fail spuriously, producing an **absolute** signature path rather than a stable relative one, which can change cache keys / signatures unexpectedly.

**Suggested fix**
- Normalize casing when the platform is case-insensitive (or compare using `path.relative(...)` style checks).
- Or explicitly document that `dictFile` must be passed with canonical casing (hard to guarantee).

---

## Section E — Language frontends (imports/relations + chunking) (additional findings)

### High severity

#### E-H1: `normalizeRelPath` corrupts paths beginning with `..` and can collapse out-of-root specifiers into in-root candidates
**Files**
- `src/index/build/import-resolution.js`

**Evidence**
- `normalizeRelPath()` strips a leading `.` even when the path begins with `..`: `src/index/build/import-resolution.js:L41-L43`

```js
// Current behavior:
"../foo".replace(/^\.\/?/, "")   // => "./foo"
"../../bar".replace(/^\.\/?/, "") // => "./../bar"
```

**Why this is a problem**
- Any resolution path that temporarily produces a candidate like `../something` can be transformed into `./something` (and then into `something` after subsequent normalization).
- In practice, this can produce **false-positive resolutions** by matching a real in-root file when the intended path actually escapes the root.

**Suggested fix**
- Only strip a *true* leading `"./"` prefix, not a single dot:
  - replace `replace(/^\.\/?/, '')` with `replace(/^\.\//, '')`
  - or `if (value.startsWith('./')) value = value.slice(2)`
- Add unit tests covering:
  - `'../x'`, `'../../x'`, `'./x'`, `'.'`, and `'..'`.

---

### Medium severity

#### E-M1: Python import extraction misses relative imports (`from .foo import bar`, `from .. import baz`)
**Files**
- `src/lang/python/imports.js`

**Evidence**
- `fromRegex` only matches module names made of `[A-Za-z0-9_\.]` and therefore excludes leading dots: `src/lang/python/imports.js:L6-L8`

**Why this is a problem**
- Relative imports are extremely common in Python packages.
- Missing them reduces correctness of import graphs and any downstream “relations” features that depend on import edges.

**Suggested fix**
- Expand the grammar to include leading dots and the special-case `from . import x` form.
  - Example: `^\s*from\s+(\.*[A-Za-z0-9_\.]+|\.+)\s+import\s+(.+)$`
- Consider ignoring imports inside multiline strings/docstrings (optional improvement).

---

#### E-M2: Case-collision handling in import resolution is nondeterministic (first-wins)
**Files**
- `src/index/build/import-resolution.js`

**Evidence**
- A lowercased lookup map is populated on a first-wins basis: `src/index/build/import-resolution.js:L111-L123`

**Why this is a problem**
- In repos that contain both `Foo.js` and `foo.js` (valid on Linux), resolution via `fileLower` can pick an arbitrary target based on input ordering.
- Even if you consider such repos “unsupported” on Windows/macOS, *nondeterminism* can leak into Linux builds/tests.

**Suggested fix**
- Detect collisions when populating `fileLower` and:
  - emit a warning with both paths, and/or
  - store a list and force an “ambiguous” resolution rather than silently picking one.
- Alternatively, only use case-folded lookup on case-insensitive platforms.

---

#### E-M3: Import-resolution cache writes are non-atomic; corruption triggers full cache loss
**Files**
- `src/index/build/import-resolution-cache.js`

**Evidence**
- Cache writes use a direct `fs.writeFile(...)`: `src/index/build/import-resolution-cache.js:L44-L49`
- Load failures drop back to an empty cache: `src/index/build/import-resolution-cache.js:L17-L27`

**Why this is a problem**
- A partial write can wipe the cache on the next run, increasing compute cost and adding noise to performance baselines.
- While “cache loss” is not correctness-critical, it can cause hard-to-reproduce perf regressions.

**Suggested fix**
- Use an atomic write strategy (temp + rename) similar to build-state’s atomic writers.

---

#### E-M4: Byte-based chunk splitting may be expensive for large files (repeated substring + `byteLength` in binary search)
**Files**
- `src/index/chunking/limits.js`

**Evidence**
- `resolveByteBoundary()` binary-searches using `Buffer.byteLength(text.slice(...))` per step: `src/index/chunking/limits.js:L66-L79`

**Why this is a problem**
- For large chunks, `text.slice(...)` + `byteLength(...)` is repeated O(log n) times per split.
- With small `maxBytes`, this can devolve into noticeable overhead (and potentially O(n log n) behavior).

**Suggested fix**
- Consider precomputing a UTF-8 byte offset map for the string once per file (or using `TextEncoder` on the whole string) and then slicing by byte boundary more directly.
- At minimum, add microbenchmarks to quantify impact on worst-case inputs.

---

### Low severity

#### E-L1: GitHub Actions YAML chunker assumes 2-space indentation for `jobs`
**Files**
- `src/index/chunking/formats/yaml.js`

**Evidence**
- Job key extraction requires exactly two leading spaces: `src/index/chunking/formats/yaml.js:L40-L44`

**Why this is a problem**
- YAML is indentation-sensitive but does not require 2-space indents; valid workflows using different indentation can be under-chunked (single giant chunk).

**Suggested fix**
- Track the indentation level of `jobs:` dynamically and accept consistent indentation beneath it (e.g., capture leading spaces in the `jobs:` line and require “indent + 2+” for job entries).

---


---

### Part 2B — Additional findings (Sections C, E, G, H, J)

# PairOfCleats — Additional Static Review Findings (Sections C, E, G, H, J)

This document contains **new** issues found during a second-pass static review of **Sections C, E, G, H, and J**, intentionally **excluding** items already listed in the prior A→O findings document.

> Scope note: These are *static* findings (read-only analysis). No dynamic execution, fuzzing, or runtime profiling was performed here.

---

## Section C — Build Orchestration & Incremental Indexing (additional findings)

### C.1 Incremental cache resets can leak orphan bundle files (disk bloat, confusing state)
- **Severity:** High  
- **Files:**
  - `src/index/build/incremental.js` (reset logic)  
    - `loadIncrementalState()` lines **75–126**  
  - `src/index/build/incremental.js` (prune logic)  
    - `pruneIncrementalManifest()` lines **409–438**
- **What’s happening**
  - When the incremental manifest is deemed incompatible (signature mismatch / tokenization key mismatch / etc.), `loadIncrementalState()` **replaces the in-memory manifest** with a fresh empty manifest.
  - However, it **does not delete** any previously written bundle files on disk.
  - Later pruning (`pruneIncrementalManifest`) only deletes bundles referenced in the manifest that are not in `seenFiles`; if the manifest was reset to empty, the prior bundles are **not referenced** and thus will **never be pruned**.
- **Why this matters**
  - Over time (especially across frequent rebuilds / config changes), the incremental cache directory can grow without bound.
  - A corrupted manifest (see C.2/C.3) makes this worse: cache silently “resets” while old bundles remain forever.
- **Suggested fix**
  - When reset is triggered, perform an explicit cleanup:
    - safest: `rm -rf <incrementalDir>/bundles` (and optionally `shards`) + rewrite manifest atomically; or
    - conservative: move the old incremental dir to a timestamped quarantine and create a new one.

---

### C.2 Incremental manifest read failures are silently swallowed (hard to diagnose, can cause repeated resets)
- **Severity:** Medium  
- **File:** `src/index/build/incremental.js`  
  - `loadIncrementalState()` lines **121–128**
- **What’s happening**
  - Manifest read/parse errors are swallowed by an empty `catch {}`; no log, no cleanup.
- **Why this matters**
  - Corruption or partial writes produce confusing behavior (cache never reuses, old bundles linger).
  - Operators lose a key debugging signal.
- **Suggested fix**
  - Log once per process (or per build root) when manifest parsing fails, and rename the bad file to `.corrupt.<ts>.json` (or similar) so future runs don’t repeatedly hit the same failure.

---

### C.3 Non-atomic incremental manifest writes (risk of corruption on crash/interruption)
- **Severity:** Medium  
- **File:** `src/index/build/incremental.js`  
  - `pruneIncrementalManifest()` lines **425–438**
- **What’s happening**
  - The manifest is written via `fs.writeFile(...)` directly to its final path.
- **Why this matters**
  - Any crash, SIGKILL, or power-loss mid-write can corrupt the manifest, triggering silent parse failures (C.2) and disk leaks (C.1).
- **Suggested fix**
  - Write to `manifest.json.tmp`, `fsync`, then `rename` to `manifest.json` (atomic on most platforms).
  - Optionally keep a `.bak` of the previous manifest.

---

### C.4 Misleading reuse-failure reason text (“manifest missing entries” is backwards)
- **Severity:** Low  
- **File:** `src/index/build/incremental.js`  
  - `shouldReuseIncrementalIndex()` lines **198–201**
- **What’s happening**
  - The check detects: *manifest has an entry that is not in the current `entries` set* (i.e., the repo no longer contains a file that the manifest still has).
  - The failure reason returned is `"manifest missing entries"` which reads like the opposite direction.
- **Why this matters**
  - Confusing diagnostics slow debugging when incremental reuse is unexpectedly disabled.
- **Suggested fix**
  - Rename reason to something like `"manifest contains removed files"` or `"entry list missing manifest file"`.

---

### C.5 Import-resolution cache persistence is non-atomic and self-healing is weak
- **Severity:** Medium  
- **File:** `src/index/build/import-resolution-cache.js`
  - `saveImportResolutionCache()` lines **91–97**
  - `loadImportResolutionCache()` lines **12–38**
- **What’s happening**
  - Cache JSON writes are non-atomic, and parse failures don’t remove/rename the corrupted file.
- **Why this matters**
  - Once corrupted, subsequent builds will repeatedly log a load failure and revert to an empty cache, losing the intended speedup.
- **Suggested fix**
  - Same atomic-write pattern as C.3, plus: on JSON parse failure, rename to `.corrupt` and start fresh.

---

## Section E — Language Frontends & Tree-sitter (additional findings)

### E.1 Tree-sitter chunk cache key selection can create cross-file cache collisions (catastrophic if configured)
- **Severity:** High  
- **File:** `src/index/build/file-processor/cpu.js`  
  - tree-sitter cache key selection lines **184–197**
- **What’s happening**
  - The per-file cache key is selected as:  
    `treeSitterCacheKey = treeSitterConfig?.cacheKey ?? fileHash ?? null`
  - If a user sets `indexing.treeSitter.cacheKey` in config (and it is not unique per file), that value **overrides** `fileHash`.
  - `buildTreeSitterChunks()` caches by **(languageId + cacheKey + signature)**; if cacheKey is reused across files, chunk boundaries from one file can be reused for a different file.
- **Why this matters**
  - This is a correctness landmine: wrong chunks → wrong embeddings/tokenization → wrong search results.
  - Also very difficult to trace, because it only occurs when the config knob is set.
- **Suggested fix**
  - Treat config cacheKey as a **seed**, not a replacement:
    - e.g., `treeSitterCacheKey = fileHash ? `${treeSitterConfig.cacheKey}:${fileHash}` : treeSitterConfig.cacheKey`
  - Or rename config field to `cacheSeed` to make intent explicit.

---

### E.2 Tree-sitter wasm load failure metric can be double-counted
- **Severity:** Low  
- **Files:**
  - `src/lang/tree-sitter/runtime.js`
    - `initTreeSitterWasm()` lines **268–279**
    - `loadWasmLanguage()` lines **332–336**
- **What’s happening**
  - `initTreeSitterWasm()` increments `wasmLoadFailures` on error.
  - `loadWasmLanguage()` increments the same metric again when init returns `false`.
- **Why this matters**
  - Inflates failure metrics and can distort operational dashboards or automated fallbacks.
- **Suggested fix**
  - Only count in one layer (preferably in `loadWasmLanguage`), or gate the second bump based on whether the failure already counted.

---

### E.3 Tree-sitter initialization failures are “sticky” (no retry without process restart)
- **Severity:** Medium  
- **File:** `src/lang/tree-sitter/runtime.js`
  - `initTreeSitterWasm()` lines **250–253**
- **What’s happening**
  - Once `treeSitterInitError` is set, future calls immediately return `false` and never retry initialization.
- **Why this matters**
  - A transient failure (temporary FS or permission issue) can permanently disable tree-sitter until restart.
- **Suggested fix**
  - Consider retry-once semantics, or allow reset after a cooldown / explicit call.

---

### E.4 TypeScript heuristic accessor regex misses `get foo()` methods
- **Severity:** Medium  
- **File:** `src/lang/typescript/chunks-heuristic.js`
  - `methodRe` definition lines **148–152**
- **What’s happening**
  - The optional accessor prefix is `(?:get|set\s+)?`.
  - `get` in real code is `get <name>()`, i.e. it requires whitespace, but the regex does not.
  - Result: `get foo()` will typically **not match** and won’t be chunked in heuristic mode.
- **Why this matters**
  - Lower chunk coverage on fallback paths → reduced recall/quality when tree-sitter/AST parsing is disabled or fails.
- **Suggested fix**
  - Change to `(?:get\s+|set\s+)?`.

---

### E.5 `byLanguage` overrides are case-sensitive to resolved language ids
- **Severity:** Low  
- **File:** `src/lang/tree-sitter/chunking.js`
  - `selectChunkingQuery()` lines **277–283**
- **What’s happening**
  - Lookup is `config.byLanguage?.[resolvedId]`, with `resolvedId` lowercased.
  - User config keys like `"JavaScript"` won’t match.
- **Suggested fix**
  - Normalize `byLanguage` keys to lowercase during config normalization.

---

## Section G — Enrichment (Risk, Type Inference, Analysis) (additional findings)

### G.1 Risk analyzer splits into full `lines[]` before enforcing max-bytes cap
- **Severity:** Medium  
- **File:** `src/index/risk.js`
  - `analyzeTextForRules()` lines **232–241**
- **What’s happening**
  - It performs `const lines = text.split(/\r?\n/);` before checking `caps.maxBytes`.
- **Why this matters**
  - For very large files, this creates a large temporary array and many substrings even if the file is immediately rejected for size.
- **Suggested fix**
  - Check `maxBytes` before splitting.
  - If line counting is needed, count newlines with a streaming scan (or early-stop scanning at maxLines).

---

### G.2 Interprocedural risk search collapses distinct call paths (visited key lacks path identity)
- **Severity:** Medium  
- **File:** `src/index/risk-interprocedural/engine.js`
  - `visitKey` construction lines **509–513**
- **What’s happening**
  - `visitKey` is `{rootChunkUid}:{rootRuleId}:{calleeUid}:{taintKey}:{depth}`.
  - Multiple distinct call paths that reach the same `calleeUid` at the same depth are considered duplicates and will be skipped.
- **Why this matters**
  - It undermines the intent of `maxPathsPerPair` and can hide alternative evidence / call-site IDs.
  - Results may be deterministically biased toward whichever path is discovered first.
- **Suggested fix**
  - Include a compact path signature in the visited key (e.g., hash of `pathChunkUids` and/or call-site IDs), or
  - Track visited per (calleeUid, depth) with a small bounded set of path hashes.

---

### G.3 Conditional type inference may misclassify params because it ignores `docmeta.paramNames`
- **Severity:** Low  
- **File:** `src/index/type-inference.js`
  - `paramNameSet` creation lines **540–548**
- **What’s happening**
  - Param names are derived only from `docmeta.params`, but other parts of the codebase use `docmeta.paramNames`.
  - If a chunk stores parameter names in `paramNames`, conditional inference may treat them as locals.
- **Suggested fix**
  - Union both: `docmeta.params` and `docmeta.paramNames`.

---

### G.4 ESLint instance is cached globally (potential cross-repo config contamination, cwd sensitivity)
- **Severity:** Medium  
- **File:** `src/index/analysis.js`
  - module-global `eslintInstance` lines **31–37**
  - ESLint construction lines **51–77**
- **What’s happening**
  - ESLint is instantiated once and reused across runs.
  - No explicit `cwd` is supplied, so ESLint config resolution may depend on `process.cwd()` at first initialization.
- **Why this matters**
  - In a long-running process indexing multiple repositories, lint behavior can become inconsistent or unexpectedly influenced by a previous repo’s environment.
- **Suggested fix**
  - Create an ESLint instance per `rootDir` (or per build) and set `cwd: rootDir`.
  - Or cache by `rootDir` rather than module-global singleton.

---

## Section H — Artifact I/O (additional findings)

### H.1 Offsets validation cache can go stale (keys ignore file mtime/size)
- **Severity:** Medium  
- **File:** `src/shared/artifact-io/loaders.js`
  - `ensureOffsetsValid()` lines **59–74**
- **What’s happening**
  - Successful offset validation is cached in a Set keyed only by `${jsonlPath}:${offsetsPath}`.
  - If either file changes (e.g., reindex writes new data to same path), validation is **not re-run** during the process lifetime.
- **Why this matters**
  - A long-running service can use stale offsets against new data and return incorrect rows or throw downstream.
- **Suggested fix**
  - Include `(mtimeMs,size)` for both files in the cache key, or use the existing `artifact-io/cache.js` signature pattern.

---

### H.2 `.jsonl.gz` / `.jsonl.zst` can be missed in non-strict resolution paths
- **Severity:** Medium  
- **File:** `src/shared/artifact-io/loaders.js`
  - `resolveJsonlArtifactSources()` lines **78–89**
- **What’s happening**
  - For the “plain jsonl” path it checks only `name.jsonl` (or `.bak`), not `.jsonl.gz`/`.jsonl.zst`.
  - A separate helper `resolveJsonlFallbackSources()` *does* check compressed variants, but it isn’t used here.
- **Why this matters**
  - In non-strict mode without a manifest, artifacts may be treated as missing even though compressed files exist.
- **Suggested fix**
  - Extend `existsOrBak` checks for `jsonlBase + .gz` and `.zst`, or reuse `resolveJsonlFallbackSources`.

---

### H.3 Using directory mtime to choose between `.jsonl` and shard dirs is unreliable
- **Severity:** Medium  
- **Files:**
  - `src/shared/artifact-io/fs.js`  
    - `resolveDirMtime()` lines **31–36**
  - `src/shared/artifact-io/loaders.js`  
    - shard selection logic lines **82–89**
- **What’s happening**
  - On many filesystems, a directory’s mtime updates on entry create/delete/rename, not when existing shard files are overwritten.
  - This can cause the source selector to pick a stale `.jsonl` even when shard contents are newer (or vice versa).
- **Suggested fix**
  - Compare against a manifest/meta file mtime, or compute max mtime of shard files (bounded scan).

---

### H.4 `readJsonlRowAt` can allocate huge buffers before enforcing `maxBytes`
- **Severity:** High  
- **File:** `src/shared/artifact-io/offsets.js`
  - `readJsonlRowAt()` lines **77–103**
- **What’s happening**
  - `length = end - start` is used to allocate a buffer before checking the `maxBytes` constraint (the check happens later in JSON parsing).
- **Why this matters**
  - Corrupted offsets can force allocation of extremely large buffers → OOM or process instability.
- **Suggested fix**
  - Add:
    - `if (length > maxBytes) throw toJsonTooLargeError(...)`
  - before `Buffer.allocUnsafe(length)`.

---

## Section J — Retrieval Engine (additional findings)

### J.1 Query-plan disk cache size trimming uses compact JSON, but persistence writes pretty JSON
- **Severity:** Medium  
- **File:** `src/retrieval/query-plan-cache.js`
  - size estimation in `trimEntriesBySize()` lines **127–143**
  - write in `persist()` line **206**
- **What’s happening**
  - Size trimming uses `Buffer.byteLength(JSON.stringify(payload))`.
  - Persistence writes with indentation: `JSON.stringify(payload, null, 2)`.
- **Why this matters**
  - The on-disk file can exceed `maxBytes` even after “successful” trimming.
- **Suggested fix**
  - Either:
    - write compact JSON (no indentation), or
    - compute trimming size using the same formatting as persistence.

---

### J.2 Query-plan disk cache writes are non-atomic (risk of corruption)
- **Severity:** Medium  
- **File:** `src/retrieval/query-plan-cache.js`
  - `persist()` lines **201–214**
- **What’s happening**
  - Uses `fs.writeFileSync(filePath, ...)` directly.
- **Why this matters**
  - Crash mid-write can corrupt cache; subsequent loads can fail or silently discard the cache.
- **Suggested fix**
  - Atomic write pattern (`.tmp` + rename), optionally keep `.bak`.

---

### J.3 Query negation semantics can be incorrect because exclude lists are derived from a flattened AST
- **Severity:** High  
- **Files:**
  - `src/retrieval/query.js`
    - `flattenQueryAst()` lines **255–279**
  - `src/retrieval/cli/query-plan.js`
    - excludes derived from `excludeTerms`/`excludePhrases` lines **130–139**
- **What’s happening**
  - `flattenQueryAst()` pushes negated terms/phrases into `excludeTerms`/`excludePhrases` regardless of boolean structure.
  - This implicitly applies a De Morgan transform even when it is not valid for the intended semantics of `NOT` over a compound expression.
- **Example**
  - Query: `not (foo and bar)`
  - Correct meaning: exclude chunks that contain **both** `foo` and `bar` together.
  - Current flatten behavior: excludes `foo` **and** excludes `bar` individually → far too strict.
- **Why this matters**
  - Users can get incorrect empty/low-recall results for otherwise valid boolean queries.
- **Suggested fix**
  - Only build `excludeTerms`/`excludePhrases` for **direct** NOT(term/phrase), not for NOT of compound expressions.
  - Or remove exclude-needle filtering from boolean queries entirely and rely on AST evaluation.

---

### J.4 Index signature cache is an unbounded Map (TTL pruning only happens on access)
- **Severity:** Low  
- **File:** `src/retrieval/index-cache.js`
  - `indexSignatureCache` lines **10–18** and access patterns in `getIndexSignature()`
- **What’s happening**
  - Cache entries are only pruned when `getIndexSignature()` is called for the key.
  - If many unique dirs/buildIds are loaded once, the Map can grow without bound in a long-lived process.
- **Suggested fix**
  - Use an LRU cache (like `lru-cache`) or periodic pruning.

---

### J.5 Dead/unused `excludeNeedleSet` computation
- **Severity:** Low  
- **File:** `src/retrieval/output/filters.js`
  - lines **47–55**
- **What’s happening**
  - `excludeNeedleSet` is computed but never used.
- **Suggested fix**
  - Remove it, or use it for fast membership checks if that was the intent.

---


---

### Part 2C — Additional findings (Sections C, E, G, H, J, K, O)

# PairOfCleats — Additional Static Review Findings (Sections C, E, G, H, J, K, O)

> This document contains **new** issues found on a second, deeper static pass of sections **C / E / G / H / J / K / O**.
>
> Previously reported items in the earlier A→O review are intentionally **omitted** here to avoid duplication.

---

## Section C — Build orchestration, stage lifecycle, incremental caching

### C1 — `teardownRuntime()` can be skipped if `lock.release()` throws
- **Severity:** High  
- **Where:** `src/integrations/core/build-index/stages.js` (`runStage()` `finally` block)
- **What:** `stopHeartbeat()`, `await lock.release()`, and `await teardownRuntime(runtime)` are executed sequentially in a single `finally`. If `lock.release()` throws (filesystem error, permissions, transient IO), `teardownRuntime()` never runs.
- **Why it matters:** On failure paths you can leak worker pools, open handles, temp dirs, and cached resources; also increases the chance of follow-on failures in the same process (e.g., in service mode).
- **Suggested fix:**
  - Wrap cleanup operations so teardown is *guaranteed*:
    - `try { stopHeartbeat(); } catch {}`  
    - `try { await lock.release(); } catch (e) { log }`  
    - `finally { await teardownRuntime(runtime); }`

---

### C2 — `promoteBuild()` trusts “inside repo cache root”, but not “inside builds root”
- **Severity:** Medium  
- **Where:** `src/index/build/promotion.js` (`promoteBuild()`)
- **What:** Safety check ensures `buildRoot` is within `repoCacheRoot`, but does **not** ensure it is within the **builds root** (`getBuildsRoot(...)`). With `indexRootOverride` or a misconfigured caller, `current.json` can point at arbitrary directories under the cache root that are not actual build directories.
- **Why it matters:** A malformed `current.json` can break `getCurrentBuildInfo()` consumers, validation, and future promotions (and may accidentally “promote” non-build artifacts).
- **Suggested fix:** Require `buildRoot` ⊂ `buildsRoot` (canonicalized), not just `repoCacheRoot`, or store/promote a build ID that is resolved to a buildRoot under `buildsRoot` only.

---

### C3 — Incremental manifest pruning is **non-atomic** and can corrupt `manifest.json`
- **Severity:** High  
- **Where:** `src/index/build/incremental.js` (`pruneIncrementalManifest()`)
- **What:** The incremental manifest is updated via `fs.writeFile(manifestPath, JSON.stringify(...))` without an atomic temp+rename strategy.
- **Why it matters:** A crash/power loss mid-write can leave a truncated or invalid JSON manifest. Next runs silently reset incremental state (`catch {}`), potentially causing unexpected full rebuilds and leaving stale bundle artifacts behind.
- **Suggested fix:** Mirror the build-state approach: write to `manifestPath.tmp` and `rename()`/replace, optionally keeping a `.bak` file.

---

### C4 — Incremental “cache reset” does not clean stale bundle artifacts (disk bloat)
- **Severity:** Medium  
- **Where:** `src/index/build/incremental.js` (`loadIncrementalState()`, reset path)
- **What:** When signature/tokenization changes, the incremental manifest resets to an empty default, but the old `bundleDir` contents are left intact.
- **Why it matters:** Repeated resets over time can accumulate large volumes of unreachable bundles on disk, especially in long-lived caches/CI agents.
- **Suggested fix:** On reset, either:
  - remove `bundleDir` recursively, or
  - move to a versioned subdirectory keyed by signature/tokenization key and prune old versions.

---

### C5 — `shouldReuseIncrementalIndex()` does not hash-verify on coarse mtime filesystems
- **Severity:** Medium  
- **Where:** `src/index/build/incremental.js` (`shouldReuseIncrementalIndex()`)
- **What:** Reuse decision compares only `size` and `mtimeMs`. For coarse-resolution mtimes (1s), edits within the same timestamp window (and same size) can be missed.
- **Why it matters:** You can incorrectly reuse an index that is stale relative to the filesystem contents (particularly in fast-save editors or some CI filesystems).
- **Suggested fix:** On coarse mtime (same heuristic you already have via `shouldVerifyHash()`), hash-verify at least a sampled subset of files or all files below a cap, and/or store file hashes in the manifest and verify those.

---

### C6 — Lock stale handling can wedge the build if PID is alive but lock is stale/orphaned
- **Severity:** Medium  
- **Where:** `src/index/build/lock.js` (`acquireIndexLock()`)
- **What:** Stale lock removal requires `stale === true` *and* `(!pid || !isProcessAlive(pid))`. If a lock file is stale but the PID is alive (PID reuse, unrelated process, or a hung build), it will never be cleared.
- **Why it matters:** Can lead to indefinite “lock held” failures until manual intervention.
- **Suggested fix:** Consider:
  - embedding more identity in the lock (e.g., buildRoot + start timestamp) and
  - treating “stale” as authoritative after a threshold even if PID exists (or adding a “force after N minutes” policy).

---

## Section E — Language frontends: parsing, chunking, import scanning, Python AST

### E1 — Lexer init promises can become permanently “poisoned” after a transient failure
- **Severity:** Medium  
- **Where:** `src/index/build/imports.js` (`ensureEsModuleLexer()`, `ensureCjsLexer()`)
- **What:** Global `esModuleInitPromise` / `cjsInitPromise` are cached forever. If initialization rejects once, the rejected promise is retained and future scans always fail (until process restart).
- **Why it matters:** In long-lived processes/services, a transient startup failure becomes permanent reduced capability (import scanning falls back to weaker heuristics).
- **Suggested fix:** If init fails, clear the cached promise (`... = null`) so the next attempt can retry; optionally add a capped backoff.

---

### E2 — Python AST pool `shutdown()` can leave pending jobs unresolved (hang risk on abort/teardown)
- **Severity:** High  
- **Where:** `src/lang/python/pool.js` (`shutdown()`, `handleWorkerExit()`, `requeueJob()`)
- **What:** `shutdown()` sets `state.stopping = true`, kills workers, and clears `state.queue`, but **does not resolve** jobs that were pending in workers. When workers exit, `handleWorkerExit()` requeues pending jobs via `requeueJob()`, but `drainQueue()` returns early when `state.stopping` is true — leaving those jobs’ promises unresolved.
- **Why it matters:** If shutdown is called while work is in flight (errors, abort signals, early teardown), the build can hang indefinitely awaiting Python AST results.
- **Suggested fix:** When `state.stopping` is true (or inside `shutdown()`), resolve *all* pending jobs (both queued and in-worker pending) to `null` (or a structured “cancelled”) instead of requeuing.

---

### E3 — Import resolution cache writes are non-atomic (corruption → silent cache drops)
- **Severity:** Medium  
- **Where:** `src/index/build/import-resolution-cache.js` (`saveImportResolutionCache()`)
- **What:** Cache is persisted with `fs.writeFile(cachePath, JSON.stringify(...))` directly, no atomic rename.
- **Why it matters:** Partial writes can produce invalid JSON; the loader catches errors and falls back to an empty cache, reducing incremental efficiency unpredictably.
- **Suggested fix:** Atomic temp+rename strategy (same as build-state), or at least write `.tmp` then replace.

---

### E4 — Potential byte-offset vs code-unit mismatch with Tree-sitter indices (Unicode correctness)
- **Severity:** Medium (correctness; manifests on non-ASCII)  
- **Where:** 
  - `src/lang/tree-sitter/chunking.js` (`sliceNodeText(...)`, chunk offsets)
  - `src/index/build/tokenization.js` (`rawText.slice(node.startIndex, node.endIndex)`)
- **What:** The code assumes `node.startIndex/endIndex` index into JS strings. Many Tree-sitter bindings expose **byte offsets** (UTF-8), which diverge from JS code-unit indexing for non-ASCII text.
- **Why it matters:** Chunk boundaries, extracted identifiers, and line offsets can become incorrect in files containing Unicode (comments, strings, prose, identifiers).
- **Suggested fix:** Confirm the binding semantics and, if indices are bytes:
  - parse from a `Uint8Array` / `Buffer` and slice bytes, or
  - maintain a byte→codeUnit mapping for safe slicing/offset translation.

---

### E5 — Tree-sitter chunking module has “log-once” sets that never clear (minor leak)
- **Severity:** Low  
- **Where:** `src/lang/tree-sitter/chunking.js` (e.g., `loggedParseFailures`, `loggedSizeSkips`, ...)
- **What:** Module-level sets accumulate keys and are never reset.
- **Why it matters:** Likely small bounded growth (per language/condition), but still unbounded in principle for long-lived processes.
- **Suggested fix:** Cap set sizes or periodically clear (or move into a runtime-owned stats object that resets per build).

---

## Section G — Enrichment features: tooling, VFS, type inference, risk scanning

### G1 — **Path traversal / baseDir escape** in `resolveVfsDiskPath()` (leading slash and Windows backslashes)
- **Severity:** Critical  
- **Where:** `src/index/tooling/vfs.js` (`resolveVfsDiskPath()`)
- **What:**
  - If `virtualPath` begins with `/`, `String(...).split('/')` yields an empty first segment → `relative` begins with a path separator → `path.join(baseDir, relative)` ignores `baseDir` and returns an absolute path.
  - On Windows, `virtualPath` containing backslashes (e.g., `foo\..\..\evil.txt`) is **not split**, so `..` remains inside a segment and `path.join()` will normalize it, escaping `baseDir`.
- **Why it matters:** This function is explicitly documented as “safe”, but can write outside the VFS root directory if a crafted `virtualPath` reaches it (directly or via an upstream provider bug).
- **Suggested fix:**
  - Reject absolute paths up front (`path.isAbsolute(...)` for both POSIX and Windows forms).
  - Split on both separators: `/[\\/]/`.
  - Normalize and enforce `resolved.startsWith(path.resolve(baseDir) + path.sep)` after `path.resolve`.
  - Disallow empty leading segments.

---

### G2 — `VFS_DISK_CACHE` is unbounded and never pruned
- **Severity:** Medium  
- **Where:** `src/index/tooling/vfs.js` (module-level `VFS_DISK_CACHE`)
- **What:** `VFS_DISK_CACHE` stores disk paths + doc hashes keyed by baseDir+virtualPath, with no eviction strategy.
- **Why it matters:** In long-lived processes that process many documents (especially virtual docs), this cache can grow without bound.
- **Suggested fix:** Add LRU/TTL eviction (similar to `VFS_DOC_HASH_CACHE`), or scope the cache to a per-run runtime object.

---

### G3 — Type inference splitting does not account for escaped quotes (mis-parsing defaults)
- **Severity:** Low–Medium (depends on usage)  
- **Where:** `src/index/type-inference.js` (`splitLiteralTopLevel(...)`)
- **What:** The parser toggles `inSingle`/`inDouble` on `'`/`"` but does not handle escaping (`\'`, `\"`). This can mis-split object/array literals containing strings with embedded quotes/commas.
- **Why it matters:** Produces incorrect inferred types (or noisy union expansions) for common defaults like JSON snippets or regex-like strings.
- **Suggested fix:** Track escape state (`\`) within string contexts, and/or reuse a lightweight JSON-ish tokenizer for defaults.

---

### G4 — Risk scanner performs `text.split()` before checking caps (avoidable allocation)
- **Severity:** Low  
- **Where:** `src/index/risk.js` (`detectRiskSignals(...)`)
- **What:** It builds a full `lines[]` array via `text.split(...)` before enforcing max line caps.
- **Why it matters:** For large chunks (even if later capped), it creates avoidable allocations and GC pressure.
- **Suggested fix:** Short-circuit on byte cap before splitting, or count newlines incrementally until `maxLines` is hit.

---

### G5 — Tooling cache writes are non-atomic (cache corruption → silent misses)
- **Severity:** Low–Medium  
- **Where:** `src/index/tooling/orchestrator.js` (`writeToolingCacheFile(...)`)
- **What:** Tool output caches are persisted via direct `fs.writeFile(...)`.
- **Why it matters:** Partial writes on crash lead to invalid cache files; code treats this as a cache miss (noisy perf regressions).
- **Suggested fix:** Atomic temp+rename strategy.

---

## Section H — Artifact I/O, manifests, offsets, schemas

### H1 — `resolveManifestMaxBytes()` can return invalid types, disabling safety checks
- **Severity:** High  
- **Where:** `src/shared/artifact-io/manifest.js` (`resolveManifestMaxBytes(...)`)
- **What:** If `maxBytes` is invalid (`'foo'`, `null`) or `<= 0`, it returns the original `maxBytes` value rather than falling back to a safe default. Downstream comparisons (`stat.size > maxBytes`, `buffer.length > maxBytes`) can become ineffective due to JS coercion (e.g., `'foo'` → `NaN`).
- **Why it matters:** A misconfigured caller can accidentally (or maliciously) disable size guards and force large reads into memory.
- **Suggested fix:** If `parsed` is not a finite positive number, return a known-safe default (e.g., `MAX_JSON_BYTES`) or `MIN_MANIFEST_BYTES`-clamped default.

---

### H2 — `readJsonlRowAt()` can allocate unbounded buffers before enforcing `maxBytes`
- **Severity:** High  
- **Where:** `src/shared/artifact-io/offsets.js` (`readJsonlRowAt(...)`)
- **What:** It allocates `Buffer.allocUnsafe(length)` where `length = end - start` from the offsets file, *before* applying `maxBytes` validation (which happens later in `parseJsonlLine()`).
- **Why it matters:** A corrupted or malicious offsets file can force very large allocations and crash the process (OOM), even if `maxBytes` was meant to limit reads.
- **Suggested fix:** Validate `length` prior to allocation:
  - `if (length > maxBytes + safetyMargin) throw ...`
  - or clamp reads to `maxBytes + 1` and fail fast if line exceeds cap.

---

### H3 — `readJsonlRowAt()` repeatedly opens files (hot-path performance)
- **Severity:** Low–Medium  
- **Where:** `src/shared/artifact-io/offsets.js` (`readJsonlRowAt(...)`, `readOffsetAt(...)`)
- **What:** Each row read opens the offsets file (twice) and the JSONL file once. When used in a loop, this amplifies syscall overhead.
- **Why it matters:** Random-access retrieval over many rows can become IO-bound.
- **Suggested fix:** Reuse file handles (or cache offsets in memory for bounded ranges), or add a small handle pool.

---

### H4 — Manifest indexing is rebuilt on every lookup (avoidable O(N) work)
- **Severity:** Low  
- **Where:** `src/shared/artifact-io/manifest.js` (`resolveManifestEntries(...)`)
- **What:** `indexManifestPieces(...)` rebuilds a `Map` of pieces each call.
- **Why it matters:** If manifest lookups occur repeatedly (e.g., per artifact type), this is unnecessary repeated work.
- **Suggested fix:** Cache the map on the manifest object (or in a WeakMap keyed by the manifest instance).

---

## Section J — Retrieval pipeline, query caching, provider lifecycle

### J1 — Query-plan disk cache writes are non-atomic (risk of corrupt cache files)
- **Severity:** Medium  
- **Where:** `src/retrieval/query-plan-cache.js` (`createQueryPlanDiskCache().persist()`)
- **What:** Uses `fs.writeFileSync(cachePath, ...)` directly.
- **Why it matters:** A crash/power loss can produce a partially-written JSON file; next load catches errors and returns an empty cache, causing unpredictable perf changes.
- **Suggested fix:** Atomic temp+rename swap.

---

### J2 — Providers can be permanently disabled after a single transient error
- **Severity:** Medium  
- **Where:** `src/retrieval/pipeline.js` (`markProviderDisabled(...)`, used by preflight and query execution)
- **What:** A provider is tagged with `_disabledModes` after any error, and remains disabled for the rest of the process lifetime.
- **Why it matters:** One transient failure (file temporarily missing, IO hiccup, partial index update) can permanently degrade retrieval results until restart.
- **Suggested fix:** Add a TTL/backoff (e.g., disable for N minutes), or clear disable flags when index signature changes.

---

### J3 — `indexSignatureCache` is unbounded and only purged on access
- **Severity:** Low–Medium  
- **Where:** `src/retrieval/index-cache.js` (module-level `indexSignatureCache`)
- **What:** Entries expire via timestamps but are only deleted when `getCachedSignature()` is called for the same key.
- **Why it matters:** In a multi-index long-lived service, the cache can grow without bound.
- **Suggested fix:** Add size-based eviction (LRU) or periodic cleanup.

---

### J4 — Query cache file I/O lacks size guards and uses non-atomic writes (CLI reliability)
- **Severity:** Low  
- **Where:** 
  - `src/retrieval/query-cache.js` (`loadQueryCache()`)
  - `src/retrieval/cli/run-search-session.js` (writes `queryCache.json`)
- **What:** Reads JSON synchronously without a max-size check; writes cache via direct `fs.writeFile(...)` non-atomically.
- **Why it matters:** A bloated cache file can stall memory/parse time; partial writes can corrupt the cache and cause confusing behavior across sessions.
- **Suggested fix:** Add a max-size guard + atomic write. (Even in CLI contexts, it improves robustness.)

---

## Section K — Embeddings, ANN providers, embedder caching

### K1 — `onnxCache` retains rejected initialization promises (no retry)
- **Severity:** Medium  
- **Where:** `src/shared/onnx-embeddings.js` (`createOnnxEmbedderCached(...)`)
- **What:** If the first call to initialize ONNX embedder fails, the rejected promise remains in `onnxCache` and all future calls fail immediately.
- **Why it matters:** A transient “model not found / disk hiccup / temporary runtime error” becomes permanent until restart.
- **Suggested fix:** On rejection, delete the cache key and allow retry (optionally with backoff).

---

### K2 — Transformer pipeline caches can be poisoned on failure; caches are unbounded
- **Severity:** Medium  
- **Where:** `src/shared/embedding-adapter.js` (`transformersModulePromise`, `pipelineCache`, `adapterCache`)
- **What:**
  - Cached promises are not cleared on rejection → permanent failure.
  - Caches have no eviction strategy → unbounded growth for many model IDs/options.
- **Why it matters:** Long-lived embedding services can accumulate memory and become permanently degraded after a single transient failure.
- **Suggested fix:** Clear caches on rejection; add TTL/LRU bounds; consider scoping caches to a runtime instance.

---

### K3 — ONNX fallback is too narrow: module-not-found won’t fall back to Xenova
- **Severity:** Low–Medium  
- **Where:** `src/shared/embedding-adapter.js` (`createEmbedder(...)`)
- **What:** Fallback to Xenova happens only when `err.code === 'ERR_DLOPEN_FAILED'`. If `onnxruntime-node` is missing (`ERR_MODULE_NOT_FOUND`) or fails differently, it throws instead of falling back.
- **Why it matters:** Deployments that intend “prefer ONNX, fall back to Xenova” will unexpectedly hard-fail.
- **Suggested fix:** Expand fallback conditions to include `ERR_MODULE_NOT_FOUND` (and possibly a curated set of runtime-load failures).

---

### K4 — LanceDB connections/tables are cached without eviction or close (resource leak)
- **Severity:** Medium  
- **Where:** `src/retrieval/lancedb.js` (`connectionCache`, `getConnection()`, `getTable()`)
- **What:** Connections and table handles are cached indefinitely, with no close/cleanup and no size bounds.
- **Why it matters:** In a multi-repo or long-running daemon, this can leak file descriptors and memory over time.
- **Suggested fix:** Add LRU/TTL eviction and explicitly close connections/tables on eviction (if supported by the driver).

---

### K5 — Embeddings build tool pre-allocates large vector arrays (OOM risk on huge corpora)
- **Severity:** Medium  
- **Where:** `tools/build/embeddings/runner.js` (vector arrays sized to `totalChunks`)
- **What:** The runner pre-allocates multiple arrays sized to the total number of chunks (code/doc/merged), potentially holding many `Float32Array` vectors simultaneously.
- **Why it matters:** Large repositories (or record-heavy modes) can cause peak memory spikes and OOMs during embeddings build.
- **Suggested fix:** Stream vectors into the index writer/shard writer instead of holding all in memory, or shard earlier and release per-shard memory promptly.

---

## Section O — Tooling & test harness

### O1 — Log filename collisions from `sanitizeId()` truncation can overwrite logs
- **Severity:** Low–Medium  
- **Where:** `tests/runner/run-execution.js` (`sanitizeId()`, `writeLogFile()`)
- **What:** IDs are normalized and truncated to 120 chars. Different long test IDs can collide and write to the same log filename (especially with attempts).
- **Why it matters:** Makes failures harder to debug (logs from one test can overwrite another).
- **Suggested fix:** Include a short hash suffix of the full ID (e.g., `safeId + '-' + sha1(id).slice(0,8)`).

---

### O2 — Output size accounting uses `chunk.length` (code units), not bytes
- **Severity:** Low  
- **Where:** `tests/runner/run-logging.js` (`collectOutput()`)
- **What:** `size += chunk.length` counts UTF-16 code units for strings; for non-ASCII output the byte count can be significantly larger than `size`.
- **Why it matters:** The “max output bytes” guard can undercount, leading to larger-than-expected in-memory captures.
- **Suggested fix:** Track bytes (`Buffer.byteLength(chunk, 'utf8')`) consistently when enforcing a byte budget.

---

### O3 — Timeout-kill path is async but termination details may be lost in the result
- **Severity:** Low  
- **Where:** `tests/runner/run-execution.js` (`runTestOnce()` timeout handler)
- **What:** The timeout handler is `async` but not awaited; `finish()` may run before `termination = await killProcessTree(...)` completes, producing `termination: null` in the returned result/log.
- **Why it matters:** Loss of diagnostic detail for timeouts.
- **Suggested fix:** Store termination promise and await/settle it in `finish()` when `timedOut` is true.

---




---

# Addendum — Conversation-only findings (not guaranteed to appear in the standalone addendum files)

> These items were identified in follow-up re-reviews during the conversation and may overlap with the addendum documents above. They are listed here to ensure nothing from the conversation is omitted.

## C) Index build orchestration / lifecycle

- **[High] `startBuildHeartbeat()` can crash due to TDZ on `timer` when `tick()` stops before `timer` is assigned.**  
  *Files:* `src/index/build/build-state.js`
- **[High] Watch-mode compatibility key computed with `entryCount=0` can diverge from adaptive dict/tokenization behavior used in the actual build pipeline.**  
  *Files:* `src/integrations/core/build-index/index.js`, `src/integrations/core/build-index/compatibility.js`, `src/index/build/indexer/pipeline.js`
- **[Medium–High] Debounced build-state updates are frequently `await`ed, defeating the debounce and adding systemic latency.**  
  *Files:* `src/index/build/indexer/pipeline.js`, `src/index/build/build-state.js`
- **[Medium] `lock.release()` only detaches signal handlers if unlink succeeds; failure paths can leave handlers installed.**  
  *Files:* `src/index/build/lock.js`
- **[Critical] Stage2 validation can incorrectly require SQLite artifacts even when SQLite is intentionally deferred to Stage4 (`allowSqlite=false`).**  
  *Files:* `src/integrations/core/build-index/stages.js`
- **[High] Stage4 `mode=all` can select the wrong build root when `buildRootsByMode` diverges (e.g., code built earlier, prose built later).**  
  *Files:* `src/integrations/core/build-index/stages.js`
- **[Medium] Multi-mode sqlite stage overwrites results in a loop; only the last mode’s result is returned.**  
  *Files:* `src/integrations/core/build-index/stages.js`
- **[High] Stage3 embeddings may proceed without a current build / explicit `--index-root`, causing implicit fallback output locations or poisoned queue jobs.**  
  *Files:* `src/integrations/core/build-index/stages.js`
- **[Medium] Watch-mode lock backoff (`maxWaitMs=15000`) is undermined by `acquireIndexLock()` default `timeoutMs=30000`.**  
  *Files:* `src/index/build/watch/lock.js`, `src/index/build/lock.js`
- **[Medium] Stage checkpoint summary returns internal `checkpoints` array by reference (mutability leaks).**  
  *Files:* `src/index/build/stage-checkpoints.js`
- **[High] Build phases can remain stuck in `"running"` on exceptions (no failure status update).**  
  *Files:* `src/integrations/core/build-index/stages.js`
- **[Medium] Non-watch promotion does not pass `compatibilityKey`, while watch promotion does (inconsistent `current.json`).**  
  *Files:* `src/integrations/core/build-index/stages.js`, `src/index/build/watch.js`
- **[High] `current.json` can be promoted at Stage2 before Stage3/Stage4 post-processing completes; readers can observe partial builds.**  
  *Files:* `src/integrations/core/build-index/stages.js`, `src/integrations/core/build-index/index.js`
- **[Medium] Stage4 sqlite work isn’t reflected in `build_state.json` and doesn’t update `current.json.stage` (observability drift).**  
  *Files:* `src/integrations/core/build-index/stages.js`

## E) Language frontends (parsing/chunking/imports)

- **[Medium] Python chunkers likely compute `endLine` off-by-one by treating exclusive end offsets as inclusive.**  
  *Files:* `src/lang/python/chunks-from-ast.js`, `src/lang/python/chunks-heuristic.js`
- **[Medium] TypeScript chunkers likely compute `endLine` off-by-one due to exclusive end offsets.**  
  *Files:* `src/lang/typescript/chunks-ast.js`, `src/lang/typescript/chunks-babel.js`
- **[Medium] `typeScriptCache` grows without bound (no eviction).**  
  *Files:* `src/lang/typescript/parser.js`
- **[Low–Medium] Python AST worker readline interface not explicitly closed on shutdown; listeners can linger.**  
  *Files:* `src/lang/python/pool.js`
- **[Low] Python docmeta returns redundant / potentially confusing return fields (`returnType` vs `returns`).**  
  *Files:* `src/lang/python/docmeta.js`

## G) Enrichment (risk, inference, lint/complexity)

- **[Medium–High] `scoreRiskForChunk()` assigns `low` severity for “sources-only” findings, ignoring any high/critical source severity.**  
  *Files:* `src/index/risk.js`
- **[Medium] Risk rule compilation uses raw regex flags rather than normalized/safe flags, increasing config fragility.**  
  *Files:* `src/index/risk-rules.js`
- **[Medium] Tooling logger spawns async writes per log call with no backpressure; can overwhelm filesystem and reorder output.**  
  *Files:* `src/index/type-inference-crossfile/tooling.js`
- **[Medium] Tooling diagnostics appended without dedupe/caps; can grow without bound across repeated runs.**  
  *Files:* `src/index/type-inference-crossfile/tooling.js`
- **[Low–Medium] `lintChunk()` JSDoc contract mismatches actual ESLint message objects returned.**  
  *Files:* `src/index/analysis.js`
- **[Medium] Complexity `averageCyclomatic` field likely misnamed/miscomputed (uses aggregate cyclomatic directly).**  
  *Files:* `src/index/analysis.js`
- **[Medium] `dedupeMatches()` keeps only one risk match per rule id, dropping additional evidence.**  
  *Files:* `src/index/risk.js`

## H) Artifact I/O (offsets/varints/readers)

- **[Medium] FD leak risk if `openSync()` returns fd=0 and close guard uses `if (fd)`.**  
  *Files:* `src/shared/files.js`
- **[High] Varint encode/decode does not enforce integer/safe bounds; large values can lose precision silently.**  
  *Files:* `src/shared/artifact-io/varint.js`
- **[Medium] `validatedOffsets` cache ignores mtime/size (staleness) and is unbounded across build roots.**  
  *Files:* `src/shared/artifact-io/loaders.js`
- **[Medium] `meta.parts` multi-part handling for `json`/`columnar` takes only the first part, silently ignoring others.**  
  *Files:* `src/shared/artifact-io/loaders.js`

## J) Retrieval/search pipeline

- **[High] Provider preflight/disable state can become “sticky” forever in a long-lived process; no retry when artifacts become available later.**  
  *Files:* `src/retrieval/pipeline.js`
- **[Medium] `indexSignatureCache` TTL cleanup is access-based; expired entries can persist indefinitely (soft leak).**  
  *Files:* `src/retrieval/index-cache.js`
- **[Medium] Output wiring likely wrong: `annType` duplicates `annSource`.**  
  *Files:* `src/retrieval/pipeline.js`

## K) Embeddings + ANN

- **[Medium] LanceDB connection/table cache has no close/eviction; long-lived services may leak resources.**  
  *Files:* `src/retrieval/lancedb.js`
- **[High] LanceDB `normalizeSim()` lacks explicit handling for dot/IP semantics; `_distance` may be misinterpreted as similarity.**  
  *Files:* `src/retrieval/lancedb.js`
- **[Medium] `embed_code_u8` falls back to merged vector when code embedding missing (semantic bleed).**  
  *Files:* `src/index/build/file-processor/embeddings.js`
- **[Medium] HNSW similarity conversion assumes `1-distance` for non-L2 spaces; verify correctness for `ip`.**  
  *Files:* `src/shared/hnsw.js`
- **[High] Python AST pool shutdown can strand queued/in-flight promises (hang/leak risk).**  
  *Files:* `src/lang/python/pool.js`

