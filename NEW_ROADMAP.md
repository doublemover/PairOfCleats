# PairOfCleats GigaRoadmap

## Status legend

Checkboxes represent “meets the intent of the requirement, end-to-end, without known correctness gaps”:

- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [ ] Not complete **or** there is a correctness gap **or** there is a missing/insufficient test proving behavior

Completed Phases: `COMPLETED_PHASES.md`

## Roadmap order (stability/performance frontloaded)

1. Phase 2 — Benchmark + build harness reliability (cache hygiene, shard progress determinism, disk-full resilience)
2. Phase 4 — Regression gate sweep (fix current failing tests)
3. Phase 7 — RPC Robustness and Memory-Safety (LSP + MCP + JSON-RPC)
4. Phase 11 — Extracted-Prose + Records end-to-end parity (build/search/stats/tests)
5. Phase 12 — Storage backends (SQLite + LMDB)
6. Phase 13 — Retrieval, Services & Benchmarking/Eval (Latency End-to-End)
7. Phase 14 — Documentation and Configuration Hardening
8. Phase 15 — Benchmarks, regression gates, and release hardening (prove the ROI)
9. Phase 17 — Hashing performance: optional native xxhash (`@node-rs/xxhash`) with `xxhash-wasm` fallback
10. Phase 18 — Safe regex acceleration: optional native RE2 (`re2`) with `re2js` fallback
11. Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)
12. Phase 20 — Threadpool-aware I/O scheduling guardrails
13. Phase 21 — (Conditional) Native LibUV work: only if profiling proves a real gap
14. Phase 22 — Embeddings & ANN (onnx/HNSW/batching/candidate sets)
15. Phase 23 — Index analysis features (metadata/risk/git/type-inference) — Review findings & remediation checklist
16. Phase 24 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)
17. Phase 25 — Massive functionality boost: PDF + DOCX ingestion (prose mode)
18. Phase 26 — Tantivy sparse backend (optional, high impact on large repos)
19. Phase 27 — LanceDB vector backend (optional, high impact on ANN scaling)
20. Phase 28 — Distribution Readiness (Package Control + Cross-Platform)
21. Phase 29 — Optional: Service-Mode Integration for Sublime (API-backed Workflows)
22. Phase 30 — Verification Gates (Regression + Parity + UX Acceptance)
23. Phase 31 — Isometric Visual Fidelity (Yoink-derived polish)
24. Phase 32 — Config/Flags/Env Hard Cut: Freeze contract + add enforcement (stop the bleeding)
25. Phase 33 — Config Hard Cut: Introduce MinimalConfig + AutoPolicy (policy-first wiring)
26. Phase 34 — Config Hard Cut: Remove profiles completely (delete the system)
27. Phase 35 — Config Hard Cut: Remove env override plumbing (secrets-only env)
28. Phase 36 — Config Hard Cut: Collapse public CLI flags to a strict whitelist
29. Phase 37 — Config Hard Cut: Remove user-configurable indexing knobs (wire indexing to AutoPolicy)
30. Phase 38 — Config Hard Cut: Remove user-configurable search knobs (wire retrieval to AutoPolicy)
31. Phase 39 — Config Hard Cut: Backend + extension simplification (remove LMDB + vector-extension config)
32. Phase 40 — Config Hard Cut: Delete dead code/docs/tests and lock minimal surface (budgets + validation)

## Phase 2 — Benchmark + build harness reliability (cache hygiene, shard progress determinism, disk-full resilience)

**Objective:** Make benchmark runs reproducible and prevent disk/memory blowups by managing caches, improving progress determinism, and failing fast with actionable diagnostics when the environment is insufficient.

### Observed failures driving this phase

- Duplicate/late progress counters during sharded builds, e.g.:
  - `[shard] 268/638 src/storage/sqlite/build-helpers.js`
  - `[shard] 268/638 src/storage/sqlite/incremental.js`
- `SqliteError: database or disk is full` during benchmark search/load.
- Benchmark cache growth causing giant artifact files and disk exhaustion.

### 2.1 Cache cleanup after each benchmarked repo

- [x] Update benchmark harnesses to **clean the repo cache after each repo** by default:
  - remove repo build directories (including incremental chunk artifacts and shard parts) and sqlite DBs under `benchmarks/cache/repos/...`
  - keep only benchmark results/baselines (and optionally a minimal build summary)
  - do **not** delete shared caches (downloads, extension caches, shared embedding caches); only repo-specific build outputs
- [x] Add a `--keep-cache` override for debugging.
- [x] Document this in `docs/benchmarks.md` (cache policy + disk sizing expectations).

### 2.2 Deterministic shard progress numbering

- [x] Pre-assign `fileIndex` for each work item **before** concurrent processing begins.
- [x] Ensure progress renderer never reuses the same `(index/total)` pair for different files in the same shard run.
- [x] Add a regression test that simulates concurrent progress events and asserts monotonically increasing fileIndex (running buildindex on the repo itself briefly should be sufficient to verify this)

### 2.3 Disk-full resilience for SQLite + artifact build steps

- [ ] Add a preflight free-disk-space check before:
  - building sqlite indexes
  - copying/compacting sqlite DBs
  - writing large artifacts/shards
- [ ] On insufficient space, fail fast with:
  - required bytes estimate (best-effort)
  - current free bytes
  - remediation steps (change cache dir, enable cleanup, reduce modes, reduce token retention)
- [ ] Optional: if a repo fails due to disk full during benchmark runs, record failure and continue to next repo.

**Exit criteria**

- [ ] Bench runs do not accumulate unbounded cache state across repos by default.
- [ ] Sharded build progress numbering is stable and trustworthy.
- [ ] Disk-full conditions are detected early with actionable messages rather than failing deep in sqlite reads.

---

## Phase 4 — Regression gate sweep (fix current failing tests)

**Objective:** Clear the currently failing regression gates so subsequent refactors (scalability, mode separation, security) have trustworthy signal.

### CLI flag removal and missing-value errors

* [ ] `tests/search-removed-flags.js`
  * [ ] Failure: expected actionable error for `--human`
  * [ ] Log: `logs/phase-22/search-removed-flags.log:1`
* [ ] `tests/search-missing-flag-values.js`
  * [ ] Failure: expected missing value message for `--type`
  * [ ] Log: `logs/phase-22/search-missing-flag-values.log:1`

### Help output parity

* [ ] `tests/search-help.js`
  * [ ] Failure: help output missing flag `--calls`
  * [ ] Log: `logs/phase-22/search-help.log:1`

### Download / extraction safety (tar)

* [ ] `tests/script-coverage.js`
  * [ ] Failure: unsafe tar entry detected (e.g., `vec0.dll`)
  * [ ] Log: `tests/.logs/2026-01-12T08-02-14-028Z/download-extensions-test.attempt-3.log:15`
  * [ ] Requirement: extraction must fail-closed on unsafe entries (path traversal, absolute paths, invalid drive prefixes, etc.).

### File processor skip behavior

* [ ] `tests/file-processor/skip.test.js`
  * [ ] Failure: expected binary buffer to skip with `reason=binary`
  * [ ] Log: `logs/phase-22/file-processor-skip.log:1`

### JavaScript chunking + relations

* [ ] `tests/lang/js-chunking.test.js`
  * [ ] Failure: missing exported function chunk (alpha)
  * [ ] Log: `logs/phase-22/lang-js-chunking.log:1`
* [ ] `tests/lang/js-relations.test.js`
  * [ ] Failure: missing exports for `run/default: []`
  * [ ] Log: `logs/phase-22/lang-js-relations.log:1`

### Language registry collectors

* [ ] `tests/language-registry/collectors.test.js`
  * [ ] Failure: dockerfile mismatch (e.g., `["node:18"] !== ["base","node:18"]`)
  * [ ] Log: `logs/phase-22/language-registry-collectors.log:1`

**Exit criteria**

* [ ] All targeted failing tests above pass deterministically (at least 3 repeated local runs).

---

## Phase 11 — Extracted-Prose + Records end-to-end parity (build/search/stats/tests)

**Objective:** Make `extracted-prose` a first-class index mode (for extracted text such as code comments) and make `records` a first-class mode for log/record artifacts. Enforce deterministic, non-duplicative indexing across `code`, `prose`, `extracted-prose`, and `records`, and ensure `--mode all` includes all four.

### Observed failures driving this phase

- `📦  extracted-prose: 0 chunks, 0 tokens` during benchmark builds (unexpected; indicates missing extraction/discovery or incorrect pipeline wiring).
- Risk of normal prose content being re-indexed into `extracted-prose` (mode separation not strict enough).
- Comment text currently influences `code` mode search, duplicating content that should live in `extracted-prose`.
- Logs/records can exist anywhere in a repo; they must be detected and kept out of the other modes.

### 11.1 Define and enforce mode invariants

* [ ] Document and enforce mode semantics in `docs/contracts/indexing.md`:
  * `code` indexes code bodies + structural metadata; **must not index comments as searchable text**.
  * `prose` indexes documentation/prose files (Markdown, text, etc.).
    * Any comments that exist inside prose files (e.g., HTML comments inside Markdown) remain in `prose`.
  * `extracted-prose` indexes **only extracted text** (comments/docstrings/config comments/etc.) sourced from **both** code and prose files.
    * **All comments are eligible** for extraction (default on), but extracted-prose must never contain the “normal prose body” of a prose file.
    * Implementation requirement: extracted-prose mode must only emit chunks for explicit extracted segments (no fallback that chunks the whole file).
  * `records` indexes log/record/triage artifacts; anything indexed in `records` must be excluded from other modes.
  * `all` == `{code, prose, extracted-prose, records}`.

* [ ] Update build orchestration so `--mode all` truly means “all”:
  * `src/index/build/args.js`: expand `--mode all` to include `records`.
  * `src/integrations/core/index.js`: expand `mode === 'all'` to include `records` (do not re-derive modes inconsistently vs. `parseBuildArgs`).
  * Ensure stage3 embedding generation includes `extracted-prose` when enabled:
    * `src/integrations/core/index.js`: `buildEmbedModes` must include `extracted-prose` (and still exclude `records`).
  * Add/extend `tests/build-index-all.js` to assert `records` is built.

* [ ] Update discovery + file processing so extracted-prose never re-indexes full prose:
  * Guarantee: a prose file with no extractable comment-like segments yields **0** extracted-prose chunks.
  * `src/index/build/file-processor.js`:
    * enforce `segmentsConfig.onlyExtras=true` for `mode === 'extracted-prose'` across all extensions
    * ensure no fallback path can chunk the full file body into extracted-prose
  * Add regression tests:
    * `.md` with only normal prose -> 0 extracted-prose chunks
    * `.md` with HTML comments (`<!-- ... -->`) -> extracted-prose chunks contain the comment text
    * comments remain searchable in prose (since they remain in prose) while also appearing in extracted-prose

* [ ] Ensure stats + smoke tests are mode-aware:
  * Smoke test that builds all modes then runs:
    * `search.js --mode extracted-prose ...`
    * `search.js --mode records ...`
  * Ensure any stats tooling used in CI includes extracted-prose + records counts (non-zero when fixtures contain eligible content).

### 11.2 Comments: single source of truth in extracted-prose, displayed by default

* [ ] Change the indexing contract so comment text is stored in one place:
  * `extracted-prose` chunk meta contains comment text/tokens/embeddings.
  * `code` chunk meta stores **references** to comment chunks/spans/IDs (no duplicated tokens).

* [ ] Retrieval join contract (default-on):
  * `code` results **include** a comment excerpt by default by joining to `extracted-prose` via `(fileId, start, end)` and/or explicit `commentChunkIds`.
  * Add a flag to disable the join for performance debugging (e.g., `--no-comments` or `--comments=off`).
  * Ensure joins are lazy and bounded (do not load all extracted-prose chunks eagerly).

* [ ] Implementation (gate behind a compatibility flag only if required):
  * `src/index/build/file-processor.js` / `src/index/build/file-processor/assemble.js`:
    * remove `fieldTokens.comment` population in code mode
    * attach comment references instead

* [ ] Tests:
  * [ ] Searching in `extracted-prose` finds doc comments for a code fixture.
  * [ ] Searching in `code` does **not** match solely on comment text.
  * [ ] Default retrieval output includes a comment excerpt for code results when the reference exists.

### 11.3 Records: detect logs/records anywhere and prevent cross-mode duplication

* [ ] Define “records” as **log/record-like artifacts**, regardless of directory:
  * examples: build logs, test logs, stack traces, benchmark outputs, crash dumps, tool outputs.

* [ ] Implement records detection + routing:
  * Add a classifier (path + content heuristics) used during discovery, e.g. `classifyFileKind(entry)`.
  * Heuristics should include:
    * extensions: `.log`, `.out`, `.trace`, `.stacktrace`, `.dmp`, `.gcov`, `.lcov`, etc.
    * path segments: `logs/`, `log/`, `out/`, `artifacts/`, `coverage/`, `tmp/`, `.cache/` (configurable)
    * lightweight content sniffing (bounded bytes): high timestamp density, stack-trace signatures, test runner prefixes.
  * Provide config overrides:
    * `records.detect` (default on)
    * `records.includeGlobs` / `records.excludeGlobs`

* [ ] Enforce exclusion invariant:
  * any file classified into `records` is excluded from `code`, `prose`, and `extracted-prose`.

* [ ] Tests:
  * [ ] Place a log-like file in an arbitrary subdir (not under a dedicated `recordsDir`) and assert it indexes only under `records`.
  * [ ] Add a regression test that prevents a records file from being double-indexed into `prose`.

### 11.4 Rust/prose mode isolation regression

* [ ] Add a discovery/unit test that asserts `.rs` files are never included in `prose` discovery.
* [ ] Add an integration smoke test that builds `prose` for a repo containing `.rs` and asserts zero `.rs` chunks exist in the prose index.

### 11.5 Critical dependency reference documentation completeness

* [ ] Define the “critical dependency set” (runtime deps that are native, download/exec, security-sensitive, or historically fragile).
* [ ] Add a CI-friendly tooling check that verifies each critical dependency has a corresponding reference document under `docs/references/dependency-bundle/deps/`.
* [ ] For missing entries, add stub docs with:
  * purpose in PairOfCleats
  * supported platforms/constraints
  * security notes (native deps, downloads, binaries)
  * upstream reference links

### 11.6 Mode surface + observability parity (logs, stats, tooling)

* [ ] Audit every place that enumerates modes (hard-coded `['code', 'prose']`, `code|prose|both|all`, etc.) and ensure:
  * `extracted-prose` + `records` are included where intended, **or**
  * the tool explicitly declares it only supports `code`/`prose` (and prints that once, clearly).

  Known call-sites to fix (non-exhaustive; start here):
  * Build orchestration:
    * `src/index/build/args.js`
    * `src/integrations/core/index.js`
  * Validators / artifact tools:
    * `src/index/validate.js` (defaults currently fall back to `['code', 'prose']`)
    * `tools/report-artifacts.js`
    * `tools/index-validate.js`
    * `tools/compact-pieces.js`
    * `tools/shard-census.js`
    * `tools/triage/context-pack.js`
  * Storage backend build tools (mode flags):
    * `tools/build-lmdb-index.js`
    * `tools/build-sqlite-index/*` (explicitly declare support set if it remains `code`/`prose` only)
  * Tests that assume only two modes:
    * `tests/discover.js`
    * `tests/preprocess-files.js`
    * `tests/watch-filter.js`

* [ ] Update user-facing stats output to include extracted-prose wherever code/prose are shown:
  * `src/retrieval/cli/render.js` (`--stats` line): include `extracted-prose chunks=...` and `records chunks=...` when those indexes are present/enabled.
  * `build-index` final summary: ensure a per-mode summary line exists for all four modes (consistent order/labels).

* [ ] Update tooling that reports/validates artifacts so it includes `extracted-prose` + `records` wherever it already includes `code` + `prose`:
  * `tools/report-artifacts.js` (validation should cover all built modes)
  * `tools/index-validate.js` (default should validate all available modes)
  * `src/index/validate.js` (default mode set)
  * `tools/shard-census.js` (mode loop)
  * `tools/triage/context-pack.js` and `tools/triage/ingest.js` (exports should include mode artifacts consistently)

* [ ] Update benchmark reporting to surface these modes consistently:
  * `tools/bench/language/metrics.js` should either:
    * report `extracted-prose` + `records` metrics alongside `code` + `prose`, or
    * explicitly mark them as “not built / not available” (once, not per-row spam).

* [ ] Normalize ordering + labels everywhere:
  * Stable order: `code`, `prose`, `extracted-prose`, `records`
  * Ensure all mode-summary lines and tables use the same order and consistent labels.

* [ ] Add a focused smoke test that asserts user-facing output includes the new modes when present:
  * Build a fixture that contains:
    * a code comment (should produce `extracted-prose` chunks)
    * a prose file with an HTML comment (should also produce `extracted-prose` chunks, while remaining in prose)
    * a log-like file (should produce `records` chunks)
  * Assert the final build summary mentions both `extracted-prose` and `records`.
  * Assert `search.js --stats` output includes extracted-prose + records counts.

### 11.7 Prose-edge linking between symbols and comment chunks (deferred)

* [ ] After parity is complete, add a lightweight “prose-edge” mechanism to associate:
  * files, classes, functions, and symbols
  * to one-or-more extracted-prose comment chunks
  * even when not physically adjacent (not necessarily a full graph edge).
* [ ] Store as a separate artifact (e.g., `comment_links.jsonl`) so it can be recomputed without rewriting core chunk artifacts.
* [ ] Retrieval should be able to surface linked comment chunks for a symbol/file without duplicating stored text.

**Exit criteria**

* [ ] `build_index.js --mode all` deterministically builds `code`, `prose`, `extracted-prose`, and `records`.
* [ ] `extracted-prose` contains extracted comment text for code files with comments.
* [ ] No prose files are indexed into `extracted-prose` (unless explicitly enabled for comment-like segments).
* [ ] Code index does not duplicate comment text; it references extracted-prose and displays excerpts by default.
* [ ] Records do not duplicate across modes; records detection works for logs placed anywhere.
* [ ] Tooling and stats that report per-mode results include `extracted-prose` + `records` (or explicitly mark them unsupported).
* [ ] CI has a deterministic check for missing critical dependency reference docs.

---

## Phase 12 — Storage backends (SQLite + LMDB)

**Objective:** Perform an audit of the storage backends (SQLite + LMDB) and their supporting tooling (build, validation, compaction, incremental updates, ANN extension management, and backend selection). Identify *all* correctness bugs, edge cases, documentation drift, missing tests, and performance/refactoring opportunities, aligned to the provided checklist.

#### Out-of-scope (not deeply reviewed, but referenced when necessary)

- Non-listed call-sites (e.g. retrieval query code) were spot-checked only when needed to validate schema/index/query alignment.

---

### Executive summary

#### Top P0 / correctness items

- [ ] **(P0) SQLite ANN table is not updated when it already exists** in:
  - `src/storage/sqlite/build/from-bundles.js` (vector table existence sets `vectorAnnReady = true` but **does not** prepare `insertVectorAnn`) — see around L120.
  - `src/storage/sqlite/build/incremental-update.js` (same pattern) — see around L240.

  **Impact:** when the ANN virtual table already exists (most importantly during incremental updates), deleted rows *can* be removed (because deletes run via `deleteDocIds(...)`), but replacement vectors for changed chunks are **not reinserted**, leaving the ANN table sparse/out-of-sync with `dense_vectors`. This can silently degrade or break ANN-based retrieval depending on how the extension is queried.

- [ ] **(P0) Retrieval-side fail-closed is incomplete for SQLite schema versions.**

  `src/retrieval/cli-sqlite.js` validates required table *names* but does **not** enforce `PRAGMA user_version == SCHEMA_VERSION` (or otherwise fail-closed on schema mismatch). This violates the checklist requirement (“readers fail closed on unknown versions”) for the SQLite reader path.

- [ ] **(P0) Bundle-build path does not hard-fail on embedding dimension mismatches** (`src/storage/sqlite/build/from-bundles.js`).

  The code currently *warns once* on a dims mismatch but continues (and may still insert inconsistent vectors). This risks producing an index with an internally inconsistent dense-vector corpus (which can cause downstream errors or silent relevance regressions).

#### High-signal P1 / robustness items

- [ ] **WAL / sidecar handling is inconsistent across build vs incremental update paths.**  
  Full rebuild paths use `replaceSqliteDatabase(...)` which removes sidecars, but incremental updates modify the DB in-place under WAL mode and do not explicitly checkpoint/truncate. If later tooling removes sidecars without a checkpoint, this can create “single-file DB” assumptions that do not hold.

- [ ] **Indexing for hot maintenance queries can be improved**: `chunks(mode, file)` exists, but multiple maintenance queries order by `id` and would benefit from `(mode, file, id)`.

- [ ] **Docs drift:** `docs/sqlite-incremental-updates.md` (and a few related docs) describe doc-id behavior and operational details that do not match current implementation (doc-id reuse/free-list behavior; ratio guard details; and operational caveats).

#### “Good news” / items that look solid already

- Most bulk write paths are transactional (build ingest, compaction copy, incremental applyChanges).
- The extension download hardening in `tools/download-extensions.js` has multiple safety layers (hash verification support, archive path traversal protection, size/entry limits).
- LMDB corruption handling has targeted tests (`tests/lmdb-corruption.js`) and tooling integration (`tests/lmdb-report-artifacts.js`).

---

## Checklist coverage and required follow-ups

### A) Schema & migrations

**Audit**

- SQLite schema is versioned via `PRAGMA user_version` with `SCHEMA_VERSION = 7` (`src/storage/sqlite/schema.js`).
- Incremental update explicitly checks schema version and required tables before mutating (`src/storage/sqlite/build/incremental-update.js`).
- Table-level constraints are generally well-defined (primary keys per (mode, …), plus supporting indexes for vocab/postings).

**Gaps / issues**

- [ ] **Fail-closed at read time:** Add a `user_version` gate to the SQLite reader path (at minimum in `src/retrieval/cli-sqlite.js` / sqlite backend creation).
  - Desired behavior:  
    - If backend is *forced* to SQLite: throw a clear error (“SQLite schema mismatch: expected X, found Y”).
    - If backend is not forced (auto): treat SQLite as unavailable and fall back to the file-backed backend, with a warning.
- [ ] **Index alignment with hot predicates:** Consider adding `CREATE INDEX idx_chunks_file_id ON chunks(mode, file, id)` to support:
  - `SELECT id FROM chunks WHERE mode=? AND file=? ORDER BY id`
  - `SELECT file, id FROM chunks WHERE mode=? ORDER BY file, id` (incremental update id reuse scan)
- [ ] **Document upgrade path explicitly:** The system is effectively “rebuild on schema bump”. Ensure docs and user-facing error messaging make that explicit (and fail closed rather than attempting to limp on).
- [ ] **Consider column-level schema validation for critical tables** (optional but recommended): required-table-name checks do not catch incompatible column changes if a user provides an arbitrary SQLite file containing tables with the right names.

---

### B) SQLite build pipeline

**Audit**

- Build-from-artifacts path uses bulk inserts and creates secondary indexes after ingest (`src/storage/sqlite/build/from-artifacts.js`).
- Build-from-bundles supports a fast-path using bundle workers (`src/storage/sqlite/build/from-bundles.js` + `bundle-loader.js`).
- Validation includes `PRAGMA integrity_check` (full) and cross-table count consistency checks (`src/storage/sqlite/build/validate.js`).

**Gaps / issues**

- [ ] **(P0) Fix ANN insert statement preparation when the ANN table already exists:**
  - In `src/storage/sqlite/build/from-bundles.js`:
    - When `hasVectorTable` is true (L120), prepare `insertVectorAnn` immediately (same SQL as the “created table” path near L209).
  - In `src/storage/sqlite/build/incremental-update.js`:
    - When `vectorAnnReady` is set based on `hasVectorTable` (L240), prepare `insertVectorAnn` as well.
  - Add a CI-friendly unit test that does not require a real sqlite-vec binary (see “Tests” section below).
- [ ] **(P0) Enforce embedding dims consistency in bundle builds.**
  - Recommendation: pre-scan each bundle (or the whole manifest) to ensure all embeddings are either absent or have a single consistent dimension; then hard-fail the build if mismatched.
  - Current behavior: warns once around L197 and continues; this should be tightened to match the artifacts build path which throws on mismatch.
- [ ] **Failure cleanup should include SQLite sidecars** (`.db-wal`, `.db-shm`) in:
  - `src/storage/sqlite/build/from-artifacts.js`
  - `src/storage/sqlite/build/from-bundles.js`

  Today they remove only `outPath` on failure. If WAL/SHM exist, they can be left behind as confusing debris and can interfere with subsequent runs.
- [ ] **Consider ensuring the produced DB is “single-file”** after build by checkpointing/truncating WAL (or switching journal mode back), rather than relying on implicit behavior.
- [ ] **Prepared statement churn:** `deleteDocIds(...)` dynamically prepares multiple statements per chunk; consider statement caching keyed by chunk size to reduce overhead during large deletes.

---

### C) LMDB backend

**Audit**

- LMDB has a clear key-space separation (`meta:*`, `artifact:*`) and an explicit schema version (`src/storage/lmdb/schema.js`).
- LMDB build tool stores artifacts plus metadata into LMDB (`tools/build-lmdb-index.js`).
- Corruption handling is at least partially validated via tests (`tests/lmdb-corruption.js`, `tests/lmdb-report-artifacts.js`).

**Gaps / issues**

- [ ] Ensure the LMDB *reader* path (not in this checklist set) fails closed on schema mismatch the same way SQLite incremental update does (explicit schema version check; clear error messaging).
- [ ] Consider adding a lightweight “LMDB quick check” command in tooling (or enhancing `tools/index-validate.js`) that validates the presence of all required keys (schema version, chunk meta, vocab, postings, etc.) and reports missing keys explicitly.
- [ ] Document LMDB key invariants and expected artifact presence (which artifacts are mandatory vs optional).

---

### D) Incremental updates

**Audit**

- Incremental update gating exists (requires incremental manifest, rejects schema mismatch, rejects high change ratios) (`src/storage/sqlite/build/incremental-update.js`).
- It preserves doc-id stability per-file by reusing IDs for changed files and reusing free IDs from deletions.
- Deletes are applied across all relevant tables using `deleteDocIds(...)` with consistent table lists.

**Gaps / issues**

- [ ] **(P0) ANN table insertion bug** (same as in section B) must be fixed for incremental updates.
- [ ] **WAL lifecycle:** after an in-place incremental update, run:
  - `PRAGMA wal_checkpoint(TRUNCATE);`
  - optionally `PRAGMA journal_mode = DELETE;` (if the project prefers single-file DBs)

  This ensures the on-disk DB is not “dependent on sidecars” after the update and reduces the likelihood of later tooling accidentally discarding uncheckpointed state.
- [ ] **Manifest match logic:** `isManifestMatch(...)` falls back to mtime/size when one side has a hash and the other does not.
  - Consider tightening: if an incremental manifest provides a hash but the DB manifest row does not, treat as “changed” and update the DB row hash (this gradually converges the DB to the stronger invariant).
- [ ] **Performance of doc-id reuse scan:** the “scan all chunks ordered by file,id” approach is correct but can be expensive; if it becomes a bottleneck, consider either:
  - adding `(mode,file,id)` index, and/or
  - materializing file→docId list in a side table (only if necessary).

---

### E) Performance

**Audit**

- Build pragmas in `src/storage/sqlite/build/pragmas.js` are set to favor build throughput (WAL + relaxed synchronous) and are restored (partially).
- Compaction tool is designed to reduce doc-id sparsity and reclaim file size (`tools/compact-sqlite-index.js`).

**Gaps / issues**

- [ ] **Avoid repeated `COUNT(*)` scans** for backend auto-selection where possible (`src/storage/backend-policy.js`).
  - Options: use `file_manifest` sum, maintain a meta counter, or store chunk count in `index_state.json`.
- [ ] **Improve maintenance query performance** via `(mode,file,id)` index as noted above.
- [ ] **Reduce query-time statement re-preparation** in `src/retrieval/sqlite-helpers.js` (`chunkArray(...)` creates fresh SQL each time); consider caching by chunk size.
- [ ] **Add at least one p95 query latency regression test** using a stable fixture DB (details below).

---

### F) Refactoring goals

**Audit**

- The codebase already separates schema SQL, prepared statements, and build/validate logic into dedicated modules.

**Gaps / issues**

- [ ] **De-duplicate shared helpers:**
  - `updateIndexStateManifest(...)` exists in both `tools/build-lmdb-index.js` and `tools/build-sqlite-index/index-state.js`.
  - `chunkArray(...)` exists in both build and retrieval code (or adjacent helpers).
- [ ] **Centralize ANN table setup logic** so that “table exists” vs “table created” paths always prepare the insert statement (avoid the current drift between `prepareVectorAnnTable(...)` and the bundle/incremental paths).
- [ ] **Clarify naming:** `toVectorId(...)` is currently a “coerce to BigInt” helper; consider renaming to reflect that it does not encode/transform the id.

---

## Tests and benchmarks — required additions

### Must-add tests (CI-friendly)

- [ ] **Unit test: ANN insertion when the ANN table already exists** (no real extension binary required).
  - Approach:
    - Create a temporary SQLite DB with all required tables plus a *plain* `dense_vectors_ann` table (not virtual) matching the schema used by insert/delete (`rowid` + `embedding` BLOB column).
    - Pass a mocked `vectorConfig` into `incrementalUpdateDatabase(...)` with:
      - `loadVectorExtension: () => ({ ok: true })`
      - `hasVectorTable: () => true`
      - `encodeVector: () => Buffer.from([0])` (or similar stable stub)
    - Run an incremental update that modifies at least one file and assert that:
      - rows are deleted for removed docIds
      - rows are inserted/replaced for changed docIds
- [ ] **Unit test: bundle-build dims mismatch hard failure**
  - Create two bundle files in the incremental bundle dir: one with embedding length N, one with embedding length N+1.
  - Assert build fails (or returns count 0 with a clear reason) rather than “warn and continue”.

### Additional recommended tests

- [ ] **Reader fail-closed test:** Provide a DB with `user_version != SCHEMA_VERSION` and confirm:
  - forced SQLite backend errors clearly
  - auto backend falls back without using SQLite.
- [ ] **Incremental WAL checkpoint test** (if WAL checkpointing is implemented): verify that after incremental update:
  - no `*.db-wal` / `*.db-shm` remain (or WAL is truncated to a small size, depending on desired policy).

### Benchmark / regression testing

- [ ] **p95 query latency regression guard (fixture-based)**
  - Add a small but non-trivial fixture SQLite DB (or build it deterministically during test setup) and run a representative query workload:
    - candidate generation (ngrams)
    - FTS ranking (if enabled)
    - dense vector scoring (if enabled)
  - Measure per-query durations and assert p95 stays under a budget (or does not regress beyond a tolerance vs a baseline).
  - Keep it deterministic: single-threaded, warm cache (or explicit warm-up iterations), fixed query set, fixed limits.

---

## File-by-file findings and action items

> This section lists concrete issues and improvement opportunities per reviewed file.  
> Items are written as actionable checkboxes; severity tags (P0/P1/P2) are included where appropriate.

### `src/storage/backend-policy.js`

- [ ] Clarify threshold semantics for `autoSqliteThresholdChunks` / `autoSqliteThresholdBytes` when set to `0` (current code uses `> 0`, so `0` behaves like “disabled” rather than “always use SQLite”).
- [ ] Consider avoiding expensive `COUNT(*)` scans for auto-selection; store chunk count in a meta table or `index_state.json` and read that instead (or sum `file_manifest.chunk_count`).
- [ ] Consider logging/telemetry: when auto-select declines SQLite due to missing/invalid thresholds, surface that decision (currently it is silent except for return fields).

### `src/storage/lmdb/schema.js`

- [ ] Add brief inline documentation describing key-space expectations (which keys must exist for a usable LMDB index).
- [ ] Consider adding a helper to enumerate expected artifact keys for validation tooling (to avoid drift).

### `src/storage/sqlite/build-helpers.js`

- [ ] Ensure `vectorConfig.extension.table` / `.column` are always sanitized before being interpolated into SQL (call-site currently depends on the caller to sanitize).
- [ ] Consider making `buildChunkRow(...)` treat empty strings/arrays consistently (e.g., avoid turning `''` into `null` unintentionally for fields where empty-string is meaningful).
- [ ] Consider reducing confusion: `buildChunkRow(...)` returns fields (`signature`, `doc`) that are not inserted into `chunks` but only into `chunks_fts`.

### `src/storage/sqlite/build/bundle-loader.js`

- [ ] Ensure loader failures return actionable error messages (bundle path, reason). (Current errors are decent; confirm `readBundleFile(...)` includes enough context.)
- [ ] Consider exposing a small “max in-flight bundles” safeguard if worker threads are enabled (to avoid memory spikes on extremely large bundles).

### `src/storage/sqlite/build/delete.js`

- [ ] Cache delete statements by chunk size to reduce repeated `db.prepare(...)` overhead when deleting many docIds.
- [ ] Consider supporting a temp table approach (`CREATE TEMP TABLE ids(...)`) if deletion performance becomes a bottleneck for large deletes.
- [ ] Verify that the `vectorDeleteTargets` contract remains consistent across callers (column name `rowid` vs explicit id columns).

### `src/storage/sqlite/build/from-artifacts.js`

- [ ] Tighten shard discovery: `listShardFiles(...)` includes `.jsonl` but ingestion reads shards via `readJson(...)`; either:
  - restrict token-postings shards to `.json`, or
  - add JSONL support for token-postings shards (if they can be JSONL in practice).
- [ ] Consider inserting `dense_meta` inside the same transaction as the first dense-vector batch (atomicity / consistency).
- [ ] For `chunkMeta` ingestion (non-piece path), avoid building a single giant `rows` array in memory if the artifact can be large; use chunked batching as done in `ingestChunkMetaPieces(...)`.
- [ ] Failure cleanup: remove sidecars (`outPath-wal`, `outPath-shm`) as well as `outPath` on failure.

### `src/storage/sqlite/build/from-bundles.js`

- [ ] **(P0) Prepare `insertVectorAnn` even when the ANN table already exists** (see around L120).  
  The “table exists” branch sets `vectorAnnReady = true` but does not prepare the insert statement, so embeddings are not inserted into ANN.
- [ ] **(P0) Make embedding dims mismatch a hard failure.**  
  Current warning-only behavior (around L197) can produce inconsistent dense vectors.
- [ ] Guard against malformed bundles: `count += result.bundle.chunks.length` should handle missing/invalid `chunks` gracefully (use `?.length || 0`).
- [ ] Remove unused import (`path` is currently imported but not used).
- [ ] Failure cleanup should remove SQLite sidecars, not just the DB file.

### `src/storage/sqlite/build/incremental-update.js`

- [ ] **(P0) Prepare `insertVectorAnn` when the ANN table already exists** (see around L240).  
  Without this, incremental updates delete ANN rows but do not reinsert replacement vectors.
- [ ] Add explicit WAL checkpointing/truncation at the end of a successful update (to keep the DB self-contained and avoid large WAL growth).
- [ ] Consider tightening `isManifestMatch(...)` semantics when hashes are available on only one side (to converge DB manifest quality).
- [ ] Performance: consider `(mode,file,id)` index or other optimization for `getDocIdsForFile(...)` scanning and per-file id lists.
- [ ] Remove (or convert to assertion) the redundant “dims mismatch warn” path inside applyChanges; dims mismatch should already be rejected earlier.

### `src/storage/sqlite/build/manifest.js`

- [ ] De-duplicate `conflicts` output (currently can include repeated normalized paths).
- [ ] Consider strict hash preference: if `entry.hash` is present but `dbEntry.hash` is null, treat as mismatch and update DB hash (do not silently match on mtime/size).

### `src/storage/sqlite/build/pragmas.js`

- [ ] Consider restoring `journal_mode` (or explicitly checkpointing) after build to ensure “single-file DB” invariants if the project expects that.
- [ ] Consider surfacing pragma failures (currently swallowed silently).

### `src/storage/sqlite/build/statements.js`

- [ ] Consider adding `idx_chunks_file_id` (see schema/index alignment notes).
- [ ] Reduce confusion: `buildChunkRowWithMeta(...)` populates fields not present in the schema (e.g., `churn_added`, `churn_deleted`, `churn_commits`). Either:
  - add these columns to the schema if they are intended, or
  - stop emitting them to avoid “looks supported but isn’t”.

### `src/storage/sqlite/build/validate.js`

- [ ] Consider validating ANN invariants when ANN is enabled:
  - `dense_vectors_ann` row count should match `dense_vectors` row count for the mode (or at least have no orphans).
- [ ] Consider making full `integrity_check` optional for very large DBs (it can be expensive); provide a quick-check mode and/or configurable validation levels.

### `src/storage/sqlite/build/vocab.js`

- [ ] Consider caching prepared statements by chunk size (similar to delete/vocab fetch) to reduce repeated SQL compilation overhead.
- [ ] Error messaging: if `missing.length` is huge, cap printed missing values in the thrown error and include only a sample plus counts (to avoid megabyte-scale exception strings).

### `src/storage/sqlite/incremental.js`

- [ ] Document the on-disk incremental manifest contract and failure modes (missing manifest, conflicts, ratio guard).
- [ ] Consider adding a small helper to validate the incremental manifest shape early, with clearer error output.

### `src/storage/sqlite/schema.js`

- [ ] Consider adding `(mode,file,id)` index for maintenance queries.
- [ ] Ensure docs (`docs/sqlite-index-schema.md`) stay in sync when schema changes.

### `src/storage/sqlite/utils.js`

- [ ] `normalizeFilePath(...)` returns the input unchanged when it is not a string; consider returning `null` instead to reduce accidental “undefined as key” behavior.
- [ ] `replaceSqliteDatabase(...)`: consider logging when fallback rename/remove paths are taken (debuggability of replacement failures).

### `src/storage/sqlite/vector.js`

- [ ] `toVectorId(...)` is effectively “coerce to BigInt”; consider renaming to reflect that (e.g., `toSqliteRowidInt64(...)`) to avoid implying a non-trivial mapping.
- [ ] Consider making quantization parameters (`minVal`, `maxVal`) configurable or derived from embedding model metadata (avoid silent saturation if embeddings are out of range).

---

### Tooling files

#### `tools/build-lmdb-index.js`

- [ ] Consider a `--validate` option that checks required artifacts exist before writing LMDB (fail early, clearer errors).
- [ ] Consider writing a small LMDB “manifest” key listing which artifacts were written (enables tool-side validation and reduces drift).

#### `tools/build-sqlite-index.js`

- [ ] Consider exit codes and messaging consistency across build modes (full rebuild vs incremental vs skipped).

#### `tools/build-sqlite-index/cli.js`

- [ ] Consider validating incompatible flag combinations early (e.g., `--bundle-workers` without a bundle dir).
- [ ] Consider adding `--no-compact` / `--compact` clarity in CLI help (if not already covered elsewhere).

#### `tools/build-sqlite-index/index-state.js`

- [ ] De-duplicate `updateIndexStateManifest(...)` with the LMDB equivalent; extract to a shared helper module.
- [ ] Consider including schema version and build mode (full vs incremental) in `index_state.json` for observability.

#### `tools/build-sqlite-index/run.js`

- [ ] Ensure `stopHeartbeat()` is always invoked via `try/finally` (avoid leaking an interval on error when `exitOnError=false`).
- [ ] After incremental updates, consider forcing WAL checkpoint/truncate (see incremental update section).
- [ ] Consider making the “incremental fallback to rebuild” reason more explicit in output (currently logged, but could include key stats: changedFiles, deletedFiles, ratio).

#### `tools/build-sqlite-index/temp-path.js`

- [ ] Consider a “same filesystem guarantee” note: temp DB path must be on same filesystem for atomic rename (current implementation uses same directory, which is good; document this).

#### `tools/clean-artifacts.js`

- [ ] Consider adding a `--dry-run` option that prints what would be deleted without deleting it (safety for new users).

#### `tools/compact-sqlite-index.js`

- [ ] If vector extension is enabled but cannot be loaded, consider warning that compaction may drop ANN acceleration (and suggest remediation, e.g. rerun embeddings rebuild once extension is available).
- [ ] Consider recording pre/post compaction stats into `index_state.json` (bytes, row counts) for observability.

#### `tools/download-extensions.js`

- [ ] Consider streaming zip extraction rather than buffering each entry into memory (`adm-zip` forces buffer extraction; if large binaries become common, consider a streaming zip library).
- [ ] Consider setting file permissions for extracted binaries explicitly per-platform conventions (e.g., preserve exec bit if needed, although shared libraries typically do not require it).

#### `tools/index-validate.js`

- [ ] Consider including actionable remediation hints per failure mode (e.g., “run build-index”, “run build-sqlite-index”, “run download-extensions”).

#### `tools/report-artifacts.js`

- [ ] Consider clarifying the units in output when printing both formatted size and raw bytes (currently raw bytes are printed in parentheses without a label).

#### `tools/vector-extension.js`

- [ ] Consider keying `loadCache` by (db, config) rather than only db (avoids surprising behavior if config changes during a long-lived process).
- [ ] Consider restoring prior `trusted_schema` value after `ensureVectorTable(...)` (minimize global DB setting changes).

#### `tools/verify-extensions.js`

- [ ] Consider adding a quick “smoke query” that verifies the ANN table can be created and queried (optional).

---

### Test files

#### `tests/backend-policy.js`

- [ ] Add coverage for threshold edge cases (e.g., `autoSqliteThresholdChunks=0` semantics).
- [ ] Add a test case where SQLite exists but artifact metadata cannot be read (ensure fallback behavior is correct and reason is surfaced).

#### `tests/compact-pieces.js`

- [ ] No issues noted (acts as a compaction functional check for artifact pieces).

#### `tests/lmdb-backend.js`

- [ ] Consider adding schema version mismatch coverage (fail closed when schema version differs).

#### `tests/lmdb-corruption.js`

- [ ] Consider asserting on error message content to ensure corruption reporting remains actionable.

#### `tests/lmdb-report-artifacts.js`

- [ ] Consider adding a test for “missing required key” vs “corruption” differentiation (if validation tooling can distinguish).

#### `tests/retrieval-backend-policy.js`

- [ ] Add coverage for schema version mismatch fallback (once reader-side user_version check exists).

#### `tests/smoke-sqlite.js`

- [ ] Add coverage for `user_version` mismatch behavior once implemented.

#### `tests/sqlite-ann-extension.js`

- [ ] Add a CI-friendly companion test that does not require the real extension binary (mock vectorConfig approach described above) to ensure ANN insert/delete invariants are enforced in CI.

#### `tests/sqlite-ann-fallback.js`

- [ ] Consider adding explicit coverage that fallback ANN search never returns out-of-range docIds (robustness guard).

#### `tests/sqlite-auto-backend.js`

- [ ] Add a test that covers the “SQLite present but too small” path + verifies reason reporting is stable.

#### `tests/sqlite-build-delete.js`

- [ ] Add coverage for deleting from an ANN table using `rowid` column and BigInt inputs (ensures `toVectorId(...)` conversion remains correct).

#### `tests/sqlite-build-indexes.js`

- [ ] Add coverage for any new maintenance index (e.g., `(mode,file,id)`), if introduced.

#### `tests/sqlite-build-manifest.js`

- [ ] Add a test for “manifest has hash but DB does not” semantics (once tightened).

#### `tests/sqlite-build-vocab.js`

- [ ] Add stress coverage for token sets larger than SQLite’s `IN` limit (ensuring chunking logic remains correct).

#### `tests/sqlite-bundle-missing.js`

- [ ] Add bundle-shape validation coverage (missing `chunks` field should not crash build loop).

#### `tests/sqlite-cache.js`

- [ ] No issues noted (validates cache path behavior / read path).

#### `tests/sqlite-chunk-id.js`

- [ ] No issues noted (docId/chunkId behavior).

#### `tests/sqlite-compact.js`

- [ ] Consider adding coverage for compaction with ANN enabled but extension mocked (ensures dense_vectors_ann remains consistent after compaction).

#### `tests/sqlite-incremental-no-change.js`

- [ ] Consider verifying `index_state.json` is unchanged (or only updated timestamp changes), depending on desired policy.

#### `tests/sqlite-incremental.js`

- [ ] Add coverage for doc-id reuse behavior (free-list) to prevent accidental regression to “always append”.

#### `tests/sqlite-index-state-fail-closed.js`

- [ ] Consider adding coverage that “pending” flips back to false on successful build (already implied but could be explicit).

#### `tests/sqlite-missing-dep.js`

- [ ] No issues noted (validates better-sqlite3 missing behavior).

#### `tests/sqlite-sidecar-cleanup.js`

- [ ] Add incremental-update sidecar cleanup coverage if WAL checkpointing/truncation is implemented.

---

### Documentation files

#### `docs/contracts/sqlite.md`

- [ ] Explicitly document the `user_version` contract and the “fail closed / rebuild on mismatch” behavior.
- [ ] Ensure the list of required tables aligns with the actual reader/build code paths (and clearly separate “core” vs “optional” tables).

#### `docs/external-backends.md`

- [ ] Consider updating to reflect current backend-policy behavior (auto selection thresholds, forced backend semantics).

#### `docs/model-compare-sqlite.json`, `docs/parity-sqlite-ann.json`, `docs/parity-sqlite-fts-ann.json`

- [ ] Ensure these reports are either generated artifacts (and documented as such) or kept in sync with the current schema/tooling versions (otherwise they can mislead).

#### `docs/references/dependency-bundle/deps/better-sqlite3.md`

- [ ] Confirm documented behavior matches current runtime expectations (particularly around extension loading, platform binaries, and supported SQLite features).

#### `docs/sqlite-ann-extension.md`

- [ ] Document the invariant that `dense_vectors_ann` must remain consistent with `dense_vectors` (no orphans; same cardinality per mode when enabled).
- [ ] Document how incremental updates maintain the ANN table (and note limitations when extension is not available).

#### `docs/sqlite-compaction.md`

- [ ] Clarify how compaction interacts with the ANN extension table (and the remediation path if ANN is temporarily unavailable during compaction).

#### `docs/sqlite-incremental-updates.md`

- [ ] Update doc-id behavior description to match implementation (per-file id reuse + free-list reuse rather than always appending).
- [ ] Document the ratio guard behavior and fallback to full rebuild more explicitly.
- [ ] Document WAL/sidecar expectations for incremental updates (single-file vs WAL sidecars).

#### `docs/sqlite-index-schema.md`

- [ ] Reconfirm schema matches `SCHEMA_VERSION = 7` (columns, indexes, optional extension table).
- [ ] If `(mode,file,id)` index is added, document it as a maintenance/performance index.

---

## Exit criteria for this review section

The following items should be completed to consider “Review Section 7” fully addressed:

- [ ] ANN insert-preparation bug fixed in both bundle-build and incremental-update code paths.
- [ ] Reader-side schema version fail-closed behavior implemented and tested.
- [ ] Bundle-build embedding dims mismatch becomes a hard failure (with tests).
- [ ] WAL/sidecar policy is explicitly decided, implemented consistently, and documented (at minimum for incremental updates).
- [ ] At least one CI-friendly test covers ANN table sync invariants without requiring a real extension binary.
- [ ] At least one fixture-based p95 latency regression test is added (or an equivalent deterministic perf guard).

---

## Phase 13 — Retrieval, Services & Benchmarking/Eval (Latency End-to-End)

### Objective

Validate and improve the **retrieval pipeline**, **services surfaces (API + MCP)**, and **benchmark/eval tooling** so that:

* Search semantics are correct and contract-aligned (query parsing, filters, ranking, explain output, context expansion).
* Backends behave consistently (memory / sqlite / sqlite-fts / lmdb) and performance paths are not accidentally disabled.
* Services are robust (streaming behavior, cancellation, backpressure, security posture).
* Benchmarks and eval harnesses are actionable, reproducible, and can enforce latency/quality budgets.

### Scope

Reviewed the complete Section 8 list from the attached markdown checklist document, including:

* Retrieval CLI + pipeline + filters + output formatting
* SQLite/LMDB helpers and cache layers
* Core integrations used by tools/services
* API server (router + SSE) and MCP transport/tools
* Benchmark harnesses (micro + language) and query tooling
* Eval harness
* Related docs + tests + fixtures

(Where files referenced other modules not in the Section 8 list, I noted mismatches and dependency risks, but the primary focus remains the Section 8 scope.)

---

### Exit Criteria (What “Done” Looks Like)

#### Correctness & Contracts

* [ ] Query parsing supports required constructs (operators/quoting/negation/precedence) or docs/contracts explicitly define the simplified grammar.
* [ ] Filters are correctly detected as “active” and do not disable backend fast-paths accidentally.
* [ ] Explain output matches actual scoring math and is emitted only when requested (or contracts updated to reflect always-present fields).

#### Performance & Latency

* [ ] SQLite FTS fast-path is not disabled by default (especially for large indexes).
* [ ] Context expansion avoids repeated O(N) scans per query (or is cached/optimized).
* [ ] Benchmarks can write baselines reliably and optionally enforce budgets.

#### Services Robustness

* [ ] API streaming handles backpressure and connection close without hanging.
* [ ] API/MCP support cancellation/timeout propagation to stop expensive work.
* [ ] CORS/security posture is explicitly intentional and documented.

#### Tests & Tooling

* [ ] Tests cover discovered regressions and add missing edge cases (FTS eligibility, extracted-prose query caching, MCP id=0, etc.).
* [ ] Bench/eval docs match actual behavior and command usage.

---

## Findings & Required Work

### 13.A — Retrieval Semantics, Explain, Context Expansion (Review Section 8.A)

#### A1 — **Critical: Filter “active” detection is wrong (breaks performance paths)**

**Files:**

* `src/retrieval/filters.js`
* `src/retrieval/cli.js`
* `src/retrieval/pipeline.js`
* `src/retrieval/sqlite-helpers.js` (indirect impact via CLI choices)

**What I found:**
`hasActiveFilters()` treats *any non-empty object* as “active,” which causes `filtersActive` to be true even when no user filters are set, because the CLI always includes internal objects like `filePrefilter`.

**Impact:**

* Forces filter pass on every query.
* Can disable SQLite FTS eligibility for large indexes because allowed-id pushdown cannot be used when the “allowed set” becomes huge.
* Prevents “lazy chunk loading” decisions that should apply when there are no real filters.
* Creates major, silent performance regressions at scale.

**Action items:**

* [ ] Fix `hasActiveFilters()` to ignore internal/config-only keys (e.g., `filePrefilter`) and only count user-constraining filters.
* [ ] Add unit tests for `hasActiveFilters()` default filter object and typical combinations.
* [ ] Add an integration test ensuring sqlite-fts remains eligible on a large index when no filters are set (or at least verify the path selection in stats/debug output).

---

#### A2 — **Context expansion does repeated O(N) indexing work per query**

**Files:**

* `src/retrieval/context-expansion.js`
* `src/retrieval/cli.js` (enables context expansion)
* `src/retrieval/pipeline.js`

**What I found:**
`buildContextIndex()` rebuilds `byName` and `byFile` maps every query.

**Impact:**

* For large repos, this adds noticeable latency per query.
* Violates checklist intent: “avoids repeated file reads / expensive rebuilds.”

**Action items:**

* [ ] Cache context index per loaded index signature (store on the loaded index object or in `index-cache.js`).
* [ ] Add tests to ensure expansions are stable and do not cross branch/filters (if applicable).
* [ ] Document the intended semantic boundaries of context expansion (same file vs cross-file, name matching rules, etc.).

---

#### A3 — Explain output / scoring contract alignment is ambiguous

**Files:**

* `src/retrieval/pipeline.js`
* `src/retrieval/output/explain.js`
* `src/retrieval/cli/render-output.js`
* Docs: `docs/contracts/retrieval-ranking.md` (very high-level)

**What I found:**
The pipeline always builds `scoreBreakdown` objects, even if explain is not requested; compact JSON hides it, but full JSON may expose it unintentionally.

**Action items:**

* [ ] Decide contract behavior:

  * Option 1: Only compute/attach `scoreBreakdown` when explain requested.
  * Option 2: Always include but document it (and remove `--explain` implication of optionality).
* [ ] Add snapshot tests asserting the presence/absence of explain fields by mode/output format.
* [ ] Ensure explain’s boost attribution matches scoring math (phrase + symbol boosts currently depend on the already-boosted score; document or adjust).

---

### 13.B — Query Parsing & Filtering (Review Section 8.B)

#### B1 — Query parsing does not satisfy checklist requirements

**Files:**

* `src/retrieval/query.js`
* `src/retrieval/query-parse.js`
* Tests/docs indirectly

**What I found:**
Parsing supports:

* quoted phrases (`"..."`)
* negation via `-token` and `-"phrase"`

It does **not** support:

* boolean operators (AND/OR/NOT) semantics
* precedence / parentheses
* actionable errors for malformed queries (unbalanced quotes become literal tokens)

**Action items:**

* [ ] Either implement full operator parsing & precedence or explicitly constrain and document the query grammar.
* [ ] Add detection + actionable error messages for unbalanced quotes and invalid constructs.
* [ ] Add tests for negated phrases, nested quotes, malformed input, and operator tokens.

---

#### B2 — Filtering: performance and correctness concerns

**Files:**

* `src/retrieval/output/filters.js`
* `src/retrieval/filter-index.js`

**Key improvements:**

* [ ] Ensure case-sensitive file filters don’t lose correctness through normalization shortcuts (currently used for prefiltering; confirm final checks are strict).
* [ ] Consider memory growth of filter index structures; document expected footprint and add soft limits/metrics.

---

### 13.C — Ranking Determinism & Tie-Breaking (Review Section 8.C)

#### C1 — Dense ranking should defensively validate embedding dimensionality

**Files:**

* `src/retrieval/rankers.js`
* `src/retrieval/embedding.js`
* `src/retrieval/sqlite-helpers.js`

**What I found:**
`rankDenseVectors()` assumes query embedding length matches index vector dimension. If not, dot-products can become NaN and ranking becomes unstable.

**Action items:**

* [ ] Validate query embedding length vs index dims; if mismatch, either truncate safely or skip dense scoring with a clear warning.
* [ ] Add tests for dims mismatch (stub embeddings + configured dims is a good harness).

---

#### C2 — SQLite dense vector scale fallback looks unsafe

**Files:**

* `src/retrieval/sqlite-helpers.js`
* Related: `src/storage/sqlite/vector.js` (quantization uses 2/255)

**What I found:**
If `dense_meta.scale` is missing for any reason, sqlite helper defaults scale to **1.0**, which would break score normalization badly for uint8 quantized vectors.

**Action items:**

* [ ] Change fallback scale default to `2/255` (and minVal to `-1` consistent with vector quantization).
* [ ] Add a regression test ensuring dense scoring remains bounded even when meta is missing/corrupt (or fail loudly).

---

### 13.D — Services: API Server & MCP (Review Section 8.D)

#### D1 — SSE backpressure “drain wait” can hang indefinitely on closed connections

**Files:**

* `tools/api/sse.js`

**What I found:**
If `res.write()` returns false, the code awaits `'drain'` only. If the client disconnects before drain fires, that promise may never resolve.

**Action items:**

* [ ] Replace `await once('drain')` with `Promise.race([drain, close, error])`.
* [ ] Add tests simulating backpressure + early disconnect (larger payload / forced write buffering).

---

#### D2 — Streaming contracts/docs do not match actual /search/stream behavior

**Files:**

* `tools/api/router.js`
* Docs: `docs/api-server.md`, `docs/contracts/api-mcp.md`

**What I found:**
`/search/stream` only emits:

* `start`
* `result` OR `error`
* `done`

Docs/contracts claim progress streaming and/or richer semantics.

**Action items:**

* [ ] Decide: implement progress events (pipeline milestones) OR revise docs/contracts to match current behavior.
* [ ] If implementing progress: add hooks from retrieval CLI/pipeline → core API → router SSE.

---

#### D3 — Cancellation/timeout propagation is missing end-to-end

**Files:**

* `tools/api/router.js`
* `tools/mcp/transport.js`
* `tools/mcp/tools.js`
* `src/integrations/core/index.js`
* `src/retrieval/cli.js` (currently no signal handling)

**What I found:**
Timeouts exist in MCP wrapper, but they do not abort underlying work. API does not abort search on client disconnect. Retrieval does not consume `AbortSignal`.

**Action items:**

* [ ] Introduce `AbortController` per request/tool call.
* [ ] Wire close events (`req.on('close')`) and timeout timers to `abort()`.
* [ ] Teach retrieval pipeline / embedding fetch to check `signal.aborted` and throw a consistent cancellation error.
* [ ] Add tests:

  * API stream abort stops work early (not just stops writing).
  * MCP tool timeout aborts the underlying work, not just returns an error.

---

#### D4 — Security posture: permissive CORS is risky

**Files:**

* `tools/api/router.js`
* Docs: `docs/api-server.md`

**What I found:**
CORS is `*` by default. Even though server defaults to localhost, permissive CORS enables untrusted sites to read responses from a local service in a browser context.

**Action items:**

* [ ] Default CORS to disabled or restricted (require explicit `--cors` enablement).
* [ ] Document threat model: local-only, trusted environment, or add token-based auth.
* [ ] Add tests for CORS behavior (preflight, allowed origins).

---

### 13.E — Benchmarks & Latency Budgets (Review Section 8.E)

#### E1 — Microbench “dense” vs “hybrid” distinction is not actually implemented

**Files:**

* `tools/bench/micro/run.js`
* `tools/bench/micro/search.js`
* `tools/bench/micro/tinybench.js`
* Docs: `docs/benchmarks.md`

**What I found:**
Bench tasks labeled “dense” and “hybrid” do not reliably enforce different scoring regimes. Some of the logic implies profiles/env-driven behavior that isn’t applied.

**Action items:**

* [ ] Implement explicit scoring strategy selection (via args/env/profile) for sparse vs dense vs hybrid.
* [ ] Confirm the benchmark measures what it claims (esp. hybrid weighting).
* [ ] Add “sanity asserts” in benchmark output to record which strategy actually ran.

---

#### E2 — Baseline writing can fail because directories don’t exist

**Files:**

* `tools/bench/micro/tinybench.js`
* Docs: `docs/benchmarks.md`

**What I found:**
`--write-baseline` writes to `benchmarks/baselines/...` but does not create the directory first.

**Action items:**

* [ ] Ensure baseline directory exists via `fs.mkdirSync(..., { recursive:true })`.
* [ ] Add a test for `--write-baseline` success on a clean repo checkout.
* [ ] Update docs to clarify how baselines are created and stored.

---

#### E3 — SQLite cache reuse is missing in benchmark harnesses

**Files:**

* `tools/bench/micro/run.js`
* `tools/bench/micro/tinybench.js`

**What I found:**
Bench harnesses often pass `sqliteCache = null`, which may force repeated DB opens and distort warm-run measurements.

**Action items:**

* [ ] Instantiate and reuse `createSqliteDbCache()` across runs for warm scenarios.
* [ ] Record cache reuse status in benchmark output for transparency.

---

#### E4 — Latency “budgets” are described but not enforceable

**Files:**

* `docs/benchmarks.md`
* Tests: existing bench tests do not enforce budgets

**Action items:**

* [ ] Define target budgets (p50/p95) for representative queries and backends.
* [ ] Add CI-friendly “perf smoke” tests that fail if budgets regress beyond thresholds (with generous margins and stable fixtures).
* [ ] Document environment assumptions for benchmarks (CPU, disk, warmup, etc.).

---

### 13.F — Eval Harness (Review Section 8.F)

#### F1 — Matching logic is permissive and may inflate scores

**Files:**

* `tools/eval/run.js`
* Docs: `docs/eval.md`

**What I found:**
Expected match uses `hit.name.includes(expected.name)`; that may treat `foo` as matching `foobar`.

**Action items:**

* [ ] Decide strictness: exact name match vs substring vs regex.
* [ ] Add dataset option `matchMode` or per-expected matcher configuration.
* [ ] Add tests for false-positive matching cases.

---

## Additional Concrete Bugs Found (Non-Checklist)

### G1 — Retrieval output summary “word count” logic uses character length

**Files:**

* `src/retrieval/output/format.js`

**What I found:**
The summary logic compares `.length` of the string (characters) to a “maxWords” variable and uses it to adjust `maxWords`. This is unit-inconsistent and likely incorrect behavior.

**Action items:**

* [ ] Fix to track word count, not character length.
* [ ] Avoid calling `getBodySummary()` twice.
* [ ] Add tests for summary length behavior.

---

### G2 — Parity test references missing benchmark query file path

**Files:**

* `tests/parity.js`
* Existing file: `tests/parity-queries.txt`

**What I found:**
`tests/parity.js` reads from `benchmarks/queries/parity-queries.txt`, but the queries file exists under `tests/parity-queries.txt`.

**Action items:**

* [ ] Update parity test to load from `tests/parity-queries.txt` (or move file to benchmarks).
* [ ] Add a guard assertion that query file exists with a clear message.

---

### G3 — Language benchmark progress renderer imports wrong relative paths

**Files:**

* `tools/bench/language/progress/render.js`

**What I found:**
Imports reference `../../../src/shared/...` but need one more `../` to reach repo root. As written, this resolves to `tools/src/shared/...` which doesn’t exist.

**Action items:**

* [ ] Fix import paths to `../../../../src/shared/...`.
* [ ] Add a smoke test that loads the module (ensures no runtime import failures).

---

### G4 — MCP transport drops valid JSON-RPC ids when id = 0

**Files:**

* `tools/mcp/transport.js`

**What I found:**
`if (!id) return;` treats `0` as falsy and drops responses/notifications. JSON-RPC allows `id: 0`.

**Action items:**

* [ ] Change checks to `(id === null || id === undefined)`.
* [ ] Add MCP tests sending `id: 0`.

---

### G5 — Bench query generator emits invalid CLI fragments (and lacks quoting)

**Files:**

* `tools/bench-query-generator.js`

**What I found:**
At least one strategy emits `--signature` without a value. Additionally, values with spaces (authors, types) are not quoted, which will break shell parsing.

**Action items:**

* [ ] Fix signature strategy to emit `--signature "<value>"`.
* [ ] Quote/escape all flag values safely.
* [ ] Clarify intended consumer (CLI vs internal harness) and ensure output format matches it.

---

## Test Coverage Additions (Highly Recommended)

### New/Expanded Tests

* [ ] `hasActiveFilters()` default object returns false; internal config-only objects don’t activate filters.
* [ ] sqlite-fts eligibility remains enabled for unfiltered queries on large (>900 chunks) indexes.
* [ ] Query cache includes extracted-prose payloads and validates required fields when mode enabled.
* [ ] SSE backpressure + client disconnect doesn’t hang.
* [ ] API abort cancels search work (requires AbortSignal support).
* [ ] MCP id=0 support.
* [ ] `--write-baseline` creates directories and succeeds.

---

## Documentation Corrections Required

* [ ] `docs/api-server.md`: align stream behavior (progress vs start/result/done), update security/CORS discussion.
* [ ] `docs/contracts/api-mcp.md`: align `/search/stream` contract to actual behavior or update implementation.
* [ ] `docs/benchmarks.md`: document baseline creation and ensure code supports it (mkdir); clarify dense/hybrid distinctions.
* [ ] `docs/mcp-server.md`: appears outdated vs actual transport implementation; update to match current code.

---

## Phase 14 — Documentation and Configuration Hardening

**Objective:** Ensure the fixed behavior is discoverable, configurable, and hard to misconfigure into an unsafe state.

1. **Document security posture and safe defaults**

   * [ ] Document:

     * API server host binding risks (`--host 0.0.0.0`)
     * CORS policy and how to configure allowed origins
     * Auth token configuration (if implemented)
     * RepoPath allowlist behavior
   * [ ] Add a prominent note: indexing untrusted repos and symlinks policy.

2. **Add configuration schema coverage for new settings**

   * [ ] If adding config keys (CORS/auth/cache TTL), ensure they are:

     * Reflected in whatever config docs you maintain
     * Validated consistently (even if validation is lightweight)

**Exit criteria**

* [ ] README/docs reflect new defaults and how to safely expose services.
* [ ] New options are documented and validated enough to prevent silent misconfiguration.

---

## Phase 15 — Benchmarks, regression gates, and release hardening (prove the ROI)

### 15.1 Extend microbench suite (`tools/bench/micro/`)

* [ ] Add `tools/bench/micro/watch.js`:

  * [ ] Event storm simulation (if feasible) or synthetic scheduler load
* [ ] Add `tools/bench/micro/regex.js`:

  * [ ] Compare `re2js` vs `re2` on representative patterns/inputs
* [ ] Add `tools/bench/micro/hash.js`:

  * [ ] Compare wasm vs native checksum throughput
* [ ] Add `tools/bench/micro/compression.js`:

  * [ ] gzip vs zstd compress/decompress for representative artifact payload sizes
* [ ] Add `tools/bench/micro/extractors.js`:

  * [ ] PDF/DOCX extraction throughput and memory ceiling

### 15.2 Add “no-regression” assertions where it matters

* [ ] Add deterministic snapshot tests (lightweight, not full golden files):

  * [ ] Ensure chunk IDs stable across backends
  * [ ] Ensure ordering stable under ties
* [ ] Add metrics validation:

  * [ ] `index-*.json` metrics reflect new compression/extractor options correctly

### 15.3 Documentation + UX polish

* [ ] Update `README.md`:

  * [ ] Mention PDF/DOCX support and how to enable/disable
  * [ ] Mention optional performance backends and how `auto` works
* [ ] Update `docs/external-backends.md` for Tantivy/LanceDB reality (what’s implemented vs planned)
* [ ] Update `docs/mcp-server.md` for SDK migration

**Exit criteria**

* [ ] Benchmarks show measurable improvement (and are reproducible)
* [ ] CI remains green on Node 18 + Windows lane
* [ ] New features are discoverable via config docs + `config_status`

---

## Phase 17 — Hashing performance: optional native xxhash (`@node-rs/xxhash`) with `xxhash-wasm` fallback

### 17.1 Add dependency + unify backend contract

* [x] Add `@node-rs/xxhash` as optional dependency (or hard dep if you accept platform constraints)
* [x] Create `src/shared/hash/xxhash-backend.js`:

  * [x] `hash64(buffer|string) -> hex16` (exact output format must match existing `checksumString()` + `checksumFile()`)
  * [x] `hash64Stream(readable) -> hex16` (if supported; otherwise implement chunking in JS)
* [x] Update `src/shared/hash.js`:

  * [x] Keep `sha1()` unchanged
  * [x] Route `checksumString()` / `checksumFile()` through the backend contract
  * [x] Preserve deterministic formatting (`formatXxhashHex`)

### 17.2 Introduce selector + telemetry

* [x] Add `PAIROFCLEATS_XXHASH_BACKEND=auto|native|wasm`
* [ ] Emit backend choice in verbose logs (once)

### 17.3 Tests

* [x] Add `tests/xxhash-backends.js`:

  * [x] Assert `checksumString('abc')` matches a known baseline (record from current implementation)
  * [x] Assert `checksumFile()` matches `checksumString()` on same content (via temp file)
  * [x] If native backend is available, assert native and wasm match exactly
  * [x] If native is missing, ensure test still passes (skips “native parity” block)
* [x] Add script-coverage action(s)

**Exit criteria**

* [x] No change to bundle identity semantics (incremental cache stability)
* [x] `checksumFile()` remains bounded-memory for large files (streaming or chunked reads)

---

## Phase 18 — Safe regex acceleration: optional native RE2 (`re2`) with `re2js` fallback

### 18.1 Add dependency + backend wrapper

* [ ] Add `re2` (native) as an optional dependency (recommended)
* [ ] Refactor `src/shared/safe-regex.js` into a backend-based module:

  * [ ] Keep current behavior as the fallback backend (`re2js`)
  * [ ] Add `src/shared/safe-regex/backends/re2.js`
  * [ ] Add `src/shared/safe-regex/backends/re2js.js` (wrap existing usage cleanly)
* [ ] Preserve existing safety constraints:

  * [ ] `maxPatternLength`
  * [ ] `maxInputLength`
  * [ ] Guard flags normalization (only `gimsyu` supported as today)

### 18.2 Integrate selector + compatibility contract

* [ ] Add `createSafeRegex({ engine, ...limits })` selection:

  * [ ] `engine=auto` uses `re2` if available else `re2js`
  * [ ] `engine=re2` hard-requires native; if missing, returns a clear error (or a warning + fallback if you prefer)
* [ ] Validate behavioral parity:

  * [ ] Ensure `.exec()` and `.test()` match expectations for `g` and non-`g`
  * [ ] Ensure `.lastIndex` semantics are either compatible or explicitly *not supported* (and documented)

### 18.3 Update call sites

* [ ] Verify these flows still behave correctly:

  * [ ] `src/retrieval/output/filters.js` (file/path filters)
  * [ ] `src/retrieval/output/risk-tags.js` (risk tagging)
  * [ ] Any structural search / rulepack path using regex constraints

### 18.4 Tests

* [ ] Add `tests/safe-regex-engine.js`:

  * [ ] Conformance tests (flags, match groups, global behavior)
  * [ ] Safety limit tests (pattern length, input length)
  * [ ] Engine-selection tests (`auto`, forced `re2js`)
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] No user-visible semantic regressions in filtering/risk-tagging
* [ ] “Engine auto” is safe and silent (no noisy logs) unless verbose

---

## Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)

**Objective:** Make libuv threadpool sizing an explicit, validated, and observable runtime control so PairOfCleats I/O concurrency scales predictably across platforms and workloads.

### 19.1 Audit: identify libuv-threadpool-bound hot paths and mismatch points

* [ ] Audit all high-volume async filesystem call sites (these ultimately depend on libuv threadpool behavior):

  * [ ] `src/index/build/file-processor.js` (notably `runIo(() => fs.stat(...))`, `runIo(() => fs.readFile(...))`)
  * [ ] `src/index/build/file-scan.js` (`fs.open`, `handle.read`)
  * [ ] `src/index/build/preprocess.js` (file sampling + `countLinesForEntries`)
  * [ ] `src/shared/file-stats.js` (stream-based reads for line counting)
* [ ] Audit concurrency derivation points where PairOfCleats may exceed practical libuv parallelism:

  * [ ] `src/shared/threads.js` (`ioConcurrency = ioBase * 4`, cap 32/64)
  * [ ] `src/index/build/runtime/workers.js` (`createRuntimeQueues` pending limits)
* [ ] Decide and record the intended precedence rules for threadpool sizing:

  * [ ] Whether PairOfCleats should **respect an already-set `UV_THREADPOOL_SIZE`** (recommended, matching existing `NODE_OPTIONS` behavior where flags aren’t overridden if already present).

### 19.2 Add a first-class runtime setting + env override

* [ ] Add config key (new):

  * [ ] `runtime.uvThreadpoolSize` (number; if unset/invalid => no override)
* [ ] Add env override (new):

  * [ ] `PAIROFCLEATS_UV_THREADPOOL_SIZE` (number; same parsing rules as other numeric env overrides)
* [ ] Implement parsing + precedence:

  * [ ] Update `src/shared/env.js`

    * [ ] Add `uvThreadpoolSize: parseNumber(env.PAIROFCLEATS_UV_THREADPOOL_SIZE)`
  * [ ] Update `tools/dict-utils.js`

    * [ ] Extend `getRuntimeConfig(repoRoot, userConfig)` to resolve `uvThreadpoolSize` with precedence:

      * `userConfig.runtime.uvThreadpoolSize` → else `envConfig.uvThreadpoolSize` → else `null`
    * [ ] Clamp/normalize: floor to integer; require `> 0`; else `null`
    * [ ] Update the function’s return shape and JSDoc:

      * from `{ maxOldSpaceMb, nodeOptions }`
      * to `{ maxOldSpaceMb, nodeOptions, uvThreadpoolSize }`

### 19.3 Propagate `UV_THREADPOOL_SIZE` early enough (launcher + spawned scripts)

* [ ] Update `bin/pairofcleats.js` (critical path)

  * [ ] In `runScript()`:

    * [ ] Resolve `runtimeConfig` as today.
    * [ ] Build child env as an object (don’t pass `process.env` by reference when you need to conditionally add keys).
    * [ ] If `runtimeConfig.uvThreadpoolSize` is set and `process.env.UV_THREADPOOL_SIZE` is not set, add:

      * [ ] `UV_THREADPOOL_SIZE = String(runtimeConfig.uvThreadpoolSize)`
    * [ ] (Optional) If `--verbose` or `PAIROFCLEATS_VERBOSE`, log a one-liner showing the chosen `UV_THREADPOOL_SIZE` for the child process.
* [ ] Update other scripts that spawn Node subcommands and already apply runtime Node options, so they also carry the threadpool sizing consistently:

  * [ ] `tools/setup.js` (`buildRuntimeEnv()`)
  * [ ] `tools/bootstrap.js` (`baseEnv`)
  * [ ] `tools/ci-build-artifacts.js` (`baseEnv`)
  * [ ] `tools/bench-language-repos.js` (repo child env)
  * [ ] `tests/bench.js` (bench child env when spawning search/build steps)
  * [ ] `tools/triage/context-pack.js`, `tools/triage/ingest.js` (where `resolveNodeOptions` is used)
  * Implementation pattern: wherever you currently do `{ ...process.env, NODE_OPTIONS: resolvedNodeOptions }`, also conditionally set `UV_THREADPOOL_SIZE` from `runtimeConfig.uvThreadpoolSize` if not already present.

> (Optional refactor, if you want to reduce repetition): add a helper in `tools/dict-utils.js` like `resolveRuntimeEnv(runtimeConfig, baseEnv)` and migrate the call sites above to use it.

### 19.4 Observability: surface “configured vs effective” values

* [ ] Update `tools/config-dump.js`

  * [ ] Include in `payload.derived.runtime`:

    * [ ] `uvThreadpoolSize` (configured value from `getRuntimeConfig`)
    * [ ] `effectiveUvThreadpoolSize` (from `process.env.UV_THREADPOOL_SIZE` or null/undefined if absent)
* [ ] Add runtime warnings in indexing startup when mismatch is likely:

  * [ ] Update `src/index/build/runtime/workers.js` (in `resolveThreadLimitsConfig`, verbose mode is already supported)

    * [ ] Compute `effectiveUv = Number(process.env.UV_THREADPOOL_SIZE) || null`
    * [ ] If `effectiveUv` is set and `ioConcurrency` is materially larger, emit a single warning suggesting alignment.
    * [ ] If `effectiveUv` is not set, consider a *non-fatal* hint when `ioConcurrency` is high (e.g., `>= 16`) and `--verbose` is enabled.
* [ ] (Services) Emit one-time startup info in long-running modes:

  * [ ] `tools/api-server.js`
  * [ ] `tools/indexer-service.js`
  * [ ] `tools/mcp-server.js`
  * Log: effective `UV_THREADPOOL_SIZE`, and whether it was set by PairOfCleats runtime config or inherited from the environment.

### 19.5 Documentation updates

* [ ] Update env overrides doc:

  * [ ] `docs/env-overrides.md`

    * [ ] Add `PAIROFCLEATS_UV_THREADPOOL_SIZE`
    * [ ] Explicitly note: libuv threadpool size must be set **before the Node process starts**; PairOfCleats applies it by setting `UV_THREADPOOL_SIZE` in spawned child processes (via `bin/pairofcleats.js` and other tool launchers).
* [ ] Update config docs:

  * [ ] `docs/config-schema.json` add `runtime.uvThreadpoolSize`
  * [ ] `docs/config-inventory.md` add `runtime.uvThreadpoolSize (number)`
  * [ ] `docs/config-inventory.json` add entry for `runtime.uvThreadpoolSize`
* [ ] Update setup documentation:

  * [ ] `docs/setup.md` add a short “Performance tuning” note:

    * [ ] When indexing large repos or using higher `--threads`, consider setting `runtime.uvThreadpoolSize` (or `PAIROFCLEATS_UV_THREADPOOL_SIZE`) to avoid libuv threadpool becoming the limiting factor.
* [ ] (Optional) Add a benchmark note:

  * [ ] `docs/benchmarks.md` mention that benchmarking runs should control `UV_THREADPOOL_SIZE` for reproducibility.

### 19.6 Tests: schema validation + env propagation

* [ ] Update config validation tests:

  * [ ] `tests/config-validate.js` ensure `runtime.uvThreadpoolSize` is accepted by schema validation.
* [ ] Add a focused propagation test:

  * [ ] New: `tests/uv-threadpool-env.js`

    * [ ] Create a temp repo dir with a `.pairofcleats.json` that sets `runtime.uvThreadpoolSize`.
    * [ ] Run: `node bin/pairofcleats.js config dump --json --repo <temp>`
    * [ ] Assert:

      * `payload.derived.runtime.uvThreadpoolSize` matches the config
      * `payload.derived.runtime.effectiveUvThreadpoolSize` matches the propagated env (or check `process.env.UV_THREADPOOL_SIZE` if you expose it directly in the dump)
* [ ] Add a non-override semantics test (if that’s the decided rule):

  * [ ] New: `tests/uv-threadpool-no-override.js`

    * [ ] Set parent env `UV_THREADPOOL_SIZE=…`
    * [ ] Also set config `runtime.uvThreadpoolSize` to a different value
    * [ ] Assert child sees the parent value (i.e., wrapper respects existing env)

**Exit criteria**

* [ ] `runtime.uvThreadpoolSize` is in schema + inventory and validated by `tools/validate-config.js`.
* [ ] `pairofcleats …` launches propagate `UV_THREADPOOL_SIZE` to child processes when configured.
* [ ] Users can confirm configured/effective behavior via `pairofcleats config dump --json`.
* [ ] Docs clearly explain when and how the setting applies.

---

## Phase 20 — Threadpool-aware I/O scheduling guardrails

**Objective:** Reduce misconfiguration risk by aligning PairOfCleats internal I/O scheduling with the effective libuv threadpool size and preventing runaway pending I/O buildup.

### 20.1 Add a “threadpool-aware” cap option for I/O queue sizing

* [ ] Add config (optional, but recommended if you want safer defaults):

  * [ ] `indexing.ioConcurrencyCap` (number) **or** `runtime.ioConcurrencyCap` (number)
  * Choose the namespace based on your ownership map (`docs/config-inventory-notes.md` suggests runtime is `tools/dict-utils.js`, indexing is build runtime).
* [ ] Implement in:

  * [ ] `src/shared/threads.js` (preferred, because it’s the canonical concurrency resolver)

    * [ ] After computing `ioConcurrency`, apply:

      * `ioConcurrency = min(ioConcurrency, ioConcurrencyCap)` when configured
      * (Optional) `ioConcurrency = min(ioConcurrency, effectiveUvThreadpoolSize)` when a new boolean is enabled, e.g. `runtime.threadpoolAwareIo === true`
  * [ ] `src/index/build/runtime/workers.js`

    * [ ] Adjust `maxIoPending` to scale from the *final* `ioConcurrency`, not the pre-cap value.

### 20.2 Split “filesystem I/O” from “process I/O” (optional, higher impact)

If profiling shows git/tool subprocess work is being unnecessarily throttled by a threadpool-aware cap:

* [ ] Update `src/shared/concurrency.js` to support two queues:

  * [ ] `fs` queue (bounded by threadpool sizing)
  * [ ] `proc` queue (bounded separately)
* [ ] Update call sites:

  * [ ] `src/index/build/file-processor.js`

    * [ ] Use `fsQueue` for `fs.stat`, `fs.readFile`, `fs.open`
    * [ ] Use `procQueue` for `getGitMetaForFile` (and any other spawn-heavy steps)
  * [ ] `src/index/build/runtime/workers.js` and `src/index/build/indexer/steps/process-files.js`

    * [ ] Wire new queues into runtime and shard runtime creation.

### 20.3 Tests + benchmarks

* [ ] Add tests that validate:

  * [ ] Caps are applied deterministically
  * [ ] Pending limits remain bounded
  * [ ] No deadlocks when both queues exist
* [ ] Update or add a micro-benchmark to show:

  * [ ] Throughput difference when `UV_THREADPOOL_SIZE` and internal `ioConcurrency` are aligned vs misaligned.

**Exit criteria**

* [ ] Internal I/O concurrency cannot silently exceed intended caps.
* [ ] No regression in incremental/watch mode stability.
* [ ] Benchmarks show either improved throughput or reduced memory/queue pressure (ideally both).

---

## Phase 21 — (Conditional) Native LibUV work: only if profiling proves a real gap

**Objective:** Only pursue *direct* libuv usage (via a native addon) if profiling demonstrates a material bottleneck that cannot be addressed through configuration and queue hygiene.

### 21.1 Profiling gate and decision record

* [ ] Add a short profiling harness / guidance doc:

  * [ ] `docs/perf-profiling.md` (new) describing how to profile indexing (CPU + I/O wait) and what thresholds justify native work.
* [ ] Establish decision criteria (example):

  * [ ] If ≥20–30% wall time is spent in JS-level file scanning/reading overhead beyond disk throughput limits, consider native.
  * [ ] Otherwise, stay in JS + threadpool tuning.

### 21.2 Prototype native module (N-API) using libuv for a specific hot path

* [ ] Only target one narrow, measurable function (examples):

  * [ ] Fast “sample read + binary/minified detection” replacing parts of `src/index/build/file-scan.js`
  * [ ] Batched `stat + read` pipeline for small files
* [ ] Provide a clean fallback path to existing JS implementation.
* [ ] Add CI coverage for:

  * [ ] Linux/macOS/Windows builds (or prebuilds)
  * [ ] ABI compatibility across supported Node versions

### 21.3 Packaging and docs

* [ ] Update:

  * [ ] `package.json` optionalDependencies/build tooling (node-gyp/prebuildify/etc.)
  * [ ] `docs/setup.md` to explain native build requirements/fallback behavior

**Exit criteria**

* [ ] Prototype demonstrates measurable improvement on representative repos.
* [ ] Install friction and cross-platform maintenance cost are explicitly accepted (or the work is abandoned).

#### 18 Bottom line

* **Do not add libuv directly** to this Node codebase.
* **Do add explicit support for libuv threadpool sizing** (via `UV_THREADPOOL_SIZE`) because the current concurrency model (notably `ioConcurrency` up to 64) strongly suggests you will otherwise hit an invisible throughput ceiling.

---

## Phase 22 — Embeddings & ANN (onnx/HNSW/batching/candidate sets)

**Objective:** harden the embeddings + ANN stack for correctness, determinism (where required), performance, and resilient fallbacks across **index build**, **build-embeddings tooling**, and **retrieval-time ANN execution**.

### 22.1 Correctness

#### 22.1.1 Model identity (cache keys, preprocessing, normalization, dims)

##### Current state (verified)
- [x] Tooling cache keys include **file hash** + **chunk signature** + **embedding identity** (`tools/build-embeddings/cache.js`, `tools/build-embeddings/run.js`).
- [x] Tooling includes **dims mismatch guardrails** with explicit hard-fail paths and tests (`tools/build-embeddings/embed.js`, `tests/embeddings-dims-mismatch.js`, `tests/embeddings-dims-validation.js`).

##### Remaining gaps / action items
- [ ] **Expand embedding identity to include preprocessing + provider-specific knobs**, not just `{modelId, provider, mode, stub, dims, scale}`:
  - Why: changing `onnx` tokenizer/model path or execution provider can change embeddings without changing `modelId`/`provider`, allowing silent cache reuse.
  - Files:
    - `tools/build-embeddings/cache.js` (identity schema)
    - `tools/build-embeddings/run.js` (identity inputs)
  - Add fields (at minimum):
    - ONNX: `onnx.modelPath` (resolved), `onnx.tokenizerId`, `onnx.executionProviders`, `onnx.threads`, `onnx.graphOptimizationLevel`
    - Common: pooling strategy (mean), `normalize=true`, truncation/max_length policy
    - Quantization: `minVal/maxVal` (currently fixed -1..1), quantization “version”
- [ ] **Include a tooling/version fingerprint in cache identity** (or bumpable `identity.version`) so cache invalidates when embedding algorithm changes:
  - Why: changes to doc extraction, pooling logic, quantization, or merging should invalidate caches even if file hashes are unchanged.
  - Files: `tools/build-embeddings/cache.js`, optionally `tools/build-embeddings/chunks.js`
- [ ] **Add strict provider validation**: unknown `indexing.embeddings.provider` should not silently map to `xenova`.
  - Why: silent fallback can produce “correct-looking” but unintended embeddings and cache identity mismatch.
  - Files: `src/shared/onnx-embeddings.js` (normalizeEmbeddingProvider), `src/index/embedding.js`, `tools/build-embeddings/cli.js`, `src/retrieval/embedding.js`
- [ ] **Unify default stub embedding dimensions across build + retrieval + tooling** (currently inconsistent defaults: 384 vs 512).
  - Why: any code path that calls stub embeddings without an explicit `dims` risks producing query embeddings that cannot match the index dims.
  - Files: `src/shared/embedding.js` (defaults to 512), `src/index/embedding.js` (defaults to 384), `tools/build-embeddings/run.js` (defaults to 384), `src/retrieval/embedding.js` (passes `dims`, but can pass null in some ANN-only paths).
  - Recommendation: pick **384** as the single default everywhere OR require dims explicitly in stub mode and fail loudly if missing.
- [ ] **Index-build (inline) path lacks explicit dims mismatch failure** comparable to build-embeddings tool:
  - `src/index/build/file-processor/embeddings.js` currently coerces unexpected shapes to empty arrays and proceeds.
  - Add an explicit “dims contract” check and fail fast (or disable embeddings) if:
    - vectors are not arrays/typed arrays,
    - dims are inconsistent across chunks,
    - batch output length mismatches input length.
- [ ] **Make per-file embedding cache writes atomic** (cache files are written with `fs.writeFile`):
  - Why: partial/corrupt cache JSON can cause repeated recompute; while not “poisoning,” it degrades throughput and can mask real failures.
  - Files: `tools/build-embeddings/run.js` (cache writes), optionally reuse `tools/build-embeddings/atomic.js` or shared atomic writer.

**Exit criteria**
- [ ] Changing any embedding-relevant knob (model path/tokenizer/provider/normalization/pooling/quantization) forces cache miss.
- [ ] Dims mismatch fails loudly (or deterministically disables embeddings) in **both** build-embeddings and inline index-build paths.
- [ ] Stub-mode dims are consistent across indexing + retrieval.

---

#### 22.1.2 Determinism (float handling, batching order)

##### Current state (verified)
- [x] Quantization uses deterministic rounding (`src/index/embedding.js`).
- [x] Batched embedding retains input ordering in both tooling and index build (`tools/build-embeddings/embed.js`, `src/index/build/file-processor/embeddings.js`).

##### Remaining gaps / action items
- [ ] **Document and/or enforce determinism requirements for HNSW build**:
  - HNSW graph structure can vary with insertion order; current insertion order is “file processing order,” which depends on `Map` insertion order derived from chunk meta traversal.
  - Files: `tools/build-embeddings/run.js`, `tools/build-embeddings/hnsw.js`
  - Recommendation: ensure vectors are added to HNSW in a stable order (e.g., ascending `chunkIndex`).
- [ ] **Avoid nondeterministic file sampling in context window estimation**:
  - `src/index/build/context-window.js` uses the first N files in `files[]`; if upstream file enumeration order is OS-dependent, context window results can change.
  - Recommendation: sort file paths before sampling (or explicitly document nondeterminism).
- [ ] **Normalize float types across providers**:
  - Many paths convert typed arrays into JS arrays; this is deterministic but increases the surface for subtle differences and performance regressions.
  - Recommendation: standardize on `Float32Array` where feasible and only convert at serialization boundaries.

**Exit criteria**
- [ ] HNSW build is reproducible across runs given identical artifacts/config (or nondeterminism is clearly documented and accepted).
- [ ] Context window selection is stable given identical repo state.

---

#### 22.1.3 Robust fallback behavior (missing models/extensions/unsupported configs)

##### Current state (verified)
- [x] Retrieval embedding errors are caught and return `null` (`src/retrieval/embedding.js`), which allows the search pipeline to continue in sparse-only mode.
- [x] SQLite vector extension usage is guarded and can be disabled via sanitization (`tests/vector-extension-sanitize.js`).

##### Remaining gaps / action items
- [ ] **ONNX embedder config validation is partially ineffective**:
  - `src/shared/onnx-embeddings.js:createOnnxEmbedder()` checks `normalizeEmbeddingProvider('onnx') !== 'onnx'` which is a no-op (constant input).
  - Replace with validation of the *actual* requested provider (or remove the dead check).
- [ ] **Improve “missing model” errors with clear remediation** (especially for offline envs):
  - Recommend: explicitly mention `tools/download-models.js` and where the model path is expected.
  - Files: `src/shared/onnx-embeddings.js`, `src/index/embedding.js`
- [ ] **HNSW load path should fall back to `.bak` on corrupt primary**, not only when primary is missing:
  - Today: `src/shared/hnsw.js` only chooses `.bak` if primary missing; it does not retry `.bak` if `readIndexSync()` throws.
- [ ] **Use HNSW meta for safety checks**:
  - Retrieval load does not read `dense_vectors_hnsw.meta.json`, so it cannot validate `dims`, `space`, or `model` before querying.
  - Files: `src/shared/hnsw.js`
- [ ] **Add explicit tests for “extension missing” fallback**:
  - Currently there is sanitization coverage, but not “load failure / missing shared library” behavior.
  - Files/tests: `tools/build-embeddings/sqlite-dense.js` + new test.

**Exit criteria**
- [ ] Missing/corrupt HNSW artifacts do not crash retrieval; the system degrades gracefully to another ANN backend or sparse-only.
- [ ] Missing ONNX model artifacts fail with actionable errors (or clean fallback in non-strict modes).

---

### 22.2 Batching & scheduling

#### 22.2.1 Batch auto-tuning (memory/CPU/repo size)

##### Current state (verified)
- [x] Both index-build and build-embeddings tooling implement “auto batch” based on `os.totalmem()` (`src/index/build/runtime/embeddings.js`, `tools/build-embeddings/cli.js`).
- [x] Language-specific multipliers exist and are tested (`src/index/build/embedding-batch.js`, `tests/embedding-batch-multipliers.js`).

##### Remaining gaps / action items
- [ ] **Unify and justify auto-batch heuristics**:
  - Index-build uses `totalGb * 16` with min 16.
  - build-embeddings tool uses `totalGb * 32` with min 32.
  - Decide a single policy OR clearly document why they intentionally differ.
- [ ] **Incorporate CPU oversubscription controls**:
  - ONNX runtime can be multi-threaded (`threads` option), while the embedding queue can also be concurrent.
  - Add a policy: e.g., `embeddingConcurrency * onnxThreads <= cpuCount` (or document exceptions).
  - Files: `src/index/build/runtime/embeddings.js`, `src/shared/onnx-embeddings.js`
- [ ] **Adapt batch sizing to repo characteristics**:
  - For tiny repos/files, large batch sizes increase latency without improving throughput.
  - For huge repos, file-by-file batching underutilizes the accelerator (many small batches).
  - Recommendation: introduce a global “embedding batcher” that batches across files with:
    - max batch size,
    - max tokens/estimated memory per batch,
    - stable ordering.
  - Files impacted: `src/index/build/file-processor/embeddings.js`, `tools/build-embeddings/run.js`

**Exit criteria**
- [ ] Batch sizing + concurrency are predictable and safe across low-memory hosts, multi-core hosts, and both small and large repos.
- [ ] Default settings do not oversubscribe CPU when ONNX threads are enabled.

---

#### 22.2.2 Embedding queues (backpressure, bounded memory)

##### Current state (verified)
- [x] Service-mode job enqueue provides a `maxQueued` hook (`src/index/build/indexer/embedding-queue.js`).

##### Remaining gaps / action items
- [ ] **Define and enforce backpressure defaults**:
  - If `maxQueued` is unset/null, behavior depends on `enqueueJob()` (not in scope here); ensure a safe default exists.
  - Add explicit documentation + a test that verifies queue growth is bounded.
- [ ] **Ensure service jobs include enough identity to be safe**:
  - Job payload includes `{repo, mode}`, but not an embedding identity fingerprint.
  - Include `embeddingProvider`, model id, and/or a hash of embedding config to prevent mismatched worker configuration from producing incompatible embeddings.

**Exit criteria**
- [ ] Queue growth is bounded by default; overload produces clear errors and does not OOM the process.

---

#### 22.2.3 Session/model reuse

##### Current state (verified)
- [x] ONNX sessions are cached per normalized config (`src/shared/onnx-embeddings.js`).
- [x] Retrieval embedder instances are cached in-process (`src/retrieval/embedding.js`).

##### Remaining gaps / action items
- [ ] **Guard concurrent use of shared ONNX sessions if required**:
  - If `onnxruntime-node` sessions are not safe for concurrent `run()` calls, add a per-session mutex/queue.
  - At minimum: document thread-safety assumptions and add a stress test.
- [ ] **Avoid duplicate pipeline/session loads in index-build**:
  - `src/index/embedding.js` does not maintain a global cache similar to retrieval; if multiple embedder instances are constructed in one process, models may be loaded multiple times.

**Exit criteria**
- [ ] A single model/session is loaded once per process per config, and safely shared across all embedding calls.

---

### 22.3 ANN correctness

#### 22.3.1 Distance metric correctness (HNSW scoring)

##### Current state (verified)
- [x] HNSW ranker applies a stable tie-break (`idx`) after converting distances to similarity (`src/shared/hnsw.js`).

##### Remaining gaps / action items
- [ ] **Confirm and test distance-to-similarity conversion for each HNSW space** (`l2`, `cosine`, `ip`):
  - Current code treats `ip` the same as `cosine` (`sim = 1 - distance`).
  - This may be correct or incorrect depending on hnswlib’s distance definition for `ip`.
  - Required: add unit tests with known vectors and expected distances/similarities and adjust conversion if needed.
  - Files: `src/shared/hnsw.js`, new test (e.g., `tests/hnsw-distance-metrics.js`).

**Exit criteria**
- [ ] For each supported space, returned `sim` is monotonic with the true similarity notion used elsewhere in scoring.

---

#### 22.3.2 Atomic safety (no torn reads/writes)

##### Current state (verified)
- [x] Build writes HNSW `.bin` and `.meta.json` via atomic replace with `.bak` retention (`tools/build-embeddings/atomic.js`, `tools/build-embeddings/hnsw.js`).
- [x] There is a test that asserts `.bak` is created on replace (`tests/hnsw-atomic.js`).

##### Remaining gaps / action items
- [ ] **HNSW reader should support “corrupt primary” fallback**:
  - Implement: try primary, and if read fails, try `.bak` before giving up.
  - Files: `src/shared/hnsw.js`
- [ ] **Validate `.bin` / `.meta.json` pairing**:
  - Ensure meta file exists, parseable, and matches expected dims/space/model before using the index.
  - If mismatch, treat index as unavailable and fall back.

**Exit criteria**
- [ ] Retrieval never crashes due to a torn/corrupt HNSW file; fallback paths are exercised by tests.

---

#### 22.3.3 Candidate set semantics (HNSW + sqlite-vec)

##### Current state (verified)
- [x] SQLite candidate pushdown behavior is tested for small vs large candidate sets (`tests/sqlite-vec-candidate-set.js`).

##### Remaining gaps / action items
- [ ] **Handle empty candidate sets explicitly in HNSW path**:
  - `rankHnswIndex()` currently treats an empty set as “no filter” (because `candidateSet.size` is falsy), which can return results when none are desired.
  - Files: `src/shared/hnsw.js`
- [ ] **Document and test candidate-set cap behavior**:
  - HNSW uses a `candidateSetCap` default of 1000; ensure callers understand whether this can truncate results.
  - Add tests for:
    - empty set → empty hits,
    - small set → only those labels,
    - very large set → filter still applied and returned hits are subset, with stable ordering.
- [ ] **Align candidate-set tie-break behavior across backends**:
  - SQLite ANN tests require deterministic tie-break by `rowid`.
  - HNSW already tie-breaks by `idx`. Ensure both are consistent with retrieval expectations.

**Exit criteria**
- [ ] Candidate sets behave identically (semantically) across ANN backends: never return items outside the set, deterministic ordering for ties, predictable truncation rules.

---

### 22.4 Performance improvements to prioritize

#### 22.4.1 Float32Array end-to-end (avoid JS arrays of floats)
- [ ] **Standardize the embedding contract to return `Float32Array`**:
  - Files: `src/index/embedding.js`, `src/retrieval/embedding.js`, `src/shared/onnx-embeddings.js`, `src/shared/embedding.js`
- [ ] **Update downstream code to accept typed arrays** (don’t gate on `Array.isArray`):
  - Files: `src/index/build/file-processor/embeddings.js`, `tools/build-embeddings/embed.js`, `tools/build-embeddings/run.js`, `tools/build-embeddings/hnsw.js`
- [ ] **Defer conversion to JS arrays only at serialization boundaries** (JSON writing).

#### 22.4.2 Minimize serialization between threads/processes (transferable buffers)
- [ ] Where embeddings are computed in worker threads/processes (service mode), prefer:
  - transferring `ArrayBuffer`/`SharedArrayBuffer` instead of JSON arrays,
  - or using binary packed formats for vectors.
- [ ] Add an explicit “embedding payload format” version in job payloads so workers and callers stay compatible.
  - File touchpoints: `src/index/build/indexer/embedding-queue.js` (job payload)

#### 22.4.3 Pre-allocate and reuse buffers
- [ ] **ONNX embedding path**:
  - Avoid per-call allocations:
    - re-use `BigInt64Array` buffers for token ids/masks where shapes are stable,
    - avoid `Array.from()` conversions for slices.
  - Files: `src/shared/onnx-embeddings.js`
- [ ] **Index-build merge path**:
  - Avoid allocating a new zero vector per chunk in `attachEmbeddings()`.
  - File: `src/index/build/file-processor/embeddings.js`

#### 22.4.4 Candidate generation tuning
- [ ] Push sparse filters earlier and reduce dense scoring work:
  - prefer ANN-restricted candidate sets before dense dot products,
  - prefer pushing candidate constraints into sqlite-vec queries when small enough (already partially implemented).
  - (Some of this lives outside the reviewed file list; track as cross-cutting work.)

**Exit criteria**
- [ ] Embedding pipelines avoid unnecessary conversions/allocations; measurable CPU and memory reductions on large repos.
- [ ] ANN candidate generation demonstrably reduces dense scoring load for common queries.

---

### 22.5 Refactoring goals

#### 22.5.1 Single embedding interface shared by build + retrieval
- [ ] Create a single shared adapter interface, e.g.:
  - `embed(texts: string[], opts) => Float32Array[]`
  - `embedOne(text: string, opts) => Float32Array`
- [ ] Move provider selection + error handling behind adapters:
  - `xenova`, `onnx`, `stub`.
- [ ] Ensure both index-build and retrieval use the same adapter and the same preprocessing defaults.

#### 22.5.2 Centralize normalization & preprocessing
- [ ] Eliminate duplicated `normalizeVec()` implementations:
  - `src/index/embedding.js`
  - `src/shared/onnx-embeddings.js`
  - `tools/build-embeddings/embed.js` (indirectly uses index/embedding normalization)
- [ ] Centralize:
  - pooling strategy,
  - normalization strategy,
  - truncation/max_length policy,
  - doc/code merge policy.

#### 22.5.3 Clear ANN backend adapters
- [ ] Wrap sqlite-vec and HNSW behind a single “ANN adapter” contract with:
  - candidate set semantics,
  - deterministic tie-break contract,
  - consistent error handling and stats reporting.
  - (Some of this lives outside the reviewed file list.)

**Exit criteria**
- [ ] Build + retrieval cannot diverge in embedding shape/normalization/pooling without a deliberate, versioned change.
- [ ] ANN behavior is consistent regardless of backend.

---

### 22.6 Tests

#### 22.6.1 Coverage checklist

##### Already covered (verified)
- [x] Cache identity/invalidation (baseline) — `tests/embeddings-cache-identity.js`, `tests/embeddings-cache-invalidation.js`
- [x] Dims mismatch (tooling) — `tests/embeddings-dims-mismatch.js`, `tests/embeddings-dims-validation.js`
- [x] ANN candidate set correctness (sqlite-vec) — `tests/sqlite-vec-candidate-set.js`
- [x] HNSW artifacts existence + atomic replace — `tests/hnsw-ann.js`, `tests/hnsw-atomic.js`

##### Missing / needs additions
- [ ] **Cache identity tests must cover provider-specific knobs**, especially ONNX config:
  - Add tests proving that changing `onnx.tokenizerId` or `onnx.modelPath` changes identityKey and forces cache miss.
- [ ] **Add extension missing/fallback tests**:
  - Simulate vector extension load failure and ensure build/search does not crash and disables vector ANN.
- [ ] **Add HNSW candidate set tests**:
  - empty set returns empty hits,
  - filter does not leak labels,
  - tie-break stability.
- [ ] **Add HNSW `.bak` fallback tests**:
  - corrupt primary index/meta triggers `.bak` load and does not crash.
- [ ] **Add performance regression test for embedding batching throughput** (required by checklist):
  - Recommended approach (stable in CI):
    - Use a synthetic embedder function with a fixed per-call overhead + per-item cost.
    - Assert that `runBatched()` with batchSize>1 achieves >= X% speedup vs batchSize=1 on a fixed input size.
    - Use generous thresholds to avoid flakiness; focus on catching *major* regressions (e.g., accidental O(n²) behavior or disabling batching).
  - Candidate target: `tools/build-embeddings/embed.js:runBatched()` and/or `src/index/build/file-processor/embeddings.js` batching path.

**Exit criteria**
- [ ] Tests fail if embedding identity changes are not reflected in cache keys.
- [ ] Tests cover ANN candidate set semantics for both sqlite-vec and HNSW.
- [ ] At least one performance regression test exists for batching throughput.

---

### Appendix A — File-by-file review notes (actionable items)

> The checklist items above are the canonical “what to fix.” This appendix maps concrete file-level changes back to those items.

#### src

##### `src/index/build/context-window.js`
- [ ] Sort/sanitize file list before sampling to reduce OS-dependent nondeterminism.
- [ ] Consider documenting that context-window estimation is heuristic and may vary with sampling strategy.

##### `src/index/build/embedding-batch.js`
- [ ] Consider parsing `baseSize` if it may come from config as a numeric string.
- [ ] Add explicit documentation for multiplier precedence (fallback vs user config).

##### `src/index/build/file-processor/embeddings.js`
- [ ] Add dims contract validation (non-empty vectors must share dims; fail fast otherwise).
- [ ] Support `Float32Array` outputs (don’t rely on `Array.isArray`).
- [ ] Avoid allocating `new Array(dims).fill(0)` per chunk; reuse a single `zeroVec`.
- [ ] Validate that `getChunkEmbeddings(texts).length === texts.length`; if not, log + fail or retry with a clear warning.
- [ ] Ensure doc embedding results are length-aligned with `docPayloads` (currently assumes perfect alignment).

##### `src/index/build/indexer/embedding-queue.js`
- [ ] Include embedding identity/config hash in job payload to prevent mismatched worker behavior.
- [ ] Consider switching job IDs to `crypto.randomUUID()` for collision resistance.
- [ ] Ensure `maxQueued` has a safe default; document backpressure behavior.

##### `src/index/build/runtime/embeddings.js`
- [ ] Reconcile auto-batch policy with tooling (`tools/build-embeddings/cli.js`).
- [ ] Consider incorporating ONNX thread settings into concurrency auto-tune to avoid oversubscription.

##### `src/index/embedding.js`
- [ ] Centralize `normalizeVec`/`quantizeVec` into shared utilities; remove duplication.
- [ ] Add strict provider validation (unknown provider should error/warn).
- [ ] Harden `normalizeBatchOutput()` to:
  - guarantee output length equals input count,
  - handle unexpected tensor dims more defensively,
  - avoid returning a single huge vector when output is 3D.
- [ ] Prefer returning `Float32Array` (or at least accept typed arrays downstream).

##### `src/retrieval/embedding.js`
- [ ] Use a normalized/fingerprinted ONNX config in the embedder cache key (avoid JSON-order sensitivity).
- [ ] If retrieval can request embeddings without known dims (ANN-only paths), require dims or ensure consistent default dims.
- [ ] Consider logging embedder load failures once (rate-limited) to aid debugging.

##### `src/shared/embedding.js`
- [ ] Unify stub default dims with the rest of the system (recommend 384).
- [ ] Optionally return `Float32Array` to match the desired end-to-end contract.

##### `src/shared/hnsw.js`
- [ ] Implement `.bak` fallback when the primary index exists but is corrupt/unreadable.
- [ ] Read/validate `dense_vectors_hnsw.meta.json` to confirm `dims/space/model` before using the index.
- [ ] Handle empty candidate sets explicitly by returning `[]`.
- [ ] Add unit tests for distance conversion across spaces (l2/cosine/ip) and adjust similarity conversion if required.

##### `src/shared/onnx-embeddings.js`
- [ ] Remove/fix dead provider check (`normalizeEmbeddingProvider('onnx')`).
- [ ] Add clearer error messaging for missing model artifacts + remediation steps.
- [ ] Improve performance by avoiding heavy array conversions and by reusing buffers/tensors.
- [ ] Consider concurrency guards around `session.run()` if onnxruntime sessions are not safe concurrently.

---

#### tools

##### `tools/build-embeddings.js`
- No issues observed beyond those in underlying implementation modules.

##### `tools/build-embeddings/atomic.js`
- [ ] Consider consolidating atomic replace logic with `src/shared/json-stream.js` to avoid divergence (optional refactor).

##### `tools/build-embeddings/cache.js`
- [ ] Expand identity schema to include preprocessing and provider-specific config (especially ONNX knobs).
- [ ] Add a bumpable “identity version” or build-tool version fingerprint.

##### `tools/build-embeddings/chunks.js`
- [ ] Consider incorporating doc-related signals into the chunk signature (or into identity versioning) so doc embedding caches invalidate when doc extraction logic changes.
- [ ] Consider normalizing `start/end` to finite numbers before signature generation (avoid stringifying `undefined`).

##### `tools/build-embeddings/cli.js`
- [ ] Document (or change) the behavior where `mode=service` is coerced to `inline` for this tool.
- [ ] Unify auto-batch defaults with index-build runtime (or document why they differ).

##### `tools/build-embeddings/embed.js`
- [ ] Update to accept and return typed arrays (`Float32Array`) instead of insisting on JS arrays.
- [ ] Consider failing fast on non-vector outputs instead of silently returning `[]` entries (to avoid quietly producing all-zero embeddings).

##### `tools/build-embeddings/hnsw.js`
- [ ] Ensure stable vector insertion order into HNSW (ascending chunkIndex).
- [ ] When adding vectors reconstructed from cache (dequantized), consider re-normalizing for cosine space to reduce drift.

##### `tools/build-embeddings/manifest.js`
- [ ] Consider reading HNSW meta to report accurate `count`/`dims` for ANN piece files, rather than relying on `totalChunks` (defensive correctness).

##### `tools/build-embeddings/run.js`
- [ ] Make cache writes atomic (optional but recommended).
- [ ] Use `Number.isFinite()` for chunk start/end to avoid 0/NaN edge cases from `||` coercion.
- [ ] Apply `ensureVectorArrays()` to embedded doc batches just like code batches.
- [ ] Make HNSW build deterministic (stable insertion order).
- [ ] Consider adding a global cross-file batcher for throughput.

##### `tools/build-embeddings/sqlite-dense.js`
- [ ] Add tests for “vector extension missing/failed to load” fallback behavior.
- [ ] Consider batching inserts in larger chunks or using prepared statements more aggressively for performance on large vector sets.

##### `tools/compare-models.js`
- [ ] If comparing ONNX vs xenova providers, ensure the script can capture and report provider config differences (identity) to interpret deltas correctly (minor enhancement).

##### `tools/download-models.js`
- [ ] Consider supporting explicit download of ONNX model artifacts when users rely on `indexing.embeddings.provider=onnx` and custom `onnx.modelPath`.
- [ ] Improve output to show where models were cached and what to set in config if needed.

---

#### tests

##### `tests/build-embeddings-cache.js`
- [ ] Extend to assert cache identity changes for ONNX config changes (once identity schema is expanded).

##### `tests/embedding-batch-autotune.js`
- [ ] Consider loosening or documenting assumptions about minimum batch size on low-memory systems (or adjust runtime min to match test expectations).

##### `tests/embedding-batch-multipliers.js`
- No issues; good coverage of multiplier normalization.

##### `tests/embeddings-cache-identity.js`
- [ ] Extend to cover ONNX-specific identity fields (tokenizerId/modelPath/etc).

##### `tests/embeddings-cache-invalidation.js`
- [ ] Add invalidation scenarios tied to preprocessing knobs (pooling/normalize/max_length) once surfaced in identity.

##### `tests/embeddings-dims-mismatch.js`
- Good.

##### `tests/embeddings-dims-validation.js`
- Good.

##### `tests/embeddings-sqlite-dense.js`
- [ ] Add coverage for vector extension load failure paths (extension missing), not only baseline dense sqlite insertions.

##### `tests/embeddings-validate.js`
- Good baseline index-state + artifact validation coverage.

##### `tests/hnsw-ann.js`
- [ ] Add correctness assertions beyond “backend selected”:
  - candidate set filtering (once exposed),
  - tie-break determinism,
  - sanity check of returned ordering for a known query on fixture corpus.

##### `tests/hnsw-atomic.js`
- [ ] Add test for `.bak` fallback on corrupt primary index/meta (reader-side).

##### `tests/smoke-embeddings.js`
- Good smoke harness; consider adding new tests to this suite after implementing performance regression and fallback tests.

##### `tests/sqlite-vec-candidate-set.js`
- [ ] Add a column-name sanitization test (table is covered; column is not).

##### `tests/vector-extension-sanitize.js`
- Good table sanitization coverage; extend for column sanitization as above.

---

## Phase 23 — Index analysis features (metadata/risk/git/type-inference) — Review findings & remediation checklist

**Objective:** Review the Section 4 file set (56 files) and produce a concrete, exhaustive remediation checklist that (1) satisfies the provided Phase 4 checklist (A–G) and (2) captures additional defects, inconsistencies, and improvements found during review.

**Scope:** All files enumerated in `pairofcleats_review_section_4_files_and_checklist.md` (src/tests/docs).  
**Out of scope:** Implementing fixes in-code (this document is a work plan / punch list).

---

### Summary (priority ordered)

#### P0 — Must fix (correctness / crash / schema integrity)

- [ ] **Risk rules regex compilation is currently mis-wired.** `src/index/risk-rules.js` calls `createSafeRegex()` with an incorrect argument signature, so rule regex configuration (flags, limits) is not applied, and invalid patterns can throw and abort normalization.  
  - Fix in: `src/index/risk-rules.js` (see §B.1).
- [ ] **Risk analysis can crash indexing on long lines.** `src/index/risk.js` calls SafeRegex `test()` / `exec()` without guarding against SafeRegex input-length exceptions. One long line can throw and fail the whole analysis pass.  
  - Fix in: `src/index/risk.js` (see §B.2).
- [ ] **Metadata v2 drops inferred/tooling parameter types (schema data loss).** `src/index/metadata-v2.js` normalizes type maps assuming values are arrays; nested maps (e.g., `inferredTypes.params.<name>[]`) are silently discarded.  
  - Fix in: `src/index/metadata-v2.js` + tests + schema/docs (see §A.1–A.4).

#### P1 — Should fix (determinism, performance, docs, validation gaps)

- [ ] **`metaV2` validation is far too shallow and does not reflect the actual schema shape.** `src/index/validate.js` only validates a tiny subset of fields and does not traverse nested type maps.  
- [ ] **Docs drift:** `docs/metadata-schema-v2.md` and `docs/risk-rules.md` do not fully match current code (field names, structures, and configuration).  
- [ ] **Performance risks:** risk scanning does redundant passes and does not short-circuit meaningfully when capped; markdown parsing is duplicated (inline + fenced); tooling providers re-read files rather than reusing already-loaded text.

#### P2 — Nice to have (quality, maintainability, test depth)

- [ ] Improve signature parsing robustness for complex types (C-like, Python, Swift).
- [ ] Clarify and standardize naming conventions (chunk naming vs provider symbol naming, “generatedBy”, “embedded” semantics).
- [ ] Expand tests to cover surrogate pairs (emoji), CRLF offsets, and risk rules/config edge cases.

---

### A) Metadata v2: correctness, determinism, and validation

#### Dependency guidance (best choices)
- `ajv` — encode **metadata-schema-v2** as JSON Schema and validate `metaV2` as a hard gate in `tools/index-validate` (or equivalent).  
- `semver` — version `metaV2.schemaVersion` independently and gate readers/writers.

#### A.1 `metaV2.types` loses nested inferred/tooling param types (P0)

##### Affected files
- `src/index/metadata-v2.js`
- `docs/metadata-schema-v2.md`
- `src/index/validate.js`
- `tests/metadata-v2.js`

##### Findings
- [ ] **Data loss bug:** `normalizeTypeMap()` assumes `raw[key]` is an array of entries. If `raw[key]` is an object map (e.g., `raw.params` where `raw.params.<paramName>` is an array), it is treated as non-array and dropped.  
  - Evidence: `normalizeTypeMap()` (lines ~78–91) only normalizes `Array.isArray(entries)` shapes.
- [ ] **Downstream effect:** `splitToolingTypes()` is applied to `docmeta.inferredTypes`; because nested shapes are not handled, **tooling-derived param types will not appear in `metaV2.types.tooling.params`**, and inferred param types will be absent from `metaV2.types.inferred.params`.

##### Required remediation
- [ ] Update `normalizeTypeMap()` to support nested “param maps” (and any similar nested structures) rather than dropping them. A pragmatic approach:
  - [ ] If `entries` is an array → normalize as today.
  - [ ] If `entries` is an object → treat it as a nested map and normalize each subkey:
    - preserve the nested object shape in output (preferred), or
    - flatten with a predictable prefix strategy (only if schema explicitly adopts that).
- [ ] Update `splitToolingTypes()` so it correctly separates tooling vs non-tooling entries **inside nested maps** (e.g., `params.<name>[]`, `locals.<name>[]`).
- [ ] Update `tests/metadata-v2.js` to assert:
  - [ ] inferred param types survive into `metaV2.types.inferred.params.<paramName>[]`
  - [ ] tooling param types survive into `metaV2.types.tooling.params.<paramName>[]`
  - [ ] non-tooling inferred types do not leak into tooling bucket (and vice versa)

#### A.2 Declared types coverage is incomplete (P1)

##### Findings
- [ ] `buildDeclaredTypes()` currently only materializes:
  - param annotations via `docmeta.paramTypes`
  - return annotation via `docmeta.returnType`  
  It does **not** cover:
  - [ ] parameter defaults (`docmeta.paramDefaults`)
  - [ ] local types (`docmeta.localTypes`)
  - [ ] any other declared type sources the codebase may already emit

##### Required remediation
- [ ] Decide which “declared” facets are part of Metadata v2 contract and implement them consistently (and document them):
  - [ ] `declared.defaults` (if desired)
  - [ ] `declared.locals` (if desired)
- [ ] Update `docs/metadata-schema-v2.md` accordingly.
- [ ] Add tests in `tests/metadata-v2.js` for any newly included declared facets.

#### A.3 Determinism and stable ordering in `metaV2` (P1)

##### Findings
- [ ] Several arrays are produced via Set insertion order (e.g., `annotations`, `params`, `risk.tags`, `risk.categories`). While *often* stable, they can drift if upstream traversal order changes.
- [ ] `metaV2` mixes optional `null` vs empty collections inconsistently across fields (some fields null, others empty arrays). This matters for artifact diffs and schema validation.

##### Required remediation
- [ ] Standardize ordering rules for arrays that are semantically sets:
  - [ ] Sort `annotations` (lexicographic) before emitting.
  - [ ] Sort `params` (lexicographic) before emitting.
  - [ ] Sort risk `tags`/`categories` (lexicographic) before emitting.
- [ ] Establish a consistent “empty means null” vs “empty means []” policy for v2 and enforce it in `buildMetaV2()` and schema/docs.

#### A.4 `generatedBy` and `embedded` semantics are unclear (P2)

##### Findings
- [ ] `generatedBy` currently uses `toolInfo?.version` only; if `tooling` already contains `tool` and `version`, this can be redundant and underspecified.
- [ ] `embedded` is emitted whenever `chunk.segment` exists, even when the segment is not embedded (parentSegmentId may be null). This makes the field name misleading.

##### Required remediation
- [ ] Decide and document the intended meaning:
  - [ ] Option A: `generatedBy = "<tool>@<version>"` and keep `tooling` for structured detail.
  - [ ] Option B: remove `generatedBy` and rely solely on `tooling`.
- [ ] Restrict `embedded` field to truly-embedded segments only **or** rename the field to something like `segmentContext` / `embedding`.

#### A.5 Validation gaps for Metadata v2 (P1)

##### Findings (in `src/index/validate.js`)
- [ ] `validateMetaV2()` (lines ~162–206) validates only:
  - `chunkId` presence
  - `file` presence
  - `risk.flows` has `source` and `sink`
  - type entries have `.type` for a shallow, array-only traversal  
  It does **not** validate:
  - [ ] `segment` object shape
  - [ ] range/start/end types and ordering invariants
  - [ ] `lang`, `ext`, `kind`, `name` constraints
  - [ ] nested types map shapes (params/locals)
  - [ ] `generatedBy`/`tooling` shape and required fields
  - [ ] cross-field invariants (e.g., range within segment, embedded context consistency)

##### Required remediation
- [ ] Establish **one canonical validator** for `metaV2` (preferably schema-based):
  - [ ] Add an explicit JSON Schema for v2 (in docs or tooling directory).
  - [ ] Validate `metaV2` against the schema in `validateIndexArtifacts()`.
- [ ] If schema-based validation is not yet possible, expand `validateMetaV2()` to:
  - [ ] traverse nested `params`/`locals` maps for type entries
  - [ ] validate `range` numbers, monotonicity, and non-negativity
  - [ ] validate the presence/type of stable core fields as defined in `docs/metadata-schema-v2.md`
- [ ] Add tests (or fixtures) that exercise validation failures for each major failure class.

#### A.6 Docs drift: `docs/metadata-schema-v2.md` vs implementation (P1)

##### Findings
- [ ] The schema doc should be reviewed line-by-line against current `buildMetaV2()` output:
  - field names
  - optionality
  - nesting of `types.*`
  - risk shapes and analysisStatus shape
  - relations link formats

##### Required remediation
- [ ] Update `docs/metadata-schema-v2.md` to reflect the actual emitted shape **or** update `buildMetaV2()` to match the doc (pick one, do not leave them divergent).
- [ ] Add a “schema change log” section so future modifications don’t silently drift.

---

### B) Risk rules and risk analysis

#### Dependency guidance (best choices)
- `re2`/RE2-based engine (already present via `re2js`) — keep for ReDoS safety, but ensure wrapper behavior cannot crash indexing.
- `ajv` — validate rule bundle format (ids, patterns, severities, categories, etc.) before compiling.

#### B.1 Risk regex compilation is broken (P0)

##### Affected file
- `src/index/risk-rules.js`

##### Findings
- [ ] **Incorrect call signature:** `compilePattern()` calls `createSafeRegex(pattern, flags, regexConfig)` but `createSafeRegex()` accepts `(pattern, config)` (per `src/shared/safe-regex.js`).  
  Consequences:
  - `regexConfig` is ignored entirely
  - the intended default flags (`i`) are not applied
  - any user-configured safe-regex limits are not applied
- [ ] **No error shielding:** `compilePattern()` does not catch regex compilation errors. An invalid pattern can throw and abort normalization.

##### Required remediation
- [ ] Fix `compilePattern()` to call `createSafeRegex(pattern, safeRegexConfig)` (or a merged config object).
- [ ] Wrap compilation in `try/catch` and return `null` on failure (or record a validation error) so rule bundles cannot crash indexing.
- [ ] Add tests that verify:
  - [ ] configured flags (e.g., `i`) actually take effect
  - [ ] invalid patterns do not crash normalization and are surfaced as actionable diagnostics
  - [ ] configured `maxInputLength` and other safety controls are honored

#### B.2 Risk analysis can crash on long inputs (P0)

##### Affected file
- `src/index/risk.js`

##### Findings
- [ ] `matchRuleOnLine()` calls SafeRegex `test()` and `exec()` without guarding against exceptions thrown by SafeRegex input validation (e.g., when line length exceeds `maxInputLength`).  
  - This is a hard failure mode: one long line can abort analysis for the entire file (or build, depending on call site error handling).

##### Required remediation
- [ ] Ensure **risk analysis never throws** due to regex evaluation. Options:
  - [ ] Add `try/catch` around `rule.requires.test(...)`, `rule.excludes.test(...)`, and `pattern.exec(...)` to treat failures as “no match”.
  - [ ] Alternatively (or additionally), change the SafeRegex wrapper to return `false/null` instead of throwing for overlong input.
  - [ ] Add a deterministic “line too long” cap behavior:
    - skip risk evaluation for that line
    - optionally record `analysisStatus.exceeded` includes `maxLineLength` (or similar)

#### B.3 `scope` and cap semantics need tightening (P1)

##### Findings
- [ ] `scope === 'file'` currently evaluates only `lineIdx === 0` (first line). This is likely not the intended meaning of “file scope”.
- [ ] `maxMatchesPerFile` currently caps **number of matching lines**, not number of matches (variable name implies match-count cap).

##### Required remediation
- [ ] Define (in docs + code) what `scope: "file"` means:
  - [ ] “pattern evaluated against entire file text” (recommended), or
  - [ ] “pattern evaluated once per file via a representative subset”
- [ ] Implement `maxMatchesPerFile` as an actual match-count cap (or rename it to `maxMatchingLines`).
- [ ] Add tests for both behaviors.

#### B.4 Performance: redundant scanning and weak short-circuiting (P1)

##### Findings
- [ ] Risk analysis scans the same text repeatedly (sources, sinks, sanitizers are scanned in separate loops).
- [ ] When caps are exceeded (bytes/lines), flows are skipped, but line scanning for matches still proceeds across the entire file, which defeats the purpose of caps for large/minified files.

##### Required remediation
- [ ] Add an early-exit path when `maxBytes`/`maxLines` caps are exceeded:
  - either skip all analysis and return `analysisStatus: capped`
  - or scan only a bounded prefix/suffix and clearly mark that results are partial
- [ ] Consider a single-pass scanner per line that evaluates all rule categories in one traversal.
- [ ] Add a prefilter stage for candidate files/lines (cheap substring checks) before SafeRegex evaluation.

#### B.5 Actionability and determinism of outputs (P1)

##### Findings
- [ ] `dedupeMatches()` collapses evidence to one match per rule id (may not be sufficient for remediation).
- [ ] Time-based caps (`maxMs`) can introduce nondeterminism across machines/runs (what gets included depends on wall clock).

##### Required remediation
- [ ] Preserve up to N distinct match locations per rule (configurable) rather than only first hit.
- [ ] Prefer deterministic caps (maxBytes/maxLines/maxNodes/maxEdges) over time caps; if `maxMs` remains, ensure it cannot cause nondeterministic partial outputs without clearly indicating partiality.
- [ ] Sort emitted matches/flows deterministically (by line/col, rule id) before output.

#### B.6 Docs drift: `docs/risk-rules.md` vs implementation (P1)

##### Findings
- [ ] `docs/risk-rules.md` should be updated to reflect:
  - actual rule bundle fields supported (`requires`, `excludes`, `scope`, `maxMatchesPerLine`, `maxMatchesPerFile`, etc.)
  - actual emitted `risk.analysisStatus` shape (object vs string)
  - actual matching semantics (line-based vs file-based)

##### Required remediation
- [ ] Update the doc to match current behavior (or update code to match doc), then add tests that lock it in.

---

### C) Git signals (metadata + blame-derived authorship)

#### Dependency guidance (best choices)
- `simple-git` (already used) — ensure it’s called in a way that scales: batching where feasible, caching aggressively, and defaulting expensive paths off unless explicitly enabled.

#### C.1 Default blame behavior and cost control (P1)

##### Affected file
- `src/index/git.js`

##### Findings
- [ ] `blameEnabled` defaults to **true** (`options.blame !== false`). If a caller forgets to pass `blame:false`, indexing will run `git blame` per file (very expensive).
- [ ] `git log` + `git log --numstat` are executed per file; caching helps within a run but does not avoid the O(files) subprocess cost.

##### Required remediation
- [ ] Make blame opt-in by default:
  - [ ] change default to `options.blame === true`, **or**
  - [ ] ensure all call sites pass `blame:false` unless explicitly requested via config
- [ ] Consider adding a global “gitSignalsPolicy” (or reuse existing policy object) that centrally controls:
  - blame on/off
  - churn computation on/off
  - commit log depth
- [ ] Performance optimization options (choose based on ROI):
  - [ ] batch `git log` queries when indexing many files (e.g., per repo, not per file)
  - [ ] compute churn only when needed for ranking/filtering
  - [ ] support “recent churn only” explicitly in docs (currently it’s “last 10 commits”)

#### C.2 Minor correctness and maintainability issues (P2)

##### Findings
- [ ] Misleading JSDoc: `parseLineAuthors()` is documented as “Compute churn from git numstat output” (it parses blame authors, not churn). This can mislead future maintenance.

##### Required remediation
- [ ] Fix the JSDoc to match the function purpose and parameter type.

#### C.3 Tests improvements (P1)

##### Affected tests
- `tests/git-blame-range.js`
- `tests/git-meta.js`
- `tests/churn-filter.js`
- `tests/git-hooks.js`

##### Findings
- [ ] No tests assert “blame is off by default” (or the intended default policy).
- [ ] No tests cover rename-following semantics (`--follow`) or untracked files.
- [ ] Caching behavior is not validated (e.g., “git blame called once per file even if many chunks”).

##### Required remediation
- [ ] Add tests that explicitly validate the intended default blame policy.
- [ ] Add a caching-focused test that ensures repeated `getGitMeta()` calls for the same file do not spawn repeated git commands (can be validated via mocking or by instrumenting wrapper counts).
- [ ] Decide whether rename-following is required and add tests if so.

---

### D) Type inference (local + cross-file + tooling providers)

#### Dependency guidance (best choices)
- LSP-based providers (clangd/sourcekit/pyright) — keep optional and guarded; correctness should degrade gracefully.
- TypeScript compiler API — keep optional and isolated; add caching/incremental compilation for large repos.

#### D.1 Provider lifecycle and resilience (P1)

##### Affected files
- `src/index/type-inference-crossfile/tooling.js`
- `src/index/tooling/*.js`
- `src/integrations/tooling/lsp/client.js`
- `src/integrations/tooling/providers/lsp.js`
- `src/integrations/tooling/providers/shared.js`

##### Findings
- [ ] `createLspClient().request()` can leave pending requests forever if a caller forgets to supply `timeoutMs` (pending map leak). Current provider code *usually* supplies a timeout, but this is not enforced.
- [ ] Diagnostics timing: providers request symbols immediately after `didOpen` and then `didClose` quickly; some servers publish diagnostics asynchronously and may not emit before close, leading to inconsistent diagnostic capture.

##### Required remediation
- [ ] Enforce a default request timeout in `createLspClient.request()` if none is provided.
- [ ] For diagnostics collection, consider:
  - [ ] waiting a bounded time for initial diagnostics after `didOpen`, or
  - [ ] explicitly requesting diagnostics if server supports it (varies), or
  - [ ] documenting that diagnostics are “best effort” and may be incomplete

#### D.2 Unicode/offset correctness: add stronger guarantees (P1)

##### Affected files
- `src/integrations/tooling/lsp/positions.js`
- `src/shared/lines.js` (supporting)
- `tests/type-inference-lsp-enrichment.js`
- `tests/segment-pipeline.js` + fixtures

##### Findings
- [ ] `positions.js` JSDoc claims “1-based line/column”; column is actually treated as 0-based (correct for LSP), but the doc comment is misleading.
- [ ] Test coverage does not explicitly include surrogate pairs (emoji), which are the common failure mode when mixing code-point vs UTF-16 offsets.

##### Required remediation
- [ ] Fix the JSDoc to reflect actual behavior (LSP: 0-based character offsets; line converted to 1-based for internal helpers).
- [ ] Add tests with:
  - [ ] emoji in identifiers and/or strings before symbol definitions
  - [ ] CRLF line endings fixtures (if Windows compatibility is required)

#### D.3 Generic LSP provider chunk matching is weaker than clangd provider (P2)

##### Affected file
- `src/integrations/tooling/providers/lsp.js`

##### Findings
- [ ] `findChunkForOffsets()` requires strict containment (symbol range must be within chunk range). clangd-provider uses overlap scoring, which is more robust.

##### Required remediation
- [ ] Update generic provider to use overlap scoring like clangd-provider to reduce missed matches.

#### D.4 TypeScript provider issues (P2/P1 depending on usage)

##### Affected file
- `src/index/tooling/typescript-provider.js`

##### Findings
- [ ] `loadTypeScript()` resolve order includes keys that are not implemented (`global`) and duplicates (`cache` vs `tooling`).
- [ ] Parameter name extraction uses `getText()` which can produce non-identifiers for destructuring params (bad keys for `params` map).
- [ ] Naming convention risk: provider writes keys like `Class.method` which may not match chunk naming conventions; if mismatched, types will not attach.

##### Required remediation
- [ ] Fix the resolution order logic and document each lookup path purpose.
- [ ] Only record parameter names for identifiers; skip or normalize destructuring params.
- [ ] Validate chunk naming alignment (structural chunk naming vs provider symbol naming) and add a test for a class method mapping end-to-end.

#### D.5 Cross-file inference merge determinism and evidence (P2)

##### Affected files
- `src/index/type-inference-crossfile/apply.js`
- `src/index/type-inference-crossfile/pipeline.js`

##### Findings
- [ ] `mergeTypeList()` dedupes by `type|source` but drops evidence differences; confidence merging strategy is simplistic.
- [ ] Output ordering is not explicitly sorted after merges.

##### Required remediation
- [ ] Decide how to treat evidence in merges (keep first, merge arrays, keep highest confidence).
- [ ] Sort merged type lists deterministically (confidence desc, type asc, source asc).

#### D.6 Signature parsing robustness (P2)

##### Affected files
- `src/index/tooling/signature-parse/clike.js`
- `src/index/tooling/signature-parse/python.js`
- `src/index/tooling/signature-parse/swift.js`

##### Findings
- [ ] Parsers are intentionally lightweight, but they will fail on common real-world signatures:
  - C++ templates, function pointers, references
  - Python `*args/**kwargs`, keyword-only params, nested generics
  - Swift closures and attributes

##### Required remediation
- [ ] Add test fixtures covering at least one “hard” signature per language.
- [ ] Consider using tooling hover text more consistently (already used as fallback in clangd-provider) or integrate a minimal parser that handles nested generics and defaults.

---

### E) Performance improvements to prioritize (cross-cutting)

#### E.1 Risk analysis hot path (P1)
- [ ] Single-pass line scan for sources/sinks/sanitizers.
- [ ] Early return on caps (maxBytes/maxLines) rather than scanning the whole file anyway.
- [ ] Cheap prefilter before SafeRegex evaluation.
- [ ] Avoid per-line SafeRegex exceptions (see §B.2).

#### E.2 Markdown segmentation duplication (P2)
- [ ] `segments.js` parses markdown twice (inline code spans + fenced blocks). Consider extracting both from one micromark event stream.

#### E.3 Tooling providers I/O duplication (P2)
- [ ] Providers re-read file text from disk; if indexing already has the content in memory, pass it through (where feasible) to reduce I/O.

---

### F) Refactoring goals (maintainability / policy centralization)

- [ ] Consolidate analysis feature toggles into a single `analysisPolicy` object that is passed to:
  - metadata v2 builder
  - risk analysis
  - git analysis
  - type inference (local + cross-file + tooling)
- [ ] Centralize schema versioning and validation:
  - one metadata v2 schema
  - one risk rule bundle schema
  - one place that validates both as part of artifact validation

---

### G) Tests: required additions and upgrades

#### Existing tests reviewed (from the provided list)
- `tests/metadata-v2.js`
- `tests/churn-filter.js`
- `tests/git-blame-range.js`
- `tests/git-hooks.js`
- `tests/git-meta.js`
- `tests/minhash-parity.js`
- `tests/segment-pipeline.js` (+ fixtures)
- `tests/type-inference-crossfile*.js`
- `tests/type-inference-lsp-enrichment.js`
- `tests/type-inference-*-provider-no-*.js` (clangd/sourcekit)

#### Required test upgrades (P1/P0 where noted)
- [ ] **P0:** Add tests for metadata v2 nested inferred/tooling param types (see §A.1).
- [ ] **P0:** Add tests for risk rule compilation config correctness (flags honored, invalid patterns handled) (see §B.1).
- [ ] **P0:** Add risk analysis “long line” test to ensure no crashes (see §B.2).
- [ ] **P1:** Add unicode offset tests that include surrogate pairs (emoji) for:
  - LSP position mapping
  - chunk start offsets around unicode
- [ ] **P1:** Add git caching/policy tests (default blame policy + no repeated subprocess calls where caching is intended).

---

**Deliverables**
- This remediation checklist (this document)
- Updated `docs/metadata-schema-v2.md` and `docs/risk-rules.md` that match implementation
- Expanded test suite that locks in:
  - metaV2 types correctness (including nested)
  - risk rule compilation correctness and non-crashing evaluation
  - unicode offset correctness (including surrogate pairs)
  - intended git blame policy and caching

**Exit criteria**
- All P0 items are fixed and covered by tests.
- Metadata v2 output matches the schema doc, and `validateIndexArtifacts()` validates it meaningfully.
- Risk analysis and tooling passes are “best-effort”: they may skip/partial, but they never crash indexing.

---

## Phase 24 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)

### 24.1 Add MCP SDK and plan transport layering

* [ ] Add `@modelcontextprotocol/sdk` dependency
* [ ] Decide migration strategy:

  * [ ] **Option A (recommended):** keep `tools/mcp-server.js` as the entrypoint, but implement server via SDK and keep legacy behind a flag
  * [ ] Option B: replace legacy entirely (higher risk)

### 24.2 Implement SDK-based server

* [ ] Add `src/integrations/mcp/sdk-server.js` (or similar):

  * [ ] Register tools from `src/integrations/mcp/defs.js`
  * [ ] Dispatch calls to existing handlers in `tools/mcp/tools.js` (or migrate handlers into `src/` cleanly)
  * [ ] Preserve progress notifications semantics expected by `tests/mcp-server.js`:

    * [ ] `notifications/progress`
    * [ ] Include `{ tool: 'build_index', phase, message }` fields (match current tests)
* [ ] Update `tools/mcp-server.js`:

  * [ ] If `mcp.transport=legacy` or env forces legacy → use current transport
  * [ ] Else → use SDK transport

### 24.3 Remove or isolate legacy transport surface area

* [ ] Keep `tools/mcp/transport.js` for now, but:

  * [ ] Move to `tools/mcp/legacy/transport.js`
  * [ ] Update imports accordingly
  * [ ] Reduce churn risk while you validate parity

### 24.4 Tests

* [ ] Ensure these existing tests continue to pass without rewriting expectations unless protocol mandates it:

  * [ ] `tests/mcp-server.js`
  * [ ] `tests/mcp-robustness.js`
  * [ ] `tests/mcp-schema.js`
* [ ] Add `tests/mcp-transport-selector.js`:

  * [ ] Force `PAIROFCLEATS_MCP_TRANSPORT=legacy` and assert legacy path still works
  * [ ] Force `...=sdk` and assert SDK path works
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] MCP server behavior is unchanged from the client perspective (tool list, outputs, progress events)
* [ ] Maintenance burden reduced: eliminate custom framing/parsing where SDK provides it

---

## Phase 25 — Massive functionality boost: PDF + DOCX ingestion (prose mode)

### 25.1 Add document extraction dependencies

* [ ] Add `pdfjs-dist` (PDF text extraction)
* [ ] Add `mammoth` (DOCX → text/HTML extraction)

### 25.2 Introduce “extractor” layer in indexing pipeline

* [ ] Create `src/index/build/extractors/`:

  * [ ] `text.js` (wrap existing `readTextFileWithHash` path)
  * [ ] `pdf.js` (buffer → extracted text; include page separators if possible)
  * [ ] `docx.js` (buffer → extracted text; preserve headings if possible)
  * [ ] `index.js` (select extractor by extension + config)
* [ ] Add a new constant set in `src/index/constants.js`:

  * [ ] `EXTS_EXTRACTABLE_BINARY = new Set(['.pdf', '.docx'])`
* [ ] Add `.pdf` and `.docx` to `EXTS_PROSE` **only if** extraction is enabled (or add them unconditionally but ensure they don’t get skipped)

### 25.3 Fix binary-skip logic to allow extractable docs

You must handle both “pre-read” scanning and “post-read” binary checks:

* [ ] Update `src/index/build/file-scan.js` / `createFileScanner()`:

  * [ ] If `ext` ∈ `EXTS_EXTRACTABLE_BINARY` and extraction enabled:

    * [ ] Do **not** mark as `{ reason: 'binary' }`
    * [ ] Still allow minified checks to run when relevant (likely irrelevant for pdf/docx)
* [ ] Update `src/index/build/file-processor/skip.js`:

  * [ ] If `ext` extractable and extraction enabled, do not return `binarySkip`
* [ ] Update `src/index/build/file-processor.js`:

  * [ ] Branch early on `ext`:

    * [ ] For `.pdf`/`.docx`: read buffer → extractor → `text`
    * [ ] For all else: existing text decoding path
  * [ ] Ensure `hash` still derives from raw bytes (current `sha1(buffer)` behavior is good)
  * [ ] Ensure `stats.bytes` is still the raw size for guardrails

### 25.4 Chunking strategy for extracted docs

* [ ] Decide on an initial, deterministic chunking approach:

  * [ ] Minimal viable: treat extracted output as prose and let default prose chunking apply
  * [ ] Better: add dedicated chunkers:

    * [ ] Add `src/index/chunking/prose/pdf.js` to split by page markers
    * [ ] Add `src/index/chunking/prose/docx.js` to split by headings / paragraph blocks
* [ ] Update `src/index/chunking/dispatch.js`:

  * [ ] Map `.pdf` and `.docx` to their chunkers (or prose fallback)

### 25.5 Search + metadata integration

* [ ] Ensure extracted docs appear in:

  * [ ] `file_meta.json` (file path + ext)
  * [ ] `chunk_meta.*` (chunks with correct file associations)
* [ ] Consider adding a metadata flag for UI filters:

  * [ ] `fileMeta[i].isExtractedDoc = true` (or reuse existing `externalDocs` pattern if appropriate)
* [ ] Verify retrieval filters treat these files correctly (extension/path filters)

### 25.6 Tests (must include “end-to-end search finds doc content”)

* [ ] Add fixture files under `tests/fixtures/docs/`:

  * [ ] `sample.pdf` with a known unique phrase
  * [ ] `sample.docx` with a known unique phrase
* [ ] Add `tests/pdf-docx-extraction.js`:

  * [ ] Unit-level extraction returns expected text
* [ ] Add `tests/pdf-docx-index-search.js`:

  * [ ] Build prose index for a temp repo that includes the docs
  * [ ] Run `search.js --mode prose` and assert the phrases match chunks
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] PDF/DOCX are no longer silently dropped as “binary” (when enabled)
* [ ] Prose search can retrieve content from these formats reliably
* [ ] No regression to binary detection for non-extractable files

---

## Phase 26 — Tantivy sparse backend (optional, high impact on large repos)

> This phase is intentionally split into “abstraction first” and “backend integration” to keep risk controlled.

### 26.1 Extract a sparse-retrieval interface

* [x] Create `src/retrieval/sparse/`:
  * [x] `types.js` contract: `search({ query, topN, filters, mode }) -> hits[]`
  * [x] `providers/sqlite-fts.js` wrapper around existing SQLite FTS ranking
  * [x] `providers/js-bm25.js` wrapper around the in-memory BM25 path

* [x] Update `src/retrieval/pipeline.js` to call the provider rather than direct sqlite/JS branching:
  * [x] Keep behavior identical as baseline
  * [x] Preserve determinism (stable tie-breaking)

### 26.2 Implement Tantivy integration (choose one operational model)

* [x] Choose packaging model:
  * [ ] **Sidecar model:** `tools/tantivy-server` (Rust) + Node client
  * [x] **Embedded binding:** Node N-API module

* [x] Add `src/retrieval/sparse/providers/tantivy.js`:
  * [x] Build query → execute → map results to `{ idx, score }`
  * [x] Support candidate-set filtering if feasible (or document it as a limitation and handle via post-filtering)

* [x] Add `tools/build-tantivy-index.js`:
  * [x] Consume existing artifacts (`chunk_meta`, token streams) and build tantivy index on disk
  * [x] Store alongside other indexes (e.g., under repo cache root)
  * [x] Consider incremental updates later; start with full rebuild

### 26.3 Config + CLI integration

* [x] Add config:
  * [x] `tantivy.enabled`
  * [x] `tantivy.path` (optional override)
  * [x] `tantivy.autoBuild` (optional)

* [x] Extend backend policy logic (see `src/retrieval/cli/backend-context.js` and backend-policy tests):
  * [x] Allow `--backend tantivy` (or `--sparse-backend tantivy`)
  * [x] Ensure `auto` fallback behavior remains predictable

### 26.4 Tests (gated if tantivy isn’t always available in CI)

* [x] Add `tests/tantivy-smoke.js`:
  * [x] Builds tantivy index for `tests/fixtures/sample`
  * [x] Executes a basic query and asserts hits are non-empty

* [x] Gate it behind env:
  * [x] `PAIROFCLEATS_TEST_TANTIVY=1` to run
  * [x] Otherwise test exits 0 with “skipped” message (match existing patterns in repo)

* [x] Add script-coverage action(s) that run it only when env flag is set (or mark as skipped in coverage if you keep strictness)

**Exit criteria**

* [x] Tantivy backend can be enabled without changing default behavior
* [ ] For large repos, sparse retrieval latency is materially improved (benchmarks added in Phase 15)

---

## Phase 27 — LanceDB vector backend (optional, high impact on ANN scaling)

### 27.1 Extract a vector-ANN provider interface

* [ ] Create `src/retrieval/ann/`:
  * [ ] `types.js`: `query({ embedding, topN, candidateSet, mode }) -> hits[]`
  * [ ] `providers/sqlite-vec.js` wrapper around `rankVectorAnnSqlite`
  * [ ] `providers/hnsw.js` wrapper around `rankHnswIndex`

* [ ] Update `src/retrieval/pipeline.js` to use the provider interface

### 27.2 Implement LanceDB integration (choose operational model)

* [x] Choose packaging model:
  * [x] Node library integration (`@lancedb/lancedb`)
  * [ ] Sidecar service (Python) + HTTP

* [x] Add LanceDB ANN ranker/provider (implemented at `src/retrieval/lancedb.js`; wired via `src/retrieval/pipeline.js`):
  * [x] Query by vector and return `{ idx, sim }`
  * [x] Handle filtering:
    * [x] If LanceDB supports “where id IN (…)” efficiently → push down (small candidate sets)
    * [x] Otherwise → post-filter and overfetch
  * [ ] (Optional) After 27.1 lands, relocate under `src/retrieval/ann/providers/lancedb.js` to remove special-casing in pipeline

### 27.3 Build tooling for vector index creation

* [x] Build tooling for vector index creation (implemented as part of `tools/build-embeddings`):
  * [x] Ingest `dense_vectors_*` artifacts
  * [x] Store LanceDB table in cache (mode-specific) via `dense_vectors.lancedb/` + `dense_vectors.lancedb.meta.json`
  * [x] Validate dims/model compatibility using existing `index_state.json` semantics (meta dims are checked at query time)

* [ ] (Optional) Add a standalone `tools/build-lancedb-index.js` entrypoint that rebuilds LanceDB tables from existing vector artifacts without re-embedding.

### 27.4 Tests (gated)

* [x] Add `tests/lancedb-ann.js` smoke test:
  * [x] Build embeddings (stub) → build lancedb table → run a nearest-neighbor query → assert stable result ordering

* [x] Gate test execution so CI does not fail when LanceDB isn’t available:
  * [x] Current behavior: test self-skips with a clear “skipped” message when `@lancedb/lancedb` is missing
  * [ ] (Optional) Add explicit `PAIROFCLEATS_TEST_LANCEDB=1` env gating if you want CI to skip even when the dependency is installed

* [x] Add script-coverage action(s):
  * [x] `tests/script-coverage/actions.js` includes `lancedb-ann-test`

**Exit criteria**

* [ ] LanceDB ANN can be enabled without breaking sqlite/hnsw fallbacks
* [ ] Demonstrable memory and/or latency win for ANN retrieval at scale

---

## Phase 28 — Distribution Readiness (Package Control + Cross-Platform)

* [x] Packaging rules for ST3 (no compiled Python deps)
* [ ] Windows/macOS/Linux path + quoting correctness
  * [x] Sublime runner uses argv arrays (`subprocess.Popen([command] + args)`) to avoid shell quoting issues
  * [ ] Add/enable a CI gate that actually exercises “path with spaces” end-to-end (current Node test depends on map API endpoints; see Phase 29.1)
* [x] Document Graphviz optional dependency (for SVG/HTML rendering)
* [x] Provide minimal “DOT-only mode” documentation

Tests:

* [x] `python -m py_compile` over plugin package
  - Where: `tests/sublime-pycompile.js`
* [ ] Cross-platform subprocess quoting tests (Node)
  - Existing: `tests/subprocess-quoting.js` (currently depends on `/map` API endpoints; see Phase 29.1)

---

## Phase 29 — Optional: Service-Mode Integration for Sublime (API-backed Workflows)

### 29.1 Map endpoints (if service mode is adopted)

* [ ] Extend `api-server` to support:
  * [ ] `GET /map?scope=...&format=...`
  * [ ] `GET /map/nodes?filter=...` for quick panels

* [ ] Sublime plugin optionally consumes the API for faster iteration
  * [x] API client helper exists: `sublime/PairOfCleats/lib/api_client.py` (currently unused by commands)
  * [ ] Wire map generation to use API when `api_server_url` is configured (fallback to local CLI when unset)

### 29.2 Tests

* [ ] API contract tests for map endpoints
* [ ] Sublime plugin integration tests (mock HTTP server)

---

## Phase 30 — Verification Gates (Regression + Parity + UX Acceptance)

* [x] Parity checklist vs existing extension behaviors (where applicable)
  - Implemented: `tests/parity.js` (also wired into `tests/script-coverage/actions.js`)
* [ ] Deterministic outputs for map/search commands
  * [x] Search determinism is gated: `tests/search-determinism.js`
  * [ ] Map determinism test exists but is not wired into coverage/CI:
    - `tests/code-map-determinism.js`
* [ ] Performance acceptance criteria (map generation with guardrails)
  * [ ] Guardrails correctness test exists but is not wired into coverage/CI:
    - `tests/code-map-guardrails.js`
  * [ ] Add an explicit wall-clock performance budget gate for map generation on a fixture repo
* [ ] End-to-end smoke suite including:
  * [ ] index build
  * [ ] search
  * [ ] map generation (json + dot)
  * [ ] optional svg rendering when Graphviz available
  - Notes:
    - Map-related building blocks already exist as standalone tests:
      - `tests/code-map-basic.js`
      - `tests/code-map-dot.js`
      - `tests/code-map-graphviz-fallback.js`
    - Add an explicit `tests/e2e-smoke.js` or wire these into `tests/script-coverage/actions.js`.

---

## Phase 31 — Isometric Visual Fidelity (Yoink-derived polish)

**Objective:** fold in proven glass/postprocessing practices from the yoink prototype for higher visual quality without regressing performance.

### 31.1 Glass + environment fidelity

* [ ] Add HDR env map tone calibration controls (env intensity, exposure) to match yoink reference settings.
  * [x] Env intensity control exists (`visuals.glass.envMapIntensity`) and is applied to glass materials
  * [ ] Exposure control is still hard-coded (`renderer.toneMappingExposure = 1.9`); add a UI slider + persist to panel state

* [x] Support normal map repeat/scale on glass with clearcoat normal influence.
  - Implemented via: `visuals.glass.normalRepeat`, `visuals.glass.normalScale`, `visuals.glass.clearcoatNormalScale`

* [ ] Add optional clearcoat normal map toggle for glass shells.
  - Note: setting `clearcoatNormalScale = 0` approximates a toggle, but an explicit boolean that removes `clearcoatNormalMap` would be clearer.

### 31.2 Post-processing polish

* [ ] Add optional UnrealBloomPass with user-controllable threshold/strength/radius.
* [ ] Provide a toggle to enable/disable post-processing for performance.

### 31.3 Rendering calibration

* [x] Expose metalness/roughness/transmission/ior/reflectivity/thickness controls as a grouped preset panel.
  - Implemented as UI sliders in `src/map/isometric/client/ui.js` + applied in `src/map/isometric/client/materials.js`

* [ ] Add a “studio” preset that mirrors yoink defaults for fast tuning.

### Dependency leverage and reuse (map viewer)

This map phase is intentionally designed to **maximize reuse** of what the repo already has:

- Existing semantics extraction already provides the key fields you listed:
  - `imports/exports/usages/importLinks` via relations
  - `calls/callDetails` + cross-file `callLinks/usageLinks/callSummaries`
  - `signature/modifiers/returns` via docmeta/functionMeta
  - `reads/writes/mutations/aliases` via AST dataflow (when enabled)
  - `controlFlow` counts already present in docmeta/functionMeta

- Existing graph tooling:
  - `graphology`-backed `graph_relations.json` provides a strong base graph layer

- The missing piece is the **visual model + rendering/export** and **Sublime UX** around it, which the map viewer phases supply.
---

## Phase 32 — Config/Flags/Env Hard Cut: Freeze contract + add enforcement (stop the bleeding)

**Objective:** Ensure the configuration surface simplification cannot regress during implementation by freezing the contract, introducing budgets, and enforcing them in CI.

**Strategic note:** This is a deliberate **breaking “hard cut”** (no deprecation period, no backwards compatibility layer). Confirm adoption of this contract before doing destructive deletions.

### 32.1 Define the “public surface” allowlists + budgets

* [ ] Create `docs/config-contract.md` with an explicit whitelist of:
  * public repo config keys
  * public CLI flags
  * public env vars (secrets only)

* [ ] In `docs/config-contract.md`, explicitly declare precedence order:
  * CLI flags > repo config > AutoPolicy > code defaults
  * env vars are secrets-only and are not in precedence for normal behavior

* [ ] Create `docs/config-budgets.md` documenting numeric budgets + rationale:
  * config keys target: **2** (`cache.root`, `quality`) (optionally +`service.*` if needed)
  * env vars target: **1** (`PAIROFCLEATS_API_TOKEN`)
  * public CLI flags target: **15–25** across core commands

* [ ] Encode naming conventions in the contract docs:
  * config keys: lowercase + structured (`cache.root`, `quality`)
  * CLI flags: kebab-case (`--cache-root`, `--explain`)
  * env vars: uppercase `PAIROFCLEATS_*` (secrets and deployment wiring only)

### 32.2 Make the config inventory actionable in CI

* [ ] Extend `tools/config-inventory.js` to output:
  * totals (already)
  * **public vs internal/dev-only** classification for CLI flags (new)
  * allowlist drift report (new public keys/flags/env vars)

* [ ] Add `npm run config:budget` (or equivalent) and wire into CI to fail when budgets are exceeded.

### 32.3 Enforce governance rules (anti-sprawl guardrails)

* [ ] CI: fail if any `process.env.PAIROFCLEATS_*` is referenced outside the secrets env module (`src/shared/env.js`) in runtime code.

* [ ] CI: fail if `docs/config-schema.json` contains unknown keys beyond the allowlist/budget.

* [ ] CI: fail if the public CLI flag count exceeds budget (using the allowlist + inventory classifier).

* [ ] Lint rule (or CI grep): ban `process.env.PAIROFCLEATS_*` usage outside `src/shared/env.js` (scope runtime, not tests).

* [ ] Runtime: ensure `--explain` prints policy resolution (inputs + derived values) to reduce “why did it do that?” tickets.

### 32.4 “Adding a new knob” gating requirements (process)

* [ ] Add a PR checklist/template requiring any new user-configurable setting to include:
  * justification (user intent vs tuning)
  * ownership (module owner)
  * single-plane design (config **or** CLI **or** env)
  * tests (unit + integration)
  * budget impact (must delete another knob if over budget)

**Exit criteria**

* [ ] CI fails if public budgets are exceeded.
* [ ] `docs/config-contract.md` and `docs/config-budgets.md` exist and match the intended end-state.

---

## Phase 33 — Config Hard Cut: Introduce MinimalConfig + AutoPolicy (policy-first wiring)

**Objective:** Land the new primitives first: a minimal config schema/loader and an AutoPolicy resolver. Subsequent deletions become “wire to policy” instead of “invent behavior.”

### 33.1 Minimal config schema (repo config)

* [ ] Replace `docs/config-schema.json` with a minimal schema containing only:
  * `cache.root`
  * `quality` (`auto|fast|balanced|max`)

* [ ] Unknown keys are **errors** (fail fast).

* [ ] Update config tooling to the minimal schema:
  * [ ] `tools/validate-config.js` validates only the minimal shape
  * [ ] `tools/config-reset.js` emits minimal config only
  * [ ] `tools/config-dump.js` dumps minimal config + derived policy (recommended)

### 33.2 Minimal config load path (centralized IO)

* [ ] Update `tools/dict-utils.js:loadUserConfig()` to:
  * load `.pairofcleats.json`
  * validate against the minimal schema
  * return **only** the minimal config
  * remove fallback-to-tool-root config (unless explicitly retained and documented)

* [ ] Enforce centralization rule:
  * only the config loader reads `.pairofcleats.json`
  * all other modules accept a plain options object (no direct config/env/argv reads)

### 33.3 AutoPolicy (resource-derived decisions)

* [ ] Add `src/shared/auto-policy.js` with:
  * resource detection: CPU, RAM
  * fast repo scan: file count + size estimate (early-stop allowed)
  * capability detection hooks (native modules/extensions present)
  * outputs for: `quality`, concurrency, feature enablement, backend decisions

* [ ] Implement a quality resolver (example mapping):
  * `fast` if `mem < 16GB` or `cpu <= 4`
  * `balanced` if `mem < 48GB` or `cpu < 12`
  * `max` otherwise
  * downgrade one level for “huge repos” (e.g., >200k files or >5GB scanned bytes)

* [ ] Wire AutoPolicy creation into central entrypoints (without deleting old config reads yet):
  * [ ] `tools/dict-utils.js` exports `getAutoPolicy(repoRoot, config)` (or similar)
  * [ ] `bin/pairofcleats.js` passes policy into child scripts via args (preferred) rather than env

### 33.4 Contract tests

* [ ] Add tests enforcing the new contract:
  * [ ] unknown config key ⇒ error
  * [ ] `quality=auto` resolves deterministically with mocked resources/repo metrics

  Suggested:
  * `tests/config/minimal-schema.test.js`
  * `tests/config/auto-policy.test.js`

**Exit criteria**

* [ ] `pairofcleats config validate` only accepts minimal config.
* [ ] AutoPolicy unit tests exist and pass.
* [ ] No new knobs introduced during Phase 33.

---

## Phase 34 — Config Hard Cut: Remove profiles completely (delete the system)

**Objective:** Delete the profile control plane (files + env + flag + merge logic) to remove precedence confusion.

### 34.1 Delete profile artifacts

* [ ] Delete the `profiles/` directory.
* [ ] Remove profile references in docs (e.g., any “Experimental commands require profile=full”).

### 34.2 Remove profile logic from code

* [ ] In `tools/dict-utils.js`, delete:
  * `PROFILES_DIR`
  * `loadProfileConfig`
  * `applyProfileConfig`
  * env/config/cli profile selection logic

* [ ] In `src/shared/cli.js`:
  * [ ] remove `profile` as a shared option
  * [ ] remove automatic profile default injection

* [ ] In `src/retrieval/cli-args.js`:
  * [ ] remove `--profile`

### 34.3 Remove env var `PAIROFCLEATS_PROFILE`

* [ ] Remove from `src/shared/env.js`.
* [ ] Remove/replace any tests relying on profiles.

**Exit criteria**

* [ ] No `profiles/` directory.
* [ ] No references to `PAIROFCLEATS_PROFILE` or `--profile`.
* [ ] Help text and docs no longer mention profiles.

---

## Phase 35 — Config Hard Cut: Remove env override plumbing (secrets-only env)

**Objective:** Eliminate the “second configuration system” implemented via env vars. Env is secrets/deployment wiring only.

### 35.1 Rewrite env module (secrets-only)

* [ ] Replace `src/shared/env.js` with secrets-only access:
  * `getSecretsEnv()` returns `{ apiToken }`
  * remove parsing helpers for booleans/enums/numbers unless needed elsewhere

* [ ] Enforce rule: no runtime behavior depends on env vars except secrets.

### 35.2 Replace `getEnvConfig()` call-sites

* [ ] Remove/replace all call-sites of `getEnvConfig()` across index build, retrieval, tools, and tests.

  Strong checklist (non-exhaustive):
  * `src/index/build/file-processor.js` (progress flags)
  * `src/index/build/indexer/pipeline.js`
  * `src/index/build/indexer/steps/process-files.js`
  * `src/index/build/runtime/runtime.js`
  * `src/index/build/watch.js`
  * `src/integrations/core/index.js`
  * `src/integrations/core/status.js`
  * `src/retrieval/cli.js`
  * `src/retrieval/output/cache.js`
  * `src/shared/hash.js`
  * `tools/*` (cache-gc, clean-artifacts, config-dump, vector-extension, services, benches, etc.)
  * `tests/bench.js`

  Replacement strategy:
  * debug/diagnostic toggles ⇒ delete or move to `--explain`
  * perf/resource knobs ⇒ derive in AutoPolicy
  * behavior toggles (embeddings/backend/fts profile) ⇒ derive in AutoPolicy; delete user override

### 35.3 Delete env documentation

* [ ] Rewrite `docs/env-overrides.md` to “Secrets only: `PAIROFCLEATS_API_TOKEN`.”
* [ ] Remove mentions of env-driven profiles, embeddings toggles, thread knobs, watcher backends, etc.

### 35.4 Update config hashing determinism

* [ ] Update `tools/dict-utils.js:getEffectiveConfigHash()` to:
  * exclude env-derived settings from the effective config hash
  * ensure artifact identity is driven by config + repo content + tool version

**Exit criteria**

* [ ] No `PAIROFCLEATS_*` env vars used for behavior except `PAIROFCLEATS_API_TOKEN`.
* [ ] `getEffectiveConfigHash()` is not sensitive to random env settings.
* [ ] Docs reflect secrets-only env.

---

## Phase 36 — Config Hard Cut: Collapse public CLI flags to a strict whitelist

**Objective:** Remove flag sprawl and duplicated flags across scripts by making the public CLI surface strict and small.

### 36.1 Public command surface (whitelist)

* [ ] Confirm the public commands are restricted to:
  * `setup`
  * `bootstrap`
  * `index build` / `index watch` / `index validate`
  * `search`
  * `service api`

* [ ] Collapse the public flags to a whitelist (target contract):

  `pairofcleats index build`
  * `--repo <path>`
  * `--mode <code|prose|both>` (default `both`)
  * `--quality <auto|fast|balanced|max>`
  * `--watch` (optional)

  `pairofcleats index watch`
  * `--repo <path>`
  * `--mode <code|prose|both>`
  * `--quality <auto|fast|balanced|max>`

  `pairofcleats search "<query>"`
  * `--repo <path>`
  * `--mode <code|prose|both>`
  * `--top <N>` (default 5)
  * `--json`
  * `--explain`

  `pairofcleats service api`
  * `--host <host>` (default 127.0.0.1)
  * `--port <port>` (default 7345)
  * optional: `--repo <path>` only if required

### 36.2 Strict CLI dispatch + parsing

* [ ] Update `bin/pairofcleats.js` to:
  * dispatch only the public commands
  * reject unknown commands
  * reject unknown flags
  * avoid passing through arbitrary args to internal scripts

* [ ] Update per-command option parsing to accept only the whitelist:
  * [ ] rewrite `src/retrieval/cli-args.js` (search)
  * [ ] refactor `build_index.js` or `src/index/build/args.js` (index build/watch)

### 36.3 Collapse search filter flags

* [ ] Replace dozens of search CLI flags with either:
  * query-language filters (preferred), OR
  * a single `--filter "<expr>"` flag

* [ ] Implement a minimal filter parser (initially):
  * [ ] `lang`
  * [ ] `path`
  * [ ] `type`

* [ ] Remove per-filter CLI flags and simplify `src/retrieval/cli/normalize-options.js` accordingly.

* [ ] Update `docs/search.md` / `docs/search-contract.md` to match the new mechanism.

### 36.4 Delete duplicated options across internal scripts

* [ ] Remove duplicated flags like `--repo`, `--out`, `--json` from internal scripts once the CLI wrapper is strict.
* [ ] Internal scripts accept explicit parameters from the wrapper (no ad-hoc CLI parsing).

**Exit criteria**

* [ ] `pairofcleats --help` shows only the public commands.
* [ ] Unknown flags error out.
* [ ] Search filtering uses query filters or `--filter` (not dozens of flags).

---

## Phase 37 — Config Hard Cut: Remove user-configurable indexing knobs (wire indexing to AutoPolicy)

**Objective:** Delete `indexing.*` configurability by deriving values via AutoPolicy and making pipeline decisions internal.

### 37.1 Identify indexing config consumption points

* [ ] Audit and remove config/env reads across (focus list):
  * `src/index/build/runtime.js`
  * `src/index/build/runtime/runtime.js`
  * `src/index/build/runtime/workers.js`
  * `src/index/build/indexer.js`
  * `src/index/build/file-processor.js`
  * `src/index/build/worker-pool.js`
  * `src/index/build/chunking/*`
  * `src/index/chunking/limits.js`

### 37.2 Thread policy values through indexing

* [ ] Create an `IndexBuildContext` (or equivalent) that contains:
  * minimal `config`
  * derived `policy` (AutoPolicy)

* [ ] Thread this context through build orchestration so downstream modules do not read config/env directly.

* [ ] Delete or ignore now-unused indexing config keys (and remove them from inventory).

Concrete replacements:
* [ ] Concurrency uses `policy.indexing.concurrency`
* [ ] Embeddings enablement uses `policy.indexing.embeddings.enabled`
* [ ] Chunking limits use `policy.indexing.chunking.*`
* [ ] Worker pool sizing uses `policy.runtime.workerPool.*`

### 37.3 Remove stage toggles

* [ ] Remove env `PAIROFCLEATS_STAGE`.
* [ ] Remove config `indexing.stage` (and similar).
* [ ] Make pipeline stage selection deterministic and fixed.

### 37.4 Operational behavior decisions (indexing-adjacent)

* [ ] Ignore behavior is fixed:
  * always respect `.gitignore`
  * always respect `.pairofcleatsignore` if present
  * remove config keys like `useGitignore`, `usePairofcleatsIgnore`, `useDefaultSkips`, `ignoreFiles`, `extraIgnore`

* [ ] Watcher backend is fixed:
  * default to `chokidar` (or internal auto)
  * remove `PAIROFCLEATS_WATCHER_BACKEND` and any config keys controlling it

### 37.5 Tests

* [ ] Remove tests that assert behavior of deleted knobs.
* [ ] Add tests asserting:
  * policy-derived concurrency is used
  * embeddings enablement is solely policy-driven

**Exit criteria**

* [ ] No code reads `indexing.*` from user config.
* [ ] Index build outcome is driven by AutoPolicy + repo inputs.
* [ ] Test coverage exists for policy-driven decisions.

---

## Phase 38 — Config Hard Cut: Remove user-configurable search knobs (wire retrieval to AutoPolicy)

**Objective:** Delete `search.*` configurability and backend/scoring knobs. Retrieval becomes “one good default pipeline,” with only `--top`, `--json`, `--explain` remaining.

### 38.1 Remove backend selection knobs

* [ ] Make retrieval always use SQLite indexes.
* [ ] Delete backend selection flags from the public CLI:
  * `--backend`
  * `--ann-backend`
  * `--ann` / `--no-ann`

* [ ] Any ANN usage is auto-detected by capabilities + policy.

### 38.2 Remove scoring knobs

* [ ] Delete user-tunable scoring knobs:
  * `search.bm25.*` and `--bm25-*`
  * `--fts-profile`, `--fts-weights`
  * env `PAIROFCLEATS_FTS_PROFILE`

* [ ] Replace with fixed scoring defaults.
* [ ] Optional: policy switches by `quality` (fast/balanced/max), but not user-tunable parameters.

### 38.3 Cache knob removal

* [ ] If `docs/query-cache.md` exposes user knobs, collapse to:
  * internal cache with fixed limits, OR
  * off-by-default if not essential

### 38.4 Tests

* [ ] Add/adjust tests that assert behavior is policy-driven and does not depend on env/config overrides.

**Exit criteria**

* [ ] No code reads `search.*` from config.
* [ ] No user-facing backend/scoring knobs remain.
* [ ] Search works with the default pipeline + optional explain output.

---

## Phase 39 — Config Hard Cut: Backend + extension simplification (remove LMDB + vector-extension config)

**Objective:** Remove entire feature sets that create configuration branching.

### 39.1 Remove LMDB support (user-visible)

* [ ] Delete:
  * `tools/build-lmdb-index.js`
  * LMDB runtime modules (if any)
  * `pairofcleats lmdb build` dispatch from `bin/pairofcleats.js`

* [ ] Remove docs references (e.g., `docs/external-backends.md`).

* [ ] Optional: keep LMDB as a dev-only internal experiment, but not shipped/public.

### 39.2 Vector extension: auto only

* [ ] Remove env `PAIROFCLEATS_VECTOR_EXTENSION`.
* [ ] Remove config `sqlite.vectorExtension.*`.

* [ ] Make extension lookup fixed to tool-managed directory:
  * `tools/download-extensions.js` installs into a known location
  * runtime checks presence and enables if available
  * never require user path overrides

* [ ] Rewrite `docs/sqlite-ann-extension.md` to “auto only.”

**Exit criteria**

* [ ] No LMDB code paths are part of the public surface.
* [ ] Vector extension has no user-configurable paths; enablement is fully auto.

---

## Phase 40 — Config Hard Cut: Delete dead code/docs/tests and lock minimal surface (budgets + validation)

**Objective:** Remove everything that exists only to support deleted knobs and ensure the repo stays simplified.

### 40.1 Dead docs cleanup

* [ ] Delete `docs/config-deprecations.md`.
* [ ] Rewrite `docs/env-overrides.md` to secrets-only.
* [ ] Rewrite or delete `docs/external-backends.md`.
* [ ] Remove any remaining “profile=full required” references in docs.

### 40.2 Trim helper APIs

* [ ] Trim `tools/dict-utils.js` exports to only what the remaining public CLI and build/search paths require.
* [ ] Delete/move any remaining accessors that expose removed namespaces (`getRuntimeConfig`, `getModelConfig`, etc.).

### 40.3 Re-run and commit inventory

* [ ] Run `node tools/config-inventory.js` and commit updated `docs/config-inventory.*`.
* [ ] Confirm budgets and enforcement are green.

### 40.4 Add/keep “no new knobs” guardrails

* [ ] CI scan: `PAIROFCLEATS_` usage restricted to secrets module (runtime code).
* [ ] CI scan: schema key budget enforcement.
* [ ] CI scan: public CLI flag budget enforcement.

### 40.5 Operational decisions (explicit hard cut)

* [ ] Logging is fixed:
  * default log level `info`
  * only per-invocation overrides via `--json` / `--explain`
  * remove `logging.*` config namespace and env logging controls

* [ ] Compression / hashing / regex engine selection is internal auto:
  * “best available” selection (native if present) is automatic
  * remove user knobs for selecting engines

### 40.6 Repeatable validation checklist

* [ ] `pairofcleats index build` works on a representative repo with zero config.
* [ ] `pairofcleats search "foo"` works and returns results.
* [ ] `pairofcleats search --explain "foo"` prints derived policy decisions.
* [ ] `node tools/config-inventory.js` reports:
  * config keys <= 5
  * env vars == 1
  * public CLI flags <= 25
* [ ] Grep check: no usage of `PAIROFCLEATS_` outside secrets allowlist in runtime code.
* [ ] CI green.

---
