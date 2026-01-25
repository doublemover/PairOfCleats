# Codebase Static Review Findings — Tests: Language Contracts, Registry, and LMDB (Pass 8)

This report is a focused static review of a **subset of the test suite** (under `tests/`) covering:

- language contract verification (chunking/docmeta/control-flow)
- language registry selection + import-collector correctness checks
- LMDB backend build/load + corruption detection

The emphasis is on **correctness**, **test reliability**, **cross-platform behavior**, **CI operability**, and **test suite scalability** (time, parallelism, and optional dependency gating).

All file references are relative to the repo root.

## Scope

Files reviewed (as requested):

### Language contracts
- `tests/lang/contracts/go.test.js`
- `tests/lang/contracts/javascript.test.js`
- `tests/lang/contracts/misc-buildfiles.test.js`
- `tests/lang/contracts/python.test.js`
- `tests/lang/contracts/sql.test.js`
- `tests/lang/contracts/typescript.test.js`

### Sample fixture metadata checks
- `tests/lang/fixtures-sample/python-metadata.test.js`
- `tests/lang/fixtures-sample/rust-metadata.test.js`
- `tests/lang/fixtures-sample/swift-metadata.test.js`

### Direct unit tests of language helpers
- `tests/lang/js-chunking.test.js`
- `tests/lang/js-imports.test.js`
- `tests/lang/js-relations.test.js`
- `tests/lang/python-heuristic-chunking.test.js`
- `tests/lang/python-imports.test.js`
- `tests/lang/python-pool.test.js`

### Language registry tests
- `tests/language-registry/collectors.test.js`
- `tests/language-registry/selection.test.js`

### LMDB backend tests
- `tests/lmdb-backend.js`
- `tests/lmdb-corruption.js`
- `tests/lmdb-report-artifacts.js`

## Severity Key

- **Critical**: likely to cause incorrect results, crashes, corrupted artifacts, or major CI breakage (or a high-risk foot-gun).
- **High**: significant correctness/coverage risk, major flakiness risk, or a scaling blocker (parallelism/time).
- **Medium**: correctness edge cases, maintainability hazards, or meaningful CI inefficiency.
- **Low**: minor issues, polish, or “nice to have” improvements.

---

## Executive Summary

- **[High] Mixed optional-dependency behavior (Python tests “skip”, LMDB tests “hard fail”) creates portability and CI policy ambiguity.** Python contract/metadata tests explicitly skip when `python/python3` is unavailable, but LMDB tests exit(1) if `lmdb` is missing. This makes it unclear whether these are *required invariants* or *capability tests*. Centralize the gating policy so CI and local dev behave predictably.

- **[High] Several tests assume “repo root = `process.cwd()`”, which is fragile if the test runner changes the working directory.** The LMDB tests in particular resolve `build_index.js`, `search.js`, and `tools/*` using `process.cwd()` and then spawn those paths. This is correct only if tests always execute with repo root as CWD.

- **[High] Concurrency/parallelism scaling risk: multiple tests use fixed directories under `tests/.cache/*` without uniqueness.** If the suite is parallelized (a natural next step to reduce CI wall time), tests that delete/recreate fixed paths will race or corrupt each other’s state.

- **[Medium] Ambiguous line-range semantics are baked into `tests/lang/python-heuristic-chunking.test.js` (endLine appears to be “start of next chunk” rather than inclusive).** This is a correctness risk because other parts of the system may treat `endLine` as inclusive. Tests should encode a single canonical semantic and validate it by slicing actual source ranges.

- **[Medium] Name-based lookups (`Array.find`, `Object.fromEntries`) can hide duplicates and allow false positives.** Several tests only assert “at least one matching chunk exists”; they will still pass if the implementation produces duplicate chunks, misnames symbols, or assigns inconsistent kinds.

- **[Medium] `tests/lang/js-relations.test.js` requires a `default` export in a file that has no default export.** If `rel.exports` is meant to represent “module exports”, this expectation might be intentional (CommonJS `module.exports` treated as `default`), but it should be made explicit with an additional assertion, otherwise it reads as a semantic mismatch.

- **[Medium] `tests/lang/python-imports.test.js` expects “usages” to include both imported and local alias names, conflating two different concepts.** For `from foo.bar import Baz as Qux`, the local name is `Qux` but the imported symbol name is `Baz`. Tests currently enforce a mixed list; the implementation likely needs a structured mapping rather than a flat array.

- **[High] There is no first-class process for measuring test runtimes and budgeting CI tiers.** Multiple tests here build indexes and/or storage backends, which will dominate runtime. Add timing capture + suite classification to make “smoke vs full vs heavy” sustainable.

---

## 1) Cross-cutting test-suite issues in this slice

### 1.1 **[High]** Optional dependency gating is inconsistent and not policy-driven

**Where**
- Python checks skip: `tests/lang/contracts/python.test.js` and `tests/lang/fixtures-sample/python-metadata.test.js`
- LMDB checks hard-fail when optional dep missing: `tests/lmdb-backend.js`, `tests/lmdb-corruption.js`, `tests/lmdb-report-artifacts.js`

**Why it matters**
- The repo already has a concept of optional dependencies (and historically you’ve discussed “capabilities” and install flows). Tests should match that philosophy.
- If `lmdb` is genuinely optional (platform restrictions, native build constraints), hard-failing makes the suite brittle.
- If `lmdb` is expected in CI, this should be explicit via a single capability/policy gate so it’s auditable.

**Suggestions**
- Introduce a unified helper (e.g. `tests/helpers/capabilities.js`) that:
  - checks for python availability
  - checks for `lmdb` module availability
  - checks for other native deps (re2, sqlite-vec, etc) as the suite grows
- Decide (in one place) whether missing deps should:
  - **skip** (capability test), or
  - **fail** (required invariant), or
  - **fail only in CI** (gated by env var / policy config)

---

### 1.2 **[High]** “repo root = `process.cwd()`” assumption is fragile

**Where**
- `tests/lmdb-backend.js` (e.g., `const root = process.cwd();` and then `path.join(root, 'build_index.js')`)
- `tests/lmdb-corruption.js`
- `tests/lmdb-report-artifacts.js`

**Why it matters**
- If the test runner ever runs with a different CWD (monorepo, workspace tooling, “run from tests/”), these tests will fail by spawning non-existent paths.
- This also complicates re-use in other environments (e.g., running via a harness that chdirs into the fixture repo).

**Suggestions**
- Prefer a deterministic repo root resolution mechanism:
  - `const __dirname = path.dirname(fileURLToPath(import.meta.url))`
  - `const root = path.resolve(__dirname, '..')` (or appropriate upward traversal)
- Keep CWD-dependent behavior only where it’s intended (e.g., when explicitly testing behavior that depends on `cwd`).

---

### 1.3 **[High]** Fixed temp paths block safe parallelization

**Where**
- LMDB tests: `tests/.cache/lmdb-backend`, `tests/.cache/lmdb-corruption`, `tests/.cache/lmdb-report-artifacts`
- (Potentially) fixture index caches via `cacheName` (`language-fixture`, `fixture-sample`), depending on `ensureFixtureIndex` implementation

**Why it matters**
- A common scaling move is to run tests in parallel (by file, shard, or category). Deleting and recreating a fixed directory is a race hazard.
- Even without parallelism, a previously crashed run can leave partial state behind; fixed names raise the odds of reusing corrupted state.

**Suggestions**
- Use unique temp roots by default:
  - `tests/.cache/<test-name>/<timestamp>-<pid>-<random>/...`
- If stable caching is desired, keep a separate *read-only* cache location and write into unique run dirs, with a final “atomic promote” step.

---

## 2) Language contract tests (`tests/lang/contracts/*`)

These tests validate that the “language fixture repo” index contains specific chunks with expected docmeta and control-flow attributes.

### 2.1 `tests/lang/contracts/go.test.js`

**Strengths**
- Verifies both struct doc extraction and basic control-flow (“returns >= 1”).
- Uses tolerant matching for `kind` (`includes('Struct')` / `includes('Function')`), which reduces flakiness across minor representation changes.

**Issues / risks**

1) **[Medium] Potential false positives due to substring matching of `kind` and `name`.**
   - The selection logic could match unintended chunks if other symbols contain `Widget`/`MakeWidget` substrings.
   - This is partially mitigated by checking the docstring content, but it’s not fully robust if multiple `Widget*` structs exist.

**Suggestions**
- Prefer exact matching when fixture symbols are intended to be unique (e.g., `chunk.name === 'Widget'`), and add a guard that there is only **one** such chunk in the file.

---

### 2.2 `tests/lang/contracts/javascript.test.js`

**Issues / risks**

1) **[Medium] Kind checks are too specific and may drift.**
   - The test hard-codes the acceptable `kind` set to `ClassDeclaration|ExportedClass|ExportDefaultClassDeclaration`.
   - If the implementation normalizes kinds differently (or changes naming), the test fails for non-semantic reasons.

2) **[Medium] Docmeta schema inconsistency across languages is reinforced.**
   - JS expects `docmeta.modifiers.async` for `Widget.load`, while Python expects `docmeta.async`.
   - If the goal is a normalized docmeta schema, tests should converge toward the canonical representation.

**Suggestions**
- Introduce a canonical kind vocabulary (even within tests), e.g. treat class chunks as `kindFamily: 'class'`.
- If a normalized docmeta is desired, enforce *one* representation (e.g., always `docmeta.modifiers.async`) or explicitly document per-language differences.

---

### 2.3 `tests/lang/contracts/python.test.js`

**Issues / risks**

1) **[High] Skip-on-missing-python means regressions in “Python without Python” mode go undetected.**
   - If the codebase supports heuristic parsing without Python available, this test will never validate that behavior on hosts without Python.

2) **[Medium] Test only validates presence of fields x/y but not types, defaults, or dataclass markers.**
   - If type inference for dataclasses is important, this test’s assertions are too shallow.

**Suggestions**
- Split into two tests:
  - “Python tooling available” (expects AST-backed metadata)
  - “Python tooling unavailable” (expects heuristic metadata, and validates that it is *non-empty and sane*)
- Expand assertions (optional) to include type strings (`int`, `float`, etc.) if that’s part of docmeta.

---

### 2.4 `tests/lang/contracts/sql.test.js`

**Issues / risks**

1) **[Medium] Control flow validation is under-specified.**
   - Requiring `typeof branches === 'number'` is a weak signal; it will pass even if `branches` is always `0` or nonsense.
   - It also doesn’t verify the presence of other expected SQL docmeta (e.g., column extraction, constraints, dialect normalization).

**Suggestions**
- Add at least one stronger assertion:
  - `branches >= 0` AND `returns` or similar fields have plausible values.
  - Verify `docmeta.dialect` for both SQL files (and not just Postgres).

---

### 2.5 `tests/lang/contracts/typescript.test.js`

**Issues / risks**

1) **[Medium] Kind hard-coding can break for exported/default variants.**
   - Like the JS contract, the test assumes `kind === 'ClassDeclaration'` and `kind === 'FunctionDeclaration'`.

2) **[Medium] Extends assertion uses substring search and may hide formatting drift.**
   - `some((name) => includes('BaseWidget'))` will pass even if the extends list is malformed or contains noise.

**Suggestions**
- Consider validating both:
  - the raw textual extends expression (if available), and
  - a normalized base class name list.
- Add a guard against duplicate `Widget` class chunks.

---

### 2.6 `tests/lang/contracts/misc-buildfiles.test.js`

**Issues / risks**

1) **[Low] Test only verifies that *a chunk exists* per file, not that the selected language is correct.**
   - This test will pass if the file is indexed as “prose” or “unknown” but still chunked.

**Suggestions**
- If language selection correctness matters, also assert `chunk.language` or `chunk.langId` (whatever is present in chunk meta) for each file.

---

## 3) Sample fixture metadata tests (`tests/lang/fixtures-sample/*`)

These tests run a search query on a small “sample” fixture index and validate that selected hits include expected docmeta fields (signatures and decorators/attributes).

### 3.1 **[Medium] Name-based hit selection can mask duplicates and ranking drift**

**Where**
- `tests/lang/fixtures-sample/python-metadata.test.js` selects by `entry.file` + `entry.name.endsWith('message')`
- `tests/lang/fixtures-sample/rust-metadata.test.js` selects by `entry.name === 'rust_greet'`
- `tests/lang/fixtures-sample/swift-metadata.test.js` selects by `entry.name === 'Greeter.sayHello'`

**Why it matters**
- If the index emits multiple chunks with the same name (overloads, duplicate chunking), a `.find(...)` can pick a “lucky” hit and hide duplication errors.
- If ranking changes, the hit may not appear in `payload.code` despite still being indexed (depending on `runSearch` behavior and candidate cutoffs).

**Suggestions**
- Prefer to filter to all matching hits and assert:
  - count == 1 (or a known count), and
  - the single hit contains expected metadata

---

### 3.2 **[Medium] Python metadata test skips entirely if Python is missing**

**Where**
- `tests/lang/fixtures-sample/python-metadata.test.js`

**Why it matters**
- Same gating issue as the Python contract test: you lose coverage on hosts lacking Python, unless CI policy guarantees Python everywhere.

**Suggestions**
- If “Python-less indexing” is a supported mode, add an alternate assertion path when Python is missing (heuristic metadata should still exist).

---

## 4) Direct JS tests (`tests/lang/js-*`)

### 4.1 `tests/lang/js-chunking.test.js`

**Issues / risks**

1) **[Medium] The test asserts presence but not uniqueness or kind correctness.**
   - It validates `name` only; you could emit wrong chunk kinds or duplicates and still pass.

2) **[Low] `exports.qux` fallback logic indicates naming inconsistency that’s not made explicit.**
   - The test accepts `exports.qux` OR `qux`, which is pragmatic but hides whether the canonical naming is stable.

**Suggestions**
- Assert uniqueness for the key names.
- If `exports.` prefixing is a meaningful semantic (CommonJS), encode it as an explicit expected behavior: either require it, or require the unprefixed name, but not both.

---

### 4.2 `tests/lang/js-imports.test.js`

**Issues / risks**

1) **[Medium] Test validates module specifiers only; it does not verify imported symbol mapping.**
   - For static analysis and cross-file linking, the binding names matter (e.g., `join as joinPath`).

**Suggestions**
- If the underlying collector supports it (or should), extend expected outputs to include:
  - `{ module: 'path', imported: 'join', local: 'joinPath' }` style records.

---

### 4.3 `tests/lang/js-relations.test.js`

**Issue**

1) **[Medium] Expects `default` export even though source has no `export default` statement.**
   - `module.exports = { run }` may be treated as “default export” semantics by design, but the test does not explain that.
   - Without an explanatory assertion, it reads like a semantic mismatch and can confuse future contributors.

**Where**
- `tests/lang/js-relations.test.js:29–31`

**Suggestions**
- Make the intent explicit by checking for a distinct marker, e.g.:
  - `rel.exports` contains `'default'` **because** CommonJS module.exports is modeled as default export.
- Alternatively, assert a `rel.exportsMode === 'cjs'|'esm'|'mixed'` if that concept exists.

---

## 5) Python heuristic chunking and imports

### 5.1 `tests/lang/python-heuristic-chunking.test.js`

**Issue**

1) **[Medium] The test encodes unclear `endLine` semantics and risks standardizing an off-by-one behavior.**

**Where**
- `tests/lang/python-heuristic-chunking.test.js:31–38`

**What looks wrong**
- The sample input’s class `Foo` spans lines 1–4, but the test expects `Foo.meta.endLine === 5` (the line where `def top()` begins).
- The function `top` spans lines 5–7, but the test expects `top.meta.endLine === 8` (the line where `async def later()` begins).

This strongly suggests that `endLine` is being treated as “startLine of the next chunk” (exclusive), not “inclusive last line of this chunk”.

**Why it matters**
- Other subsystems (highlighting, context expansion, blame range queries, doc rendering) typically expect *inclusive* ranges.
- Inconsistent interpretation makes range logic brittle and can cause:
  - chunk text overlap,
  - missing last-line content,
  - wrong blame attribution windows.

**Suggestions**
- Decide and document the canonical semantic for `meta.startLine`/`meta.endLine` (inclusive vs exclusive, 0-based vs 1-based).
- Update the test to validate semantics by slicing the original source by computed offsets and checking that:
  - the class chunk does **not** include `def top():`,
  - the function chunk does **not** include `async def later():`.

---

### 5.2 `tests/lang/python-imports.test.js`

**Issue**

1) **[Medium] `usages` conflates “imported symbol name” and “local alias name”.**

**Where**
- `tests/lang/python-imports.test.js:27–35`

**What looks wrong**
- The test expects both `'Baz'` and `'Qux'` to appear in `usages` for `from foo.bar import Baz as Qux`.
- In Python, `Baz` is not a local binding; only `Qux` is. Treating both as equivalent “usages” creates ambiguity for later graph building.

**Why it matters**
- Cross-file linking needs a mapping:
  - module import path: `foo.bar`
  - imported name: `Baz`
  - local name: `Qux`
- Flattening this into a single array loses information and can create false edges.

**Suggestions**
- Keep the current `imports` list, but replace/augment `usages` with a structured list:
  - `importsDetailed: [{ module: 'foo.bar', imported: 'Baz', local: 'Qux' }, ...]`
- Update the test to assert that mapping, rather than a flat mixed set.

---

### 5.3 `tests/lang/python-pool.test.js`

**Issues / risks**

1) **[Medium] Modifying `process.env.PATH` without a `try/finally` can leak state if the test throws early.**
   - The script restores PATH at the end, but if a failure occurs before restoration, subsequent work in the same process would inherit `PATH=''`.

**Where**
- `tests/lang/python-pool.test.js:6–30`

2) **[Medium] The test’s branching logic is awkward: it checks for python after intentionally clearing PATH.**
   - If `findPythonExecutable()` searches absolute paths (not PATH-based), `pythonBin` may still be found.
   - The test then calls `getPythonAst(...)` without explicitly passing that executable path, which may or may not be consistent with `findPythonExecutable()` behavior.

**Suggestions**
- Wrap PATH mutation with `try/finally`.
- If the goal is to test both modes deterministically:
  - add an override to force-disable python tooling (env var or config input) and assert behavior, rather than depending on PATH and host layout.

---

## 6) Language registry tests

### 6.1 `tests/language-registry/collectors.test.js`

**Strengths**
- Good coverage breadth: exercises a large set of import collectors with compact fixtures.
- Uses set comparison rather than order-dependent results.

**Issues / risks**

1) **[Low] Inputs are too “happy path” for several collectors.**
   - Example: Makefile supports various include syntaxes and variable expansion; this test covers only direct include and `-include`.

**Suggestions**
- Add at least one edge-case input per collector (quoted paths, extra whitespace, comments, multiline forms) to reduce regressions.

---

### 6.2 `tests/language-registry/selection.test.js`

**Issue**

1) **[Medium] Does not cover the most common “no extension” patterns.**
   - Dockerfiles are often named `Dockerfile` (no extension).
   - Makefiles are often named `Makefile` (no extension).
   - CMake is typically `CMakeLists.txt` (not `.cmake`).

**Suggestions**
- Add selection assertions for:
  - `Dockerfile` (basename match)
  - `Makefile` (basename match)
  - `CMakeLists.txt` (basename match)
- If language selection uses both `ext` and `relPath`, add cases where `ext === ''` and `relPath` has the basename.

---

## 7) LMDB backend tests

### 7.1 **[High]** Optional dependency policy and platform variability

**Where**
- `tests/lmdb-backend.js`, `tests/lmdb-corruption.js`, `tests/lmdb-report-artifacts.js` import `lmdb` and hard-fail if missing.

**Why it matters**
- LMDB is a native dependency; it may not be available on all platforms without additional toolchains.
- If LMDB is intended to be optional, these tests should be capability-gated.

**Suggestions**
- Decide whether LMDB tests are:
  - “required in CI” (then enforce via CI setup and make it explicit), or
  - “optional integration suite” (then skip unless `PAIROFCLEATS_RUN_LMDB_TESTS=1` or similar)

---

### 7.2 **[Medium]** Temp directory handling and test isolation

**Where**
- All LMDB tests use fixed `tests/.cache/<name>` roots.

**Why it matters**
- If you later run tests in parallel, fixed temp roots can race. Even today, stale state can mislead local debugging.

**Suggestions**
- Add a unique suffix (PID+timestamp) to tempRoot, and optionally keep a stable “last run” symlink for debugging.

---

### 7.3 **[Medium]** Schema mismatch assertion relies on a specific error string

**Where**
- `tests/lmdb-backend.js:114–117`

**Why it matters**
- User-facing error messages should be allowed to evolve without breaking tests, as long as structured error codes are stable.

**Suggestions**
- Prefer checking a structured error code (if available) in JSON output, or check for a more stable token than a full phrase.

---

### 7.4 **[Medium]** Environment variables are set globally without restoration

**Where**
- LMDB tests set `process.env.PAIROFCLEATS_*` and do not restore.

**Why it matters**
- If tests are ever executed in-process (vs spawn-per-file), this will leak state across tests.
- Even today, it can surprise developers running ad-hoc tests in a shared REPL process.

**Suggestions**
- For long-term safety, consider:
  - only passing env into spawned subprocesses (avoid mutating `process.env`), or
  - restoring env in `finally`.

---

## 8) Test runtime tracking and CI tiering process (required)

This slice contains a mix of:
- “fast” unit-ish tests (JS chunking/imports/relations, collectors/selection)
- “slow” integration tests (fixture indexing, LMDB build/load, report-artifacts)

To keep the suite healthy as features expand, you need a first-class approach to **measuring**, **budgeting**, and **tiering** tests.

### 8.1 Proposed timing capture mechanism

**Goal**
- Record runtime per test file (and optionally per sub-step) in a machine-readable format.
- Track regressions over time and enforce budgets for CI tiers.

**Approach (minimal invasive)**
- Add a single wrapper runner (or extend the existing test runner) that:
  - spawns each test file as a subprocess
  - measures elapsed time using `process.hrtime.bigint()`
  - records:
    - `{ testPath, status, exitCode, durationMs, startedAt, nodeVersion, platform }`
  - writes results to:
    - `tests/.cache/test-timings.jsonl` (append-only) and/or
    - `tests/.cache/test-timings.latest.json`

**Output example (JSONL)**
```json
{"test":"tests/lang/js-imports.test.js","status":"pass","exitCode":0,"durationMs":42,"node":"v20.11.0","platform":"linux"}
{"test":"tests/lmdb-report-artifacts.js","status":"pass","exitCode":0,"durationMs":18321,"node":"v20.11.0","platform":"linux"}
```

### 8.2 CI tiers and budgets

Define three tiers, with explicit budgets:

1) **Smoke (PR-gating)**
   - Target: < 2–4 minutes total wall time
   - Includes:
     - unit-ish tests (pure parsing functions, collectors, selection)
     - minimal fixture indexing tests (only if they reuse a cached index and are stable)
   - Excludes:
     - LMDB build/load tests
     - any “build whole index” e2e tests

2) **Integration (PR optional / main branch gating)**
   - Target: < 10–20 minutes
   - Includes:
     - fixture indexing contract tests
     - LMDB tests (if LMDB is part of supported matrix)

3) **Heavy / Nightly**
   - Target: allowed to be long (30–60+ minutes)
   - Includes:
     - multi-repo indexing
     - performance/throughput tests
     - fuzzing/differential tests

### 8.3 How to use timings to drive decisions

- **Baseline**: store “expected durationMs” per test in a manifest (checked-in).
- **Detection**:
  - warn when a test exceeds baseline by X%
  - fail smoke tier if it exceeds a hard max
- **Triage**:
  - if a test becomes slow, decide whether to:
    - move it to a slower tier, or
    - refactor to reduce runtime (caching, smaller fixtures), or
    - split it into fast validation + slow deep-check

### 8.4 Specific recommendations for this file set

- Keep these in **smoke**:
  - `tests/lang/js-chunking.test.js`
  - `tests/lang/js-imports.test.js`
  - `tests/language-registry/collectors.test.js`
  - `tests/language-registry/selection.test.js`
  - `tests/lang/python-imports.test.js` (pure text parsing)

- Keep these in **integration**:
  - `tests/lang/contracts/*.test.js` (depends on fixture indexing + chunk meta)
  - `tests/lang/fixtures-sample/*.test.js` (depends on fixture indexing + search)
  - `tests/lmdb-*` (builds LMDB indexes, runs report-artifacts)

---

## 9) Actionable refactor checklist

These are concrete improvements suggested by the findings above.

### 9.1 Centralize optional-dependency policy

- [ ] Introduce a shared test helper to detect capabilities (`python`, `lmdb`, etc) and apply a single skip/fail policy.
- [ ] Decide and codify whether LMDB tests are **required** or **capability-gated** (with clear CI behavior).
- [ ] Ensure skip behavior is visible in summary output (not silent).

### 9.2 Make temp roots parallel-safe

- [ ] Update LMDB tests to use unique temp roots (`tests/.cache/<name>/<pid>-<ts>/...`).
- [ ] If stable caching is needed, separate “shared cache” from “run dir” and use atomic promote.

### 9.3 Clarify line-range semantics

- [ ] Define and document `meta.startLine` / `meta.endLine` semantics (inclusive/exclusive, 1-based/0-based).
- [ ] Update `tests/lang/python-heuristic-chunking.test.js` to validate semantics by slicing actual source text.

### 9.4 Strengthen uniqueness and semantic correctness in tests

- [ ] Replace `.find(...)` with “collect all matches and assert exactly one” where fixture symbols are expected to be unique.
- [ ] Add explicit assertions about export model semantics in `tests/lang/js-relations.test.js` (CJS-as-default vs real `export default`).

### 9.5 Add test timing capture + suite tiering

- [ ] Implement per-test runtime measurement in the test runner (JSONL output).
- [ ] Add a checked-in manifest of tiers + max runtime per test.
- [ ] Add CI configuration that runs smoke tier on PRs and integration tier on main/nightly.

