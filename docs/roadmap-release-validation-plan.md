# Roadmap Release Validation Plan

Status: Active companion plan
Canonical status source: `docs/roadmap.md`
Scope: release-proof validation for the roadmap initiatives that are marked done, in progress, or release-sensitive.
Ownership note: this file defines validation and evidence expectations only. It does not replace focused specs, contracts, schemas, validators, or the roadmap status table.

## Purpose

Roadmap release proof needs more than a green generic test lane. Release readiness must prove that the implemented initiatives still satisfy their public contracts, are operationally supportable, and have bounded performance behavior on the production paths they affect.

This plan turns the roadmap's validation queue into executable release lanes with:

- exact command groups that can be run from the repository root in PowerShell 7.5;
- the 30 second per-test handling required by the repository guidance;
- acceptance evidence expected for each lane;
- blocker handling rules for failures, timeouts, missing evidence, and stale generated artifacts;
- quality and performance gates that map directly to the active specs.

## Ground Rules

Run commands from the repo root:

```powershell
Set-Location 'C:\Users\sneak\Development\DOUBLECLEAT'
```

Use the repo test runner for tests. `tests/run.js` imports the testing-env helper and sets `PAIROFCLEATS_TESTING=1`, which is required before other `PAIROFCLEATS_TEST_*` variables are honored. Use direct `node` only for syntax checks or non-test tooling that is not registered with the runner.

Every validation command that runs tests must enforce the repository 30 second guidance. Put test selectors before `--lane=all` so positional selectors are parsed correctly and release evidence is not accidentally limited to the default lane:

```powershell
node tests/run.js '<test-id-or-substring>' --lane=all --timeout-ms 30000
```

Runner-recorded timeouts are blocking timeout failures in the release evidence set. If an individual test exceeds 30 seconds, stop it through the runner timeout, record the timeout row and follow-up, and continue with the next selected test; use `skipped-timeout-30s` only when an operator intentionally skips a not-yet-run selector because a prior command already proved it cannot complete under the 30 second policy. Do not silently rerun slow tests with larger timeouts in the release evidence pass. Longer perf/report generation commands may be listed separately as advisory evidence, but they must not be confused with the 30 second test pass/fail set.

## Evidence Envelope

For every release validation pass, record one evidence bundle under a durable PR artifact or release note. The bundle should contain:

- date/time (`Captured at`), branch, commit SHA, worktree state, Node version, npm version, OS, and whether native optional dependencies were available;
- exact commands run, exit code, elapsed time, and pass/fail/skip classification;
- a table of skipped tests with the skip reason, including `skipped-timeout-30s` only for intentionally operator-skipped selectors;
- generated or checked artifact paths, including `.testLogs/*` timing files when produced;
- blocker decisions with owner, severity, and required next action;
- waiver IDs and expiry dates for any accepted non-blocking release variance;
- confirmation that `docs/roadmap.md` status was not advanced without matching validation evidence.

Minimum evidence table shape:

| Lane | Command | Result | Exit | Elapsed | Evidence | Checked artifacts | Blocker? | Blocker owner/severity/action | Waiver |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `stage1-contract` | `node tests/run.js indexing/stage1 --lane=all --timeout-ms 30000` | pass/fail/skip | `<exit-code>` | `<duration>` | `temp/validation/...`; `.testLogs/...` | `docs/...`; generated artifact paths | yes/no | owner / severity / required action, or `none` | waiver ID and expiry, or `none` |

## Release Lane Order

Run lanes in this order so failures stop the correct downstream claims:

1. `docs-and-governance`: prove the roadmap, scripts, links, and generated governance surfaces are aligned.
2. `usr-gates`: prove USR gate artifacts, matrices, and validators are coherent.
3. `stage1-contract`: prove ordered throughput hard-cutover behavior and bounded memory.
4. `risk-artifacts`: prove Phase 10 interprocedural risk artifacts, stats, context-pack surfaces, and fail-closed behavior.
5. `snapshot-diff-asof`: prove Phase 14 IndexRef, snapshot, diff, retention, privacy, and as-of retrieval behavior.
6. `lexicon-retrieval`: prove lexicon wordlists, relation filtering, relation boosts, ANN candidate safety, and retrieval ranking explainability.
7. `production-readiness`: prove release tooling, docs contracts, API/service/config surfaces, and dry-run checks.
8. `perf-quality-final`: prove no release-sensitive performance, determinism, or quality regressions remain.

Do not proceed to a broader release claim if a prior lane has unresolved blocking failures. It is acceptable to continue running later lanes for diagnostic signal, but label the release decision as blocked by the first unresolved blocker.

## Current Evidence Snapshot

Latest branch evidence as of 2026-05-22:

- Durable evidence envelope: `docs/roadmap-release-validation-evidence-20260521.md` records branch, commit, worktree state, runtime versions, lane commands, pass/fail/skip handling, blockers, waivers, and roadmap status handling. The detailed command transcripts remain in the cited `temp/validation/**` logs.
- `docs-and-governance` and `usr-gates`: passed in `temp/validation/release-lanes-docs-usr-20260521.log`.
- `stage1-contract`, `risk-artifacts`, and `snapshot-diff-asof`: passed in `temp/validation/release-lanes-stage1-risk-snapshot-20260521.log`.
- `lexicon-retrieval` and release surface runtime proof: passed after API/MCP surface runtime tests were split into bounded selectors in `temp/validation/release-runtime-split-20260521.log`.
- Roadmap/backlog proof follow-up: previously unresolved run-node/helper timeout-proof selectors passed 11/11 with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/roadmap-unresolved-proof-fixes-final-20260521.log`.
- `production-readiness`: passed in `temp/validation/production-verify-final-20260521.log`.
- `perf-quality-final`: the full perf lane passed 95 tests with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/perf-lane-final-20260521.log`.
- Generated-surface, shared-module review, and USR local-readiness follow-up passed in `temp/validation/roadmap-final-focused-validation-20260521.log`: 15 focused selectors passed with 0 failures, 0 timeouts, and 0 skipped; USR matrix drift and generated-surface registry/freshness checks also passed.
- Local roadmap gap follow-up: config inventory now excludes `temp/**` and no longer catalogs the temporary `temp/head-graph-worktree` checkout; generated surfaces and shared-module ledgers were refreshed after the new split tests; focused validation passed 14 selectors with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/roadmap-final-local-gap-validation-rerun-20260521.log`.
- Indexer-service timeout-proof follow-up: `services/indexer/queue-identity-cli` is split into status, enqueue, and shutdown/stop-accepting selectors that passed 3/3 in `temp/validation/queue-identity-cli-split-validation-20260521.log`; `services/indexer/repair-cli` is split into quarantine, retry, purge, inspect, unlock, and cleanup-orphans selectors that passed 6/6 in `temp/validation/repair-cli-split-validation-rerun-20260521.log`; that runner log preserves an initial malformed ESLint invocation, and corrected targeted ESLint proof passed in `temp/validation/repair-cli-split-eslint-rerun-20260521.log`.
- Post-evidence documentation checks passed in `temp/validation/roadmap-post-final-doc-patch-validation-20260521.log`: stale unresolved-marker scan had no matches, generated-surface freshness passed, markdown link check passed, and `git diff --check` passed.
- The former Gate C approval handoff is archived at `docs/archived/usr-rollout-approval-lock.md`; current USR release readiness is based on matrix drift, checklist, markdown link, and diff checks.
- USR language/framework templates now use non-checkbox placeholder rows so broad checklist audits only surface concrete contract approval rows; the template guard, USR checklist guard, markdown link check, generated-surface freshness check, and diff check passed in `temp/validation/usr-template-placeholder-validation-20260521.log`.
- USR contract semantics are guarded by `tests/tooling/docs/usr-contract-checklists.test.js`: the test verifies language/framework matrix linkage, fixture-family coverage, executable conformance shards, and non-active template placeholders. Validation passed in `temp/validation/usr-contract-checklist-validation-20260522.log`.
- The roadmap now records Gate A/B/B8 technical evidence as locally green and does not require non-technical approver checkboxes to move release readiness forward. Validation passed in `temp/validation/usr-gate-c-checklist-anchor-validation-20260521.log`.
- The roadmap now also carries the Gate B1-B7 status anchor and Phase A-H rollout lifecycle mapping named by `docs/specs/usr-core-rollout-release-migration.md`; the guard test verifies the migration policy's Phase A-H rows stay anchored in `docs/roadmap.md`. Validation passed in `temp/validation/usr-gate-roadmap-anchor-validation-20260521.log`.
- Roadmap contract cleanup closed the remaining local doc gaps found in the continuation audit: old GIGA roadmap references were replaced by current roadmap/spec anchors, missing evidence-log references were removed, intermediate failed timeout logs were relabeled as historical, all USR required outputs named by active specs are schema-backed in `src/contracts/schemas/usr.js` plus `docs/schemas/usr/**`. Focused validation passed in `temp/validation/roadmap-contract-gap-cleanup-validation-rerun-20260521.log`.
- USR schema registry coverage is guarded bidirectionally: every `USR_REPORT_SCHEMA_DEFS` entry must appear in `docs/schemas/usr/**`, every report schema must have a matching `artifactId` const, non-report registry schemas have explicit docs coverage, the release-plan artifact list must include every report artifact, and the artifact schema catalog must list every report schema. Focused validation passed in `temp/validation/usr-schema-full-registry-coverage-validation-20260521.log`.
- The durable release evidence bundle now has executable evidence-shape guards in `tests/tooling/docs/contract-matrix.test.js`: the test requires exactly eight lane rows with command, result, exit code, elapsed time, cited validation logs, `.testLogs` timing artifacts, blocker owner/action detail, and waiver status. It also verifies cited local logs exist when `temp/validation` exists, checks passing proof markers, requires historical-failure logs to identify the final passing block, enforces required per-test durations at or below 30 seconds, and parses the skips, blockers, and waivers tables. Focused validation passed in `temp/validation/release-evidence-envelope-shape-validation-20260521.log`.
- Duplicate-code status and release-evidence wording are guarded against stale saved-baseline contradictions: old duplicate candidate details are historical/conditional, ordinary roadmap validation does not rerun `jscpd`, release evidence test commands use `node tests/run.js`, and evidence-table durations over 30 seconds must be labeled as command/lane totals rather than per-test proof. Focused validation passed in `temp/validation/roadmap-conditional-duplicate-section-validation-20260521.log`.
- Release evidence envelope consistency is guarded after the worktree-state follow-up: the evidence bundle records `Worktree state`, `Captured at`, and `npm`; the reporting template carries the same fields; current evidence review checks both the plan and evidence bundle for blocker/waiver state. Focused validation passed in `temp/validation/release-evidence-worktree-state-validation-20260521.log`, `temp/validation/release-evidence-envelope-field-alignment-20260521.log`, and `temp/validation/roadmap-approval-handoff-consistency-validation-20260521.log`.
- Current post-envelope docs/USR alignment is included in the durable evidence bundle: `temp/validation/roadmap-final-current-status-validation-20260521.log` keeps the focused docs, generated-surface freshness, USR matrix freshness, local validation-log references, and diff checks green; `temp/validation/usr-framework-c4-policy-lane-guard-validation-20260521.log` verifies the framework C4 policy lane is represented by SLO/benchmark policy rows while execution remains in C4-capable conformance shard validation tests; `temp/validation/usr-current-evidence-handoff-validation-20260522.log` is retained as historical handoff evidence for the archived approval-lock note.
- Final release readiness now mechanically validates `tools/release/readiness-gate.js` technical release evidence: the gate records malformed JSON as precise `*.invalid-json` blockers without duplicate generic missing/failing blockers for TUI, trust, and CI supplemental artifacts, rejects malformed trust/CI supplemental shapes as precise `*.invalid-shape` blockers without duplicate generic blockers, rejects release reports that claim `ok: true` without release-check schema shape, validates release-check ISO-8601 UTC timestamps, validates CI test-summary aggregate counts and per-test row shape, blocks failed/redo CI test-summary rows, validates schema-shaped test coverage artifacts instead of accepting arbitrary coverage files, validates trust-manifest SBOM file existence under the trust root, reports invalid JSON as `invalid-json` in JSON/markdown summaries, rejects duplicate or failed TUI reports for the same target, rejects release walker roots outside the repo, rejects symlinked release-walk entries before hashing, rejects symlinked explicit release-check manifest artifacts before hashing, rejects symlinked readiness input roots before walking TUI, trust, or coverage files, walks release inputs in deterministic binary POSIX-relative order, compares release and CI target SHAs case-insensitively after shape validation, requires trust provenance/checksum source commits to match the prepared release SHA, requires CI and CI Long to auto-trigger on release tags, grants the readiness job `actions: write` for manual CI dispatch fallback, binds metadata to the checked-out release SHA before prepare artifacts are generated, downloads trust material back into `dist/release/trust`, rechecks the publish tag against the prepared release SHA before upload, downloads TUI build artifacts by exact artifact name so build artifacts cannot overlap verification artifacts, rejects release artifact output paths outside the repo before writing bundle, metadata, trust, readiness, release-check, or verify-surface artifacts, validates shipped-surface build/output/artifact registry paths as repo-relative and repo-contained, validates surface archive manifests against archive checksum and entries, and rejects unsafe absolute/backslash/traversing/symlink surface archive entries before extraction. Focused validation passed in `temp/validation/release-readiness-technical-validation-20260522.log`, `temp/validation/release-readiness-sbom-ci-timestamp-hardening-20260521.log`, `temp/validation/readiness-gate-current-technical-validation-20260522.log`, and `temp/validation/readiness-evidence-citation-final-20260522.log`, with release hardening timing artifacts `.testLogs/run-1779394693251-h7wo4i`, `.testLogs/run-1779396105078-nh8a6u`, `.testLogs/run-1779396398373-3sbvhc`, `.testLogs/run-1779397068122-m9b80d`, `.testLogs/run-1779397779653-dxfco2`, `.testLogs/run-1779402456182-yaf1ch`, `.testLogs/run-1779415726577-0jr2cp`, and `.testLogs/run-1779415736438-zs5bxc`.
- The latest release evidence-integrity guard passed 5 selected checks with 0 failures, 0 timeouts, and 0 skipped in `.testLogs/run-1779397779653-dxfco2`, covering readiness report schema-shape rejection, archive-manifest checksum/entry matching, explicit release-check artifact symlink rejection, markdown links, and release evidence table shape.
- The release local-gap hardening guard passed 5 selected checks with 0 failures, 0 timeouts, and 0 skipped in `.testLogs/run-1779399067040-r10p06`, covering TUI release-report schema-shape enforcement, writable output symlink-segment rejection, archive manifest duplicate/size/mode matching, empty explicit release-check scope rejection, and the stale runner-list backlog note repair. The follow-up readiness input/shape guard passed 6 selected checks with 0 failures, 0 timeouts, and 0 skipped in `.testLogs/run-1779400448984-p5flqq`; the CI-quality shape guard passed 6 selected checks with 0 failures, 0 timeouts, and 0 skipped in `.testLogs/run-1779401471005-xdjimn`; the latest SBOM/CI/timestamp hardening guard passed 4 selected checks with 0 failures, 0 timeouts, and 0 skipped in `.testLogs/run-1779402456182-yaf1ch`. The logs record the focused readiness input-root and supplemental-shape guard, schema-shaped coverage and CI test-summary row guards, failed/redo CI summary blocking, trust-manifest SBOM file existence, release-check ISO timestamp enforcement, repair-log/backlog wording cleanup, and the USR checklist guard covering active technical contract status. The older log preserves one Windows-style selector typo that matched no tests; the corrected forward-slash selector run is the passing evidence.
- Continuation readiness hardening passed syntax, targeted ESLint, and the focused readiness selector with 1 passed, 0 failures, 0 timeouts, and 0 skipped in `.testLogs/run-1779403618157-oxz85w`; the transcript is `temp/validation/release-readiness-continuation-hardening-20260521.log`. This covers redo CI summary rows, all release-report timestamp fields including TUI reports, and semantic coverage artifact validation.
- Continuation maintainability cleanup split the readiness-gate suite into a shared fixture and focused report-shape and CI-quality test files while preserving the `node tests/run.js tooling/release/readiness-gate --lane=all --timeout-ms 30000` selector. Syntax, targeted ESLint, and the split readiness selector passed with 4 passed, 0 failures, 0 timeouts, and 0 skipped in `.testLogs/run-1779404895430-mfkr3r`; the transcript is `temp/validation/readiness-gate-test-split-20260521.log`.
- Continuation phase/target hardening now requires release reports to account for every checked phase in `summary.byPhase`, records TUI matrix runtime target metadata through `tools/release/check.js --runtime-target`, passes that target from `.github/workflows/release.yml`, rejects TUI verification reports whose declared `scope.runtimeTarget` does not match their artifact target, and rejects blank, malformed, or duplicated expected TUI target configuration. Syntax, targeted ESLint, `ci/workflow-contract`, `tooling/release/release-check-output-paths`, and the focused readiness selector passed with 6 passed, 0 failures, 0 timeouts, and 0 skipped in `.testLogs/run-1779405640441-sq7eag`; the phase/target transcript is `temp/validation/readiness-gate-phase-target-hardening-20260521.log`. The clean target-config/docs follow-up passed syntax, targeted ESLint, `tooling/release/readiness-gate`, `tooling/docs/contract-matrix`, `tooling/docs/usr-contract-checklists`, `ci/markdown-link-check`, `git diff --check`, and trailing-whitespace checks with 7 runner tests passed, 0 failures, 0 timeouts, and 0 skipped in `.testLogs/run-1779407665034-a0aey8`; the transcript is `temp/validation/readiness-gate-tui-target-config-final-validation-20260521.log`.
- The latest corrected backtick-exact path audit confirmed active roadmap/evidence references are durable: `temp/validation/roadmap-current-completion-audit-20260521.log` found 1266 concrete evidence-artifact paths with 0 missing paths after ignoring documented wildcard patterns and historical removed-source examples. The durable guard now lives in `tests/tooling/docs/contract-matrix.test.js`; focused validation in `temp/validation/roadmap-reference-guard-handoff-final-20260521.log` keeps active roadmap/status handoff docs from citing missing concrete filesystem paths. The follow-up guard in `temp/validation/roadmap-dup-ledger-brace-guard-final-20260522.log` also validates simple brace-grouped active paths and blocks duplicate-status wording that would make stale saved-baseline residuals look like open work.
- Local technical lanes have no known blocker. Final release should cite fresh clean committed-SHA evidence rather than the older branch-local uncommitted handoff bundle.

## Lane 1: Docs And Governance

Purpose: ensure the roadmap consolidation and generated documentation surfaces are internally consistent without reviving archived root roadmap files.

Primary commands:

```powershell
node tests/run.js ci/markdown-link-check tooling/docs/contract-matrix tooling/docs/usr-contract-checklists --lane=all --timeout-ms 30000
node tools/testing/refresh-governance.js
node tests/run.js ci/usr-guardrail-registry-coverage tooling/docs/contract-matrix tooling/docs/usr-contract-checklists --lane=all --timeout-ms 30000
node tools/docs/generated-surfaces.js --check-freshness
node tools/docs/repo-inventory.js --root . --json docs/tooling/repo-inventory.json
git diff --check
```

Advisory generation command:

```powershell
npm run test:refresh-governance
```

Acceptance evidence:

- Markdown links resolve without references to missing root roadmap files such as `AINTKNOWMAP.md`, `LEXI.md`, or `TES_LAYN_ROADMAP.md`.
- Generated command, inventory, lane, and governance reports are either unchanged or intentionally refreshed by the correct tool.
- `docs/roadmap.md` remains the status and execution-order source.
- Archived docs remain historical and do not become normative release blockers unless the active roadmap or focused specs explicitly reference them.

Blockers:

- A generated artifact is stale and cannot be regenerated cleanly.
- A roadmap/status link points at a removed or historical-only root roadmap.
- A contract/schema doc contradicts `src/contracts/**` or a validator.

## Lane 2: USR Gates

Purpose: prove the consolidated USR program can advance only when gate evidence, schemas, and matrix policy are current.

Spec anchors:

- `docs/specs/usr/README.md`
- `docs/specs/usr-consolidation-coverage-matrix.md`
- `docs/archived/usr-rollout-approval-lock.md`
- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
- `docs/specs/usr-core-observability-performance-ops.md`
- `docs/specs/usr-core-security-risk-compliance.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`

Primary commands:

```powershell
node tests/run.js contracts/usr-matrix --lane=all --timeout-ms 30000
node tests/run.js ci/usr-guardrail-registry-coverage --lane=all --timeout-ms 30000
node tests/run.js conformance/language-shards --lane=all --timeout-ms 30000
node tests/run.js tooling/reports/show-throughput-ignore-usr --lane=all --timeout-ms 30000
node tests/run.js tooling/reports/diagnostics-report-risk --lane=all --timeout-ms 30000
```

Targeted runner selectors for exact files:

```powershell
node tests/run.js contracts/usr-matrix-modularization contracts/usr-matrix-helper-modules ci/usr-guardrail-registry-coverage --lane=all --timeout-ms 30000
```

Acceptance evidence:

- Gate order remains strict: Gate A, Gate B1-B7, Gate B8, then Gate C.
- Gate C readiness is based on current technical validation evidence and the standard release readiness gate.
- Required release artifacts are named and schema-backed, including `usr-backcompat-matrix-results.json`, `usr-benchmark-regression-summary.json`, `usr-benchmark-summary.json`, `usr-change-management-log.json`, `usr-conformance-summary.json`, `usr-contract-drift-report.json`, `usr-contract-ownership-report.json`, `usr-drift-report.json`, `usr-evidence-freshness-report.json`, `usr-failure-injection-report.json`, `usr-feature-flag-policy-evaluation.json`, `usr-feature-flag-state.json`, `usr-gate-evaluation-summary.json`, `usr-governance-readiness-summary.json`, `usr-incident-response-drill-report.json`, `usr-lane-policy-evaluation.json`, `usr-no-cut-decision-log.json`, `usr-observability-rollup.json`, `usr-operational-readiness-validation.json`, `usr-post-cutover-stabilization-report.json`, `usr-quality-evaluation-results.json`, `usr-quality-regression-report.json`, `usr-registry-cross-invariant-validation.json`, `usr-registry-schema-validation.json`, `usr-release-readiness-scorecard.json`, `usr-release-train-readiness.json`, `usr-rfc-change-impact-summary.json`, `usr-rollback-drill-report.json`, `usr-threat-model-coverage-report.json`, `usr-validation-report.json`, `usr-waiver-active-report.json`, and `usr-waiver-expiry-report.json`.
- Compatibility policy remains strict for blocking classes; compatibility removals before cutover require approval and rollback evidence.
- Waivers have owners, scope, expiry, and an explicit non-blocking classification.

Blockers:

- Any missing or stale required technical release artifact.
- Any blocking USR quality, security, SLO, or compatibility failure without an approved waiver.
- A release-readiness scorecard that cannot be tied back to current matrices, schemas, and gate state.

## Lane 3: Stage1 Contract

Purpose: prove Stage1 is a hard cutover to contiguous windows and commit-cursor ordering, with deterministic retry/cancellation behavior and bounded memory.

Spec anchors:

- `docs/specs/stage1-hard-cutover-plan.md`
- `docs/specs/stage1-window-planner.md`
- `docs/specs/stage1-order-contiguous-runtime.md`
- `docs/specs/stage1-seq-ledger-state-machine.md`
- `docs/specs/stage1-commit-journal-replay.md`
- `docs/specs/stage1-backpressure-controller.md`
- `docs/specs/stage1-retry-and-terminal-outcome-taxonomy.md`
- `docs/specs/stage1-cancellation-and-shutdown.md`
- `docs/specs/stage1-observability.md`

Primary commands:

```powershell
node tests/run.js indexing/stage1 --lane=all --timeout-ms 30000
node tests/run.js indexing/runtime/stage1 --lane=all --timeout-ms 30000
node tests/run.js shared/indexing/stage1-watchdog-policy --lane=all --timeout-ms 30000
node tests/run.js shared/concurrency/scheduler-stage1 --lane=all --timeout-ms 30000
node tests/run.js perf/bench/stage1-windowed-throughput --lane=all --timeout-ms 30000
node tests/run.js perf/indexing/postings/stage1-memory-budget --lane=all --timeout-ms 30000
```

Acceptance evidence:

- Window planner emits deterministic contiguous ranges with no holes.
- At most two active windows exist; dispatch outside active windows is rejected.
- Commit cursor advances monotonically by contiguous `seq` and never skips a missing terminal state.
- Legacy gap-recovery semantics are absent; missing sequence gaps fail by invariant rather than recovery shim.
- Retry, terminalization, cancellation, lease reclaim, and journal replay are deterministic and auditable.
- Required telemetry exists for dispatch, commit, retry, stall, backpressure, buffered bytes, active windows, and checkpoint snapshots.
- Memory and throughput tests stay within the current perf budget or are explicitly blocked for regression triage.

Blockers:

- Any path that allows shard-first ordered drain or non-contiguous commit.
- Deadlock, stalled drain, duplicate terminal after commit, or cursor skip.
- A perf or memory regression without a measured root cause and an approved release waiver.

## Lane 4: Risk Artifacts

Purpose: prove Phase 10 risk artifacts are deterministic, bounded, schema-valid, explainable, and fail closed when incompatible.

Spec anchors:

- `docs/specs/risk-interprocedural-config.md`
- `docs/specs/risk-summaries.md`
- `docs/specs/risk-flows-and-call-sites.md`
- `docs/specs/risk-callsite-id-and-stats.md`
- `docs/specs/risk-interprocedural-stats.md`
- `docs/contracts/context-pack-risk-contract.md`
- `docs/guides/risk-rules.md`

Primary commands:

```powershell
node tests/run.js indexing/risk/interprocedural --lane=all --timeout-ms 30000
node tests/run.js indexing/validate/validator/risk-interprocedural --lane=all --timeout-ms 30000
node tests/run.js indexing/risk/risk-contract-matrix --lane=all --timeout-ms 30000
node tests/run.js context-pack/risk --lane=all --timeout-ms 30000
node tests/run.js services/risk-explain-adapter-matrix --lane=all --timeout-ms 30000
node tests/run.js analysis/risk --lane=all --timeout-ms 30000
node tests/run.js tooling/eval/risk-pack-quality --lane=all --timeout-ms 30000
```

Acceptance evidence:

- `indexing.riskInterprocedural` config normalizes deterministically and invalidates incremental signatures when effective behavior changes.
- Enabling interprocedural risk does not implicitly enable type inference, but does ensure resolved call edges needed for cross-file linking.
- `risk_summaries`, `call_sites`, `risk_flows`, `risk_partial_flows`, and `risk_interprocedural_stats` validate against their schemas and required key sets.
- JSONL rows stay under the 32KB hard cap or are deterministically truncated/dropped with stats accounting.
- `callSiteId` and `flowId` are stable SHA-1 identities from the required canonical inputs.
- Timeouts emit zero `risk_flows`, preserve deterministic status, and do not leak speed-dependent partial prefixes.
- Context-pack risk payloads fail closed on incompatible `risk.version`, `risk.contractVersion`, or unsupported artifact surface versions.
- Risk rules preserve provenance, caps, and status values such as `capped`, `disabled`, `timed_out`, and `error`.

Blockers:

- Any incompatible risk payload accepted by a reader or validator.
- Missing stats when flows are suppressed, capped, timed out, or disabled.
- Any referenced `callSiteId` absent from emitted `call_sites` when `risk_flows` require referential integrity.
- Nondeterministic flow ordering, stats counts, or identity hashes across identical inputs.

## Lane 5: Snapshot, Diff, And As-Of Retrieval

Purpose: prove Phase 14 time-travel foundations are deterministic, privacy-preserving, retention-safe, and cache-safe.

Spec anchors:

- `docs/specs/index-refs-and-snapshots.md`
- `docs/specs/index-diffs.md`
- `docs/specs/as-of-retrieval-integration.md`
- `docs/contracts/indexing.md`
- `docs/contracts/search-contract.md`

Primary commands:

```powershell
node tests/run.js indexing/contracts/snapshots --lane=all --timeout-ms 30000
node tests/run.js indexing/contracts/diffs --lane=all --timeout-ms 30000
node tests/run.js shared/snapshots-registry --lane=all --timeout-ms 30000
node tests/run.js shared/diffs-registry --lane=all --timeout-ms 30000
node tests/run.js services/snapshot --lane=all --timeout-ms 30000
node tests/run.js services/api-search-asof --lane=all --timeout-ms 30000
node tests/run.js tooling/index-stats/index-diff --lane=all --timeout-ms 30000
node tests/run.js unit/retrieval-cache-key-asof unit/retrieval-index-signature-shards unit/retrieval-index-signature-token-binary-columnar --lane=all --timeout-ms 30000
```

Acceptance evidence:

- `IndexRef` parsing rejects invalid snapshot IDs, tags, build IDs, and unsafe path forms with clear errors.
- `ResolvedIndexRef.identity` and diff `inputs.json` do not store absolute paths.
- `latest` resolution respects `current.json.buildRoots` per mode.
- Snapshot create requires validated build roots, writes atomically, and records repo-cache-relative paths.
- Frozen snapshots are treated as immutable; retrieval never repairs them in place.
- Snapshot prune respects protected tags and removes stale staging directories.
- Diff IDs are stable hashes of canonical inputs; collision handling validates existing inputs before reuse.
- Persistent diffs redact unsafe path refs unless explicitly allowed by the unsafe persistence policy.
- As-of search changes cache keys by resolved identity and reports `asOf` metadata in JSON output.
- SQLite/LMDB backend selection fails clearly when as-of mode roots are incompatible.

Blockers:

- Any absolute path leak in registry, identity, persisted diff input, or public JSON output.
- Any cache collision between two different `--as-of` values.
- Snapshot registry mutation without the index lock or atomic write path.
- Diff output with nondeterministic event ordering for identical inputs.

## Lane 6: Lexicon And Retrieval

Purpose: prove lexicon wordlists, relation filtering, retrieval boosts, ANN candidate policy, and ranking/explain contracts remain bounded and deterministic.

Spec anchors:

- `docs/specs/language-lexicon-wordlists.md`
- `docs/specs/lexicon-relations-filtering.md`
- `docs/specs/lexicon-retrieval-boosts.md`
- `docs/contracts/retrieval-ranking.md`
- `docs/contracts/search-contract.md`
- `docs/perf/retrieval-pipeline.md`
- `docs/dependency_references/continue-retrieval-accuracy.md`

Primary commands:

```powershell
node tests/run.js lexicon --lane=all --timeout-ms 30000
node tests/run.js file-processor/lexicon-relations-filter --lane=all --timeout-ms 30000
node tests/run.js indexing/logging/lexicon-filter-counts --lane=all --timeout-ms 30000
node tests/run.js indexer/incremental/signature-lexicon-config --lane=all --timeout-ms 30000
node tests/run.js retrieval/relation-boost --lane=all --timeout-ms 30000
node tests/run.js retrieval/uses-and-calls-filters-respect-lexicon --lane=all --timeout-ms 30000
node tests/run.js retrieval/ann-candidate-policy --lane=all --timeout-ms 30000
node tests/run.js retrieval/ranking --lane=all --timeout-ms 30000
node tests/run.js retrieval/contracts/score-breakdown --lane=all --timeout-ms 30000
node tests/run.js retrieval/pipeline --lane=all --timeout-ms 30000
node tests/run.js retrieval/query/golden-corpus --lane=all --timeout-ms 30000
node tests/run.js retrieval/eval/iq-regression-smoke --lane=all --timeout-ms 30000
```

Acceptance evidence:

- Wordlists validate against `src/lang/lexicon/language-lexicon-wordlist.schema.json`.
- v1 wordlist tokens remain ASCII-only and normalized deterministically.
- Relation filtering removes only configured noisy relation fields; imports and exports are not filtered in v1.
- Filtering logs per-file counters with stable report schema versioning.
- Relation boosts are boost-only and never filter hits or change membership by themselves.
- Boost scoring respects `perCall`, `perUse`, and `maxBoost`, and explain payload version remains `1` unless an incompatible shape change is intentional.
- ANN fallback policy activates only when vectors and query embeddings are available and honors allowed-candidate constraints.
- Graph-aware ranking preserves membership and only reorders within the baseline set.
- Context expansion is opt-in, capped, deterministic, and does not build unbounded candidate arrays.
- Score breakdowns remain JSON-safe, bounded, and deterministic under identical inputs.

Blockers:

- Relation boost or graph ranking changes result membership contrary to contract.
- ANN candidate policy returns disallowed candidates or fails open when vector-only search requires ANN.
- Explain payloads exceed configured budgets or lose required selected score components.
- Any golden retrieval regression without an accepted quality decision and an updated evidence note.

## Lane 7: Production Readiness

Purpose: prove release-facing commands, docs, scripts, API/service surfaces, and dry-run release gates are green.

Primary command:

```powershell
npm run verify:production
```

Equivalent expanded commands:

```powershell
node tools/testing/refresh-governance.js
node tests/run.js ci/markdown-link-check tooling/docs/contract-matrix tooling/script-coverage/harness --lane=all --timeout-ms 30000
node tools/release/check.js --dry-run
```

Targeted release tests:

```powershell
node tests/run.js tooling/release/readiness-gate ci/workflow-contract --lane=all --timeout-ms 30000
node tests/run.js tooling/release-check --lane=all --timeout-ms 30000
node tests/run.js tooling/release --lane=all --timeout-ms 30000
node tests/run.js tooling/script-coverage/harness --lane=all --timeout-ms 30000
node tests/run.js ops/release-gates --lane=all --timeout-ms 30000
node tests/run.js ops/health-check-contract --lane=all --timeout-ms 30000
```

Manual operator spot checks:

```powershell
pairofcleats config validate --json
pairofcleats service indexer status --queue index --json
pairofcleats service indexer status --queue embeddings --json
pairofcleats service indexer shutdown --queue index --shutdown-mode drain --json
pairofcleats service indexer resume --queue index --json
pairofcleats service indexer inspect --queue index --json
pairofcleats service api --json
pairofcleats index build
pairofcleats search '<query>'
node tools/release/check.js --dry-run
```

Acceptance evidence:

- CLI help, version, JSON, and release surfaces are machine-safe and stable.
- Config validation fails early with field paths and actionable hints.
- Queue identity, shutdown, admission, inspection, and repair paths are deterministic.
- API `/health` and `/status` match documented startup/auth expectations.
- Build/index artifact promotion remains fail-closed for missing required artifacts.
- Release dry run emits the expected report and exit code for pass/fail cases.

Blockers:

- `npm run verify:production` fails without a documented, scoped, non-release-impacting reason.
- Release dry run cannot produce a report or validates the wrong surface.
- Service/API commands require manual cleanup after failure.
- Config, auth, repo-root, or artifact-promotion failures are treated as transient instead of policy/config blockers.

## Lane 8: Performance And Quality Final Gate

Purpose: prove release-sensitive changes are not merely correct, but maintain deterministic behavior, bounded memory, stable ranking quality, and understandable diagnostics.

Primary commands:

```powershell
node tests/run.js --lane perf --timeout-ms 30000
node tests/run.js perf/bench/stage1-windowed-throughput --lane=all --timeout-ms 30000
node tests/run.js perf/indexing/postings/stage1-memory-budget --lane=all --timeout-ms 30000
node tests/run.js perf/context-pack-risk-benchmark --lane=all --timeout-ms 30000
node tests/run.js perf/graph-context-pack-latency-bench-contract --lane=all --timeout-ms 30000
node tests/run.js retrieval/query/golden-corpus --lane=all --timeout-ms 30000
node tests/run.js retrieval/eval/iq-regression-smoke --lane=all --timeout-ms 30000
node tests/run.js tooling/eval/risk-pack-quality --lane=all --timeout-ms 30000
```

Optional advisory benchmark, allowed to exceed 30 seconds if explicitly recorded as non-test evidence. The JSON path below is an example output target, not part of the current evidence bundle unless the benchmark is intentionally generated and cited:

```powershell
node tools/bench/bench-runner.js --suite sweet16-ci --json <artifact-dir>/bench-sweet16.json --quiet
```

Acceptance evidence:

- Stage1 throughput and memory stay within budget and retain deterministic ordering.
- Retrieval top-K uses deterministic tie-breakers and bounded `k + slack` reduction.
- Candidate buffers and score buffers do not introduce unbounded allocation growth.
- Graph/context-pack traversal uses deterministic cache keys and bounded depth/width/node caps.
- Risk context-pack benchmarks do not regress beyond the blocking threshold.
- Quality/eval tests identify whether failures are correctness, ranking, fixture, or budget issues.
- Any benchmark baseline update includes the old baseline, new measurement, variance notes, and approval.

Blockers:

- A sustained blocking-tier SLO breach.
- A benchmark regression beyond the blocking threshold.
- Unbounded candidate, traversal, or artifact arrays on a production path.
- A quality regression without a clear acceptance decision.

## Blocker Handling

Classify every failure before changing roadmap status:

| Class | Meaning | Release decision |
| --- | --- | --- |
| `blocking-failure` | Contract, correctness, security, privacy, data loss, release dry-run, or production readiness failure. | Stop release claim until fixed or explicitly no-cut. |
| `blocking-timeout` | A required test exceeds 30 seconds and has no narrower passing evidence. | Record the runner timeout as blocking, investigate test/runtime split, do not claim full lane pass. |
| `advisory-timeout` | Optional benchmark/report exceeds 30 seconds but required tests passed. | Continue only if release evidence labels it advisory. |
| `stale-evidence` | Generated docs, matrix, guardrail, or timing artifact is outdated. | Regenerate through tools or block status advancement. |
| `waived-nonblocking` | Known issue with owner, expiry, scope, and accepted risk. | Continue only if waiver policy permits. |
| `environmental` | Missing optional dependency, unavailable service, or local machine issue. | Rerun on a qualified environment before release claim. |

Failure triage must include:

- exact failing command and exit code;
- first failing assertion or controlled error code;
- whether the failure is reproducible with the narrowest matching command;
- owning spec or contract;
- required fix area;
- whether the roadmap status must remain `in progress` or `blocked/unverifiable`.

## Quality Gates By Initiative

Stage1 ordered throughput:

- No fallback path to legacy ordered drain.
- No commit-cursor skip, duplicate terminal, or drain deadlock.
- Checkpoint, retry, cancellation, and terminal summaries are deterministic.
- Required telemetry counters, gauges, histograms, and snapshot events exist.

Phase 10 risk:

- Risk artifact readers fail closed for incompatible contract versions.
- Artifact rows are bounded and deterministically ordered.
- Time guard behavior produces deterministic no-partial-flow output.
- Context-pack risk payloads remain public-contract compatible.

Phase 14 snapshot/diff/as-of:

- Index identity hashes exclude absolute paths.
- Snapshot and diff registries use locks and atomic writes.
- Frozen snapshots are immutable retrieval inputs.
- Query cache keys discriminate by resolved as-of identity.

Lexicon and retrieval:

- Lexicon v1 remains ASCII-only and schema-valid.
- Relation filtering is conservative and logged.
- Relation boosts are boost-only.
- Graph ranking preserves membership.
- ANN candidate policy honors allowed IDs and vector-only requirements.

USR rollout:

- Gate state cannot advance with missing approvals.
- Release evidence bundles map to required schemas.
- Waivers expire and cannot hide critical blocking failures.
- Rollback drills and no-cut decisions are explicit.

Production readiness:

- `npm run verify:production` is green before release-oriented PRs.
- CLI/service/API/config failures are controlled and actionable.
- Release dry-run and release report schemas validate.

## Performance Gates

Performance evidence must be tied to the affected production path:

- Stage1: active-window throughput, commit microbatching, queue byte accounting, memory budget, watchdog thresholds.
- Risk: summary/flow propagation caps, max row bytes, max flow counts, timeout semantics, context-pack assembly budget.
- Snapshot/diff/as-of: registry lock overhead, freeze/copy cost, diff candidate selection, cache-key computation.
- Retrieval: top-K reducer threshold, slack cap, ANN lazy import, candidate-pool reuse, graph/context traversal caps, explain output budgets.
- USR: SLO budgets, benchmark reproducibility, baseline revision policy, capacity envelope, alerting/escalation policy.

Blocking performance criteria:

- Any required perf test exceeds 30 seconds in the release pass and lacks narrower passing coverage.
- Any sustained SLO breach in a blocking tier.
- Any measured regression beyond the configured blocking threshold.
- Any implementation change that removes a deterministic cap or introduces unbounded arrays on a query/build path.

Advisory performance criteria:

- Minor benchmark variance within the advisory range.
- Optional bench-runner changes that do not affect release gates.
- Environment-specific noise with enough repeated measurements to show no production-path regression.

## Release Decision Checklist

Before a release-oriented PR or roadmap status advancement:

- `docs-and-governance` passed or has only documented non-blocking advisories.
- USR technical readiness is not claimed unless current schema, matrix, conformance, and release-readiness evidence pass.
- Stage1 targeted contract and perf/memory tests passed under 30 seconds or timeouts are explicitly marked as blockers.
- Risk artifact and context-pack tests passed with fail-closed compatibility evidence.
- Snapshot/diff/as-of tests passed with no path privacy or cache collision failures.
- Lexicon/retrieval tests passed with no membership, ANN policy, or explain-budget regressions.
- `npm run verify:production` passed for release work.
- Skips and waivers are listed with owner, expiry, impact, and follow-up.
- `docs/roadmap.md` status updates, if any, are backed by the evidence bundle.

## Reporting Template

Use this template in PR notes, release notes, or a durable evidence file:

```markdown
## Roadmap Release Validation Evidence

- Branch:
- Commit:
- Worktree state:
- Date:
- Captured at:
- Node:
- npm:
- OS:
- Native optional deps:

| Lane | Command | Result | Exit | Elapsed | Evidence | Checked artifacts | Blocker? | Blocker owner/severity/action | Waiver |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docs-and-governance |  |  |  |  |  |  |  |  |  |
| usr-gates |  |  |  |  |  |  |  |  |  |
| stage1-contract |  |  |  |  |  |  |  |  |  |
| risk-artifacts |  |  |  |  |  |  |  |  |  |
| snapshot-diff-asof |  |  |  |  |  |  |  |  |  |
| lexicon-retrieval |  |  |  |  |  |  |  |  |  |
| production-readiness |  |  |  |  |  |  |  |  |  |
| perf-quality-final |  |  |  |  |  |  |  |  |  |

## Skips

| Command | Classification | Reason | Follow-up |
| --- | --- | --- | --- |

## Blockers

| ID | Severity | Contract/spec | Owner | Required action |
| --- | --- | --- | --- | --- |

## Waivers

| Waiver | Scope | Expiry | Approver | Residual risk |
| --- | --- | --- | --- | --- |
```

