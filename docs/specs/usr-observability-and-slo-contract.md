# Spec -- USR Observability and SLO Contract

Status: Draft v0.1
Last updated: 2026-02-10T08:35:00Z

## 0. Purpose and scope

This document defines required observability signals, service-level objectives (SLOs), and alert policies for USR extraction, conformance, and rollout lanes.

It decomposes `docs/specs/unified-syntax-representation.md` sections 17, 30, and 31.

## 1. Required machine-readable policy artifacts

Implementations MUST maintain:

- `tests/lang/matrix/usr-slo-budgets.json`
- `tests/lang/matrix/usr-alert-policies.json`

## 2. SLO budget schema (normative)

```ts
type USRSLOBudgetRowV1 = {
  laneId: string;
  profileScope: "global" | "batch" | "language" | "framework";
  scopeId: string; // e.g. B1, javascript, vue
  maxDurationMs: number;
  maxMemoryMb: number;
  maxParserTimePerSegmentMs: number;
  maxUnknownKindRate: number; // 0..1
  maxUnresolvedRate: number; // 0..1
  blocking: boolean;
};
```

Rules:

- rows MUST be deterministic and stable across reruns.
- `blocking=true` budgets are release-blocking on breach.
- unknown kind and unresolved rates MUST be measured against canonical fixture sets.

## 3. Alert policy schema (normative)

```ts
type USRAlertPolicyRowV1 = {
  id: string;
  metric: string;
  threshold: number;
  comparator: ">" | ">=" | "<" | "<=";
  window: "run" | "24h" | "7d";
  severity: "warning" | "critical";
  escalationPolicyId: string;
  blocking: boolean;
};
```

Rules:

- every critical blocking budget MUST have at least one alert policy row.
- escalation policy IDs MUST exist in readiness/escalation artifacts.

## 4. Required observability dimensions

At minimum, reports/dashboards MUST include:

- lane and profile scope
- duration and memory envelopes
- parser-source selection distribution
- unknown-kind and unresolved rates
- capability downgrade counts
- bridge/provenance degradation counts

## 5. Required report outputs

- `usr-slo-budget-results.json`
- `usr-alert-evaluations.json`
- `usr-observability-rollup.json`

## 6. Promotion and blocking policy

- Any blocking SLO breach in required lanes blocks phase promotion.
- Warning-level breaches MUST be triaged with owner + ETA.
- Repeated warning breaches across two promotion windows escalate to blocking unless explicitly waived.

## 7. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-implementation-readiness-contract.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
