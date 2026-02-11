# Spec -- USR Core Rollout, Release, and Migration Contract

Status: Draft v2.0
Last updated: 2026-02-11T08:20:00Z

## Purpose

Define staged rollout, compatibility policy, release-readiness gates, and rollback requirements.

## Consolidated source coverage

This contract absorbs:

- `usr-rollout-and-migration-contract.md` (legacy)
- `usr-release-train-contract.md` (legacy)
- `usr-operational-runbook-contract.md` (legacy)
- `usr-cutover-runbook.md` (legacy)
- `usr-rollback-runbook.md` (legacy)
- `usr-release-checklist.md` (legacy)
- `usr-incident-severity-matrix.md` (legacy)

## Rollout phases

1. `shadow-read`
2. `dual-write`
3. `strict-gate pre-cutover`
4. `cutover`
5. `post-cutover stabilization`

Each phase must define entry/exit criteria and required evidence artifacts.

Phase gate minimums:

| Phase | Required entry | Required exit |
| --- | --- | --- |
| `shadow-read` | baseline artifacts available | parity deltas measured and within advisory bounds |
| `dual-write` | shadow-read exit met | writer/read parity green for blocking scenarios |
| `strict-gate pre-cutover` | compatibility matrix strict scenarios green | operational readiness drills green and fresh |
| `cutover` | no blocking waivers expired, no-cut checks clear | production validation window complete |
| `post-cutover stabilization` | cutover complete | churn/regression metrics within thresholds |

## Compatibility policy

Compatibility enforcement must use:

- `tests/lang/matrix/usr-backcompat-matrix.json`
- scenario classes `BC-001` through `BC-012`
- strict and non-strict reader profiles

Strict scenario failures in blocking classes are release-blocking.

No-cut triggers:

1. any strict blocking scenario failure
2. stale required drill evidence
3. unresolved critical security gate
4. rollback drill failure

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

Rollback must also include:

- deterministic switchback command path
- maximum rollback decision window
- post-rollback validation checklist

## Required outputs

- `usr-backcompat-matrix-results.json`
- `usr-operational-readiness-validation.json`
- `usr-incident-response-drill-report.json`
- `usr-rollback-drill-report.json`
- `usr-release-train-readiness.json`
- `usr-no-cut-decision-log.json`
- `usr-post-cutover-stabilization-report.json`

## References

- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/specs/usr-core-observability-performance-ops.md`

