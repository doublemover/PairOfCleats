# Codebase Static Review Findings — Pass 9 (Retrieval Filter Tests + Test Runner)

> Scope: **tests/** scripts listed in the request (retrieval filter coverage + test runner).  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness risks, portability issues, missing coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

- `tests/retrieval/filters/file-and-token/file-selector-case.test.js`
- `tests/retrieval/filters/file-and-token/punctuation-tokenization.test.js`
- `tests/retrieval/filters/file-and-token/token-case.test.js`
- `tests/retrieval/filters/file-case-sensitive.js`
- `tests/retrieval/filters/file-selector.test.js`
- `tests/retrieval/filters/git-metadata/branch.test.js`
- `tests/retrieval/filters/git-metadata/chunk-author.test.js`
- `tests/retrieval/filters/git-metadata/modified-time.test.js`
- `tests/retrieval/filters/query-syntax/negative-terms.test.js`
- `tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js`
- `tests/retrieval/filters/risk.test.js`
- `tests/retrieval/filters/type-signature-decorator.test.js`
- `tests/retrieval/filters/types.test.js`
- `tests/retrieval/rank-dense-dims.js`
- `tests/retrieval/sqlite-fts-eligibility.js`
- `tests/ruby-end-comment.js`
- `tests/run.js`

---

## Executive Summary

This set of tests usefully exercises several important retrieval primitives—file selectors, token case handling, negative query terms, phrase scoring/explain payloads, risk filter knobs, and a small slice of sqlite-FTS pipeline selection. The core risks are not that the tests are “wrong” in intent, but that they currently **leave large correctness gaps** and have a few **systemic design problems** that will make CI results less trustworthy over time:

1. **“Skip as pass” is pervasive** in these scripts (they exit `0` when a prerequisite is missing). Because `tests/run.js` does not recognize a dedicated skip signal, these tests will look green even when they silently did not run. This is the single biggest reliability issue in this pass.
2. **Several tests can yield false positives** because they assert only “non-empty results” or a single expected file appears—without proving the filter actually applied (the query itself may already be unique).
3. **Time-dependent git metadata assertions** (modified-after / modified-since) are vulnerable to fixture drift and wall-clock assumptions.
4. **The phrase/explain test is order-dependent** (it inspects only the first hit), creating unnecessary brittleness if ranking shifts slightly.
5. **The test runner has good fundamentals** (lanes/tags, retries, concurrency, JUnit), but timeout handling is “best-effort” (SIGTERM only) and it does not yet provide a durable timing ledger that can drive suite tiering decisions.

The remainder of this document enumerates concrete issues and targeted remedies, plus a practical process for **test duration tracking + CI tiering**.

---

## High-Priority Findings

### P0 — These tests “skip” by exiting 0, but the runner counts them as PASS (coverage can be illusory)

**Where**
- `tests/retrieval/filters/file-and-token/file-selector-case.test.js` (line 6)
- `tests/retrieval/filters/file-and-token/punctuation-tokenization.test.js` (line 6)
- `tests/retrieval/filters/file-and-token/token-case.test.js` (line 6)
- `tests/retrieval/filters/git-metadata/branch.test.js` (lines 5, 8–11)
- `tests/retrieval/filters/git-metadata/chunk-author.test.js` (line 6)
- `tests/retrieval/filters/git-metadata/modified-time.test.js` (line 6)
- `tests/retrieval/filters/query-syntax/negative-terms.test.js` (line 6)
- `tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js` (line 5)

**What’s wrong**
- Many scripts treat missing prerequisites (e.g., helper cannot create a repo/index; git metadata unavailable; branch name missing) as “skip” by calling `process.exit(0)`.
- `tests/run.js` classifies results as:
  - **passed**: exit code 0 and not timed out
  - **failed**: non-zero exit or timed out
  - **skipped**: only used internally when the runner itself decides to skip (fail-fast path)
- There is currently no standardized way for a child test process to report “skipped” to the runner. Therefore, these “skips” are recorded as **PASS** in CI summaries and JUnit output.

**Why it matters**
- CI can silently lose meaningful coverage on platforms lacking `git`, when fixtures fail to create, or when branch detection differs.
- Developers can also get a false sense of safety locally (“it’s green”) when tests didn’t run.

**Suggested fix**
- Introduce an explicit *skip protocol* between tests and `tests/run.js`. Two robust options:
  1. **Dedicated exit code** for skip (e.g., `87`, `88`, or another reserved code).  
     - Update `runTestOnce()` (in `tests/run.js`) to treat that exit code as `{ status: 'skipped' }`.
     - Update scripts to `process.exit(SKIP_CODE)` when prerequisites are missing.
  2. **Structured stdout marker** (less ideal) such as printing a JSON object `{ status: "skipped", reason: "..." }` and letting the runner parse it when `--json` is enabled. (This is harder to keep reliable than exit codes.)

**Additional hardening**
- Require every skip to include a reason string, and aggregate skip counts in the runner summary (so CI logs clearly show “X skipped because git unavailable,” etc.).
- Add one small “runner contract” test that verifies:
  - skip exit code is surfaced as “SKIP” in plain output,
  - skip is represented correctly in JUnit, and
  - skip does *not* count as pass.

---

### P0 — Runner timeout handling is not guaranteed to terminate hung tests (SIGTERM only)

**Where**
- `tests/run.js` (lines ~284–336), particularly `child.kill('SIGTERM')` at line ~308.

**What’s wrong**
- On timeout, the runner sets `timedOut = true` and sends `SIGTERM`, but:
  - It does not enforce a second-stage kill (`SIGKILL`) after a grace period.
  - It does not handle platform differences (Windows process termination semantics differ; signals may not behave as expected).
  - It does not guarantee that a test which ignores SIGTERM will be forcibly terminated—meaning a test can **hang the entire suite** until CI job timeout.

**Why it matters**
- As the suite grows and introduces more subprocess-based integration tests (index building, tooling providers, etc.), hanging processes are one of the most common CI failure modes.
- This is especially important once tests run with `--jobs > 1`, where a single hung test consumes a worker slot indefinitely.

**Suggested fix**
- Implement a kill escalation policy in `runTestOnce()`:
  - After `timeoutMs`: send SIGTERM (or `child.kill()` default) and start a short grace timer (e.g., 5s–15s).
  - If still not exited: send SIGKILL (or platform-appropriate force kill).
- Record in results which kill stage occurred (e.g., `timedOutStage: 'sigterm' | 'sigkill'`) so debugging is easier.
- Add a dedicated “hang fixture test” (not in CI by default) that spawns a child ignoring SIGTERM to prove escalation works.

---

### P1 — Several filter tests can pass even if the filter logic is broken (false positives from unique queries)

**Where**
- `tests/retrieval/filters/file-selector.test.js` (query `buildAliases`)
- `tests/retrieval/filters/risk.test.js` (queries `exec`, `req`)
- `tests/retrieval/filters/types.test.js` (query `makeWidget`)
- `tests/retrieval/filters/type-signature-decorator.test.js` (query `sayHello`)

**What’s wrong**
- These tests primarily assert “results exist.” For example:
  - File selector test checks *some* hit ends with `javascript_advanced.js`, but it does **not** prove that:
    - the file filter excluded other files, or
    - the query would have matched multiple files without the filter.
  - Risk/type/signature/decorator tests check only that *some* hits exist, but do not verify that:
    - every returned hit satisfies the filter constraints, or
    - the filter reduces results vs. an unfiltered baseline.

**Why it matters**
- A regression where a filter is silently ignored can still pass if the chosen query happens to match only the intended fixture file/symbol.
- These tests then become “green but meaningless,” which is worse than missing tests because they imply correctness.

**Suggested fix**
- For each filter test, change the pattern to a **baseline + filtered** assertion:
  - Run an unfiltered query that yields **multiple** hits across multiple files.
  - Run the filtered query.
  - Assert that:
    - the filtered result count is **lower** than baseline, and
    - all filtered hits satisfy the filter predicate, and
    - a known excluded file is absent.
- Add a **negative case** for each filter:
  - e.g., `--risk no-such-tag` must return 0 hits,
  - `--return-type NoSuchType` must return 0 hits,
  - `--file /no-such-file/` must return 0 hits.

---

### P1 — Phrase explain/score breakdown test is ranking-order brittle

**Where**
- `tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js` (line 20)

**What’s wrong**
- The test inspects `phraseHits[0]` only:
  - `const phraseMatch = phraseHits[0]?.scoreBreakdown?.phrase?.matches || 0;`
- If ranking changes (even slightly) and the first hit is still correct but has a different breakdown shape (or phrase match isn’t first), this becomes flaky even though phrase breakdown functionality is correct.

**Suggested fix**
- Search for **any** hit with phrase matches:
  - e.g., `phraseHits.some(hit => (hit.scoreBreakdown?.phrase?.matches ?? 0) > 0)`
- Additionally assert that `--explain` actually produced `scoreBreakdown` at all (as a presence check), then separately verify phrase data is present somewhere.

---

### P1 — Modified-time filters test uses wall-clock “now” and assumes fixture commit timing alignment

**Where**
- `tests/retrieval/filters/git-metadata/modified-time.test.js` (lines 12–15)

**What’s wrong**
- The cutoff is computed from the current wall-clock:
  - `const cutoff = new Date(now - 2 * dayMs).toISOString();`
- The correctness assertion assumes that the fixture repo has:
  - `beta.txt` modified within 2 days of “now,” and
  - `alpha.txt` older than 2 days.
- This is vulnerable to:
  - fixture repo generation drifting (if commits end up created “now” for all files),
  - time zone parsing differences,
  - CI clock skew (rare but not impossible),
  - a future change where the filter semantics interpret modified time differently (author date vs committer date, commit time vs filesystem mtime).

**Suggested fix**
- Prefer a fully deterministic reference:
  - Use **known commit timestamps** in the fixture generation, and assert relative comparisons based on those timestamps (not wall clock).
  - Or, if fixtures cannot guarantee time, assert only that `--modified-after <very-old-date>` returns both files and `--modified-after <far-future-date>` returns none, and keep the “relative within N days” assertion as an optional/extended test tier.
- If the intent is to validate `--modified-since 2` semantics, explicitly document (in the test itself) that “2 means days” (or hours) to prevent silent semantic drift.

---

### P1 — sqlite FTS eligibility test likely under-specifies the gating logic (missing negative cases; ambiguous flags)

**Where**
- `tests/retrieval/sqlite-fts-eligibility.js` (notably lines 49–51)

**What’s wrong**
- The test intent is good (“sqlite FTS should be used when filters are internal-only”), but:
  - `filtersActive` is passed as `undefined` (line 50). If `createSearchPipeline()` uses `filtersActive` to decide whether filters exist, this may cause the test to exercise a different code path than intended.
  - There is no negative scenario proving that sqlite FTS is *not* used when a “post-filter” is active (e.g., branch/author filters that can’t be applied pre-FTS without additional metadata joins).

**Suggested fix**
- Add a paired negative case in the same test file:
  - set `filtersActive` to include an external filter and assert `sqliteCalls` remains 0 and pipeline selects the appropriate alternative (or fails fast with a clear reason).
- Ensure the test explicitly passes whatever structure `createSearchPipeline()` expects for `filtersActive`, or omit it entirely if the pipeline computes it internally. The current `undefined` value is ambiguous.

---

## Medium-Priority Findings

### P2 — Dense dims mismatch test is good coverage, but overly coupled to logging semantics

**Where**
- `tests/retrieval/rank-dense-dims.js` (lines 15–27)

**What’s right**
- Validates an important behavioral detail:
  - query length mismatched vs index dims should **truncate/handle gracefully**, not crash.
- Also validates log dedup behavior (“warn once”) which prevents console spam.

**Potential issue**
- The test couples correctness to *exactly one* warning being emitted. If logging is reworked (e.g., using a logger abstraction or including additional warnings), this test will fail even if ranking behavior remains correct.

**Suggested adjustment**
- Consider making the warning assertion less brittle:
  - verify at least one warning is emitted, and/or
  - verify warnings are deduped via an internal counter you can query (if you introduce a logger stub), rather than intercepting `console.warn`.

---

### P2 — Ruby end-comment test may encode an unintuitive naming convention and only asserts existence

**Where**
- `tests/ruby-end-comment.js` (lines 20–23)

**What’s wrong / potentially confusing**
- The test expects an instance method to include `Widget.render` (dot notation). In Ruby conventions, instance methods are often represented as `Widget#render`.
- Even if your system intentionally normalizes everything to a dot-style signature, the test does not explain that decision, and will confuse maintainers.

**Coverage gap**
- The test only checks that a chunk exists; it does not assert that:
  - the chunk boundary correctly includes the `end # render` comment, or
  - the chunk metadata includes the correct end line / range.

**Suggested fix**
- Document (in the test) the intended signature convention for Ruby methods.
- Add boundary assertions (e.g., chunk `endLine`/`range` includes the final `end # render` line), if those fields exist in chunk output.

---

## Per-File Notes (Quick Scan)

### `tests/retrieval/filters/file-and-token/file-selector-case.test.js`
- Solid intent: validates `--file` matching is case-insensitive by default, `--case-file` toggles, and regex selector works.
- Improvements:
  - Replace silent `process.exit(0)` skip (line 6) with an explicit skip protocol (see P0).
  - Consider asserting that a *non-matching* file is excluded, not just that `CaseFile.TXT` appears.

### `tests/retrieval/filters/file-and-token/token-case.test.js`
- Solid intent: validates default token matching is case-insensitive and `--case-tokens` toggles behavior.
- Improvement:
  - Explicit skip protocol (line 6).
  - Add a baseline count check to prove it’s not matching for an unrelated reason.

### `tests/retrieval/filters/file-and-token/punctuation-tokenization.test.js`
- Good: exercises punctuation token behavior (`&&`).
- Risk:
  - This may be backend-dependent (different tokenizers may treat punctuation differently). If backend choice can vary in CI, consider pinning backend explicitly or asserting through the tokenizer contract rather than end-to-end retrieval.

### `tests/retrieval/filters/file-case-sensitive.js`
- This is closer to a unit test and is valuable:
  - builds a filter index in-process and asserts strict vs loose matching behavior.
- Suggestion:
  - Consider tagging/placing this test such that it can run in the fastest lane (unit), since it doesn’t require index building.

### `tests/retrieval/filters/file-selector.test.js`
- Risk of false positives due to likely-unique query; strengthen with baseline+filtered comparisons (P1).

### `tests/retrieval/filters/git-metadata/branch.test.js`
- Skips when `branchName` absent (lines 8–11), but is recorded as PASS; this should be SKIP (P0).
- Strengthen “miss” case by also asserting *why* it missed (e.g., explicit empty + maybe explain output contains branch mismatch reason).

### `tests/retrieval/filters/git-metadata/chunk-author.test.js`
- Valuable intent: validates author filtering excludes the opposite author.
- Potential brittleness:
  - Depends on fixture repo author strings matching `"Alice"`/`"Bob"`. If fixture authors change (or include emails), it may need normalization rules in the filter implementation and in the test.

### `tests/retrieval/filters/git-metadata/modified-time.test.js`
- Wall-clock dependence; make deterministic (P1).

### `tests/retrieval/filters/query-syntax/negative-terms.test.js`
- Good: validates negative token and negative phrase parsing.
- Strengthening:
  - Add explicit cases for multiple negatives and escaped quotes, to avoid future regressions in query parsing.

### `tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js`
- Ranking-order brittleness (P1).

### `tests/retrieval/filters/risk.test.js`
- Strengthen by asserting that returned hits actually contain the expected risk tag/flow annotations (P1).

### `tests/retrieval/filters/type-signature-decorator.test.js`
- Strengthen by asserting:
  - returned hits satisfy the filter constraints (type == `MethodDeclaration`, signature contains the string, decorator list includes “available”),
  - and negative case returns 0.

### `tests/retrieval/filters/types.test.js`
- Same: strengthen via predicate validation and negative cases (P1).

### `tests/retrieval/rank-dense-dims.js`
- Good unit-level behavior coverage; consider loosening warning assertion (P2).

### `tests/retrieval/sqlite-fts-eligibility.js`
- Add negative case and clarify `filtersActive` semantics (P1).

### `tests/run.js`
- Strong baseline runner.
- Improvements recommended:
  - explicit skip support (P0),
  - timeout escalation (P0),
  - persistent timing ledger (see next section),
  - log file collision avoidance (see below).

---

## Process: Test Duration Tracking, Tiering, and Budgets

This pass includes `tests/run.js`, which already measures `durationMs` per test and prints it (`PASS … (12ms)`, etc.). The missing piece is turning that into a **durable system** that drives what runs where, and prevents CI from degrading as tests grow.

### 1) Persist a timing ledger on every CI run

**Goal**
- Convert per-run durations into a historical dataset that answers:
  - Which tests are getting slower over time?
  - Which tests are too expensive for the default `ci` lane?
  - What should the per-test timeout be?

**Practical approach using what already exists**
- Run CI with `tests/run.js --json` and save the JSON payload as an artifact:
  - include commit SHA, platform, Node version, and timestamp in the artifact filename.
- If you want a more append-only log, output **JSONL** (one test per line) instead of one big JSON object.

**Suggested payload fields to capture**
- `id`, `path`, `lane`, `tags`
- `status`, `durationMs`, `attempts`, `timedOut`, `exitCode`
- Environment identifiers: OS, arch, Node version, and a `runId` (commit SHA + timestamp).

### 2) Add a “timings summarizer” tool and enforce budgets

**Summarizer responsibilities**
- Compute:
  - per-test p50/p95 duration over last N runs,
  - aggregate duration per lane/tag,
  - the slowest 20 tests,
  - regression deltas (p95 increased > X%).
- Emit:
  - `test-timings.md` report for humans,
  - `test-timings.json` for automation.

**Budget enforcement**
- Define explicit budgets per lane:
  - `smoke`: < 2 minutes total
  - `unit`: < 5 minutes total
  - `integration` (default CI): < 10–15 minutes total
  - `services` / `storage`: configurable separate budgets
  - `perf`: excluded from PR CI by default; runs on schedule
- Fail CI if:
  - lane budget exceeds threshold by >10%, or
  - any single test exceeds its per-test max (unless explicitly allowlisted).

### 3) Make lane membership intentional (not heuristic-only)

Right now lane assignment in `tests/run.js` is primarily heuristic (regex rules). That’s workable, but as the test suite grows, heuristics tend to rot.

**Recommended refinement**
- Establish a naming convention and enforce it:
  - `*.unit.js` → unit lane
  - `*.integration.js` → integration lane
  - `*.e2e.js` → e2e lane
  - `perf/*` → perf lane
- Then the lane assignment logic becomes:
  - prefer explicit suffix → else fallback to regex heuristic → else integration.

**Why this matters**
- It makes CI suite composition reviewable in code review (“this test is e2e; it will not run on every PR”).

### 4) Define per-lane/per-tag timeouts

A single global `DEFAULT_TIMEOUT_MS` (120s) is both:
- too high for true unit tests (hangs waste time), and
- too low for some legitimate integration tests (full index builds).

**Recommended model**
- Use default timeout by lane:
  - unit: 15–30s
  - integration: 120s
  - e2e: 10–30m (not run on PR by default)
  - perf: large or disabled (should never fail PR CI)
- Allow per-test overrides by:
  - filename suffix (e.g., `.slow.integration.js`), or
  - a `tests/manifest.json` that specifies `{ id, lane, timeoutMs }`.

### 5) Make “skip” explicit and visible

Once the runner supports a skip exit code:
- Tests that rely on git metadata can skip when `git` is unavailable **without pretending they passed**.
- CI can enforce “no unexpected skips” (or allow some on specific platforms).

### 6) Fix log file collision risk in parallel runs

`tests/run.js` log naming uses `sanitizeId(test.id).slice(0, 120)`, which can collide.

**Suggested mitigation**
- Include a short stable hash suffix:
  - `${safeId}.${hash(test.id)}.attempt-${attempt}.log`
- This matters more when running subsets, retries, or when two ids share long common prefixes.

### Suggested lane/tier mapping for the files in this pass

If you adopt explicit lane naming, a reasonable classification is:

- **Unit** (fast, no index build):
  - `tests/retrieval/filters/file-case-sensitive.js`
  - `tests/retrieval/rank-dense-dims.js`
  - `tests/retrieval/sqlite-fts-eligibility.js` (purely mocked pipeline pieces)
  - `tests/ruby-end-comment.js` (in-memory chunking)

- **Integration** (builds fixtures / relies on repo scaffolding):
  - everything under `tests/retrieval/filters/**` that calls `ensureFixtureIndex()` or `ensureSearchFiltersRepo()`
    - `file-selector.test.js`, `risk.test.js`, `types.test.js`, `type-signature-decorator.test.js`,
    - and the filter repo based tests under `file-and-token`, `git-metadata`, `query-syntax`

If the “search-filters repo” is expensive to build, consider turning those into a *single* integration test that runs multiple assertions against one prepared fixture index, to reduce overhead.

---

## Download

- [Download this report](sandbox:/mnt/data/CODEBASE_STATIC_REVIEW_FINDINGS_PASS9_RETRIEVAL_FILTERS_TEST_RUNNER.md)
