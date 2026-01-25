# Codebase Static Review Findings — Pass 8 (Tests + Fixtures)

## Status legend

- **[BUG]**: High-confidence bug, incorrect behavior, or a high-likelihood failure mode.
- **[RISK]**: Fragility, flakiness, non-determinism, or CI portability concerns.
- **[DRIFT]**: Test relies on internal/unstable artifacts or shapes that are likely to drift.
- **[PERF]**: Efficiency / throughput concern.
- **[DX]**: Developer experience / maintainability improvement.

## Scope (files reviewed)

This pass reviewed **only** the following files:

### Tests
- `tests/fielded-bm25.js`
- `tests/file-line-guard.js`
- `tests/file-processor/cached-bundle.test.js`
- `tests/file-processor/skip.test.js`
- `tests/file-size-guard.js`
- `tests/filter-index-artifact.js`
- `tests/filter-index.js`
- `tests/filter-strictness.js`
- `tests/fixture-empty.js`
- `tests/fixture-eval.js`
- `tests/fixture-parity.js`

### Fixtures
- `tests/fixtures/encoding/latin1.js`
- `tests/fixtures/graphs/simple/consumer.js`
- `tests/fixtures/graphs/simple/producer.js`
- `tests/fixtures/languages/src/javascript_advanced.js`
- `tests/fixtures/languages/src/javascript_component.jsx`
- `tests/fixtures/languages/src/javascript_flow.js`
- `tests/fixtures/languages/src/javascript_risk.js`
- `tests/fixtures/languages/src/javascript_risk_sink.js`
- `tests/fixtures/languages/src/javascript_risk_source.js`
- `tests/fixtures/languages/src/types.js`
- `tests/fixtures/languages/src/typescript_advanced.ts`
- `tests/fixtures/languages/src/typescript_component.tsx`
- `tests/fixtures/lsp/stub-lsp-server.js`
- `tests/fixtures/medium/generate.js`
- `tests/fixtures/mixed/src/app.js`
- `tests/fixtures/mixed/src/config.js`
- `tests/fixtures/mixed/src/logger.js`
- `tests/fixtures/mixed/src/widget.js`
- `tests/fixtures/sample/src/index.js`
- `tests/fixtures/sample/src/util.js`
- `tests/fixtures/segments/src/comments.js`
- `tests/fixtures/tree-sitter/javascript.js`

## Executive summary

The test suite in this slice is generally pragmatic and valuable: it exercises index build + search end-to-end, probes guardrails (oversize/minified/binary), validates filter-index determinism, and includes fixtures that cover realistic language surfaces (Flow, React JSX/TSX, dynamic `import()`, mixed ESM/CJS). The main problems are not “logic bugs” so much as **systemic test fragility**:

1. Many tests assume **current working directory equals repo root** (`process.cwd()`), use **fixed cache paths**, and rely on **internal artifact filenames** (e.g., `chunk_meta.json`, `.filelists.json`, `field_postings.json`). This creates drift risk as artifact sharding/manifesting evolves.
2. Several end-to-end tests execute heavyweight flows (build index + build sqlite + multiple searches) without a consistent approach to **timeouts, environment normalization, and determinism**.
3. There is no unified mechanism to **measure and manage test runtime**, so it is hard to rationalize which tests run in CI vs. nightly vs. local.

The recommendations below focus on making tests more deterministic and future-proof while preserving their value as correctness gates.

---

## Findings

### 1) Repo-root detection via `process.cwd()` is fragile

**Files**: 
- `tests/fielded-bm25.js`
- `tests/file-line-guard.js`
- `tests/file-size-guard.js`
- `tests/fixture-empty.js`
- `tests/fixture-eval.js`
- `tests/fixture-parity.js`
- `tests/file-processor/cached-bundle.test.js`
- `tests/file-processor/skip.test.js`

**What’s wrong** (**[RISK]**)
- These scripts derive `root` using `process.cwd()` and then form paths like `path.join(root, 'build_index.js')`.
- If tests are executed from a different working directory (common in monorepos, IDE test runners, or CI wrappers), the scripts will reference the wrong `build_index.js`, fixtures, and cache paths.

**Suggested fix**
- Standardize on `fileURLToPath(import.meta.url)` to resolve the directory of the test file and compute repo root relative to it (as already done in `tests/fixtures/medium/generate.js`).
- Add a tiny shared helper, e.g. `tests/_helpers/paths.js`:
  - `resolveRepoRoot()`
  - `resolveFixturesRoot()`
  - `resolveCacheRoot(testName)`

**Acceptance criteria**
- Tests pass when executed from any working directory.

---

### 2) Fixed cache directories create collisions and flakiness under parallelism

**Files**:
- `tests/fielded-bm25.js` (`tests/.cache/fielded-bm25`)
- `tests/file-line-guard.js` (`tests/.cache/file-line-guard`)
- `tests/file-size-guard.js` (`tests/.cache/file-size-guard`)
- `tests/filter-index-artifact.js` (`tests/.cache/filter-index-artifact`)
- `tests/fixture-empty.js` (`tests/.cache/fixture-empty`)
- `tests/fixture-eval.js` (`tests/.cache/eval-${fixtureName}`)
- `tests/fixture-parity.js` (`tests/.cache/parity-${fixtureName}`)
- `tests/file-processor/cached-bundle.test.js` (`tests/.cache/file-processor-cached`)
- `tests/file-processor/skip.test.js` (`tests/.cache/file-processor-skip`)

**What’s wrong** (**[RISK]**)
- These paths are deterministic and shared.
- If tests are run concurrently (or rerun quickly after failure), they can clobber each other’s cache directories.

**Suggested fix**
- Use `fsPromises.mkdtemp()` to create per-test unique cache roots under a common base directory.
- Include the test name and PID in the directory name, optionally also a timestamp.

**Acceptance criteria**
- Running two instances of the same test concurrently does not interfere.

---

### 3) Tests rely on internal artifact filenames instead of the manifest/reader layer

**Files**:
- `tests/fielded-bm25.js` (asserts `field_postings.json` exists)
- `tests/file-line-guard.js` and `tests/file-size-guard.js` (reads `.filelists.json` and `metrics/index-code.json`)
- `tests/fixture-empty.js` (asserts `chunk_meta.json` exists and is a JSON array)
- `tests/filter-index-artifact.js` (reads `filter_index.json` directly)

**What’s wrong** (**[DRIFT]**)
- The codebase is actively moving toward sharding and streaming artifacts (e.g., chunk meta as JSONL parts; postings sharding; manifest invariants).
- Tests that hardcode single-file artifacts (`chunk_meta.json`, `field_postings.json`) will become brittle as:
  - artifacts shard (`*.meta.json` + `parts/*`),
  - formats shift (json → jsonl), or
  - writers become optional via policy.

**Suggested fix**
- In tests, prefer:
  1. loading the **piece/manifest** (or “index state” manifest) and asserting artifacts are present in the *contracted* form, or
  2. using a single internal “artifact locator” utility (e.g., `src/shared/artifact-io.js`) to resolve current artifact paths.

Concrete recommendations:
- Replace `.filelists.json` reads with a stable “skipped files” artifact output (if `.filelists.json` is intended to remain internal).
- Replace `chunk_meta.json` parsing with a call that loads chunk meta regardless of format (json/jsonl/parts).
- Replace `field_postings.json` existence checks with: “fielded sparse mode is enabled AND the postings artifact is present by manifest key”.

**Acceptance criteria**
- Tests survive a move from monolithic artifacts to sharded artifacts without rewrites.

---

### 4) `file-line-guard.js` and `file-size-guard.js` are largely duplicates (and ambiguous)

**Files**:
- `tests/file-line-guard.js`
- `tests/file-size-guard.js`

**What’s wrong** (**[DX]**, **[DRIFT]**)
- Both generate a large file using 6000 lines of 1024 characters and assert a skip reason of `oversize`.
- That payload is likely to violate both “max lines” and “max bytes”; asserting only `oversize` does not clearly verify the line-limit guard.

**Suggested fix**
- Split into two orthogonal tests:
  - **line-limit test**: many lines but small total bytes; assert a specific reason (e.g., `too_many_lines`) if taxonomy supports it.
  - **byte-limit test**: few lines but huge bytes; assert `oversize`.
- If the current taxonomy intentionally collapses both into `oversize`, then rename the test to reflect that and document which guard it’s verifying (bytes vs lines).

**Acceptance criteria**
- Each guardrail has a targeted test with a minimally sufficient fixture.

---

### 5) `skip.test.js` contains a likely incorrect scenario for “unreadable”

**File**: `tests/file-processor/skip.test.js`

**What’s wrong** (**[RISK]**)
- The “unreadable” case creates a directory `unreadable/` and expects `processFile()` to return `null` and record a skip reason `unreadable`.
- Directories are often skipped for a different reason (e.g., `not_file`, `directory`, `ignored`) rather than “unreadable”. If the core skip taxonomy changes, this test will break.
- Additionally, this test sets `root = process.cwd()` but creates `tempRoot` outside that root; if `processFile()` re-derives relative paths from `root`, the test may become inconsistent.

**Suggested fix**
- Make “unreadable” a truly unreadable file (platform permitting):
  - create a file and chmod to `0` (POSIX), or
  - open it exclusively / use ACLs where feasible.
- If cross-platform permission control is undesirable, change the test intent:
  - test that directories are skipped (and assert the correct reason), and
  - separate “unreadable file” into a POSIX-only test lane.

**Acceptance criteria**
- The test asserts the intended skip reason for the intended condition.

---

### 6) JSON-only tests can be broken by any stdout logging

**Files**:
- `tests/fielded-bm25.js` (parses `search.js --json` stdout)
- `tests/fixture-eval.js` (parses `search.js --json` stdout)

**What’s wrong** (**[RISK]**)
- These tests assume `--json` produces strict JSON on stdout.
- If the CLI ever prints warnings, progress bars, or debug info to stdout (even once), the tests will fail with JSON parse errors.

**Suggested fix**
- Enforce a strict contract: in `--json` mode, stdout must be JSON and all logs must go to stderr.
- Add a narrow “contract test” (or enhance existing ones) that:
  - runs `search.js --json` with a query,
  - asserts stdout parses as JSON,
  - asserts stderr can contain logs.

**Acceptance criteria**
- JSON output remains machine-consumable even under warnings.

---

### 7) `fixture-parity.js` timeout/kill behavior may be unreliable on Windows

**File**: `tests/fixture-parity.js`

**What’s wrong** (**[RISK]**)
- Uses `spawnSync(..., { timeout, killSignal: 'SIGTERM' })`. On Windows, signal semantics differ; timeouts may not terminate child processes reliably.

**Suggested fix**
- Use a cross-platform kill strategy:
  - prefer `SIGKILL` where supported, and/or
  - fall back to process tree termination (if you already have a utility in `src/shared` or `tools`), and/or
  - avoid long-running spawnSync where possible.

**Acceptance criteria**
- The timeout is enforced reliably on all supported platforms.

---

### 8) Filter-index tests use a synthetic meta shape that may drift from real chunk meta

**Files**:
- `tests/filter-index.js`
- `tests/filter-strictness.js`

**What’s wrong** (**[DRIFT]**)
- These tests build filter indexes over a minimal `meta` array containing fields like `id`, `kind`, `last_author`, `docmeta`, `codeRelations`, and `file`.
- If the real meta shape evolves (e.g., chunkId vs id, normalized kinds, nested scm fields), these tests may remain “green” while the production pipeline breaks.

**Suggested fix**
- Add one integration-level test that builds an index on a tiny fixture and then:
  - loads chunk meta using the standard loader,
  - builds the filter index from that meta,
  - asserts at least a small set of filters behave correctly.

**Acceptance criteria**
- Filter-index behavior is validated both at unit level and against real index metadata.

---

## Fixture review notes

### Good coverage already present

- **Encoding**: `tests/fixtures/encoding/latin1.js` provides a non-UTF8 escape (`caf\xe9`) to validate encoding fallbacks.
- **Graphs/imports**: `tests/fixtures/graphs/simple/*` exercises import edges and class/function exports.
- **Language surfaces**:
  - JS JSDoc + classes + async + generators: `javascript_advanced.js`
  - JSX: `javascript_component.jsx`
  - Flow types: `javascript_flow.js`
  - TS features + TSX: `typescript_advanced.ts`, `typescript_component.tsx`
  - Risk sources/sinks: `javascript_risk*`
  - Mixed ESM/CJS + dynamic import: `mixed/src/app.js`
  - Tree-sitter traversal surfaces: `tree-sitter/javascript.js`
- **Segments**: `segments/src/comments.js` includes fenced blocks and comments to validate segment/comment extraction behavior.

### Potential fixture pitfalls

**1) React import in fixtures (`import React from 'react'`)** (**[RISK]**)
- The fixture is not executed, but if any analysis path attempts module resolution (especially tooling-backed TypeScript runs with `checkJs`), missing React typings may generate noise or slowdowns.

**Suggestion**
- Keep the import (it is valuable), but ensure tooling-backed phases in tests either:
  - do not require dependency resolution, or
  - use a stub `node_modules/react` fixture under the test repo when enabling TS provider.

**2) Risk fixtures contain real sink APIs** (**[RISK]**)
- They should never be executed (and are not intended to be), but they can accidentally trigger security tooling or lint rules depending on CI scanning.

**Suggestion**
- Consider adding a comment header indicating “fixture only; not executed” for clarity.

---

## Roadmap-style remediation plan (recommended)

### Phase T1 — Test harness normalization (paths, env, temp dirs)

**Goal:** Make test scripts deterministic and runnable from any working directory.

- [ ] Add `tests/_helpers/paths.js`:
  - [ ] `resolveRepoRoot()` using `fileURLToPath(import.meta.url)`
  - [ ] `resolveFixtureRoot(name)`
  - [ ] `mkCacheRoot(testName)` using `fsPromises.mkdtemp()`
- [ ] Add `tests/_helpers/env.js`:
  - [ ] `buildTestEnv({ cacheRoot, embeddings: 'stub', profile?, testingFlag? })`
  - [ ] standardize which vars are set in `env` vs `process.env`
- [ ] Update scripts in this pass to use the helpers.

**Exit criteria**
- [ ] All scripts run successfully from `repoRoot`, `repoRoot/tests`, or any arbitrary cwd.
- [ ] No shared fixed cache paths remain.

---

### Phase T2 — Artifact contract hardening (manifest-aware tests)

**Goal:** Remove reliance on internal artifact filenames and formats.

- [ ] Introduce an internal “artifact locator” helper used by tests (thin wrapper over existing artifact IO):
  - [ ] `findChunkMeta(indexDir)` → handles json/jsonl/parts
  - [ ] `findFieldPostings(indexDir)` → handles sharding/format evolution
  - [ ] `findMetrics(indexDir, mode)` → stable metrics read
  - [ ] `findSkippedFiles(indexDir)` → stable surface (avoid reading `.filelists.json` directly)
- [ ] Update:
  - [ ] `tests/fixture-empty.js` to read chunk meta via the helper
  - [ ] `tests/fielded-bm25.js` to check artifact presence via helper/manifest
  - [ ] `tests/file-line-guard.js` / `tests/file-size-guard.js` to avoid `.filelists.json`

**Exit criteria**
- [ ] Tests continue to pass if chunk meta becomes JSONL-sharded.
- [ ] Tests assert artifact presence via a stable contract, not a filename.

---

### Phase T3 — Guardrail tests: de-duplicate and make intent explicit

**Goal:** Ensure guardrail tests validate a single, specific reason and are minimal.

- [ ] Refactor file guard tests:
  - [ ] Replace the duplicate “6000×1024” payload with two targeted cases:
    - [ ] line-limit-only case (many lines, small bytes)
    - [ ] byte-limit-only case (few lines, large bytes)
  - [ ] Assert the correct skip taxonomy reason(s).
- [ ] Refactor `tests/file-processor/skip.test.js`:
  - [ ] Make “unreadable” truly unreadable (POSIX lane) or change it to a “directory skip” test.

**Exit criteria**
- [ ] Each guardrail has one minimal targeted fixture.

---

### Phase T4 — JSON contract and CLI cleanliness

**Goal:** Ensure `--json` produces strict JSON on stdout.

- [ ] Add a dedicated JSON-output contract test:
  - [ ] Run `search.js --json` and assert stdout parses as JSON.
  - [ ] Run with warnings enabled (if available) and assert JSON remains intact.
- [ ] Ensure CLI routes all logs to stderr in JSON mode.

**Exit criteria**
- [ ] No test needs to defensively strip non-JSON from stdout.

---

### Phase T5 — Test timing instrumentation and CI lane policy

**Goal:** Track per-test runtime and use it to shape CI strategy (smoke vs integration vs nightly).

#### T5.1 Instrumentation (minimum viable)

- [ ] Add a standard timing wrapper for node-script tests:
  - [ ] Each script can optionally emit a single JSON line to stderr or a file:
    - `{"test":"tests/fielded-bm25.js","ms":1234,"status":"pass"}`
  - [ ] Enable via env: `PAIROFCLEATS_TEST_TIMINGS=1`
- [ ] Add a collector:
  - [ ] Write to `tests/.cache/test-timings.jsonl` (append-only)
  - [ ] On CI, upload as artifact

#### T5.2 Budgeting and lanes

- [ ] Define lanes:
  - [ ] **CI smoke** (fast, <2–3 minutes): pure unit tests + 1 small e2e build/search
  - [ ] **CI integration** (medium, <10–15 minutes): sqlite build + parity on 1 fixture
  - [ ] **Nightly**: multi-fixture eval + medium fixture generation/indexing + perf checks
- [ ] Add a policy file documenting which tests belong to which lane (and why).
- [ ] Add a dashboard script that prints “Top 20 slowest tests” from `test-timings.jsonl`.

**Exit criteria**
- [ ] CI knows exactly which tests run where.
- [ ] Slow test regressions are detected early.

---

## Download

- [Download this report](sandbox:/mnt/data/CODEBASE_STATIC_REVIEW_FINDINGS_PASS8_TESTS_FIXTURES.md)
