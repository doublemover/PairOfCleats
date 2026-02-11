# Spec -- USR Performance Benchmark Methodology Contract

Status: Draft v0.1
Last updated: 2026-02-11T02:25:00Z

## 0. Purpose and scope

This document defines reproducible benchmark methodology, variance controls, and regression gating requirements for USR performance claims.

It decomposes `docs/specs/unified-syntax-representation.md` sections 17, 41, and 46.

## 1. Required benchmark policy artifact

Implementations MUST maintain:

- `tests/lang/matrix/usr-benchmark-policy.json`

## 2. Canonical benchmark policy schema (normative)

```ts
type USRBenchmarkPolicyRowV1 = {
  id: string;
  laneId: string;
  datasetClass: "smoke" | "language-batch" | "framework-overlay" | "mixed-repo";
  hostClass: string; // canonical machine class label
  warmupRuns: number;
  measureRuns: number;
  percentileTargets: {
    p50DurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
  };
  maxVariancePct: number;
  maxPeakMemoryMb: number;
  blocking: boolean;
};
```

## 3. Methodology requirements

Benchmarks MUST:

1. execute configured warmup runs before measured runs
2. use deterministic fixture sets and ordering
3. report percentile and variance outputs per lane/profile scope
4. capture host class metadata for comparability

Comparisons across host classes MUST NOT be used for blocking regression decisions unless explicitly normalized.

## 4. Regression policy

- Blocking benchmark rows MUST fail promotion on threshold breach.
- Warning benchmark breaches require owner + ETA triage.
- Repeated warning breaches across two release windows MUST escalate unless explicitly waived.

## 5. Required outputs

- `usr-benchmark-results.json`
- `usr-benchmark-variance-report.json`
- `usr-benchmark-regression-summary.json`

## 6. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-observability-and-slo-contract.md`
- `docs/specs/usr-audit-and-reporting-contract.md`
- `docs/specs/usr-registry-schema-contract.md`

## Required Fields and Tables

- Implementations MUST maintain a machine-readable table for each normative row class in this contract domain.
- Required tables MUST include stable identifiers, owner metadata, and blocking/advisory classification fields.

## Invalid Cases

- Missing required keys, unknown blocking enums, and incompatible schemaVersion MUST be invalid.
- Invalid cases MUST produce deterministic diagnostics and reason codes.

## Cross-Contract Conflict Resolution

- Conflicts between this contract and other decomposed contracts MUST be resolved via change-management workflow.
- If unresolved, umbrella USR spec precedence applies and promotion is blocked.

## Ownership and Escalation

- Primary and backup owners MUST be declared in ownership matrices.
- Escalation routing for blocking failures MUST follow the operational runbook contract.

## Change Log

- v0.1: initial draft baseline for this contract.

## Success Metrics

- Blocking-failure count for this contract domain MUST trend to zero before promotion.
- Deterministic rerun consistency for domain checks MUST remain within configured drift budget.

## Non-goals

- This contract does not replace umbrella USR semantics in docs/specs/unified-syntax-representation.md.
- This contract does not authorize bypass of strict-mode blocking behavior unless an active waiver exists.

## Rollout Behavior

- New requirements in this contract MUST be rolled out through shadow, dual-read/write, and cutover where applicable.
- Rollout deviations MUST be tracked with time-bounded waivers.

## Implementation Checklist

- [ ] Required machine-readable rows defined and validated.
- [ ] Blocking/advisory gates mapped and enforced.
- [ ] Required evidence artifacts emitted and linked in scorecard.
- [ ] Drift checks green.

## Canonical Examples

- Include at least one minimal valid example and one maximal typical example for this contract domain.
- Examples MUST be deterministic and compatible with declared schema versions.

