# Spec -- USR Core Rollout, Release, and Migration Contract

Status: Draft v2.0
Last updated: 2026-02-11T07:40:00Z

## Purpose

Define staged rollout, compatibility policy, release-readiness gates, and rollback requirements.

## Consolidated source coverage

This contract absorbs:

- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-release-train-contract.md`
- `docs/specs/usr-operational-runbook-contract.md`
- `docs/guides/usr-cutover-runbook.md`
- `docs/guides/usr-rollback-runbook.md`
- `docs/guides/usr-release-checklist.md`
- `docs/guides/usr-incident-severity-matrix.md`

## Rollout phases

1. `shadow-read`
2. `dual-write`
3. `strict-gate pre-cutover`
4. `cutover`
5. `post-cutover stabilization`

Each phase must define entry/exit criteria and required evidence artifacts.

## Compatibility policy

Compatibility enforcement must use:

- `tests/lang/matrix/usr-backcompat-matrix.json`
- scenario classes `BC-001` through `BC-012`
- strict and non-strict reader profiles

Strict scenario failures in blocking classes are release-blocking.

## Operational readiness requirements

Before cutover:

- rollback drill must be fresh and passing
- incident response drill must be fresh and passing
- release checklist must be complete
- no expired waivers in blocking scope

## Release train controls

Release train rows must define:

- freeze windows
- required gate bundles
- owner approvals
- no-cut decision thresholds

## Rollback policy

Rollback must provide:

- one-step path to prior stable read behavior
- explicit trigger thresholds
- data loss and compatibility impact assessment

## Required outputs

- `usr-backcompat-matrix-results.json`
- `usr-operational-readiness-validation.json`
- `usr-incident-response-drill-report.json`
- `usr-rollback-drill-report.json`
- `usr-release-train-readiness.json`

## References

- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/specs/usr-core-observability-performance-ops.md`
