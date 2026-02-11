# Spec -- USR Core Governance and Change Contract

Status: Draft v2.0
Last updated: 2026-02-11T07:35:00Z

## Purpose

Define ownership, change control, documentation lifecycle, and drift governance for consolidated USR contracts.

## Consolidated source coverage

This contract absorbs:

- `docs/specs/usr-change-management-contract.md`
- `docs/specs/usr-contract-drift-check-contract.md`
- `docs/specs/usr-doc-lifecycle-policy.md`
- `docs/specs/usr-doc-style-guide.md`
- `docs/specs/usr-glossary.md`
- `docs/specs/usr-implementation-playbook.md`
- `docs/specs/usr-implementation-readiness-contract.md`
- `docs/specs/usr-open-questions.md`
- `docs/specs/usr-ownership-and-raci-contract.md`
- `docs/specs/usr-rfc-template.md`
- `docs/specs/usr-risk-register.md`
- `docs/specs/usr-traceability-index.md`
- `docs/specs/usr/README.md`
- `docs/guides/usr-contract-enforcement.md`
- `docs/guides/usr-new-language-onboarding.md`

## Ownership model

Each contract domain must have:

- primary owner
- backup owner
- review group
- escalation path

Ownership metadata must be machine-readable and referenced by gate policies.

## Change classes

- `additive`: new optional fields or scenarios
- `behavioral`: deterministic behavior changes without schema major bump
- `breaking`: incompatible schema/semantic changes

All classes require RFC metadata; behavioral and breaking changes require rollout impact and matrix updates.

## Mandatory change bundle

A normative contract change must include:

1. contract text updates
2. matrix/schema updates
3. roadmap linkage updates
4. validator/gate policy updates (if applicable)
5. migration notes for behavioral/breaking changes

## Drift checks

Drift checks must verify consistency across:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr/README.md`
- all `docs/specs/usr-core-*.md`
- `docs/specs/usr-consolidation-coverage-matrix.md`
- `TES_LAYN_ROADMAP.md`
- `tests/lang/matrix/usr-*.json`

## Documentation lifecycle states

- `draft`
- `active`
- `deprecated`
- `archived`

Deprecation requires explicit replacement references and migration notes.

## Open questions and risk register policy

Open questions and risks must be tracked as structured tables with:

- ID
- owner
- decision due date
- impact class
- mitigation or decision outcome

## Required outputs

- `usr-contract-drift-report.json`
- `usr-change-management-log.json`
- `usr-governance-readiness-summary.json`

## References

- `docs/specs/usr-consolidation-coverage-matrix.md`
- `docs/specs/usr-core-rollout-release-migration.md`
