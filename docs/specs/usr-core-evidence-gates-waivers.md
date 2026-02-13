# Spec -- USR Core Evidence, Gates, and Waiver Contract

Status: Draft v2.0
Last updated: 2026-02-12T06:07:50Z

## Purpose

Define deterministic gate evaluation from findings, evidence freshness, waiver state, and policy rows.

## Consolidated source coverage

This contract absorbs:

- `usr-evidence-catalog.md` (legacy)
- `usr-gate-evaluation-algorithm.md` (legacy)
- `usr-waiver-and-exception-contract.md` (legacy)
- `usr-waiver-request-template.md` (legacy)
- `usr-waiver-audit-checklist.md` (legacy)

## Gate evaluation inputs

- policy rows (`usr-quality-gates.json`, lane policies)
- validator outputs
- diagnostics and reason-code rollups
- evidence freshness metadata
- waiver records

Mandatory gate row fields:

| Field | Required | Notes |
| --- | --- | --- |
| `gateId` | yes | Stable ID used in scorecards and audits. |
| `severityClass` | yes | `blocking` or `advisory`. |
| `predicate` | yes | Deterministic boolean expression over evidence. |
| `requiredArtifacts` | yes | List of required artifact IDs. |
| `freshnessPolicy` | yes | TTL and stale behavior. |
| `waiverEligibility` | yes | Whether and how waiver can apply. |

## Deterministic gate algorithm

For each gate row:

1. load required evidence artifacts
2. validate schema and freshness
3. evaluate predicate against evidence data
4. apply active waivers (if valid and in scope)
5. emit gate state (`pass`, `advisory_fail`, `block_fail`)

Final release readiness state is the max severity over all blocking gates.

## Waiver policy

Waivers must define:

- unique waiver ID
- owner and approver
- scope (language/profile/lane/artifact)
- expiration timestamp
- justification
- compensating controls

Waivers are invalid if:

- expired
- scope mismatch
- missing approver metadata
- applied to disallowed hard-block classes

Waiver enforcement requirements:

1. waiver IDs must be unique and immutable
2. approver cannot equal requester for blocking waivers
3. compensating controls must reference concrete evidence artifacts
4. renewal requires fresh approval and updated justification

## Evidence freshness policy

- each evidence artifact class has TTL
- stale blocking evidence fails gate evaluation
- stale advisory evidence produces warning and scorecard annotation

Freshness classes:

- `hard-ttl`: stale => blocking fail
- `soft-ttl`: stale => advisory fail
- `informational`: stale => scorecard note only

## Required outputs

- `usr-gate-evaluation-summary.json`
- `usr-waiver-active-report.json`
- `usr-waiver-expiry-report.json`
- `usr-release-readiness-scorecard.json`

## Standard evidence artifacts consumed by gate predicates

In addition to required outputs above, gate predicates and scorecards may consume these canonical evidence artifacts:

- `usr-validation-report.json`
- `usr-conformance-summary.json`
- `usr-quality-evaluation-results.json`
- `usr-observability-rollup.json`
- `usr-feature-flag-state.json`
- `usr-failure-injection-report.json`
- `usr-rollback-drill-report.json`
- `usr-benchmark-summary.json`
- `usr-benchmark-regression-summary.json`
- `usr-threat-model-coverage-report.json`
- `usr-waiver-active-report.json`
- `usr-waiver-expiry-report.json`
- `usr-backcompat-matrix-results.json`
- `usr-operational-readiness-validation.json`
- `usr-release-train-readiness.json`
- `usr-no-cut-decision-log.json`
- `usr-post-cutover-stabilization-report.json`
- `usr-drift-report.json`

## Auditability requirements

- gate results must include evaluated policy row IDs
- waiver application must include before/after severity
- scorecard must link source evidence artifacts and generation timestamps

## Blocking classes

Hard blocks include at minimum:

- strict compatibility matrix failures
- schema/invariant failures for blocking artifacts
- critical security/risk gate failures
- required operational drill failures
- rollout no-cut decisions marked blocking without approved compensating controls

## Acceptance criteria

This contract is green only when:

1. gate evaluation report includes all active gate IDs
2. waiver report contains no invalid active waiver
3. freshness policy evaluation has no blocking stale artifacts
4. release readiness scorecard state equals deterministic max gate severity

## References

- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-diagnostics-reasoncodes.md`
- `docs/specs/usr-core-rollout-release-migration.md`
