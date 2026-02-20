# DEPRECATED

- Canonical replacement doc(s): `AINTKNOWMAP.md`
- Reason: Active roadmap content was duplicated and divergent across multiple planning docs; `AINTKNOWMAP.md` is now the single authoritative execution sequence.
- Date: 2026-02-20T22:35:00Z
- Commit/PR: Pending (OBSIDIAN_RECKONING)

---
# PairOfCleats FutureRoadmap

## Status legend

Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete

Completed Phases: `COMPLETED_PHASES.md`

---


### Source-of-truth hierarchy (when specs disagree)
When a document/spec conflicts with the running code, follow this order:

1) **`src/contracts/**` and validators** are authoritative for artifact shapes and required keys.
2) **Current implementation** is authoritative for runtime behavior *when it is already validated by contracts/tests*.
3) **Docs** (`docs/contracts/**`, `docs/specs/**`) must be updated to match (never the other way around) unless we have a deliberate migration plan.

If you discover a conflict:
- **Prefer "fix docs to match code"** when the code is already contract-validated and has tests.
- **Prefer "fix code to match docs/contracts"** only when the contract/validator is explicit and the code violates it.

### Touchpoints + line ranges (important: line ranges are approximate)
This document includes file touchpoints with **approximate** line ranges like:

- `src/foo/bar.js` **(~L120-L240)**  -  anchor: `someFunctionName`

Line numbers drift as the repo changes. Treat them as a **starting hint**, not a hard reference.
Always use the **anchor string** (function name / constant / error message) as the primary locator.

### Tests: lanes + name filters (use them aggressively)
The repo has a first-class test runner with lanes + filters:

- Runner: `npm test` (alias for `node tests/run.js`)
- List lanes/tags: `npm test -- --list-lanes` / `npm test -- --list-tags`
- Run a lane: `npm run test:unit`, `npm run test:integration`, `npm run test:services`, etc.
- Filter by name/path (selectors):  
  - `npm test -- --match risk_interprocedural`  
  - `npm run test:unit -- --match chunk-uid`  
  - `npm run test:integration -- --match crossfile`

**Lane rules are defined in:** `tests/run.rules.jsonc` (keep new tests named/placed so they land in the intended lane).

### Deprecating spec documents: archive policy (MANDATORY)
When a spec/doc is replaced (e.g., a reconciled spec supersedes an older one):

- **Move the deprecated doc to:** `docs/archived/` (create this folder if missing).
- Keep a short header in the moved file indicating:
  - what replaced it,
  - why it was deprecated,
  - the date/PR.
- Add/update the repository process in **`AGENTS.md`** so future agents follow the same archival convention.

---

## Canonical command/path locks

These names are locked to avoid duplicate command surfaces and duplicate test ownership.

- Canonical release runner command/file: `node tools/release/check.js` (script alias `npm run release-check`).
- Canonical test ownership rule: one canonical test path per concern.
  - Duplicates must be merged into the canonical test file.
  - Retired duplicate tests must be removed or archived with migration notes in the same change.

---

## Decision Register (resolve before execution)

| Decision | Description | Default if Unresolved | Owner | Due Phase | Decision deadline |
| --- | --- | --- | --- | --- | --- |
| D1 Phase 16 extraction deps | Which PDF/DOCX libraries are canonical? | Prefer pdfjs‑dist + mammoth | Core Maintainers | 16 | Resolved 2026-02-20 |
| D2 Phase 17 vector‑only | Which sparse artifacts are removed vs retained? | Keep minimal metadata for compatibility | Core Maintainers | 17 | Resolved 2026-02-20 |
| D3 Phase 18 packaging | Native packaging targets/priorities | Windows + macOS + Linux | Core Maintainers | 18 | Resolved 2026-02-20 |
| D4 Phase 19 lexicon | Promote LEXI into FUTUREROADMAP? | Yes (single source) | Core Maintainers | 19 | Resolved 2026-02-20 |
| D5 Phase 20 TUI | JSONL protocol v2 strictness | Strict + fail‑open log wrapping | Core Maintainers | 20 | Resolved 2026-02-20 |

### Dependency map (high-level)
- Phase 16 extraction + routing precedes Phase 17 vector‑only profile defaults.
- Phase 19 lexicon work should land before Phase 20 TUI if the TUI consumes lexicon signals/explain fields.
- Phase 18 packaging should include any Phase 20 binaries once they exist.

### Phase status summary (update as you go)
| Phase | Status | Notes |
| --- | --- | --- |
| 16 | [ ] |  |
| 17 | [ ] |  |
| 18 | [ ] |  |
| 19 | [ ] |  |
| 20 | [ ] |  |

### Per‑phase testing checklist (fill per phase)
- [ ] Add/verify new tests for each phase’s core behaviors.
- [ ] Run at least the intended lane(s) and record results.
- [ ] Update docs/config inventory after schema changes.

---

### Phase 18.1 — Release target matrix + deterministic release smoke-check
- [ ] Define and publish the **release target matrix** and optional-dependency policy.
  - Primary output:
    - `docs/guides/release-matrix.md` (new)
  - Include:
    - Supported OSes and runners (Linux/macOS/Windows) and architectures (x64/arm64 where supported).
    - Supported Node versions (minimum + tested versions).
    - Optional dependency behavior policy (required vs optional features), including:
      - Python (for Sublime lint/compile tests)
      - Editor integrations (Sublime + VS Code)
      - Any “bring-your-own” optional deps used elsewhere (e.g., extraction/SDK/tooling)
    - “Fail vs degrade” posture for each optional capability (what is allowed to skip, and what must hard-fail).
- [ ] Expand the existing `tools/release/check.js` from “changelog-only” into a **deterministic release smoke-check runner**.
  - Touchpoints:
    - `tools/release/check.js` (extend; keep it dependency-light)
    - `bin/pairofcleats.js` (invoked by the smoke check; no behavioral changes expected here)
    - `src/shared/subprocess.js` (shared spawn/timeout helpers)
  - Requirements:
    - Must not depend on shell string concatenation; use spawn with args arrays.
    - Must set explicit `cwd` and avoid fragile `process.cwd()` assumptions (derive repo root from `import.meta.url` or accept `--repo-root`).
    - Must support bounded timeouts and produce actionable failures (which step failed, stdout/stderr excerpt).
    - Should support `--json` output with a stable envelope for CI automation (step list + pass/fail + durations).
    - Produce a reproducible `release-manifest.json` with artifact checksums (sha256) and an SBOM reference, and sign it (with CI verification).
  - Smoke steps (minimum):
    - Verify Node version compatibility (per the target matrix).
    - Run `pairofcleats --version`.
    - Run `pairofcleats index build` on a small fixture repo into a temp cacheRoot.
    - Run `pairofcleats index validate --strict` against the produced build.
    - Run a basic `pairofcleats search` against the build and assert non-empty or expected shape.
    - Verify editor integration assets exist when present:
      - Sublime: `sublime/PairOfCleats/**`
      - VS Code: `extensions/vscode/**`
- [ ] Add CI wiring for the smoke check.
  - Touchpoints:
    - `.github/workflows/ci.yml`
    - `package.json` scripts (optional, if CI should call a stable npm script)
    - `docs/guides/release-matrix.md` (source of truth for versions and policies)
    - `docs/guides/release-discipline.md` (release checks + required gates)
  - Requirements:
    - Add a release-gate lane that runs `npm run release-check` plus the new smoke steps.
    - Add OS coverage beyond Linux (at minimum: Windows already exists; add macOS for the smoke check).
    - Align CI Node version(s) with the release target matrix, and ensure the matrix is explicitly documented.

#### Tests / Verification
- [ ] `tests/tooling/release/release-check-smoke.test.js`
  - Runs `node tools/release/check.js` in a temp environment and asserts it succeeds on a healthy checkout.
- [ ] `tests/tooling/release/release-check-json.test.js`
  - Runs `release-check --json` and asserts stable JSON envelope fields (schemaVersion, steps[], status).
- [ ] `tests/tooling/release/release-check-exit-codes.test.js`
  - Failing step returns non-zero and includes the failing step name in stderr.
- [ ] CI verification:
  - [ ] Add a job that runs the smoke check on at least Linux/macOS/Windows with pinned Node versions per the matrix.

---

### Phase 18.2 — Cross-platform path safety audit + regression tests (including spaces)
- [ ] Audit filesystem path construction and CLI spawning for correctness on:
  - paths with spaces
  - Windows separators and drive roots
  - consistent repo-relative path normalization for public artifacts (canonical `/` separators)
- [ ] Fix issues discovered during the audit in the “release-critical surface”.
  - Minimum scope for this phase:
    - `tools/release/check.js` (must behave correctly on all supported OSes)
    - packaging scripts added in Phase 18.3/18.5
    - tests added by this phase (must be runnable on CI runners and locally)
  - Broader issues discovered outside this scope should either:
    - be fixed here if the touched files are already being modified, or
    - be explicitly deferred to a named follow-on phase (with a concrete subsection placeholder).
- [ ] Add regression tests for path safety and quoting.
  - Touchpoints:
    - `tests/tooling/platform/paths-with-spaces.test.js` (new)
    - `tests/tooling/platform/windows-paths-smoke.test.js` (new; conditional when not on Windows)
    - `src/shared/files.js` (path normalization helpers)
    - `src/shared/subprocess.js` (argument quoting + spawn safety)
  - Requirements:
    - Create a temp repo directory whose absolute path includes spaces.
    - Run build + validate + search using explicit `cwd` and temp cacheRoot.
    - Ensure the artifacts still store repo-relative paths with `/` separators.
    - Add property-based or table-driven cases for edge paths: drive-letter prefixes (including `C:/` on POSIX), NFC/NFD normalization, and trailing dots/spaces.

#### Tests / Verification
- [ ] `tests/tooling/platform/paths-with-spaces.test.js`
  - Creates `repo with spaces/` under a temp dir; runs build + search; asserts success.
- [ ] `tests/tooling/platform/windows-paths-smoke.test.js`
  - On Windows CI, verifies key commands succeed and produce valid outputs.
- [ ] `tests/tooling/platform/path-edge-cases.test.js`
  - Exercises drive-letter-like paths on POSIX, NFC/NFD normalization, and trailing dots/spaces.
- [ ] Extend `tools/release/check.js` to include a `--paths` step that runs the above regression checks in quick mode.

---

### Phase 18.3 — Sublime plugin packaging pipeline (bundled, reproducible)
- [ ] Implement a reproducible packaging step for the Sublime plugin.
  - Touchpoints:
    - `sublime/PairOfCleats/**` (source)
    - `tools/package-sublime.js` (new; Node-only)
    - `package.json` scripts (optional: `npm run package:sublime`)
  - Requirements:
    - Package `sublime/PairOfCleats/` into a distributable artifact (`.sublime-package` zip or Package Control–compatible format).
    - Determinism requirements:
      - Stable file ordering in the archive.
      - Normalized timestamps/permissions where feasible.
      - Version-stamp the output using root `package.json` version.
    - Packaging must be Node-only (must not assume Python is present).
- [ ] Add installation and distribution documentation.
  - Touchpoints (choose one canonical location):
    - `docs/guides/editor-integration.md` (add Sublime section), and/or
    - `sublime/PairOfCleats/README.md` (distribution instructions)
  - Include:
    - Manual install steps and Package Control posture.
    - Compatibility notes (service-mode requirements, supported CLI flags, cacheRoot expectations).

#### Tests / Verification
- [ ] `tests/tooling/sublime/package-structure.test.js`
  - Runs the packaging script; asserts expected files exist in the output and that version metadata matches root `package.json`.
- [ ] `tests/tooling/sublime/package-determinism.test.js` (if feasible)
  - Packages twice; asserts the archive is byte-identical (or semantically identical with a stable file list + checksums).

---

### Phase 18.4 — Make Python tests and tooling optional (skip cleanly when Python is missing)
- [ ] Update Python-related tests to detect absence of Python and **skip with a clear message** (not fail).
  - Touchpoints:
    - `tests/tooling/sublime/sublime-pycompile.test.js` (must be guarded)
    - `tests/tooling/sublime/test_*.py` (only if these are invoked by CI or tooling; otherwise keep as optional)
    - `tests/helpers/skip.js` (skip exit code + messaging helper)
    - `tests/helpers/test-env.js` (consistent skip env setup)
  - Requirements:
    - Prefer `spawnSync(python, ['--version'])` and treat ENOENT as “Python unavailable”.
    - When Python is unavailable:
      - print a single-line skip reason to stderr
      - exit using the project’s standard “skip” mechanism (see below)
    - When Python is available:
      - the test must still fail for real syntax errors (no silent skips).
    - Centralize Python detection in a shared helper (e.g., `tests/helpers/python.js`) used by all Python-dependent tests/tooling.
- [x] JS test harness recognizes “skipped” tests via exit code 77.
  - Touchpoints:
    - `tests/run.js` (treat a dedicated exit code, e.g. `77`, as `skipped`)
  - Requirements:
    - `SKIP` must appear in console output (like PASS/FAIL).
    - JUnit output must mark skipped tests as skipped.
    - JSON output must include `status: 'skipped'`.
- [ ] Add a small unit test that proves the “Python missing → skipped” path is wired correctly.
  - Touchpoints:
    - `tests/tooling/python/python-availability-skip.test.js` (new)
  - Approach:
    - mock or simulate ENOENT from spawnSync and assert the test exits with the “skip” code and emits the expected message.

#### Tests / Verification
- [ ] `tests/tooling/sublime/sublime-pycompile.test.js`
  - Verified behavior:
    - Without Python: skips (non-failing) with a clear message.
    - With Python: compiles all `.py` files under `sublime/PairOfCleats/**` and fails on syntax errors.
- [ ] `tests/tooling/python/python-availability-skip.test.js`
  - Asserts skip-path correctness and ensures we do not “skip on real failures”.
 - [ ] `tests/tooling/python/python-skip-message.test.js`
   - Ensures skip message is a single line and includes the missing executable name.

---

### Phase 18.5 — VS Code extension packaging + compatibility (extension exists)
- [ ] Add a reproducible VS Code extension packaging pipeline (VSIX).
  - Touchpoints:
    - `extensions/vscode/**` (source)
    - `package.json` scripts (new: `package:vscode`), and/or `tools/package-vscode.js` (new)
    - `.vscodeignore` / `extensions/vscode/.vscodeignore` (packaging include/exclude list)
  - Requirements:
    - Use a pinned packaging toolchain (recommended: `@vscode/vsce` as a devDependency).
    - Output path must be deterministic and placed under a temp/artifacts directory suitable for CI.
    - Packaging must not depend on repo-root `process.cwd()` assumptions; set explicit cwd.
    - Validate `engines.vscode` compatibility against the documented release matrix and fail if mismatched.
- [ ] Ensure the extension consumes the **public artifact surface** via manifest discovery and respects user-configured `cacheRoot`.
  - Touchpoints:
    - `extensions/vscode/extension.js`
    - `extensions/vscode/package.json`
  - Requirements:
    - No hard-coded internal cache paths; use configuration + CLI contracts.
    - Any default behaviors must be documented and overridable via settings.
- [ ] Add a conditional CI gate for VSIX packaging.
  - If the VSIX toolchain is present, packaging must pass.
  - If the toolchain is intentionally absent in some environments, the test must skip (not fail) with an explicit message.

#### Tests / Verification
- [ ] `tests/tooling/vscode/extension-packaging.test.js`
  - Packages a VSIX and asserts the output exists (skips if packaging toolchain is unavailable).
- [ ] Extend `tests/tooling/vscode/vscode-extension.test.js`
  - Validate required activation events/commands and required configuration keys (and add any cacheRoot-related keys if the contract requires them).
  - Validate `engines.vscode` compatibility constraints.

---

### Phase 18.6 — Service-mode bundle + distribution documentation (API server + embedding worker)
- [ ] Ship a service-mode “bundle” (one-command entrypoint) and documentation.
  - Touchpoints:
    - `tools/api/server.js`
    - `tools/service/indexer-service.js`
    - `tools/service/**` (queue + worker)
    - `docs/guides/service-mode.md` (add bundle section) or a section in `docs/guides/commands.md`
  - Requirements:
    - Define canonical startup commands, required environment variables, and queue storage paths.
    - Document security posture and safe defaults:
      - local-only binding by default
      - explicit opt-in for public binding
      - guidance for auth/CORS if exposed
    - Ensure the bundle uses explicit args and deterministic logging conventions (stdout vs stderr).
- [ ] Add an end-to-end smoke test for the service-mode bundle wiring.
  - Use stub embeddings or other deterministic modes where possible; do not require external services.
  - Include a readiness probe and bounded timeout to avoid hangs.
  - Ensure clean shutdown of API server + worker (no leaked processes).

#### Tests / Verification
- [ ] `tests/services/service-mode-smoke.test.js`
  - Starts API server + worker in a temp environment; enqueues a small job; asserts it is processed and the API responds.
- [ ] Extend `tools/release/check.js` to optionally run a bounded-time service-mode smoke step (`--service-mode`).

---

## Phase 20 — Ratatui TUI + Node Supervisor (Protocol v2, Dispatcher, Tool Hygiene)

### Objective
Deliver a standalone Rust Ratatui TUI that owns the terminal and drives existing Node scripts through a Node supervisor with a strict, versioned JSONL protocol for tasks/logs/results, including correct cancellation and process-tree cleanup across platforms.

### Goals
- A single UI-driven entrypoint that can run core jobs (`setup`, `bootstrap`, `index build`, `search`, bench harness).
- Display streaming tasks and logs from nested subprocess trees.
- Cancellation that is tree-aware and predictable across platforms.
- Strict protocol boundary with JSONL progress and final job results.

### Non-goals
- Replacing all existing CLI commands immediately.
- Making every script pure JSONL in all modes (only in `--progress jsonl` mode).
- Distributed execution, resumable job queues, multi-user concurrency.
- Full interactive editor for every config file in MVP.

### Constraints and invariants
- Rust TUI owns the terminal: spawned jobs never assume they own TTY.
- Supervisor treats non-protocol output as logs only.
- Cancellation is tree-aware:
  - Windows: `taskkill /T` then `/F`
  - POSIX: signal process group when detached
- `--json` outputs are stdout-only; logs/progress go to stderr/protocol.

### Locked decisions
- Cancel exit code: tools exit 130 on user-initiated cancel.
- Progress protocol: v2 events include `proto: "poc.progress@2"` and allowlisted `event`.
- JSONL mode: stderr emits only protocol events (no raw lines).
- JSON output: stdout emits exactly one JSON object.
- Event ordering: every protocol event includes `ts` (ISO) and monotonic `seq` (per job when `jobId` exists).
- POSIX kill: if `detached === true`, kill process group (`-pid`), else kill PID.
- Job artifacts: supervisor emits `job:artifacts` after `job:end`.
- Search dispatch: `bin/pairofcleats.js` must not reject valid search flags or backends.
- Spec file locations:
  - `docs/specs/tui-tool-contract.md`
  - `docs/specs/progress-protocol-v2.md`
  - `docs/specs/node-supervisor-protocol.md`
  - `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`
  - `docs/specs/supervisor-artifacts-indexing-pass.md`
  - `docs/specs/tui-installation.md`

### Sub-phase numbering note
Sub-phase numbers below are local to Phase 20 (20.0–20.5) and map 1:1 with the HAWKTUI roadmap.

### Implementation order (dependency-aware, cross-cutting first)
1) Sub-phase 20.0.2 + 20.1.1–20.1.3: kill-tree, strict protocol v2, shared stream decoder, stdout guard.
2) Sub-phase 20.0.3–20.0.7: tool JSONL/JSON hygiene (can proceed in parallel per tool family).
3) Sub-phase 20.2.1–20.2.2: supervisor protocol + implementation.
4) Sub-phase 20.2.3–20.2.4: dispatch refactor + artifacts pass.
5) Sub-phase 20.3: Rust TUI MVP (can start once protocol/manifest shapes are frozen).
6) Sub-phase 20.4: cancellation hardening.
7) Sub-phase 20.5: install + distribution.

### Parallelization map (non-overlapping work)
- Track A (protocol + helpers): 20.0.2, 20.1.1–20.1.3, 20.0.7.
- Track B (tool hygiene): 20.0.3–20.0.6 split by tool family.
- Track C (dispatch): 20.2.3 in parallel with Track B once protocol shapes are fixed.
- Track D (supervisor core): 20.2.2 in parallel with Track C.
- Track E (Rust TUI): 20.3 once 20.2.1 and manifest fields are frozen.
- Track F (install/dist): 20.5 after 20.3.1 crate skeleton.

### Dependency matrix (phase -> prerequisites)
| Phase / Sub-phase | Requires | Notes |
|---|---|---|
| 20.0.1 TUI tool contract | — | Spec + audit only |
| 20.0.2 Kill-tree unify | — | Hard dependency for supervisor + cancellation |
| 20.0.3 build_index JSONL cleanup | 20.0.2 | For abort correctness |
| 20.0.4 bench harness cleanup | 20.0.2 + 20.1.1/20.1.3 | Uses shared decoder + kill-tree |
| 20.0.5 setup cleanup | 20.1.1/20.1.2 | Needs progress context + protocol strictness |
| 20.0.6 bootstrap cleanup | 20.1.1/20.1.2 | Same as setup |
| 20.0.7 stdout guard | — | Can ship early; used by all |
| 20.1.1 protocol v2 spec | — | Foundation for 20.1.2/20.1.3 |
| 20.1.2 context propagation | 20.1.1 | Adds env + display wiring |
| 20.1.3 progress stream decoder | 20.1.1 | Used by bench + supervisor |
| 20.2.1 supervisor protocol spec | 20.1.1 | Requires v2 protocol definitions |
| 20.2.2 supervisor implementation | 20.0.2 + 20.1.1–20.1.3 | Needs kill-tree + decoder |
| 20.2.3 dispatch refactor | 20.1.1 | Needs stable manifest fields |
| 20.2.4 artifacts pass | 20.2.2 + 20.2.3 | Uses dispatch registry + job lifecycle |
| 20.3.1 Rust crate skeleton | — | Can begin early |
| 20.3.2 supervisor integration | 20.2.2 | Needs working supervisor |
| 20.3.3 UI behaviors | 20.3.1 + 20.2.3 | Needs manifest fields for palette |
| 20.4.1–20.4.3 cancellation hardening | 20.2.2 + 20.3.2 | Requires live supervisor + UI |
| 20.5.1 install + wrapper | 20.3.1 | Needs crate skeleton |
| 20.5.2 CI artifacts | 20.5.1 | Depends on build outputs |

### Cross-cutting constraints (apply to all phases)
- Protocol strictness: non-protocol lines are wrapped as `log` events.
- Line length cap: enforce a max line size in the shared decoder (default 1MB).
- Stdout discipline: tools that write JSON to stdout must not run children with `stdio: 'inherit'`.
- Test determinism: tests must run without network access unless explicitly mocked.

---

## Sub-phase 20.0: Preparation — tooling normalization + kill-tree unification

### Objective
Before introducing the supervisor/TUI, make existing CLI tools behave ideally for a terminal-owned orchestrator:
- deterministic non-interactive execution paths
- clean separation of stdout JSON vs stderr logs/progress
- consistent progress JSONL emission
- unified process-tree termination logic

### 20.0.0 Current-state inventory (audit targets)

**JSONL-clean candidates (verify + keep clean)**
- `tools/build/lmdb-index.js`
- `tools/build/tantivy-index.js`
- `tools/build/sqlite-index.js` (and `tools/build/sqlite/runner.js`)
- `tools/ci/build-artifacts.js`
- `tools/download/extensions.js`

**Mixed emitters (must be cleaned for JSONL mode)**
- `build_index.js` (JSONL + raw stderr writes)
- `tools/bench/language-repos.js` and `tools/bench/language/process.js` (JSONL + raw lines)

**No progress flags yet (must add + normalize)**
- `tools/setup/setup.js`
- `tools/setup/bootstrap.js`
- `tools/tooling/install.js`
- `tools/tooling/detect.js`

### 20.0.0.1 JSON stdout inventory (must audit child stdio)
Scope: tools with `--json` that emit JSON to stdout. Goal: ensure child processes never run with `stdio: 'inherit'` when JSON is expected.

**JSON stdout + child processes (direct or indirect)**
- `build_index.js` (verify nested runners do not inherit)
- `tools/setup/setup.js` (child via `runCommandBase`)
- `tools/setup/bootstrap.js` (child via `runCommand/runCommandOrExit`)
- `tools/tooling/install.js` (child via `spawnSync`)
- `tools/triage/context-pack.js` (child via `spawnSubprocessSync`)
- `tools/ci/run-suite.js` (child via `spawnSubprocess`)
- `tools/reports/combined-summary.js` (child via `spawnSubprocessSync`)
- `tools/reports/compare-models.js` (child via `spawnSubprocessSync`)
- `tools/reports/report-code-map.js` (child via `spawnSync('dot')`)
- `tools/bench/vfs/cold-start-cache.js` (child via `spawnSync`)
- `tools/ingest/ctags.js` (child via `spawn`)
- `tools/ingest/gtags.js` (child via `spawn`)
- `tools/ingest/scip.js` (child via `spawn`)
- `tools/bench/language-repos.js` (child via `tools/bench/language/process.js`)
- `tools/bench/language/process.js` (spawns benchmark jobs; must be JSONL-safe)

**JSON stdout + no direct child spawn detected**
- `tools/analysis/structural-search.js`
- `tools/analysis/explain-risk.js`
- `tools/eval/run.js`
- `tools/index/validate.js`
- `tools/index/cache-gc.js`
- `tools/index/report-artifacts.js`
- `tools/sqlite/verify-extensions.js`
- `tools/tooling/doctor.js`
- `tools/tooling/detect.js`
- `tools/config/validate.js`
- `tools/config/dump.js`
- `tools/config/reset.js`
- `tools/reports/metrics-dashboard.js`
- `tools/bench/language/cli.js`
- `tools/bench/dict-seg.js`
- `tools/bench/query-generator.js`
- `tools/bench/symbol-resolution-bench.js`
- `tools/bench/map/build-map-memory.js`
- `tools/bench/map/build-map-streaming.js`
- `tools/bench/micro/hash.js`
- `tools/bench/micro/watch.js`
- `tools/bench/micro/extractors.js`
- `tools/bench/micro/tinybench.js`
- `tools/bench/micro/compression.js`
- `tools/bench/micro/run.js`
- `tools/bench/micro/regex.js`
- `tools/bench/vfs/bloom-negative-lookup.js`
- `tools/bench/vfs/cdc-segmentation.js`
- `tools/bench/vfs/coalesce-docs.js`
- `tools/bench/vfs/hash-routing-lookup.js`
- `tools/bench/vfs/io-batching.js`
- `tools/bench/vfs/parallel-manifest-build.js`
- `tools/bench/vfs/partial-lsp-open.js`
- `tools/bench/vfs/merge-runs-heap.js`
- `tools/bench/vfs/token-uri-encode.js`
- `tools/bench/vfs/vfsidx-lookup.js`
- `tools/bench/vfs/segment-hash-cache.js`
- `tools/ingest/lsif.js`

**JSON file writers or pass-through (not stdout)**
- `tools/docs/script-inventory.js`
- `tools/docs/repo-inventory.js`
- `tools/ci/capability-gate.js`
- `tools/mcp/tools/search-args.js`
- `tools/mcp/tools/handlers/downloads.js`
- `tools/mcp/tools/handlers/artifacts.js`
- `tools/api/server.js` / `tools/api/router/search.js`

Action: for each child tool above, enforce piped stdio in JSON modes and add regression tests in 20.0.T2/20.0.T4.

### 20.0.1 Define the TUI tool contract and audit tool surfaces
- Add spec: `docs/specs/tui-tool-contract.md` defining flags, stdout/stderr rules, exit codes, and cancellation.
- Inventory the top-level scripts the TUI will drive:
  - `build_index.js`
  - `tools/bench/language-repos.js` (+ `tools/bench/language/process.js`)
  - `tools/setup/setup.js`
  - `tools/setup/bootstrap.js`
  - support tools invoked by the above where JSON is expected
- Add a developer note in `docs/`:
  - stdout is data, stderr is humans/protocol
  - how to register new commands in the dispatch registry

### 20.0.2 Unify process-tree termination into `src/shared/`
Problem today: multiple kill-tree implementations with inconsistent behavior.

**Code**
- Add `src/shared/kill-tree.js` exporting:
  - `killProcessTree(pid, opts) -> Promise<{terminated:boolean, forced:boolean, method?:string}>`
  - `killChildProcessTree(child, opts)`
- Windows semantics:
  1) `taskkill /PID <pid> /T` (no `/F`)
  2) wait `graceMs`
  3) `taskkill /PID <pid> /T /F`
- POSIX semantics:
  1) send `killSignal` to `-pid` when `useProcessGroup===true`, else `pid`
  2) wait `graceMs`
  3) send `forceSignal`
- Refactor call sites:
  - `src/shared/subprocess.js`
  - `tests/helpers/kill-tree.js` (re-export or delete)
  - `tests/runner/run-execution.js`
  - `tools/bench/language/process.js`
  - `tools/bench/language-repos.js`
- Docs to update:
  - `docs/specs/subprocess-helper.md`
  - `docs/testing/test-runner-interface.md`
  - `docs/language/benchmarks.md`

### 20.0.3 Refactor `build_index.js` for clean JSONL and stable final output
- In JSONL mode: no raw stderr writes; everything via protocol events.
- In JSON mode: stdout emits exactly one JSON summary object.
- On cancel: exit 130 and emit `job:end status="cancelled"`.

### 20.0.4 Refactor bench harness for TUI compatibility
- Use shared progress-stream decoder.
- Replace local kill-tree with `src/shared/kill-tree.js`.
- Gate any raw `console.error` in JSONL mode.

### 20.0.5 Refactor `tools/setup/setup.js` for supervisor-friendly behavior
- Add `--progress`, `--verbose`, `--quiet` flags.
- Route logs via `createDisplay`.
- Ensure child commands use piped stdio in JSON modes.
- Propagate `--progress jsonl` to children when in JSONL mode.

### 20.0.6 Refactor `tools/setup/bootstrap.js` similarly
- Same stdout/stderr discipline and progress propagation as setup.

### 20.0.7 Normalize log routing and output safety across toolchain
- Ensure tools invoked by setup/bootstrap use `createDisplay` and JSONL-safe stderr.
- Add `src/shared/cli/stdout-guard.js` (fail fast if stdout is polluted in JSON mode).

#### 20.0 Testing
- 20.0.T1 kill-tree unit tests (POSIX + Windows).
- 20.0.T2 tool contract tests (stdout/stderr discipline).
- 20.0.T3 clean JSONL regression tests (build_index + bench).
- 20.0.T4 decoder line-size cap test.
- 20.0.T5 context propagation test.

---

## Sub-phase 20.1: Protocol v2, context propagation, and shared decoder

### 20.1.1 Progress protocol v2
- Spec: `docs/specs/progress-protocol-v2.md`
- Event types: `log`, `task:start`, `task:progress`, `task:end`, `job:start`, `job:spawn`, `job:end`, `job:artifacts`
- Require `seq` monotonicity per job if `jobId` exists.
- Provide concrete JSONL examples for each event type.
- Touchpoints for `seq` and `ts`:
  - `src/shared/cli/progress-events.js`
  - `src/shared/cli/display.js`
  - `src/shared/cli/progress-stream.js`
  - `tools/tui/supervisor.js`
  - `tools/bench/language/process.js`
  - `tools/bench/language-repos.js`

### 20.1.2 Context propagation
- `src/shared/cli/display.js` reads `PAIROFCLEATS_PROGRESS_CONTEXT`.
- Ensure merged context is included in all JSONL events.
- Add env var to `src/shared/env.js` allowlist.
- Document in `docs/config/contract.md`.

### 20.1.3 Shared stream decoder
- Add `src/shared/cli/progress-stream.js`:
  - chunk -> line normalization
  - strict parse or wrap as `log`
  - enforce `maxLineBytes`

#### 20.1 Tests
- 20.1.T1 strict parser unit tests.
- 20.1.T2 stream decoder chunk boundary tests.
- 20.1.T3 clean JSONL regression tests.
- 20.1.T4 line-size cap test.
- 20.1.T5 context propagation test.

---

## Sub-phase 20.2: Node supervisor MVP

### 20.2.1 Supervisor protocol (spec)
- Add `docs/specs/node-supervisor-protocol.md`:
  - ops: `hello`, `job:run`, `job:cancel`, `shutdown`
  - events: `supervisor:hello`, `job:start`, `job:spawn`, `job:end`, passthrough `task:*` and `log`
  - `supervisor:hello` includes versions, capabilities, and protocol ids

### 20.2.2 Implementation: `tools/tui/supervisor.js`
- Job table with abort controllers, pid, status, seq.
- Spawn with `stdio: ['ignore','pipe','pipe']` and detached groups on POSIX.
- Use shared progress-stream decoder to emit strict JSONL.
- Buffer stdout for JSON result capture (bounded).
- On shutdown: cancel jobs, wait bounded time, force-exit if needed.

### 20.2.3 Dispatch refactor + search reconciliation
- Create `src/shared/dispatch/` (registry, resolve, env, manifest).
- Update `bin/pairofcleats.js` and `tools/tui/supervisor.js` to use shared dispatch.
- Search passthrough: remove backend allowlist and validation; pass args through.
- Add dispatch manifest commands:
  - `pairofcleats dispatch list --json`
  - `pairofcleats dispatch describe <command> --json`
- Add strict mode: `PAIROFCLEATS_DISPATCH_STRICT=1`.

### 20.2.4 Supervisor artifacts indexing pass
- Emit `job:artifacts` after `job:end`.
- Stat only known paths (no repo globbing).
- Job-specific extractors for build, search, setup, bench.

#### 20.2 Tests
- 20.2.T1 supervisor stream discipline.
- 20.2.T2 cancellation integration.
- 20.2.T3 env parity vs CLI dispatch.
- 20.2.T4 artifacts pass smoke.
- 20.2.T5 dispatch manifest tests.
- 20.2.T6 search flag passthrough.

---

## Sub-phase 20.3: Rust Ratatui TUI skeleton

### 20.3.1 Crate and core architecture
- `crates/pairofcleats-tui/` with `ratatui`, `crossterm`, `tokio`, `serde`, `serde_json`, `anyhow`.
- Modules: `protocol/`, `supervisor/`, `model/`, `ui/`, `app.rs`.
- Command palette sourced from dispatch manifest (no hard-coded list).

### 20.3.2 Supervisor integration
- Spawn `node tools/tui/supervisor.js` with piped stdio.
- Handshake and validate protocol version.
- Async reader/writer tasks; restart supervisor safely on crash.

### 20.3.3 UI behaviors (MVP)
- Job list + tasks table + logs + optional artifacts panel.
- Keybindings: `r` run palette, `c` cancel, `q` quit, `?` help overlay.
- Ensure TUI never relies on subprocess TTY.

#### 20.3 Tests
- 20.3.T1 protocol decoding tests (Rust).
- 20.3.T2 headless smoke test.
- 20.3.T3 cancel path integration.

---

## Sub-phase 20.4: Cancellation hardening

### 20.4.1 Supervisor escalation policies
- Use shared kill-tree semantics; emit termination metadata.

### 20.4.2 UI shutdown correctness
- On `q`: cancel all jobs, wait bounded time, shutdown supervisor, restore terminal.
- On `Ctrl+C`: first press cancels, second press force-exits after restore.

### 20.4.3 Never-hang guarantees
- Watchdog timeouts for supervisor and job shutdown.
- Hard cap on shutdown time (e.g., 10s).

#### 20.4 Tests
- 20.4.T1 ignore SIGTERM fixture.
- 20.4.T2 UI dies mid-job fixture.

---

## Sub-phase 20.5: Install/distribution (compile-on-install + prebuilt fallback)

### 20.5.1 Installer + wrapper
- Implement `tools/tui/install.js` with secure prebuilt fallback.
- Implement `bin/pairofcleats-tui.js` wrapper.
- Update `package.json` to expose `pairofcleats-tui`.
- Docs: `docs/guides/commands.md`, `docs/guides/tui.md`.

### 20.5.2 CI pipeline for artifacts
- Build for win32-x64, linux-x64, darwin-x64/arm64 if supported.
- Upload binaries + sha256 + manifest.

#### 20.5 Tests
- 20.5.T1 installer unit tests.
- 20.5.T2 wrapper behavior tests.

---

## Appendix B — HAWKTUI Roadmap (verbatim)

# Roadmap — Rust Ratatui TUI + Node Supervisor

## Phase: Terminal-owned TUI driving repo tooling (Supervisor MVP → shipped binary)

### Objective
Deliver a **standalone Rust Ratatui TUI** that owns the terminal and drives existing Node scripts through a **Node supervisor** with a **strict, versioned JSONL protocol** for tasks/logs/results, including **correct cancellation + process-tree cleanup** across platforms.

### Goals
- A single UI-driven entrypoint that can (at minimum):
  - run core jobs (`setup`, `bootstrap`, `index build`, `search`, and bench harness jobs)
  - display streaming tasks and logs from **nested subprocess trees**
  - cancel jobs safely and predictably
- A formal, versioned JSONL protocol boundary:
  - **Progress** as JSONL events (line-delimited)
  - **Final result** as either a typed terminal event (`job:end` with `result`) or a machine JSON blob on stdout (captured by supervisor)
- Shared, tested line decoding and event parsing logic (no ad‑hoc “split on \n” everywhere)
- Optional compile-on-install with secure prebuilt binary fallback
- No terminal corruption: raw mode restored, child processes terminated on exit

### Non-goals
- Replacing all existing CLI commands immediately
- Making every script “pure JSONL” in all modes (only in explicit `--progress jsonl` / supervisor mode)
- Distributed or remote execution, resumable job queues, or multi-user concurrency
- A full interactive editor for every config file on day one (MVP focuses on robust job-running + visibility)

### Constraints / invariants
- **Rust TUI owns the terminal**: no spawned job may assume it owns the TTY.
- The supervisor must treat all non-protocol output as logs (never “best effort parse random JSON”).
- Cancellation must be **tree-aware**:
  - Windows: `taskkill /T` then escalate to `/F`
  - POSIX: signal the process group (negative PID) when detached
- `--json` outputs must be **stdout-only** (no additional stdout noise); logs and progress go to stderr/protocol.

### Locked decisions (remove ambiguity)
- **Cancel exit code**: tools invoked under the supervisor must exit **130** on user‑initiated cancel (SIGINT/SIGTERM are normalized to 130).
- **Progress protocol**: v2 events must include `proto: "poc.progress@2"` and `event` (allowlist defined in v2 spec).
- **JSONL mode**: when `--progress jsonl`, stderr must emit **only** protocol events (no raw human lines).
- **JSON output**: when `--json`, stdout emits exactly **one** JSON object; stderr carries logs/progress only.
- **Event ordering**: every protocol event includes `ts` (ISO string) and a monotonic `seq` (per-job when `jobId` is present, else per-process).
- **POSIX kill**: if `detached === true`, kill process group (`-pid`); else kill single PID.
- **Job artifacts**: supervisor emits a `job:artifacts` event after `job:end` with a stable artifact list; artifacts include `kind`, `label`, `path`, `exists`, `bytes`, `mtime`, `mime`.
- **Search dispatch**: `bin/pairofcleats.js` must **not** reject valid search flags or backends; it passes all args through to `search.js`.
- **Spec file locations** (new):
  - `docs/specs/tui-tool-contract.md`
  - `docs/specs/progress-protocol-v2.md`
  - `docs/specs/node-supervisor-protocol.md`
  - `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`
  - `docs/specs/supervisor-artifacts-indexing-pass.md`
  - `docs/specs/tui-installation.md`

### Related but out-of-scope specs
- `docs/specs/spimi-spill.md` (indexing perf roadmap; not part of TUI milestone work)

### Implementation order (dependency-aware, cross‑cutting first)
**Foundational work (must land first)**
1) **Sub‑phase 0.2 + 1.1–1.3**: shared kill‑tree, strict protocol v2, shared stream decoder, stdout guard.
2) **Sub‑phase 0.3–0.7**: tool JSONL/JSON hygiene + bench/setup/bootstrap refactors (can proceed in parallel per tool).

**Core runtime**
3) **Sub‑phase 2.1–2.2**: supervisor protocol + implementation.
4) **Sub‑phase 2.3–2.4**: dispatch refactor + artifacts pass (needs protocol + manifest fields defined).

**Product layer**
5) **Sub‑phase 3**: Rust TUI MVP (can start once protocol/manifest shapes are locked; can use mocked supervisor streams).
6) **Sub‑phase 4**: cancellation hardening (depends on supervisor + UI).
7) **Sub‑phase 5**: installation + distribution (can start once crate skeleton exists).

### Parallelization map (non‑overlapping work)
- **Track A (protocol + helpers)**: Sub‑phase 0.2, 1.1–1.3, plus 0.7 stdout guard.
- **Track B (tool hygiene)**: Sub‑phase 0.3–0.6 can be split by tool family:
  - B1: `build_index.js` + `tools/setup/*`
  - B2: bench harness (`tools/bench/language-*`)
  - B3: support tools invoked by setup/bench (`tools/tooling/*`, downloads)
- **Track C (dispatch)**: Sub‑phase 2.3 can proceed in parallel with Track B once protocol shapes are fixed.
- **Track D (supervisor core)**: Sub‑phase 2.2 can proceed in parallel with Track C (needs protocol + kill‑tree only).
- **Track E (Rust TUI)**: Sub‑phase 3 can begin after 2.1 spec + manifest field list are frozen (mock data OK).
- **Track F (install/dist)**: Sub‑phase 5 can begin after 3.1 crate skeleton (no dependency on supervisor runtime).

### Dependency matrix (phase → prerequisites)
| Phase / Sub‑phase | Requires | Notes |
|---|---|---|
| 0.1 TUI tool contract | — | Spec + audit only |
| 0.2 Kill‑tree unify | — | Hard dependency for supervisor + cancellation |
| 0.3 build_index JSONL cleanup | 0.2 (kill‑tree) | For abort correctness |
| 0.4 bench harness cleanup | 0.2 + 1.1/1.3 | Uses shared decoder + kill‑tree |
| 0.5 setup cleanup | 1.1/1.2 | Needs progress context + protocol strictness |
| 0.6 bootstrap cleanup | 1.1/1.2 | Same as setup |
| 0.7 stdout guard | — | Can ship early; used by all |
| 1.1 protocol v2 spec | — | Foundation for 1.2/1.3 |
| 1.2 context propagation | 1.1 | Adds env + display wiring |
| 1.3 progress stream decoder | 1.1 | Used by bench + supervisor |
| 2.1 supervisor protocol spec | 1.1 | Requires v2 protocol definitions |
| 2.2 supervisor implementation | 0.2 + 1.1–1.3 | Needs kill‑tree + decoder |
| 2.3 dispatch refactor | 1.1 | Needs stable manifest fields |
| 2.4 artifacts pass | 2.2 + 2.3 | Uses dispatch registry + job lifecycle |
| 3.1 Rust crate skeleton | — | Can begin early |
| 3.2 supervisor integration | 2.2 | Needs working supervisor |
| 3.3 UI behaviors | 3.1 + 2.3 | Needs manifest fields for palette |
| 4.1–4.3 cancellation hardening | 2.2 + 3.2 | Requires live supervisor + UI |
| 5.1 install + wrapper | 3.1 | Needs crate skeleton |
| 5.2 CI artifacts | 5.1 | Depends on build outputs |

### Cross-cutting constraints (apply to all phases)
- **Protocol strictness**: if a line is not v2 JSONL, it must be wrapped as a `log` event.
- **Line length cap**: enforce a maximum line size (e.g., 1MB) in the shared decoder to prevent memory blowups.
- **Stdout discipline**: any tool that writes JSON to stdout must never run children in `stdio: 'inherit'`.
- **Test determinism**: tests must run without network access unless explicitly mocked.

---

## Sub-phase 0: Preparation — Tooling normalization + kill-tree unification

### Objective
Before introducing the supervisor/TUI, make the existing CLI tools behave **ideally** for a terminal-owned orchestrator:
- deterministic **non-interactive** execution paths
- clean separation of **stdout JSON** vs **stderr logs/progress**
- consistent **progress JSONL** emission (or at least no JSON ambiguity)
- unified, shared **process-tree termination** logic used everywhere (src/tools/tests)

### Why this must come first
The supervisor + TUI cannot be “correct by construction” if:
- tools write JSON summaries to stdout while child installers also write to stdout (breaks parsing)
- cancellation uses multiple incompatible kill-tree implementations
- tools rely on `stdio: 'inherit'` and assume they own the terminal

### 0.0 Current-state inventory (audit targets)
Use this list to remove ambiguity about which tools already emit JSONL progress and which still need cleanup.

**JSONL-clean candidates (verify + keep clean)**
- `tools/build/lmdb-index.js`
- `tools/build/tantivy-index.js`
- `tools/build/sqlite-index.js` (and `tools/build/sqlite/runner.js`)
- `tools/ci/build-artifacts.js`
- `tools/download/extensions.js`

**Mixed emitters (must be cleaned for JSONL mode)**
- `build_index.js` (JSONL + raw stderr writes)
- `tools/bench/language-repos.js` and `tools/bench/language/process.js` (JSONL + raw lines)

**No progress flags yet (must add + normalize)**
- `tools/setup/setup.js`
- `tools/setup/bootstrap.js`
- `tools/tooling/install.js` and `tools/tooling/detect.js` (when invoked by setup/bootstrap)

### 0.0.1 JSON stdout inventory (must audit child stdio)
**Scope**: tools with `--json` (or `--format json`) that **emit JSON to stdout**.  
**Goal**: verify any child process use **never** runs with `stdio: 'inherit'` when JSON is expected.

**JSON stdout + child processes (direct or indirect)**
- `build_index.js` (JSON stdout; **no direct spawn**, but verify any nested runners do not inherit)
- `tools/setup/setup.js` (**child: yes** via `runCommandBase`; defaults to `stdio: 'inherit'` unless JSON)
- `tools/setup/bootstrap.js` (**child: yes** via `runCommand/runCommandOrExit`; uses `stdio: 'inherit'` today)
- `tools/tooling/install.js` (**child: yes** via `spawnSync`, currently uses `stdio: 'inherit'`)
- `tools/triage/context-pack.js` (**child: yes** via `spawnSubprocessSync` → `search.js`)
- `tools/ci/run-suite.js` (**child: yes** via `spawnSubprocess`)
- `tools/reports/combined-summary.js` (**child: yes** via `spawnSubprocessSync`)
- `tools/reports/compare-models.js` (**child: yes** via `spawnSubprocessSync`)
- `tools/reports/report-code-map.js` (**child: yes** via `spawnSync('dot', ...)`)
- `tools/bench/vfs/cold-start-cache.js` (**child: yes** via `spawnSync`)
- `tools/ingest/ctags.js` (**child: yes** via `spawn`)
- `tools/ingest/gtags.js` (**child: yes** via `spawn`)
- `tools/ingest/scip.js` (**child: yes** via `spawn`)
- `tools/bench/language-repos.js` (**child: yes**, indirect via `tools/bench/language/process.js`)
- `tools/bench/language/process.js` (not JSON tool itself, but spawns benchmark jobs and must be JSONL‑safe)

**JSON stdout + no direct child spawn detected**
- `tools/analysis/structural-search.js` (JSON or JSONL via `--format`)
- `tools/analysis/explain-risk.js`
- `tools/eval/run.js`
- `tools/index/validate.js`
- `tools/index/cache-gc.js`
- `tools/index/report-artifacts.js`
- `tools/sqlite/verify-extensions.js`
- `tools/tooling/doctor.js`
- `tools/tooling/detect.js`
- `tools/config/validate.js`
- `tools/config/dump.js`
- `tools/config/reset.js`
- `tools/reports/metrics-dashboard.js`
- `tools/bench/language/cli.js`
- `tools/bench/dict-seg.js`
- `tools/bench/query-generator.js`
- `tools/bench/symbol-resolution-bench.js`
- `tools/bench/map/build-map-memory.js`
- `tools/bench/map/build-map-streaming.js`
- `tools/bench/micro/hash.js`
- `tools/bench/micro/watch.js`
- `tools/bench/micro/extractors.js`
- `tools/bench/micro/tinybench.js`
- `tools/bench/micro/compression.js`
- `tools/bench/micro/run.js`
- `tools/bench/micro/regex.js`
- `tools/bench/vfs/bloom-negative-lookup.js`
- `tools/bench/vfs/cdc-segmentation.js`
- `tools/bench/vfs/coalesce-docs.js`
- `tools/bench/vfs/hash-routing-lookup.js`
- `tools/bench/vfs/io-batching.js`
- `tools/bench/vfs/parallel-manifest-build.js`
- `tools/bench/vfs/partial-lsp-open.js`
- `tools/bench/vfs/merge-runs-heap.js`
- `tools/bench/vfs/token-uri-encode.js`
- `tools/bench/vfs/vfsidx-lookup.js`
- `tools/bench/vfs/segment-hash-cache.js`
- `tools/ingest/lsif.js`

**JSON file writers or pass-through (not stdout)**
- `tools/docs/script-inventory.js` (writes JSON file)
- `tools/docs/repo-inventory.js` (writes JSON file)
- `tools/ci/capability-gate.js` (writes JSON file)
- `tools/mcp/tools/search-args.js` (builds args; no stdout JSON)
- `tools/mcp/tools/handlers/downloads.js` (passes `--json` to verify-extensions)
- `tools/mcp/tools/handlers/artifacts.js` (passes `--json` to cache-gc)
- `tools/api/server.js` / `tools/api/router/search.js` (server/pass-through)

**Action**: for each **child** tool above, enforce piped stdio in JSON modes and add a regression test in Sub‑phase 0.T2/0.T4.

### Tasks

#### 0.1 Define the “TUI-ready tool contract” and audit tool surfaces
- **(Spec)** Add a spec: `docs/specs/tui-tool-contract.md`  
  - Define required behaviors for any tool the TUI will run:
    - Flags: `--progress {off,log,tty,jsonl,auto}`, `--json`, `--non-interactive` (where relevant)
    - Output rules:
      - stdout: **only** final machine output when `--json`
      - stderr: logs/progress (and in JSONL mode, only protocol events)
    - Exit codes:
      - success: 0
      - cancelled: **130** (standardized for all supervisor‑invoked tools)
      - “expected failures” vs “tool bug” (document what is what)
    - Cancellation:
      - tools must respond to SIGINT/SIGTERM by aborting ongoing work, then exiting promptly
      - nested child processes must be terminated as a tree
- **(Code audit)** Inventory the top-level scripts the TUI will drive in Milestone 1 and enumerate required changes:
  - `build_index.js`
  - `tools/bench/language-repos.js` (+ `tools/bench/language/process.js`)
  - `tools/setup/setup.js`
  - `tools/setup/bootstrap.js`
  - “support tools” invoked by the above where `--json` is expected to be consumed:
    - `tools/tooling/install.js`
    - `tools/download/dicts.js`
    - `tools/download/models.js`
    - any script that currently emits JSON on stdout while using `stdio:'inherit'` for child processes
- **(Doc)** Add a short developer note in `docs/` describing:
  - “stdout is for data, stderr is for humans/protocol”
  - where to add new commands to the dispatch registry

#### 0.2 Unify process-tree termination into `src/shared/` and update all call sites
**Problem today**
- `src/shared/subprocess.js` kills Windows trees with immediate `/F`.
- `tests/helpers/kill-tree.js` does a staged graceful→forced kill.
- `tools/bench/language/process.js` has its own reduced kill helper and on POSIX it does **not** kill process groups.

**(Code)** Create a single shared implementation:
  - Add `src/shared/kill-tree.js` exporting:
  - `killProcessTree(pid, opts) -> Promise<{terminated:boolean, forced:boolean, method?:string}>`
  - `killChildProcessTree(child, opts) -> Promise<...>` convenience (accepts `ChildProcess`)
  - Options:
    - `graceMs` (default 2000–5000, consistent with existing defaults)
    - `killSignal` (default `SIGTERM` on POSIX)
    - `forceSignal` (default `SIGKILL` on POSIX)
    - `useProcessGroup` / `detached` behavior (to decide `pid` vs `-pid`)
- Implement semantics:
  - **Windows**
    1) run `taskkill /PID <pid> /T` (no `/F`)
    2) wait `graceMs`
    3) run `taskkill /PID <pid> /T /F`
    4) return `{terminated, forced}`
  - **POSIX**
    1) send `killSignal` to **`-pid` when `useProcessGroup === true`**, else `pid`
    2) wait `graceMs`
    3) if still running, send `forceSignal` to same target
    4) return `{terminated, forced}`
- **(Refactor)** Replace kill logic in `src/shared/subprocess.js`
  - Remove the internal `killProcessTree(child, ...)` function.
  - Import the shared helper and call it on timeout/abort (fire-and-forget is acceptable; correctness is the priority).
  - Preserve current behavior regarding process groups:
    - default `detached=true` on POSIX
    - when `killTree !== false` and `detached===true`, use `useProcessGroup=true`
- **(Refactor)** Update all call sites that currently use either implementation:

  **Call sites to update (with current locations)**
  - `src/shared/subprocess.js`  
    - internal kill-tree function at/near line ~103; invoked on timeout/abort at/near lines ~268 and ~284.
  - `tests/helpers/kill-tree.js`  
    - staged kill-tree implementation; replace with a re-export from `src/shared/kill-tree.js` or delete and update imports.
    - `tests/runner/run-execution.js`  
      - imports `../helpers/kill-tree.js` and calls it during timeout (at/near line ~105).
  - `tools/bench/language/process.js`  
    - local `killProcessTree(pid)` (at/near line ~29); replace with shared helper and ensure POSIX uses process groups.
    - `tools/bench/language-repos.js`  
      - SIGINT/SIGTERM handlers call `processRunner.killProcessTree(active.pid)` (at/near lines ~236 and ~246); ensure this uses the shared helper.

- **(Doc)** Update any docs that describe kill semantics to reference the new shared module:
  - `docs/specs/subprocess-helper.md`
  - `docs/testing/test-runner-interface.md`
  - `docs/language/benchmarks.md`

**Primary touchpoints**
- `src/shared/kill-tree.js` (new)
- `src/shared/subprocess.js` (refactor)
- `tests/helpers/kill-tree.js` → re-export or delete
- `tests/runner/run-execution.js`
- `tools/bench/language/process.js`
- `tools/bench/language-repos.js`

#### 0.3 Refactor `build_index.js` for “clean JSONL” and stable final output
**Current issues**
- `build_index.js` uses `createDisplay(... progressMode: argv.progress ...)` (good), but also writes human summary lines directly to stderr after closing display (`DONE_LABEL`, detail lines).
- In `--progress jsonl`, those direct writes become “stray non-protocol lines” (the supervisor can wrap them, but this is not ideal).

**(Code)** Changes in `build_index.js`
- Add a single “output mode resolver”:
  - if `argv.progress === 'jsonl'`: **no raw stderr writes**; everything goes through `display.*` or protocol events.
  - if `argv.json === true`: stdout emits a single JSON summary object (see contract), stderr emits logs/progress only.
- Replace the post-close `writeLine()` summary behavior:
  - In JSONL mode:
    - emit a **`job:end`** protocol event with `result.summary` (no raw stderr lines).
  - In human/TTY mode:
    - keep the colored DONE banner.
- Ensure cancellation semantics are stable:
  - SIGINT/SIGTERM should set abort signal (already does)
  - on abort, exit **130** and emit a final `job:end` with `status:"cancelled"`

**Primary touchpoints**
- `build_index.js`
- `src/shared/cli/display.js`
- `src/shared/cli/progress-events.js`

#### 0.4 Refactor bench harness for TUI compatibility (`tools/bench/language-repos.js`)
**Current issues**
- Cancellation path uses the bench runner’s local kill helper which is not process-group aware on POSIX.
- The runner parses progress events using the current `parseProgressEventLine(line)` without a strict protocol marker.
- End-of-run `console.error(...)` summaries may still print even when in JSONL mode (should route via display or be gated).

**(Code)** Changes in:
- `tools/bench/language/process.js`
  - Replace chunk→line logic with shared `progress-stream` module once introduced (or implement a minimal shared decoder now).
  - Replace local kill-tree with `src/shared/kill-tree.js`.
  - Ensure parse rule becomes: **progress JSONL or wrap as log**.
- `tools/bench/language-repos.js`
  - Gate any raw `console.error` emissions when `argv.progress === 'jsonl'`:
    - replace with `display.log/error` so they are protocol events only
- Ensure JSON output (`--json`) remains stdout‑only and contains no interleaved junk.

**Primary touchpoints**
- `tools/bench/language-repos.js`
- `tools/bench/language/process.js`
- `src/shared/cli/progress-stream.js`

#### 0.5 Refactor `tools/setup/setup.js` to be “supervisor-friendly”
**Current issues**
- In `--json` mode, it tends to run child commands with `stdio:'pipe'`, which hides streaming progress.
- In non-JSON mode it uses `stdio:'inherit'`, which is incompatible with the “stdout-only JSON” contract if we want both streaming logs and a JSON summary.
- It uses a sync-ish command runner (`tools/cli-utils.js`) rather than a streaming runner.

**(Code)** Changes in `tools/setup/setup.js`
- Add `--progress`, `--verbose`, `--quiet` flags (mirror other tools).
- Create a `display = createDisplay({ progressMode: argv.progress, ... })` (stderr).
- Replace `log()/warn()` to route through `display.log/warn/error`.
- Refactor command execution to preserve stdout-only JSON:
  - Run child commands with `stdio: ['ignore','pipe','pipe']`.
  - Stream child stdout/stderr into `display` (so the user sees progress/logs in TUI).
  - Capture child stdout only when we explicitly need to parse it (e.g., `tooling-detect --json`).
- Ensure all child node tools are invoked with `--progress jsonl` when the parent is in JSONL mode (propagate progress mode).

**(Optional but ideal)** Split setup into:
- `setup --plan --json` (no side effects; returns structured plan)
- `setup --apply --json` (executes selected steps)
This enables the TUI to present/edit the plan before applying.

#### 0.6 Refactor `tools/setup/bootstrap.js` similarly
- Add `--progress`, `--json`, and ensure:
  - stdout JSON (if requested) is clean
  - child command outputs do not leak to stdout
  - progress is emitted as JSONL when requested
- Replace `stdio:'inherit'` child runs with pipe+forwarding (same reasoning as setup).

**Primary touchpoints**
- `tools/setup/setup.js`
- `tools/setup/bootstrap.js`
- `tools/tooling/install.js`
- `tools/tooling/detect.js`

#### 0.7 Normalize log routing and output safety across toolchain
- **(Code)** Ensure all tools invoked by setup/bootstrap (tooling install/detect, downloads) use:
  - `createDisplay()` for logs/progress
  - `--progress jsonl` pass-through
  - stderr-only output in JSONL mode
- **(Code)** Add a small helper to enforce “stdout is data”:
  - e.g., `src/shared/cli/stdout-guard.js` with a `withJsonStdoutGuard(fn)` wrapper
  - fail fast if any non-JSON bytes are written to stdout in `--json` mode

---

### Testing

#### 0.T1 Unit tests: kill-tree behavior (shared helper)
- **New test file(s)** (Node):
  - `tests/shared/kill-tree.posix.test.js` (skipped on win32)
  - `tests/shared/kill-tree.windows.test.js` (skipped on non-win32)
- **What to test**
  - POSIX: spawn a detached process group that ignores SIGTERM for a short interval, assert:
    - first SIGTERM sent, then SIGKILL after grace
    - return `{terminated:true, forced:true}`
  - Windows: spawn a child that spawns a grandchild, assert:
    - `taskkill /T` terminates tree (or `/F` after grace)
    - return values match reality (best-effort; Windows is inherently variable)
- **Pass criteria**
  - Tests do not leak orphan processes after completion.
  - Helper returns consistent termination metadata across platforms.

#### 0.T2 Tool contract tests (stdout/stderr discipline)
- **New integration tests**
  - `tests/tools/setup-json-output.test.js`
  - `tests/tools/bootstrap-json-output.test.js`
- **What to test**
  - Run each tool with `--json --non-interactive --progress jsonl` (or equivalent):
    - Assert stdout parses as a **single JSON document** (no extra lines).
    - Assert stderr is either:
      - valid JSONL protocol lines only (once protocol v2 lands), or
      - at minimum does not contain stdout JSON fragments.
- **Pass criteria**
  - Machine output is stable and parseable.
  - Progress/log output is streamable and does not corrupt stdout.

#### 0.T3 Bench harness cancellation regression
- **Test**: run a fixture bench job that spawns a long-lived child; send SIGTERM to parent; ensure tree terminates.
- **Pass criteria**
  - Bench script exits with the configured “cancelled” exit code.
  - No leftover child processes remain.

#### 0.T4 Tool stdout/stderr separation guards
- Add regression tests for setup/bootstrap/build_index in `--json` mode:
  - ensure stdout is a single JSON object
  - ensure stderr contains logs/progress only

---

## Sub-phase 1: Formalize progress protocol + shared parsing (strict boundary)

### Objective
Turn the existing “parse JSON else treat as log” convention into a **strict, versioned protocol** that:
- never misclassifies random JSON as a progress event
- carries enough context for supervision (jobId/runId)
- is reusable across Node scripts and the Rust TUI

### Tasks

#### 1.1 Progress protocol v2 (spec + enforcement)
- **(Spec)** Add `docs/specs/progress-protocol-v2.md`
  - Require:
    - `proto: "poc.progress@2"`
    - event allowlist (at minimum): `task:start`, `task:progress`, `task:end`, `log`, plus `job:*` events for supervisor (including `job:artifacts`)
    - field requirements per event type
    - rule: *one JSON object per line; no multi-line JSON in protocol stream*
  - Define how job/task identity is represented:
    - `jobId` (required for any event emitted under supervisor)
    - `runId` (optional but recommended for end-to-end correlation)
    - `taskId` uniqueness within a job
  - Define required fields per event type (minimum):
    - `log`: `level`, `message`, `stream`, `ts`, `seq`, `jobId?`, `taskId?`
    - `task:start`: `taskId`, `name`, `stage`, `ts`, `seq`, `jobId`
    - `task:progress`: `taskId`, `current`, `total`, `unit?`, `percent?`, `ts`, `seq`, `jobId`
    - `task:end`: `taskId`, `status`, `durationMs?`, `error?`, `ts`, `seq`, `jobId`
    - `job:start`: `jobId`, `command`, `args`, `cwd`, `ts`, `seq`
    - `job:end`: `jobId`, `status`, `exitCode`, `durationMs`, `result?`, `ts`, `seq`
    - `job:artifacts`: `jobId`, `artifacts[]`, `ts`, `seq`
  - Require `seq` monotonicity **per job** (if `jobId` exists) to allow stable ordering in TUI.
- **(Spec examples)** include concrete JSONL examples for each event type:
  - `log`:
    - `{"proto":"poc.progress@2","event":"log","ts":"2026-02-04T12:00:00.000Z","seq":42,"level":"info","stream":"stderr","message":"indexing started","jobId":"job-1"}`
  - `task:start`:
    - `{"proto":"poc.progress@2","event":"task:start","ts":"2026-02-04T12:00:00.010Z","seq":1,"jobId":"job-1","taskId":"code:scan","name":"Scanning code","stage":"code"}`
  - `task:progress`:
    - `{"proto":"poc.progress@2","event":"task:progress","ts":"2026-02-04T12:00:00.120Z","seq":2,"jobId":"job-1","taskId":"code:scan","current":24,"total":120,"unit":"files","percent":20}`
  - `task:end`:
    - `{"proto":"poc.progress@2","event":"task:end","ts":"2026-02-04T12:00:01.200Z","seq":3,"jobId":"job-1","taskId":"code:scan","status":"ok","durationMs":1190}`
  - `job:start`:
    - `{"proto":"poc.progress@2","event":"job:start","ts":"2026-02-04T12:00:00.000Z","seq":0,"jobId":"job-1","command":"build_index","args":["--progress","jsonl"],"cwd":"C:/repo"}`
  - `job:end`:
    - `{"proto":"poc.progress@2","event":"job:end","ts":"2026-02-04T12:00:10.000Z","seq":500,"jobId":"job-1","status":"ok","exitCode":0,"durationMs":10000,"result":{"summary":{"chunks":120}}}`
  - `job:artifacts`:
    - `{"proto":"poc.progress@2","event":"job:artifacts","ts":"2026-02-04T12:00:10.010Z","seq":501,"jobId":"job-1","artifacts":[{"kind":"index","label":"sqlite","path":"...","exists":true,"bytes":12345,"mtime":"2026-02-04T12:00:09.000Z","mime":"application/x-sqlite3"}]}`
- **(Code)** `src/shared/cli/progress-events.js`
  - `formatProgressEvent(eventName, payload, { context })`:
    - inject `proto`, `ts`, `seq`, and context fields (jobId/runId)
  - `parseProgressEventLine(line, { strict })`:
    - strict mode requires `proto` + allowlisted `event`
    - non-strict mode may be retained for backward compatibility, but must never accept arbitrary JSON
  - **Touchpoints for `seq` + `ts` fields**:
    - `src/shared/cli/progress-events.js` (default `ts`, increment `seq`)
    - `src/shared/cli/display.js` (when emitting `task:*` + `log` events)
    - `src/shared/cli/progress-stream.js` (when wrapping non‑protocol lines into `log`)
    - `tools/tui/supervisor.js` (inject `seq` for job events + wrapped logs)
    - `tools/bench/language/process.js` (decoder wrapper emits `log` events)
    - `tools/bench/language-repos.js` (direct `display` calls should not bypass `seq`)

#### 1.2 Context propagation (jobId/runId injection)
- **(Code)** `src/shared/cli/display.js`
  - Add a `context` option (object) and/or env-based context:
    - read `PAIROFCLEATS_PROGRESS_CONTEXT` (JSON string) once at init
  - Ensure `writeProgressEvent(...)` always includes merged context in JSONL mode
- **(Code)** Document how tools should set context:
  - Supervisor sets env var for children
  - Tools that spawn children should forward env var
- **(Code)** Add `PAIROFCLEATS_PROGRESS_CONTEXT` to `src/shared/env.js` allowlist
- **(Doc)** Document `PAIROFCLEATS_PROGRESS_CONTEXT` in `docs/config/contract.md` (env var surface)

#### 1.3 Shared stream decoder: “chunks → lines → event-or-log”
- **(Code)** Add `src/shared/cli/progress-stream.js`
  - Provide a small library that:
    - accepts chunks from stdout/stderr
    - normalizes CRLF/CR to LF
    - preserves partial-line carry buffers per stream
    - for each completed line:
      - try `parseProgressEventLine(line, { strict:true })`
      - else emit a `log` event wrapper (include original stream and jobId)
    - enforces `maxLineBytes` (default 1MB) and emits a `log` event when truncation occurs
- **(Refactor)** Replace duplicated logic:
  - Update `tools/bench/language/process.js` to use it
  - Supervisor will use it for all spawned jobs
  - (Optional) any other tool that decodes child output should use it

### Testing

#### 1.T1 Strict parser unit tests
- **Test cases**
  - Accept valid v2 event lines
  - Reject:
    - JSON without `proto`
    - JSON with unknown `proto`
    - JSON with unknown `.event`
    - invalid JSON
- **Pass criteria**
  - No false positives: a line like `{"ok":true}` must never become a progress event.

#### 1.T2 Stream decoder tests (chunk boundary correctness)
- **Test cases**
  - JSON split across two chunks → reconstructed correctly
  - CR-only outputs (some Windows tools) → normalized correctly
  - Interleaved stdout/stderr with partial lines → no cross-stream corruption
- **Pass criteria**
  - Every emitted object is a valid v2 protocol event.
  - No dropped characters; no duplicated lines.

#### 1.T3 Tool “clean JSONL” regression tests
- Run `build_index.js --progress jsonl ...` and `node tools/bench/language-repos.js --progress jsonl ...` in a fixture mode:
  - stderr must be all valid v2 JSONL events (once upgraded)
- Pass criteria:
  - no stray human lines in JSONL mode

#### 1.T4 Decoder line-size cap test
- Emit a single line larger than maxLineBytes and assert:
  - decoder truncates safely
  - emits a `log` event indicating truncation

#### 1.T5 Context propagation test
- Set `PAIROFCLEATS_PROGRESS_CONTEXT={"jobId":"j1","runId":"r1"}` and emit a JSONL event.
- Assert every emitted event includes the merged `jobId`/`runId`.

---

## Sub-phase 2: Node supervisor MVP (Rust TUI ↔ Node boundary)

### Objective
Implement a standalone Node supervisor that:
- accepts JSONL **requests** on stdin
- emits strict protocol **events** on stdout
- spawns/supervises repo scripts reliably, including cancellation

### Tasks

#### 2.1 Supervisor protocol (spec)
- **(Spec)** Add `docs/specs/node-supervisor-protocol.md`
  - Request ops (minimum):
    - `hello` / handshake
    - `job:run` (includes command, args, cwd, env, capture strategy)
    - `job:cancel`
    - `shutdown`
  - Event types:
    - `supervisor:hello`
    - `job:start`, `job:spawn`, `job:end`
    - passthrough progress `task:*` and `log`
  - `supervisor:hello` payload must include:
    - `protoVersion` (exact string, e.g., `poc.supervisor@1`)
    - `progressProto` (e.g., `poc.progress@2`)
    - `pid`, `platform`, `cwd`
    - `versions` (node, app version, optional git sha)
    - `capabilities` (supported commands + optional feature flags)
  - Define timeouts + escalation:
    - cancel → graceful wait → forced kill → `job:end status="cancelled"`

#### 2.2 Implementation: `tools/tui/supervisor.js`
- **Job table + lifecycle**
  - Maintain `Map<jobId, JobState>` with:
    - `abortController`
    - `childPid`, `spawnedAt`, `status`
    - bounded stdout capture buffer for “final JSON” parsing
  - Track per-job `seq` counters for ordering (used by progress events).
- **Limits & safety**
  - max stdout capture bytes (default 1MB)
  - max line size for decoder (shared `progress-stream` limit)
  - per-job log ring buffer size (e.g., 5k lines) for UI performance
- **Spawn strategy**
  - Use `spawnSubprocess()` with:
    - `stdio: ['ignore','pipe','pipe']`
    - `detached:true` on POSIX so we can kill process groups
    - `signal` wired to job abort controller
- **Output normalization**
  - For each stdout/stderr chunk:
    - run shared `progress-stream` decoder
    - emit only v2 protocol events to stdout
  - Ensure wrapped `log` events include `seq` and `stream` (`stdout`/`stderr`).
- **Context propagation**
  - Set `PAIROFCLEATS_PROGRESS_CONTEXT={"jobId":..., "runId":...}` in child env
  - Include `capabilities` in `supervisor:hello` by reading shared dispatch manifest.
- **Result capture**
  - Option A (simplest): if `job:run.captureStdoutAs=="json"`, buffer stdout and JSON.parse at end
  - Option B: always buffer up to N bytes and attempt parse if it looks like JSON
  - If JSON parse fails, emit `job:end` with `error` and include truncated stdout in `result.rawStdout` (bounded).
- **Robust shutdown**
  - On supervisor stdin close:
    - cancel all running jobs
    - wait bounded time
    - force-exit if necessary

**Supervisor failure modes (explicit handling)**
- child spawn fails → emit `job:end status="failed"` with `error.code="spawn_failed"`.
- child exits before `job:spawn` → still emit `job:end` with exitCode.
- malformed JSON from child → wrap as `log` event, do not crash supervisor.
- internal supervisor exception → emit `log level=error`, exit non-zero.

**Primary touchpoints**
- `tools/tui/supervisor.js` (new)
- `src/shared/subprocess.js` (spawn + abort wiring)
- `src/shared/kill-tree.js` (tree kill helper)
- `src/shared/cli/progress-stream.js` (line decoding)
- `src/shared/cli/progress-events.js` (strict parsing)
- `src/shared/cli/display.js` (context merge)

#### 2.3 Refactor dispatcher/env logic out of `bin/pairofcleats.js`
- **Why**: the supervisor must run the same jobs as the CLI entrypoint without drift, and search flags must not be blocked by dispatcher allowlists.
- **(Spec)** Follow `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`.

**2.3.1 Immediate reconciliation (search flags)**
- **(Code)** In `bin/pairofcleats.js`:
  - remove `validateArgs(...)` from the `search` command handler
  - remove the manual backend allowlist (currently rejects `sqlite-fts`, `tantivy`, `memory`, `-n`)
  - pass all `rest` args through to `search.js` unchanged
- **(Tests)** Add a new integration test:
  - `node bin/pairofcleats.js search --help --backend tantivy` → exit 0
  - `node bin/pairofcleats.js search --help -n 10` → exit 0

**2.3.2 Shared dispatcher module**
- **(Code)** Create `src/shared/dispatch/`:
  - `registry.js` (command catalog + descriptions + expected outputs + artifact kinds)
  - `resolve.js` (argv → command resolution)
  - `env.js` (spawn env resolution; keep build_index runtime-envelope special case)
  - `manifest.js` (exports JSON manifest for the TUI)
- **(Code)** Update:
  - `bin/pairofcleats.js` to use shared dispatch
  - `tools/tui/supervisor.js` to use shared dispatch
- **(Code)** Update search option source-of-truth:
  - `src/retrieval/cli-args.js` should explicitly define the full search option surface (used by manifest + strict mode)
  - backend enum pulled from `src/storage/backend-policy.js`

**2.3.3 Manifest surface for TUI**
- Add new commands:
  - `pairofcleats dispatch list --json`
  - `pairofcleats dispatch describe <command> --json`
- Ensure `dispatch describe search` includes:
  - backend enum values: `auto`, `sqlite`, `sqlite-fts` (`fts`), `lmdb`, `tantivy`, `memory`
  - full search flag surface grouped for UI (see spec)
- Ensure each command description includes:
  - `supportsProgress` (jsonl/tty/log/off)
  - `supportsJson` and `supportsNonInteractive`
  - `artifacts` list (expected kinds + labels for preview)
  - `defaultArgs` (safe defaults for UI run palette)
- **Touchpoints for capability fields**
  - `src/shared/dispatch/registry.js` (single source of truth for `supports*`, `defaultArgs`, `artifacts`)
  - `src/shared/dispatch/manifest.js` (ensure fields are serialized)
  - `bin/pairofcleats.js` (dispatch describe uses shared manifest)
  - `tools/tui/supervisor.js` (`supervisor:hello` includes manifest summary)
  - `crates/pairofcleats-tui/` (run palette reads `supports*`, `defaultArgs`)
- **(Tests)** Add:
  - `tests/dispatch/manifest-list.test.js`
  - `tests/dispatch/manifest-describe-search.test.js`

**2.3.4 Optional strict mode (CI/hardening)**
- Add `PAIROFCLEATS_DISPATCH_STRICT=1` (or `--strict`) to enforce unknown-flag detection **only** when requested.
- In strict mode:
  - validate against the registry’s option list
  - for search, rely on the explicit option definitions in `src/retrieval/cli-args.js`

#### 2.4 Supervisor artifacts indexing pass (post-job)
- **(Spec)** Follow `docs/specs/supervisor-artifacts-indexing-pass.md`.
- **(Code)** Add a supervisor-side artifacts pass:
  - emit `job:artifacts` **after** `job:end`
  - artifact record shape:
    - `kind`, `label`, `path`, `exists`, `bytes`, `mtime`, `mime`
  - enforce performance budgets (no unbounded directory recursion)
  - only stat known paths; never glob the repo root
- **(Code)** Implement job-specific extractors:
  - `build_index.js` (index dirs, build_state.json, crash logs, sqlite/lmdb/tantivy outputs)
  - `search.js` (metrics dir + files from `recordSearchArtifacts()`)
  - `tools/setup/setup.js` (config file, dict/model/extension dirs)
  - `tools/bench/language-repos.js` (bench results dir + report JSON)
- **(Code)** Centralize extractor mapping in the dispatch registry so the TUI can preview artifacts before running.
- **(Code)** Add a `--artifacts json` option to supervisor for dump-only mode (used by tests).

### Testing

#### 2.T1 Supervisor stream discipline integration test
- Start supervisor, run a fixture job that emits:
  - progress JSONL events
  - plain log lines
  - non-protocol JSON
- Assert supervisor stdout:
  - is **only** JSONL v2 events
  - includes `jobId` on every event

#### 2.T2 Cancellation integration test (tree kill)
- Fixture job spawns a child + grandchild and sleeps.
- Send `job:cancel`.
- Assert:
  - `job:end` emitted exactly once
  - status is `cancelled`
  - processes terminate within bounded time

#### 2.T3 Env parity test vs CLI dispatcher
- For representative commands (index build, setup, bootstrap):
  - ensure supervisor resolves same script + env variables as `bin/pairofcleats.js`
- Pass criteria:
  - no “works in CLI but not in TUI” divergence

#### 2.T4 Artifacts pass smoke tests
- Run a small `build_index.js` and `search.js` via supervisor:
  - assert `job:artifacts` emitted
  - assert artifact list includes expected paths (index dirs, metrics files)
- Pass criteria:
  - artifacts are stable and do not require scanning the entire repo

#### 2.T5 Dispatch manifest tests
- `pairofcleats dispatch list --json` returns a stable command catalog.
- `pairofcleats dispatch describe search --json` includes backend enum + flag groups.

#### 2.T6 Search flag passthrough test
- `node bin/pairofcleats.js search --help --backend tantivy` exits 0
- `node bin/pairofcleats.js search --help -n 10` exits 0

---

## Sub-phase 3: Rust Ratatui TUI skeleton (terminal ownership + job UI)

### Objective
Create the Rust TUI that owns the terminal, talks to the supervisor, and renders:
- job list + job detail
- task table (taskId/name/current/total/status)
- log view (per job)

### Tasks

#### 3.1 Rust crate and core architecture
- Add `crates/pairofcleats-tui/`:
  - `ratatui`, `crossterm`, `tokio`, `serde`, `serde_json`, `anyhow`
- Add a workspace root `Cargo.toml` if one does not exist.
- Module layout (suggested):
  - `protocol/` (JSONL decoding + strongly typed events)
  - `supervisor/` (process spawn, request writer, event reader)
  - `model/` (jobs/tasks/log buffers)
  - `ui/` (widgets, layout)
  - `app.rs` (event loop)
- Command palette should be sourced from the supervisor `capabilities` + dispatch manifest (no hard-coded command lists in Rust).

#### 3.2 Supervisor integration
- Spawn `node tools/tui/supervisor.js` with piped stdin/stdout
- Perform `hello` handshake and validate protocol version
- Create:
  - async reader task: decode lines → events → channel
  - async writer: send requests for run/cancel/shutdown
- Ensure supervisor is restarted safely if it exits unexpectedly:
   - mark all running jobs failed
   - surface a clear UI error

#### 3.3 UI behaviors (MVP)
- Views:
  - Left: job list (status, start time, duration)
  - Right top: tasks (sorted by stage + recent updates)
  - Right bottom: logs (ring buffer, tailing)
  - Optional panel: artifacts list for the selected job (paths + sizes)
- UI model rules:
  - job list ordered by most recent activity
  - tasks grouped by `stage` then `name`
  - logs capped to N lines per job (configurable)
- Keybindings (minimum):
  - `r`: open “run command” palette (choose setup/index/search/bootstrap)
  - `c`: cancel selected job
  - `q`: quit (cancel all jobs, shutdown supervisor)
  - `?`: toggle help overlay (keybindings + status legend)
- Ensure TUI never relies on subprocess TTY:
  - always run jobs with piped stdio via supervisor

### Testing

#### 3.T1 Protocol decoding tests (Rust)
- Feed recorded JSONL streams into decoder:
  - job lifecycle + task updates + logs
- Assert model updates:
  - tasks created/updated/ended correctly
  - logs appended with correct job association

#### 3.T2 Headless smoke test
- Run TUI in a “headless” mode (no raw mode / no alternate screen) that:
  - starts supervisor
  - sends hello
  - sends shutdown
- Pass criteria:
  - exits 0
  - no panics
  - supervisor process does not remain running

#### 3.T3 Cancel path integration (Rust + supervisor)
- Start a long-running fixture job
- Issue cancel
- Assert model receives `job:end status=cancelled`

---

## Sub-phase 4: Cancellation hardening + cleanup correctness (end-to-end)

### Objective
Make cancellation robust under real-world failure modes:
- subprocesses that ignore SIGTERM
- children that spawn grandchildren
- supervisor shutdown while jobs are running
- UI crash/quit paths

### Tasks

#### 4.1 Supervisor escalation policies
- Ensure cancel logic uses shared kill-tree semantics (Sub-phase 0) and:
  - applies a bounded grace period
  - escalates to forced kill
  - emits clear termination metadata on `job:end`

#### 4.2 UI shutdown correctness
- On `q`:
  - cancel all running jobs
  - wait bounded time for `job:end` events
  - send supervisor shutdown
  - restore terminal state even if errors occur
- On `Ctrl+C`:
  - first press → cancel active job (or all jobs if none selected)
  - second press within grace window → force-exit (after restoring terminal)

#### 4.3 “Never hang” guarantees
- Add watchdog timeouts:
  - if supervisor does not respond, TUI exits after restoring terminal
  - if a job does not end after forced kill, mark failed and continue
- Add a hard cap on supervisor shutdown time (e.g., 10s total)

### Testing

#### 4.T1 “ignore SIGTERM” fixture
- Fixture job traps SIGTERM and sleeps
- Cancel job
- Assert:
  - forced kill occurs
  - job ends

#### 4.T2 “UI dies mid-job” fixture
- Simulate abrupt TUI termination (panic in test mode) and ensure:
  - supervisor is terminated by OS process tree rules or explicit cleanup handler
  - no orphan jobs remain (best-effort; document platform caveats)

---

## Sub-phase 5: Install/distribution (compile-on-install + prebuilt fallback)

### Objective
Make `pairofcleats-tui` easy to run after `npm install`, with secure fallback mechanisms:
- optional compile-on-install for developers
- prebuilt binaries for everyone else
- wrapper that provides clear instructions when binary is missing

### Tasks

#### 5.1 Installer + wrapper
- Implement `tools/tui/install.js` (see `docs/specs/tui-installation.md`)
  - opt-in compile: `PAIROFCLEATS_TUI_BUILD=1` or `npm_config_build_from_source=true`
  - allow opt-out: `PAIROFCLEATS_TUI_DISABLE=1`
  - optional profile: `PAIROFCLEATS_TUI_PROFILE=release|debug`
  - else download prebuilt for `{platform, arch}` and verify sha256
  - write `bin/native/manifest.json` describing installed binary and method
  - follow the same extraction safety limits as `tools/download/extensions.js`
- Implement `bin/pairofcleats-tui.js`
  - resolve `bin/native/pairofcleats-tui[.exe]`
  - exec it with args (inherit stdio)
  - if missing, print concise guidance:
    - re-run install with `PAIROFCLEATS_TUI_BUILD=1`
    - download prebuilt
    - fallback to `pairofcleats` Node CLI
- (Optional) add `tools/tui/download.js` to download prebuilt binaries explicitly
- Update `package.json`:
  - `bin.pairofcleats-tui`
  - `scripts.postinstall = "node tools/tui/install.js"`
- **Config surface (if downloads are configurable)**:
  - extend `.pairofcleats.json` with `tui.install.*` keys
  - document in `docs/config/schema.json` + `docs/config/contract.md`
- **Docs**
  - add `pairofcleats-tui` to `docs/guides/commands.md`
  - add a short `docs/guides/tui.md` with install + troubleshooting

**Primary touchpoints**
- `bin/pairofcleats-tui.js`
- `tools/tui/install.js`
- `package.json`
- `docs/specs/tui-installation.md`

#### 5.2 CI pipeline for artifacts
- Build for supported targets (at minimum: win32-x64, linux-x64, darwin-x64/arm64 if supported)
- Upload:
  - binaries
  - sha256 sums
  - manifest
- Ensure version aligns with `package.json` and `bin/native/manifest.json`

### Testing

#### 5.T1 Installer unit tests
- Simulate:
  - cargo present → build succeeds
  - cargo missing → download path taken
  - download sha mismatch → installer aborts with clear message
  - network unavailable → installer does not fail npm install
  - `PAIROFCLEATS_TUI_DISABLE=1` → installer no-ops cleanly
- Pass criteria:
  - correct binary selection and verified install metadata

#### 5.T2 Wrapper behavior tests
- If manifest exists → wrapper execs binary
- If missing → wrapper prints instructions and exits non-zero (or falls back to Node CLI if desired)

---

## Milestone 1 “Done” definition (updated)
Milestone 1 is complete when:

1) **Preparation complete**
- `build_index.js`, `tools/setup/setup.js`, `tools/setup/bootstrap.js`, and `tools/bench/language-repos.js` obey the “TUI tool contract”:
  - `--json` produces clean stdout JSON only
  - `--progress jsonl` produces protocol-safe stderr output (no stray lines)
- A unified `src/shared/kill-tree.js` exists and all call sites use it.

2) **Protocol + supervisor**
- Supervisor emits strict JSONL and can run at least:
  - `node tools/setup/setup.js --non-interactive --json --progress jsonl`
  - `node build_index.js --progress jsonl`
- Cancellation works and is covered by an integration test.
- Supervisor emits `job:artifacts` for completed jobs.
- `pairofcleats search` accepts all supported flags (no dispatcher allowlist).

3) **Rust TUI**
- TUI:
  - starts supervisor
  - runs a job
  - renders tasks + logs
  - cancels a job
  - exits without corrupting terminal state

---

# NIKE_SB_CHUNK_ROADMAP

A phased roadmap to implement targeted platform improvements. Each phase includes granular tasks, touchpoints, and tests. Line numbers are approximate; refer to symbol names for accuracy.

---

## Dependency map (high-level)

Phase 1 is the foundation for schema/contract hygiene. Phase 2 depends on Phase 1 rules (trim policy + determinism rules). Phase 3 depends on Phase 1 contract/versioning and Phase 2 artifact stability. Phase 4 depends on Phase 1 schema rules and Phase 3 output contracts. Phase 5 depends on Phase 1 contract rules and Phase 4 workspace/SCM integrity for CI coverage. Phase 6 depends on Phase 3 output contracts and Phase 5 runner outputs for consistent error telemetry.

Note: each phase's "Exit Criteria" section is the acceptance criteria for that phase.

## Decision Register (resolve before execution)

| Decision | Description | Default if Unresolved | Owner | Due Phase | Decision deadline |
| --- | --- | --- | --- | --- | --- |
| D1 `api_contracts_meta` | Add schema + writer vs remove from docs. | Remove from docs and keep it out of the contract until a schema exists. | Core Maintainers | Phase 2 | Resolved 2026-02-20 |
| D2 N‑1 major support for 0.x | Change code or document current behavior. | Document current behavior, add a compatibility note, and revisit in Phase 5. | Core Maintainers | Phase 3 | Resolved 2026-02-20 |
| D3 Extensions-only vs extra fields | Tighten schemas or relax docs. | Tighten schemas; explicitly whitelist extension fields if needed. | Core Maintainers | Phase 2 | Resolved 2026-02-20 |
| D4 Graph explain shape | Update docs or change output. | Align output to docs and version the explain schema. | Core Maintainers | Phase 3 | Resolved 2026-02-20 |
| D5 Impact empty inputs | Enforce error or document warning+empty result. | Default to error; allow legacy warning only with explicit flag. | Core Maintainers | Phase 3 | Resolved 2026-02-20 |
| D6 Graph product surfaces spec | Keep authoritative + update or archive. | Keep authoritative and update docs to match behavior. | Core Maintainers | Phase 3 | Resolved 2026-02-20 |
| D7 Risk trimming/ordering | Enforce spec in code or update specs. | Enforce spec in code, add deterministic trimming rules. | Core Maintainers | Phase 2 | Resolved 2026-02-20 |
| D8 Tooling IO `fileTextByFile` | Implement cache or update spec to VFS. | Update spec to VFS and treat cache as optional. | Core Maintainers | Phase 4 | Resolved 2026-02-20 |
| D9 TS provider heuristic IDs | Remove from code or allow in spec. | Allow in spec with explicit marker and phase-out plan. | Core Maintainers | Phase 3 | Resolved 2026-02-20 |
| D10 VFS manifest trimming | Enforce deterministic trim or update spec. | Enforce deterministic trim with counters. | Core Maintainers | Phase 2 | Resolved 2026-02-20 |
| D11 Promote `docs/new_docs/*` | Promote into specs or archive/remove. | Promote only docs with implementation + tests; archive the rest. | Core Maintainers | Phase 6 | Resolved 2026-02-20 |

## Glossary

- Membership invariant: graph ranking does not change the set of items returned, only their order.
- Explain schema: the structured, versioned JSON emitted by `--explain`.
- Trim policy: deterministic rules for dropping optional fields when rows exceed size limits.
- Determinism report: artifact listing known nondeterministic fields and their sources.

## Config surface classification (public vs internal)

- Public config: must appear in `docs/config/schema.json` and `docs/config/inventory.*`, include schema validation, and be documented in the relevant contract/guides.
- Internal config: must be scoped under `internal.*` or `experimental.*`, must not appear in docs/config inventory, and must be annotated with `@internal` in code comments.
- Promotion rule: internal configs can be promoted only with docs, schema validation, and tests; no silent behavior changes.

## Spec gate consolidation

- All spec guardrails flow through a single entrypoint (`tools/ci/run-suite.js`) with a shared allowlist and output format.
- Contract drift checks must emit machine-readable summaries and fail only on curated allowlists, not on informational sections.
- Each guardrail must define: scope, authoritative source, allowed drift, and explicit remediation command.

## Phase 1 — Foundations & Contract Hygiene

### Objective

Establish shared contracts, helpers, and rules that later phases depend on. This phase reduces schema drift, clarifies path and serialization policy, and ensures deterministic outputs are testable.

### 1.1 Contract versioning + forward compatibility rules
- Goal: standardize how contracts evolve and how readers handle unknown fields.
- Touchpoints:
  - `docs/contracts/*`
  - `src/contracts/schemas/*`
  - `src/contracts/validators/*`
- Tasks:
  - [ ] Define version bump rules (breaking vs non-breaking).
  - [ ] Require forward-compat behavior: readers ignore unknown fields by default.
  - [ ] Add schema version markers to explain/output contracts where missing.
- Tests:
  - [ ] Contract parser ignores unknown fields with a stable warning.
- Acceptance:
  - [ ] Contract versioning rules are documented and applied consistently.

### 1.2 Path normalization policy (storage vs I/O)
- Goal: prevent cross-platform drift in stored paths and file handling.
- Touchpoints:
  - `src/shared/files.js`
  - `docs/contracts/*` (artifact path fields)
- Tasks:
  - [ ] Define a canonical storage format (POSIX `/` separators).
  - [ ] Define platform-specific I/O rules (Windows vs POSIX).
  - [ ] Document conversion boundaries (toPosix/fromPosix).
- Tests:
  - [ ] Path normalization tests for drive letters, UNC, and POSIX relative paths.
- Acceptance:
  - [ ] All artifact paths are stored canonically; I/O boundaries are explicit.

### 1.3 Deterministic serialization rules
- Goal: ensure stable JSON ordering and hashing across the system.
- Touchpoints:
  - `src/shared/stable-json.js`
  - `docs/contracts/*`
- Tasks:
  - [ ] Require stable JSON ordering for all hashed artifacts.
  - [ ] Document canonical hash inputs (include/exclude fields).
- Tests:
  - [ ] Hash stability test across repeated runs.
- Acceptance:
  - [ ] Deterministic hashing is enforced in contracts and tests.

### 1.4 Spec gate consolidation
- Goal: remove duplicated spec checks and ensure consistent guardrail behavior across CI and local runs.
- Touchpoints:
  - `tools/ci/run-suite.js`
  - `tools/doc-contract-drift.js`
  - `docs/tooling/script-inventory.json`
  - `docs/guides/commands.md`
- Tasks:
  - [ ] Define a single guardrail registry with scope + allowlists.
  - [ ] Ensure each guardrail emits a summarized diff and a remediation command.
  - [ ] Align exit codes and `--fail` behavior across guardrails.
- Tests:
  - [ ] Guardrail registry test ensures all checks have scope + remediation.
- Acceptance:
  - [ ] Guardrails are unified, deterministic, and consistent in CI/local runs.

### Phase 1 Exit Criteria
- [ ] Contract versioning and forward-compat rules are documented and tested.
- [ ] Path normalization policy is defined and validated.
- [ ] Deterministic serialization rules are enforced in code and tests.
- [ ] Spec gate consolidation is implemented and tested.

### Phase 1 Non-goals
- [ ] Broad refactors of unrelated contracts.
- [ ] New features unrelated to schema and serialization hygiene.

---

## Phase 2 — Index Artifact Robustness

### Dependencies and risks
- Dependencies: schema updates in `docs/contracts/*` and validators must land with writers.
- Risks: trimming policy changes can break downstream consumers if schemas are not versioned.

### 2.1 Deterministic trimming for oversized JSONL rows
- Goal: apply uniform, deterministic trimming policy for risk/vfs/call-sites.
- Touchpoints:
  - `src/index/build/artifacts/writers/call-sites.js` (row trimming)
  - `src/index/build/artifacts/writers/*` (risk summaries/flows)
  - `src/index/tooling/vfs.js` (vfs_manifest row handling)
  - `src/contracts/schemas/artifacts.js` (extensions optional object)
  - `docs/contracts/artifact-trimming-policy.md` (new)
- Tasks:
  - [ ] Define a shared trimming helper (e.g., `src/shared/artifact-io/limits.js` or `src/index/build/artifacts/trim.js`).
  - [ ] Trimming order: extensions -> graphs -> optional arrays -> optional strings; never null required objects.
  - [ ] Emit counters for trimmed fields in stats artifacts.
  - [ ] Add schema versioning or `trimPolicyVersion` metadata where trimmed rows are emitted.
  - [ ] Document trimming rules and examples in a single canonical policy doc.
- Tests:
  - [ ] Unit tests for each writer verify:
    - [ ] Oversized row trimmed deterministically.
    - [ ] Required fields remain valid.
    - [ ] Counters increment in stats.
  - [ ] Readers ignore unknown fields from newer trim policy versions.
- Acceptance:
  - [ ] Oversized rows no longer fail schema validation and trim deterministically.

### 2.2 Determinism report
- Goal: emit a structured report of nondeterministic fields in index builds.
- Touchpoints:
  - `src/index/build/state.js` / `index_state` writer
  - `src/index/validate/*` for acceptance
  - `docs/testing/index-state-nondeterministic-fields.md`
- Tasks:
  - [ ] Add `determinism_report.json` artifact with list of fields and source reasons.
  - [ ] Generate from known nondeterministic sources (timestamps, buildId, cache roots).
  - [ ] Include source classification enum (time, environment, cacheRoot, buildId, randomness).
- [ ] Update validation to allow/expect report where configured.
- Tests:
  - [ ] New test for report emission with known fields.
- Acceptance:
  - [ ] Determinism report is present on builds that opt-in and passes validation.

---

### Phase 2 Exit Criteria
- [ ] Trimming policy is documented and enforced consistently across writers.
- [ ] Oversized rows are trimmed deterministically with counters recorded.
- [ ] Determinism report is emitted, versioned, and accepted by validation.

### Phase 2 Non-goals
- [ ] New artifact types beyond trimming/determinism needs.
- [ ] Changes to ingestion or retrieval logic.

## Phase 3 — Search/Graph UX + Explain Contract

### Dependencies and risks
- Dependencies: output contract docs must be updated alongside code changes.
- Risks: output shape changes can break tooling; require schema versioning and snapshots.

### 3.0 Search CLI startup time investigation + fixes
- Goal: reduce slow startup and make root causes visible, then eliminate the worst offenders.
- Touchpoints:
  - `bin/pairofcleats.js`
  - `src/retrieval/cli.js`
  - `src/retrieval/cli-args.js`
  - `src/shared/startup-profiler.js` (new)
  - `docs/guides/search.md`
- Tasks:
  - [ ] Add a startup profiler (timed checkpoints) to identify slow imports/initialization.
  - [ ] Emit a `--profile-startup` report with module import timings and top offenders.
  - [ ] Lazily import heavy modules only after command routing is known (search vs index vs tooling).
  - [ ] Avoid loading configs/index state until the command actually requires them.
  - [ ] Cache and reuse parsed config where safe within a single process.
  - [ ] Add a “fast path” for `pairofcleats search` to avoid initializing non-search subsystems.
- Tests:
  - [ ] Startup profile report is generated and contains ordered checkpoints.
  - [ ] CLI `search --help` does not load heavy modules (asserted via profiler).
- Acceptance:
  - [ ] Startup time improves measurably on a cold run and is validated by profiler output.

### 3.1 Explain schema normalization
- Goal: define a compact stable explain output schema, versioned.
- Touchpoints:
  - `src/retrieval/output/explain.js` (output formatter)
  - `src/retrieval/pipeline/graph-ranking.js` (graph breakdown)
  - `docs/contracts/retrieval-ranking.md`
  - `docs/contracts/search-contract.md`
- Tasks:
  - [ ] Define JSON schema: `explainVersion`, `scoreBreakdown` fields, deterministic field order.
  - [ ] Version the output (e.g., `explainVersion: 1`).
  - [ ] Update CLI `--explain` output to conform.
  - [ ] Define version bump rules (breaking vs non-breaking) for explain schema.
- Tests:
  - [ ] Snapshot test for explain JSON output.
  - [ ] Validate output against schema.
- Acceptance:
  - [ ] Explain output is stable, versioned, and schema-valid.

### 3.2 Graph ranking knobs
- Goal: add `--graph-ranking` boolean flag; enforce membership invariant.
- Touchpoints:
  - `src/retrieval/cli-args.js` (flag definition)
  - `src/retrieval/cli/normalize-options.js` (graphRankingConfig)
  - `src/retrieval/pipeline/graph-ranking.js`
  - `docs/contracts/search-cli.md`
- Tasks:
  - [ ] Add `--graph-ranking` (bool) overriding config.
  - [ ] Define and validate "no membership change" (membership set source is documented).
  - [ ] Decide whether graph ranking is rerank-only or can change ordering semantics; document.
- Tests:
  - [ ] CLI parsing test for flag.
  - [ ] Graph ranking membership invariant test.
- Acceptance:
  - [ ] Flag works and membership invariant enforced.

### 3.3 Search result UX overhaul (human + JSON)
- Goal: provide significantly improved human text output and a stable, concise JSON output format.
- Touchpoints:
  - `src/retrieval/output/format.js`
  - `src/retrieval/output/summary.js`
  - `src/retrieval/output/explain.js`
  - `src/retrieval/output/context.js`
  - `docs/guides/search.md`
- Tasks:
  - [ ] Add modes: compact, symbol-first, context-only (CLI flags + config).
  - [ ] Add a default human-readable layout with:
    - [ ] clear section headers (query, filters, repo, result counts)
    - [ ] consistent line-wrapping for long paths and symbols
    - [ ] stable ordering of results and fields
    - [ ] per-result scoring summary (rank + score + provider)
    - [ ] optional context preview with deterministic truncation markers
  - [ ] Add `--output json` schema version field (e.g., `outputVersion: 1`).
  - [ ] Ensure default JSON excludes heavyweight graph/AST fields unless `--explain`.
  - [ ] Explicitly gate “heavy” output fields behind flags (`--explain`, `--context`, `--graph`).
  - [ ] Add a `--no-color` and `--color` override for deterministic outputs in CI.
  - [ ] Update output schema artifacts (doc updates tracked in DOXFIX).
- Tests:
  - [ ] Output snapshot tests for each mode (human text + json).
  - [ ] JSON output shape tests (default vs explain).
  - [ ] Deterministic ordering tests for results and field order.
- Acceptance:
  - [ ] Default output is concise, structured, and stable across runs.
  - [ ] JSON output is versioned, minimal by default, and expands only when requested.

### 3.4 Impact analysis strictness
- Goal: decide and implement validation for empty seeds/changed.
- Touchpoints:
  - `src/graph/impact.js` (analysis)
  - `src/integrations/tooling/impact.js`
  - `docs/contracts/graph-tools-cli.md`
- Tasks:
  - [ ] If strict: throw on empty inputs + add structured warning code for legacy callers.
  - [ ] Define an error code for empty-input failures and ensure CLI/API/MCP surface it consistently.
- Tests:
  - [ ] New tests for strict mode (errors) and legacy warning behavior.
- Acceptance:
  - [ ] Behavior is explicit and documented.

---

### Phase 3 Exit Criteria
- [ ] Search CLI startup profiler exists and startup time improvements are measurable.
- [ ] Explain output is versioned, schema-valid, and stable.
- [ ] Human text output is structured and deterministic; JSON output is versioned and minimal by default.
- [ ] Graph ranking flag works and membership invariants are enforced.
- [ ] Impact analysis empty-input behavior is explicit with a stable error code.

### Phase 3 Non-goals
- [ ] Ranking model changes beyond graph ranking toggle behavior.
- [ ] New retrieval backends or storage formats.

## Phase 4 — SCM Contract & Workspace Scaffolding

### Dependencies and risks
- Dependencies: SCM providers must remain aligned with documented contracts.
- Risks: path normalization differences can cause cache key drift if not enforced consistently.

### 4.1 SCM provider contract
- Goal: formalize provider return shapes and error handling.
- Touchpoints:
  - `src/index/scm/providers/git.js`
  - `src/index/scm/providers/jj.js`
  - `docs/specs/scm-provider-contract.md`
  - `docs/specs/scm-provider-config-and-state-schema.md`
- Tasks:
  - [ ] Define required/optional fields: head (hash + operationId for jj), dirty semantics, path normalization rules.
  - [ ] Standardize error signaling for unavailable SCM; ensure build signatures and discovery remain consistent.
  - [ ] Document a single path normalization policy for SCM outputs vs stored artifact paths.
- Tests:
  - [ ] Unit tests for git/jj provider return shape (including operationId).
  - [ ] Failure mode test: SCM disabled -> consistent provenance and file discovery.
- Acceptance:
  - [ ] Providers meet contract and degraded SCM behavior is consistent.

### 4.2 Workspace/federation scaffolding
- Goal: start emitting workspace_manifest and validate workspace_config.
- Touchpoints:
  - `docs/specs/workspace-config.md`, `docs/specs/workspace-manifest.md`
  - `src/contracts/schemas/*` (if adding schema validators)
  - new tooling under `tools/` or `src/shared/workspace/*`
- Tasks:
  - [ ] Define schemas and add validators for workspace config/manifest.
  - [ ] Add minimal emitter for `workspace_manifest.json` with build pointers.
  - [ ] Decide if manifest emission is tied to index build or a separate command; document.
  - [ ] Add CLI or tool entrypoint for validation.
- Tests:
  - [ ] Schema validation tests for both files.
  - [ ] Emission test with deterministic ordering.
- Acceptance:
  - [ ] Workspace config/manifest are schema-validated and emitted deterministically.

---

### Phase 4 Exit Criteria
- [ ] SCM provider contract is documented and enforced with normalized paths.
- [ ] Workspace config/manifest validation and emission are deterministic and tested.

### Phase 4 Non-goals
- [ ] Full federation query implementation.
- [ ] Index build behavior changes unrelated to SCM/workspace contracts.

## Phase 5 — Test Runner + Coverage + Profiling

### Dependencies and risks
- Dependencies: CI must support new runner flags and artifacts.
- Risks: profiling/logging can add overhead; must be optional and bounded.

### 5.1 Timings ledger + watchdog
- Goal: machine-readable test timing outputs and hung-test watchdog.
- Touchpoints:
  - `tests/run.js` (runner)
  - `tests/runner/*` (formatting + harness)
  - `.testLogs/*` (output)
  - Docs: `docs/testing/test-runner-interface.md`, `docs/testing/ci-capability-policy.md`
- Tasks:
  - [ ] Add `--log-times` emitting JSON/CSV with test name + duration.
  - [ ] Define a versioned schema for the log-times output (fields + ordering).
  - [ ] Add watchdog for hung tests (configurable grace period).
  - [ ] Add ordering hints from ledger (optional).
  - [ ] Update `docs/testing/test-runner-interface.md` with `--log-times` format + file location.
  - [ ] Update `docs/testing/ci-capability-policy.md` with watchdog behavior expectations in CI.
- Tests:
  - [ ] Runner unit tests for log-times output path and format.
  - [ ] Watchdog test with simulated hang.
- Acceptance:
  - [ ] Log-times output is generated and watchdog catches hangs.

### 5.2 Coverage tooling integration
- Goal: integrate `c8 merge` + changed-files coverage mode.
- Touchpoints:
  - `tests/run.js` (runner flags)
  - `tools/` (coverage merge helper)
  - `.c8/` output
  - Docs: `docs/testing/test-runner-interface.md`, `docs/testing/ci-capability-policy.md`
- Tasks:
  - [ ] Add runner flag `--coverage` to wrap lane runs with c8.
  - [ ] Add `--coverage-merge` to merge lane reports into one.
  - [ ] Add `--coverage-changed` using git diff to limit to changed files.
  - [ ] Document coverage flags and output locations in `docs/testing/test-runner-interface.md`.
  - [ ] Note coverage/merge expectations for CI in `docs/testing/ci-capability-policy.md`.
- Tests:
  - [ ] CLI parsing tests for new flags.
  - [ ] Coverage merge unit test (mock .c8 input).
- Acceptance:
  - [ ] Coverage merge outputs a combined report; changed-files mode works.

### 5.3 Perf profiling hooks
- Goal: optional profiling flag to emit per-stage CPU/memory metrics.
- Touchpoints:
  - `src/index/build/runtime/runtime.js` (stage timing)
  - `src/retrieval/pipeline.js` or `src/retrieval/output/summary.js`
  - `docs/perf/*`
- Tasks:
  - [ ] Add `--profile` flag in CLI and config toggle.
  - [ ] Emit `profile.json` with stage timings + memory snapshots.
  - [ ] Document collection granularity and expected overhead.
- Tests:
  - [ ] Unit test verifying profile artifact created when flag set.
- Acceptance:
  - [ ] Profile artifacts emitted when enabled and omitted otherwise.

---

### Phase 5 Exit Criteria
- [ ] Timing ledger and watchdog are implemented and tested.
- [ ] Coverage merge and changed-files coverage work with a defined contract.
- [ ] Profiling artifacts are versioned and documented.

### Phase 5 Non-goals
- [ ] New test lanes unrelated to timing/coverage/profiling.
- [ ] Changes to production code paths.

## Phase 6 — CLI polish & error telemetry

### Dependencies and risks
- Dependencies: shared error code registry and formatting helpers.
- Risks: changing error codes without docs/tests will break consumers.

### 6.1 Tooling ingest CLI wrappers
- Goal: add CLI wrappers in `bin/pairofcleats.js`.
- Touchpoints:
  - `bin/pairofcleats.js`
  - `tools/ingest/ctags.js`, `tools/ingest/gtags.js`, `tools/ingest/lsif.js`, `tools/ingest/scip.js`
  - Docs: `docs/tooling/ctags.md`, `docs/tooling/gtags.md`, `docs/tooling/lsif.md`, `docs/tooling/scip.md`, `docs/guides/commands.md`
- Tasks:
  - [ ] Add `pairofcleats ingest <ctags|gtags|lsif|scip>` routes.
  - [ ] Update ingest docs + commands guide with new CLI wrappers.
- Tests:
  - [ ] CLI routing tests for each tool.
- Acceptance:
  - [ ] CLI wrappers invoke correct tooling entrypoints.

### 6.2 Error telemetry consistency
- Goal: standardize error codes + troubleshooting hints across API/MCP/CLI.
- Touchpoints:
  - `src/shared/error-codes.js`
  - `tools/api/router/*`
  - `src/integrations/mcp/*`
  - CLI output in `src/retrieval/output/*`
- Tasks:
  - [ ] Define error code registry + hint mapping.
  - [ ] Define stable error code namespaces (e.g., `IDX_`, `SCM_`, `RETR_`, `TOOL_`).
  - [ ] Ensure all surfaces attach code + hint.
- Tests:
  - [ ] API error response tests.
  - [ ] MCP error payload tests.
  - [ ] CLI error formatting test.
- Acceptance:
  - [ ] Errors across surfaces include consistent codes + hints.

---

### Phase 6 Exit Criteria
- [ ] Ingest CLI wrappers exist with stable exit-code/output contracts.
- [ ] Error telemetry uses consistent namespaces and hints across CLI/API/MCP.

### Phase 6 Non-goals
- [ ] New CLI features beyond ingest wrappers and error formatting.
- [ ] API changes unrelated to error telemetry.

## Cross-cutting tests to run

- Triggers (explicit, not optional):
  - Changes to retrieval output, explain schema, or CLI flags -> run `ci-lite` + `ci`.
  - Changes to SCM/workspace/contracts -> run `ci-lite` + `ci-long`.
  - Changes to artifact writers or schemas -> run `ci` + targeted artifact validation tests.

- End-to-end scenarios (minimum per phase):
  - Phase 2: build index + validate + verify trimmed artifacts + determinism report.
  - Phase 3: run search with default output + `--explain` + `--output json`, verify output contracts.
  - Phase 4: workspace manifest emission + SCM provider smoke test.
  - Phase 5: run test lane with `--log-times` and `--coverage-merge`.
  - Phase 6: ingest wrapper smoke + error code formatting check.

- [ ] `node tests/run.js --lane ci-lite`
- [ ] `node tests/run.js --lane ci`
- [ ] `node tests/run.js --lane ci-long` (required for SCM/workspace or large-artifact changes)
- [ ] Specific targeted tests:
  - [ ] Search explain output tests
  - [ ] Graph ranking tests
  - [ ] Risk artifacts validation tests
  - [ ] Tooling provider registry tests
  - [ ] Runner timing/coverage tests

---

## Acceptance criteria

- [ ] Artifact schema index JSON exists and matches schema.
- [ ] Oversized rows trimmed deterministically with counters.
- [ ] Explain output schema versioned and stable.
- [ ] Search CLI startup improvements are validated by profiler output.
- [ ] Human and JSON search outputs are improved, versioned, and deterministic.
- [ ] CLI parity achieved for graph ranking and ingest tools.
- [ ] Workspace config/manifest validation stubs present.
- [ ] Test runner emits timing ledger and coverage merge output.
- [ ] Error telemetry codes consistent across surfaces.

---

## Deferred: full fix for sync FS on request paths

Context: We mitigated the hottest sync FS usage by switching index cache signature validation to `index_state.json`. A full fix requires eliminating remaining sync filesystem calls on request-time paths (search + tooling integrations).

Required work (future):
- [ ] Refactor `src/retrieval/index-cache.js` so `buildIndexSignature()` becomes async and uses async FS (or a cached signature map keyed by build id + TTL).
- [ ] Update all call sites to await async signature (touchpoints):
  - `src/retrieval/cli/run-search-session.js` (signature checks before search)
  - `src/integrations/tooling/*` (graph-context, impact, suggest-tests, api-contracts, architecture-check)
  - `src/retrieval/cli/index-loader.js` / `loadIndexWithCache`
- [ ] Decide caching strategy for signatures to avoid repeated stat scans:
  - Use `index_state.json` buildId as primary signature
  - Use shard stats only on cache miss, and cache results for TTL
- [ ] Add tests:
  - [ ] Search path does not perform sync fs (mock fs + verify no sync calls)
- [ ] Signature invalidation when `index_state.json` changes
- [ ] Fallback signature path still detects shard changes

---


## Phase 16 - Release and Platform Baseline

### Objective
Make releases deterministic and supportable across target platforms before deeper retrieval/indexing changes land.

### Non-goals
- Adding new retrieval semantics.
- Adding new indexing formats.

### Exit criteria
- A documented release matrix exists (platform x Node version x optional dependency policy).
- `release-check` exists, is deterministic, and runs both locally and in CI.
- Paths with spaces and Windows semantics are covered with regression tests.
- Sublime and VS Code package outputs are reproducible.
- Python-dependent tests skip cleanly when Python is unavailable and still fail correctly when Python is present.
- CI blocking policy is explicit per job.

### Docs that must be updated
- `docs/guides/release-discipline.md`
- `docs/guides/commands.md`
- `docs/guides/editor-integration.md`
- `docs/guides/service-mode.md`
- `docs/guides/path-handling.md`
- `docs/config/schema.json` and `docs/config/contract.md` (if flags are added)
- `docs/testing/truth-table.md`
- `docs/testing/ci-capability-policy.md`

### 16.1 Release matrix and support policy

#### Objective
Define exactly what is supported and what blocks release.

#### Tasks
- [ ] Add `docs/guides/release-matrix.md` with:
  - [ ] Supported OS list (Windows/macOS/Linux) and minimum versions.
  - [ ] Supported Node majors/minors.
  - [ ] Optional dependency expectations by target.
  - [ ] Blocking vs advisory jobs per target.
- [ ] Define support tiers (`tier1`, `tier2`, `best_effort`) and publish ownership expectations.
- [ ] Define a deterministic failure taxonomy for release jobs (`infra_flake`, `product_regression`, `toolchain_missing`).

#### Touchpoints
- `docs/guides/release-matrix.md` (new)
- `docs/guides/release-discipline.md`
- `.github/workflows/ci.yml`
- `.github/workflows/ci-long.yml`
- `.github/workflows/nightly.yml`

#### Tests
- [ ] `tests/tooling/release-matrix-schema.test.js`
- [ ] `tests/tooling/release-matrix-blocking-policy.test.js`

### 16.2 Deterministic `release-check` command

#### Objective
Create one command that validates basic release viability without hidden environment assumptions.

#### Tasks
- [ ] Add `node tools/release-check.js` and wire `npm run release-check`.
- [ ] Required checks (fixed order):
  - [ ] `pairofcleats --version`
  - [ ] fixture `index build`
  - [ ] fixture `index validate`
  - [ ] fixture `search`
  - [ ] editor package smoke checks (when toolchains are present)
- [ ] Emit machine-readable JSON summary (`release_check_report.json`) with `schemaVersion`.
- [ ] Add `--strict` and `--allow-missing-toolchains` modes.
- [ ] Ensure timestamps in report are ISO 8601.

#### Touchpoints
- `tools/release-check.js` (new)
- `package.json`
- `src/retrieval/cli/*` (if command wiring changes)

#### Tests
- [ ] `tests/tooling/release-check/smoke.test.js`
- [ ] `tests/tooling/release-check/report-schema.test.js`
- [ ] `tests/tooling/release-check/deterministic-order.test.js`

### 16.3 Cross-platform path safety and spaces

#### Objective
Guarantee path handling works on Windows and POSIX, including spaces and separator edge cases.

#### Tasks
- [ ] Audit CLI/build/search path joins and normalization sites.
- [ ] Replace brittle string concatenation with path-safe helpers.
- [ ] Add explicit tests for:
  - [ ] spaces in repo root
  - [ ] spaces in outDir
  - [ ] Windows drive-letter paths
  - [ ] mixed slash inputs from user args
  - [ ] UNC path handling policy
- [ ] Document canonical internal path normalization rules.

#### Touchpoints
- `src/shared/path-utils.js` (new or extend)
- `src/index/build/*`
- `src/retrieval/cli/*`

#### Tests
- [ ] `tests/paths/windows-spaces-index-build.test.js`
- [ ] `tests/paths/windows-drive-letter-normalization.test.js`
- [ ] `tests/paths/mixed-separators-cli.test.js`

### 16.4 Reproducible editor package outputs

#### Objective
Ensure editor integrations package deterministically and can be validated in CI.

#### Tasks
- [ ] Add packaging scripts for Sublime and VS Code with deterministic file ordering.
- [ ] Stamp package metadata from one canonical version source.
- [ ] Validate archive structure and required files.
- [ ] Define non-blocking behavior when VS Code packaging toolchain is absent.

#### Touchpoints
- `tools/package-sublime.js` (new or extend)
- `tools/package-vscode.js` (new or extend)
- `extensions/`
- `sublime/`

#### Tests
- [ ] `tests/tooling/package-sublime-structure.test.js`
- [ ] `tests/tooling/package-sublime-reproducible.test.js`
- [ ] `tests/tooling/package-vscode-structure.test.js`
- [ ] `tests/tooling/package-vscode-toolchain-missing-policy.test.js`

### 16.5 Optional Python capability model

#### Objective
Stop false-red CI failures when Python is absent while preserving strong checks when it is present.

#### Tasks
- [ ] Add a single Python capability probe helper and use it across tests/tools.
- [ ] Standardize skip reason codes and messages.
- [ ] Ensure all Python-dependent tests are capability-gated and skip deterministically.
- [ ] Ensure syntax/behavior tests run and fail normally when Python is present.

#### Touchpoints
- `src/shared/capabilities.js`
- `tests/*` Python-dependent lanes

#### Tests
- [ ] `tests/tooling/python/skip-when-missing.test.js`
- [ ] `tests/tooling/python/run-when-present.test.js`
- [ ] `tests/tooling/python/skip-reason-contract.test.js`

### 16.6 CI gate policy and release enforcement

#### Objective
Make release gating rules explicit and machine-checkable.

#### Tasks
- [ ] Add `docs/guides/ci-gate-policy.md` defining:
  - [ ] required blocking jobs
  - [ ] advisory jobs
  - [ ] retry policy by failure taxonomy
- [ ] Add a CI summary checker that fails if required jobs are missing.
- [ ] Add release checklist artifact upload policy.

#### Touchpoints
- `docs/guides/ci-gate-policy.md` (new)
- `.github/workflows/ci.yml`
- `.github/workflows/ci-long.yml`
- `.github/workflows/nightly.yml`
- `tools/release-check.js`

#### Tests
- [ ] `tests/tooling/ci-gates-required-jobs.test.js`
- [ ] `tests/tooling/ci-gates-failure-taxonomy.test.js`

---

## Phase 20 - Terminal-Owned TUI and Supervisor Architecture

### Objective
Deliver a terminal-owned TUI and supervisor model with protocol v2, deterministic orchestration, and cancellation guarantees.

### Non-goals
- Replacing core retrieval/index contracts defined in prior phases.
- Introducing non-deterministic orchestration behavior.

### Exit criteria
- Protocol v2 is versioned and documented.
- Supervisor handles lifecycle, retries, and cancellation deterministically.
- TUI remains responsive under heavy operations.
- Logs/traces are replayable and correlated by request/session IDs.

### Docs that must be updated
- `docs/specs/progress-protocol-v2.md`
- `docs/specs/node-supervisor-protocol.md`
- `docs/specs/tui-tool-contract.md`
- `docs/specs/tui-installation.md`
- `docs/guides/service-mode.md`
- `docs/guides/commands.md`
- `docs/contracts/search-contract.md`
- `docs/contracts/mcp-api.md`

### 20.1 Protocol v2 contract

#### Tasks
- [ ] Define message schema with `schemaVersion`.
- [ ] Define request/response event order guarantees.
- [ ] Define capability negotiation for optional features.
- [ ] Define error taxonomy and stable codes.

#### Touchpoints
- `src/shared/cli/progress-events.js`
- `src/shared/progress.js`
- `src/integrations/mcp/protocol.js`
- `src/integrations/mcp/defs.js`

#### Tests
- [ ] `tests/tui/protocol-v2-schema.test.js`
- [ ] `tests/tui/protocol-v2-ordering.test.js`

### 20.2 Supervisor lifecycle model

#### Tasks
- [ ] Implement supervisor states (`idle`, `running`, `cancelling`, `failed`, `completed`).
- [ ] Define retry policy and backoff for recoverable failures.
- [ ] Ensure child process cleanup is deterministic.
- [ ] Add structured lifecycle events.

#### Touchpoints
- `src/retrieval/cli/runner.js`
- `src/retrieval/cli/search-runner.js`
- `src/retrieval/cli/run-search-session.js`
- `src/shared/cli/noop-task.js`

#### Tests
- [ ] `tests/tui/supervisor-lifecycle-state-machine.test.js`
- [ ] `tests/tui/supervisor-retry-policy.test.js`

### 20.3 Cancellation and deadlines

#### Tasks
- [ ] Propagate cancellation tokens and deadlines through all stages.
- [ ] Ensure partial outputs are flagged as partial and deterministic.

#### Touchpoints
- `src/retrieval/cli/run-search-session.js`
- `src/retrieval/cli/runner.js`
- `src/shared/cli/display/progress.js`
- `src/integrations/core/build-index/progress.js`

#### Tests
- [ ] `tests/tui/cancel-propagation.test.js`

### 20.4 TUI rendering and responsiveness

#### Tasks
- [ ] Keep rendering on main terminal loop; move heavy compute off UI path.
- [ ] Add bounded update cadence and batching.
- [ ] Ensure accessibility fallback mode for low-capability terminals.

#### Touchpoints
- `src/shared/cli/display/render.js`
- `src/shared/cli/display/terminal.js`
- `src/shared/cli/display/text.js`
- `src/shared/cli/display/colors.js`

#### Tests
- [ ] `tests/tui/rendering/responsiveness-under-load.test.js`
- [ ] `tests/tui/rendering/partial-stream-order.test.js`

### 20.5 Observability and replay

#### Tasks
- [ ] Add request/session IDs across supervisor and worker stages.
- [ ] Emit replayable event log format.
- [ ] Add tooling to replay and diff runs.

#### Touchpoints
- `src/retrieval/cli/telemetry.js`
- `src/retrieval/cli/persist.js`
- `src/shared/bench-progress.js`
- `docs/guides/metrics-dashboard.md`

#### Tests
- [ ] `tests/tui/observability/session-correlation.test.js`
- [ ] `tests/tui/observability/replay-determinism.test.js`

---

## Optional Exploration - Native/WASM Acceleration (What If We Didnt Need Shoes)

### Objective
Evaluate optional native/WASM acceleration for hot paths with strict correctness parity and clean JS fallback behavior.

### Non-goals
- Mandatory native dependencies.
- Functional semantic changes vs JS baseline.

### Docs that must be updated
- `docs/specs/native-accel.md` (new canonical)
- `docs/perf/native-accel.md` (new)
- `docs/guides/commands.md`
- `docs/contracts/retrieval-ranking.md`

### Stage order (required)
1. Subphase 0 - Feasibility gate.
2. Subphase A - Bitmap engine.
3. Subphase B - Top-K and score accumulation.
4. Subphase C - ANN acceleration and preflight.
5. Subphase D - Worker-thread offload.
6. Subphase E - Build and release strategy.

### Subphase 0 - Feasibility gate

#### Tasks
- [ ] Select ABI strategy (Node-API, WASM, or hybrid).
- [ ] Define a small parity harness for critical paths.
- [ ] Publish a short design note with fallback behavior.

#### Touchpoints
- `src/shared/native-accel.js` (new)
- `src/shared/capabilities.js`
- `docs/specs/native-accel.md`
- `tools/build-native.js` (new)

#### Tests
- [ ] `tests/retrieval/native/feasibility-parity-harness.test.js`

### Subphase A - Native bitmap engine

#### Tasks
- [ ] Add optional bitmap module with `and/or/andNot`.
- [ ] Keep stable JS fallback shim.
- [ ] Preserve deterministic iteration ordering.

#### Touchpoints
- `src/retrieval/bitmap.js`
- `src/retrieval/filters.js`
- `src/retrieval/filter-index.js`
- `src/shared/native-accel.js` (new)

#### Tests
- [ ] `tests/retrieval/native/bitmap-equivalence.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

### Subphase B - Native top-K and score accumulation

#### Tasks
- [ ] Add native top-K with stable tie-break behavior.
- [ ] Add native score accumulation buffers.
- [ ] Add adversarial tie-case parity fixtures.

#### Touchpoints
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/rankers.js`
- `src/shared/native-accel.js` (new)

#### Tests
- [ ] `tests/retrieval/native/topk-equivalence.test.js`
- [ ] `tests/retrieval/native/topk-adversarial-tie-parity.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

### Subphase C - ANN acceleration and preflight

#### Tasks
- [ ] Add optional ANN acceleration backend.
- [ ] Add preflight error taxonomy and stable codes:
  - [ ] `dims_mismatch`
  - [ ] `metric_mismatch`
  - [ ] `index_corrupt`
- [ ] Keep JS ANN fallback with identical semantics.

#### Touchpoints
- `src/retrieval/ann/providers/`
- `src/retrieval/pipeline/candidates.js`
- `src/shared/native-accel.js` (new)
- `docs/specs/native-accel.md`

#### Tests
- [ ] `tests/retrieval/native/ann-equivalence.test.js`
- [ ] `tests/retrieval/native/ann-preflight-error-taxonomy.test.js`
- [ ] `tests/retrieval/native/capability-fallback.test.js`

### Subphase D - Worker-thread pipeline offload

#### Tasks
- [ ] Move heavy retrieval stages to worker pool.
- [ ] Add shared memory arenas where safe.
- [ ] Propagate cancellation/deadlines across worker boundaries.

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/shared/worker-pool.js` (new or extend)

#### Tests
- [ ] `tests/retrieval/native/worker-offload-equivalence.test.js`
- [ ] `tests/retrieval/native/worker-cancel.test.js`

### Subphase E - Build and release strategy

#### Tasks
- [ ] Add optional deterministic native build steps.
- [ ] Add capability diagnostics and troubleshooting docs.
- [ ] Define CI behavior when native toolchains are absent.
- [ ] Keep native path non-blocking by default.

#### Touchpoints
- `tools/build-native.js` (new)
- `package.json`
- `.github/workflows/ci.yml`
- `docs/perf/native-accel.md`

#### Tests
- [ ] `tests/retrieval/native/capability-fallback.test.js`
