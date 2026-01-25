# Codebase Static Review Findings — Tests (Search, Script Coverage, Segments, Queue, Safe Regex) — Pass 9

This report is a focused static review of the **test harness + test scripts** listed in the request. The emphasis is on **correctness**, **contract clarity**, **determinism**, and **test suite operability** (repeatability, cross-platform behavior, and CI cost control).

All file references are relative to the repo root.

## Scope

Files reviewed (as requested):

### Safe regex
- `tests/safe-regex-engine.js`

### SCIP ingest
- `tests/scip-ingest.js`

### Script coverage harness
- `tests/script-coverage-harness.js`
- `tests/script-coverage.js`
- `tests/script-coverage/actions.js`
- `tests/script-coverage/paths.js`
- `tests/script-coverage/report.js`
- `tests/script-coverage/runner.js`

### Search / retrieval CLI tests
- `tests/search-contract.js`
- `tests/search-determinism.js`
- `tests/search-explain-symbol.js`
- `tests/search-explain.js`
- `tests/search-help.js`
- `tests/search-missing-flag-values.js`
- `tests/search-missing-index.js`
- `tests/search-removed-flags.js`
- `tests/search-rrf.js`
- `tests/search-symbol-boost.js`
- `tests/search-tie-order.js`
- `tests/search-topn-filters.js`
- `tests/search-windows-path-filter.js`

### Segments + comments pipeline
- `tests/segment-pipeline.js`

### Service queue
- `tests/service-queue.js`

## Severity Key

- **Critical**: likely to produce incorrect results, hard failures, or block intended workflows (CI/test lanes, coverage gates).
- **High**: substantial correctness/quality risk, likely flakiness, or major maintainability hazard.
- **Medium**: edge cases, policy drift, or meaningfully increased CI cost.
- **Low**: polish, ergonomics, or “paper cut” issues.

---

## Executive Summary

- **[Critical] Script-coverage wiring is drifted and internally inconsistent.** `tests/script-coverage/actions.js` claims to “cover” script names that do not exist in `package.json` (e.g. `search-rrf-test`, `search-topn-filters-test`, `search-determinism-test`, `search-symbol-boost-test`). Given `tests/script-coverage/report.js` treats unknown covers as a hard failure, `script-coverage-test` is effectively broken or unreliable in its current shape. See §1.1.

- **[High] Search contract tests encode an inconsistent policy for when `scoreBreakdown` is included in JSON output.** `tests/search-explain.js` asserts `--json` output should omit `scoreBreakdown` without `--explain`, while `tests/search-rrf.js` requires `hit.scoreBreakdown.rrf` even though it does not request `--explain`. This is either (a) an intentional exception for RRF, or (b) a policy drift bug; either way the contract should be centralized and explicitly tested. See §2.1.

- **[High] Multiple tests assume `process.cwd()` is the repo root and omit `cwd` on spawned processes.** This is fragile in multi-runner setups, IDE runners, and “run a single test from its folder” workflows. The tests should resolve the repo root based on the test file location (or a runner-provided env var) and always set `cwd` explicitly for spawned scripts. See §2.2 and §1.2.

- **[Medium] Determinism tests are overly strict and may fail for non-semantic reasons.** `tests/search-determinism.js` compares `JSON.stringify(hits)` across independent search runs. Any harmless field reordering, optional diagnostic additions, or minor floating-point noise could create false failures. A canonicalization/normalization step would preserve the intent while reducing brittleness. See §2.3.

- **[Medium] The segments/comments pipeline test exposes (and likely masks) dead configuration.** `tests/segment-pipeline.js` sets `includeLicense: false` yet asserts license comments are still extracted; in `src/index/comments.js`, `includeLicense` is normalized but not actually used. The test should either validate the intended behavior (skip license when disabled) or explicitly codify that `includeLicense` is a no-op (and then the knob should be removed). See §3.1.

- **[Requested addition] A concrete process for tracking per-test durations and using that data to design CI lanes is included in §5.** It is intentionally written as an implementation-ready specification.

---

## 1) Script Coverage Harness (`tests/script-coverage/*`)

### 1.1 **[Critical]** `actions.js` declares “covers” for script names that likely do not exist (guaranteed `unknownCovers` → fail)

**Where**
- `tests/script-coverage/actions.js:532–605` (and surrounding sections)

**What’s wrong**
- Several actions declare `covers: ['search-rrf-test']`, `covers: ['search-topn-filters-test']`, `covers: ['search-determinism-test']`, `covers: ['search-symbol-boost-test']`, etc.
- `tests/script-coverage/report.js` explicitly treats “unknown covers” as an error:
  - `createCoverageState().markCovered()` adds to `unknownCovers` when the script name is absent from the `scriptNames` set (`report.js:18–27`).
  - `reportCoverage()` exits failure on any unknown covers (`report.js:126–129`).

**Why this matters**
- The script coverage suite is supposed to be a guardrail against drift, but it currently exhibits drift itself.
- If `script-coverage-test` is relied on as a gate (or even as a sanity check), this mismatch will either:
  - fail spuriously (blocking CI), or
  - be silently excluded from CI (and therefore not protecting anything).

**Suggested fix direction**
- Make `covers` **data-driven** and **self-validating**:
  1. In `buildActions()`, load the script list once (same function used by `tests/script-coverage.js` → `loadPackageScripts()`), and compute `const scripts = new Set(Object.keys(pkg.scripts))`.
  2. For each action:
     - If it is intended to cover a package script, require that the script exists; otherwise throw early with a helpful message (“actions.js references missing package script: …”).
     - If it is *not* intended to cover package scripts (it’s a “test file run”), keep `covers: []`.
  3. Add a small unit test akin to `tests/script-coverage-harness.js` that asserts “no unknownCovers” when applying `buildActions()` against the real `package.json` scripts.

**Tests to add**
- A “script-coverage wiring” test that:
  - loads package scripts,
  - calls `buildActions()`,
  - applies `applyActionCoverage`,
  - asserts `unknownCovers` is empty.

---

### 1.2 **[High]** Root resolution and `cwd` assumptions make the harness brittle outside the “run from repo root” happy path

**Where**
- `tests/script-coverage.js:17–24` (`const root = process.cwd()` and path joins)
- `tests/script-coverage-harness.js:4–9` (`const root = process.cwd()`)
- Many actions rely on paths derived from `root` in `tests/script-coverage/actions.js`

**What’s wrong**
- `process.cwd()` is treated as the repo root, which is only true when the test runner sets it that way.
- In practice, it’s common to:
  - run a single test from within `tests/`,
  - run from an IDE in a subfolder,
  - run via a monorepo orchestrator that changes `cwd`.

**Suggested fix direction**
- Standardize on an explicit “repo root” primitive:
  - `const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');` for tests in `tests/`.
  - Or allow the runner to set `PAIROFCLEATS_REPO_ROOT` and have tests prefer that.
- Always pass `cwd: ROOT` into spawned processes (even if the scripts also accept `--repo`).

**Tests to add**
- A “runner robustness” test that intentionally runs one test with `cwd` set to `tests/` and expects it to still pass.

---

### 1.3 **[Medium]** Default “skips” override coverage status, making the semantics more “hard exclude” than “skip when not covered”

**Where**
- `tests/script-coverage/report.js:29–32` (`markSkipped` overwrites state unconditionally)
- `tests/script-coverage/report.js:67–96` (`applyDefaultSkips()`)

**What’s wrong**
- `markSkipped()` overwrites whatever status was set previously, including an intentionally covered script.
- Because `markCovered()` only transitions from `pending` to `covered` (`report.js:23–27`), *a skipped script can never be “unskipped” by coverage* in the same run.

**Why this matters**
- If you later decide to cover a previously skipped script (e.g. add a safe “lint in CI” script), the harness will still report it as skipped unless you edit the skip list.
- That may be intended, but it is easy to misinterpret “skipped” as “not required” rather than “explicitly excluded”.

**Suggested fix direction**
- Decide the policy explicitly and encode it in code and docs:
  - If skips are meant to be “hard excludes”: keep current behavior, but rename to `applyHardExcludes()` and make that intent explicit.
  - If skips are meant to be “skip only if still pending”: update `markSkipped` to no-op unless the current state is `pending`.

**Tests to add**
- A unit test that demonstrates the intended precedence between “covered” vs “skipped” for one script name.

---

### 1.4 **[Low]** `paths.js` uses timestamped log roots, which makes local debugging easier but complicates cleanup and determinism

**Where**
- `tests/script-coverage/paths.js:13–17` (timestamped `script-coverage/<YYYY-MM-DDTHH-MM-SS>/`)

**What’s wrong**
- Every run creates a new directory tree; on dev machines this will accumulate unless cleaned.
- Time-based paths make it harder to compare runs or attach logs as stable CI artifacts.

**Suggested fix direction**
- Keep timestamps for human convenience, but optionally allow a deterministic log dir:
  - If `PAIROFCLEATS_TEST_LOG_DIR` is set, honor it (already done in `runner.js`).
  - Add `--log-dir` usage guidance in `tests/script-coverage.js` help output (or in README).

---

## 2) Search / Retrieval CLI Tests

### 2.1 **[High]** Inconsistent JSON result-shaping contract for `scoreBreakdown` (policy needs to be centralized)

**Where**
- `tests/search-explain.js:63–78` expects `--json` output **does not include** `scoreBreakdown` without explicit explain flags.
- `tests/search-rrf.js:64–71` expects `scoreBreakdown.rrf` exists **without** `--explain`.

**What’s wrong**
- These tests encode two different policies:
  1. “Score breakdown is expensive and should be opt-in.”
  2. “Score breakdown is present at least for some scoring strategies (RRF) even when not requested.”

**Why this matters**
- Result shaping and verbosity policy is a recurring theme in the codebase (also referenced in prior roadmap work).
- If this is not centralized, you risk:
  - regressions where JSON outputs bloat unpredictably,
  - clients depending on debug fields unintentionally,
  - mismatch between CLI and API output policies.

**Suggested fix direction**
- Create a single “output shaping policy” decision table and enforce it:
  - **Default JSON**: no heavy debug payloads (`scoreBreakdown`, full contexts, trace graphs).
  - **`--explain` / `--why`**: include breakdowns in human output; optionally include breakdowns in JSON when `--json --explain`.
  - If RRF requires a minimal breakdown for correctness, restrict it to a small, stable field (e.g. `scoreType` + `rrfScore`) and keep the full breakdown behind explain flags.

**Tests to add**
- A single contract test that enumerates combinations:
  - `--json` alone,
  - `--json --explain`,
  - `--json --why`,
  - `--json --explain --ann`,
  - and asserts exactly which debug fields are present.
- This should replace “implicit” expectations scattered across individual tests.

---

### 2.2 **[High]** `process.cwd()` root assumptions + missing `cwd` on `spawnSync` will break ad-hoc/IDE execution patterns

**Where**
- Many tests define `const root = process.cwd()` (e.g. `tests/search-rrf.js:6`, `tests/search-determinism.js:6`, `tests/search-help.js:5`, etc.).
- Several `spawnSync` calls do **not** set `cwd` even though they depend on root-relative paths.

**Why this matters**
- The suite becomes “runner-dependent”: it only works if the runner forces `cwd` to repo root.
- This increases friction for contributors and reduces confidence in tests as an independent safety net.

**Suggested fix direction**
- Standardize a helper (even inlined into each file) for repo root:
  - Derive repo root via `import.meta.url` and `path.resolve`.
- Always set `cwd` in `spawnSync`:
  - If testing repo fixture behavior, set `cwd` to that fixture repo root.
  - If invoking top-level scripts (`build_index.js`, `search.js`), set `cwd` to the main repo root or explicitly to the fixture, consistently.

**Tests to add**
- At least one test that runs a representative subset with `cwd=tests/` to ensure path resolution is robust.

---

### 2.3 **[Medium]** `search-determinism` compares raw JSON strings; canonicalization would reduce false negatives

**Where**
- `tests/search-determinism.js:72–88` compares `JSON.stringify(hits)` across runs.

**What’s wrong**
- `JSON.stringify` equality is strict about:
  - key insertion order within objects,
  - any additional fields added later,
  - small floating-point differences.
- Any non-semantic change can break the test and encourage “pinning” output formats too tightly.

**Suggested fix direction**
- Normalize hits before comparing:
  - Keep only identity + ranking-relevant fields (e.g. `file`, `chunkId`, `startLine`, `scoreType`, and `score` rounded to N decimals).
  - Sort object keys deterministically (or stringify a stable projection object).

**Tests to add**
- A helper function used by both this test and tie-order tests to compare stable projections rather than full payload blobs.

---

### 2.4 **[Medium]** Search CLI error-message tests are brittle; structured errors would reduce churn

**Where**
- `tests/search-missing-flag-values.js`
- `tests/search-missing-index.js`
- `tests/search-removed-flags.js`
- `tests/search-help.js`

**What’s wrong**
- These tests depend on human-readable strings (“Missing value for …”, “build-index”, “removed”), which can change with wording edits.
- The project already has an `error-codes` concept in shared modules; tests should prefer machine-stable codes when possible.

**Suggested fix direction**
- Emit stable error codes to stderr (or in JSON mode) and assert against those.
- Keep message text tests only for a small “help output includes flags” check.

**Tests to add**
- A contract test asserting `{ code: 'ERR_MISSING_FLAG_VALUE', flag: '--type' }` (or similar) is present in a structured output mode.

---

### 2.5 **[Low]** `search-explain-symbol` assertion is weak and may produce false positives

**Where**
- `tests/search-explain-symbol.js:56–63` checks only that output includes the substring `"Symbol"`.

**What’s wrong**
- Any unrelated output containing “Symbol” (including error/help text) could satisfy this condition.
- Conversely, minor formatting changes (case changes, label rename) can break it.

**Suggested fix direction**
- Assert on a more specific marker that indicates the intended feature actually triggered, e.g.:
  - a line prefix (`Symbol:`),
  - a JSON field (preferable if `--json` is supported for explain output),
  - or a deterministic section header.

---

## 3) Segments + Comments Pipeline

### 3.1 **[Medium]** `includeLicense: false` is set but license extraction is still asserted; this likely masks dead config

**Where**
- `tests/segment-pipeline.js:88–103` sets `normalizeCommentConfig({ extract: 'all', includeLicense: false })` and then asserts a license comment is extracted.
- `src/index/comments.js` normalizes `includeLicense` but does not appear to enforce it (the flag is set in `normalizeCommentConfig` but not referenced elsewhere).

**Why this matters**
- A config knob that does nothing is “negative value”:
  - it confuses users,
  - creates false confidence,
  - and is a common source of policy drift in this codebase.

**Suggested fix direction**
- Decide and implement one of:
  1. **Implement** `includeLicense` semantics and update the test:
     - If `includeLicense: false`, license comments should be dropped.
  2. **Remove** the option and simplify the config (and the test should not pass it).

**Tests to add**
- Two explicit tests:
  - with `includeLicense: false` → no `type === 'license'`,
  - with `includeLicense: true` → license comments extracted.

---

### 3.2 **[Low]** Inline-code segment count assertion is potentially brittle

**Where**
- `tests/segment-pipeline.js:30–32` expects exactly 2 inline code segments.

**What’s wrong**
- Inline code span detection may evolve (e.g., handle nested backticks, backslash escapes, or new heuristics).
- The test’s intent is “inline code spans are detected”, not necessarily “exactly two”.

**Suggested fix direction**
- Assert “at least one inline segment exists” and validate it has correct metadata (`meta.inlineCode`), or assert specific substrings are captured.

---

## 4) Safe Regex Engine Test

### 4.1 **[Low]** The test does not exercise timeout behavior and only lightly exercises resource guards

**Where**
- `tests/safe-regex-engine.js`

**What’s wrong**
- The suite validates:
  - engine selection,
  - basic exec/test semantics,
  - max input/pattern/program guards,
  - invalid patterns.
- It does not validate:
  - timeout behavior (likely because it is hard to make deterministic),
  - behavior for empty input (where the wrapper intentionally diverges from native regex semantics in `src/shared/safe-regex.js`).

**Suggested fix direction**
- If timeouts are intended to be a meaningful safety property, create a deterministic test by:
  - injecting a fake backend for tests that simulates long execution (dependency injection in `createSafeRegex`), or
  - using an intentionally huge input with a very small timeout and skipping the test on slow CI if needed.

---

## 5) Service Queue Test

### 5.1 **[Medium]** Coverage is minimal; does not validate atomicity or ordering under contention

**Where**
- `tests/service-queue.js`

**What’s wrong**
- The test covers a basic “enqueue → claim → complete” path and checks summary counters.
- It does not test:
  - claiming is exclusive under concurrent claimers,
  - ordering semantics (FIFO vs priority),
  - partial write/corruption recovery,
  - idempotency of `completeJob` (double-complete).

**Suggested fix direction**
- Add focused stress tests that:
  - enqueue N jobs,
  - run M parallel claimers (or simulated via interleaving) and assert no duplicates,
  - validate stable ordering if FIFO is intended.

**Cross-platform note**
- `baseJob.repo` uses a hard-coded POSIX path (`/tmp/repo`, `service-queue.js:21–24`). Prefer a temp path derived from `tempRoot` to keep semantics consistent across platforms.

---

## 6) Test Duration Tracking + CI Lane Budgeting (Process Specification)

The project has a large and growing test surface that includes:
- fast unit tests,
- integration tests that build indexes,
- tests that rely on optional dependencies (SQLite extensions, ANN backends),
- and occasionally long-running bench harnesses.

To keep the suite reliable and cost-effective, you want **measured** and **enforced** lane budgets, not ad-hoc “CI is slow” adjustments.

### 6.1 Goals

1. **Measure** how long each test takes (per file), including spawned subprocess time.
2. **Persist** timing data across runs (CI artifacts and local cache).
3. **Use** the data to design lanes:
   - `ci:smoke` (fast, high signal, < ~2–5 minutes)
   - `ci:unit` (broader, < ~10–15 minutes)
   - `ci:integration` (heavier, includes “build index” tests)
   - `nightly:e2e` (multi-repo, federated, large fixtures)
4. **Prevent regressions** where a test silently becomes “slow” and drags CI.

### 6.2 Data model

Emit one JSONL line per test execution:

```json
{
  "test": "tests/search-rrf.js",
  "lane": "integration",
  "status": "pass",
  "durationMs": 1842,
  "startedAt": "2026-01-21T00:00:00.000Z",
  "endedAt": "2026-01-21T00:00:01.842Z",
  "commit": "GIT_SHA_IF_AVAILABLE",
  "node": "v20.11.1",
  "platform": "linux",
  "arch": "x64",
  "notes": ["build_index", "sqlite", "ann"]
}
```

Store these under:
- local: `tests/.cache/timings/test-times.jsonl`
- CI artifact: `artifacts/test-times/<run-id>.jsonl`

Also maintain a compact aggregated file (updated in CI) for use in gating:
- `tests/.cache/timings/summary.json`
- (optional) committed baseline file: `tests/timings-baseline.json`

### 6.3 Instrumentation approach

**Preferred:** instrument the central test runner (not each test file).

Even though this pass is scoped to individual tests, the best implementation is:
- wrap each test invocation with a timer,
- record:
  - wall-clock duration for the entire Node process,
  - exit code,
  - stderr/stdout sizes (optional, good signal for spammy tests).

Pseudo-implementation outline (runner-level):
- `const start = performance.now();`
- spawn the test (or import and run it) and wait for completion
- `const durationMs = Math.round(performance.now() - start);`
- append JSONL record

### 6.4 Budgeting & lane design

Once timing data exists, enforce budgets:

- Define lanes with max total time and per-test max time:
  - `smoke`: maxTotalMs = 180000 (3 min), perTestMaxMs = 15000
  - `unit`: maxTotalMs = 600000 (10 min), perTestMaxMs = 60000
  - `integration`: maxTotalMs = 1800000 (30 min), perTestMaxMs = 300000
  - `nightly`: no strict budget, but still record

- Implement selection rules:
  - If a test’s 95th percentile duration exceeds lane limits, it must be moved to a heavier lane.
  - If a test occasionally spikes, allow a “quarantine” tag that keeps it from blocking merges while you fix it.

### 6.5 Actionable output for developers

Add a report command (or runner flag) that prints:

- Slowest tests (p95, max)
- Biggest regressions vs baseline
- Lane composition totals

Example CLI output:

```
Lane: smoke (target 3m) — current estimate 2m12s
1) tests/search-help.js — p95 0.2s
2) tests/safe-regex-engine.js — p95 0.1s
...

Lane: integration (target 30m) — current estimate 22m40s
1) tests/search-topn-filters.js — p95 110s (build sqlite index)
2) tests/search-tie-order.js — p95 65s
...
```

### 6.6 Using timing to improve throughput (practical policies)

- **Avoid repeated index builds** across many tests:
  - Cache a “built fixture index” per fixture repo + config signature.
  - Tests that need a built index should reuse it when safe.
- **Parallelize only safe subsets**:
  - run pure unit tests in parallel,
  - serialize the tests that build indexes or touch shared caches.
- **CI tiers**:
  - PR: smoke + unit
  - main merge: integration
  - nightly: e2e multi-repo + perf benches (explicitly excluded from PR gating)

---

## 7) Consolidated Checklist (No Code Changes Here)

### Critical
- [ ] Align `tests/script-coverage/actions.js` `covers` values with real `package.json` script names (or gate them dynamically). (`tests/script-coverage/actions.js`, `tests/script-coverage/report.js`)
- [ ] Add a wiring test that asserts `unknownCovers` is empty against HEAD `package.json`. (`tests/script-coverage-harness.js` is a good template)

### High
- [ ] Standardize repo-root discovery and `cwd` handling for spawned scripts across the search tests and script coverage harness.
- [ ] Centralize and explicitly test the JSON result shaping policy for `scoreBreakdown` and other verbose fields.

### Medium
- [ ] Make determinism tests compare canonical projections instead of raw `JSON.stringify` blobs.
- [ ] Decide `includeLicense` semantics and add explicit tests for it in `tests/segment-pipeline.js`.
- [ ] Expand `tests/service-queue.js` to include concurrency/idempotency cases (even if minimal).

### Low
- [ ] Strengthen `tests/search-explain-symbol.js` assertions to avoid false positives.
- [ ] Add optional/injected testing for safe-regex timeout behavior if timeouts are intended to be meaningful.

