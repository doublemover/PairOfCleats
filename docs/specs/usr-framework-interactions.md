# Spec -- USR Framework Interactions

Status: Draft v0.1
Last updated: 2026-02-11T05:30:00Z

## 0. Purpose and scope

Defines interoperability behavior for mixed framework surfaces and island composition.

## 1. Required interaction classes

- host framework plus embedded framework islands
- route handoff boundaries
- shared state bridge boundaries
- style scoping collisions

## 2. Required diagnostics

- cross-framework boundary mismatch
- unsupported interop bridge
- hydration ownership ambiguity

## 3. Canonical interaction scenarios

| Scenario ID | Host | Embedded | Required behavior |
| --- | --- | --- | --- |
| `fwx-001` | astro | react | island boundary emits framework ownership attrs and hydration scope |
| `fwx-002` | vue | svelte | unsupported bridge emits explicit diagnostic and preserves host graph stability |
| `fwx-003` | next | angular | route handoff boundary must emit unresolved-interop diagnostic with reason code |

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

