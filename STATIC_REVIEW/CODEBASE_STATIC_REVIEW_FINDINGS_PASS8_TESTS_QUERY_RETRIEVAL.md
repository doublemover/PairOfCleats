# Codebase Static Review Findings — Pass 8C (Tests: Query / Cache / Retrieval Filters)

> Scope: **tests/** scripts listed in the request (query parsing/intent, query cache, retrieval backend selection, branch filtering, retrieval filter contracts).  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness risks, portability problems, missing coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

- `tests/query-cache-extracted-prose.js`
- `tests/query-cache.js`
- `tests/query-intent.js`
- `tests/query-parse.js`
- `tests/read-failure-skip.js`
- `tests/records-exclusion.js`
- `tests/repo-root.js`
- `tests/repometrics-dashboard.js`
- `tests/retrieval-auto-sqlite-thresholds.js`
- `tests/retrieval-backend-policy.js`
- `tests/retrieval-branch-filter.js`
- `tests/retrieval/contracts/compact-json.test.js`
- `tests/retrieval/contracts/result-shape.test.js`
- `tests/retrieval/filters/active-filters.test.js`
- `tests/retrieval/filters/behavioral.test.js`
- `tests/retrieval/filters/control-flow.test.js`
- `tests/retrieval/filters/ext-path.test.js`

---

## Executive Summary

This batch of tests covers important “user-facing correctness” surfaces—query parsing and intent classification, query caching behavior, backend auto-selection, branch scoping, and filter correctness. The most impactful issues are not that the tests are wrong in spirit, but that several of them are **too coupled to mutable defaults** (especially JSON result shaping and the presence of `stats`), while others are **too weak to fail when the feature silently regresses** (filters that only assert “non-empty result sets”).

In particular:

- The two **retrieval contract** tests currently encode **two different output shape expectations** (compact hits vs “scoreBreakdown must exist”) without explicitly selecting the output mode. That makes them brittle, and it will collide with ongoing work to **prune JSON output** and **gate stats/explain fields** behind explicit flags.
- The **query cache** tests require `stats.cache.hit` to be present in JSON outputs. If/when JSON output pruning makes stats opt-in, these tests will fail even though caching still works.
- The **hasActiveFilters** guard test appears to encode questionable semantics (e.g., treating `churnMin: 0` as an “active filter”), which can cause UI/telemetry to claim filters are active even when the user didn’t set any meaningful filters.
- Several “behavioral” filter tests are **non-diagnostic** (they only check “some results exist”), which is a common way for regressions to slip through silently.
- Multiple scripts mutate `process.env` and rely on `process.cwd()` being the project root, which is safe today only if each script runs in its own process with a stable runner contract.

The remainder of this document lists concrete issues and targeted fixes, then provides a concrete plan for **test timing measurement + tiering** (requested) so CI stays fast while e2e coverage remains trustworthy.

---

## High-Priority Findings

### P0 — Retrieval “contract” tests assert incompatible JSON shapes without explicitly selecting a mode

**Where**
- `tests/retrieval/contracts/compact-json.test.js` (forbids `scoreBreakdown`, `docmeta`, `stats`, etc.; lines ~47–66)
- `tests/retrieval/contracts/result-shape.test.js` (requires `hit.scoreBreakdown.selected`; lines ~24–27)

**What’s wrong**
- The “compact JSON” contract test asserts that hit objects do *not* include a long list of heavy fields, including `scoreBreakdown`.  
- The “result shape” contract test asserts the opposite: that `scoreBreakdown.selected` exists on hits.
- Neither test, as written, clearly selects an output/profile that guarantees one contract or the other. In `compact-json.test.js`, the CLI call is just `search.js message --json ...` (no explicit “compact” flag), and `result-shape.test.js` delegates to `runSearch()` without demonstrating that “explain/score breakdown” is explicitly enabled.

**Why it matters**
- These tests are supposed to be “contracts” for the project’s stable output. If they depend on current defaults, they will drift and/or become contradictory as soon as output shaping changes.
- Your roadmap work explicitly calls out: “CLI results refinement” and “JSON output pruning / do not emit stats unless requested.” That will likely change what is included by default.

**Suggested fix**
- Make the output contract explicit and unambiguous:
  - For the compact contract: invoke search with an explicit mode/flag for compact JSON (whatever the canonical flag is—e.g., `--compact`, `--json=compact`, `--format compact`, etc.), and assert that the forbidden fields are absent **because compact mode was requested**, not because it happens to be default today.
  - For the “scoreBreakdown” contract: invoke search with an explicit mode/flag for explain/breakdown (e.g., `--explain`, `--score-breakdown`, or `--json --explain`), and assert the specific breakdown invariants.
- Consider splitting output contracts into three explicit tiers:
  1. **Compact JSON contract** (default machine-readable output; minimal fields).
  2. **Explain JSON contract** (adds `scoreBreakdown`, structured reasons, and/or match diagnostics).
  3. **Verbose JSON contract** (adds `docmeta`, relations, context windows, lint/complexity, etc.).

**Additional coverage to add**
- A test that proves “stats are not present unless explicitly requested” (once that policy is implemented), to prevent reintroducing accidental verbosity.

---

### P0 — Query cache tests depend on `stats.cache` being present in JSON output (likely to conflict with “stats opt-in” policy)

**Where**
- `tests/query-cache.js` (`first.stats.cache.hit`, `second.stats.cache.hit`; lines ~46–53)
- `tests/query-cache-extracted-prose.js` (`first.stats.cache.hit`, `second.stats.cache.hit`; lines ~63–70)

**What’s wrong**
- Both tests parse JSON output and require `stats.cache.hit` to exist and to flip from `false` → `true` between runs.
- These tests do **not** pass any explicit “include stats” flag (they pass `--json`, but not `--stats` or similar).
- If JSON pruning/verbosity controls are tightened such that `stats` is omitted by default, these tests will fail even if caching is correct.

**Why it matters**
- Caching is operationally important, but stats emission policy is also operationally important. The tests should not unintentionally force one policy by hard-coding the other.
- You want tests to enforce behavior (cache hit/miss) and policy (what is included in output) separately.

**Suggested fix**
- Decide which contract is intended, then test it explicitly:
  - If cache hit/miss must always be reported in JSON: keep these tests, but treat `stats.cache` as a guaranteed minimal field and document it.
  - If stats are opt-in: update these tests to pass the opt-in flag, and add separate tests that validate “stats are absent unless requested.”
- If you want to keep cache visibility without `stats`, consider a small stable field like `payload.cache: { hit, key, ageMs }` at the top-level (or a `payload.meta.cache`), and reserve `payload.stats` for heavier metrics.

**Secondary issues / brittleness**
- `tests/query-cache-extracted-prose.js` uses a different CLI calling convention than `tests/query-cache.js` (query is the last argument rather than positional). If the CLI ever tightens positional parsing, one of these can silently become invalid.
- Both tests read `cacheRoot/repos` and take `repoCacheDirs[0]` without sorting. It probably works because the test deletes its temp directory, but sorting makes the test more robust if prior runs were not fully cleaned up.

---

### P0 — `hasActiveFilters` guard test likely encodes the wrong “active filter” semantics

**Where**
- `tests/retrieval/filters/active-filters.test.js` (lines ~8–15)

**What’s wrong**
The test asserts that several filter-like inputs are “not active,” and that `churnMin: 0` is “active”:

- `hasActiveFilters({ filePrefilter: { enabled: true } }) === false`
- `hasActiveFilters({ excludeTokens: [...], excludePhrases: [...] }) === false`
- `hasActiveFilters({ churnMin: 0 }) === true`

At face value, this is surprising:

- A churn minimum of `0` usually means “no minimum” (disabled), so treating it as active can lead to UI/telemetry claiming filters are active when they are not.
- `filePrefilter.enabled` may be a meaningful search constraint depending on how the pipeline interprets it; if it influences candidate sets, it’s arguably active.
- Exclusions (excludeTokens/phrases) are a constraint even if they come from the query AST rather than “filters.” If `hasActiveFilters` is intended to mean “filters beyond query syntax,” the function name is misleading and the tests should document that explicitly.

**Why it matters**
`hasActiveFilters` is likely used for:

- deciding whether to print “Active filters” blocks,
- telemetry labels,
- cache key shaping (filters affect caching),
- result shaping (“include filter explain” if filters are active).

Misclassifying default/no-op values as active is a classic source of UX noise and cache fragmentation.

**Suggested fix**
- Clarify the definition and update the test accordingly. Two reasonable definitions:
  1. Active = “this will constrain the candidate set beyond the query AST.”  
     Under this definition, `churnMin: 0` should be inactive, and `filePrefilter.enabled` might be active.
  2. Active = “any filter object fields were provided, regardless of whether they are no-ops.”  
     Under this definition, `churnMin: 0` is active but the function becomes far less useful, and UI/telemetry becomes noisy.

Prefer definition (1), and treat numeric filters as active only when they are meaningfully constraining (e.g., `churnMin > 0`).

**Additional coverage**
- A table-driven test for “default-looking” values:
  - `churnMin: 0`, `churnMin: null`, `churnMin: 1`
  - empty arrays vs populated arrays
  - `path: ''` vs `path: 'src/'`

---

### P0 — Branch filter test forces a telemetry status that may be semantically incorrect

**Where**
- `tests/retrieval-branch-filter.js` (expects `recordSearchMetrics('ok')` even when branch mismatch; lines ~20–22)

**What’s wrong**
The test applies a branch filter where `branchFilter='main'` but `repoBranch='dev'`, and expects `matched=false` and that `recordSearchMetrics` is called with `'ok'`.

Depending on your metric taxonomy, a branch mismatch is typically a “skipped search” / “no-op due to scope mismatch,” not necessarily “ok” in the same sense as a successful search.

**Why it matters**
This bleeds into dashboards:

- If branch mismatches are recorded as “ok searches,” you may undercount filtered-out events and misread usage patterns.
- If branch mismatches are recorded as failures, you may inflate error rates.

This is a policy decision; the test should document the intended semantics.

**Suggested fix**
- Define a small enum for “search termination reasons” (e.g., `ok`, `no_results`, `filtered_branch`, `filtered_policy`, `error`) and use it consistently.
- Update the test to assert the intended reason (likely `filtered_branch`) rather than forcing it into `ok`.

---

### P0 — `read-failure-skip.js` does not actually test “unreadable file” behavior; it tests “path is a directory”

**Where**
- `tests/read-failure-skip.js` (unreadable path section; lines ~81–101)

**What’s wrong**
The second case creates a directory named `unreadable/` and expects a skip entry with reason `'unreadable'`. This does not simulate a permission-based unreadable file; it simulates “not a file” (a directory).

If the production system uses reason codes like `not-file`, `is-directory`, or `unreadable`, this test may be baking in an incorrect reason label.

**Why it matters**
Skip reason codes tend to surface in indexing summaries and validation artifacts. Overloading them (“directory” -> “unreadable”) makes triage harder and blocks improving taxonomy later.

**Suggested fix**
- Split into two explicit tests:
  1. Directory entry -> reason should be `not-file` (or a dedicated `directory` reason).
  2. Permission unreadable file -> reason should be `unreadable` (POSIX only), using chmod to remove read permissions and restoring/cleaning up afterward.
- On Windows (or FS types where chmod semantics are unreliable), skip the permission test explicitly.

---

## Medium-Priority Findings

### P1 — Behavioral retrieval filter tests are too weak (they can pass even if the filter is ignored)

**Where**
- `tests/retrieval/filters/behavioral.test.js` (lines ~9–31)

**What’s wrong**
The test runs searches with `--returns` and `--async` and only checks that results are non-empty. This will still pass if:

- the flag is parsed but ignored,
- the filter is applied to the wrong mode but the query matches anyway,
- the filter is inverted, and the query happens to produce at least one false-positive.

**Suggested fix**
- Add predicate-based assertions:
  - `--returns`: assert all returned hits expose a return-type marker or metadata consistent with “has returns.”
  - `--async`: assert all hits include an async marker.
- Add a negative control:
  - run the same query without the filter, assert it returns >= filtered results, and that at least one baseline hit would be excluded by the predicate.

---

### P1 — Control-flow filter test does not prove filtering; it mostly proves docmeta is present on some hits

**Where**
- `tests/retrieval/filters/control-flow.test.js` (lines ~17–26)

**What’s wrong**
The test checks that some hits have `docmeta.controlFlow.branches >= 1`. If `--branches 1` is ignored, the query might still return hits with branches, so the test passes.

**Suggested fix**
- Assert all hits satisfy the branches predicate, or compare against a baseline search without `--branches`.

---

### P1 — Query intent test is not integrated with the real tokenization pipeline

**Where**
- `tests/query-intent.js`

**What’s wrong**
The test passes handcrafted `tokens` and `phrases`. This is a valid unit test, but it doesn’t protect against drift between the CLI’s tokenization/phrase extraction and the classifier’s expectations.

**Suggested fix**
- Keep the unit test, but add one integration test that tokenizes/parses the raw query using the same path the CLI uses, then classifies and asserts intent.

---

### P1 — Environment mutation without restoration can cause cross-test interference if tests are ever consolidated

**Where (examples)**
- `tests/records-exclusion.js` sets `process.env.PAIROFCLEATS_TESTING`, `PAIROFCLEATS_CACHE_ROOT`, `PAIROFCLEATS_EMBEDDINGS` (lines ~30–32)
- `tests/repometrics-dashboard.js` sets `process.env.PAIROFCLEATS_CACHE_ROOT` (line ~16)

**What’s wrong**
Today, if each test script is launched as its own Node process, these mutations are isolated. If you ever migrate to `node --test` or consolidate, this becomes an interference risk.

**Suggested fix**
- Establish a convention: never mutate `process.env` in-process without restoring it.
- Prefer local `env` objects passed to `spawnSync`.

---

### P1 — Backend policy tests assert brittle string error messages rather than stable error codes

**Where**
- `tests/retrieval-backend-policy.js` asserts `error.message.includes(...)` (lines ~51–63)

**What’s wrong**
Asserting message substrings is fragile and discourages improving error messages.

**Suggested fix**
- Prefer structured error codes/fields, and assert those instead.

---

## Low-Priority Findings / Cleanup Opportunities

### P2 — Many tests assume `process.cwd()` is the project root

**Where (examples)**
- `tests/query-cache.js`
- `tests/query-cache-extracted-prose.js`
- `tests/records-exclusion.js`
- `tests/repo-root.js`
- `tests/repometrics-dashboard.js`

**Suggested fix**
Use a repo root resolver (e.g., based on `import.meta.url`) or have the runner export `PROJECT_ROOT`.

---

### P2 — Some tests intentionally rely on internal cache file layout

**Where**
- `tests/query-cache.js` and `tests/query-cache-extracted-prose.js` read `.../repometrics/queryCache.json`

**Suggested fix**
Keep one “artifact exists” test, but make cache semantics tests rely on public output/metrics surfaces where possible.

---

## Coverage Gaps Worth Closing

1. **Cache invalidation semantics**
   - Modify repo content, rebuild index, rerun query: assert cache miss occurs (or cache key changes).
2. **Branch filter strictness**
   - Case sensitivity toggles, patterns/globs/regex (if supported), multi-branch behavior.
3. **Filter interaction + precedence**
   - Combine `--ext`, `--path`, `--type`, etc., verify intersection and precedence rules.
4. **Output verbosity contracts**
   - Compact vs explain vs verbose matrix tests (ensuring fields are strictly controlled).

---

## Requested: Test Timing + Tiering Framework (CI smoke vs e2e)

A scalable test suite needs two explicit mechanisms:

1) measure and persist timings, and  
2) define tiers/budgets so CI remains predictable.

### A. Add timing instrumentation (minimal, durable)

**Mechanism**
- Measure duration in the runner (preferred), not inside each test.
- Write one JSONL record per test execution, e.g. `tests/.cache/test-times.jsonl`:

```json
{ "time": "2026-01-21T00:00:00.000Z", "test": "tests/query-cache.js", "ms": 842, "status": 0, "tier": "integration", "platform": "linux", "node": "v20.11.0" }
```

**Reporting**
- Print at end of run:
  - total wall time
  - top 10 slowest tests
  - p50/p95 by tier

### B. Introduce explicit test tiers + budgets

Recommended tiers:

- **smoke**: every PR (target: < 2–3 minutes total)
- **integration**: main merges (target: < 10 minutes)
- **e2e**: nightly/manual; allowed to build full indexes and run multi-repo scenarios

Implementation options:

1. Manifest file: `tests/manifest.json` mapping test -> `{ tier, budgetMs }`
2. Inline annotations: `// @tier smoke` (easier to drift)

### C. Enforce budgets in CI

- PR CI: run smoke only (plus a small allow-list).
- Main: smoke + integration.
- Nightly: all, including slow perf/bench suites.

If a test exceeds its budget by >2× for N consecutive runs, fail CI and surface the regression, with an escape hatch for deliberate budget updates.

---

## Suggested Next Steps

1. Stabilize output contract tests with explicit CLI flags (compact vs explain).
2. Strengthen filter tests with predicate-based assertions and negative controls.
3. Clarify `hasActiveFilters` semantics; fix implementation + tests to avoid no-op values being “active.”
4. Add timing + tiering framework so the test suite scales with the roadmap.

