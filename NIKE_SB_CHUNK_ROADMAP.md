# NIKE_SB_CHUNK_ROADMAP

A phased roadmap to implement targeted platform improvements. Each phase includes granular tasks, touchpoints, and tests. Line numbers are approximate; refer to symbol names for accuracy.

---

## Decision Register (resolve before execution)

- [ ] **D1 `api_contracts_meta`**: add schema + writer vs remove from docs.
- [ ] **D2 N‑1 major support for 0.x**: change code or document current behavior.
- [ ] **D3 Extensions-only vs extra fields**: tighten schemas or relax docs.
- [ ] **D4 Graph explain shape**: update docs or change output.
- [ ] **D5 Impact empty inputs**: enforce error or document warning+empty result.
- [ ] **D6 Graph product surfaces spec**: keep authoritative + update or archive.
- [ ] **D7 Risk trimming/ordering**: enforce spec in code or update specs.
- [ ] **D8 Tooling IO `fileTextByFile`**: implement cache or update spec to VFS.
- [ ] **D9 TS provider heuristic IDs**: remove from code or allow in spec.
- [ ] **D10 VFS manifest trimming**: enforce deterministic trim or update spec.
- [ ] **D11 Promote `docs/new_docs/*`**: promote into specs or archive/remove.

---

## Phase 1 — Doc/Config/Schema Foundations

### 1.1 Doc contract checks (CI)
- Goal: validate doc drift for CLI flags, schema lists, and lane lists; emit diff summary.
- Touchpoints:
  - `tools/ci/run-suite.js` (add optional doc-check step or new job)
  - `tools/ci/*` (runner wiring)
  - `docs/contracts/*`, `docs/specs/*`, `docs/testing/*` (inputs)
  - `src/retrieval/cli-args.js` (CLI flags source)
  - `src/contracts/schemas/*.js` (schema lists)
  - `tests/run.rules.jsonc`, `tests/run.js` (lane list)
- Tasks:
  - [ ] Define `tools/doc-contract-check.js` to compare:
    - [ ] CLI flags in docs vs `src/retrieval/cli-args.js`.
    - [ ] Artifact lists in docs vs `src/contracts/schemas/artifacts.js`.
    - [ ] Lanes in docs vs `tests/run.rules.jsonc`.
  - [ ] Produce a machine-readable diff and short CI summary.
  - [ ] Add CI job in workflow (or CI suite script) that fails on drift.
- Tests:
  - [ ] `tests/tooling/docs/doc-contract-check.test.js` detects a known mismatch fixture.
  - [ ] Smoke test returns clean when inputs match.
- Acceptance:
  - [ ] CI doc‑check job fails on intentional drift and passes when aligned.

### 1.2 Config surface unification
- Goal: generate `docs/config/contract.md` from schema + env registry.
- Touchpoints:
  - `docs/config/schema.json` (authoritative schema)
  - `src/shared/env.js` (env registry)
  - `docs/config/contract.md` (generated)
  - `tools/config-inventory.js` or new generator
- Tasks:
  - [ ] Create generator script (e.g., `tools/config-contract-doc.js`).
  - [ ] Include schema keys, defaults, descriptions, env overrides.
  - [ ] Mark `docs/config/contract.md` as generated; guard in doc contract check.
- Tests:
  - [ ] Unit test verifies generator output contains key sections and key counts.
- Acceptance:
  - [ ] Contract doc rebuild is deterministic and matches schema+env inputs.

### 1.3 Artifact schema registry export
- Goal: emit machine-readable schema index (name -> version/required fields).
- Touchpoints:
  - `src/contracts/schemas/artifacts.js` (`ARTIFACT_SCHEMA_DEFS`)
  - `docs/contracts/artifact-schemas.md` (reference)
  - `tools/` (exporter)
- Tasks:
  - [ ] Add `tools/export-artifact-schema-index.js` writing JSON to `docs/contracts/artifact-schema-index.json`.
  - [ ] Include schemaVersion and required fields list per artifact.
  - [ ] Update doc contract check to compare doc lists with index.
- Tests:
  - [ ] Unit test verifies exported JSON includes a known artifact with required fields.
- Acceptance:
  - [ ] Exported index matches schema registry and is referenced by docs/CI.

---

## Phase 2 — Index Artifact Robustness

### 2.1 Deterministic trimming for oversized JSONL rows
- Goal: apply uniform, deterministic trimming policy for risk/vfs/call-sites.
- Touchpoints:
  - `src/index/build/artifacts/writers/call-sites.js` (row trimming)
  - `src/index/build/artifacts/writers/*` (risk summaries/flows)
  - `src/index/tooling/vfs.js` (vfs_manifest row handling)
  - `src/contracts/schemas/artifacts.js` (extensions optional object)
- Tasks:
  - [ ] Define a shared trimming helper (e.g., `src/shared/artifact-io/limits.js` or `src/index/build/artifacts/trim.js`).
  - [ ] Trimming order: extensions -> graphs -> optional arrays -> optional strings; never null required objects.
  - [ ] Emit counters for trimmed fields in stats artifacts.
  - [ ] Update schemas/docs to reflect trimming behavior.
- Tests:
  - [ ] Unit tests for each writer verify:
    - [ ] Oversized row trimmed deterministically.
    - [ ] Required fields remain valid.
    - [ ] Counters increment in stats.
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
  - [ ] Update validation to allow/expect report where configured.
- Tests:
  - [ ] New test for report emission with known fields.
- Acceptance:
  - [ ] Determinism report is present on builds that opt-in and passes validation.

---

## Phase 3 — Search/Graph UX + Explain Contract

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
  - [ ] Validate "no membership change"; throw or warn if violated.
- Tests:
  - [ ] CLI parsing test for flag.
  - [ ] Graph ranking membership invariant test.
- Acceptance:
  - [ ] Flag works and membership invariant enforced.

### 3.3 Search result UX cleanup
- Goal: configurable output format; reduce non-search info in default/JSON.
- Touchpoints:
  - `src/retrieval/output/format.js`
  - `src/retrieval/output/summary.js`
  - `src/retrieval/output/explain.js`
  - `src/retrieval/output/context.js`
  - `docs/guides/search.md`
- Tasks:
  - [ ] Add modes: compact, symbol-first, context-only (CLI flags + config).
  - [ ] Ensure default JSON excludes heavyweight graph/AST fields unless `--explain`.
  - [ ] Update docs and schema for output fields.
- Tests:
  - [ ] Output snapshot tests for each mode.
  - [ ] JSON output shape tests (default vs explain).
- Acceptance:
  - [ ] Default and JSON output are concise unless explicit explain flags used.

### 3.4 Impact analysis strictness
- Goal: decide and implement validation for empty seeds/changed.
- Touchpoints:
  - `src/graph/impact.js` (analysis)
  - `src/integrations/tooling/impact.js`
  - `docs/contracts/graph-tools-cli.md`
- Tasks:
  - [ ] If strict: throw on empty inputs + add structured warning code for legacy callers.
  - [ ] Update docs accordingly.
- Tests:
  - [ ] New tests for strict mode (errors) and legacy warning behavior.
- Acceptance:
  - [ ] Behavior is explicit and documented.

---

## Phase 4 — SCM Contract & Workspace Scaffolding

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
  - [ ] Add CLI or tool entrypoint for validation.
- Tests:
  - [ ] Schema validation tests for both files.
  - [ ] Emission test with deterministic ordering.
- Acceptance:
  - [ ] Workspace config/manifest are schema-validated and emitted deterministically.

---

## Phase 5 — Test Runner + Coverage + Profiling

### 5.1 Timings ledger + watchdog
- Goal: machine-readable test timing outputs and hung-test watchdog.
- Touchpoints:
  - `tests/run.js` (runner)
  - `tests/runner/*` (formatting + harness)
  - `.testLogs/*` (output)
- Tasks:
  - [ ] Add `--log-times` emitting JSON/CSV with test name + duration.
  - [ ] Add watchdog for hung tests (configurable grace period).
  - [ ] Add ordering hints from ledger (optional).
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
- Tasks:
  - [ ] Add runner flag `--coverage` to wrap lane runs with c8.
  - [ ] Add `--coverage-merge` to merge lane reports into one.
  - [ ] Add `--coverage-changed` using git diff to limit to changed files.
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
- Tests:
  - [ ] Unit test verifying profile artifact created when flag set.
- Acceptance:
  - [ ] Profile artifacts emitted when enabled and omitted otherwise.

---

## Phase 6 — CLI polish & error telemetry

### 6.1 Tooling ingest CLI wrappers
- Goal: add CLI wrappers in `bin/pairofcleats.js`.
- Touchpoints:
  - `bin/pairofcleats.js`
  - `tools/ctags-ingest.js`, `tools/gtags-ingest.js`, `tools/lsif-ingest.js`, `tools/scip-ingest.js`
- Tasks:
  - [ ] Add `pairofcleats ingest <ctags|gtags|lsif|scip>` routes.
  - [ ] Update docs and help output.
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
  - [ ] Ensure all surfaces attach code + hint.
- Tests:
  - [ ] API error response tests.
  - [ ] MCP error payload tests.
  - [ ] CLI error formatting test.
- Acceptance:
  - [ ] Errors across surfaces include consistent codes + hints.

---

## Phase 7 — Documentation updates (wrap-up)

- [ ] Update `docs/contracts/*`, `docs/specs/*`, `docs/guides/*`, `docs/testing/*`, `docs/tooling/*`, `docs/api/*`, `docs/config/*`, `docs/perf/*`, `docs/benchmarks/*` per Phase 1–6 changes.
- [ ] Update `COSMIC_DOCS_LEDGER.md` with resolution status per doc.
- Acceptance:
  - [ ] All updated docs pass doc-contract check.

---

## Cross-cutting tests to run

- [ ] `node tests/run.js --lane ci-lite`
- [ ] `node tests/run.js --lane ci`
- [ ] `node tests/run.js --lane ci-long` (if behavior impacts large artifacts or SCM)
- [ ] Specific targeted tests:
  - [ ] Search explain output tests
  - [ ] Graph ranking tests
  - [ ] Risk artifacts validation tests
  - [ ] Tooling provider registry tests
  - [ ] Runner timing/coverage tests

---

## Acceptance criteria

- [ ] Doc contract check passes in CI.
- [ ] `docs/config/contract.md` is generated from schema/env.
- [ ] Artifact schema index JSON exists and matches schema.
- [ ] Oversized rows trimmed deterministically with counters.
- [ ] Explain output schema versioned and stable.
- [ ] CLI parity achieved for graph ranking and ingest tools.
- [ ] Workspace config/manifest validation stubs present.
- [ ] Test runner emits timing ledger and coverage merge output.
- [ ] Error telemetry codes consistent across surfaces.
