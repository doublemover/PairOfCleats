# Spec -- USR Core Rollout, Release, and Migration Contract

Status: Draft v2.1
Last updated: 2026-02-13T09:58:25Z

## Purpose

Define staged rollout, compatibility policy, release-readiness gates, and rollback requirements for USR.

## Consolidated source coverage

This contract absorbs:

- `usr-rollout-and-migration-contract.md` (legacy)
- `usr-release-train-contract.md` (legacy)
- `usr-operational-runbook-contract.md` (legacy)
- `usr-cutover-runbook.md` (legacy)
- `usr-rollback-runbook.md` (legacy)
- `usr-release-checklist.md` (legacy)
- `usr-incident-severity-matrix.md` (legacy)

## Rollout lifecycle

1. `shadow-read`
2. `dual-write`
3. `strict-gate pre-cutover`
4. `cutover`
5. `post-cutover stabilization`

Each lifecycle phase must define explicit entry and exit criteria plus required evidence artifacts.

| Lifecycle phase | Required entry | Required exit |
| --- | --- | --- |
| `shadow-read` | baseline contract/matrix artifacts are available | parity deltas measured and within advisory bounds |
| `dual-write` | `shadow-read` exit is complete | writer/read parity is green for blocking scenarios |
| `strict-gate pre-cutover` | strict compatibility and conformance checks are green | readiness evidence and approvals are complete |
| `cutover` | no-cut checks are clear and required locks are approved | production validation window is complete |
| `post-cutover stabilization` | cutover is complete | churn/regression indicators remain inside thresholds |

## Roadmap mapping

Execution ordering and gate state are authoritative in `TES_LAYN_ROADMAP.md` and `TES_LAYN_GOVERNANCE.md`.

| Roadmap phase | Lifecycle alignment | Minimum evidence bundle |
| --- | --- | --- |
| Phase A | `shadow-read` foundation | `usr-validation-report.json`, `usr-drift-report.json` |
| Phase B | `shadow-read` hardening | `usr-validation-report.json` |
| Phase C | `dual-write` language-batch rollout | `usr-conformance-summary.json` |
| Phase D | `dual-write` framework overlay rollout | `usr-conformance-summary.json`, `usr-quality-evaluation-results.json` |
| Phase E | `strict-gate pre-cutover` semantics/risk hardening | `usr-quality-evaluation-results.json` |
| Phase F | `strict-gate pre-cutover` readiness authorization | `usr-operational-readiness-validation.json`, `usr-release-readiness-scorecard.json`, `usr-observability-rollup.json` |
| Phase G | `cutover` conformance enforcement | `usr-conformance-summary.json`, `usr-release-readiness-scorecard.json` |
| Phase H | `post-cutover stabilization` | `usr-release-readiness-scorecard.json`, waiver/maintenance reports |

## Gate and lock dependencies

Rollout promotion must satisfy all of the following:

1. Gate order remains strict: Gate A -> Gate B1-B7 -> Gate B8 -> Gate C.
2. No rollout authorization while prior gates have unresolved blocking items.
3. `docs/specs/usr-rollout-approval-lock.md` is `approved` before Gate C rollout authorization.
4. Traceability approval remains valid in `docs/specs/usr-consolidation-coverage-matrix.md`.

Detailed lock mechanics and reopen rules are defined in `TES_LAYN_GOVERNANCE.md`.

## Compatibility policy

Compatibility enforcement must use:

- `tests/lang/matrix/usr-backcompat-matrix.json`
- scenario classes `BC-001` through `BC-012`
- strict and non-strict reader profiles

Strict-scenario failures in blocking classes are release-blocking.

Legacy-output retention policy:

- compatibility outputs remain required until readiness authorization is approved
- any proposal to remove compatibility outputs before cutover requires Tier 3 approval and rollback evidence
- removal decisions must include a concrete migration path and no-cut trigger review

## No-cut triggers

Cutover is blocked when any of the following is true:

1. strict blocking compatibility scenarios fail
2. required readiness or security evidence is stale or missing
3. rollback drill evidence is missing or failing
4. critical waivers are expired or unapproved

## Release-train controls

Release train rows must define:

- freeze windows
- required gate bundles
- owner approvals
- no-cut decision thresholds

Readiness and rollout approvals must include role decisions for:

- `usr-architecture`
- `usr-conformance`
- `usr-operations`

All approval timestamps must be ISO 8601.

## Rollback and stabilization policy

Rollback plans must provide:

- deterministic switchback path to prior stable behavior
- explicit trigger thresholds and decision windows
- compatibility impact assessment
- post-rollback validation checklist

Post-cutover stabilization must track:

- regression/churn indicators
- waiver state and expiry cadence
- observability and readiness scorecard continuity

## Required outputs

- `usr-backcompat-matrix-results.json`
- `usr-operational-readiness-validation.json`
- `usr-release-readiness-scorecard.json`
- `usr-observability-rollup.json`
- `usr-no-cut-decision-log.json`
- `usr-rollback-drill-report.json`
- `usr-post-cutover-stabilization-report.json`

## References

- `TES_LAYN_ROADMAP.md`
- `TES_LAYN_EXECUTION_PACKS.md`
- `TES_LAYN_GOVERNANCE.md`
- `docs/specs/usr-rollout-approval-lock.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/specs/usr-core-observability-performance-ops.md`
- `docs/archived/README.md`
