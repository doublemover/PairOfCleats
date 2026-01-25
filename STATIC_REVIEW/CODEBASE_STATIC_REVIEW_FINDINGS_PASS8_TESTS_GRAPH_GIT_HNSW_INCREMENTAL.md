# Codebase Static Review Findings (Pass 8)

## Scope

This pass statically reviews **only** the following files:

### Tests
- `tests/format-fidelity.js`
- `tests/git-blame-range.js`
- `tests/git-hooks.js`
- `tests/git-meta.js`
- `tests/graph-chunk-id.js`
- `tests/gtags-ingest.js`
- `tests/hnsw-ann.js`
- `tests/hnsw-atomic.js`
- `tests/hnsw-candidate-set.js`
- `tests/hnsw-distance-metrics.js`
- `tests/ignore-overrides.js`
- `tests/import-links.js`
- `tests/import-priority.js`
- `tests/import-scan.js`
- `tests/incremental-cache-signature.js`
- `tests/incremental-manifest.js`
- `tests/incremental-reuse.js`
- `tests/incremental-tokenization-cache.js`

### Test helpers
- `tests/helpers/api-server.js`
- `tests/helpers/fixture-index.js`
- `tests/helpers/mcp-client.js`
- `tests/helpers/search-filters-repo.js`
- `tests/helpers/sqlite-incremental.js`
- `tests/helpers/triage.js`

---

## Executive summary (highest-value issues)

Across this set, the primary risks are **test non-hermeticity and brittleness**, rather than functional correctness bugs:

1. **Artifact-format assumptions in tests and helpers**  
   Several files read `chunk_meta.json` / `file_relations.json` directly, rather than using artifact readers that handle JSONL and/or sharded “pieces” modes. If the index defaults change (or fixtures get larger), these tests can fail for reasons unrelated to the feature under test.

2. **Hanging test risk due to unbounded child processes and unconsumed stdio**  
   Many tests invoke `spawnSync(...)` without any timeout; a single stuck index build will stall the entire suite. Separately, the API-server helper spawns a process with `stderr: 'pipe'` but never reads it; enough output can backpressure the child and cause a deadlock.

3. **Cache and repo reuse risks (stale/false-green tests)**  
   Helpers that “build only if chunk_meta exists” can unintentionally reuse stale results when the code changes or config changes, producing false passes.

4. **Git assumptions in `tests/git-meta.js`**  
   Unlike other Git-dependent tests, it does not skip when Git is unavailable, and it assumes the working directory is within a Git repo.

---

## Cross-cutting findings (apply to many files)

### A) Prefer artifact readers over direct `*.json` reads
**Problem:** direct reads hard-code format. The codebase already supports multiple artifact encodings/strategies (JSON, JSONL, pieces/shards).  
**Risk:** feature tests turn into “format stability tests” and fail when format changes.

**Recommendation:**
- Use `src/shared/artifact-io.js` helpers wherever possible:
  - `loadChunkMeta(dir)` rather than `JSON.parse(fs.readFileSync(path.join(dir,'chunk_meta.json')))`
  - introduce / use a `loadFileRelations(dir)` helper rather than reading `file_relations.json` directly
- In helpers like `tests/helpers/fixture-index.js`, replace `hasChunkMeta()` with a more robust existence check:
  - accept `chunk_meta.json`, `chunk_meta.jsonl`, or `pieces/manifest.json` entry for `chunk_meta`.

### B) Add hard timeouts to all child process invocations
**Problem:** most `spawnSync` calls have no timeout.  
**Risk:** a single hang (WASM load stall, deadlocked worker pool, tool download waiting on network, etc.) blocks the suite indefinitely.

**Recommendation:**
- Standardize a helper: `runNodeSync(args, { cwd, env, timeoutMs, stdioMode })`
- Use `spawnSync(..., { timeout: timeoutMs })` for sync runs.
- Ensure failure output includes `signal` and `error` fields (spawnSync provides them).

### C) Avoid `stderr: 'pipe'` without a consumer for long-running children
**Problem:** `tests/helpers/api-server.js` spawns with `stderr: 'pipe'` but never reads it.  
**Risk:** stderr buffer fills → child blocks on write → server never reaches “ready” → test stalls until timeout (or forever if no timeout triggers).

**Recommendation:**
- Prefer `stderr: 'inherit'` in tests, or attach a drain:
  - `server.stderr.on('data', () => {})` at minimum, or pipe to process stderr.

### D) Ensure tests are hermetic with respect to cache/config
**Problem:** some helpers/build steps are “build only if chunk_meta exists,” which is a cache hit not tied to a specific config signature.  
**Risk:** false-green tests when output exists but is semantically stale.

**Recommendation:**
- Ensure cached fixture indexes are invalidated when:
  - repo content changes
  - config signature changes
  - artifact schema/version changes
- Practical approach: write a small “fixture signature file” in the cache root:
  - hash of `{package.json version, selected config subset, test name}`

---

## Findings by file

Severity scale used below:
- **P0**: can hang CI, produce silent corruption/false-greens, or block progress
- **P1**: flaky/brittle tests or likely-to-break assumptions
- **P2**: maintainability issues, clarity gaps, minor correctness risks

### `tests/format-fidelity.js`
**What it does:** builds an index for `tests/fixtures/formats` and asserts chunking/extraction works across several formats.

**Findings**
- **P1 – Hard-coded artifact format**: reads `chunk_meta.json` and `file_meta.json` directly. If chunk meta switches to JSONL/pieces, this test fails unrelated to format parsing fidelity.
- **P2 – Redundant env mutation**: sets `env` and also mutates `process.env` in-place. If a shared-process runner is ever used, this leaks.

**Suggestions**
- Use `loadChunkMeta()` instead of reading `chunk_meta.json`.
- Introduce a `loadFileMetaMap(dir)` helper in `src/shared/artifact-io.js` (or the tests) rather than duplicating file-id mapping logic in multiple tests.
- Add a spawn timeout for `build_index.js` invocation.

---

### `tests/git-blame-range.js`
**What it does:** creates a two-commit repo, builds an index, and asserts chunk-level authors match line ownership.

**Findings**
- **P1 – Over-coupled to chunk boundaries**: it asserts the `alpha` chunk is exactly line range `1–3`. This is testing both blame range mapping *and* chunking strategy. Chunking changes could break it even if blame logic is correct.
- **P1 – Implicit assumption that blame is enabled**: the test expects `chunk_authors` to exist; if default config changes (or is platform-gated), the test fails without clearly indicating it’s a config/default drift.

**Suggestions**
- Consider loosening the “exact range” assertion:
  - locate chunks by name, then validate that the **line-range passed to blame** is reflected, without assuming the chunker emits `1–3`.
  - If strictness is desired, explicitly document “this test pins the JS chunker’s function boundaries.”
- Make blame enabling explicit in the build config (via `PAIROFCLEATS_TEST_CONFIG`) so the test does not depend on defaults.

---

### `tests/git-hooks.js`
**What it does:** runs `tools/git-hooks.js --install/--uninstall` in a temp repo and checks the hook file is created/removed.

**Findings**
- **P2 – No timeout**: low likelihood of hang, but should follow the suite-wide convention.

**Suggestions**
- Add timeouts to all child process invocations for consistency.

---

### `tests/git-meta.js`
**What it does:** calls `getGitMeta()` for `README.md` and checks blame can be disabled.

**Findings**
- **P0 – Missing “git available” / “in a git repo” guard**: unlike other Git tests, it does not skip when Git is missing, and it assumes the working directory is inside a Git checkout.
- **P1 – Weak signal for blame correctness**: when blame is enabled it only checks the type of `chunk_authors` *if present*, not that it is present or meaningful. If `getGitMeta()` silently returns `{}` on error, the test still passes.

**Suggestions**
- Either:
  - make this hermetic like `git-blame-range.js` (create a temp repo and test a known file), or
  - add skip logic when Git is missing or `.git` is absent.
- Strengthen the enabled-blame assertion: for a known repo/file, ensure `chunk_authors` includes an expected author.

---

### `tests/graph-chunk-id.js`
**What it does:** verifies `buildRelationGraphs()` emits stable `id` based on `metaV2.chunkId` and preserves `legacyKey`.

**Findings**
- **P2 – Over-simplified chunk fixtures**: the chunk objects omit several fields that real chunks contain (ranges, ids, etc.). If `buildRelationGraphs()` starts depending on those fields, this test might become misleading (either failing for non-production reasons or passing while missing a real edge case).

**Suggestions**
- Expand the fixture chunks minimally to resemble real chunk meta shape (include `startLine/endLine` and/or `fileId`), to make this a closer proxy to real indexing output.

---

### `tests/gtags-ingest.js`
**What it does:** runs `tools/gtags-ingest.js` with a fixture input and asserts output JSONL contents.

**Findings**
- **P1 – Assumes first record ordering**: it asserts properties of `lines[0]`. If ingestion output ordering changes (e.g., sorted by file/name), the test fails even if the data is correct.
- **P2 – Minor: extra blank line**: harmless but suggests copy/paste drift.

**Suggestions**
- Search for a specific record (by `{file,name}`) rather than assuming it is the first line.
- Add an assertion that `.meta.json` exists before reading, for clearer failure mode.

---

### `tests/ignore-overrides.js`
**What it does:** tests negated ignore overrides (extraIgnore includes `!dist/allow.js`).

**Findings**
- **P1 – Relies on default ignore semantics**: the test assumes `dist/**` is ignored by default so that `deny.js` is excluded. If default ignore patterns change, the test breaks.
- **P2 – Limited coverage**: it covers only one override form (negation) and one directory.

**Suggestions**
- Make the ignored pattern explicit in the test setup (e.g., write a `.gitignore` or `.pairofcleatsignore` in the temp root) so the test is independent of defaults.
- Consider adding a second case that verifies `extraIgnore` can both add ignores and negate them, with clear precedence.

---

### `tests/import-links.js`
**What it does:** builds an index for a tiny repo and asserts `file_relations.json` contains `importLinks` that connect files importing the same module name.

**Findings**
- **P1 – Hard-coded artifact format**: reads `file_relations.json` directly; if this becomes JSONL or sharded/pieces-based, the test fails unrelated to import linking correctness.
- **P1 – Assumes a specific importLinks semantic**: it expects symmetrical links between A and B and *no links to C*. This is reasonable, but it is tightly coupled to the current definition of “importLinks.”

**Suggestions**
- Use (or introduce) a `loadFileRelations()` helper that abstracts file_relations encoding.
- Consider asserting “contains expected relationship” rather than exact equality, unless exact equality is meant to be a contract.

---

### `tests/import-priority.js`
**What it does:** validates stable ordering produced by `sortImportScanItems()`.

**Findings**
- **P1 – Depends on tie-break behavior**: if counts/sizes are equal, ordering can be unstable unless the comparator explicitly ties on `index` or another stable key.
- **P2 – No assertion of stability under ties**: the fixture has ties (a vs d counts both 10), but still expects a deterministic outcome.

**Suggestions**
- If deterministic output is required, ensure the comparator has an explicit final tie-breaker (`index`, then `relKey`) and extend the test to include equal-size+equal-count items.

---

### `tests/import-scan.js`
**What it does:** calls `scanImports()` and ensures dynamic `import('dyn-lib')` is detected, without spurious numeric keys.

**Findings**
- **P2 – Limited fixture variety**: only dynamic import is exercised; no coverage for `require()` or static `import` in this test (though other tests may cover).
- **P2 – No timeout**: not typically an issue here, but standardization helps.

**Suggestions**
- Add a second file in the fixture that uses `require('x')` and confirm both are recorded, so the test exercises multiple branches in `scanImports()`.

---

### `tests/hnsw-ann.js`
**What it does:** tests deterministic tie-breaking and candidate filtering in `rankHnswIndex()`, then builds a fixture index and asserts HNSW artifacts exist and retrieval stats report HNSW.

**Findings**
- **P1 – Heavy integration test with no explicit lane gating here**: it builds indexes and embeddings, which is expensive. This is fine if it is assigned to a slower test lane, but the file itself does not express that.
- **P2 – No assertion that result set is non-empty**: it validates stats, not retrieval usefulness.

**Suggestions**
- Ensure the test runner assigns this to an “integration”/“storage” lane (if not already) and enforce time budgets.
- Add `timeout` to all spawnSync calls.
- Optionally assert at least one hit is returned for a known query, to validate end-to-end ANN path is actually producing results.

---

### `tests/hnsw-atomic.js`
**What it does:** verifies HNSW index replacement writes a `.bak`, and that `.bak` fallback loading works when primary index is corrupted.

**Findings**
- **P1 – Assumes HNSW artifacts always exist**: this is likely valid because `hnswlib-node` is a dependency, but if HNSW can still be disabled via config, the test should force-enable it.
- **P2 – Manual corruption may not simulate real corruption**: writing `'corrupt'` may not match failure modes in `loadHnswIndex()` if it expects structured binary; but this is still a reasonable smoke test.

**Suggestions**
- Consider explicitly enabling HNSW in the test config (via `PAIROFCLEATS_TEST_CONFIG`) to avoid defaults drift.
- Add timeouts to spawned build steps.

---

### `tests/hnsw-candidate-set.js`
**What it does:** unit-level candidate filtering and ordering tests for HNSW ranking.

**Findings**
- **P2 – Space-specific assumption for L2**: asserts `sim` is negative for L2. If the implementation ever normalizes to “higher is better” across spaces, this test breaks. That may be acceptable if the negative-distance contract is intentional.

**Suggestions**
- If you want “higher is better” invariant, adjust test expectations to that invariant; otherwise, document that L2 uses negative distance.

---

### `tests/hnsw-distance-metrics.js`
**What it does:** confirms that ranking works correctly for `l2`, `cosine`, and `ip`.

**Findings**
- **P2 – Sparse assertions**: it checks top hit id and sorting, but not numerical correctness of similarity/distance values.

**Suggestions**
- If you want deeper correctness: assert ordering across more than two vectors and validate monotonicity in returned sim values for each metric.

---

### `tests/incremental-cache-signature.js`
**What it does:** ensures incremental build caching is reused when config is stable and invalidated when config signature changes.

**Findings**
- **P1 – Structural coupling to `.filelists.json` layout**: it expects `fileLists.scanned.sample[].cached` exists. This is fine as a contract test, but it will break if internal filelist schemas evolve.
- **P2 – Missing assertions about *why* cache invalidated**: it checks `cached !== true`, but not that the rebuild occurred for the intended reason (config signature mismatch), so failures can be ambiguous.

**Suggestions**
- Include an explicit “reason” field in `.filelists.json` entries (e.g., `cacheReason: 'hit'|'miss-config'|'miss-hash'|...`) and assert it here.

---

### `tests/incremental-manifest.js`
**What it does:** ensures incremental manifest mtimeMs updates after touching a file.

**Findings**
- **P1 – Filesystem timestamp resolution risk**: it forces `mtime` forward by 5 seconds, which helps; however, strict equality checks can still be problematic across filesystems that round or normalize timestamps.
- **P2 – Manifest schema coupling**: assumes `manifest.files['sample.js'].mtimeMs` exists and matches `fs.statSync().mtimeMs`.

**Suggestions**
- If timestamp resolution becomes an issue, change assertion to “updated and within epsilon” rather than strict equality, or store integer `Math.floor(mtimeMs)` consistently in both places.

---

### `tests/incremental-reuse.js`
**What it does:** unit test for `shouldReuseIncrementalIndex()` behavior given manifest and file entries.

**Findings**
- **P2 – Stage mismatch semantics are opaque in the test**: it passes `stage: 'stage1'` while index_state is `'stage2'`. If the intended behavior is “reuse is allowed when prior output stage is >= current stage”, the test is valid but could use a clarifying comment.

**Suggestions**
- Add a short comment describing the intended semantics: “reusing stage2 outputs for a stage1 request is permitted (it’s a superset).”

---

### `tests/incremental-tokenization-cache.js`
**What it does:** ensures tokenization cache invalidates on postings config changes and dictionary config changes.

**Findings**
- **P1 – Structural coupling to `.filelists.json` layout** (same as `incremental-cache-signature.js`).  
- **P1 – The dictionary change invalidation expectation is broad**: `dictionary.includeSlang` change invalidates cache, which may be correct, but the test does not assert that tokenization *actually* changes (it asserts the caching policy, not the correctness of invalidation).

**Suggestions**
- Consider asserting that `dictEntry.cacheKey` (if exposed) changed due to dictionary config delta, for clearer diagnostics.

---

## Test-duration tracking and lane budgeting (requested process)

This is a recommended process to keep the suite fast and intentional, and to prevent “accidentally expensive” tests from creeping into smoke lanes.

### 1) Produce a per-test timing artifact on every run
- Wrap each test execution (each `node tests/<file>.js`) with high-resolution timing:
  - start: `process.hrtime.bigint()`
  - end: `process.hrtime.bigint()`
- Emit a JSONL or JSON artifact:
  - `tests/.cache/test-times.jsonl` (one record per test)
  - fields: `{ testFile, lane, status, durationMs, startedAt, nodeVersion, platform }`

### 2) Maintain lane budgets and enforce them
Define budgets (examples):
- **smoke**: < 2 minutes total, < 10 seconds per test
- **unit**: < 5 minutes total
- **integration**: allowed to be slow, but bounded per test (e.g. 2–3 minutes)
- **perf**: excluded from normal CI; run on demand or nightly

Enforcement:
- In the runner, if a test exceeds `lane.maxTestMs`, fail with a clear message:
  - “Test X exceeded 10s budget for lane smoke; move it to integration/perf or optimize.”

### 3) Track regressions over time
- Keep a baseline file in-repo (e.g., `tests/budgets/test-times-baseline.json`) updated intentionally.
- In CI, compare current timing medians to baseline:
  - warn at +25%, fail at +50% for smoke/unit lanes
- Emit a summary report at the end:
  - slowest 10 tests
  - total time by lane
  - biggest regressions

### 4) Make expensive “index build” tests explicit
For tests like `hnsw-ann.js` / `format-fidelity.js` / “build entire repo” tests:
- Make it explicit via naming convention and/or metadata:
  - e.g. `tests/integration/hnsw-ann.test.js` (folder-based lanes), or
  - add a header comment the runner can parse:
    - `// lane: integration`
- Prefer shared helpers that cache fixture indexes **with a signature** so speedups do not create false-greens.

---

## Consolidated remediation checklist (no code changes included)

### P0 (do first)
- [ ] Add timeouts to spawned processes across these tests (standard helper; enforce in CI).
- [ ] Fix `tests/git-meta.js` hermeticity: skip when Git is unavailable / not in a Git repo, or rewrite to use a temp Git repo.
- [ ] Ensure `tests/helpers/api-server.js` drains `stderr` or uses `inherit` to avoid deadlock.

### P1 (next)
- [ ] Replace direct artifact file reads (`chunk_meta.json`, `file_relations.json`) with artifact-io readers that support JSONL/pieces.
- [ ] Harden `ensureFixtureIndex()` and `ensureSearchFiltersRepo()` to avoid stale index reuse:
  - signature-based invalidation tied to config + version.
- [ ] Loosen tests that accidentally pin unrelated implementation details (e.g., strict chunk line ranges) unless that is explicitly intended.

### P2 (quality/maintainability)
- [ ] Standardize helper naming and correctness (e.g., `hasChunkMeta()` variable naming in `search-filters-repo.js`).
- [ ] Improve diagnostic detail in incremental cache tests by asserting explicit cache miss reasons.
- [ ] Extend unit tests (import scan, HNSW metrics) to cover more fixture variation where cost is low.

