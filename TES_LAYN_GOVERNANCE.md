# TES_LAYN_GOVERNANCE - USR Gates, Locks, Evidence, and Change Control

Last updated: 2026-02-13T09:58:25Z
Status: active
Parent roadmap: `TES_LAYN_ROADMAP.md`
Execution details: `TES_LAYN_EXECUTION_PACKS.md`

## 0) Purpose

This document defines the governance rules that control rollout decisions:
- gate ordering and prerequisites
- approval-lock policy
- evidence requirements by phase
- CI/change-control touchpoints

## 1) Authoritative Governance Touchpoints

- Execution state: `TES_LAYN_ROADMAP.md`
- Batch and framework completion state: `TES_LAYN_EXECUTION_PACKS.md`
- Traceability approval record: `docs/specs/usr-consolidation-coverage-matrix.md`
- Rollout authorization lock: `docs/specs/usr-rollout-approval-lock.md`
- Core rollout contract: `docs/specs/usr-core-rollout-release-migration.md`
- Matrix registries: `tests/lang/matrix/usr-*.json`
- Contract validators: `tests/unified-syntax-representation/lang/contracts/*.test.js`

## 2) Gate Order and Invariants

Gate order is strict and cannot be skipped:
1. Gate A (`B0` contracts/registries)
2. Gate B1-B7 (language batch gates)
3. Gate B8 (cross-batch integration)
4. Gate C (test rollout authorization)

Gate prerequisites:

| Gate | Must be true before promotion | Primary evidence | Primary lock test |
| --- | --- | --- | --- |
| Gate A | contract and registry validators are green | `usr-validation-report.json`, `usr-drift-report.json` | `tests/unified-syntax-representation/lang/contracts/contract-enforcement.test.js` |
| Gate B1-B7 | all in-scope batch packs are complete | `usr-conformance-summary.json` | `tests/unified-syntax-representation/lang/contracts/language-batch-shards-validation.test.js` |
| Gate B8 | cross-batch integration checks are green | `usr-conformance-summary.json`, `usr-quality-evaluation-results.json` | `tests/unified-syntax-representation/lang/contracts/mixed-repo-integration-validation.test.js` |
| Gate C | all prior gates pass and rollout lock is approved | `usr-operational-readiness-validation.json`, `usr-release-readiness-scorecard.json` | `tests/unified-syntax-representation/lang/contracts/gate-prerequisite-lock-validation.test.js` |

## 3) Approval Locks

### 3.1 Traceability anchors and approval lock (USR sections 5-36)

Traceability coverage is considered approved only when:
1. `docs/specs/usr-consolidation-coverage-matrix.md` approval state remains valid.
2. Section coverage for USR sections 5-36 remains anchored to active phases/packs.
3. Any regression reopens Phase A completion and downstream rollout authorization.

Section-group anchors:

| USR section group | Delivery anchor |
| --- | --- |
| 5-12 | `TES_LAYN_ROADMAP.md` Phase B |
| 13-22 | `TES_LAYN_ROADMAP.md` Phase C and Phase D |
| 23-29 | `TES_LAYN_ROADMAP.md` Phase A and Phase G |
| 30-36 | `TES_LAYN_ROADMAP.md` Phase E through Phase H |

### 3.2 Rollout approval lock

Rollout approval is governed by `docs/specs/usr-rollout-approval-lock.md`.

Promotion to approved state requires:
1. `Readiness report approved.` is checked in `TES_LAYN_ROADMAP.md`.
2. Gate C `all prior gates pass.` is checked in `TES_LAYN_ROADMAP.md`.
3. All required approver roles are `approved` with ISO 8601 timestamps.

If approval metadata regresses, `Test rollout authorized.` and `conformance rollout authorized.` must be reopened.

## 4) Phase-to-Evidence Requirements

| Roadmap phase | Minimum evidence artifacts | Minimum checks |
| --- | --- | --- |
| Phase A | `usr-validation-report.json`, `usr-drift-report.json` | `tests/unified-syntax-representation/shared/contracts/schema-validators.test.js`, `tests/unified-syntax-representation/shared/contracts/matrix-validators.test.js` |
| Phase B | `usr-validation-report.json` | `tests/unified-syntax-representation/lang/contracts/parser-runtime-lock-reproducibility-validation.test.js`, `tests/unified-syntax-representation/lang/contracts/contract-enforcement.test.js` |
| Phase C | `usr-conformance-summary.json` | `tests/unified-syntax-representation/lang/contracts/language-batch-shards-validation.test.js` and all active shard tests under `tests/conformance/language-shards/` |
| Phase D | `usr-conformance-summary.json`, `usr-quality-evaluation-results.json` | `tests/unified-syntax-representation/lang/contracts/framework-canonicalization-baseline-validation.test.js`, `tests/conformance/framework-canonicalization/framework-canonicalization-validation.test.js` |
| Phase E | `usr-quality-evaluation-results.json` | `tests/unified-syntax-representation/lang/contracts/risk-fixture-governance-baseline-validation.test.js`, `tests/unified-syntax-representation/lang/contracts/embedding-provenance-baseline-validation.test.js` |
| Phase F | `usr-operational-readiness-validation.json`, `usr-release-readiness-scorecard.json`, `usr-observability-rollup.json` | `tests/unified-syntax-representation/lang/contracts/implementation-readiness-validation.test.js`, `tests/unified-syntax-representation/lang/contracts/hardening-readiness-validation.test.js`, `tests/unified-syntax-representation/lang/contracts/observability-rollup-validation.test.js` |
| Phase G | `usr-conformance-summary.json`, `usr-quality-evaluation-results.json` | foundation, semantic, framework, and integration conformance suites all green for target scope |
| Phase H | `usr-release-readiness-scorecard.json`, `usr-waiver-active-report.json`, `usr-waiver-expiry-report.json` | ongoing governance/waiver/security/report envelope validators remain green |

## 5) CI and Test Touchpoints

Required lane policy:
- `ci-lite`: fast blocking contract checks for drift and schema integrity.
- `ci`: standard contract/conformance coverage for active rollout scope.
- `ci-long`: long-running conformance/integration validation.
- `gate`: lock and gate-order enforcement, readiness, and authorization checks.

Required test families:
- `tests/unified-syntax-representation/shared/contracts/*.test.js`
- `tests/unified-syntax-representation/lang/contracts/*.test.js`
- `tests/conformance/language-shards/*.test.js`
- `tests/conformance/framework-canonicalization/*.test.js`
- `tests/conformance/implementation-readiness/*.test.js`

## 6) Change-Control Synchronization Rules

For any normative USR change, update these together in the same PR:
1. core spec/contracts (`docs/specs/unified-syntax-representation.md` and impacted `docs/specs/usr-core-*.md`)
2. matrix rows (`tests/lang/matrix/usr-*.json`)
3. roadmap status (`TES_LAYN_ROADMAP.md`)
4. execution detail (`TES_LAYN_EXECUTION_PACKS.md`) when batch/framework scope changes
5. governance rules (`TES_LAYN_GOVERNANCE.md`) when gate/lock/evidence policy changes
6. impacted validators/tests

## 7) Reopen Rules

Reopen the impacted phase and gate state when:
1. required evidence becomes stale or invalid
2. required gate prerequisites regress
3. lock approval metadata is missing or downgraded
4. required validators are removed or failing in mandatory lanes

Keep this doc concise and operational; deep implementation work remains in `TES_LAYN_EXECUTION_PACKS.md`.
