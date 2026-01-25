# Codebase Static Review Findings — Tests: Indexing / Incremental / Artifacts / ANN / Parsers (Pass 8)

This report is a focused static review of the **test scripts** listed in the request. The emphasis is on:

- **Correctness** (tests asserting the right invariants)
- **Flake risk** (timing/mtime assumptions, locale sensitivity, environment leakage)
- **Future-proofing** (supporting sharded/JSONL artifacts and evolving configs)
- **Operational realism** (integration tests that build indexes, optional dependency gating)
- **Test suite scalability** (how to measure and budget test time for CI vs. heavier runs)

All file references are relative to the repo root.

## Scope

Files reviewed (as requested):

### Index cache / lifecycle / locks / validation
- `tests/index-cache.js`
- `tests/index-lifecycle-contract.js`
- `tests/index-lock.js`
- `tests/index-metrics-options.js`
- `tests/index-validate.js`
- `tests/indexer-service.js`

### Incremental planner + signatures + determinism
- `tests/indexer/incremental-plan.test.js`
- `tests/indexer/index-signature.test.js`
- `tests/indexer/signatures.test.js`
- `tests/indexer/sort-determinism.test.js`

### Fixture indexing invariants
- `tests/indexing/fixtures/build-and-artifacts.test.js`
- `tests/indexing/fixtures/minhash-consistency.test.js`
- `tests/indexing/language-fixture/chunk-meta-exists.test.js`
- `tests/indexing/language-fixture/postings-integrity.test.js`
- `tests/indexing/type-inference/crossfile-output.integration.test.js`

### Runtime / parsing / ANN / filters
- `tests/io-concurrency-cap.js`
- `tests/js-tree-sitter-maxbytes.js`
- `tests/json-stream.js`
- `tests/jsonl-utf8.js`
- `tests/jsonl-validation.js`
- `tests/jsonrpc-parser.js`
- `tests/kotlin-perf-guard.js`
- `tests/lancedb-ann.js`
- `tests/lang-filter.js`

## Severity Key

- **Critical**: very likely to produce false failures, hide real regressions, or destabilize CI; or it enforces an incorrect contract.
- **High**: meaningful flake risk, overly brittle coupling to defaults/artifact formats, or can materially slow/derail CI.
- **Medium**: correctness edge cases, maintainability problems, test readability/debuggability gaps.
- **Low**: polish and ergonomics.

---

## Executive Summary

- **[High] Several tests hard-code artifact filenames and formats** (`chunk_meta.json`, `token_postings.json`, `minhash_signatures.json`) **even though the codebase already supports sharded and/or JSONL forms.** This makes the suite fragile under the roadmap direction of **sharding + streaming + WASM grouping**, and under any future “default artifact format” changes. Representative examples:
  - `tests/indexing/fixtures/build-and-artifacts.test.js` (lines 14–25)
  - `tests/indexing/fixtures/minhash-consistency.test.js` (lines 35–36)
  - `tests/indexing/type-inference/crossfile-output.integration.test.js` (lines 78–88)

- **[High] `tests/js-tree-sitter-maxbytes.js` likely has a path resolution bug** that can prevent the test from finding the intended skip entry. It resolves `entry.file` relative to the *PairOfCleats project cwd* instead of the *fixture repo root* (`path.resolve(entry.file)` at line 59). If `.filelists.json` stores relative paths (e.g., `src/big.js`), this comparison fails even when the skip entry exists.

- **[High] Multiple cache/signature tests are vulnerable to time-resolution flakiness** if signatures depend on `mtimeMs` or other coarse timestamps:
  - `tests/index-cache.js` (lines 23–31)
  - `tests/indexer/index-signature.test.js` (lines 23–31)

- **[Medium] `tests/jsonl-validation.js` contains a likely mis-specified “truncated second line” fixture.** The string written at line 49 includes a literal `\n` sequence; if the reader splits on real newlines, the error may report line 1 rather than line 2, meaning the test may not validate the intended behavior.

- **[Medium] Multiple “heavy” integration tests spawn full index builds but are not explicitly budgeted, categorized, or time-profiled.** As the roadmap adds languages, richer graph artifacts, and more tooling-backed inference, this will become a major CI reliability and throughput problem. This report includes a concrete process for **timing instrumentation + suite partitioning**.

---

## 1) Index Cache / Signature / Lifecycle Tests

### 1.1 **[High] Potential flake: signature invalidation relies on fast successive writes**
**Where**
- `tests/index-cache.js:23–31`
- `tests/indexer/index-signature.test.js:23–31`

**What’s wrong**
- Both tests assume that writing a file twice in quick succession will always change the **index signature** used for cache invalidation.
- If the signature implementation ever uses file timestamps (or uses coarse `mtime` resolution on some platforms/filesystems), these tests can become intermittent: the second write can land within the same timestamp “tick,” leaving the signature unchanged.

**Why it matters**
- These are guardrail tests for cache correctness. Flaky guardrails erode trust and lead to “retry until green.”

**Suggestions**
- Make the tests robust to coarse timestamp resolution:
  - Introduce a small delay between writes (or explicitly bump `mtime` via `utimes`) if the signature is time-based.
  - If the intended design is **content-hash signatures**, restructure the test to assert content-hash behavior (and, if possible, add an “explain signature inputs” debug path for failures).

---

### 1.2 **[Medium] Temp directories created via `mkdtemp()` are not cleaned up**
**Where**
- `tests/index-cache.js:8–10`

**What’s wrong**
- The test allocates a fresh tmp directory but does not remove it at the end.

**Suggestions**
- Wrap the test body in `try/finally` and `rm(tempRoot, { recursive: true, force: true })`.
- Standardize a shared helper pattern for temp dirs (see §8.5).

---

### 1.3 **[Medium] Lifecycle contract test uses a fixed `.cache` path**
**Where**
- `tests/index-lifecycle-contract.js:7–13`

**What’s wrong**
- The test uses a deterministic directory: `tests/.cache/index-lifecycle`.
- If the test suite ever runs concurrently (or a prior run is interrupted), this can cause collisions or confusing reuse.

**Suggestions**
- Use `mkdtemp()` or incorporate a per-run suffix (PID + timestamp).
- Prefer “copy fixture repo into temp + cacheRoot in temp” patterns for e2e tests.

---

### 1.4 **[Medium] Index lock test assumes PID `999999` is always nonexistent**
**Where**
- `tests/index-lock.js:17–22`

**What’s wrong**
- It writes `{ pid: 999999 }` to simulate a dead process.
- Linux `pid_max` is commonly > 999999 (and can go up to ~4 million), so this PID *can* exist in real environments.

**Suggestions**
- Use an “impossible” PID (e.g., `99999999`) or encode “stale lock” via timestamp rather than PID existence.
- Add separate tests for:
  - stale-by-timestamp handling
  - dead-pid handling (when PID probing is enabled)

---

### 1.5 **[High] `indexer-service` test does not set a cache root**
**Where**
- `tests/indexer-service.js:25–38`

**What’s wrong**
- The test spawns `tools/indexer-service.js` without an explicit `env` override.
- If the tool reads defaults from the user environment (home dir cache, global config), it can create or mutate state outside of `tests/.cache`.

**Suggestions**
- Pass an explicit `env` including:
  - `PAIROFCLEATS_TESTING=1`
  - `PAIROFCLEATS_CACHE_ROOT=<tempRoot>/cache`
- Ensure the queue directory (`queueDir`) is created and is the only write location (if that is the intended behavior).

---

## 2) Index Metrics / Validate: Contract Drift & Fixture Isolation

### 2.1 **[Medium] Metrics options test is tightly coupled to current defaults**
**Where**
- `tests/index-metrics-options.js:50–56`

**What’s wrong**
- The test asserts `metrics.artifacts.compression.enabled === false` and `documentExtraction.enabled === false`.
- Roadmap-driven changes (streaming/sharding/compression defaults) can legitimately change these defaults.

**Suggestions**
- Decide whether the test is meant to lock in *defaults forever* or ensure that **metrics reflect configuration**.
- More resilient contract:
  - Set explicit config via `PAIROFCLEATS_TEST_CONFIG` (or a fixture config file),
  - Assert the emitted metrics match that explicit config, not implicit defaults.

---

### 2.2 **[High] Index validate test builds directly against a committed fixture directory**
**Where**
- `tests/index-validate.js:8–36`

**What’s wrong**
- The test uses `tests/fixtures/sample` as the repo to index (line 8).
- Even if indexing output is redirected to `PAIROFCLEATS_CACHE_ROOT`, builds can still create/modify repo-local state (tool caches, markers, etc.). This can lead to:
  - dirty working trees,
  - test pollution across runs,
  - OS-specific tool side-effects.

**Suggestions**
- Copy the fixture repo to a temp directory and index that copy (as done in `tests/lancedb-ann.js:23`).
- Ensure `index-validate` is validated against the temp copy, not the committed fixture folder.

---

### 2.3 **[Medium] JSON output parsing assumes `--json` implies “stdout is JSON-only”**
**Where**
- `tests/index-lifecycle-contract.js:49–55`
- `tests/index-validate.js:70–76`
- `tests/indexer-service.js:45`
- `tests/lancedb-ann.js:77`

**What’s wrong**
- These tests parse `stdout` as JSON without guarding against incidental log output on stdout.

**Suggestions**
- Standardize a tool invariant: when `--json`, **stdout must be JSON-only** (logs go to stderr). Then these tests are correct.
- Otherwise, consider adding a `--json-only` mode and testing that contract explicitly.

---

## 3) Incremental Planner & Signature Tests

### 3.1 **[Medium] Incremental reuse test does not cover common failure modes**
**Where**
- `tests/indexer/incremental-plan.test.js:32–46`

**What’s missing**
- Behavior when:
  - `index_state.json` is missing,
  - `pieces/manifest.json` is missing or empty,
  - entries contain extra files not present in manifest,
  - manifest contains files not present in entries (deletions),
  - `mtimeMs` changes but size does not.

**Suggestions**
- Add explicit negative tests ensuring `shouldReuseIncrementalIndex()` returns `false` (and does not throw) for missing/partial state.
- Add a deletion case and an mtime-only change case.

---

### 3.2 **[Medium] Signature tests encode “what must change,” but not “what must not change”**
**Where**
- `tests/indexer/signatures.test.js:67–93`

**What’s wrong**
- The test checks that certain changes (parser choice, embedding batch size, tool version) alter the signature.
- It does not check stability for benign changes that should *not* force a rebuild (verbosity flags, progress UI settings, etc.).

**Suggestions**
- Add at least one “stability” assertion to prevent signature over-sensitivity that forces unnecessary rebuilds.

---

### 3.3 **[Low/Medium] Sort determinism can be locale-sensitive**
**Where**
- `tests/indexer/sort-determinism.test.js:5–7`

**Risk**
- If `compareStrings()` uses `localeCompare()` without explicit locale/options, ordering can differ across environments.

**Suggestions**
- If deterministic ordering is required for stable artifact generation, enforce byte-wise ordering in `compareStrings()` (and keep this test).
- If locale-aware ordering is intended, update the test to match that intent and document it.

---

## 4) Fixture Indexing: Artifact Presence & Integrity

### 4.1 **[High] Fixture tests hard-code monolithic JSON artifacts**
**Where**
- `tests/indexing/fixtures/build-and-artifacts.test.js:14–25`
- `tests/indexing/fixtures/minhash-consistency.test.js:35–36`
- `tests/indexing/type-inference/crossfile-output.integration.test.js:78–88`

**What’s wrong**
- These tests assume `chunk_meta.json`, `token_postings.json`, etc. exist directly, even though the system supports `*.meta.json` + parts and JSONL outputs.

**Suggestions**
- Make the tests artifact-format aware:
  - Discover artifacts via a manifest / meta file (if available),
  - Load them via the same “artifact IO” abstraction used by production that understands sharding/JSONL.
- If the test goal is “artifact exists and is readable,” assert **discoverability + readability** rather than a specific filename.

---

### 4.2 **[Medium] Minhash consistency test assumes chunk meta retains full `tokens` arrays**
**Where**
- `tests/indexing/fixtures/minhash-consistency.test.js:22–30`

**What’s wrong**
- It uses `chunk.tokens` as the canonical token list.
- If chunk meta is slimmed down (dropping per-chunk tokens to reduce artifact size), this test fails even if minhash artifacts remain correct.

**Suggestions**
- Decide the intended contract:
  - If tokens must always be in chunk meta, keep the test.
  - If tokens may be omitted, load tokens from the canonical tokenization artifact instead.

---

### 4.3 **[Medium] Token postings integrity is sharding-aware but narrow**
**Where**
- `tests/indexing/language-fixture/postings-integrity.test.js:12–34`

**What it does well**
- Supports both monolithic and sharded postings.

**Gaps**
- Validates only that counts are integers; does not validate doc IDs, ranges, or ordering.

**Suggestions**
- Add one more cheap invariant if helpful:
  - doc IDs are non-negative integers,
  - optional: doc IDs are strictly increasing within each postings list.

---

## 5) Cross-file Type Inference Integration Test

### 5.1 **[High] Brittle to artifact format and “source labeling”**
**Where**
- `tests/indexing/type-inference/crossfile-output.integration.test.js:78–117`

**What’s wrong**
- Requires `chunk_meta.json` (line 78), reads it directly.
- Asserts `entry.source === 'flow'` (line 104). If cross-file inference labels evolve (`'crossfile'`, `'tooling'`, `'tsserver'`, etc.), the test fails even though the type is correct.
- Asserts a specific shape for `callLinks`/`usageLinks` (lines 109–117); any schema evolution breaks the test.

**Suggestions**
- Separate **semantic assertions** from **schema assertions**:
  - Semantic: “buildWidget has inferred return type Widget.”
  - Schema: “there exists a call edge from buildWidget to createWidget” (schema-flexible matching).
- Load artifacts using the canonical loader that supports JSONL/shards where applicable.

---

### 5.2 **[Medium] Cache root is not created explicitly**
**Where**
- `tests/indexing/type-inference/crossfile-output.integration.test.js:9–14, 56–58`

**What’s wrong**
- `cacheRoot` is set but never created; the build likely creates it, but the test depends on that behavior.

**Suggestions**
- `await fsPromises.mkdir(cacheRoot, { recursive: true })` for robustness and clarity.

---

## 6) Parsing / JSONL / JSON-RPC Tests

### 6.1 **[Medium] JSONL “truncated second line” fixture likely does not contain a real newline**
**Where**
- `tests/jsonl-validation.js:48–58`

**What’s wrong**
- The file is written using a JS string containing a literal `\n` sequence, not an actual newline.
- That likely produces a single-line file with an embedded backslash-n, so line-number assertions (`:2`) may be invalid.

**Suggestions**
- Write the intended fixture using a literal newline:
  - `await fs.writeFile(truncatedPath, '{"id":1}\n{"id":2');` **(literal newline between objects, no closing brace on the second line)**
  - More explicit:
    - `await fs.writeFile(truncatedPath, '{"id":1}\n{"id":2');` but written as a template literal:
      ```js
      await fs.writeFile(truncatedPath, `{"id":1}
      {"id":2`);
      ```
- Ensure the test truly produces two lines: a valid first line, then a truncated second line.

---

### 6.2 **[Low] JSON stream test assumes `readJsonFile()` is synchronous**
**Where**
- `tests/json-stream.js:53`

**Risk**
- If `readJsonFile()` ever becomes async, this test will fail in a confusing way.

**Suggestions**
- If `readJsonFile()` is intentionally sync, document that in the test.
- Otherwise, make the call consistently `await`-based.

---

### 6.3 **[Low] JSON-RPC overflow test enforces “hard stop after overflow”**
**Where**
- `tests/jsonrpc-parser.js:24–29`

**Note**
- This is a valid safety contract, but it prevents future “recoverable” modes without test updates.

---

## 7) Performance Guardrails & Optional Dependencies

### 7.1 **[Low] Kotlin perf guard message wording is misleading**
**Where**
- `tests/kotlin-perf-guard.js:36–38`

**What’s wrong**
- The file is not “large”; it is skipped due to configured caps.

**Suggestions**
- Adjust assertion message to “skipped due to caps” to reduce confusion during failures.

---

### 7.2 **[Medium] LanceDB ANN test relies on implicit backend selection**
**Where**
- `tests/lancedb-ann.js:66–85`

**Risk**
- The test expects `stats.annBackend === 'lancedb'` without explicitly configuring “prefer LanceDB” (unless this is an intentional default when the dependency exists).
- If backend selection policy changes (prefer HNSW/sqlite-vec unless configured), this becomes brittle.

**Suggestions**
- Make backend selection explicit for the test via:
  - config/env knob, or
  - CLI option (if supported).
- On failure, print any “backend decision” debug output (if available) to speed diagnosis.

---

## 8) Test Runtime Accounting, Budgets, and Suite Partitioning

This set includes multiple “real integration tests” that spawn full index builds. As the roadmap adds:

- sharding/streaming pipelines
- more languages (and WASM grouping orchestration)
- richer graph artifacts
- tooling-backed inference parity

…the time and variability of these tests will grow. You want a disciplined mechanism to **measure**, **budget**, and **route** tests into the right CI lanes.

### 8.1 Central timing harness (no per-test modifications required)

**Goal**
- Track wall-clock duration per test file in a machine-readable log.
- Use that data to define:
  - CI **smoke** suite (fast, deterministic)
  - CI **standard** suite (moderate)
  - nightly/pre-release **e2e/integration** suite (slow or multi-repo)

**Design**
- Add a runner (example): `tools/run-tests.js`
  - Reads a manifest of test files (or globs)
  - Spawns each test as a child process (matching the current model)
  - Records:
    - start time / end time
    - exit code
    - optional tag(s)
    - node version + platform
  - Writes append-only `tests/.cache/test-times.jsonl` (one JSON record per test)

**Output schema (example)**
```json
{ "test":"tests/index-validate.js", "status":"pass", "ms":18342, "ts":"2026-01-20T12:34:56Z", "node":"v20.11.0", "platform":"linux", "tags":["integration","index-build"] }
```

**CI usage**
- Upload `test-times.jsonl` as an artifact
- Summarize the slowest tests in CI logs
- Gradually enforce budgets (warn first, fail later)

### 8.2 Tagging tests (incremental adoption)

Because tests are plain Node scripts, tagging needs to be lightweight:

1) **Filename convention (cheap)**
- `*.integration.test.js` → integration
- `*.e2e.js` → e2e
- `*.perf.js` → perf guardrails
- everything else → unit-ish

2) **Header metadata comment (explicit)**
- First lines include:
  - `// @test-tags: integration,index-build`
- Runner parses first ~5 lines.

### 8.3 CI lane budgets (concrete starting point)

Define budgets from measurement:

- **Smoke CI**: <= 60s total; no optional deps; no multi-repo; no large index builds.
  - Candidates from this set:
    - `tests/lang-filter.js`
    - `tests/indexer/sort-determinism.test.js`
    - `tests/jsonrpc-parser.js`
    - `tests/jsonl-utf8.js`
    - `tests/json-stream.js` (non-zstd path)
    - `tests/kotlin-perf-guard.js`

- **Standard CI**: <= 5–10 minutes total; allows tiny fixture builds (cached).
  - Candidates:
    - `tests/index-cache.js`
    - `tests/indexer/index-signature.test.js`
    - `tests/indexer/signatures.test.js`
    - `tests/indexer/incremental-plan.test.js`
    - `tests/indexing/language-fixture/*` (if fixture build is cached)

- **Nightly / pre-release**: slow tests, optional deps, ANN builds, tool-heavy steps.
  - Candidates:
    - `tests/lancedb-ann.js`
    - `tests/js-tree-sitter-maxbytes.js`
    - `tests/index-lifecycle-contract.js`
    - `tests/index-metrics-options.js`
    - `tests/indexing/type-inference/crossfile-output.integration.test.js`

### 8.4 Preventing accidental CI blowups

Add a “time sentinel” policy:

- For smoke suite:
  - any test exceeding ~5s → warn (do not fail initially)
- For standard suite:
  - any single test exceeding ~60s → require tag `slow` (or move to nightly)
- For nightly:
  - no strict cap, but always report top 10 runtimes

### 8.5 Small refactors that pay off quickly

To reduce duplication and errors across tests like these:

- Add `tests/helpers/run.js`:
  - `runNode(script, args, { cwd, env, timeoutMs })` wrapper
  - Standardizes encoding, stderr printing, and exit handling
- Add `tests/helpers/temp.js`:
  - `withTempDir(prefix, fn)` + `copyFixture(name, dest)`
- Add `tests/helpers/env.js`:
  - `withEnv({ ...vars }, fn)` restores env after run

---

## 9) Quick Checklist of Concrete Fixups (Test-Only)

- [ ] **Fix** `tests/js-tree-sitter-maxbytes.js` path matching to resolve `entry.file` relative to `repoRoot` (or require `.filelists.json` to emit absolute paths). (`tests/js-tree-sitter-maxbytes.js:59`)
- [ ] **Fix** `tests/jsonl-validation.js` truncated JSONL fixture to use a real newline and truly truncated second line. (`tests/jsonl-validation.js:48–58`)
- [ ] **Harden** cache/signature tests against timestamp resolution flake (delay/utimes or content-hash assertion). (`tests/index-cache.js:23–31`, `tests/indexer/index-signature.test.js:23–31`)
- [ ] **Isolate fixture indexing**: avoid building indexes directly in committed fixture dirs; copy to temp for e2e tests. (`tests/index-validate.js:8–36`)
- [ ] **Make artifact-format aware**: load via manifest/meta loaders instead of hard-coded filenames where practical. (`tests/indexing/fixtures/*`, `tests/indexing/type-inference/*`)
- [ ] **Introduce centralized test time tracking** and define smoke/standard/nightly suites with budgets. (see §8)

