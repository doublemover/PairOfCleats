# Spec -- USR Core Evidence, Gates, and Waiver Contract

Status: Draft v2.0
Last updated: 2026-02-11T07:35:00Z

## Purpose

Define deterministic gate evaluation from findings, evidence freshness, waiver state, and policy rows.

## Consolidated source coverage

This contract absorbs:

- `docs/specs/usr-evidence-catalog.md`
- `docs/specs/usr-gate-evaluation-algorithm.md`
- `docs/specs/usr-waiver-and-exception-contract.md`
- `docs/specs/usr-waiver-request-template.md`
- `docs/guides/usr-waiver-audit-checklist.md`

## Gate evaluation inputs

- policy rows (`usr-quality-gates.json`, lane policies)
- validator outputs
- diagnostics and reason-code rollups
- evidence freshness metadata
- waiver records

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

## Evidence freshness policy

- each evidence artifact class has TTL
- stale blocking evidence fails gate evaluation
- stale advisory evidence produces warning and scorecard annotation

## Required outputs

- `usr-gate-evaluation-summary.json`
- `usr-waiver-active-report.json`
- `usr-waiver-expiry-report.json`
- `usr-release-readiness-scorecard.json`

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

## References

- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-diagnostics-reasoncodes.md`
- `docs/specs/usr-core-rollout-release-migration.md`
