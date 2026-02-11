# Spec -- USR Validation CLI Contract

Status: Draft v0.1
Last updated: 2026-02-11T05:30:00Z

## 0. Purpose and scope

Defines the canonical validator command surface for USR contract, schema, matrix, and evidence checks.

## 1. Required commands (normative)

| Command | Scope | Exit codes |
| --- | --- | --- |
| node tools/usr/validate-contract-references.mjs | spec/roadmap reference drift | 0 pass, 2 advisory fail, 3 blocking fail |
| node tools/usr/validate-matrix-references.mjs | matrix reference drift | 0 pass, 2 advisory fail, 3 blocking fail |
| node tools/usr/validate-registry-invariants.mjs | cross-registry invariants | 0 pass, 3 blocking fail |
| node tools/usr/validate-evidence-freshness.mjs | artifact freshness policy | 0 pass, 2 advisory fail, 3 blocking fail |
| node tools/usr/evaluate-gates.mjs | hard-block/advisory gate decision | 0 pass, 3 blocking fail |

## 2. Output contract (normative)

All validators MUST emit JSON with commandId, timestamps, scope, blockingFindings, advisoryFindings, evidenceRefs, and exitCode.

## 3. CI lane expectations

- ci-lite: reference and schema-shape validators
- ci: full blocking validators
- ci-long/nightly: expanded matrices, drill checks, differential checks

## 4. Required output schemas

| Command | Output schema |
| --- | --- |
| `validate-contract-references` | `docs/schemas/usr/usr-validation-report.schema.json` |
| `validate-matrix-references` | `docs/schemas/usr/usr-validation-report.schema.json` |
| `validate-registry-invariants` | `docs/schemas/usr/usr-validation-report.schema.json` |
| `validate-evidence-freshness` | `docs/schemas/usr/usr-validation-report.schema.json` |
| `evaluate-gates` | `docs/schemas/usr/usr-release-readiness-scorecard.schema.json` |

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

