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

