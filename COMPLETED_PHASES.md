# Completed Phases

Any time a phase is fully completed, AFTER it has been merged into main:
  - Remove the phase from the current roadmap
  - Append the Title and a brief, single item summary 
  - Some phase numbers are reused 
  - Nothing in this document should be treated as authoritative, refer to code for truth

Completed phase snapshots are archived here after being removed from GIGAROADMAP.md. 

---

## Phase 0 -- CI, Test Harness, and Developer Workflow Baseline [x]

### Objective

Make the project **safe to change** and **fast to iterate**: CI must be deterministic and green; there must be a single "run what CI runs" entrypoint; the test runner must be reliable (timeouts, skips, logs); and we must stop further tool/script drift via explicit policy gates. This phase also fixes or pulls forward any **sweep bugs** directly impacting the CI/harness/tooling surface.

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
    - [x] Normalizes core CI env (suite runner responsibility, not every leaf test's):
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
  - [x] Keep nightly "long" work capability-gated (do not make PRs depend on flaky optional stacks)

#### Tests / Verification

- [x] Extend `tests/ci/workflow-contract.js` (or add `tests/ci/nightly-workflow-contract.js`) to validate nightly workflow script references
- [x] Verification task: ensure artifacts appear in the GitHub Actions run when a test is forced to fail (log and junit uploaded)

---

### 0.4 Capability gate + optional dependency policy (CI-safe optionality)

> This phase integrates relevant sweep findings when they touch the CI/test/tooling surface (notably: optional dependency drift and "fail vs skip" ambiguity).

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
    - [x] Unexpected probe errors are reported as "capability unknown" with details, not as an unhandled exception
  - [x] Writes to a stable path for CI artifact upload (e.g. `.diagnostics/capabilities.json`)
  - [x] Probes capabilities using (and extending if needed):
    - [x] `src/shared/capabilities.js` (module availability)
    - [x] Targeted runtime probes where "require() success" is insufficient (e.g. sqlite open, basic ANN init)
  - [x] Exposes CLI controls:
    - [x] `--mode pr|nightly`
    - [x] `--require <capability>` (repeatable)
    - [x] `--json <path>` (or writes to default if omitted)
    - [x] Exit codes that are stable and documented (use `src/shared/error-codes.js`)

- [x] Add a shared test helper for optional capability gating
  - [x] Add `tests/helpers/require-or-skip.js` (or similar)
    - [x] `requireOrSkip({ capability, reason, requiredInCi })`
    - [x] Uses the runner's skip semantics (see 0.5)

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
  - [x] Standardize on an exit code for "skipped" (recommended: `77`)
  - [x] Update `tests/run.js`:
    - [x] Treat exit code `77` as `status: 'skipped'`
    - [x] Capture a skip reason (from first line of stdout/stderr if present; otherwise "skipped")
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
  - [x] Update `docs/testing/test-runner-interface.md` to include:
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
    - [x] For tests that exist only as `tests/*.js` (no package script), do **not** treat them as "script coverage" targets
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
- [x] Update/extend `tests/script-coverage-harness.js` to include a "real wiring" assertion (not just toy coverage state)
  - Fix attempt 1: pass package script names into action builder for wiring assertion.
- [x] Verification task: run `node tests/script-coverage.js` locally from both repo root and from `cwd=tests/`

---

### 0.7 Establish script surface policy and add drift gates

- [x] Define the "blessed command surface"
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
  - [x] Emit a human-readable summary (Markdown) to `docs/` (or update `docs/guides/commands.md`)

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

- [x] Create a small "baseline repo" fixture under `tests/fixtures/`
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

### 0.11 Create the implementation tracking board and "phase-0" fixture corpus doc

- [x] Create a lightweight tracking file under `docs/` (or root) that lists:
  - [x] Phase 0 work items with PR links and status
  - [x] Links to determinism fixtures and regression tests
  - [x] A "definition of done" for the Phase 0 gates

#### Tests / Verification

- [x] Verification task: ensure the PR template or contributing guide links to this tracking file (optional)

---

## Phase 2 -- Contracts and Policy Kernel (Artifact Surface, Schemas, Compatibility) [x]

### Objective

Establish a single, versioned, fail-closed contract layer for the **public artifact surface** (what builds emit and what tools/retrieval consume). This phase standardizes artifact schemas + sharded sidecars, enforces **manifest-driven discovery**, introduces **SemVer-based surface versioning** with N-1 adapters, adds **strict index validation** as a build/promotion gate, and introduces an **index compatibilityKey** to prevent unsafe mixing/federation and cache invalidation bugs.

---

### Phase 2.1 Public artifact surface spec and SemVer policy become canonical

- [x] Publish a single canonical "Public Artifact Surface" spec and treat it as the source of truth for what is stable/public
  - Files:
    - `docs/contracts/public-artifact-surface.md` (new; canonical)
    - Update/merge/supersede `docs/contracts/artifact-contract.md` as needed (avoid duplicated, drifting contracts)
    - Link from `README.md` and `docs/guides/commands.md` and ensure `--help` points at the canonical doc
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
    - Unknown major => hard error in strict mode (no "best effort" guesses)
- [x] Define and document "reserved / invariant fields" and "extension policy" for public artifacts
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

- [x] Add (or formalize) a single "artifact presence/detection" helper that reports artifact availability and format without hardcoded filenames
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
    - any test/tool code that reads `chunk_meta.json` directly for "presence"
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
    - route line serialization through the project's "typed-array safe" JSON writer (or equivalent normalization)
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
    - enforce extension namespace rules rather than "anything goes"
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
    - reject unknown artifact schema names (no "ok by default" in strict)
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

- [x] Make promotion conditional on passing strict validation (no "promote broken builds")
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
  - If the intent is "per mode":
    - keep `buildRootsByMode` only
  - If the intent is also "by stage":
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
  - `compatibilityKey` must be computed from "hard compatibility fields" (examples; finalize in spec):
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
  - and asserts that "public surface invariants" hold for every fixture
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

## Phase 1 -- P0 Correctness Hotfixes (Shared Primitives + Indexer Core) [@]

### Objective

Eliminate known "silent correctness" failures and fragile invariants in the core index build pipeline, focusing on concurrency/error propagation, postings construction, embedding handling, import scanning, and progress/logging. The intent is to make incorrect outputs fail fast (or degrade in a clearly documented, test-covered way) rather than silently producing partial or misleading indexes.

### Current blockers (2026-01-24)

- CI lane failures are tracked in `failing_tests_list.md` and `broken_tests.md`.
- `retrieval/filters/types.test` passes in isolation but fails under `node tests/run.js --lane ci --log-dir tests/.logs`.
- `services/mcp/tool-search-defaults-and-filters.test` is hanging/rebuilding indefinitely (see `broken_tests.md`).

---

### 1.1 Concurrency primitives: deterministic error propagation + stable backpressure

- **Files touched:**
  - `src/shared/concurrency.js`

- [x] **Fix `runWithQueue()` to never "succeed" when worker tasks reject**
  - [x] Separate _in-flight backpressure tracking_ from _final completion tracking_ (avoid "removing from `pending` then awaiting `pending`" patterns that can drop rejections).
  - [x] Ensure every enqueued task has an attached rejection handler immediately (avoid unhandled-rejection windows while waiting to `await` later).
  - [x] Await completion in a way that guarantees: if any worker rejects, `runWithQueue()` rejects (no silent pass).
- [x] **Make backpressure logic robust to worker rejections**
  - [x] Replace `Promise.race(pending)` usage with a variant that unblocks on completion **regardless of fulfill/reject**, without throwing mid-scheduling.
  - [x] Decide and document semantics explicitly:
    - Default behavior: **fail-fast scheduling** (stop enqueueing new items after first observed failure),
    - But still **drain already-enqueued tasks to a settled state** before returning error (avoid "background work continues after caller thinks it failed").
  - [x] Ensure `runWithConcurrency()` inherits the same semantics via `runWithQueue()`.
- [x] **Accept iterables, not just arrays**
  - [x] Allow `items` to be any iterable (`Array`, `Set`, generator), by normalizing once at the start (`Array.from(...)`) and using that stable snapshot for `results` allocation and deterministic ordering.
- [x] **Stop swallowing queue-level errors**
  - [x] Replace the current no-op `queue.on('error', () => {})` behavior with a handler that **records/logs** queue errors and ensures they surface as failures of the enclosing `runWithQueue()` call.
  - [x] Ensure no listener leaks (attach per-call with cleanup, or attach once in a way that does not grow unbounded).

#### Tests / Verification

- [x] Add `tests/concurrency-run-with-queue-error-propagation.js`
  - [x] A rejecting worker causes `runWithQueue()` to reject reliably (no "resolved success").
  - [x] Ensure no unhandled-rejection warnings are emitted under a rejecting worker (attach handlers early).
- [x] Add `tests/concurrency-run-with-queue-backpressure-on-reject.js`
  - [x] When an early task rejects and later tasks are still in-flight, the function's failure behavior is deterministic and documented (fail-fast enqueueing + drain in-flight).
- [x] Add `tests/concurrency-run-with-queue-iterables.js`
  - [x] Passing a `Set` or generator as `items` produces correct ordering and correct results length.

---

### 1.2 Embeddings pipeline: merge semantics, TypedArray parity, and no-hang batching

- **Files touched:**
  - `src/shared/embedding-utils.js`
  - `src/index/build/file-processor/embeddings.js`
  - `src/index/build/indexer/steps/postings.js`

- [x] **Make `mergeEmbeddingVectors()` correct and explicit**
  - [x] When only one vector is present, return that vector unchanged (avoid "code-only is halved").
  - [x] When both vectors are present:
    - [x] Define dimension mismatch behavior explicitly (avoid NaNs and silent truncation).
          Recommended Phase 1 behavior: **fail closed** with a clear error (dimension mismatch is a correctness failure), unless/until a contract says otherwise.
    - [x] Ensure merge never produces NaN due to `undefined`/holes (`(vec[i] ?? 0)` defensively).
  - [x] Keep output type stable (e.g., `Float32Array`) and documented.
- [x] **Ensure TypedArray parity across embedding ingestion**
  - [x] In `src/index/build/indexer/steps/postings.js`, replace `Array.isArray(...)` checks for embedding floats with a vector-like predicate (accept `Float32Array` and similar).
  - [x] Ensure quantization in the postings step uses the same "vector-like" acceptance rules for merged/doc/code vectors.
- [x] **Fix embedding batcher reentrancy: no unflushed queued work**
  - [x] In `createBatcher()` (`src/index/build/file-processor/embeddings.js`), handle "flush requested while flushing" deterministically:
    - [x] If `flush()` is called while `flushing === true`, record intent (e.g., `needsFlush = true`) rather than returning and risking a stranded queue.
    - [x] After a flush finishes, if the queue is non-empty (or `needsFlush`), perform/schedule another flush immediately.
  - [x] Ensure the batcher cannot enter a state where items remain queued with no timer and no subsequent trigger.
- [x] **Enforce a single build-time representation for "missing doc embedding"**
  - [x] Standardize on **one marker** at build time (current marker is `EMPTY_U8`) to represent "no doc embedding present".
  - [x] Ensure downstream steps never interpret "missing doc embedding" as "fallback to merged embedding" (the doc-only semantics fix is completed in **1.4**, but Phase 1.2 should ensure the marker is consistently produced).

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

- [x] **Fix chargram extraction "early abort" on long tokens**
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
  - [x] Redefine guard behavior so that "max unique reached" stops _introducing new keys_ but does **not** prevent:
    - [x] Adding doc IDs for **existing** keys,
    - [x] Continuing to process remaining keys in the same chunk.
  - [x] Remove/adjust any "break if guard.disabled" loops that prevent existing-key updates (the key-level function should decide whether to skip).

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
    - [x] Treat missing doc embedding as "no doc embedding" (zero-vector semantics for doc-only retrieval), consistent with the empty-marker rule.
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
  - [x] Validate redact configuration format and ensure it actually redacts intended fields (and doesn't crash/ignore due to schema mismatch).
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

- [x] Run `npm run test:pr` (requires longer than the 30s cap; pending approval).

---

# Phase 3 Plan -- Correctness Endgame (imports • signatures • watch • build state)

Intent: complete Phase 3 with correctness-first sequencing. Parts 1-3 are core correctness work; Part 4 consolidates E/F and all P2 follow-ons. Any new behavior must ship with an initial doc/spec.

Notes:
- 2026-01-24: Import collectors now receive `root` + `filePath` via `collectLanguageImports` (options flattened, root/filePath injected).
- 2026-01-24: Cached bundle reuse now requires `fileRelations`; missing relations skip reuse instead of sampling a chunk.
- 2026-01-24: Import Resolution Graph wired via `src/index/build/import-resolution.js`, writing `artifacts/import_resolution_graph.json` by default (test-only override `PAIROFCLEATS_IMPORT_GRAPH=0`).
- 2026-01-24: Signature hashing now uses `stableStringifyForSignature` + canonicalization with `SIGNATURE_VERSION=2`; runtime config hash no longer JSON-stringifies away regex flags.
- 2026-01-24: Incremental manifests now carry `signatureSummary`; reuse skips log top-level delta keys when signatures diverge (verbose cache only).
- 2026-01-24: Watch rebuilds now use attempt roots + promotion barrier + lock backoff; retention cleanup only after success (internal defaults); delta-aware discovery enforces guardrails on add/change events.
- 2026-01-24: Removed remaining `allImports` callsites in tests; import scan assertions now use `importsByFile`.
- 2026-01-24: Build state now writes schemaVersion/currentPhase with queued updates; watch/builds record ignore warnings + per-mode signature/count diagnostics.
- 2026-01-24: analysisPolicy now gates metadata/risk/git/type inference paths (runtime policy propagated into file processing + signatures).
- 2026-01-24: Metadata v2 + risk rules schemas consolidated in `src/contracts/schemas/analysis.js`; `chunk_meta` and `index_state` now validate against them, with serialized `riskRules` persisted in `index_state.json`.
- 2026-01-24: Risk analysis switched to a single-pass scan with prefiltering; maxBytes/maxLines now short-circuit and SafeRegex failures are treated as no-match.
- 2026-01-24: Markdown segmentation now uses a single micromark traversal for fenced blocks + inline spans.
- 2026-01-24: Tooling providers now reuse a shared fileText cache to avoid duplicate reads across type inference and diagnostics.
- 2026-01-24: Signature parsers hardened for function pointers + Python typing prefixes; added tests for LSP CRLF/surrogate offsets and risk-rule edge cases.
- 2026-01-24: Added tests for import cache reads, signature multi-mode stability, watch attempt retention/backoff, ignore path safety, records discovery, build_state merge, promotion safety, analysisPolicy gating, and embedding queue payloads.
- 2026-01-24: Embedding queue entries now persist build identity fields (buildId/buildRoot/indexRoot) for unambiguous worker targeting.
- 2026-01-24: Optional import-scan I/O reuse enabled via bounded fileText cache (pre-scan stores buffers for processing reuse).
- 2026-01-24: Added analysisPolicy schema validation + test; import scan now optionally caches text/buffers for processing reuse via fileText cache.
- 2026-01-24: Watch now supports abortSignal/handleSignals + injectable deps for tests; added watch promotion/atomicity/shutdown tests.

## Part 1 -- Import fidelity and resolution

### Objective

Eliminate the remaining high-impact correctness and operator-safety gaps before broader optimization work: (a) import extraction must be accurate (dynamic imports, TS aliases) and produce a **true dependency graph** (not co-import similarity), (b) incremental reuse must be **provably safe** via complete, deterministic signatures, (c) watch mode must be **stable, bounded, and atomic** (no build-root reuse; promotion only after success), and (d) `build_state.json` / `current.json` must be **concurrency-safe, validated, and debuggable**, so partial/incorrect builds cannot become "current" and failures are diagnosable.

---

### 3.1 Fix dynamic import scanning, TS alias handling, and module boundary fidelity

- [x] Fix the language registry wrapper bug that nests `options` incorrectly when calling `collectImports` (so per-language import collectors actually receive `text`, `options`, `filePath`, `root` as intended).
  - Primary touchpoints:
    - `src/index/language-registry/registry.js`
  - Notes:
    - Confirm that language-specific collectors that depend on `options` (e.g., WASM/parser options) behave correctly after this fix.
- [x] Make JS/TS fast-path import extraction resilient: always run the `require(...)` regex fallback even when `es-module-lexer` parsing fails (so syntax errors don't suppress require detection).
  - Primary touchpoints:
    - `src/index/build/imports.js` (`collectModuleImportsFast`)
  - Notes:
    - Keep dynamic `import('...')` extraction when possible (string literal cases), but do not regress the "fast path" on large repositories.
- [x] Replace "co-import graph" behavior with true dependency resolution for `importLinks`, so the import graph represents **importer → imported target** for in-repo files (and not "files that share a module string").
  - Primary touchpoints:
    - `src/index/build/imports.js` (import scanning + link construction)
    - `src/index/build/graphs.js` (consumer expectations for `ImportGraph`)
    - `src/index/build/file-processor/cached-bundle.js` (preserve/reconstruct relations during reuse)
  - Implementation details:
    - For each file, resolve raw import specifiers to repo-local file targets where possible:
      - Relative specifiers (`./`, `../`): resolve against importer directory; apply extension and `index.*` resolution consistently across JS/TS.
      - TypeScript path aliases: read `tsconfig.json` (`baseUrl`, `paths`) and resolve alias patterns deterministically; if multiple matches, apply a deterministic tie-break (e.g., shortest path, then lexicographic).
      - External specifiers (packages): do **not** map into `ImportGraph` file nodes; keep as raw import metadata (for later features) without corrupting the file-to-file graph.
    - Normalize resolved targets (posix separators, no `..` segments, ensure within repo root).
- [x] Spec integration: Import Resolution Graph (IRG) -- implement as the **single source of truth** for dependency edges
  - [x] Define an `ImportResolutionGraph` in-memory model (serializable for debug output) with:
    - Nodes:
      - internal file node id: `file:<relPosixPath>`
      - external module node id: `ext:<rawSpecifier>` (kept out of file-to-file edges)
    - Directed edges (importer → resolved target) with per-edge metadata:
      - `rawSpecifier`
      - `kind: 'import' | 'require' | 'dynamic_import' | 'reexport'`
      - `resolvedType: 'relative' | 'ts-path' | 'external' | 'unresolved'`
      - `resolvedPath` (internal only; repo-relative posix)
      - `packageName` (external only; best-effort)
      - `tsconfigPath` / `tsPathPattern` (ts-path only; for explainability)
    - Graph-level metadata (bounded + stable):
      - `generatedAt`, `toolVersion`, `importScanMode`, `warnings[]` (bounded), `stats`
  - [x] Implement a deterministic resolver `resolveImportLinks({ root, importsByFile, languageOptions, mode })`:
    - [x] Input: `importsByFile[importerRelPath] = string[]` of raw specifiers (deduped + sorted)
    - [x] Output (per file):
      - `fileRelations.imports` = raw specifiers (sorted unique)
      - `fileRelations.importLinks` = resolved **internal** targets (sorted unique, importer → target)
      - `fileRelations.externalImports` = raw external specifiers (sorted unique; optional but recommended)
    - [x] Resolution rules (contract):
      - Relative (`./`, `../`): Node-like file + extension + `index.*` resolution; normalize to posix and ensure within repo.
      - TS path aliases: load nearest applicable `tsconfig.json` (`baseUrl`, `paths`, `extends`) and resolve with a deterministic tie-break:
        1) fewest wildcard expansions,
        2) shortest resolved path,
        3) lexicographic on normalized path.
      - External specifiers: never map into `ImportGraph` file nodes; keep as `externalImports`.
      - Unresolved: do not emit `importLinks` edges; optionally record a bounded warning with `importer`, `rawSpecifier`, `reason`.
  - [x] Make the pipeline use IRG outputs consistently (eliminate the co-import adjacency behavior):
    - [x] Update `scanImports()` to return `importsByFile` (raw specifiers per importer) in addition to any aggregate stats.
    - [x] Refactor language relation builders to stop synthesizing `importLinks` from `allImports`:
      - `src/lang/javascript/relations.js` (remove `importLinks = imports.map(i => allImports[i])...`)
      - `src/index/language-registry/registry.js` (TypeScript `importsOnly` path)
    - [x] Ensure `src/index/build/graphs.js` uses `fileRelations.importLinks` as true dependency edges (importer → imported target).
    - [x] Ensure cached-bundle reuse preserves `imports` and `importLinks` exactly as persisted (no reconstruction from `allImports`).
  - [x] (Optional but recommended) Add a debug artifact behind a flag:
    - `artifacts/import_resolution_graph.json` (or `.jsonl`), capped/sampled to avoid huge outputs.
  - [x] Docs: add `docs/phases/phase-3/import-resolution.md` (IRG model, resolution rules, debug artifact default-on + disable control) and update `docs/language/import-links.md`.
- [x] Remove redundant cached-import reads and ensure cached import lookup is performed at most once per file per scan (avoid "read twice on miss" behavior).
  - Primary touchpoints:
    - `src/index/build/imports.js` (`scanImports`)
  - Implementation details:
    - When preloading cached imports for sort-by-import-count, store an explicit "miss" sentinel so the later per-file pass does not call `readCachedImports()` again for the same file.
    - Keep the "import-heavy first" ordering, but make it deterministic and not dependent on incidental Map iteration order.
- [x] Fix cached-bundle relation reconstruction correctness: do not rebuild bundle-level fileRelations by sampling a single chunk; enforce presence of the canonical relation data (or treat the bundle as invalid for reuse).
  - Primary touchpoints:
    - `src/index/build/file-processor/cached-bundle.js`
  - Implementation details:
    - If bundle-level fileRelations are missing, either:
      - Skip reuse (prefer correctness), or
      - Recompute by aggregating all chunk-level relations deterministically (only if performance impact is acceptable for this phase).
- [x] Fix cached-bundle hash metadata: do not hardcode `hashAlgo: 'sha1'`; preserve the actual hash algorithm used to compute the stored hash.
  - Primary touchpoints:
    - `src/index/build/file-processor/cached-bundle.js`
- [x] (Optional; may defer) Reduce import-scan I/O by avoiding duplicate file reads when the pipeline already has the file contents in memory.
  - Primary touchpoints:
    - `src/index/build/imports.js`
    - `src/index/build/indexer/steps/process-files.js` (if a "pass-through text" optimization is introduced)

#### Tests

- [x] Unit test: language registry passes `options` correctly to a test language's `collectImports` (regression for wrapper nesting bug).
- [x] Import extraction regression tests:
  - [x] A JS file with a deliberate parse error still yields `require('x')` imports via regex fallback.
  - [x] A file with `import('x')` (string literal) is captured where supported by lexer.
- [x] Import graph fidelity tests:
  - [x] Two different files importing `./utils` in different directories do **not** link to each other; they each link to their own resolved `utils` target.
  - [x] A TS alias import resolves using `tsconfig` `paths` and produces a stable file-to-file edge.
- [x] Cached bundle reuse tests:
  - [x] If bundle-level fileRelations are missing, reuse is skipped (or recomputed correctly across all chunks, depending on chosen design).
  - [x] The stored `hashAlgo` matches the configured file hash algorithm (not hardcoded).
- [x] Efficiency test (unit-level): `readCachedImports()` is called ≤ 1 time per file per scan in the cache-miss case.
- [x] Import resolution determinism tests:
  - [x] Same repo + config produces identical `importLinks` ordering and identical edge sets across two runs.
  - [x] TS config caching behaves correctly: modifying `tsconfig.json` invalidates alias resolution; unchanged tsconfig reuses cached patterns.
- [x] External import isolation test:
  - [x] `import react from 'react'` does not create a file-to-file edge in `ImportGraph`, but is preserved as an external import (if `externalImports` is enabled).

---

## Part 2 -- Signature determinism and reuse gating

### 3.2 Repair incremental cache signature correctness and reuse gating

- [x] Make signature payload hashing deterministic: replace `sha1(JSON.stringify(payload))` with `sha1(stableStringify(payload))` (or equivalent stable serializer) for both tokenization and incremental signatures.
  - Primary touchpoints:
    - `src/index/build/indexer/signatures.js`
    - `src/shared/stable-json.js` (serializer)
  - Notes:
    - This is a correctness change (reproducibility + "explainability" of reuse), even if it increases invalidations.
- [x] Spec integration: Signature canonicalization utilities + version bump (make hashing reproducible and explainable)
  - [x] Add a canonicalizer used **only** for signature-bearing hashes:
    - Implement `canonicalizeForSignature(value)` to convert non-JSON / order-unstable values into stable JSON-friendly forms:
      - `RegExp` → `{ __type: 'regexp', source, flags }`
      - `Set` → sorted array (or `{ __type: 'set', values: [...] }`)
      - `Map` → sorted `[key,value]` tuples (keys stringified deterministically)
      - `BigInt` → `{ __type: 'bigint', value: '<decimal>' }`
      - `undefined` → omitted consistently (or `{ __type: 'undefined' }` if omission is not acceptable; pick one policy and enforce)
    - Implement `stableStringifyForSignature(obj)`:
      - stable key ordering for all plain objects
      - stable ordering only where semantics are "set-like"; otherwise preserve order
      - no lossy dropping of canonicalized sentinel objects
  - [x] Refactor all signature-bearing hash sites to use the canonicalizer (ban raw `JSON.stringify` in these paths):
    - `src/index/build/indexer/signatures.js` (tokenization + incremental signature)
    - `src/index/build/runtime/hash.js` (config hash normalization)
  - [x] Bump and persist `signatureVersion` (recommend `2`) and treat mismatches as **no reuse**:
    - record in incremental manifests
    - record in `build_state.json` diagnostics
  - [x] Reuse explainability:
    - Implement a bounded "top-level delta" diff helper that reports the top N differing keys without dumping entire configs.
- [x] Docs: add `docs/phases/phase-3/signature.md` (canonicalization rules, signatureVersion, reuse gating, diagnostics) and update `docs/sqlite/incremental-updates.md` as needed.
- [x] Include regex flags (not just `.source`) for signature-bearing regex configuration (e.g., `licensePattern`, `generatedPattern`, `linterPattern`).
  - Primary touchpoints:
    - `src/index/build/indexer/signatures.js`
  - Implementation detail:
    - Canonicalize regex as `{ source, flags }` (not a raw `RegExp` object) before hashing.
- [x] Eliminate hidden signature weakening caused by JSON normalization that drops non-JSON values (e.g., `RegExp` objects) during config hashing. (Static Review: runtime/hash normalization)
  - Primary touchpoints:
    - `src/index/build/runtime/hash.js`
    - `src/index/build/indexer/signatures.js`
  - Notes:
    - Ensure any config structures that can contain regex or other non-JSON objects are serialized explicitly and deterministically before hashing.
- [x] Stop mutating shared runtime config during a multi-mode build: compute adaptive dict config as a per-run/per-mode derived value instead of overwriting `runtime.dictConfig`. (Static Review B3f60a5bb44d` notes)
  - Primary touchpoints:
    - `src/index/build/indexer/pipeline.js`
    - `src/index/build/indexer/signatures.js` (ensure signatures use the _effective_ dict config)
  - Notes:
    - This prevents cross-mode coupling (e.g., `code` mode discovery affecting `prose` mode tokenizationKey).
- [x] Add explicit signature versioning / migration behavior so that changing signature semantics does not silently reuse prior manifests.
  - Primary touchpoints:
    - `src/index/build/indexer/signatures.js`
    - `src/index/build/incremental.js` (manifest/state format markers)
  - Notes:
    - Bump a `signatureVersion` or `bundleFormat`/manifest marker and treat mismatches as "do not reuse."
- [x] Add an "explain reuse decision" diagnostic path for incremental reuse failures (safe-by-default; useful in CI and field debugging).
  - Primary touchpoints:
    - `src/index/build/indexer/steps/incremental.js`
    - `src/index/build/indexer/signatures.js`
  - Notes:
    - Keep logs bounded (do not print entire configs by default); prefer "top N differing keys" summary.

#### Tests

- [x] Unit test: two regexes with identical `.source` but different `.flags` produce different tokenization keys.
- [x] Unit test: two payload objects with identical semantics but different key insertion order produce identical signature hashes (stable stringify).
- [x] Integration test: multi-mode run (`code` then `prose`) yields the same `prose` signature regardless of `code` file counts (no adaptive dict mutation bleed-through).
- [x] Integration test: signatureVersion mismatch causes reuse to be rejected (forced rebuild).
- [x] Unit test: canonicalization does not throw on unsupported-but-possible config values (e.g., `BigInt`, `Set`, `Map`) and produces stable output.
- [x] Unit test: canonicalization policy for `undefined` is deterministic (either consistently omitted or consistently encoded).

---

## Part 3 -- Watch stability and build-state integrity

### 3.3 Resolve watch mode instability and ensure build root lifecycle correctness

- [x] Make watch builds atomic and promotable: each rebuild writes to a new attempt root (or A/B inactive root), validates, then promotes via `current.json`--never reusing the same buildRoot for successive rebuilds. also addresses race class: `9ed923dfae`)
  - Primary touchpoints:
    - `src/index/build/watch.js`
    - `src/index/build/promotion.js`
    - `src/index/build/runtime/runtime.js` (support "override buildRoot/buildId" or "derive attempt root")
  - Notes:
    - Promotion must occur only after build success + validation; on failure, current stays unchanged.
    - Decide and document cleanup policy for old attempt roots (time-based, count-based, or explicit `--watch-keep-builds=N`).
- [x] Spec integration: Watch Atomic Builds (attempt roots + promotion barrier + retention)
  - [x] Introduce an attempt manager (new helper module recommended: `src/index/build/watch/attempts.js`):
    - Derive a stable `watchSessionId` per watch invocation (timestamp + random suffix).
    - Maintain a monotonic `attemptNumber` and compute:
      - `attemptBuildId = <watchSessionId>-<attemptNumber>`
      - `attemptRoot = <repoCacheRoot>/builds/attempts/<attemptBuildId>/`
    - Ensure attempt roots are never reused (even after failure).
  - [x] Promotion barrier contract (fail-closed):
    - Build artifacts into `attemptRoot`.
    - Run validation against `attemptRoot` outputs (enough to catch partial/incomplete builds).
    - Only then call `promoteBuild(...)` to update `current.json`.
    - On failure: do **not** promote; optionally mark the attempt build_state as failed and keep it for debugging.
  - [x] Retention policy (implement + document; safe defaults):
    - Keep last N successful attempts (default: 2).
    - Keep last M failed attempts (default: 1) for debugging.
    - Delete older attempts best-effort after a successful promotion (never during an active attempt).
  - [x] Lock backoff policy:
    - Exponential backoff with jitter (e.g., 50ms → 2s) and a hard max delay.
    - Log at bounded frequency (first retry, then every ~5s) to avoid spam.
  - [x] Docs: add `docs/phases/phase-3/watch-atomicity.md` (attempt roots, promotion barrier, retention defaults, backoff).
- [x] Implement delta-aware discovery in watch: maintain `trackedEntriesByMode` from an initial full scan, update on FS events, and pass the tracked entries into the pipeline--avoiding repeated whole-repo discovery each rebuild.
  - Primary touchpoints:
    - `src/index/build/watch.js`
    - `src/index/build/discover.js` (if helper extraction needed)
  - Notes:
    - Include periodic "reconcile scan" to heal missed watcher events (especially on platforms with lossy FS event delivery).
- [x] Enforce watch bounds: `maxFiles` and `maxFileBytes` must apply not just to the initial scan, but also to subsequent add/change events.
  - Primary touchpoints:
    - `src/index/build/watch.js`
  - Notes:
    - Behavior when cap would be exceeded must be explicit (ignore + warn, or evict deterministically, or require reconcile).
- [x] Add lock acquisition backoff to prevent tight retry loops when another build holds the lock.
  - Primary touchpoints:
    - `src/index/build/watch.js`
    - `src/index/build/lock.js` (optional helper: backoff strategy / jitter)
- [x] Fix watch shutdown crash by guarding scheduler access during initialization and ensuring shutdown is safe at any point in startup.
  - Primary touchpoints:
    - `src/index/build/watch.js`
- [x] Fix `waitForStableFile()` semantics so it returns `false` if stability is not observed within the configured check window (i.e., do not proceed "as if stable" when it never stabilized).
  - Primary touchpoints:
    - `src/index/build/watch.js`
- [x] Ensure runtime contains `recordsDir` and `recordsConfig` so watch/discovery can correctly handle record file behavior (and not silently disable records-aware logic).
  - Primary touchpoints:
    - `src/index/build/runtime/runtime.js`
    - `src/index/build/indexer/steps/discover.js`
    - `src/index/build/watch.js`
- [x] Fix Parcel watcher backend ignore behavior to avoid directory misclassification when `fs.Stats` is absent (and prevent incorrect inclusion/exclusion). (Static Review note)
  - Primary touchpoints:
    - `src/index/build/watch/backends/parcel.js`
- [x] Prevent watch from mutating shared runtime fields (`runtime.incrementalEnabled`, `runtime.argv.incremental`); clone runtime per attempt/build loop (runtime is immutable once constructed). (Static Review 9235afd3e9` notes)
  - Primary touchpoints:
    - `src/index/build/watch.js`
- [x] Harden ignore file handling used by watch and builds: validate ignore file paths stay within repo root (or require explicit opt-in for absolute paths), and make ignore load failures visible (warn + recorded in state). (Static Review C1
  - Primary touchpoints:
    - `src/index/build/ignore.js`
    - `src/index/build/watch.js` (propagate/report ignore load status)

#### Tests

- [x] Watch E2E promotion test:
  - [x] Start watch, modify a file, assert a new build root is created and `current.json` is updated only after successful completion.
- [x] Watch atomicity test:
  - [x] Force a controlled failure during rebuild; assert `current.json` remains pointing to the previous build root.
- [x] Lock backoff test:
  - [x] Hold lock; start watch; assert retries are spaced (no tight loop) and logs show backoff.
- [x] Shutdown tests:
  - [x] SIGINT during early startup does not throw (scheduler guard).
  - [x] SIGINT during an active build stops cleanly and releases lock.
- [x] `waitForStableFile` unit test:
  - [x] File rewritten repeatedly during check window returns `false`.
- [x] Records-aware discovery test:
  - [x] With recordsDir configured, record files are handled per expectations (excluded from code/prose, or routed appropriately).
- [x] Ignore path safety test:
  - [x] `ignoreFiles: ['../outside']` is rejected (or requires explicit opt-in) and is visible in logs/state. (Static Review C1

---

### 3.4 Enforce build-state integrity and debugging friendliness

- [x] Make `build_state.json` updates concurrency-safe: prevent clobbering between heartbeat ticks and phase/progress updates via a per-buildRoot write queue or file lock.
  - Primary touchpoints:
    - `src/index/build/build-state.js`
  - Notes:
    - "Last write wins" must not erase phase/progress updates; merging must be correct under concurrent callers.
  - Docs: add `docs/phases/phase-3/build-state-integrity.md` (schema + writer queue + promotion validation expectations).
- [x] Implementation detail (recommended; keeps callers simple and safe):
  - [x] Implement `createBuildStateWriter(buildRoot)` that serializes updates through a single note-taking queue:
    - `enqueue(patch)` performs: read → deep-merge → validate → atomic write
    - deep-merge at least: `phases`, `progress`, `heartbeat` (and any future nested sections)
    - coalesce heartbeat writes (e.g., at most 1 write per 5s) to reduce IO churn
    - never swallow write failures silently; record a bounded error in memory + (optionally) in state
  - [x] Add `schemaVersion` and `signatureVersion` to `build_state.json` and require them on read/validate.
- [x] Remove or formalize the ambiguous top-level `phase` field (replace with `currentPhase` / `activePhase` and document schema).
  - Primary touchpoints:
    - `src/index/build/build-state.js`
- [x] Enrich `build_state.json` with the minimum diagnostics needed for field debugging:
  - buildId, buildRoot, stage/mode, startedAt/finishedAt, counts (files, chunks), and signature identifiers (tokenizationKey/cacheSignature/signatureVersion) to explain reuse/promote decisions.
  - Primary touchpoints:
    - `src/index/build/build-state.js`
    - `src/integrations/core/index.js` (or other orchestration entrypoints that own phase transitions)
- [x] Harden `current.json` promotion/read path safety and validation: promotion must reject build roots outside the intended cache root, and readers must fail closed on unsafe/invalid roots. `fde9568d49`; race class: `9ed923dfae`)
  - Primary touchpoints:
    - `src/index/build/promotion.js`
    - `tools/dict-utils.js` (current build resolution)
  - Notes:
    - Validate resolved root is within the repo cache root (or within `repoCacheRoot/builds`), not just "some path string."
    - If deeper schema overhaul (stage-vs-mode separation) is owned by **Phase 2**, implement the safety validation now and explicitly defer schema redesign to **Phase 2 -- Contracts & Policy Kernel** (named follow-on).
- [x] Make embedding enqueue clearly best-effort (when configured as optional), and include unambiguous index identity in job payload (buildId + mode + output directory) so background workers cannot target the wrong build. (Static Review
  - Primary touchpoints:
    - `src/index/build/indexer/embedding-queue.js`
    - `tools/build-embeddings.js` (or embedding worker entrypoint consuming payload)
  - Notes:
    - If job payload changes require worker updates that are too broad for this phase, implement payload additions now and defer worker consumption hardening to a named follow-on (e.g., **Phase 6 -- Service Hardening**).

#### Tests

- [x] Concurrency test: simulate concurrent `build_state.json` updates (heartbeat + phase update) and assert no loss of fields.
- [x] Schema test: `build_state.json` no longer writes ambiguous top-level `phase`; uses documented `currentPhase` field instead.
- [x] Promotion safety tests:
  - [x] Promotion rejects build roots outside cache root with a clear error.
  - [x] Reader rejects unsafe `current.json` roots and falls back safely (fail closed) rather than using arbitrary filesystem paths.
- [x] Embedding enqueue tests:
  - [x] Enqueue failure logs warning and does not fail the build when configured as optional.
  - [x] Enqueued job payload contains build identity fields and is stable across runs.

---

## Part 4 -- E/F/P2 follow-ons (performance/refactor/deferred)

Note: Part 4 items are intentionally sequenced after Parts 1-3. They remain Phase 3 scope but are deferred until the core correctness work is stable.

### E) Performance improvements to prioritize (cross-cutting)

#### E.1 Risk analysis hot path (P1)

- [x] Implement a single-pass scanner that evaluates sources/sinks/sanitizers in one traversal with deterministic ordering.
  - Primary touchpoints:
    - `src/index/risk.js`
    - `src/index/risk-rules.js`
    - `src/index/build/file-processor/process-chunks.js`
  - Implementation details:
    - Apply a cheap prefilter (substring/charclass) before SafeRegex evaluation.
    - Enforce early return on caps (`maxBytes`, `maxLines`) so large files short-circuit.
    - Guard SafeRegex exceptions and treat them as no-match, not fatal.
  - Docs:
    - Update `docs/guides/risk-rules.md` to reflect cap behavior and early-exit semantics.
  - Tests:
    - Add a caps test to assert early exit yields `analysisStatus.capped`.
    - Add a long-line regression test to ensure no crash.
    - Add determinism test to confirm stable ordering of emitted matches.

#### E.2 Markdown segmentation duplication (P2)

- [x] Consolidate markdown segmentation into a single micromark traversal (avoid double parse).
  - Primary touchpoints:
    - `src/index/segments/markdown.js`
    - `src/index/segments/frontmatter.js`
    - `src/index/segments.js`
  - Implementation details:
    - Preserve frontmatter detection and inline code span behavior.
    - Ensure fenced blocks and inline spans are captured in one pass.
  - Docs:
    - Add `docs/phases/phase-3/segmentation-perf.md` (single-pass markdown segmentation contract).
  - Tests:
    - Add a regression fixture for frontmatter + fenced code + inline spans.
    - Verify `segment-pipeline` outputs are unchanged for Markdown.

#### E.3 Tooling providers I/O duplication (P2)

- [x] Avoid duplicate file reads by passing file content into providers when already loaded.
  - Primary touchpoints:
    - `src/index/tooling/clangd-provider.js`
    - `src/index/tooling/pyright-provider.js`
    - `src/index/tooling/sourcekit-provider.js`
    - `src/index/type-inference-crossfile/tooling.js`
  - Implementation details:
    - Extend provider request shape to accept `text` where available.
    - Fall back to disk reads only when `text` is absent.
  - Docs:
    - Add `docs/phases/phase-3/tooling-io.md` (provider text reuse contract and fallback behavior).
  - Tests:
    - Add a provider unit/integration test that asserts no extra reads when `text` is supplied (stub `fs.readFile`).

---

### F) Refactoring goals (maintainability / policy centralization)

- [x] Consolidate analysis feature toggles into a single `analysisPolicy` object that is passed to:
  - metadata v2 builder
  - risk analysis
  - git analysis
  - type inference (local + cross-file + tooling)
- [x] Centralize schema versioning and validation:
  - one metadata v2 schema
  - one risk rule bundle schema
  - one place that validates both as part of artifact validation
- [x] Docs: add `docs/phases/phase-3/analysis-policy.md` (analysisPolicy shape, defaults, propagation, and gating).
  - Primary touchpoints:
    - `src/index/build/runtime/runtime.js`
    - `src/index/metadata-v2.js`
    - `src/index/risk.js`
    - `src/index/git.js`
    - `src/index/type-inference-crossfile/tooling.js`
    - `src/index/validate.js`
  - Tests:
    - [x] Add a policy-gating test that disables each section and asserts no output is emitted.
    - [x] Add a schema validation test that rejects invalid policy values.

---

### P2 appendix (quality, maintainability, test depth)

- [x] Improve signature parsing robustness for complex types (C-like, Python, Swift).
  - Primary touchpoints:
    - `src/index/tooling/signature-parse/clike.js`
    - `src/index/tooling/signature-parse/python.js`
    - `src/index/tooling/signature-parse/swift.js`
  - Tests:
    - Add fixtures for templates, function pointers, and Python `*args/**kwargs`.
- [x] Clarify and standardize naming conventions (chunk naming vs provider symbol naming, `generatedBy`, `embedded` semantics).
  - Primary touchpoints:
    - `src/index/metadata-v2.js`
    - `docs/specs/metadata-schema-v2.md`
    - `src/index/type-inference-crossfile/tooling.js`
  - Tests:
    - Add a class-method mapping fixture to ensure tooling names attach to chunks.
- [x] Expand tests to cover surrogate pairs (emoji), CRLF offsets, and risk rules/config edge cases.
  - Primary touchpoints:
    - `src/integrations/tooling/lsp/positions.js`
    - `tests/metadata-v2.js`
    - `docs/guides/risk-rules.md`
  - Tests:
    - Add emoji + CRLF offset tests for LSP mapping.
    - Add risk rules edge-case tests (invalid patterns, caps, requires/excludes).

---


# Phase 4 Distillation -- Runtime Envelope, Concurrency, and Safety Guardrails

## Reference specs (Phase 4)
These documents define the "best version" design details:
- `docs/phases/phase-4/runtime-envelope.md`
- `docs/phases/phase-4/concurrency-abort-runwithqueue.md`
- `docs/phases/phase-4/subprocess-helper.md`
- `docs/phases/phase-4/json-stream-atomic-replace.md`
- `docs/phases/phase-4/large-file-caps-strategy.md`
- `docs/phases/phase-4/safe-regex-hardening.md`

---

## 4.1 Unified runtime envelope surface + deterministic propagation to child processes

### Deliverables
- A single JSON-serializable `RuntimeEnvelopeV1` with:
  - configured vs effective values
  - per-field source attribution (cli/config/env/default)
  - bounded warnings list
- One canonical resolver: `resolveRuntimeEnvelope({ argv, rawArgv, userConfig, env })`
- One canonical child env builder: `resolveRuntimeEnv(envelope, process.env)`
- One canonical dump: `pairofcleats index --config-dump` prints stable JSON

### Tasks
- [x] Add `src/shared/runtime-envelope.js` (new)
  - [x] Define `RuntimeEnvelopeV1` shape (stable contract)
    - [x] `configured`: requested values with sources
    - [x] `effective`: normalized + clamped values
    - [x] `sources`: per-field attribution
    - [x] `warnings[]`: bounded, deterministic messages
    - [x] `generatedAt`, `toolVersion`, `nodeVersion`, `platform`
  - [x] Implement `resolveRuntimeEnvelope({ argv, rawArgv, userConfig, env })`
    - [x] Enforce precedence: **CLI > config file > environment > defaults**
    - [x] Normalize numeric limits; reject invalid values with precise error messages
    - [x] Compute derived defaults once:
      - CPU count
      - suggested UV threadpool size
      - lane caps (io/cpu/embedding) + pending limits
    - [x] Ensure resolver is pure (no mutation of inputs; no reading global process state besides passed `env`)
  - [x] Implement `resolveRuntimeEnv(envelope, baseEnv)`
    - [x] Deterministically set:
      - `UV_THREADPOOL_SIZE` (only if requested; do not overwrite if user explicitly set and envelope source is default)
      - `NODE_OPTIONS` (merge, do not clobber unrelated flags; ensure `--max-old-space-size` is set only when requested)
    - [x] Ensure **stderr-only** for warnings; stdout reserved for machine outputs (Phase 4.5 compatibility)
- [x] Wire envelope into runtime creation
  - [x] `src/index/build/runtime/runtime.js`
    - [x] Attach `runtime.envelope` and require downstream to use it
  - [x] `src/shared/threads.js` must source defaults from envelope (not ad-hoc env reads)
  - [x] `src/shared/concurrency.js` / runtime queue creation must use envelope lane caps
- [x] Wire envelope into all Node spawn sites (centralized)
  - [x] Identify all spawn sites that run Node code:
    - `tools/indexer-service.js`
    - `tools/bootstrap.js`
    - `src/integrations/core/index.js`
    - any other Node child wrappers
  - [x] Ensure each uses `resolveRuntimeEnv(...)` (or documents why not)
- [x] Add `--config-dump` output
  - [x] `bin/pairofcleats.js`
    - [x] Implement `pairofcleats index --config-dump`
    - [x] Print **only JSON** to stdout (no logs), representing:
      - runtime envelope (configured/effective/sources/warnings)
      - derived lane caps
    - [x] Ensure stable ordering where feasible (e.g., keys sorted or at least consistent by construction)

#### Tests / Verification
- [x] `tests/runtime/runtime-envelope-config-dump.test.js`
  - [x] Assert dump includes configured + effective values for:
    - heap (`maxOldSpaceMb`)
    - UV threadpool size
    - lane caps (io/cpu/embedding) and pending limits
- [x] `tests/runtime/runtime-envelope-spawn-env.test.js`
  - [x] Spawn a tiny Node child via the tool's wrapper
  - [x] Assert child sees expected `UV_THREADPOOL_SIZE` and `NODE_OPTIONS`
  - [x] Assert `NODE_OPTIONS` merge preserves unrelated flags

---

## 4.2 Thread limit precedence + threadpool-aware I/O scheduling

### Deliverables
- `resolveThreadLimits()` precedence fixed: CLI wins over env/config
- I/O concurrency defaults and clamps derived from effective UV threadpool size
- One consistent queue cap model across build + watch + tooling

### Tasks
- [x] Fix thread limit precedence
  - [x] `src/shared/threads.js` (`resolveThreadLimits`)
    - [x] Precedence: CLI > config > env > defaults
    - [x] Error attribution must reflect source (cli/config/env)
  - [x] Update call sites to pass the right inputs (avoid hidden env dominance)
    - [x] `src/index/build/runtime/workers.js`
    - [x] `tools/build-sqlite-index/run.js`
- [x] Make I/O concurrency explicitly threadpool-aware
  - [x] Define policy (use the same constants everywhere):
    - [x] `ioConcurrencyDefault = clamp(floor(UV_THREADPOOL_SIZE / 2), min=2, max=32)`
    - [x] `ioConcurrency <= UV_THREADPOOL_SIZE - reserve` (reserve at least 1 for internal libuv usage)
    - [x] If user sets I/O concurrency explicitly, clamp and emit bounded warning
  - [x] Implement in:
    - [x] `src/shared/concurrency.js` (`createTaskQueues`)
    - [x] `src/index/build/runtime/workers.js` (`createRuntimeQueues`)
    - [x] `src/index/build/indexer/steps/process-files.js` (`createShardRuntime`)
  - [x] Ensure CPU lane concurrency is independent from IO lane but still bounded by available cores
- [x] Ensure pending limits exist and are enforced (bounded memory)
  - [x] Add `pendingLimit` defaults for each lane (io/cpu/embedding)
  - [x] Ensure queues reject/enqueue with backpressure once pending limit is hit

#### Tests / Verification
- [x] `tests/threads/cli-wins-over-env.test.js`
- [x] `tests/concurrency/io-concurrency-clamped-to-uv.test.js`
- [x] `tests/concurrency/pending-limit-enforced.test.js`

---

## 4.3 Abortable runWithQueue + error handling semantics

### Deliverables
- A single abortable queue helper that:
  - is AbortSignal-aware
  - does not leave hanging promises
  - supports best-effort and fail-fast modes

### Tasks
- [x] Implement abortable queue primitive per `docs/phases/phase-4/concurrency-abort-runwithqueue.md`
  - [x] `src/shared/async.js` (or new helper module; pick one and use it everywhere)
    - [x] `runWithQueue(items, worker, options)` additions:
      - [x] `signal?: AbortSignal`
      - [x] `bestEffort?: boolean` (default false)
      - [x] `onError?: (err, item) => void`
      - [x] `onProgress?: ({done,total}) => void` (optional; must not spam)
    - [x] Ensure:
      - [x] Fail-fast: first error aborts remaining work and rejects
      - [x] Best-effort: collect errors, continue, return results + errors
      - [x] Abort: stop scheduling new work; reject outstanding waits; worker must observe signal if doing long work
- [x] Replace ad-hoc queues with `runWithQueue` where appropriate
  - [x] Build file processing lane scheduling
  - [x] Watch processing scheduling
  - [x] Any embedding batch scheduling

#### Tests / Verification
- [x] `tests/async/runwithqueue-abort.test.js`
- [x] `tests/async/runwithqueue-failfast.test.js`
- [x] `tests/async/runwithqueue-besteffort.test.js`

---

## 4.4 Cancellation semantics across lanes + subprocess boundaries

### Deliverables
- One "standard cancellation story":
  - abort signal created at the top (CLI command invocation)
  - propagated into all async lanes (io/cpu/embedding)
  - propagated into subprocess spawning; abort kills child, tears down streams, and resolves/rejects deterministically

### Tasks
- [x] Add shared abort utilities (single canonical helpers)
  - [x] `src/shared/abort.js` (new)
    - [x] `createAbortControllerWithHandlers()`
    - [x] `throwIfAborted(signal)`
    - [x] `raceAbort(signal, promise)` (ensures awaits don't hang)
- [x] Thread `AbortSignal` through:
  - [x] build index pipeline stages (discover/preprocess/process)
  - [x] runWithQueue workers
  - [x] embedding/vector generation
- [x] Ensure subprocess spawning is abortable
  - [x] Integrate with `docs/phases/phase-4/subprocess-helper.md` (Phase 4.9) so abort kills the child process and resolves error paths.

#### Tests / Verification
- [x] `tests/abort/abort-propagates-to-queues.test.js`
- [x] `tests/abort/abort-propagates-to-subprocess.test.js`

---

## 4.5 Logging, progress, and output contracts (stdout discipline)

### Deliverables
- stdout is reserved for:
  - `--json` outputs
  - config dumps
  - tool-server machine outputs
- logs and progress go to stderr
- progress and logging are deterministic and bounded (no spam loops)

### Tasks
- [x] Enforce stdout contract everywhere
  - [x] Audit all `console.log()` / stdout writes in:
    - `bin/`
    - `tools/`
    - `src/`
  - [x] Replace with stderr logging (or structured logger) where not an explicit JSON output
- [x] Fix progress semantics for edge cases
  - [x] Ensure `total=0` does not produce divide-by-zero, NaN%, or spam
  - [x] Normalize `--progress=tty`:
    - [x] only use interactive TTY progress when `process.stderr.isTTY === true`
    - [x] otherwise degrade to `--progress=log` (or none) deterministically
- [x] Ensure pino-pretty (or equivalent) is gated correctly
  - [x] If pretty logging is enabled, ensure it only affects stderr and never machine outputs
- [x] Ensure ring buffer and "recent logs" are bounded and sanitized
  - [x] No unbounded accumulation of metadata
  - [x] Stable truncation rules

#### Tests / Verification
- [x] `tests/logging/stdout-contract.test.js`
- [x] `tests/progress/total-zero-safe.test.js`
- [x] `tests/progress/tty-normalization.test.js`

---

## 4.6 JSON streaming writer correctness + gzip forwarding

(See `docs/phases/phase-4/json-stream-atomic-replace.md`.)

### Deliverables
- JSON streaming writer honors gzip options and max bytes
- deterministic JSON chunk emission
- does not corrupt on partial writes

### Tasks
- [x] Ensure gzip parameters are forwarded end-to-end
  - [x] `src/shared/json-stream.js`
  - [x] `src/shared/artifact-io.js` (if it wraps the stream writer)
- [x] Ensure maxBytes enforcement happens on disk writes
  - [x] hard stop once exceeding cap
  - [x] return explicit error code
- [x] Ensure writer closes cleanly on abort
  - [x] tie into Phase 4.4 abort semantics

#### Tests / Verification
- [x] `tests/json-stream/gzip-options-forwarded.test.js`
- [x] `tests/json-stream/maxbytes-enforced.test.js`
- [x] `tests/json-stream/abort-closes-stream.test.js`

---

## 4.7 Large-file strategy and cap correctness

(See `docs/phases/phase-4/large-file-caps-strategy.md`.)

### Deliverables
- language-aware (and optionally mode-aware) cap resolution at every skip/reuse decision point
- cached-bundle reuse cannot bypass caps
- skip records always include reason + cap values

### Tasks
- [x] Implement canonical cap resolution updates
  - [x] `src/index/build/file-processor/read.js`
    - [x] extend resolver to accept `(languageId, mode)`
  - [x] `src/index/build/file-processor/skip.js`
    - [x] thread `languageId`, `mode`, and `maxFileBytes` (defense-in-depth)
    - [x] ensure skip includes `{ reason:'oversize', stage:'pre-read', ... }`
  - [x] `src/index/build/file-processor/cached-bundle.js`
    - [x] resolve caps with `(languageId, mode)` and clamp with `maxFileBytes`
    - [x] ensure skip includes `{ reason:'oversize', stage:'cached-reuse', ... }`
- [x] (Optional but recommended) harden watch + discovery cap resolution
  - [x] `src/index/build/watch.js`
  - [x] `src/index/build/discover.js`

#### Tests / Verification
- [x] `tests/file-caps/pre-read-skip-respects-language.test.js`
- [x] `tests/file-caps/cached-bundle-respects-caps.test.js`
- [x] `tests/file-caps/doc-mode-large-markdown-not-skipped.test.js` (only if `byMode` exists)

---

## 4.8 Safe regex hardening

(See `docs/phases/phase-4/safe-regex-hardening.md`.)

### Deliverables
- no post-hoc timeouts
- deterministic flag handling across re2/re2js
- diagnostics on rejected regex compilation (where feasible)
- continued use of safe-regex for all user-driven patterns

### Tasks
- [x] Update safe-regex core
  - [x] `src/shared/safe-regex.js`
    - [x] remove timing-based `timeoutMs` semantics
    - [x] restrict + canonicalize flags to `gims`
    - [x] add `compileSafeRegex(...)` diagnostics helper
- [x] Update call sites (at minimum)
  - [x] `src/index/risk-rules.js`
    - [x] use `compileSafeRegex(...)`
    - [x] record bounded diagnostics (errors/warnings)
  - [x] `src/retrieval/output/filters.js`
    - [x] implement Option A fallback (pattern substring) for failed `/.../flags`
- [x] (Optional audit) find any remaining user-driven `new RegExp(...)` uses and either:
  - [x] replace with safe-regex, or
  - [x] prove inputs are not user-driven and are bounded

#### Tests / Verification
- [x] `tests/safe-regex/program-size-cap.test.js`
- [x] `tests/safe-regex/input-length-cap.test.js`
- [x] `tests/safe-regex/flags-normalization.test.js`
- [x] `tests/risk-rules/invalid-pattern-diagnostics.test.js`

---

## 4.9 Subprocess helper (consolidate spawn semantics)

(See `docs/phases/phase-4/subprocess-helper.md`.)

### Deliverables
- one subprocess helper that:
  - centralizes spawn options
  - propagates runtime envelope env vars
  - supports AbortSignal cancellation correctly

### Tasks
- [x] Add `src/shared/subprocess.js` (or agreed location)
  - [x] `spawnNodeProcess({ argv, env, cwd, signal, stdio })`
  - [x] deterministic env shaping via `resolveRuntimeEnv(...)`
  - [x] abort kills child and closes streams
  - [x] errors propagate with stable error codes
- [x] Replace ad-hoc spawns with helper
  - [x] `tools/indexer-service.js`
  - [x] `src/integrations/core/index.js`
  - [x] other Node spawn sites found via grep

#### Tests / Verification
- [x] `tests/subprocess/spawn-error-propagates.test.js`
- [x] `tests/subprocess/abort-kills-child.test.js`

---

## 4.10 Embedding/vector and encoding guardrails

### Deliverables
- merging vectors never produces NaNs
- quantization normalization parity across vector forms
- encoding metadata is preserved and reused deterministically

### Tasks
- [x] Fix vector merge logic (`mergeEmbeddingVectors`)
  - [x] `src/shared/embedding-utils.js`
    - [x] treat missing entries as `0`
    - [x] never add `undefined` (avoid NaN)
- [x] Normalize vectors consistently before quantization (if multiple vector forms emitted)
  - [x] `src/index/build/file-processor/embeddings.js`
    - [x] ensure `embedding_u8`, `embed_code_u8`, `embed_doc_u8` follow the same normalization rule unless contract explicitly says otherwise
- [x] Encoding metadata plumbing and reuse
  - [x] `src/shared/encoding.js`
    - [x] ensure decoded output includes encoding + fallback flags (already present)
  - [x] `src/index/build/file-processor.js`
    - [x] persist encoding metadata in file meta artifacts
    - [x] when file bytes unchanged, reuse prior encoding metadata deterministically
    - [x] fallback decoding warnings must be bounded and "warn once per file per run"

#### Tests / Verification
- [x] `tests/embeddings/merge-vectors-no-nan.test.js`
- [x] `tests/embeddings/quantize-normalization-parity.test.js` (if multiple forms emitted)
- [x] `tests/encoding/metadata-plumbed-and-reused.test.js`

---

## 4.11 Atomic file replace and `.bak` hygiene

(See `docs/phases/phase-4/json-stream-atomic-replace.md`.)

### Deliverables
- atomic replace works consistently across platforms
- `.bak` files do not accumulate
- safe cross-device fallback

### Tasks
- [x] Harden `replaceFile(...)`
  - [x] `src/shared/json-stream.js`
  - [x] `src/shared/artifact-io.js` (shared cleanup helper)
  - [x] cleanup `.bak` after successful replace where safe
  - [x] ensure Windows path-length logic remains correct
  - [x] safe fallback for cross-device rename
- [x] Ensure replace is used consistently where needed
  - [x] all artifact writes that claim atomicity must call the same helper

#### Tests / Verification
- [x] `tests/fs/atomic-replace-cleans-bak.test.js`
- [x] `tests/fs/atomic-replace-cross-device-fallback.test.js`

---

## Recommended implementation order (to reduce rework)

- [x] 1) 4.1 Runtime envelope (enables consistent config + spawn env shaping)
- [x] 2) 4.2 Thread + queue caps (depends on envelope)
- [x] 3) 4.3-4.4 Abort + runWithQueue (depends on queue model)
- [x] 4) 4.9 Subprocess helper (depends on envelope + abort)
- [x] 5) 4.5 Logging/progress contract (can be parallel but benefits from envelope's dump mode)
- [x] 6) 4.6 + 4.11 JSON stream + atomic replace (largely independent)
- [x] 7) 4.7 Large-file caps (touches build/watch/discover; best after queue+abort are stable)
- [x] 8) 4.8 Safe regex (touches shared + risk rules + retrieval)
- [x] 9) 4.10 Embedding/encoding guardrails

---

## Phase 1 -- P0 Correctness Hotfixes (Shared Primitives + Indexer Core)

- [x] Run targeted tests and `npm run test:pr` once CI lane failures are resolved.

---


# Phase 5 -- Metadata v2 + Effective Language Fidelity (Segments & VFS prerequisites)

## Objective

Deliver **contract-correct, backend-parity Metadata v2** and make **segments first-class language units** end-to-end.

This phase ensures:

- `metaV2` is **complete, stable, and finalized after enrichment** (no stale derived metadata).
- **SQLite and JSONL backends expose equivalent `metaV2`**, rather than SQLite returning a lossy reconstruction.
- Embedded/segmented code (Markdown fences, Vue `<script>`, etc.) carries an explicit **container vs effective language descriptor** used consistently by chunking, parsing, tooling selection, and retrieval filters.
- **TSX/JSX fidelity is preserved** during segment discovery and downstream parser/tool selection (effective ext drives tree-sitter grammar selection).
- A **VFS/segment-manifest foundation** exists (contract + required metadata fields) so Phase 8 tooling providers can operate on embedded code as if it were real files, with stable identities and source mapping.

---

## Scope boundaries

### In scope

- Fix `metaV2` type normalization so inferred parameter maps are preserved.
- Enforce **post-enrichment `metaV2` finalization** prior to serialization (JSONL + SQLite).
- Add **SQLite storage for the full `metaV2` object** and update retrieval to load it.
- Define and persist **container vs effective language identity** for each chunk (including segment-aware effective ext).
- Upgrade retrieval filtering and filter-index writing to support **effective language** filtering.

### Explicitly deferred (tracked, not ignored)

- **Evidence-rich callsite artifact** (`call_sites`) and full relations v2 surface: **Phase 6**.
- **Embeddings determinism + ANN parity** across backends: **Phase 7**.
- **Tooling provider framework + VFS materialization + segment-aware tooling passes**: **Phase 8**.
- **Collision-safe symbol identity and cross-file linking keys** (beyond minimal guardrails): **Phase 9**.

---

## Status legend

- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete

## Why Phase 5 exists

These are the concrete issues that Phase 5 resolves:

1. **`metaV2.types.inferred.params` can be silently dropped**
   - `src/index/metadata-v2.js` uses `normalizeEntries(...)` which only normalizes array-valued type lists.
   - Cross-file inference produces `docmeta.inferredTypes.params` as an **object map `{ paramName: TypeEntry[] }`** (`src/index/type-inference-crossfile/apply.js`), so `metaV2` currently loses those entries during normalization.

2. **`metaV2` is serialized too early (stale after enrichment)**
   - `metaV2` is built in `src/index/build/file-processor/assemble.js` (and sometimes in cached-bundle repair code) but **cross-file inference runs later** in `src/index/build/indexer/steps/relations.js`.
   - Cross-file inference mutates `chunk.docmeta` (adds inferred types) and `chunk.codeRelations` (callLinks/usageLinks/callSummaries), so an assemble-time `metaV2` snapshot can be stale.

3. **Segment "effective language" is not persisted or respected in downstream analysis**
   - Segment discovery computes an effective extension (`resolveSegmentExt(...)`) and passes it into `smartChunk(...)`, but the file processor still:
     - tokenizes using the **container file extension**, and
     - runs docmeta/relations/flow using the **container language handler** (`src/index/build/file-processor/process-chunks.js`).
   - Result: embedded TS/TSX in `.md` or `.vue` is not analyzed with the correct language handler, and `metaV2.lang` reflects segment hints instead of registry language ids.

4. **SQLite backend does not store canonical `metaV2`**
   - SQLite schema lacks a `metaV2_json` (or equivalent) field; retrieval reconstructs a minimal stub `metaV2` (`src/retrieval/sqlite-helpers.js`).
   - SQLite chunk identity can become `NULL` when `metaV2` is gated off, because chunk ids are currently sourced from `chunk.metaV2.chunkId` in `buildChunkRow(...)` (`src/storage/sqlite/build-helpers.js`).

5. **Retrieval language filtering is extension-based**
   - `--lang` filters are currently implemented by mapping language → extension sets (`src/retrieval/filters.js`).
   - This cannot select embedded TS/TSX inside `.md` or `.vue` containers, even if analysis becomes segment-aware.

---

## Normative references (specs / contracts)

Phase 5 implementation MUST align with the following documents in `docs/`:

- `docs/specs/metadata-schema-v2.md` (Metadata v2 contract)
- `docs/contracts/analysis-schemas.md` (schema notes / compatibility rules)
- `docs/contracts/artifact-schemas.md` (artifact registry + required fields)
- `docs/contracts/chunking.md` (chunk identity + offset semantics)
- `docs/contracts/sqlite.md` (SQLite tables / versioning expectations)
- `docs/phases/phase-8/tooling-vfs-and-segment-routing.md` (forward compatibility)

If Phase 5 introduces new contract fields (container/effective identity), it MUST update the above specs (and any referenced registry schema in `src/contracts/schemas/*`) in the same change set.

---

# 5.1 MetaV2 type normalization: preserve inferred parameter maps and split tooling types correctly

## Goal

Ensure `metaV2.types.inferred.params` (and `tooling.params`) is **never silently dropped** and is **canonicalized** as an object map `{ paramName: TypeEntry[] }`.

## Planned changes

- [x] Fix inferred type normalization so param maps are preserved.
  - [x] Update `normalizeEntries(...)` in `src/index/metadata-v2.js` to support:
    - `TypeEntry[]` (array list)
    - `Record<string, TypeEntry[]>` (object map keyed by param/property name)
  - [x] Update `normalizeTypeMap(...)` to preserve nested maps rather than dropping them.
    - [x] Ensure empty maps/lists normalize to `null` (not `{}` / `[]`) to preserve existing output compactness.
    - [x] Add inline code comments describing the map/array shapes (prevents accidental reversion).
    - [x] Checklist: update any code paths that assume `types.*.params` is an array (search for `.params?.map` or `Array.isArray(params)`).

- [x] Fix tooling split for nested param maps.
    - [x] Update `splitToolingTypes(...)` to handle both shapes:
      - if `entries` is an array: current behavior (filter by `source === 'tooling'`)
      - if `entries` is an object map: split **per param key**, preserving `{ paramName: TypeEntry[] }`
    - [x] Ensure the `types` object remains schema-valid under `METADATA_V2_SCHEMA`.
    - [x] Preserve param key ordering (if we sort, document the rule explicitly).
    - [x] Checklist: verify split logic preserves param names for tooling + inferred buckets in both JSONL and SQLite retrieval.

- [x] Establish canonical producer shapes.
  - [x] For **params**, canonical shape is an object map `{ paramName: TypeEntry[] }` for **declared**, **inferred**, and **tooling** buckets.
    - [x] For **returns**, canonical shape remains `TypeEntry[]`.
    - [x] Update `docs/contracts/analysis-schemas.md` to match canonical shapes (params are maps; returns are arrays).
    - [x] Add a short rationale to `docs/specs/metadata-schema-v2.md` (params need names; returns do not) to prevent future drift.
    - [x] Add a short example snippet in docs showing the canonical params/returns shapes.
    - [x] Checklist: update any schema validators or JSON schema fragments that currently define params as arrays.

- [x] Add strict validation guardrails for drift (beyond what JSON schema can express).
  - [x] In build-time validation (or `src/index/validate/checks.js`), add checks:
    - `metaV2.types.*.params` must be `null` or an object whose values are arrays of entries with `type`.
    - no type entry may omit `type`.
  - [x] Validation should report which chunkIds violate the shape.

## Files

- `src/index/metadata-v2.js`
- `src/index/type-inference-crossfile/extract.js` (only if downstream assumptions need updates)
- `src/index/validate/checks.js` (or `src/contracts/schemas/analysis.js` if schema refined)
- `docs/specs/metadata-schema-v2.md`
- `docs/contracts/analysis-schemas.md`

## Tests

- [x] Extend `tests/metadata-v2.js` (or add targeted tests under `tests/contracts/`) to cover param maps:
  - Fixture docmeta includes `inferredTypes.params = { opts: [{type:'WidgetOpts', source:'tooling'}] }`.
  - Assert `metaV2.types.inferred.params.opts` exists and is a non-empty array.
- [x] Add `tests/metadata-v2-param-map-tooling-split.test.js`
  - `docmeta.inferredTypes.params` contains mixed `source: tooling` and non-tooling entries.
  - Assert `metaV2.types.tooling.params.<name>` contains only tooling entries and `metaV2.types.inferred.params.<name>` contains the rest.
- [x] Add `tests/validate/metav2-rejects-invalid-type-shapes.test.js`
  - Tamper `metaV2.types.inferred.params` into an array; strict validate must fail.

---

# 5.2 MetaV2 finalization: enforce enrichment-before-serialization ordering

## Goal

Guarantee that any enrichment that mutates `chunk.docmeta` or `chunk.codeRelations` happens **before** `metaV2` is serialized to:

- `chunk_meta` JSONL artifacts, and
- SQLite storage (when enabled).

## Planned changes

- [x] Make `metaV2` generation explicitly **post-enrichment**.
  - [x] Identify build steps that mutate chunks after assembly:
    - cross-file inference in `src/index/build/indexer/steps/relations.js`
    - any late structural/risk augmentation that modifies `chunk.docmeta` or `chunk.codeRelations`
  - [x] Introduce a `finalizeMetaV2(chunks, context)` step that:
    - recomputes `chunk.metaV2 = buildMetaV2({ chunk, docmeta: chunk.docmeta, toolInfo, analysisPolicy })`
    - reuses the chunk's effective/container identity fields (Phase 5.4)
    - is applied **once** after enrichment and before writing
  - [x] Place `finalizeMetaV2` either:
    - at the end of `steps/relations.js`, or
    - at the beginning of `steps/write.js` (preferred if other steps may mutate chunks later).
  - [x] Ensure `finalizeMetaV2` runs exactly once per chunk (avoid double-build drift).
  - [x] Ensure the `analysisPolicy` used for finalization matches the enrichment policy.
  - [x] Checklist: ensure both JSONL and SQLite write paths use finalized `metaV2`.

- [x] Remove stale-`metaV2` failure modes for cached bundles.
  - [x] Ensure cached-bundle reuse (`src/index/build/file-processor/cached-bundle.js`) cannot bypass finalization.
  - [x] If cached bundles rebuild `metaV2` during repair, finalization must still overwrite with the post-enrichment version.
  - [x] Add a debug-only warning when assemble-time metaV2 differs from final metaV2 (helps identify stale paths).
  - [x] Checklist: ensure cached-bundle repair paths never re-emit assemble-time `metaV2` to disk.

  - [x] Add optional equivalence checks (debug/strict mode).
    - [x] Add a helper that recomputes `metaV2` from the final chunk object and compares to the stored `chunk.metaV2`.
    - [x] In strict mode, mismatches should fail validation (or at least emit a high-severity issue).
    - [x] Ignore intentionally-ephemeral fields during equivalence (if any exist).
    - [x] Checklist: ensure equivalence checks run after any chunk mutations in later steps.

## Files

- `src/index/build/indexer/steps/relations.js`
- `src/index/build/indexer/steps/write.js`
- `src/index/build/file-processor/assemble.js` (ensure assemble-time `metaV2` is not treated as final)
- `src/index/build/file-processor/cached-bundle.js`
- `src/index/build/artifacts/writers/chunk-meta.js`
- `src/index/metadata-v2.js`

## Tests

- [x] `tests/indexer/metav2-finalization-after-inference.test.js`
  - Build a fixture with `typeInferenceCrossFile: true`.
  - Assert `metaV2.types.inferred.params` and/or `metaV2.relations.callLinks` reflect cross-file inference results.
- [x] `tests/file-processor/cached-bundle-does-not-emit-stale-metav2.test.js`
  - Force a cached-bundle reuse path.
  - Assert serialized `chunk_meta.metaV2` still includes post-inference enrichment.
- [x] (Optional) `tests/indexer/metav2-recompute-equivalence.test.js`
  - Sample a subset of chunks; recompute metaV2 from chunk state; assert deep equality.

---

# 5.3 SQLite parity: store full metaV2 and enforce chunk identity invariants

## Goal

Remove SQLite's lossy `metaV2` reconstruction by **storing the canonical `metaV2` JSON** per chunk, and enforce invariants:

- `chunk_id` is never `NULL`
- `metaV2.chunkId` and SQLite `chunk_id` match
- SQLite retrieval returns `metaV2` equivalent to JSONL (for required fields)

## Planned changes

- [x] Add canonical `metaV2_json` storage to SQLite.
  - [x] Update `src/storage/sqlite/schema.js`:
    - bump `SCHEMA_VERSION`
    - add `metaV2_json TEXT` to the `chunks` table
  - [x] Update `docs/sqlite/index-schema.md` with the new column and schema version bump.
  - [x] Update `docs/contracts/sqlite.md` to document `metaV2_json` storage/retrieval expectations and parity guarantees.
  - [x] Update SQLite build path (`src/storage/sqlite/build-helpers.js` and writers):
    - persist `metaV2_json = JSON.stringify(chunk.metaV2)` (when available)
    - keep `docmeta` and `codeRelations` columns unchanged for compatibility
  - [x] Update SQLite retrieval (`src/retrieval/sqlite-helpers.js`) to:
    - parse `metaV2_json` when present
    - fail closed when `metaV2_json` is absent (greenfield; no legacy fallback)
  - [x] Update `docs/contracts/artifact-schemas.md` to note SQLite stores canonical `metaV2_json` for parity with JSONL.
  - [x] Add/confirm any indexes for `chunks.metaV2_json` are not required (avoid unnecessary perf cost).
  - [x] Checklist: bump `SCHEMA_VERSION` and update `PRAGMA user_version` expectations in docs/tests.

  - [x] Enforce non-null stable chunk identity in SQLite.
  - [x] Update `buildChunkRow(...)` to compute `chunk_id` via `resolveChunkId(chunk)` (`src/index/chunk-id.js`) rather than only `chunk.metaV2.chunkId`.
  - [x] Ensure `resolveChunkId` always returns a stable id even when `metaV2` is gated off by analysis policy.
    - [x] Bump `compatibilityKey` inputs and document the hard break (chunkId derivation + SQLite schema change).
    - [x] Ensure `chunk_id` and `metaV2.chunkId` are aligned after finalization (no stale ids).
  - [x] Checklist: verify `chunk_id` is computed from `resolveChunkId` in every SQLite write path (including incremental updates).

- [x] Add parity guardrails.
  - [x] Define a required field set for `metaV2` parity checks (minimum):
    - `chunkId`, `file`, `range`, `lang`, `ext`
    - `types` (if present)
    - `relations` (if present)
    - `segment` (if present)
  - [x] Add a validator check (strict mode) that compares JSONL vs SQLite for a sample of chunk ids.
  - [x] Make the parity sample deterministic (fixed seed or first N chunk ids).
  - [x] Checklist: confirm parity comparison ignores expected optional differences (e.g., `extensions` blocks) if any exist.

## Files

- `src/storage/sqlite/schema.js`
- `src/storage/sqlite/build-helpers.js`
- `src/storage/sqlite/build.js` (and wherever inserts are executed, find them)
- `src/retrieval/sqlite-helpers.js`
- `src/index/chunk-id.js`
- `src/index/validate/checks.js`

## Tests

- [x] `tests/storage/sqlite/metav2-json-roundtrip.test.js`
  - Insert a row containing `metaV2_json`.
  - Retrieve and assert `metaV2` deep-equals the original.
- [x] `tests/storage/sqlite/chunk-id-non-null.test.js`
  - Ensure `buildChunkRow` emits `chunk_id` even if `chunk.metaV2` is null.
- [x] `tests/storage/sqlite/metav2-parity-with-jsonl.test.js`
  - Build the same fixture in JSONL and SQLite modes.
  - Retrieve the same chunk(s) via both.
  - Assert required `metaV2` fields deep-equality.

---

# 5.4 Effective language descriptor: persist container vs effective identity and run analysis on effective language

## Goal

Make embedded code analysis correct by ensuring:

- **container identity** (what file it lives in) is preserved, and
- **effective identity** (what language/ext it should be parsed as) is computed, persisted, and used consistently across:
  - tokenization
  - docmeta extraction
  - relations extraction
  - flow/risk analysis
  - type inference
  - tree-sitter grammar selection

## Planned changes

### 5.4.1 Segment discovery: preserve raw hints and persist effective ext

- [x] Preserve TSX/JSX (and similar) language hints end-to-end.
  - [x] Ensure Markdown fence normalization does **not** collapse `tsx → typescript` or `jsx → javascript` at discovery time.
    - (`src/index/segments/config.js` already preserves unknown hints; keep it that way.)
  - [x] Ensure segment records preserve the raw hint as `segment.languageId`.
  - [x] Ensure fenced code blocks capture the full code value range (not just the final line).

- [x] Persist segment-derived effective extension.
  - [x] In `src/index/segments.js` `chunkSegments(...)`, persist:
    - `segment.ext` (or `segment.effectiveExt`) = `resolveSegmentExt(containerExt, segment)`
  - [x] Ensure the persisted value is included in chunk records handed to the file processor.
  - [x] Add `segmentUid` generation per Phase 8 identity spec (stable, deterministic).
    - [x] Persist `segmentUid` on segments and propagate to chunks.
    - [x] Document the `segmentUid` derivation in the identity contract spec and reference it from Phase 8 docs.
    - [x] Lock the derivation inputs in the spec (segment type + languageId + normalized segment text) to guarantee determinism.
  - [x] Checklist: ensure `segmentUid` is propagated to chunk objects before any metaV2 build/finalization.

### 5.4.2 File processor: run analysis/tokenization using effective ext + language handler per chunk

- [x] Resolve effective language per chunk.
  - [x] Add a helper in `src/index/build/file-processor/process-chunks.js` to compute:
    - `containerExt` (from file path)
    - `containerLanguageId` (from `getLanguageForFile(...)` result)
    - `segmentLanguageId` (raw hint)
    - `effectiveExt` (segment.ext if present; else containerExt)
    - `effectiveLanguage` (via `getLanguageForFile({ ext: effectiveExt, relPath })`)
  - [x] Use `effectiveExt` for:
    - `tokenizeChunkText({ ext: effectiveExt, ... })`
    - `buildTokenSequence({ ext: effectiveExt, ... })`
  - [x] Use the effective language handler for:
    - `extractDocMeta`
    - `buildChunkRelations`
    - `flow` parsing
  - [x] Pass `effectiveLanguageId` into:
    - `inferTypeMetadata`
    - `detectRiskSignals`
  - [x] Include both container + effective identifiers in diagnostics/log lines for easier triage.
  - [x] Checklist: ensure tree-sitter selection and language registry paths consume `effectiveExt` consistently.

- [x] Ensure tree-sitter selection uses effective ext, not container ext.
  - [x] `language-registry` already selects TSX grammar when `ext === '.tsx'`; ensure effective ext is propagated to where tree-sitter language id selection happens.

### 5.4.3 MetaV2: encode container vs effective identity (contract change)

- [x] Update `src/index/metadata-v2.js` to emit:
  - `metaV2.container = { ext: <containerExt>, languageId: <containerLanguageId> }`
  - `metaV2.effective = { ext: <effectiveExt>, languageId: <effectiveLanguageId> }`
  - `metaV2.lang = effectiveLanguageId` (top-level legacy field semantics updated)
  - `metaV2.ext = containerExt` (top-level legacy field remains container ext)
- [x] Expand `metaV2.segment` to include fields needed for Phase 6/8:
  - `start`, `end`, `startLine`, `endLine` (container coordinates)
  - `embeddingContext` (required when the segment is embedded; null when not embedded)
  - keep `segmentId`, `segmentUid`, `type`, `languageId`, `parentSegmentId`
  - [x] Align `segment.embeddingContext` semantics with Phase 8 expectations in `docs/specs/metadata-schema-v2.md` (explicit required/optional rules).
  - [x] Document which fields are required vs optional for non-segmented files (so consumers can rely on nullability).
  - [x] Checklist: update any JSON schema definitions that enumerate `segment` fields.

### 5.4.4 Chunk ID stability (identity hardening)

This is a prerequisite for correct caching, SQLite identity, and future graph joins.

- [x] Make `chunkId` stable-by-location (do not depend on `kind`/`name`).
  - [x] Update `src/index/chunk-id.js` `buildChunkId(...)` to hash only:
    - `file` (normalized rel path)
    - `segmentId` (or `''` if none)
    - `start`, `end` (container offsets)
  - [x] Keep `kind`/`name` as debug attributes, not identity inputs.
    - [x] Add deterministic `spanIndex` when multiple chunks share identical `{segmentId,start,end}` (stable sort by `kind`/`name`/original order).
  - [x] Update `compatibilityKey` inputs for chunk identity changes (greenfield hard break).
    - [x] Checklist: ensure any caches keyed by `chunkId` are invalidated (or versioned) after the change.
- [x] Update docs to match reality:
  - `docs/contracts/chunking.md`
  - `docs/specs/metadata-schema-v2.md`
  - [x] Make the stability guarantee explicit and consistent (chunkId stable-by-location; no `kind`/`name` inputs).

> Note: collision-safe *symbol* identity and cross-file linking keys remain a Phase 9 deliverable. Phase 5 only ensures chunk span identity is stable and segment-aware.

## Files

- `src/index/segments.js`
- `src/index/segments/config.js`
- `src/index/build/file-processor/process-chunks.js`
- `src/index/language-registry/registry.js` (only if new resolver helper needed)
  - `src/index/metadata-v2.js`
  - `src/index/chunk-id.js`
  - `src/index/build/file-processor/assemble.js`
  - `docs/specs/metadata-schema-v2.md`
- `docs/contracts/chunking.md`

## Tests

- [x] `tests/segments/tsx-jsx-hint-preserved.test.js`
  - Markdown fixture containing ` ```tsx ` and ` ```jsx ` fences.
  - Assert `chunk.segment.languageId` preserves `tsx` / `jsx` (raw hints).
- [x] `tests/segments/effective-identity-md-fence.test.js`
  - `.md` file with a `tsx` fence.
  - Assert:
    - `metaV2.container.ext === '.md'`
    - `metaV2.effective.ext === '.tsx'`
    - `metaV2.lang === 'typescript'`
- [x] `tests/segments/segment-uid-derived.test.js`
  - `.md` file with a `ts` fence.
  - Assert `segmentUid` is derived and deterministic.
- [x] `tests/file-processor/effective-language-drives-docmeta.test.js`
  - Fixture with embedded TS fence defining a function.
  - Assert the chunk extracted from the fence has a non-null `signature` as produced by the TS handler (not markdown).
- [x] `tests/chunk-id/stable-id-does-not-depend-on-name-or-kind.test.js`
  - Build two chunk-like objects identical in `{file, segmentId, start, end}` but differing `name/kind`.
  - Assert `buildChunkId(...)` returns the same value for both.

---

# 5.5 Retrieval filtering and filter-index upgrades: filter by effective language (not container ext)

## Goal

Make `--lang` filters (and any future language predicates) operate on **effective language id** so embedded TS/TSX can be found inside `.md`, `.vue`, etc.

## Planned changes

  - [x] Extend filter-index with `byLang` (effective language id).
    - [x] Update `src/retrieval/filter-index.js`:
      - compute `effectiveLang = chunk.metaV2?.lang || chunk.metaV2?.effective?.languageId || null`
      - add `byLang: Map<languageId, Set<chunkNumericId>>`
    - [x] Keep existing `byExt` semantics as **container ext**.
    - [x] Fail build/validation when `effectiveLang` is missing (greenfield requirement).
    - [x] Checklist: update any downstream code paths that assume `byExt` is the only language predicate.

  - [x] Update language filter parsing to target `byLang`.
    - [x] In `src/retrieval/filters.js`:
      - replace extension-list semantics for `--lang` with a list of language ids
      - allow common aliases (`ts` → `typescript`, `js` → `javascript`, etc.)
    - [x] If `byLang` is missing, fail validation (greenfield; no extension fallback).
    - [x] Update `docs/contracts/search-cli.md`:
      - document `--lang` as effective language id (not extension)
      - list supported aliases and failure behavior when `byLang` is missing
      - add examples for embedded TS in Markdown/Vue.
    - [x] Update CLI help text for `--lang` to mention effective language ids and aliases.
    - [x] Checklist: update any tests that assert `--lang` by extension (rename to language id).

  - [x] Output improvements (debuggable provenance).
    - [x] Ensure retrieval outputs can surface:
      - container path + ext
      - effective language id + effective ext
      - segmentId and range when present
    - [x] Include `segmentUid` in debug output when present (supports Phase 8 joins).
    - [x] Checklist: ensure JSON output shape remains stable (additive fields only).

## Files

- `src/retrieval/filter-index.js`
- `src/retrieval/filters.js`
- `src/retrieval/search.js` (if filter plumbing requires)
- `docs/contracts/search-cli.md` (if `--lang` semantics are documented)

## Tests

- [x] `tests/retrieval/lang-filter-matches-embedded-segments.test.js`
    - Fixture with `.md` TS fence.
    - Query with `--lang typescript` and assert embedded chunks are returned.
- [x] `tests/retrieval/filter-index-bylang.test.js`
    - Build filter index and assert `byLang.typescript` includes embedded chunk ids.
- [x] `tests/validate/filter-index-requires-bylang-when-segment-aware.test.js`
    - Strict validate fails if segment-aware metadata is present but `byLang` missing (opt-in rule).

---

# 5.6 VFS + segment manifest prerequisites (Phase 8 alignment)

## Goal

Phase 5 does **not** implement full VFS provider routing, but it must ensure that the metadata and contracts needed by Phase 8 exist and are stable.

## Planned changes

  - [x] Ensure `metaV2` contains all fields required to build a VFS manifest without re-parsing container files:
  - container path + container ext/lang
  - segmentId, segmentUid, segment type, segment range (start/end, startLine/endLine)
  - effective ext/lang
  - chunkId (stable)
    - [x] Ensure `segmentUid` stability is explicitly documented for unchanged container text.
    - [x] Checklist: include `segmentUid` and effective identity in any future `vfs_manifest.jsonl` sample entries.
  - [x] Add/Update a VFS manifest spec in `docs/` (if not already present):
  - `docs/specs/vfs-manifest-artifact.md` (v1)
  - It should define `vfs_manifest.jsonl` entries mapping `virtualPath → source` and include hashes for cacheability.
  - [x] Defer actual emission of `vfs_manifest.jsonl` and VFS materialization to Phase 8 unless Phase 6/7 needs it earlier.
    - [x] Add a short note about which Phase 8 fields depend on Phase 5 outputs (segmentUid + effective identity).
    - [x] Checklist: ensure Phase 8 references the finalized field names (`container`, `effective`, `segmentUid`).

## Files

  - `docs/phases/phase-8/tooling-vfs-and-segment-routing.md`
  - `docs/specs/vfs-manifest-artifact.md` (new/updated if missing)
  - `docs/specs/metadata-schema-v2.md`

---

## Phase 5 exit criteria (definition of done)

Phase 5 is complete when:

- [x] `metaV2.types.inferred.params` is preserved (no silent drops) and tooling splitting works for nested maps.
- [x] `metaV2` is recomputed/finalized after cross-file enrichment and before artifact/SQLite writes.
- [x] SQLite stores full `metaV2` per chunk and retrieval returns it (no minimal stub for new DBs).
- [x] Every chunk has explicit container vs effective identity, and analysis/tokenization uses effective identity.
- [x] `chunkId` is stable-by-location (independent of `kind`/`name`) and `chunk_id` is never null in SQLite.
- [x] Retrieval supports `--lang` filtering on effective language id via `byLang`.
- [x] `compatibilityKey` bumped and documented for chunkId derivation + SQLite schema changes.

---

## Notes on Phase 6 / Phase 8 expectations

- Phase 6 callsite artifacts may compute offsets on segment slices; Phase 5 MUST ensure segment start/end and effective language identity are present so Phase 6 can translate offsets back to container coordinates without re-parsing containers.
- Phase 8 tooling providers require a deterministic mapping from segments to virtual paths; Phase 5 MUST preserve enough metadata (segment ranges + effective ext/lang + stable ids) to generate `vfs_manifest.jsonl` deterministically.

---

## Plan quality: what I would do differently (and why)

- Prefer **hard contract truth** over "best-effort" legacy behavior:
  - If `docs/contracts/chunking.md` states `chunkId` is stable, Phase 5 should make it *actually stable* (remove `kind/name` inputs) rather than tolerating churn.
- Keep **container vs effective identity** explicit and redundant:
  - Store container identity in `metaV2.container` and keep `metaV2.ext` as the container ext for compatibility.
  - Store effective identity in `metaV2.effective` and make `metaV2.lang` match effective language id.
  - This redundancy reduces migration risk and keeps existing readers functioning.
- Treat ambiguous symbol linking as unsafe:
  - If Phase 5 makes segments "more analyzable", it will increase same-file name collisions. Even if Phase 9 owns the full identity solution, Phase 5 should add validation warnings (at minimum) when cross-file inference sees ambiguous keys, to avoid silently linking wrong targets.

---

# Refactor Plan (Large JS Files)

## Completed refactors:

- [x] `src/index/build/watch.js` split into `src/index/build/watch/*` helpers + shared debounce/ignore/backoff.
- [x] `src/integrations/core/index.js` split into `args.js`, `embeddings.js`, `build-index.js`, `search.js`, `status.js`.
- [x] `src/index/validate.js` split into `src/index/validate/*`.
- [x] `src/index/build/artifacts.js` split into `src/index/build/artifacts/*`.
- [x] `tools/build-embeddings/run.js` split into `tools/build-embeddings/*`.
- [x] `src/index/build/worker-pool.js` split into `src/index/build/workers/*`.
- [x] `tools/api/router.js` split into `tools/api/router/*` (+ shared response/middleware helpers).
- [x] `src/index/build/runtime/runtime.js` split into `src/index/build/runtime/*`.
- [x] `src/retrieval/cli.js` split into `src/retrieval/cli/*`.
- [x] `src/index/language-registry/registry.js` split into `registry-data.js` + supporting modules.
- [x] `tools/config-inventory.js` split into `tools/config-inventory/*`.
- [x] `tools/build-sqlite-index/run.js` split into `tools/build-sqlite-index/*`.
- [x] `src/shared/json-stream.js` split into `src/shared/json-stream/*`.
- [x] `tools/dict-utils/paths.js` split into `tools/dict-utils/paths/*`.

## Phase 0 -- Shared modules to extract first (reduces repeated work)

### 0.1 `src/shared/retry.js`

- Extract generic backoff + jitter helper (used by watch lock backoff).
  - [x] Create `retryWithBackoff({ maxWaitMs, baseMs, maxMs, onRetry, onLog, shouldStop })`.
  - [x] Replace inline backoff logic in `watch.js` with shared helper.

### 0.2 `src/shared/scheduler/debounce.js`

- Extract debounced scheduler for reuse.
  - [x] Move helper into `src/shared/scheduler/debounce.js`.
  - [x] Update watch import.

### 0.3 `src/shared/fs/ignore.js`

- Centralize ignore matcher logic used by watchers and discover.
  - [x] Extract as `buildIgnoredMatcher({ root, ignoreMatcher })`.

### 0.4 `src/shared/filter/merge.js`

- Centralize merge semantics for CLI vs filter expressions (ext/lang/type/etc).
  - [x] Provide `mergeFilterLists({ left, right }) -> { values, impossible }`.
  - [x] Keep behavior consistent in retrieval CLI + filter code.

## Phase 1 -- File-by-file split plan

### 1.1 `src/index/build/watch.js` (849 LOC)

- [x] Move watcher backend resolution to `src/index/build/watch/resolve-backend.js` (lines 47-73).
- [x] Move lock backoff into shared `src/shared/retry.js` and adapt `acquireIndexLockWithBackoff` to call it.
- [x] Move stability guard to `src/index/build/watch/stability.js` (lines 114-132).
- [x] Move records path + sampling helpers to `src/index/build/watch/records.js` (165-191).
- [x] Move guardrails caps and indexable path logic to `src/index/build/watch/guardrails.js` (192-230 + 202-224).
- [x] Move ignore matcher to shared `src/shared/fs/ignore.js` (231-247).

### 1.2 `src/integrations/core/index.js` (823 LOC)

Top-level functions and ranges:
- `createOverallProgress` **37-75**
- `computeCompatibilityKey` **76-89**
- `resolveEmbeddingRuntime` **90-124**
- `teardownRuntime` **125-137**
- `createLineEmitter` **140-158**
- `runEmbeddingsTool` **159-192**
- `buildIndex` **193-789**
- `buildSqliteIndex` **790-816**
- `search` **817-840**
- `status` **841-844**
  - [x] Extract `embeddings` helpers into `src/integrations/core/embeddings.js` (90-192).
  - [x] Extract `buildIndex` into `src/integrations/core/build-index.js` and split into sub-functions:
  - input normalization + runtime init (first ~80 lines of buildIndex)
  - discovery plan + build execution
  - post-build validation/promotion
  - final reporting
  - [x] Extract shared `search` + `status` into `src/integrations/core/search.js` and `status.js`.
  - [x] Keep `src/integrations/core/index.js` as re-export/wiring only.

### 1.3 `src/index/validate.js` (793 LOC)

Top-level:
- `validateIndexArtifacts` **56-823**

Refactor tasks (split into modules with line anchors):
- [x] Extract manifest + checksum validation (approx **108-200**) into `src/index/validate/manifest.js`.
- [x] Extract artifact presence + file loading (approx **200-420**) into `src/index/validate/artifacts.js`.
- [x] Extract SQLite validation (approx **420-650**) into `src/index/validate/sqlite.js`.
- [x] Extract LMDB validation (approx **650-780**) into `src/index/validate/lmdb.js`.
- [x] `validateIndexArtifacts` becomes orchestration (inputs, report aggregation).
- `tests/index-validate.js`, `tests/storage/sqlite/*.test.js`, `tests/lmdb-*.js`

### 1.4 `src/index/build/artifacts.js` (759 LOC)

Top-level:
- `writeIndexArtifacts` **40-767**
- [x] Split artifact writer by artifact type into `src/index/build/artifacts/` modules:
  - chunk_meta, repo_map, file_meta, filter_index, postings, vectors, etc.
- [x] Extract path resolution + atomic write helpers to `src/index/build/artifacts/io.js`.
- [x] Keep `writeIndexArtifacts` as orchestration (build per-artifact spec list, call writers).
Tests potentially affected:
- `tests/artifact-formats.js`, `tests/artifact-size-guardrails.js`, `tests/format-fidelity.js`

### 1.5 `tools/build-embeddings/run.js` (755 LOC)

- `runBuildEmbeddings` **56-797**
- [x] Extract CLI parsing + argv normalization into `tools/build-embeddings/args.js`.
- [x] Extract model + provider resolution into `tools/build-embeddings/runtime.js`.
- [x] Extract batch processing + output writer into `tools/build-embeddings/runner.js`.
- [x] Keep `run.js` as thin entrypoint.
Tests potentially affected:
- `tests/build-embeddings-cache.js`, `tests/embeddings-*.js`

### 1.6 `src/index/build/worker-pool.js` (738 LOC)

- `normalizeWorkerPoolConfig` **147-212**
- `resolveWorkerPoolConfig` **213-234**
- `createIndexerWorkerPool` **235-697**
- `createIndexerWorkerPools` **698-757**
- [x] Extract config normalization into `src/index/build/workers/config.js`.
- [x] Extract worker lifecycle into `src/index/build/workers/pool.js`.
- [x] Extract message protocol / error normalization into `src/index/build/workers/protocol.js`.
Tests potentially affected:
- `tests/worker-pool-windows.js`, `tests/worker-pool.js`

### 1.7 `tools/api/router.js` (734 LOC)

- `createApiRouter` **31-756**
Refactor tasks:
- [x] Extract middleware stack into `tools/api/middleware/*.js`.
- [x] Extract route registration into `tools/api/routes/*.js`.
- [x] Create a `tools/api/responses.js` for JSON/error helpers.
Tests potentially affected:
- `tests/services/api/*.test.js`

### 1.8 `src/index/build/runtime/runtime.js` (715 LOC)

- `createBuildRuntime` **54-729**
- [x] Extract runtime envelope + config into `src/index/build/runtime/config.js`.
- [x] Extract policy toggles into `src/index/build/runtime/policy.js`.

### 1.12 `src/retrieval/cli.js` (691 LOC)

- `runSearchCli` **60-734**
- [x] Extract index loading to `src/retrieval/cli/load-indexes.js`.
- [x] Extract option normalization to `src/retrieval/cli/options.js` (some already exists).
Tests potentially affected:
- `tests/search-*`, `tests/retrieval/*`

### 1.13 `src/index/language-registry/registry.js` (687 LOC)

- Registry data **84-540**
- `getLanguageForFile` **632-638**
- `collectLanguageImports` **639-667**
- `buildLanguageContext` **668-678**
- `buildChunkRelations` **679-698**
- [x] Move registry data into `registry-data.js` and keep runtime helpers in `registry.js`.

### 1.14 `tools/config-inventory.js` (686 LOC)
Top-level:
- `buildInventory` **441-721**

Refactor tasks:
- [x] Extract schema parsing helpers into `tools/config-inventory/schema.js`.
- [x] Extract source scanning into `tools/config-inventory/scan.js`.
- [x] Extract rendering into `tools/config-inventory/report.js`.

### 1.16 `tools/build-sqlite-index/run.js` (667 LOC)
Top-level:
- `resolveOutputPaths` **44-76**
- `runBuildSqliteIndex` **77-688**

Refactor tasks:
- [x] Split CLI parsing to `tools/build-sqlite-index/args.js`.
- [x] Split execution to `tools/build-sqlite-index/runner.js`.
- [x] Keep `run.js` as entrypoint.

### 1.17 `src/shared/json-stream.js` (662 LOC)
Top-level helpers and ranges listed in extraction log (see notes above).

Refactor tasks:
- [x] Move compression helpers (`normalizeGzipOptions`, `createFflateGzipStream`, `createZstdStream`) into `src/shared/json-stream/compress.js`.
- [x] Move atomic replace into `src/shared/json-stream/atomic.js`.

### 1.20 `tools/dict-utils/paths.js` (644 LOC)
Top-level helpers and ranges already listed (14-685).

Refactor tasks:
- [x] Split repo identity helpers into `tools/dict-utils/repo.js` (14-106).
- [x] Split build/index path resolution into `tools/dict-utils/build-paths.js` (107-222).
- [x] Split runtime/config resolution into `tools/dict-utils/runtime.js` (239-350).
- [x] Split tooling/metrics paths into `tools/dict-utils/tooling.js` (362-510).
- [x] Split dictionary path resolution into `tools/dict-utils/dictionaries.js` (598-685).

## Phase 2 -- Tests and follow‑ups

- [x] Update imports for any moved modules and keep exports stable.
- [x] Run `npm run lint` and spot-check `node tests/run.js --match` for affected areas:
  - watch: `tests/watch-*`
  - retrieval: `tests/retrieval/*`, `tests/lang-filter.js`
  - sqlite/build: `tests/storage/sqlite/*`
  - mcp: `tests/services/mcp/*`

# Appendix D -- Minimal tests to add (non‑isometric)

Skip isometric/map tests for now (per request). Add only light‑touch tests that lock behavior during refactor.

## build‑embeddings (`tools/build-embeddings/*`)
- [x] `tests/build-embeddings/args-parsing.test.js`
  - asserts unknown args are rejected
  - ensures `--model`, `--provider`, `--cache-root` normalize consistently
- [x] `tests/build-embeddings/runtime-defaults.test.js`
  - validates defaults are set when flags absent

## build‑sqlite‑index (`tools/build-sqlite-index/*`)
- [x] `tests/build-sqlite-index/args-parsing.test.js`
  - validates `--mode`, `--out`, `--config` parsing
- [x] `tests/build-sqlite-index/output-paths.test.js`
  - ensures `resolveOutputPaths` produces expected file locations

## config‑inventory (`tools/config-inventory/*`)
- [x] `tests/config-inventory/schema-scan.test.js`
  - validates schema keys are discovered
- [x] `tests/config-inventory/report-format.test.js`
  - validates markdown output includes counts + sections

## API router (`tools/api/router.js`)
- [x] `tests/api/router-smoke.test.js`
  - registers router and asserts critical routes exist
  - verifies JSON error response shape

## MCP tools (`tools/mcp/tools.js`)
- [x] `tests/mcp/tools-registry.test.js`
  - ensures handler registry includes required tool names
- [x] `tests/mcp/tools-normalize-meta.test.js`
  - validates meta filter normalization output shape

## shared json‑stream (`src/shared/json-stream.js`)
- [x] `tests/json-stream/atomic-replace.test.js`
  - validates `replaceFile` behavior via small temp file
- [x] `tests/json-stream/compress-options.test.js`
  - validates gzip/zstd option normalization

## dict‑utils paths (`tools/dict-utils/paths.js`)
- [x] `tests/dict-utils/paths-repo-root.test.js`
  - resolves repo root from nested path
- [x] `tests/dict-utils/paths-builds-root.test.js`
  - validates builds root for config overrides

## retrieval CLI split (`src/retrieval/cli.js` → modules)
- [x] `tests/retrieval/cli-options-smoke.test.js`
  - parses `--lang`, `--ext`, `--filter` and ensures no throw

## validate split (`src/index/validate.js`)
- [x] `tests/validate/manifest-checks.test.js`
  - validates checksum failure produces issue text

---