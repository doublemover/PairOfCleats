# NIKE_SB_CHUNK_ROADMAP

A phased roadmap to implement targeted platform improvements. Each phase includes granular tasks, touchpoints, and tests. Line numbers are approximate; refer to symbol names for accuracy.

---

## Decision Register (resolve before execution)

| Decision | Description | Default if Unresolved | Owner | Due Phase |
| --- | --- | --- | --- | --- |
| D1 `api_contracts_meta` | Add schema + writer vs remove from docs. | Remove from docs and keep it out of the contract until a schema exists. | TBD | Phase 2 |
| D2 N‑1 major support for 0.x | Change code or document current behavior. | Document current behavior, add a compatibility note, and revisit in Phase 5. | TBD | Phase 3 |
| D3 Extensions-only vs extra fields | Tighten schemas or relax docs. | Tighten schemas; explicitly whitelist extension fields if needed. | TBD | Phase 2 |
| D4 Graph explain shape | Update docs or change output. | Align output to docs and version the explain schema. | TBD | Phase 3 |
| D5 Impact empty inputs | Enforce error or document warning+empty result. | Default to error; allow legacy warning only with explicit flag. | TBD | Phase 3 |
| D6 Graph product surfaces spec | Keep authoritative + update or archive. | Keep authoritative and update docs to match behavior. | TBD | Phase 3 |
| D7 Risk trimming/ordering | Enforce spec in code or update specs. | Enforce spec in code, add deterministic trimming rules. | TBD | Phase 2 |
| D8 Tooling IO `fileTextByFile` | Implement cache or update spec to VFS. | Update spec to VFS and treat cache as optional. | TBD | Phase 4 |
| D9 TS provider heuristic IDs | Remove from code or allow in spec. | Allow in spec with explicit marker and phase-out plan. | TBD | Phase 3 |
| D10 VFS manifest trimming | Enforce deterministic trim or update spec. | Enforce deterministic trim with counters. | TBD | Phase 2 |
| D11 Promote `docs/new_docs/*` | Promote into specs or archive/remove. | Promote only docs with implementation + tests; archive the rest. | TBD | Phase 6 |

## Glossary

- Membership invariant: graph ranking does not change the set of items returned, only their order.
- Explain schema: the structured, versioned JSON emitted by `--explain`.
- Trim policy: deterministic rules for dropping optional fields when rows exceed size limits.
- Determinism report: artifact listing known nondeterministic fields and their sources.

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

### Phase 1 Exit Criteria
- [ ] Contract versioning and forward-compat rules are documented and tested.
- [ ] Path normalization policy is defined and validated.
- [ ] Deterministic serialization rules are enforced in code and tests.

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
  - `tools/ctags-ingest.js`, `tools/gtags-ingest.js`, `tools/lsif-ingest.js`, `tools/scip-ingest.js`
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
