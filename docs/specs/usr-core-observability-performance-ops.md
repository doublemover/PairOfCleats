# Spec -- USR Core Observability, Performance, and Capacity Contract

Status: Draft v2.0
Last updated: 2026-02-11T08:35:00Z

## Purpose

Define SLOs, benchmark policies, capacity budgets, and reporting requirements for USR release gating.

## Consolidated source coverage

This contract absorbs:

- `usr-observability-and-slo-contract.md` (legacy)
- `usr-performance-benchmark-contract.md` (legacy)
- `usr-resource-and-capacity-contract.md` (legacy)
- `usr-regression-budget-contract.md` (legacy)
- `usr-audit-and-reporting-contract.md` (legacy)

## Required telemetry dimensions

All operational metrics must support rollups by:

- lane
- language
- framework profile (nullable)
- capability class
- scenario ID

## SLO policy

SLO rows must define:

- metric name
- target threshold
- evaluation window
- severity class (blocking/advisory)
- owner and escalation path

SLO row schema:

| Field | Required | Notes |
| --- | --- | --- |
| `metricId` | yes | Stable metric key. |
| `scope` | yes | lane/language/framework dimension definition. |
| `target` | yes | Threshold value and comparator. |
| `window` | yes | Evaluation duration and sampling policy. |
| `severityClass` | yes | blocking or advisory. |
| `owner` | yes | Escalation owner. |

## Benchmark policy

Benchmark suites must define:

- deterministic fixture set
- baseline and tolerance model
- variance controls
- regression class thresholds

Benchmark reproducibility controls:

1. fixed fixture set and deterministic environment
2. warmup and measurement iteration policy
3. noise filtering and outlier handling policy
4. baseline revision policy with documented approval

## Capacity policy

Capacity budgets must include:

- memory ceiling
- CPU/runtime envelope
- artifact size budgets
- parallelism limits per lane

Capacity breach policy:

- hard breach in strict lanes => blocking failure
- soft breach in advisory lanes => warning with remediation window

## Alerting and escalation

Alert policies must map metric breaches to:

- severity tier
- incident owner
- required response SLA
- runbook reference

## Required outputs

- `usr-slo-budget-results.json`
- `usr-alert-evaluations.json`
- `usr-benchmark-regression-summary.json`
- `usr-capacity-budget-report.json`
- `usr-operational-audit-summary.json`
- `usr-benchmark-reproducibility-report.json`
- `usr-capacity-breach-triage-report.json`

## Gate obligations

Blocking:

- sustained SLO breach in blocking tier
- benchmark regression beyond blocking threshold
- capacity budget overrun in strict lanes

Advisory:

- transient non-blocking SLO anomalies
- minor benchmark variance within advisory range

## References

- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
