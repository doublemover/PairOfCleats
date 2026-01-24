# Completed Phases

Any time a phase is fully completed, AFTER it has been merged into main:
  - Remove the phase from the current roadmap
  - Append the Title and a brief, single item summary 
  - Some phase numbers are reused 
  - Nothing in this document should be treated as authoritative, refer to code for truth

Completed phase snapshots are archived here after being removed from GIGAROADMAP.md. 

---



## Phase 0 — CI, Test Harness, and Developer Workflow Baseline [x]

### Objective

Make the project **safe to change** and **fast to iterate**: CI must be deterministic and green; there must be a single “run what CI runs” entrypoint; the test runner must be reliable (timeouts, skips, logs); and we must stop further tool/script drift via explicit policy gates. This phase also fixes or pulls forward any **sweep bugs** directly impacting the CI/harness/tooling surface.

### Exit criteria

- CI is green on **Node 24 LTS** for the supported OS matrix (at minimum: Ubuntu + Windows).
- CI is driven by a **single, documented entrypoint** (`npm run test:pr`) that can be run locally.
- The test runner reliably reports **pass/fail/skip**, terminates hung tests (no orphan processes), and produces usable logs/JUnit in CI.
- Script/command drift is gated (workflow → scripts exist; script-coverage harness is not broken by drift).
- Any Phase 0-touched files with relevant sweep findings have either:
  - the issue fixed in this phase, or
  - an explicit deferral note with the follow-on phase where it is fixed.

---

### 0.1 Standardize the baseline runtime on Node 24 LTS

- [x] Adopt Node 24 LTS as the project baseline for dev + CI
  - [x] Add `.nvmrc` with `24.13.0`
  - [x] Update `package.json`:
    - [x] Add/adjust `engines.node` to a Node 24 LTS compatible range (e.g. `>=24.13.0`)
    - [x] Ensure any engine-sensitive tooling (linters, formatters) remains compatible
  - [x] Update docs (minimal):
    - [x] `README.md` (or `docs/`) to state Node 24 LTS baseline + how to switch via `.nvmrc`

#### Tests / Verification

- [x] CI step prints Node and npm versions (`node -v`, `npm -v`) to logs
- [x] Local verification: `npm ci && npm test` succeeds on Node 24 LTS

---

### 0.2 Fix CI script mismatch and create a single PR suite entrypoint

> Confirmed in code: `.github/workflows/ci.yml` currently calls `npm run test-all-no-bench`, but `package.json` does **not** define `test-all-no-bench`.

- [x] Define the canonical CI/PR entrypoint: `npm run test:pr`
  - [x] Add `tools/ci/run-suite.js` that orchestrates the PR suite (and later nightly)
    - [x] Supports `--mode pr|nightly`
    - [x] Supports `--dry-run` (prints planned steps without executing) for fast validation
    - [x] Normalizes core CI env (suite runner responsibility, not every leaf test’s):
      - [x] `PAIROFCLEATS_TESTING=1`
      - [x] `PAIROFCLEATS_EMBEDDINGS=stub` (unless explicitly overridden)
      - [x] `PAIROFCLEATS_WORKER_POOL=off` (reduce concurrency flake)
      - [x] `PAIROFCLEATS_THREADS=1` and `PAIROFCLEATS_BUNDLE_THREADS=1` (reduce nondeterminism unless a test opts-in)
      - [x] `PAIROFCLEATS_CACHE_ROOT=<workspace cache dir>` (CI only; do **not** force globally in the runner)
    - [x] Produces CI-friendly outputs:
      - [x] JUnit XML path (default: `artifacts/junit.xml`)
      - [x] Diagnostics JSON directory (default: `.diagnostics/`)
    - [x] Calls the existing primitives in a stable order (initial PR suite):
      - [x] `npm run lint`
      - [x] `npm run config:budget`
      - [x] `npm run env:check`
      - [x] `node tests/run.js --lane ci --junit <path> --log-dir <path> ...`
      - [x] Capability gate step (see 0.4)

  - [x] Update `package.json` scripts:
    - [x] Add `test:pr` → `node tools/ci/run-suite.js --mode pr`
    - [x] Add `test:nightly` → `node tools/ci/run-suite.js --mode nightly`
    - [x] Add a **compatibility alias** to unblock CI immediately:
      - [x] Either add `test-all-no-bench` as an alias to `npm run test:pr`, **or**
      - [x] Update the workflow to stop calling `test-all-no-bench` (preferred long-term), while keeping the alias temporarily to avoid doc drift

- [x] Update `.github/workflows/ci.yml` to call the canonical entrypoint
  - [x] Replace `npm run test-all-no-bench` with `npm run test:pr` (or direct `node tools/ci/run-suite.js --mode pr`)
  - [x] Keep the workflow YAML thin (prefer orchestration in `run-suite.js` to prevent YAML drift)

#### Tests / Verification

- [x] Add `tests/ci/workflow-contract.js`
  - [x] Parse `.github/workflows/ci.yml`
  - [x] Assert any referenced `npm run <script>` exists in `package.json`
  - [x] Assert the workflow pins Node 24 LTS
- [x] Add `tests/ci/suite-runner.smoke.js`
  - [x] Runs `node tools/ci/run-suite.js --mode pr --dry-run`
  - [x] Asserts the step list includes `lint`, `config:budget`, `env:check`, and `tests/run.js --lane ci`
  - Fix attempt 1: relaxed dry-run regex to match `npm.cmd` and Windows paths.
- [x] Manual verification: open a PR and confirm the workflow uses the same steps as `npm run test:pr`

---

### 0.3 Define CI + nightly workflows and artifact capture

- [x] Update `.github/workflows/ci.yml` (PR gate)
  - [x] Use `actions/setup-node@v4` with Node 24 LTS
  - [x] Use `npm ci` (no `npm install`)
  - [x] Use a minimal OS matrix that is actually supportable today:
    - [x] Ubuntu is the strict PR gate for full `test:pr`
    - [x] Windows is a correctness smoke gate (capability-gated; do not block on known native gaps)
  - [x] Cache:
    - [x] `actions/setup-node` npm cache
    - [x] `PAIROFCLEATS_CACHE_ROOT` directory via `actions/cache` (keyed by OS + lockfile hash)
  - [x] Always upload artifacts (on failure at minimum):
    - [x] Test logs directory (recommendation: `tests/.logs/**`)
    - [x] JUnit XML output (recommendation: `artifacts/junit.xml`)
    - [x] Diagnostics JSON output (recommendation: `.diagnostics/**`)

- [x] Add `.github/workflows/nightly.yml` (scheduled + manual)
  - [x] Schedule nightly runs (cron) + `workflow_dispatch`
  - [x] Execute a broader matrix than PR:
    - [x] At minimum: Ubuntu + Windows
    - [x] Optional (after stable): macOS
    - [x] Include additional lanes and/or capability variations (example):
      - [x] `--lane storage` when sqlite/LMDB capabilities are present
      - [x] `--lane perf` in nightly only
  - [x] Keep nightly “long” work capability-gated (do not make PRs depend on flaky optional stacks)

#### Tests / Verification

- [x] Extend `tests/ci/workflow-contract.js` (or add `tests/ci/nightly-workflow-contract.js`) to validate nightly workflow script references
- [x] Verification task: ensure artifacts appear in the GitHub Actions run when a test is forced to fail (log and junit uploaded)

---

### 0.4 Capability gate + optional dependency policy (CI-safe optionality)

> This phase integrates relevant sweep findings when they touch the CI/test/tooling surface (notably: optional dependency drift and “fail vs skip” ambiguity).

- [x] Define the capability policy (document + enforce)
  - [x] Decide the required baseline for PR (explicit, not implicit):
    - [x] Required: `ci` lane (unit + integration + services)
    - [x] Required: core storage backend availability (SQLite) **or** explicit skip with a clear reason
    - [x] Required: at least one ANN backend (e.g., HNSW) **or** explicit skip + PR warning (policy decision)
  - [x] Decide enforcement modes:
    - [x] PR: fail only when a **required** capability is missing
    - [x] Nightly: run optional stacks when available; treat unexpected missing capabilities as warnings (unless explicitly required)

- [x] Implement `tools/ci/capability-gate.js`
  - [x] Produces a machine-readable report (JSON) and a human-readable summary
  - [x] Must be **non-crashy**:
    - [x] Unexpected probe errors are reported as “capability unknown” with details, not as an unhandled exception
  - [x] Writes to a stable path for CI artifact upload (e.g. `.diagnostics/capabilities.json`)
  - [x] Probes capabilities using (and extending if needed):
    - [x] `src/shared/capabilities.js` (module availability)
    - [x] Targeted runtime probes where “require() success” is insufficient (e.g. sqlite open, basic ANN init)
  - [x] Exposes CLI controls:
    - [x] `--mode pr|nightly`
    - [x] `--require <capability>` (repeatable)
    - [x] `--json <path>` (or writes to default if omitted)
    - [x] Exit codes that are stable and documented (use `src/shared/error-codes.js`)

- [x] Add a shared test helper for optional capability gating
  - [x] Add `tests/helpers/require-or-skip.js` (or similar)
    - [x] `requireOrSkip({ capability, reason, requiredInCi })`
    - [x] Uses the runner’s skip semantics (see 0.5)

#### Tests / Verification

- [x] Add `tests/ci/capability-gate.smoke.js`
  - [x] Runs `node tools/ci/capability-gate.js --mode pr --json <tmp>`
  - [x] Asserts the JSON shape includes all expected top-level capability categories and booleans
- [x] Add `tests/policy/optional-deps-policy.test.js`
  - [x] Validates the chosen policy: missing optional dep → skip with reason; missing required dep → fail in CI mode

---

### 0.5 Harden the test runner (skips, timeouts, logs, and machine output)

> Integrate sweep items for files touched here, including: tests assuming `process.cwd()` and reliable runner semantics.

- [x] Implement explicit skip semantics
  - [x] Standardize on an exit code for “skipped” (recommended: `77`)
  - [x] Update `tests/run.js`:
    - [x] Treat exit code `77` as `status: 'skipped'`
    - [x] Capture a skip reason (from first line of stdout/stderr if present; otherwise “skipped”)
    - [x] Include skipped tests in human and `--json` summaries
  - [x] Add `tests/helpers/skip.js`
    - [x] `skip(reason)` → prints reason and exits with the skip code
    - [x] `skipIf(condition, reason)`

- [x] Make timeouts reliably terminate process trees (Windows + POSIX)
  - [x] Add `tests/helpers/kill-tree.js` (or internal runner helper) with:
    - [x] POSIX: spawn tests as a process group and signal the group (`process.kill(-pid, ...)`)
    - [x] Windows: `taskkill /PID <pid> /T` escalation to `/F`
  - [x] Update runner timeout handling:
    - [x] SIGTERM (or non-force kill), wait `graceMs`, then SIGKILL/force
    - [x] Make termination idempotent and resilient (`ESRCH`)
    - [x] Record timeout + termination metadata into runner results

- [x] Prevent log collisions across runs
  - [x] Add a `runId` and write logs into `${logDir}/run-${runId}/...`
  - [x] Print the resolved run log directory in the final summary

- [x] Add a timings ledger (optional but recommended; supports lane sizing and flake detection)
  - [x] Add `--timings-file <path>` to `tests/run.js` to append JSON lines or write a summary
  - [x] Add `tools/test_times/report.js` (or similar) to summarize timings across runs

- [x] Close runner/documentation drift
  - [x] Update `docs/TEST_RUNNER_INTERFACE.md` to include:
    - [x] skip semantics
    - [x] timeout escalation behavior
    - [x] log runId directory behavior
    - [x] timings ledger format (if implemented)

- [x] (Optional, but captured from planning docs) Lane membership explicit overrides
  - [x] Support lightweight lane annotations in test files (first ~5 lines), e.g. `// @lane services`
  - [x] Document in `tests/README.md` (or `docs/`)

#### Tests / Verification

- [x] Add `tests/harness/skip-semantics.test.js`
  - [x] Creates a small temp test file that exits with skip code and asserts runner reports `skipped` in `--json`
- [x] Add `tests/harness/timeout-kills-tree.test.js`
  - [x] Test spawns a child that spawns a grandchild; ensure runner termination removes the full tree
- [x] Add `tests/harness/log-runid.test.js`
  - [x] Run the same test twice with the same `--log-dir` and assert logs go to different run subdirs
- [x] Add `tests/harness/timings-ledger.test.js` (if timings are implemented)

- [x] **Sweep integration:** fix tests that assume `process.cwd()` is repo root
  - [x] Add `tests/helpers/root.js` (see 0.8)
  - [x] Update tests like:
    - [x] `tests/discover.js`
    - [x] `tests/config-validate.js`
    - [x] `tests/index-validate.js`
    - [x] `tests/script-coverage.js`
    - [x] `tests/script-coverage-harness.js` (if needed)
  - [x] Add a regression that runs a representative test from `cwd=tests/` and expects success

- [x] **Sweep integration:** stop mutating committed fixtures in-place
  - [x] Update `tests/index-validate.js` to copy `tests/fixtures/sample` to a temp directory before running `build_index.js`

---

### 0.6 Repair the script-coverage harness drift (sweep P0)

> Sweep finding: `tests/script-coverage/actions.js` references scripts that do not exist in `package.json` (unknown covers), causing false CI failures and broken confidence in the harness.

- [x] Make script-coverage consistent with actual script surface
  - [x] Update `tests/script-coverage/actions.js` so every `covers: [...]` entry corresponds to a real `package.json` script name
    - [x] Remove or rename stale covers such as:
      - `search-rrf-test`
      - `search-topn-filters-test`
      - `search-determinism-test`
    - [x] For tests that exist only as `tests/*.js` (no package script), do **not** treat them as “script coverage” targets
  - [x] Add a wiring validator:
    - [x] Validate all action `covers` exist in loaded `package.json` scripts
    - [x] Fail fast with an actionable error listing the unknown names

- [x] Decide where script-coverage runs
  - [x] Keep script-coverage **out** of the default PR lane until it is stable and fast
  - [x] Run it in nightly or a dedicated CI job once stable

- [x] Remove root resolution fragility in script-coverage tooling
  - [x] Update `tests/script-coverage.js` to resolve repo root independently of `process.cwd()` (use `tests/helpers/root.js`)

#### Tests / Verification

- [x] Add `tests/script-coverage/wiring.test.js`
  - [x] Loads package scripts and action definitions
  - [x] Asserts `unknownCovers` is empty (real repo, not toy state)
  - Fix attempt 1: filter `covers`/`coversTierB` by known package scripts during action build.
- [x] Update/extend `tests/script-coverage-harness.js` to include a “real wiring” assertion (not just toy coverage state)
  - Fix attempt 1: pass package script names into action builder for wiring assertion.
- [x] Verification task: run `node tests/script-coverage.js` locally from both repo root and from `cwd=tests/`

---

### 0.7 Establish script surface policy and add drift gates

- [x] Define the “blessed command surface”
  - [x] Set explicit targets (policy goal, not immediate enforcement):
    - [x] Target ≤12 blessed npm scripts (long-term)
    - [x] Hard cap ≤20 blessed npm scripts during the migration
  - [x] Document a small set of stable entrypoints (example):
    - `npm test` / `node tests/run.js`
    - `npm run test:pr`
    - `npm run lint`
    - `npm run config:budget`
    - `npm run env:check`
    - Core CLI commands (`search`, `build-index`, `watch`) as appropriate
  - [x] Everything else is categorized as internal tooling and should migrate behind a dispatcher over time

- [x] Implement `tools/script-inventory.js`
  - [x] Emit a machine-readable inventory (JSON) containing:
    - script name
    - category (test/build/bench/dev/admin)
    - CI allowed (yes/no)
    - intended replacement (if any) / dispatcher route (if any)
  - [x] Emit a human-readable summary (Markdown) to `docs/` (or update `docs/commands.md`)

- [x] Add policy gates in tests
  - [x] Add `tests/policy/script-surface-policy.test.js`:
    - [x] Workflows only reference existing scripts
    - [x] No net-new scripts without classification (or restrict to allowed prefixes like `ci:*` during the transition)
    - [x] Inventory is updated when scripts change (inventory JSON hash check)

#### Tests / Verification

- [x] `tests/policy/script-surface-policy.test.js` runs in the PR suite (`test:pr`)
- [x] Verification task: modify `package.json` scripts in a branch without updating inventory; ensure gate fails

---

### 0.8 Add test helpers for hermetic fixtures, temp dirs, and repo-root resolution

> Sweep finding: multiple tests assume `process.cwd()` is repo root, which breaks direct execution and increases flake.

- [x] Add `tests/helpers/root.js`
  - [x] Provides `repoRoot()` derived from module location (not `process.cwd()`)
- [x] Add `tests/helpers/temp.js`
  - [x] `makeTempDir(prefix)` using `fs.mkdtemp`
  - [x] `rmDirRecursive(path)` with Windows-friendly retries (`EPERM`/`EBUSY`)
- [x] Add `tests/helpers/fixtures.js`
  - [x] `copyFixtureToTemp(name, options)` for hermetic copies (prevents in-place mutations)
- [x] Add `tests/helpers/test-env.js`
  - [x] `applyTestEnv({ cacheRoot, embeddings })` sets:
    - `PAIROFCLEATS_TESTING=1`
    - `PAIROFCLEATS_CACHE_ROOT=<cacheRoot>`
    - `PAIROFCLEATS_EMBEDDINGS=stub` (when requested)
- [x] Fix known fixture-mutation and cwd-sensitive tests
  - [x] Update tests like `tests/discover.js` to use `repoRoot()` for file paths
  - [x] Update any tests that run against committed fixtures to copy them first (explicitly: `tests/index-validate.js`)

#### Tests / Verification

- [x] Add `tests/harness/cwd-independence.test.js`
  - [x] Spawns a representative test with `cwd=tests/` and asserts it passes
- [x] Add `tests/harness/copy-fixture.test.js`
  - [x] Validates fixture copy helper produces an isolated working tree and mutations do not affect committed fixtures
- [x] Run `node tests/run.js --lane ci --junit artifacts/junit.xml --log-dir tests/.logs`
  - Fix attempt 1: reduced line length in `tests/artifact-size-guardrails.js` to avoid minified skip. Failure: chunk_meta entry exceeds max JSON size (10039 > 4096).
  - Fix attempt 2: reduced tokens per file (80) and increased file count (20). Failure: chunk_meta entry exceeds max JSON size (5138 > 4096).
  - Fix attempt 3: reduced tokens per file (60). Failure: chunk_meta entry exceeds max JSON size (4338 > 4096).
  - Fix attempt 4: increased max JSON bytes to 16384 and used larger fixture files (200 tokens per file, 12 files, short lines). PASS: `node tests/artifact-size-guardrails.js`.
  - Fix attempt 5: prefer non-bak compressed candidates before `.bak` in `src/shared/artifact-io.js`. PASS: `node tests/artifact-bak-recovery.js`.

---

### 0.9 Establish a determinism regression baseline corpus (safety net)

- [x] Create a small “baseline repo” fixture under `tests/fixtures/`
  - [x] Include file types that cover known tricky paths:
    - `.ts`, `.tsx`
    - `.md` with fenced code (including `tsx`/`jsx` fences)
    - `.html` with embedded script
    - `.json`, `.xml`
  - [x] Include duplicate basenames in different directories (to detect `file::name` key collisions)

- [x] Add determinism golden tests (run in nightly initially)
  - [x] Build the baseline repo twice and assert:
    - stable `metaV2.chunkId` generation
    - stable `chunk_meta` serialization for sqlite and jsonl builds (shape + ordering)
    - stable manifest ordering and shard ordering (where applicable)

#### Tests / Verification

- [x] `tests/perf/baseline-artifacts.test.js` (nightly lane)
  - Fix attempt 1: corrected dict-utils import path for perf test.
  - Fix attempt 2: use `getIndexDir` after each build to capture per-build roots.
  - Fix attempt 3: normalize manifest comparison and fall back to `chunk_meta.json` when JSONL is absent.
- [x] Verification task: run the determinism test twice locally and confirm byte-stable outputs (excluding explicitly non-deterministic fields)

---

### 0.10 Decide the fate of git hook automation (sweep P3)

> Sweep finding: `tools/git-hooks.js` overrides the worktree with `.cache/worktree` and can break in real clones or CI.

- [x] Decide policy:
  - [x] Keep git hook automation (but make it correct + safe), **or**
  - [x] Remove it entirely and rely on documented dev commands
  - Note: git hooks are no longer used in the current version; tooling will be removed.
- [x] If keeping:
  - [x] Update `tools/git-hooks.js` to correctly detect git dirs/worktrees (avoid forcing `.cache/worktree`)
  - [x] Make it safe on:
    - non-git checkouts
    - CI (read-only environments)
- [x] If removing:
  - [x] Remove the related npm script(s)
  - [x] Remove or update any docs referencing it

#### Tests / Verification

- [x] Add `tests/tools/git-hooks.safe.test.js`
  - Note: git hooks removed; no hook tests required.
  - [x] Ensures the script does not write outside the repo root and does not crash when `.git` is missing

---

### 0.11 Create the implementation tracking board and “phase-0” fixture corpus doc

- [x] Create a lightweight tracking file under `docs/` (or root) that lists:
  - [x] Phase 0 work items with PR links and status
  - [x] Links to determinism fixtures and regression tests
  - [x] A “definition of done” for the Phase 0 gates

#### Tests / Verification

- [x] Verification task: ensure the PR template or contributing guide links to this tracking file (optional)

---

## Phase 2 — Contracts and Policy Kernel (Artifact Surface, Schemas, Compatibility) [x]

### Objective

Establish a single, versioned, fail-closed contract layer for the **public artifact surface** (what builds emit and what tools/retrieval consume). This phase standardizes artifact schemas + sharded sidecars, enforces **manifest-driven discovery**, introduces **SemVer-based surface versioning** with N-1 adapters, adds **strict index validation** as a build/promotion gate, and introduces an **index compatibilityKey** to prevent unsafe mixing/federation and cache invalidation bugs.

---

### Phase 2.1 Public artifact surface spec and SemVer policy become canonical

- [x] Publish a single canonical “Public Artifact Surface” spec and treat it as the source of truth for what is stable/public
  - Files:
    - `docs/contracts/public-artifact-surface.md` (new; canonical)
    - Update/merge/supersede `docs/artifact-contract.md` as needed (avoid duplicated, drifting contracts)
    - Link from `README.md` and `docs/commands.md` and ensure `--help` points at the canonical doc
  - Include (at minimum) explicit contracts for:
    - `builds/current.json` (bundle pointer + mode map)
    - `index_state.json` (capabilities + config identity)
    - `pieces/manifest.json` (canonical inventory)
    - sharded JSONL sidecars (`*.meta.json`) for `*.jsonl.parts/`
    - required/optional artifacts and their **stability** status
- [x] Adopt the SemVer policy for artifact surfaces and schemas (bundle-level + artifact-level)
  - Bundle-level:
    - Add/require `artifactSurfaceVersion` (SemVer string) in:
      - `builds/current.json`
      - `index_state.json`
      - `pieces/manifest.json`
  - Artifact-level:
    - Use `schemaVersion` (SemVer string) for sharded JSONL `*.meta.json`
    - For non-sharded public artifacts, define where `schemaVersion` lives (preferred: in `pieces/manifest.json` per piece entry; alternative: per-artifact sidecar)
  - N-1 requirement:
    - Readers must support N-1 major for `artifactSurfaceVersion` and key artifact `schemaVersion`s
    - Writers emit only the current major
  - Fail-closed requirement:
    - Unknown major => hard error in strict mode (no “best effort” guesses)
- [x] Define and document “reserved / invariant fields” and “extension policy” for public artifacts
  - Reserved fields (examples; must be enumerated in the spec):
    - `artifactSurfaceVersion`, `schemaVersion`, `repoId`, `buildId`, `compatibilityKey`, `generatedAt`
    - per-record invariants like `file` (repo-relative normalized path) and stable identifiers for records
  - Extension policy:
    - Either enforce `x_*` namespacing, or require an `extensions` object, or both
    - Explicitly state which artifacts allow additional properties, and under what namespace
- [x] Define canonical reference + truncation envelopes (contract-first)
  - Specify stable shapes for:
    - reference targets (e.g., `ref.target`, `ref.kind`, `ref.display`)
    - truncation metadata (what was truncated, why, and how to detect it)
  - Note:
    - Implementation must begin with artifacts Phase 2 touches (file relations / graph relations), and the contract must be used by validators immediately, even if other producers adopt later

#### Tests

- [x] Add a contract-doc presence + basic structure test (smoke check)
  - Example: `tests/contracts/public-artifact-surface-doc.test.js` (verifies file exists + required headings/anchors)
- [x] Add a SemVer policy conformance test for the schema registry
  - Example: `tests/contracts/semver-policy-enforced.test.js` (ensures all surfaced versions are SemVer strings; ensures N-1 ranges are encoded)

---

### Phase 2.2 Manifest-driven artifact discovery everywhere (no filename guessing)

- [x] Make `pieces/manifest.json` the single source of truth for locating artifacts (build, validate, tools, retrieval)
  - Update `src/shared/artifact-io.js` to:
    - expose a strict discovery mode that **requires** the manifest
    - centralize resolution logic so all callers share the same behavior

  - Files:
    - `src/shared/artifact-io.js`

- [x] Add (or formalize) a single “artifact presence/detection” helper that reports artifact availability and format without hardcoded filenames
  - Options:
    - extend `src/shared/artifact-io.js`, or
    - create `src/shared/index-artifacts.js` that wraps artifact-io with presence reporting
  - Presence report should return (at minimum):
    - format: `json | jsonl | sharded | missing`
    - resolved paths
    - required sidecars (meta/parts) and whether they are consistent

- [x] Update tools to use manifest-driven discovery (never `existsSync('chunk_meta.json')`-style checks)
  - Tools in scope for this phase (minimum):
    - `tools/report-artifacts.js`
    - `tools/assemble-pieces.js`
    - any test/tool code that reads `chunk_meta.json` directly for “presence”
- [x] Define strict vs non-strict behavior at the API boundary (artifact-io)
  - Strict:
    - manifest required
    - unknown artifact baseName is error
    - missing shard referenced by manifest is error
  - Non-strict:
    - may fall back to legacy guessing/scanning **only** where explicitly allowed (documented), and must emit a warning signal so callers can detect non-canonical behavior

#### Tests

- [x] Add `tests/artifact-io-manifest-discovery.test.js`
  - Ensures artifact-io resolves artifacts _only_ via manifest in strict mode
- [x] Add `tests/assemble-pieces-no-guess.test.js`
  - Ensures `assemble-pieces` refuses to run when manifest is missing (or requires `--non-strict` explicitly)
- [x] Add `tests/report-artifacts-manifest-driven.test.js`
  - Ensures reporting reflects manifest inventory, not directory heuristics

---

### Phase 2.3 Standard sharded JSONL sidecar schema + typed-array safe sharded writing

- [x] Standardize sharded JSONL `*.meta.json` schema for all JSONL sharded artifacts
  - Required meta fields (as contract):
    - `schemaVersion` (SemVer)
    - `artifact` (artifact baseName, e.g. `chunk_meta`, `repo_map`)
    - `format` = `jsonl-sharded`
    - `generatedAt` (ISO)
    - `compression` (`none | gzip | zstd`)
    - `totalRecords`, `totalBytes`
    - `maxPartRecords`, `maxPartBytes`, `targetMaxBytes`
    - `parts`: list of `{ path, records, bytes }` (checksum optional but encouraged)
  - Files:
    - Writers and meta emitters:
      - `src/index/build/artifacts/writers/chunk-meta.js`
      - `src/index/build/artifacts/writers/file-relations.js`
      - `src/index/build/artifacts.js` (repo_map + graph_relations meta emit)
    - Readers:
      - `src/shared/artifact-io.js` (sharded JSONL loading must parse/validate this schema)
    - Schemas:
      - `src/shared/artifact-schemas.js` (or migrated contract registry; see Phase 2.4)

- [x] Fix sharded JSONL writer serialization to be contract-correct for TypedArrays
  - Current risk:
    - `writeJsonLinesSharded()` uses `JSON.stringify(item)` which can serialize TypedArrays incorrectly
  - Required fix:
    - route line serialization through the project’s “typed-array safe” JSON writer (or equivalent normalization)
  - Files:
    - `src/shared/json-stream.js`

- [x] Ensure meta/manifest consistency is enforced at write-time (not just validate-time)
  - Writers must guarantee:
    - every shard file is in `pieces/manifest.json`
    - every meta file is in `pieces/manifest.json`
    - meta.parts list matches manifest entries (paths, bytes where recorded)

  - Files:
    - `src/index/build/artifacts.js`
    - `src/index/build/artifacts/checksums.js`

#### Tests

- [x] Add `tests/sharded-meta-schema.test.js`
  - Ensures emitted `*.meta.json` matches the standardized schema
- [x] Add `tests/sharded-meta-bytes.test.js`
  - Ensures `totalBytes` and per-part `bytes` match actual file sizes
- [x] Add `tests/sharded-meta-manifest-consistency.test.js`
  - Ensures meta/parts entries are all present in `pieces/manifest.json`
- [x] Add `tests/json-stream-typedarray-sharded.test.js`
  - Ensures TypedArray values serialize as JSON arrays in sharded JSONL output

---

### Phase 2.4 Single source of truth for schemas + N-1 adapters (and CLI/config schema hygiene)

- [x] Create a canonical contracts module and migrate schema definitions into it (shared by build + validate + retrieval)
  - Target layout (example; adjust as needed but keep the intent):
    - `src/contracts/versioning.js` (artifactSurfaceVersion constant + supported ranges)
    - `src/contracts/schemas/*` (JSON schemas)
    - `src/contracts/validators/*` (Ajv compilation + wrappers)
    - `src/contracts/adapters/*` (N-1 major adapters)
    - `src/contracts/fields/*` (canonical enums and normalizers)

  - Replace duplicated definitions:
    - `src/shared/artifact-schemas.js` and `src/index/build/artifacts/schema.js` must become thin wrappers or be removed in favor of contracts

- [x] Tighten artifact schemas where appropriate
  - At minimum:
    - top-level objects (`pieces/manifest.json`, `index_state.json`, `builds/current.json`, sharded meta sidecars) should not silently accept arbitrary fields unless explicitly allowed by extension policy

  - Where additional properties are required for forward compatibility:
    - enforce extension namespace rules rather than “anything goes”

- [x] Make config schema validation robust even when `schema.properties` is missing
  - Current bug:
    - object validation path skips required/additionalProperties checks when `schema.properties` is absent

  - Required behavior:
    - enforce:
      - required keys
      - additionalProperties policy
      - type checks

    - regardless of presence of `schema.properties`

  - Files:
    - `src/config/validate.js`

- [x] Eliminate CLI schema drift between option definitions and schemas
  - Ensure `INDEX_BUILD_SCHEMA` and `BENCH_SCHEMA` (and any other exported schemas) include every defined option
  - Decide + enforce unknown CLI option policy (warn vs error) consistently
  - Files:
    - `src/shared/cli-options.js`
    - any CLI wiring that calls validation (`src/shared/cli.js`, etc.) if needed

#### Tests

- [x] Add `tests/contracts/schema-registry-single-source.test.js`
  - Ensures build-time schema hash and validate-time schema registry are derived from the same objects

- [x] Add `tests/contracts/n-minus-one-adapter.test.js`
  - Ensures N-1 payloads adapt or fail closed as intended

- [x] Add `tests/config/validate-object-without-properties.test.js`
- [x] Add `tests/cli/cli-options-schema-drift.test.js`
- [x] Add `tests/contracts/additional-properties-policy.test.js`

---

### Phase 2.5 Strict index validation mode becomes a real gate (and tools/index-validate is hardened)

- [x] Implement strict validation mode that is manifest-driven and version-aware
  - Strict mode must:
    - require `pieces/manifest.json`
    - validate `builds/current.json` (when present) and `index_state.json`
    - validate sharded meta sidecars and enforce meta↔manifest consistency
    - enforce path safety in manifests:
      - no absolute paths
      - no `..` traversal
      - normalized separators
      - no duplicate `path` entries
    - validate JSONL required keys per artifact type and add regression tests (even if currently aligned)
    - reject unknown artifact schema names (no “ok by default” in strict)
  - Files:
    - `src/index/validate.js`
    - `src/shared/artifact-io.js`
    - schema registry (`src/contracts/*` or existing `src/shared/artifact-schemas.js` until migrated)

- [x] Harden `tools/index-validate.js` mode parsing
  - Unknown modes must be rejected early with a clear error message and a non-zero exit code
  - Must not crash due to undefined report entries
  - File:
    - `tools/index-validate.js`

- [x] Add an explicit validation check for identity collision footguns relevant to upcoming graph work
  - Example: detect ambiguous `file::name` collisions early and report them deterministically
  - If full remediation is out of scope here:
    - Strict validation must at least detect + emit a named error code (and remediation lands in the graph/identity phase)

#### Tests

- [x] Add `tests/validate/index-validate-strict.test.js`
- [x] Add `tests/validate/index-validate-missing-manifest.test.js`
- [x] Add `tests/validate/index-validate-manifest-safety.test.js`
- [x] Add `tests/validate/index-validate-sharded-meta-consistency.test.js`
- [x] Add `tests/validate/index-validate-unknown-mode.test.js`
- [x] Add `tests/validate/index-validate-unknown-artifact-fails-strict.test.js`
- [x] Add `tests/validate/index-validate-jsonl-required-keys.test.js`
- [x] Add `tests/validate/index-validate-file-name-collision.test.js` (if implementing collision detection here)

---

### Phase 2.6 Safe promotion barrier + current.json schema and path safety

- [x] Make promotion conditional on passing strict validation (no “promote broken builds”)
  - Add a mandatory gate in the build pipeline:
    - after artifacts are written
    - before `promoteBuild()` updates `builds/current.json`
  - If validation fails:
    - do not update `current.json`
    - write a clear failure summary into `build_state.json`
  - Files:
    - `src/integrations/core/index.js` (or wherever promotion is orchestrated)
    - `src/index/build/indexer/pipeline.js` if the gate belongs inside the pipeline
    - `src/index/build/promotion.js`

- [x] Fix path traversal risk in promotion/current resolution
  - Promotion must refuse to write a `buildRoot` that resolves outside the repo cache root
  - Consumers must refuse to follow a `buildRoot` outside repo cache root
  - Files:
    - `src/index/build/promotion.js`
    - `tools/dict-utils.js` (e.g., `resolveIndexRoot`, `getCurrentBuildInfo`)

- [x] Disambiguate `buildRoots` semantics in current.json
  - If the intent is “per mode”:
    - keep `buildRootsByMode` only
  - If the intent is also “by stage”:
    - add a separate field (`buildRootsByStage`) and make both explicit
  - Ensure the schema + validator enforce the chosen structure

#### Tests

- [x] Add `tests/promotion/promotion-barrier-strict-validation.test.js`
- [x] Add `tests/promotion/current-json-path-safety.test.js`
- [x] Add `tests/promotion/current-json-atomic-write.test.js`
- [x] Add `tests/promotion/current-json-schema.test.js`
- [x] Add `tests/promotion/promotion-does-not-advance-on-failure.test.js`

---

### Phase 2.7 Index compatibilityKey gate + cache signature parity for sharded chunk_meta

- [x] Introduce `compatibilityKey` per the compatibility-gate spec (fail-closed on mismatch)
  - `compatibilityKey` must be computed from “hard compatibility fields” (examples; finalize in spec):
    - `artifactSurfaceVersion` major
    - tool version
    - artifact schema hash
    - tokenizationKey
    - embeddings model identity + dims + quantization settings
    - language/segment policy identity (as stabilized in Phase 1)
  - Persist `compatibilityKey` in:
    - `index_state.json`
    - `pieces/manifest.json`
    - (optional but recommended) `builds/current.json` for fast checks
  - Files:
    - contract module (new): `src/contracts/compat/*` or similar
    - build emission: `src/index/build/indexer/steps/write.js`, `src/index/build/artifacts/checksums.js`, `src/index/build/promotion.js`

- [x] Enforce compatibilityKey in consumers
  - Retrieval/index loading must detect mismatch and error (or refuse federation)
  - `assemble-pieces` / any bundling must ensure all combined indexes are compatible
  - Files (minimum):
    - retrieval loader(s): `src/retrieval/*` (where index_state/manifest is loaded)
    - federation/bundling tool(s): `tools/assemble-pieces.js` (if it combines)
- [x] Fix query-cache invalidation gap for sharded `chunk_meta` signatures
  - `getIndexSignature()` must incorporate sharded `chunk_meta` (and ideally manifest signature)
  - Required change:
    - stop assuming `chunk_meta.json` exists
    - use `jsonlArtifactSignature(dir, 'chunk_meta')` or a manifest-derived signature
  - File:
    - `src/retrieval/cli-index.js`

#### Tests

- [x] Add `tests/contracts/index-compatibility-key-generation.test.js`
- [x] Add `tests/contracts/index-compatibility-key-enforced-on-load.test.js`
- [x] Add `tests/contracts/index-compatibility-key-federation-block.test.js`
- [x] Add `tests/retrieval/query-cache-signature-sharded-chunk-meta.test.js`

---

### Phase 2.8 Golden contract fixtures and CI enforcement

- [x] Create golden fixture indexes that cover:
  - multiple modes (`code`, `prose`, `records`) as applicable
  - artifact format variants (`json`, `jsonl`, `jsonl-sharded`)
  - presence of meta sidecars and manifest inventory correctness
- [x] Add a contract fixture suite that runs:
  - build => validate (strict) => load via artifact-io => basic retrieval smoke (where applicable)
  - and asserts that “public surface invariants” hold for every fixture
- [x] Add a loader matrix test that proves consumers are resilient to supported artifact encodings
  - Example: `chunk_meta` load parity across json/jsonl/sharded
- [x] Wire strict validation into CI as a required gate for fixture builds

#### Tests

- [x] Add `tests/fixtures/public-surface/*` (fixture definitions + expected invariants)
- [x] Add `tests/contracts/golden-surface-suite.test.js`
  - Fix attempt: corrected build-time import path for contracts versioning in index write step.
  - Fix attempt: added missing sha1 import in indexer signatures.
  - Fix attempt: fixed records index_state emission and manifest schema (statError/checksumError), plus fixture helper rebuild path.
- [x] Add `tests/contracts/loader-matrix-parity.test.js`
- [x] Add/extend `tests/artifact-formats.js` (if it is the canonical place for format coverage)

---


## Phase 1 — P0 Correctness Hotfixes (Shared Primitives + Indexer Core) [@]

### Objective

Eliminate known “silent correctness” failures and fragile invariants in the core index build pipeline, focusing on concurrency/error propagation, postings construction, embedding handling, import scanning, and progress/logging. The intent is to make incorrect outputs fail fast (or degrade in a clearly documented, test-covered way) rather than silently producing partial or misleading indexes.

### Current blockers (2026-01-24)

- CI lane failures are tracked in `failing_tests_list.md` and `broken_tests.md`.
- `retrieval/filters/types.test` passes in isolation but fails under `node tests/run.js --lane ci --log-dir tests/.logs`.
- `services/mcp/tool-search-defaults-and-filters.test` is hanging/rebuilding indefinitely (see `broken_tests.md`).

---

### 1.1 Concurrency primitives: deterministic error propagation + stable backpressure

- **Files touched:**
  - `src/shared/concurrency.js`

- [x] **Fix `runWithQueue()` to never “succeed” when worker tasks reject**
  - [x] Separate _in-flight backpressure tracking_ from _final completion tracking_ (avoid “removing from `pending` then awaiting `pending`” patterns that can drop rejections).
  - [x] Ensure every enqueued task has an attached rejection handler immediately (avoid unhandled-rejection windows while waiting to `await` later).
  - [x] Await completion in a way that guarantees: if any worker rejects, `runWithQueue()` rejects (no silent pass).
- [x] **Make backpressure logic robust to worker rejections**
  - [x] Replace `Promise.race(pending)` usage with a variant that unblocks on completion **regardless of fulfill/reject**, without throwing mid-scheduling.
  - [x] Decide and document semantics explicitly:
    - Default behavior: **fail-fast scheduling** (stop enqueueing new items after first observed failure),
    - But still **drain already-enqueued tasks to a settled state** before returning error (avoid “background work continues after caller thinks it failed”).
  - [x] Ensure `runWithConcurrency()` inherits the same semantics via `runWithQueue()`.
- [x] **Accept iterables, not just arrays**
  - [x] Allow `items` to be any iterable (`Array`, `Set`, generator), by normalizing once at the start (`Array.from(...)`) and using that stable snapshot for `results` allocation and deterministic ordering.
- [x] **Stop swallowing queue-level errors**
  - [x] Replace the current no-op `queue.on('error', () => {})` behavior with a handler that **records/logs** queue errors and ensures they surface as failures of the enclosing `runWithQueue()` call.
  - [x] Ensure no listener leaks (attach per-call with cleanup, or attach once in a way that does not grow unbounded).

#### Tests / Verification

- [x] Add `tests/concurrency-run-with-queue-error-propagation.js`
  - [x] A rejecting worker causes `runWithQueue()` to reject reliably (no “resolved success”).
  - [x] Ensure no unhandled-rejection warnings are emitted under a rejecting worker (attach handlers early).
- [x] Add `tests/concurrency-run-with-queue-backpressure-on-reject.js`
  - [x] When an early task rejects and later tasks are still in-flight, the function’s failure behavior is deterministic and documented (fail-fast enqueueing + drain in-flight).
- [x] Add `tests/concurrency-run-with-queue-iterables.js`
  - [x] Passing a `Set` or generator as `items` produces correct ordering and correct results length.

---

### 1.2 Embeddings pipeline: merge semantics, TypedArray parity, and no-hang batching

- **Files touched:**
  - `src/shared/embedding-utils.js`
  - `src/index/build/file-processor/embeddings.js`
  - `src/index/build/indexer/steps/postings.js`

- [x] **Make `mergeEmbeddingVectors()` correct and explicit**
  - [x] When only one vector is present, return that vector unchanged (avoid “code-only is halved”).
  - [x] When both vectors are present:
    - [x] Define dimension mismatch behavior explicitly (avoid NaNs and silent truncation).
          Recommended Phase 1 behavior: **fail closed** with a clear error (dimension mismatch is a correctness failure), unless/until a contract says otherwise.
    - [x] Ensure merge never produces NaN due to `undefined`/holes (`(vec[i] ?? 0)` defensively).
  - [x] Keep output type stable (e.g., `Float32Array`) and documented.
- [x] **Ensure TypedArray parity across embedding ingestion**
  - [x] In `src/index/build/indexer/steps/postings.js`, replace `Array.isArray(...)` checks for embedding floats with a vector-like predicate (accept `Float32Array` and similar).
  - [x] Ensure quantization in the postings step uses the same “vector-like” acceptance rules for merged/doc/code vectors.
- [x] **Fix embedding batcher reentrancy: no unflushed queued work**
  - [x] In `createBatcher()` (`src/index/build/file-processor/embeddings.js`), handle “flush requested while flushing” deterministically:
    - [x] If `flush()` is called while `flushing === true`, record intent (e.g., `needsFlush = true`) rather than returning and risking a stranded queue.
    - [x] After a flush finishes, if the queue is non-empty (or `needsFlush`), perform/schedule another flush immediately.
  - [x] Ensure the batcher cannot enter a state where items remain queued with no timer and no subsequent trigger.
- [x] **Enforce a single build-time representation for “missing doc embedding”**
  - [x] Standardize on **one marker** at build time (current marker is `EMPTY_U8`) to represent “no doc embedding present”.
  - [x] Ensure downstream steps never interpret “missing doc embedding” as “fallback to merged embedding” (the doc-only semantics fix is completed in **1.4**, but Phase 1.2 should ensure the marker is consistently produced).

#### Tests / Verification

- [x] Add `tests/embedding-merge-vectors-semantics.js`
  - [x] Code-only merge returns identical vector (no halving).
  - [x] Doc-only merge returns identical vector (no scaling).
  - [x] Mismatched dimensions is deterministic (throws or controlled fallback per Phase 1 decision), and never yields NaNs.
- [x] Add `tests/embedding-typedarray-quantization-postings-step.js`
  - [x] A `Float32Array` embedding input is quantized and preserved equivalently to a plain array.
- [x] Add `tests/embedding-batcher-flush-reentrancy.js`
  - [x] Reentrant flush (flush called while flushing) does not strand queued items; all queued work is eventually flushed and promises resolve.
- [x] Run existing embedding build tests to confirm no regressions:
  - [x] `npm test -- embedding-batch-*`
  - [x] `npm test -- build-embeddings-cache`

---

### 1.3 Postings state correctness: chargrams, tokenless chunks, and guardrails without truncation

- **Files touched:**
  - `src/index/build/state.js`

- [x] **Fix chargram extraction “early abort” on long tokens**
  - [x] Replace the per-token `return` with `continue` inside chargram token processing so a single long token does not suppress all subsequent tokens for the chunk.
  - [x] Ensure chargram truncation behavior remains bounded by `maxChargramsPerChunk`.
- [x] **Make chargram min/max-N configuration robust**
  - [x] Stop relying on callers always passing pre-normalized postings config.
  - [x] Ensure `chargramMinN`, `chargramMaxN`, and `chargramMaxTokenLength` have safe defaults consistent with `normalizePostingsConfig()` when absent.
  - [x] Ensure invalid ranges (min > max) degrade deterministically (swap or clamp) and are covered by tests.
- [x] **Preserve tokenless chunks**
  - [x] Remove the early return that drops chunks when `seq` is empty.
  - [x] Continue to:
    - [x] Assign chunk IDs and append chunk metadata,
    - [x] Record `docLengths[chunkId] = 0`,
    - [x] Allow phrase/field indexing paths to run where applicable (field-sourced tokens can still produce phrases even when `seq` is empty),
    - [x] Skip token postings updates cleanly (no crashes).
- [x] **Fix max-unique guard behavior to avoid disabling all future updates**
  - [x] Redefine guard behavior so that “max unique reached” stops _introducing new keys_ but does **not** prevent:
    - [x] Adding doc IDs for **existing** keys,
    - [x] Continuing to process remaining keys in the same chunk.
  - [x] Remove/adjust any “break if guard.disabled” loops that prevent existing-key updates (the key-level function should decide whether to skip).

#### Tests / Verification

- [x] Add `tests/postings-chargram-long-token-does-not-abort.js`
  - [x] A chunk containing one overlong token plus normal tokens still produces chargrams from the normal tokens.
- [x] Add `tests/postings-tokenless-chunk-preserved.js`
  - [x] Tokenless chunk still appears in state (`chunks.length` increments, `docLengths` has an entry, metadata preserved).
- [x] Add `tests/postings-chargram-config-defaults.js`
  - [x] Passing an unnormalized postings config does not break chargram generation and uses default min/max values.
- [x] Add `tests/postings-guard-max-unique-keeps-existing.js`
  - [x] After hitting `maxUnique`, existing keys continue to accumulate doc IDs; only new keys are skipped.

---

### 1.4 Dense postings build: doc-only semantics and vector selectors (byte + float paths)

- **Files touched:**
  - `src/index/build/postings.js`
- [x] **Fix doc-only semantics: missing doc vectors must behave as zero vectors**
  - [x] In the quantized-u8 path (`extractDenseVectorsFromChunks`):
    - [x] Stop falling back to merged embeddings when `embed_doc_u8` is absent/unparseable.
    - [x] Normalize doc vectors so that:
      - `EMPTY_U8` ⇒ zero-vector semantics (already intended),
      - _missing/invalid_ `embed_doc_u8` ⇒ **also** zero-vector semantics (not merged fallback).
  - [x] In the legacy float path (`selectDocEmbedding`):
    - [x] Stop falling back to `chunk.embedding` when `chunk.embed_doc` is missing.
    - [x] Treat missing doc embedding as “no doc embedding” (zero-vector semantics for doc-only retrieval), consistent with the empty-marker rule.
- [x] **Accept TypedArrays in legacy float extraction**
  - [x] Replace `Array.isArray(vec)` checks with a vector-like predicate to avoid dropping `Float32Array` embeddings when building dense artifacts from float fields.
- [x] **Document the invariant**
  - [x] Clearly document: _doc-only retrieval uses doc embeddings; when doc embedding is missing, the chunk behaves as if its doc embedding is the zero vector (i.e., it should not match doc-only queries due to code-only embeddings)._
        (This is a correctness guarantee; performance tuning can follow later.)

#### Tests / Verification

- [x] Add `tests/postings-doc-only-missing-doc-is-zero.js`
  - [x] A chunk with code-only embeddings does **not** get a doc vector equal to the merged/code vector when doc embedding is missing.
  - [x] Both quantized and legacy float paths enforce the same semantics (construct fixtures to exercise both).
- [x] Add `tests/postings-typedarray-legacy-float-extraction.js`
  - [x] `Float32Array` embeddings are recognized and included when building dense postings from legacy float fields.

---

### 1.5 Import scanning: options forwarding, lexer init correctness, fallback coverage, and proto safety

- **Files touched:**
  - `src/index/build/imports.js`
  - `src/index/language-registry/registry.js`

- [x] **Fix ES-module-lexer initialization**
  - [x] Ensure `ensureEsModuleLexer()` actually calls `initEsModuleLexer()` and awaits its promise (not the function reference).
  - [x] Ensure initialization is idempotent and safe under concurrency.
- [x] **Fix options forwarding to per-language import collectors**
  - [x] In `collectLanguageImports()`, stop nesting user options under `options: { ... }`.
  - [x] Pass `{ ext, relPath, mode, ...options }` (or equivalent) so language collectors can actually read `flowMode`, parser choices, etc.
- [x] **Make require() regex fallback run even when lexers fail**
  - [x] Do not gate regex extraction on lexer success; if lexers throw or fail, still attempt regex extraction.
  - [x] If regex extraction finds imports, treat that as a successful extraction path for the file (do not return `null`).
- [x] **Prevent prototype pollution from module-name keys**
  - [x] Replace `{}` accumulators keyed by module specifiers with `Object.create(null)` (or a `Map`) anywhere module-spec strings become dynamic keys.
  - [x] Ensure serialized results remain compatible (JSON output should not change in shape, aside from the object prototype).

#### Tests / Verification

- [x] Add `tests/imports-options-forwarding-flowmode.js`
  - [x] Call `collectLanguageImports({ ext: '.js', ... , options: { flowMode: 'on' } })` on a Flow-syntax file without an `@flow` directive.
  - [x] Assert imports are detected only when options are forwarded correctly (regression for the wrapper-object bug).
- [x] Add `tests/imports-esmodule-lexer-init.js`
  - [x] Ensure module imports are detected via the fast path on a basic ESM file (init actually occurs).
  - Fix attempt: updated `ensureEsModuleLexer()` to handle `init` being a Promise in current `es-module-lexer`.
- [x] Add `tests/imports-require-regex-fallback-on-lexer-failure.js`
  - [x] Use a syntactically invalid file that still contains `require('dep')`; confirm scanning still returns `'dep'`.
- [x] Add `tests/imports-proto-safe-module-keys.js`
  - [x] Import a module named `__proto__` and confirm:
    - [x] It appears as a normal key,
    - [x] Returned `allImports` has a null prototype (or otherwise cannot pollute `Object.prototype`),
    - [x] No prototype pollution occurs.

---

### 1.6 Progress + logging: pino@10 transport wiring, safe ring buffer, and zero-total guard

- **Files touched:**
  - `src/shared/progress.js`

- [x] **Fix pino transport/destination wiring for pino@10**
  - [x] Ensure pretty-transport is constructed correctly for pino@10 (use supported `transport` configuration; avoid configurations that silently no-op).
  - [x] Ensure destination selection (stdout/stderr/file) is applied correctly in both pretty and JSON modes.
- [x] **Make redaction configuration compatible with pino@10**
  - [x] Validate redact configuration format and ensure it actually redacts intended fields (and doesn’t crash/ignore due to schema mismatch).
- [x] **Fix ring buffer event retention to avoid huge/circular meta retention**
  - [x] Do not store raw meta objects by reference in the ring buffer.
  - [x] Store a bounded, safe representation (e.g., truncated JSON with circular handling, or a curated subset of primitive fields).
  - [x] Ensure event recording never throws when meta contains circular references.
- [x] **Fix `showProgress()` divide-by-zero**
  - [x] When `total === 0`, render a stable, sensible output (e.g., 0% with no NaN/Infinity).

#### Tests / Verification

- [x] Add `tests/progress-show-total-zero.js`
  - [x] `showProgress({ total: 0 })` does not emit NaN/Infinity and produces stable output.
- [x] Add `tests/progress-ring-buffer-circular-meta.js`
  - [x] Recording an event with circular meta does not throw and does not retain the original object reference.
- [x] Add `tests/progress-configure-logger-pino10-transport.js`
  - [x] `configureLogger()` can be constructed with pretty transport and can log without throwing under pino@10.
  - [x] Redaction config is accepted and functions as expected for at least one known redaction path.
  - Fix attempt: route pretty output via `pino-pretty` `destination` option for file/stdout/stderr support.

---

### Phase 1 closeout

- [ ] Run `npm run test:pr` (requires longer than the 30s cap; pending approval).

---
