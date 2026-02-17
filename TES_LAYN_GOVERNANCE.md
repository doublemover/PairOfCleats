# TES_LAYN_GOVERNANCE - Functional Gates, Evidence, and Change Control

Last updated: 2026-02-17T00:00:00Z
Status: active
Parent roadmap: `TES_LAYN_ROADMAP.md`
Execution details: `TES_LAYN_EXECUTION_PACKS.md`

## 0) Purpose

This document defines lightweight governance for functional USR rollout:
- gate order and prerequisites
- approval-lock policy
- evidence requirements by phase
- CI/change-control touchpoints

## 1) Authoritative Governance Touchpoints

- execution state: `TES_LAYN_ROADMAP.md`
- batch/framework completion state: `TES_LAYN_EXECUTION_PACKS.md`
- traceability coverage source: `docs/specs/usr-consolidation-coverage-matrix.md`
- rollout approval lock: `docs/specs/usr-rollout-approval-lock.md`
- core rollout guidance: `docs/specs/usr-core-rollout-release-migration.md`
- language/framework matrices: `tests/lang/matrix/usr-*.json`

## 2) Gate Order and Invariants

Gate order is strict and cannot be skipped:
1. Gate A (foundation runtime readiness)
2. Gate B1-B7 (language batch readiness)
3. Gate B8 (cross-language integration readiness)
4. Gate C (rollout authorization)

Gate prerequisites:

| Gate | Must be true before promotion | Primary evidence | Primary review lock |
| --- | --- | --- | --- |
| Gate A | foundation runtime behavior is deterministic and actionable | `usr-functional-readiness-summary.json`, `usr-determinism-summary.json` | roadmap Gate A checklist complete |
| Gate B1-B7 | all in-scope language packs are complete | `usr-language-support-matrix.json` | execution-pack batch checklist complete |
| Gate B8 | cross-language integration behavior is stable | `usr-functional-readiness-summary.json`, `usr-determinism-summary.json` | integration checklist complete |
| Gate C | all prior gates pass and readiness is approved | `usr-release-readiness-scorecard.json` | rollout approval lock updated |

## 3) Approval Locks

### 3.1 Traceability lock

Traceability is considered approved only when:
1. `docs/specs/usr-consolidation-coverage-matrix.md` approval state remains valid.
2. USR section coverage remains mapped to active roadmap phases/packs.
3. regressions reopen impacted roadmap phase completion.

### 3.2 Rollout approval lock

Rollout approval is governed by `docs/specs/usr-rollout-approval-lock.md`.

Promotion to approved state requires:
1. `Readiness report approved.` is checked in `TES_LAYN_ROADMAP.md`.
2. Gate C `all prior gates pass.` is checked in `TES_LAYN_ROADMAP.md`.
3. required approver roles are `approved` with ISO 8601 timestamps.

If approval metadata regresses, rollout authorization must be reopened.

## 4) Phase-to-Evidence Requirements

| Roadmap phase | Minimum evidence artifacts | Minimum functional confirmation |
| --- | --- | --- |
| Phase A | `usr-functional-readiness-summary.json`, `usr-determinism-summary.json` | foundation adapter/runtime outputs stable and deterministic |
| Phase B | `usr-determinism-summary.json` | identity and normalization outputs stable across reruns |
| Phase C | `usr-language-support-matrix.json` | each active language pack meets required capability targets |
| Phase D | `usr-framework-support-matrix.json` | each required framework profile is functionally complete |
| Phase E | `usr-functional-readiness-summary.json` | semantics/risk outputs are correct and deterministic |
| Phase F | `usr-release-readiness-scorecard.json` | caps/perf/observability readiness approved |
| Phase G | `usr-release-readiness-scorecard.json` | rollout and maintenance loops active for target scope |

## 5) CI and Execution Touchpoints

Required lane policy:
- `ci-lite`: fast adapter/runtime smoke and determinism checks.
- `ci`: standard language/framework functional coverage for active scope.
- `ci-long`: cross-language integration and heavier caps/perf scenarios.
- `gate`: rollout blockers, readiness, and authorization checks.

Execution focus:
- prioritize runtime behavior checks over document/schema enforcement checks
- keep suite composition aligned to delivery-critical functionality
- keep long-running verification out of critical merge paths where possible

## 6) Change-Control Synchronization Rules

For any normative USR change, update these together in the same PR:
1. core spec (`docs/specs/unified-syntax-representation.md` and impacted `docs/specs/usr-core-*.md`)
2. matrix rows (`tests/lang/matrix/usr-*.json`)
3. roadmap status (`TES_LAYN_ROADMAP.md`)
4. execution detail (`TES_LAYN_EXECUTION_PACKS.md`) when scope changes
5. governance policy (`TES_LAYN_GOVERNANCE.md`) when gates/evidence change
6. impacted runtime/fixture behavior and diagnostics

## 7) Reopen Rules

Reopen the impacted phase and gate state when:
1. required evidence becomes stale or invalid
2. required gate prerequisites regress
3. approval metadata is missing or downgraded
4. blocking functional regressions appear in required rollout scope

Keep this doc concise and operational; deep delivery detail remains in `TES_LAYN_EXECUTION_PACKS.md`.
