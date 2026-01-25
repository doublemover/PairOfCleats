# Codebase Static Review Findings — Pass 10 (Shards + Smoke + SQLite Tests)

> Scope: **tests/** scripts listed in the request (shard planning/merge, smoke orchestration, and SQLite build/retrieval/incremental behavior).  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness risks, portability problems, missing test coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

### Shards / progress

- `tests/shard-merge.js`
- `tests/shard-plan.js`
- `tests/shard-progress-determinism.js`

### Smoke entrypoints / orchestration

- `tests/setup.js`
- `tests/skip-minified-binary.js`
- `tests/smoke-embeddings.js`
- `tests/smoke-retrieval.js`
- `tests/smoke-section1.js`
- `tests/smoke-services.js`
- `tests/smoke-sqlite.js`
- `tests/smoke-utils.js`
- `tests/smoke-workers.js`
- `tests/smoke.js`

### SQLite build / extension / incremental

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

---

## Executive Summary

This slice of the test suite does a good job validating end-to-end “real user” flows (build index → build sqlite → search → incremental updates → compaction), and it has several strong correctness contracts (e.g., **sqlite fail-closed index_state**, bundle fallback behavior, ANN extension table sanity, and shard output equivalence). The main weaknesses are *not* conceptual; they’re mostly **reliability, determinism, and drift resistance** problems:

1. **Environment-dependent behavior is not always controlled by the tests**, particularly in `tests/sqlite-ann-fallback.js`, which can fail depending on whether the sqlite ANN extension is present on the host machine.
2. **Artifact-shape drift risk**: a few tests assume specific artifact filenames/structures (notably `tests/smoke.js`, and to a lesser degree `tests/sqlite-ann-fallback.js`) and may become misleading as indexing formats evolve (e.g., parts/jsonl vs single json).
3. **Hanging-test risk**: most scripts use `spawnSync()` with no timeout. If any child command hangs (download prompts, deadlocks, SQLite locks), the entire CI job can hang.
4. **Flakiness vectors**: filesystem timestamp resolution issues (`tests/sqlite-cache.js`), output-string matching on human logs (`tests/sqlite-bundle-missing.js`, `tests/sqlite-incremental-no-change.js`), and implicit assumptions about stream destinations (`tests/shard-progress-determinism.js` reads only stderr).
5. **Test suite tiering and time budgeting**: many of these are “integration-style” tests (build indexes, sqlite rebuilds, compaction) but they live as ordinary scripts. Without an explicit timing ledger + tiers, it’s difficult to keep CI fast while still running the right tests at the right cadence.

The remainder of this document enumerates concrete issues and recommended fixes, then proposes a **test duration tracking + suite partitioning** approach tailored to this repo’s “Node script tests” model.

---

## High-Priority Findings

### P0 — `sqlite-ann-fallback` is not deterministic: it does not actually force “fallback”

**Where**
- `tests/sqlite-ann-fallback.js`

**What’s wrong**
- The test asserts that ANN is **not** using the sqlite extension:
  - `payload?.stats?.annBackend !== 'sqlite-extension'`
  - `payload?.stats?.annExtension?.available?.code` is falsy
- But the test never explicitly disables the extension. If a developer machine (or CI) has the extension present and enabled, this test will fail even though the product is behaving correctly (choosing the best available ANN backend).
- This creates an **environment-dependent test outcome**, which undermines trust in the suite.

**Why it matters**
- The test is intended to validate fallback behavior (no-extension scenario). If it fails because the extension is present, it becomes impossible to distinguish “real regression” from “host variability.”

**Suggested fix**
- Make the test explicitly force the fallback path, instead of inferring it:
  - Add a test-only config/env switch used by `search.js`/ANN policy to disable extension usage (for example: `PAIROFCLEATS_DISABLE_SQLITE_EXTENSION=1`, or a config knob under `search.vectorAnn.preferExtension=false`).
  - Alternatively, point extension resolution to an empty/nonexistent extension dir for this test run.
- Ensure the test also asserts the **positive fallback invariant** (what it *should* do), not just what it *shouldn’t* do:
  - e.g. verify `stats.annActive === true` when `--ann` is passed but `annBackend` is the fallback backend (HNSW, memory dense, etc.), and that results include an `ann` score breakdown source consistent with the fallback.

---

### P0 — Hanging-test risk: almost all scripts spawn child processes without timeouts

**Where**
- `tests/setup.js`
- `tests/shard-merge.js`
- `tests/shard-progress-determinism.js`
- `tests/skip-minified-binary.js`
- `tests/smoke-*.js` (via `tests/smoke-utils.js`)
- Most SQLite integration scripts (`tests/sqlite-*.js`)

**What’s wrong**
- `spawnSync()` is used extensively, but without the `timeout` option. If a child script blocks (e.g., waiting for a tool install prompt, stuck on filesystem lock, or an infinite loop), the test process can hang indefinitely.
- This is particularly risky in:
  - index builds (`build_index.js`)
  - sqlite rebuilds (`tools/build-sqlite-index.js`)
  - compaction (`tools/compact-sqlite-index.js`)

**Why it matters**
- CI reliability. A single hang is far more costly than a failure: it ties up CI workers and produces low-signal “timed out” failures at the job level.

**Suggested fix**
- Centralize process execution for tests (even if still using standalone scripts) by adding a small helper:
  - A `spawnWithTimeout(label, args, { timeoutMs, ... })` wrapper.
  - Enforce reasonable defaults: e.g., 60s for unit scripts, 5–10 minutes for integration scripts (index build, sqlite build).
- Use different timeouts per tier (see the timing/tiering section).

---

### P0 — `tests/smoke.js` appears drift-prone against evolving artifact formats and config toggles

**Where**
- `tests/smoke.js`

**What’s wrong**
- The script checks for artifact files by fixed names:
  - `chunk_meta.json`, `token_postings.json`, `minhash_signatures.json`, and optionally `phrase_ngrams.json`, `chargram_postings.json`.
- Elsewhere in the repo (and even in this pass) there are tests and codepaths that support sharded/parts artifacts (e.g., `chunk_meta.parts`, `token_postings.shards`, meta sidecars). `tests/smoke.js` does not check those alternatives.
- The sqlite “requiredTables” check hardcodes phrase/chargram/dense tables as always-required. But indexing can plausibly disable phrase ngrams or chargrams, making those tables legitimately absent.

**Why it matters**
- A smoke script is typically used as a **“first-line diagnostic.”** If it gives false negatives, it will waste debugging cycles and reduce confidence.

**Suggested fix**
- Treat `tests/smoke.js` as a *capability-aware verifier*, not a “fixed filenames” verifier:
  - For each artifact family, check for **one-of** valid layouts:
    - chunk meta: `chunk_meta.json` OR `chunk_meta.jsonl` OR (`chunk_meta.parts` + `chunk_meta.meta.json`)
    - token postings: `token_postings.json` OR (`token_postings.shards` + `token_postings.meta.json`)
  - For sqlite, derive expected tables from the same config used to build (postings config toggles, dense enabled, etc.). If phrase/chargrams are disabled, don’t require those tables.
- Consider adding a `--json` mode to `tests/smoke.js` so other automation can consume its checks without parsing logs.

---

## Additional High-Impact Findings

### P1 — `tests/sqlite-cache.js` can be flaky due to timestamp resolution and equal file size

**Where**
- `tests/sqlite-cache.js`

**What’s wrong**
- The test writes `'initial'` and then `'changed'` to the same file. Both strings have length 7, meaning the file size may remain unchanged.
- If `createSqliteDbCache()` uses `(mtimeMs, size)` as a signature, it depends on `mtimeMs` changing.
- On some file systems (or in some CI container setups), `mtime` can have coarse resolution. Two writes in quick succession can produce the same `mtime`, causing the cache not to invalidate and the test to fail.

**Suggested fix**
- Make the mutation unambiguous:
  - Ensure size changes (`'changed!!!'`), or
  - Explicitly `await` a minimal sleep and/or use `fs.utimes` to force mtime advance, or
  - If the cache signature is hash-based, the test can remain size-equal (but then should assert it really hashes).

---

### P1 — `tests/sqlite-incremental-no-change.js` relies on human-log substrings that can drift

**Where**
- `tests/sqlite-incremental-no-change.js`

**What’s wrong**
- The test asserts outputs contain:
  - `'Validation (smoke) ok for code'`
  - `'sqlite indexes updated'` (case-insensitive)
- If the implementation improves messaging (or shifts logs between stdout/stderr), the test can fail without a functional regression.

**Suggested fix**
- Prefer machine-stable signals over human strings:
  - Add a `--json` or `--report json` option to `tools/build-sqlite-index.js` that emits a structured summary: `{ mode, changedFiles, rebuiltTables, validationStatus, ... }`.
  - Or reuse the existing progress JSONL system for a final summary event the test can parse.

---

### P1 — Several tests assume they are executed from repo root via `process.cwd()`

**Where**
- Many scripts set `const root = process.cwd();` and then reference `build_index.js`, `search.js`, or fixture paths relative to it:
  - `tests/setup.js`
  - `tests/shard-merge.js`
  - `tests/shard-progress-determinism.js`
  - `tests/skip-minified-binary.js`
  - `tests/smoke-utils.js` (exports `root = process.cwd()`)
  - Many sqlite tests

**What’s wrong**
- If the test runner ever executes these scripts from a different working directory (or a developer runs one test from a subdir), path resolution can break.

**Suggested fix**
- Use `import.meta.url` to anchor paths to the test file location:
  - `const root = path.resolve(new URL('..', import.meta.url).pathname, '..');` (exact expression may vary)
- Or standardize the runner so it always sets `cwd` to repo root before invoking test scripts, and assert that in the runner.

---

### P1 — `tests/shard-merge.js` may not cover multi-worker shard merge behavior

**Where**
- `tests/shard-merge.js`

**What’s wrong**
- The sharded build is configured with `indexing.maxWorkers: 1`. This is understandable for determinism, but it reduces coverage for:
  - parallel file processing
  - nondeterministic ordering bugs that only show up under concurrency
  - merge correctness under multi-worker contention

**Suggested fix**
- Add a second scenario (or parameterize this test) that uses `maxWorkers: 2` (or more), but still asserts **byte-for-byte stable outputs** by:
  - enforcing deterministic sorting at merge boundaries, and
  - ensuring the build pipeline uses stable ordering for merges (this test already validates equality; the goal is to increase the chance of catching concurrency-only drift).

---

### P2 — Progress determinism test reads only stderr and assumes a specific progress routing

**Where**
- `tests/shard-progress-determinism.js`

**What’s wrong**
- The test parses progress JSONL from `result.stderr` only. If progress output is ever redirected to stdout (or split), the test stops validating anything.

**Suggested fix**
- Parse both `stdout` and `stderr` (concatenate) or enforce that progress is always sent to a dedicated fd (and then the test should assert it).

---

### P2 — Minor correctness/clarity issues in skip test messaging

**Where**
- `tests/skip-minified-binary.js`

**What’s wrong**
- Error message says `Expected binary skip entry for binary.js` but the file under test is `binary.png`. This is small, but it reduces debugging clarity.

**Suggested fix**
- Update the message to match the file.

---

### P2 — `tests/sqlite-build-indexes.js` resolves sqlite paths using `{}` rather than the loaded config

**Where**
- `tests/sqlite-build-indexes.js`

**What’s wrong**
- It loads `userConfig = loadUserConfig(repoRoot)` (used for index dir checks), but uses:
  - `resolveSqlitePaths(repoRoot, {})`
- If `resolveSqlitePaths()` interprets `{}` differently than “no config” (or defaults differ), the test could open the wrong database location.

**Suggested fix**
- Use the same `userConfig` object consistently, or pass `null` if the API expects that for default resolution.

---

### P2 — Candidate-set threshold assumptions are encoded as magic numbers

**Where**
- `tests/sqlite-vec-candidate-set.js`

**What’s wrong**
- It assumes a threshold at ~900 candidates (small set uses `rowid IN`, large set does not). If this constant changes for performance reasons, the test fails despite correct behavior.

**Suggested fix**
- Either:
  - import the threshold constant (if one exists) and use it in the test, or
  - assert behavior in a way that’s independent of the exact threshold (e.g., “very small set uses pushdown” and “very large set does not,” with sizes chosen around an exported constant).

---

## Missing Coverage Opportunities

These are not “bugs,” but places where the suite could better defend critical behavior.

1. **Shard merge under concurrency**
   - Expand `tests/shard-merge.js` to include a multi-worker scenario (see P1 above).

2. **ANN fallback verification that is truly independent of host state**
   - After adding a deterministic disable mechanism, assert that:
     - `--ann` still returns results,
     - `scoreBreakdown.ann.source` matches the intended fallback backend,
     - behavior remains stable across code/prose mode.

3. **Smoke verifier parity with artifact formats**
   - After updating `tests/smoke.js` to accept parts/jsonl layouts, add a small test that runs it against:
     - a “single-file artifacts” index, and
     - a “parts/shards” index (if configurable).

4. **SQLite WAL/SHM cleanup behavior on failure paths**
   - `tests/sqlite-sidecar-cleanup.js` validates success paths; consider also simulating a failure mid-build that leaves WAL/SHM present, and ensure rebuild still cleans them.

---

## Test Duration Tracking, Tiering, and Budgeting Process

The repo already uses “script-style tests” heavily (each test is a Node script, often spawning `build_index.js` or other tools). That model can still support robust timing and tiering if you add a thin layer of **measurement + metadata**.

### 1) Introduce a canonical test manifest

Create a manifest file (example name: `tests/manifest.json`) that defines:

- `id` (stable identifier)
- `path` (script path)
- `tier`:
  - `unit` (fast, pure logic)
  - `integration` (touches filesystem, builds small fixture)
  - `e2e` (builds full indexes / runs services / multi-repo)
  - `perf` (benchmarks; excluded by default)
- `capabilities`:
  - `needsBetterSqlite3`
  - `needsSqliteExtension`
  - `needsGit`
  - `needsNetwork`
- `timeoutsMs` (default and per-tier)
- `notes` (why it exists / what it protects)

This immediately answers: “What tests run in CI smoke vs nightly vs local?”.

### 2) Add a timing ledger that is automatically updated

In the test runner (or in each smoke orchestrator), record:

- start time, end time, duration
- exit status
- machine info (optional): Node version, platform key
- tier + capabilities snapshot

Write as JSONL to `tests/.timings/timings.jsonl` (append-only), and optionally summarize to a small `tests/.timings/summary.json` that keeps rolling averages and p95.

A minimal design:

- Each test execution emits a line:
  ```json
  {"id":"sqlite-incremental-no-change","tier":"integration","ms":8421,"ok":true,"node":"v20.11.1","platform":"darwin-arm64","ts":"2026-01-21T00:00:00Z"}
  ```
- A `tools/report-test-timings.js` script aggregates:
  - average and p95 per test
  - total time per tier
  - identifies regressions vs baseline

### 3) Enforce budgets in CI

Use the ledger + tiers to enforce:

- **PR smoke suite**: must complete within N minutes.
  - includes `unit` + selected `integration` tests that are cheap and high-signal
- **Nightly e2e**: can run longer, includes the heavier sqlite/index build tests
- **Perf suite**: opt-in only (never on PRs), and should publish results separately

If a test’s p95 creeps above a threshold, it should either:
- be moved to a heavier tier, or
- be optimized, or
- have its fixture downsized.

### 4) Make dependency gating explicit and consistent

A large fraction of this pass depends on optional capabilities:

- `better-sqlite3` (many sqlite tests)
- sqlite ANN extension (ann-extension test)
- native addons disabled (sqlite-missing-dep test)

Instead of each test doing bespoke detection, unify via helpers:

- `requireCapability('better-sqlite3')` → skip with clear reason, or fail if CI requires it
- `requireCapability('sqlite-extension')` → skip if missing

This reduces drift and makes CI intent explicit.

---

## Quick Notes per File (Targeted Observations)

This section is intentionally brief; detailed findings are above.

- `tests/setup.js`: good coverage of non-interactive setup, but add timeout and avoid `process.cwd()` anchoring.
- `tests/shard-merge.js`: strong equivalence test; consider adding a multi-worker scenario.
- `tests/shard-plan.js`: good determinism + labeling tests; brittle expectations around shard label formats are acceptable if treated as contract.
- `tests/shard-progress-determinism.js`: useful monotonic fileIndex check; parse stdout+stderr (or assert routing).
- `tests/skip-minified-binary.js`: good skip reason validation; minor error message mismatch.
- `tests/smoke-*.js` + `tests/smoke-utils.js`: helpful orchestration, but needs timeouts and explicit tier placement.
- `tests/smoke.js`: valuable verifier but likely behind current artifact/config realities; needs modernization.
- `tests/sqlite-ann-extension.js`: good incremental/orphan-row checks; “skip if missing extension” is reasonable but should be visible in timing/manifest.
- `tests/sqlite-auto-backend.js`: good backend policy coverage; ensure logs don’t pollute JSON.
- `tests/sqlite-cache.js`: mtime/size flake risk.
- `tests/sqlite-incremental-no-change.js`: good state invariants; reduce reliance on log substrings.
- `tests/sqlite-index-state-fail-closed.js`: excellent fail-closed contract test.
- `tests/sqlite-sidecar-cleanup.js`: good protection against WAL/SHM corruption.
- `tests/sqlite-vec-candidate-set.js`: useful safety checks (invalid column); avoid hardcoding thresholds.

---

## Recommended Next Actions (No Code Changes Here)

1. Make `sqlite-ann-fallback` deterministic by explicitly disabling extension for the test run.
2. Add spawn timeouts via a shared helper (or update `smoke-utils.js`).
3. Modernize `tests/smoke.js` to understand both single-file and sharded artifact layouts, and to derive expected sqlite tables from config.
4. Fix `sqlite-cache` flake risk by changing file mutation semantics.
5. Add test manifest + timing ledger so CI can be tiered and time-budgeted confidently.
