# Spec -- USR Waiver and Exception Governance Contract

Status: Draft v0.1
Last updated: 2026-02-11T02:25:00Z

## 0. Purpose and scope

This document defines controlled waiver and exception policy for temporary deviations from blocking USR gates.

It decomposes `docs/specs/unified-syntax-representation.md` sections 26, 28, 31, and 48.

## 1. Required waiver policy artifact

Implementations MUST maintain:

- `tests/lang/matrix/usr-waiver-policy.json`

## 2. Canonical waiver schema (normative)

```ts
type USRWaiverPolicyRowV1 = {
  id: string;
  waiverClass:
    | "benchmark-overrun"
    | "non-strict-compat-warning"
    | "temporary-parser-regression"
    | "non-blocking-security-warning"
    | "observability-gap";
  scopeType: "lane" | "phase" | "language" | "framework" | "artifact";
  scopeId: string;
  allowedUntil: string; // ISO 8601
  approvers: string[]; // required owner groups/roles
  requiredCompensatingControls: string[];
  maxExtensions: number;
  blocking: boolean; // true means waiver record itself is mandatory and audited
};
```

## 3. Waiver constraints

Waivers MUST:

- be time-bounded (`allowedUntil`)
- reference compensating controls
- be approved by required approver roles
- be non-renewable beyond `maxExtensions` without explicit change-control event

Waivers MUST NOT:

- bypass strict security gate failures
- bypass schema validity failures
- bypass deterministic ID/integrity failures

## 4. Required outputs

- `usr-waiver-active-report.json`
- `usr-waiver-expiry-report.json`
- `usr-waiver-breach-report.json`

## 5. CI enforcement

- expired waivers MUST fail CI for affected scope
- missing mandatory waiver records for declared exceptions MUST fail CI
- waiver usage MUST be included in release-readiness scorecard

## 6. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-audit-and-reporting-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
