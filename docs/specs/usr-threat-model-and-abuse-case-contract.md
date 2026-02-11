# Spec -- USR Threat Model and Abuse-Case Coverage Contract

Status: Draft v0.1
Last updated: 2026-02-11T02:25:00Z

## 0. Purpose and scope

This document defines mandatory threat taxonomy, abuse-case fixtures, and control-mapping requirements for USR security assurance.

It decomposes `docs/specs/unified-syntax-representation.md` sections 18, 42, and 47.

## 1. Required threat-model artifact

Implementations MUST maintain:

- `tests/lang/matrix/usr-threat-model-matrix.json`

## 2. Canonical threat-model schema (normative)

```ts
type USRThreatModelRowV1 = {
  id: string;
  threatClass:
    | "path-traversal"
    | "untrusted-execution"
    | "sensitive-data-leakage"
    | "schema-confusion"
    | "parser-supply-chain"
    | "resource-exhaustion"
    | "reporting-exfiltration";
  attackSurface: "input" | "parser" | "normalization" | "resolution" | "serialization" | "reporting" | "runtime";
  requiredControls: string[]; // control IDs/gates/redaction classes
  requiredFixtures: string[]; // abuse-case fixture IDs
  severity: "low" | "medium" | "high" | "critical";
  blocking: boolean;
};
```

## 3. Coverage requirements

Threat-model rows MUST:

- map every blocking security gate to at least one threat class
- map every critical threat class to at least one abuse-case fixture
- include deterministic expected outcomes for strict mode

## 4. Abuse-case execution policy

- blocking abuse-case fixtures MUST run in strict CI lanes
- non-blocking abuse-case fixtures MUST run at least in CI-long/nightly
- failures MUST emit diagnostics and control-gap reports

## 5. Required outputs

- `usr-threat-model-coverage.json`
- `usr-abuse-case-results.json`
- `usr-control-gap-report.json`

## 6. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-security-and-data-governance-contract.md`
- `docs/specs/usr-failure-injection-and-resilience-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
