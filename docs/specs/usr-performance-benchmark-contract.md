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
