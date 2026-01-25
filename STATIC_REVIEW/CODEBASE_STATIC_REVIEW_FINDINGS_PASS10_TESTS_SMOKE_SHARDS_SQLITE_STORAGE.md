# Codebase Static Review Findings — Pass 10 (Tests: Smoke + Shards + SQLite + Storage/SQLite Incremental)

> Scope: **Test scripts** covering smoke runs, shard planning/merge, SQLite build/search behavior, and `storage/sqlite` incremental/migration behavior (only the files listed in the request).  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness risks, portability problems, missing coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

### Setup / install flows
- `tests/setup.js`

### Smoke orchestration + utilities
- `tests/smoke.js`
- `tests/smoke-section1.js`
- `tests/smoke-embeddings.js`
- `tests/smoke-retrieval.js`
- `tests/smoke-services.js`
- `tests/smoke-sqlite.js`
- `tests/smoke-workers.js`
- `tests/smoke-utils.js`

### Sharding tests
- `tests/shard-merge.js`
- `tests/shard-plan.js`
- `tests/shard-progress-determinism.js`

### Index/build skip behavior test
- `tests/skip-minified-binary.js`

### SQLite build/search/ANN behavior tests
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

### Storage SQLite tests (bundles + incremental + migrations + reader mismatch)
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

---

## Executive Summary

Across this set of tests, the overall direction is strong: they cover end-to-end flows (build → sqlite → search), incremental update invariants, shard plan determinism, shard merge equivalence, skip/binary/minified policy enforcement, and several “fail closed / fall back” behaviors for SQLite and optional dependencies.

That said, there are several **high-impact correctness and reliability risks** that will likely cause false failures or low-signal tests as the codebase evolves:

1. **Many scripts assume `process.cwd()` is the repo root** (and also assume `./build_index.js`, `./search.js`, `./tools/*` exist relative to it). This is fragile if tests are invoked from a different working directory or via alternate runners. The storage SQLite tests already use `fileURLToPath(import.meta.url)` to derive `ROOT`; the rest should converge on that pattern.
2. **Some tests hardcode specific artifact filenames (e.g., `chunk_meta.json`, `token_postings.json`)** rather than using the piece manifest / artifact discovery logic. This is a major drift risk given the project’s direction toward **sharding**, **jsonl piece formats**, and **streaming**. The tests should validate *invariants* (“chunk meta is present and loadable”) rather than specific filenames.
3. **Optional dependency gating is inconsistent**:
   - Several tests correctly *skip* when `better-sqlite3` is missing.
   - Others intentionally simulate missing addons via `NODE_OPTIONS=--no-addons`, which may be Node-version dependent and can have unintended collateral effects.
   - The ANN fallback test assumes the sqlite extension is unavailable and fails if it is available, which will become a frequent footgun as CI/dev environments become better provisioned.
4. **Flakiness risks from FS timestamp resolution and SQLite WAL behavior**:
   - `tests/sqlite-cache.js` assumes `writeFile()` updates file signature immediately; on filesystems with coarse `mtime` resolution, it can intermittently fail.
   - `tests/storage/sqlite/incremental/wal-checkpoint.test.js` asserts WAL/SHM sizes are `< 1024` bytes; this is not portable across SQLite builds/platforms and can fail even if checkpointing is working.
5. **Multiple tests assert on human-readable log substrings** (e.g., “SQLite indexes updated”, “Validation (smoke) ok for code”, “falling back to file-backed artifacts”). These are brittle. Prefer machine-stable JSON fields or structured error codes, especially for tests intended to guard critical policies.

The remainder of the document enumerates concrete issues and recommended remediations, plus a **test timing ledger + CI tiering** plan to keep the suite sustainable.

---

## High-Priority Findings

### P0 — Repo root discovery via `process.cwd()` is brittle and will cause “it works locally” failures

**Where**
- Many test scripts (examples):
  - `tests/smoke.js` (line 18)
  - `tests/sqlite-ann-fallback.js` (line 7)
  - `tests/shard-merge.js` (line 8)
  - `tests/sqlite-missing-dep.js` (line 6)
  - `tests/sqlite-auto-backend.js` (line 7)
  - `tests/setup.js` (uses `process.cwd()` for `tools/setup.js` resolution)

**What’s wrong**
- These scripts assume they are executed with the repo root as the current working directory.
- They then build paths like `path.join(root, 'build_index.js')` or look for fixtures at `path.join(root, 'tests', 'fixtures', ...)`.
- If the test runner’s working directory changes (or if tests are invoked from `tests/` or a monorepo workspace), these path resolutions break.

**Why it matters**
- It increases false failures (environmental, not functional).
- It makes it harder to run subsets of tests from different contexts (CI steps, editor runners, package managers, etc.).

**Suggested fix**
- Standardize on the approach used in `tests/storage/sqlite/*`:
  - derive `ROOT` from `fileURLToPath(import.meta.url)` and `path.resolve(...)`;
  - treat `ROOT` as the repository root anchor.
- As a secondary/defensive measure, add a helper that asserts `build_index.js` exists at the computed root and prints a high-signal error if not.

---

### P0 — ANN fallback test is likely to become incorrect as environments gain the sqlite extension

**Where**
- `tests/sqlite-ann-fallback.js` (lines 66–73 and lines 77–85)

**What’s wrong**
- The test currently fails if:
  - `payload.stats.annBackend === 'sqlite-extension'`, or
  - `payload.stats.annExtension.available.code` is truthy.
- In other words: it asserts **the extension must be unavailable**.
- In environments where the vector extension is installed (CI, developer machines, packaged builds), this test will fail even if the system is working correctly.

**Why it matters**
- This creates a perverse incentive to keep the environment under-provisioned to make tests pass.
- It also blocks future work where sqlite extension is intended to be the default “best” ANN path when available.

**Suggested fix**
- Split this into two tests (or a single test with capability-driven branching):
  1. **Extension available** path: asserts `annBackend === 'sqlite-extension'` and validates correct id bounds / candidate filtering semantics.
  2. **Extension unavailable** path: asserts backend falls back (dense/HNSW/etc) and results remain valid.
- The critical invariant is not “extension unavailable”; it is: **`--ann` works** and produces valid doc ids, with a clear backend attribution.

**Additional coverage to add**
- Validate `payload.stats.annBackend` is one of an allowed set and that `payload.stats.annActive === true` in `--ann` mode, regardless of backend.

---

### P0 — `tests/smoke.js` hardcodes artifact filenames and likely drifts against sharded/jsonl output formats

**Where**
- `tests/smoke.js` (lines 51–57)

**What’s wrong**
- It requires `chunk_meta.json`, `token_postings.json`, and `minhash_signatures.json` under both code and prose index dirs.
- These names and expectations are brittle because:
  - the index build already has `pieces/manifest.json` plumbing;
  - sharded builds may emit `*.parts` and `*.meta.json` (which some tests already acknowledge);
  - vector-only or “no sparse/minhash” modes can legitimately omit artifacts.
- Additionally, the SQLite `requiredTables` list (lines 112–126) assumes every SQLite DB includes tables for dense, minhash, chargrams, phrases, etc., which may not be true under different index profiles.

**Why it matters**
- Smoke tests are supposed to be **high-signal** and **stable** across normal configuration variants.
- This test can become “always warning” or “always failing” even when the tool works, simply because output formats evolve.

**Suggested fix**
- Make the smoke checker **manifest-aware**:
  - If `pieces/manifest.json` exists, verify that the manifest lists required pieces (by *type/category*) rather than specific filenames.
  - Use the project’s artifact loader(s) to confirm “loadable chunk meta exists”, “loadable token postings exists”, etc.
- Make the SQLite table checks **profile-aware**:
  - Read the index state / config / manifest to determine which tables should exist for that index mode.
  - Validate only the tables that should be present given the configured feature set (sparse-only, dense-only, minhash enabled/disabled, etc.).

**Additional coverage to add**
- A smoke run for a sharded build (chunk_meta jsonl pieces, token postings sharded) that validates “loadable artifacts” rather than file names.

---

### P1 — `tests/sqlite-cache.js` can be flaky due to filesystem timestamp granularity

**Where**
- `tests/sqlite-cache.js` (lines 8–23)

**What’s wrong**
- The test writes `dbPath` twice in quick succession and expects `createSqliteDbCache().get(dbPath)` to detect a signature change and invalidate.
- If the signature uses `mtime` or coarse file stat fields, some filesystems may not record a different timestamp when writes occur within the same resolution window (common on network filesystems or certain Windows configurations).

**Why it matters**
- Flaky tests are extremely costly: they erode trust in the suite, slow down merges, and mask real regressions.

**Suggested fix**
- Ensure the test forces an observable stat change:
  - insert a small delay (or explicitly modify `mtime` via `utimes`) between writes; and/or
  - adjust the cache signature to include size + inode + (optionally) a short content hash if you want strong invariants.
- If the underlying cache is intentionally `mtime`-based for speed, the *test* should adapt to that reality by introducing a deterministic gap.

---

### P1 — WAL/SHM size assertion is not portable and may fail even if checkpointing works

**Where**
- `tests/storage/sqlite/incremental/wal-checkpoint.test.js` (lines 35–48)

**What’s wrong**
- The test asserts `-wal` and `-shm` sidecars are both `<= 1024` bytes after incremental update.
- SQLite WAL behavior depends on:
  - page size,
  - journaling mode,
  - checkpoint settings,
  - SQLite version/build,
  - filesystem behavior.
- A WAL file can remain larger than 1KB even after successful checkpoints, and SHM size can exceed 1KB depending on configuration.

**Why it matters**
- This is a classic cross-platform flake: it may pass on one OS/SQLite build and fail on another.

**Suggested fix**
- Prefer semantic checks over byte thresholds:
  - Run `PRAGMA wal_checkpoint(TRUNCATE);` in the code path (if that’s the desired policy), and verify the pragma result is “ok”.
  - Alternatively, inspect `PRAGMA wal_checkpoint` return codes / frames checkpointed.
  - If a size check is needed, set a much higher, empirically justified threshold or compare WAL size relative to DB size.
- If the project’s goal is “avoid unbounded WAL growth,” test that the WAL does not exceed some generous ceiling across multiple incremental updates, rather than requiring near-zero size.

---

### P1 — Bundle missing test is nondeterministic due to `Object.values(...)[0]`

**Where**
- `tests/sqlite-bundle-missing.js` (lines 60–66)

**What’s wrong**
- It selects a bundle name via:
  - `const manifestFiles = Object.values(manifest.files || {});`
  - `const bundleName = manifestFiles[0]?.bundle;`
- Object property iteration order is usually stable in modern V8, but relying on it across JSON generation paths can still produce nondeterminism if manifest creation order changes (scan order, sorting, platform differences).

**Why it matters**
- This can cause “randomly fails in CI but not locally” if the chosen entry happens to point to a bundle not suitable for deletion or is already missing.

**Suggested fix**
- Select deterministically:
  - choose the lexicographically smallest file path with a `bundle` field; or
  - pick a known fixture file (e.g., `src/index.js`) if present; or
  - sort entries by `bundle` or `file` before selecting.

---

### P1 — Excessive reliance on human-readable output strings makes tests churn-prone

**Where**
- Examples:
  - `tests/sqlite-incremental-no-change.js` expects “Validation (smoke) ok for code” and “sqlite indexes updated”
  - `tests/storage/sqlite/incremental/manifest-normalization.test.js` expects “SQLite indexes updated”
  - `tests/sqlite-bundle-missing.js` expects “falling back to file-backed artifacts”
  - `tests/storage/sqlite/migrations/schema-mismatch-rebuild.test.js` expects “schema mismatch”

**What’s wrong**
- These tests bind correctness to log messaging.
- Log output tends to change due to refactors, copy changes, or improved explanations—none of which should require test rewrites.

**Why it matters**
- The test suite becomes noisy and discourages improving UX/logging.

**Suggested fix**
- Prefer machine-stable outputs:
  - If the tool supports `--json`, add fields like `{ ok: true, updated: true, reasonCode: "SCHEMA_MISMATCH_REBUILD" }`.
  - For internal builder APIs (like `buildDatabaseFromBundles`), assert on structured return fields (which many tests already do).
- If string matching is unavoidable, centralize expected substrings in a helper and keep them minimal, or match by error codes included in logs.

---

## Additional Findings and Recommendations


### P2 — `tests/setup.js` is coupled to human-readable output and assumes stdout/stderr conventions

**Where**
- `tests/setup.js` (string assertions against “Setup complete.” and parsing `--json` output)

**What’s wrong**
- The test treats successful completion as a substring match on human output (“Setup complete.”). That message is a UX surface and is likely to change.
- The JSON mode path parses `stdout` only. If the setup tool ever prints JSON to `stderr` (or prints any extra log lines to `stdout`), the test will fail for formatting reasons rather than functional regression.

**Suggested fix**
- Prefer machine-stable output:
  - ensure `tools/setup.js --json` prints *only* JSON to stdout, logs to stderr;
  - have the test assert on structured JSON fields (e.g., `{ ok: true, installed: [...], skipped: [...] }`) rather than a human message.
- Derive repo root via `fileURLToPath(import.meta.url)` so the test does not depend on runner working directory.

### P2 — Some tests duplicate env injection and mutate `process.env` unnecessarily

**Where**
- Many scripts set both:
  - `const env = { ...process.env, ... }` **and**
  - `process.env.X = ...` (examples: `tests/sqlite-ann-fallback.js` lines 21–29; `tests/sqlite-sidecar-cleanup.js`)

**What’s wrong**
- In a “one-process-per-test” model it’s mostly harmless, but:
  - it creates confusion about what is actually being tested (child env vs parent env),
  - it becomes a real problem if the project ever runs tests in-process or parallelizes within a single node process.

**Suggested fix**
- Standardize:
  - never mutate `process.env` inside test scripts unless the test is explicitly about env precedence; and
  - always pass an explicit `env` object to spawned processes.

---

### P2 — Several tests do not clean up temp roots, risking disk bloat and cross-run contamination

**Where**
- Examples:
  - `tests/sqlite-sidecar-cleanup.js` does not remove `tempRoot` at end
  - `tests/sqlite-cache.js` does not remove `tempRoot`
  - Several `tests/storage/sqlite/incremental/*.test.js` rely on `setupIncrementalRepo` (unknown here) for cleanup, but this should be explicitly guaranteed.

**Why it matters**
- CI agents can accumulate many GB over time, causing unrelated failures.
- Local developer runs become slower and harder to reason about.

**Suggested fix**
- Standardize on:
  - `mkdtemp`-based temp roots, or
  - a deterministic `.cache/<test-name>` plus unconditional cleanup in `finally`.
- If Windows is a target, prefer the `rmWithRetries` pattern used in `tests/sqlite-incremental-no-change.js`.

---

### P2 — Shard merge test compares full JSON blobs, which is brittle to harmless metadata evolution

**Where**
- `tests/shard-merge.js` (lines 101–112)

**What’s wrong**
- It compares entire `chunk_meta` and token postings via `JSON.stringify(...)`.
- Any new field added to chunk meta (timestamps, additional docmeta, new analysis fields) may make baseline vs sharded differ even if it is semantically equivalent (ordering, non-deterministic fields, etc.).

**Suggested fix**
- Compare invariant subsets:
  - stable fields (file, start/end ranges, language, chunk id) and/or
  - compare by canonicalized/sorted forms.
- For postings, compare:
  - vocab equality and postings equality after stable sort,
  - and/or checksums computed from the canonicalized representation.

---

### P2 — `resolveSqlitePaths(tempRoot, null)` is suspicious and may not match actual configuration

**Where**
- `tests/sqlite-auto-backend.js` (line 84)

**What’s wrong**
- Passing `null` for config may mean:
  - “use defaults”, or
  - “missing required config”, depending on implementation.
- The rest of the suite generally passes `loadUserConfig(...)` results, or `{}`.

**Suggested fix**
- Use `loadUserConfig(tempRoot)` to avoid implicit behaviors and make path resolution consistent with real execution.

---

### P2 — `NODE_OPTIONS=--no-addons` simulation may not be portable across Node versions

**Where**
- `tests/sqlite-missing-dep.js` (lines 47–51, 64–71)

**What’s wrong**
- The test relies on a Node runtime flag. If the flag is unsupported, Node may exit with an “unknown option” error, and the test will fail for the wrong reason.
- It can also disable more than just `better-sqlite3`, potentially affecting other optional native modules that the CLI might use.

**Suggested fix**
- Detect capability first:
  - run `node --help` or check `process.versions.node` and skip this test if the flag is unavailable (or use a different mechanism).
- Prefer a purpose-built knob:
  - introduce a test-only env like `PAIROFCLEATS_DISABLE_SQLITE=1` or `PAIROFCLEATS_FORCE_NO_SQLITE=1` that the backend policy respects.
- If you keep `--no-addons`, ensure the test asserts “flag recognized” before proceeding.

---

## Coverage Gaps Worth Addressing

These are not necessarily “bugs,” but are high-value improvements to keep tests aligned with the roadmap (sharding, streaming, policy centralization):

1. **Manifest-driven artifact verification**
   - Add a test that loads the manifest and validates presence/shape of all required artifacts for at least one profile (sparse+dense, dense-only, sparse-only).
2. **Sharding + streaming end-to-end**
   - One e2e that builds a sharded index, assembles/merges, and then runs retrieval using only streaming ingestion paths (where available) to ensure there’s no accidental “read from disk repeatedly” regression.
3. **Backend policy determinism**
   - Add a test that exercises sqlite auto policy with multiple knobs and asserts the policy output is stable and fully explainable via structured fields (not logs).

---

## Test Duration Telemetry and CI Tiering Plan

You asked for a process to track per-test duration and use it to make informed decisions about what runs where (CI smoke vs full integration). Here is a pragmatic plan that fits how these tests are structured (many are standalone node scripts that spawn build/index/search steps):

### 1) Add a lightweight “timed test runner” wrapper

**Goal:** record `{ testFile, start, end, durationMs, exitCode, tags }` for every test execution.

Implementation approach:
- Centralize in the existing test runner (or introduce a new wrapper command) that:
  - records `t0=performance.now()` (or `Date.now()`),
  - spawns `node <testFile>`,
  - records `t1` and exit status,
  - appends a JSONL line to `tests/.cache/test-timings.jsonl` (or a per-run file).
- Maintain a “rolling aggregate”:
  - after each run, compute p50/p95 per test and emit `tests/.cache/test-timings-summary.json`.

### 2) Introduce explicit test tiers (smoke / integration / e2e / perf)

Add a minimal metadata mechanism:
- Option A (zero code changes to tests): infer tiers via filename/path conventions:
  - `tests/smoke-*.js` → `smoke`
  - `tests/storage/sqlite/incremental/*.test.js` → `integration`
  - `tests/perf/**` → `perf`
- Option B (more explicit): allow each test to export a small header block (comment or JSON) parsed by the runner:
  - `// test-meta: {"tier":"integration","budgetMs":60000,"requires":["better-sqlite3"]}`

Then gate by env:
- `PAIROFCLEATS_TEST_TIER=smoke` runs only smoke-tier tests.
- `PAIROFCLEATS_TEST_TIER=full` runs everything except perf.
- `PAIROFCLEATS_TEST_TIER=nightly` runs full + heavier e2e scenarios.

### 3) Use historical timing to enforce budgets

- In CI smoke lane:
  - enforce a small total budget (e.g., 5–10 minutes) and include only the fastest subset (p95-based).
- In PR integration lane:
  - allow more time; run sqlite/storage incremental tests (still capped).
- Nightly:
  - run the full suite plus additional multi-repo e2e and benchmarking harnesses.

Make the budget enforcement explicit and self-documenting:
- Fail if any test exceeds its p95 by >X% (with a “soft fail” mode initially).
- Emit a report listing the slowest tests and where the time went (usefully, many tests already print progress).

### 4) Make capability-driven skipping consistent

Augment the runner to detect capabilities once and expose them to tests:
- e.g., environment variables:
  - `PAIROFCLEATS_CAP_SQLITE=1/0`
  - `PAIROFCLEATS_CAP_VECTOR_EXTENSION=1/0`
  - `PAIROFCLEATS_CAP_NODE_NO_ADDONS=1/0`
- Tests can:
  - skip (exit 0) when capabilities are missing,
  - or fail only if they are *meant* to validate behavior under those capabilities.

This prevents the current inconsistency where some tests hard-fail on missing deps while others skip.

---

## Summary of Recommended Changes (Checklist)

This section is intended as a concrete to-do list derived from the findings above.

### Must-do (stability/correctness)
- [ ] Standardize repo-root derivation across all test scripts (migrate from `process.cwd()` to `fileURLToPath(import.meta.url)` + `path.resolve(...)`).
- [ ] Update `tests/sqlite-ann-fallback.js` to be capability-aware (split into “extension available” vs “extension unavailable” or branch by detection).
- [ ] Make `tests/smoke.js` manifest-aware and profile-aware; stop hardcoding artifact filenames and SQLite table sets.
- [ ] Fix flakiness in `tests/sqlite-cache.js` (force stat change deterministically).
- [ ] Rework WAL checkpoint test to use semantic checks rather than `<= 1024` size thresholds.
- [ ] Remove nondeterminism in `tests/sqlite-bundle-missing.js` by selecting a bundle deterministically.

### Should-do (maintenance)
- [ ] Replace brittle log substring assertions with structured outputs (`--json` result codes) wherever feasible.
- [ ] Standardize temp directory cleanup patterns; ensure every test cleans its cache/temp root in `finally`.
- [ ] Reduce duplication of env handling; prefer explicit child `env` objects without mutating parent `process.env`.

### Testing infrastructure improvements
- [ ] Add test duration telemetry (JSONL per run + summary) and tiered execution controls.
- [ ] Establish CI lanes: smoke (fast), integration (sqlite/storage incremental), nightly (full + heavy e2e), perf (separate).
- [ ] Add capability-driven skip metadata for optional dependencies (sqlite, vector extension, node flags).

---
