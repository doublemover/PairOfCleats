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

