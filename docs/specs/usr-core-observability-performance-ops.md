# Spec -- USR Core Observability, Performance, and Capacity Contract

Status: Draft v2.0
Last updated: 2026-02-11T07:40:00Z

## Purpose

Define SLOs, benchmark policies, capacity budgets, and reporting requirements for USR release gating.

## Consolidated source coverage

This contract absorbs:

- `docs/specs/usr-observability-and-slo-contract.md`
- `docs/specs/usr-performance-benchmark-contract.md`
- `docs/specs/usr-resource-and-capacity-contract.md`
- `docs/specs/usr-regression-budget-contract.md`
- `docs/specs/usr-audit-and-reporting-contract.md`

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

## Benchmark policy

Benchmark suites must define:

- deterministic fixture set
- baseline and tolerance model
- variance controls
- regression class thresholds

## Capacity policy

Capacity budgets must include:

- memory ceiling
- CPU/runtime envelope
- artifact size budgets
- parallelism limits per lane

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
