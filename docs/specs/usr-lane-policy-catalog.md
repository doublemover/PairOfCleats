# Spec -- USR Lane Policy Catalog

Status: Draft v0.1
Last updated: 2026-02-11T05:30:00Z

## 0. Purpose and scope

Defines required checks and budgets by CI lane.

## 1. Lane catalog

| Lane | Required checks | Timeout class |
| --- | --- | --- |
| ci-lite | reference drift, schema shape, doc drift | short |
| ci | blocking contract validators, conformance baseline, waiver expiry | medium |
| ci-long | expanded backcompat, fuzzing subset, differential checks, ops drills | long |
| nightly | exhaustive fuzzing and long-tail matrices | extended |

## 2. Enforcement

- missing required check in lane configuration is blocking
- advisory checks may fail only with active non-expired waiver

## 3. Required check families by lane

| Lane | Mandatory check families |
| --- | --- |
| ci-lite | contract drift, matrix reference drift, schema shape validation |
| ci | registry invariants, conformance baseline, quality blocking checks, waiver expiry |
| ci-long | backcompat expanded matrix, operational drills, differential/fuzzing subsets |
| nightly | exhaustive fuzzing, long-running framework edge suites, trend regressions |

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

