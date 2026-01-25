# Codebase Static Review Findings — Pass 10 (Smoke + Shards + SQLite + Structural + Misc Tests)

> Scope: **only** the `tests/**` files listed in the request (smoke/sharding/sqlite/structural/misc).  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness/portability risks, missing coverage**, and **concrete suggestions** to fix or improve (no code changes performed).

---

## Scope

Reviewed only the following files:

### Harness + smoke orchestration
- `tests/test-runner.js`
- `tests/setup.js`
- `tests/smoke-utils.js`
- `tests/smoke.js`
- `tests/smoke-section1.js`
- `tests/smoke-workers.js`
- `tests/smoke-embeddings.js`
- `tests/smoke-retrieval.js`
- `tests/smoke-services.js`
- `tests/smoke-sqlite.js`

### Sharding
- `tests/shard-plan.js`
- `tests/shard-merge.js`
- `tests/shard-progress-determinism.js`

### Indexing hygiene
- `tests/skip-minified-binary.js`

### SQLite (top-level tests)
- `tests/sqlite-ann-extension.js`
- `tests/sqlite-ann-fallback.js`
- `tests/sqlite-auto-backend.js`
- `tests/sqlite-build-delete.js`
- `tests/sqlite-build-indexes.js`
- `tests/sqlite-build-manifest.js`
- `tests/sqlite-build-vocab.js`
- `tests/sqlite-bundle-invalid.js`
- `tests/sqlite-bundle-missing.js`
- `tests/sqlite-cache.js`
- `tests/sqlite-chunk-id.js`
- `tests/sqlite-chunk-meta-streaming.js`
- `tests/sqlite-compact.js`
- `tests/sqlite-dense-meta-fallback.js`
- `tests/sqlite-incremental-no-change.js`
- `tests/sqlite-index-state-fail-closed.js`
- `tests/sqlite-missing-dep.js`
- `tests/sqlite-sidecar-cleanup.js`
- `tests/sqlite-vec-candidate-set.js`

### SQLite storage/incremental
- `tests/storage/sqlite/bundle-dims-mismatch.test.js`
- `tests/storage/sqlite/incremental/ann-existing-table.test.js`
- `tests/storage/sqlite/incremental/doc-id-reuse.test.js`
- `tests/storage/sqlite/incremental/file-manifest-updates.test.js`
- `tests/storage/sqlite/incremental/manifest-hash-fill.test.js`
- `tests/storage/sqlite/incremental/manifest-normalization.test.js`
- `tests/storage/sqlite/incremental/search-after-update.test.js`
- `tests/storage/sqlite/incremental/wal-checkpoint.test.js`
- `tests/storage/sqlite/migrations/schema-mismatch-rebuild.test.js`
- `tests/storage/sqlite/reader-schema-mismatch.test.js`

### Structural + misc
- `tests/structural-filters.js`
- `tests/structural-search.js`
- `tests/sublime-pycompile.js`
- `tests/subprocess-quoting.js`
- `tests/summary-report.js`
- `tests/tantivy-smoke.js`
- `tests/thread-limits.js`
- `tests/tokenization-buffering.js`
- `tests/tokenize-dictionary.js`
- `tests/tool-root.js`

---

## Executive Summary

This pass covers a set of tests that are disproportionately important for “operator trust”: they are either smoke-level checks that users run first (and that CI often prioritizes), or they validate correctness of high-impact subsystems (sharding determinism, sqlite build/incremental semantics, structural triage ingestion, and service/CLI behavior).

The majority of these tests are directionally correct, but several have hard correctness flaws (tests do not reliably enforce the conditions they claim to validate), and a number of them encode brittle assumptions that will fight the roadmap (streaming/sharded artifacts, optional dependencies, and increasingly parallel index builds).

If you address only a handful of issues from this document, prioritize the P0 items below: they directly affect whether the suite gives a truthful signal.

---

## High-Priority Findings

### P0 — `sqlite-ann-fallback` does not actually force “fallback mode” (false failures / false confidence)

**Where**
- `tests/sqlite-ann-fallback.js:66–73` asserts the extension is unavailable.
- `tests/sqlite-ann-fallback.js:39–46` builds and searches without any control that disables the extension.

**What’s wrong**
- The test’s premise is “verify ANN fallback when the sqlite extension is not available”, but it never enforces “extension unavailable”.
- On any machine where the extension is present in the expected location (or auto-downloaded by setup), the test will fail even if fallback logic is correct.
- Conversely, on machines where the extension is missing, the test passes without proving that the fallback path was chosen because the extension was unavailable vs. because ANN was disabled or never attempted.

**Suggested fix**
- Make the test hermetic by explicitly disabling the extension via config/env for this test run (preferred), or by pointing the extension search path to an empty temp directory.
- Then, assert fallback behavior using backend policy / capability signals rather than inferred absence:
  - Assert `stats.annBackend` is a non-extension backend and `stats.backendPolicy.reason` indicates the extension was attempted-but-unavailable (or disabled by policy).
  - Assert ANN query executes and returns plausible results, ideally by checking `scoreBreakdown.ann` presence like the retrieval smoke test does.

**Secondary issue (also P0 when sharded artifacts are enabled)**
- `tests/sqlite-ann-fallback.js:77–85` hardcodes `chunk_meta.json` and assumes doc IDs are in `[0, chunkCount-1]`. This will be wrong under sharded/jsonl chunk_meta formats and can be wrong even for `.json` if IDs are not positional. Use the artifact reader (`loadChunkMeta`) or validate IDs via sqlite.

---

### P0 — `sqlite-auto-backend` likely deletes the wrong sqlite directory (env mismatch between parent and spawned processes)

**Where**
- Child processes use `PAIROFCLEATS_CACHE_ROOT` set in `baseEnv` (`tests/sqlite-auto-backend.js:24–29`).
- The test deletes sqlite state using `resolveSqlitePaths(tempRoot, null)` without setting `process.env.PAIROFCLEATS_CACHE_ROOT` in the parent (`tests/sqlite-auto-backend.js:84–86`).

**What’s wrong**
- `resolveSqlitePaths()` (via `getRepoCacheRoot()`/`getCacheRoot()`) can depend on environment/config. In this script the environment used by child processes is not applied to the parent process.
- As written, `rm(sqlitePaths.dbDir)` can be a no-op against a different path than the one the spawned `build-sqlite-index.js` used, leading to spurious failures or false confidence depending on defaults.

**Suggested fix**
- Ensure the parent process computes sqlite paths using the same cache root and index root as child processes (set `process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot` in the parent before calling `resolveSqlitePaths`, or pass a loaded config object that encodes the cache root).
- After deletion, add an explicit existence check on the intended sqlite files before asserting backend selection.

---

### P0 — `tests/smoke.js` hardcodes non-streaming artifact names and unconditional sqlite table expectations

**Where**
- Index artifacts: `tests/smoke.js:51–57` hardcodes `chunk_meta.json`, `token_postings.json`, etc.
- SQLite table check: `tests/smoke.js:112–127` requires `dense_vectors`, `dense_meta`, etc regardless of config.

**What’s wrong**
- The codebase is actively moving toward sharded/jsonl artifacts and streaming-oriented index layouts. A smoke script that only looks for `.json` will report false negatives even when indexes are valid.
- The sqlite schema is feature-configurable (e.g., dense vectors may be absent when embeddings are disabled or when a sparse-only mode is configured). A “required tables” list must be derived from policy/config.

**Suggested fix**
- For index artifacts, switch from direct `existsSync` checks to using `src/shared/artifact-io.js` detection/loading helpers (or at minimum, accept `.json`, `.jsonl`, `*.parts/` + `*.meta.json`, and `*.shards/` layouts).
- For sqlite, compute required tables from:
  - posting features (chargrams/phrase/minhash),
  - embedding/vector settings, and
  - the selected backend policy.

---

### P0 — `subprocess-quoting` is vulnerable to startup log interleaving and request hangs

**Where**
- Reads only the first stdout line from the api-server as the startup JSON (`tests/subprocess-quoting.js:49–56`, `83–87`).
- HTTP requests have no explicit client timeout (`tests/subprocess-quoting.js:58–79`).

**What’s wrong**
- If the server prints any non-JSON banner/log line before the JSON “baseUrl” line, `JSON.parse(line)` fails and the test becomes flaky.
- If any request hangs, the test can hang indefinitely after startup, because only the startup wait has a timeout.

**Suggested fix**
- Replace “read first line” with “read until a valid JSON object with `baseUrl` is observed”, with an overall deadline.
- Add timeouts to HTTP requests (abort after N seconds) and surface stderr/stdout excerpts on failure.
- Avoid `SIGKILL` on platforms where it is unsupported; use a staged shutdown (SIGTERM then SIGKILL) or a shutdown endpoint if available.

---

### P0 — WAL/SHM size assertions are likely to be platform-dependent / flaky

**Where**
- `tests/storage/sqlite/incremental/wal-checkpoint.test.js:38–47` enforces `*-wal` and `*-shm` sizes <= 1024 bytes.

**What’s wrong**
- SQLite WAL/SHM file sizes can be affected by page size, journaling configuration, and OS specifics. Even after a successful checkpoint, SHM can remain larger than 1KB.
- The test is trying to validate “checkpoint/truncate is happening”, but file size is a weak proxy.

**Suggested fix**
- Validate checkpoint behavior using sqlite pragmas/return values (`PRAGMA wal_checkpoint(TRUNCATE);` results) or assert sidecars are removed when the build pipeline claims cleanup.
- If a size check is retained, set thresholds based on observed data in CI and page-size awareness.

---

## Additional Notable Findings (P1/P2)

### P1 — Over-reliance on `process.cwd()` as the repo root makes tests brittle

**Where (examples)**
- `tests/test-runner.js`, `tests/setup.js`, most `tests/smoke-*.js`, most sqlite integration scripts.

**What’s wrong**
- If the test runner is invoked from a non-root working directory, these scripts resolve paths incorrectly and fail for reasons unrelated to product behavior.

**Suggested fix**
- Centralize “repo root” resolution as a helper (based on `import.meta.url` or walking up to `package.json`) and use it consistently.

---

### P1 — `sublime-pycompile` assumes `python` exists (not portable)

**Where**
- `tests/sublime-pycompile.js:34` uses `process.env.PYTHON || 'python'`.

**Suggested fix**
- Try `python`, then `python3`, then skip with a clear reason if neither exists.

---

### P1 — `sqlite-missing-dep` uses `NODE_OPTIONS=--no-addons` (may not be supported / may be blocked)

**Where**
- `tests/sqlite-missing-dep.js` spawns child processes with `NODE_OPTIONS: '--no-addons'`.

**What’s wrong**
- The flag may not exist or may be disallowed in `NODE_OPTIONS`, producing failures unrelated to sqlite fallback behavior.

**Suggested fix**
- Prefer a project-controlled switch for sqlite availability (test-only env var that forces `optional-deps` to report missing), or gate the test by Node runtime capability.

---

### P1 — `shard-progress-determinism` encodes a strict ordering invariant that may not hold under parallelization

**Where**
- `tests/shard-progress-determinism.js:51–66` enforces `fileIndex` strictly increasing, initialized at `lastIndex = 0`.

**Suggested fix**
- Decide/document intended invariants; either enforce monotonic ordering in production and start at `-1`, or validate uniqueness/coverage rather than order.

---

### P2 — Human-string substring assertions are fragile across refactors

**Where (examples)**
- `tests/setup.js` expects `Setup complete.` in stdout/stderr.
- `tests/sqlite-bundle-missing.js` expects `falling back to file-backed artifacts`.
- `tests/sqlite-incremental-no-change.js` expects `sqlite indexes updated` even when no change.

**Suggested fix**
- Prefer `--json` outputs or stable event IDs/reason codes in logs for tests to assert against.

---

## Process Spec: Test Duration Telemetry + CI Tiering

This process meets the requirement: “track how long each test takes and use that to decide what runs where.”

### 1) Record per-test attempt timings (runner-level, authoritative)

For every test execution attempt, emit a single JSONL record:

```json
{"testId":"sqlite-incremental-no-change","lane":"integration","attempt":1,"durationMs":25333,"exitCode":0,"timedOut":false,"node":"v20.11.1","platform":"linux","arch":"x64"}
```

Minimum fields:
- `testId`, `lane`, `attempt`, `durationMs`, `exitCode`, `timedOut`

Highly recommended:
- `startedAt`, `endedAt`, `retryReason`, `skipReason`, peak memory stats (if available)

### 2) Persist an append-only timing ledger

- Write to: `tests/.cache/test-timings/<YYYY-MM-DD>.jsonl` (or cache-root equivalent).
- The ledger must be append-only to allow trend analysis (do not overwrite).

### 3) Compute actionable summaries

Add a small tool (or runner flag) that aggregates:
- per-test p50/p95 durations (rolling window),
- total time per lane,
- top slowest tests,
- tests with high variance (flakiness indicator).

### 4) Define lanes using evidence-based budgets

Example budgets:
- `smoke`: suite total <= 60s; per-test p95 <= 5s
- `unit`: suite total <= 5m; per-test p95 <= 30s
- `integration`: allowed slower; run on merges/nightly
- `perf`: scheduled only
- `optional-deps`: gated by env flags and separate lane

### 5) CI policy

- PR: run `smoke + unit` (and only the fastest/stablest integration slice, if any).
- Main merges: add `integration`.
- Nightly: `integration + optional-deps + perf`.
- Weekly: full matrix (OS, Node versions, optional deps).

### 6) Acceptance criteria

- Timing ledger exists and is updated on every CI run.
- Summaries are visible in CI logs.
- New/changed tests must declare a lane; slow tests cannot silently creep into smoke/unit.

---

## Coverage Gaps / Suggested Additions

1. Smoke verification should understand sharded/streaming artifacts (validate via artifact readers, not filenames).
2. Policy-driven sqlite table expectations (derive required tables from config and validate).
3. API server startup contract (tolerate logs; handshake should be robust and time-bounded).
4. Runner-level default for hermetic cache roots (`PAIROFCLEATS_CACHE_ROOT` per test by default).

---

## Triage Checklist (what to fix first)

1. Fix `sqlite-auto-backend` sqlite-dir deletion mismatch (P0).
2. Make `sqlite-ann-fallback` hermetic and artifact-format agnostic (P0).
3. Upgrade `tests/smoke.js` to understand sharded/jsonl artifacts and config-driven sqlite tables (P0).
4. Harden `subprocess-quoting` startup parsing and request timeouts (P0).
5. Replace WAL/SHM size heuristic with robust checkpoint validation (P0).
6. Reduce `process.cwd()` dependence via shared root-resolver helper (P1).
7. Improve portability: `python` vs `python3`, `SIGKILL`, `NODE_OPTIONS` gating (P1).
