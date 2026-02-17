# SKYMAP

## Roadmap rules
- This roadmap is the canonical execution plan for upcoming phases.
- Every subphase follows the same shape: Objective, Tasks, Touchpoints, Tests, Exit checks.
- Every subphase must keep touchpoints current as files move or are renamed.
- Every phase must list canonical docs/specs that are required to stay in sync.
- Any behavior change must update contracts/docs/tests in the same subphase before it is checked off.
- Determinism is required: stable ordering, stable IDs, stable explain output, and stable failure codes.
- Prefer the simplest implementation that satisfies the contract.
- For performance work, require obvious wins and lightweight regression checks first; only add deep measurement work if regressions or unclear tradeoffs appear.
- Security and scope limits are explicit for document extraction:
  - No OCR support.
  - No scanned-image PDF support.
  - No encrypted or password-protected document support.
  - No macro-enabled document execution or evaluation.
- Backward compatibility policy:
  - Readers must ignore unknown forward fields.
  - Writers must bump versioned schema fields when shape meaning changes.

## Feature definition standards
- Every feature task must explicitly state:
  - behavior change
  - deterministic constraints (ordering/identity/output shape)
  - fallback and failure behavior (including reason/error codes when applicable)
  - config/docs/contracts that must change with code
- Avoid ambiguous language like `optimize`, `fast`, or `improve` without naming the exact mechanism.
- Tasks that introduce knobs must define defaults and safe bounds in the same subphase.

## Test definition standards
- Every test listed in this roadmap must validate:
  - setup/fixture (including capability gating when relevant)
  - expected behavior/result shape
  - determinism or parity (same input -> same output)
- For error/fallback features, tests must assert the explicit reason/error code.
- Conditional tests must assert deterministic skip behavior and skip reason.
- Throughput-focused tests should use fixed fixtures and simple before/after stage checks; avoid heavyweight benchmarking as a gate.
- If a test item has no sub-bullets, it still inherits these requirements.

## Ordered execution map
1. Phase 16 - Release and platform baseline.
2. Phase 21 - Terminal-owned TUI and supervisor architecture.
3. Optional Exploration

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
- [ ] Add `node tools/release/check.js` and wire `npm run release-check`.
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
- `tools/release/check.js` (new)
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
- `tools/release/check.js`

#### Tests
- [ ] `tests/tooling/ci-gates-required-jobs.test.js`
- [ ] `tests/tooling/ci-gates-failure-taxonomy.test.js`

---

## Phase 21 - Terminal-Owned TUI and Supervisor Architecture

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

### 21.1 Protocol v2 contract

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
  - [ ] Valid protocol envelopes parse against schema; invalid envelopes fail with stable reason codes.
- [ ] `tests/tui/protocol-v2-ordering.test.js`
  - [ ] Request/response event ordering contract is preserved across repeated runs.

### 21.2 Supervisor lifecycle model

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
  - [ ] State transitions follow allowed graph (`idle -> running -> ...`) with no illegal edges.
- [ ] `tests/tui/supervisor-retry-policy.test.js`
  - [ ] Recoverable failures retry with configured policy; terminal failures stop deterministically.

### 21.3 Cancellation and deadlines

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
  - [ ] Cancellation reaches all active stages and marks outputs as partial consistently.

### 21.4 TUI rendering and responsiveness

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
  - [ ] Rendering loop continues updating while background work is active.
- [ ] `tests/tui/rendering/partial-stream-order.test.js`
  - [ ] Streamed partial output order is deterministic for identical event sequences.

### 21.5 Observability and replay

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
  - [ ] Session/request IDs are present and consistent across emitted events.
- [ ] `tests/tui/observability/replay-determinism.test.js`
  - [ ] Replay of recorded events reproduces the same rendered sequence.

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
  - [ ] Harness verifies native and JS paths return equivalent ranked outputs on seed fixtures.
  - [ ] Capability detection falls back to JS path without behavior drift.

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
  - [ ] Native bitmap set operations (`and/or/andNot`) match JS results exactly.
- [ ] `tests/retrieval/native/capability-fallback.test.js`
  - [ ] Missing native module triggers JS fallback with identical observable behavior.

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
  - [ ] Native top-k output ordering matches JS baseline including tie-breaks.
- [ ] `tests/retrieval/native/topk-adversarial-tie-parity.test.js`
  - [ ] Adversarial equal-score fixtures preserve deterministic tie ordering.
- [ ] `tests/retrieval/native/capability-fallback.test.js`
  - [ ] Fallback path parity holds for top-k and score accumulation.

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
  - [ ] ANN candidate/output parity matches JS backend for same index/query fixtures.
- [ ] `tests/retrieval/native/ann-preflight-error-taxonomy.test.js`
  - [ ] Preflight rejects invalid configs with exact taxonomy codes.
- [ ] `tests/retrieval/native/capability-fallback.test.js`
  - [ ] ANN path falls back cleanly when native backend is unavailable.

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
  - [ ] Worker-offloaded pipeline returns same outputs/order as single-thread baseline.
- [ ] `tests/retrieval/native/worker-cancel.test.js`
  - [ ] Cancellation propagates across worker boundaries and halts work deterministically.

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
  - [ ] Build/install-time missing native toolchains keep default JS path functional.

---

## Completion policy
- Checkboxes are completed only when code, docs, and tests for that item are landed together.
- Test checkboxes are completed only after the test has run and passed.
- If a test fix fails 3 times, log attempts and move to the next unresolved test.
- When a phase is complete, move it to `COMPLETED_PHASES.md` per repo process.
- Keep roadmap touchpoints current as files move; update touched paths in `SKYMAP.md` in the same change.
- When spec names/locations change, add replacement pointers and archive superseded spec docs under `docs/archived/`.
