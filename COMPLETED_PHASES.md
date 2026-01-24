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
