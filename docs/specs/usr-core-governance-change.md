# Spec -- USR Core Governance and Change Contract

Status: Draft v2.0
Last updated: 2026-02-12T05:23:00Z

## Purpose

Define ownership, change control, documentation lifecycle, and drift governance for consolidated USR contracts.

## Consolidated source coverage

This contract absorbs:

- `usr-change-management-contract.md` (legacy)
- `usr-contract-drift-check-contract.md` (legacy)
- `usr-doc-lifecycle-policy.md` (legacy)
- `usr-doc-style-guide.md` (legacy)
- `usr-glossary.md` (legacy)
- `usr-implementation-playbook.md` (legacy)
- `usr-implementation-readiness-contract.md` (legacy)
- `usr-open-questions.md` (legacy)
- `usr-ownership-and-raci-contract.md` (legacy)
- `usr-rfc-template.md` (legacy)
- `usr-risk-register.md` (legacy)
- `usr-traceability-index.md` (legacy)
- `usr/README.md` (legacy)
- `usr-contract-enforcement.md` (legacy)
- `usr-new-language-onboarding.md` (legacy)

## Ownership model

Each contract domain must have:

- primary owner
- backup owner
- review group
- escalation path

Ownership metadata must be machine-readable and referenced by gate policies.

Required ownership fields:

| Field | Required | Notes |
| --- | --- | --- |
| `domainId` | yes | Contract domain key. |
| `primaryOwner` | yes | Responsible approver for blocking changes. |
| `backupOwner` | yes | Escalation backup. |
| `reviewGroup` | yes | Minimum reviewer set. |
| `escalationPolicy` | yes | Timeout/escalation thresholds. |

## Change classes

- `additive`: new optional fields or scenarios
- `behavioral`: deterministic behavior changes without schema major bump
- `breaking`: incompatible schema/semantic changes

All classes require RFC metadata; behavioral and breaking changes require rollout impact and matrix updates.

Change-class gate requirements:

- `additive`: advisory review + schema checks
- `behavioral`: blocking review + conformance and compatibility reruns
- `breaking`: release-train approval + migration protocol and cutover planning

## Tiered change workflow (Tier 1, Tier 2, Tier 3)

Every PR that changes USR contracts, registries, or validators must classify itself into exactly one tier:

| Tier | Typical scope | Required reviewer threshold | Required updates |
| --- | --- | --- | --- |
| Tier 1 | editorial/narrative clarification with no normative key, schema, or behavior change | at least 1 owner-role reviewer | roadmap/sync links only when touched |
| Tier 2 | normative key/value/constraint changes in docs or registries without hard break | at least 2 reviewers including primary or backup owner role | registries, schemas, validators/tests, and roadmap appendix sync in same PR |
| Tier 3 | breaking semantic/schema behavior or rollout/cutover-impacting changes | at least 3 reviewers including primary + backup owner roles and release authority | full Tier 2 bundle plus migration notes, compatibility/backcompat evidence, and rollout gate updates |

Tier mapping to change classes:

- Tier 1 generally maps to `additive` docs-only clarification with no contract delta
- Tier 2 maps to `additive` or `behavioral` normative contract changes
- Tier 3 maps to `breaking` or high-impact `behavioral` changes

## Mandatory change bundle

A normative contract change must include:

1. contract text updates
2. matrix/schema updates
3. roadmap linkage updates
4. validator/gate policy updates (if applicable)
5. migration notes for behavioral/breaking changes

Additional tier requirements:

- Tier 2 and Tier 3 changes must include synchronized updates to registries, schemas, and tests (or explicit non-applicability notes)
- Tier 2 and Tier 3 changes must rerun and attach relevant `ci-lite`/`ci` contract evidence for impacted domains
- Tier 3 changes must include explicit backcompat and release-readiness evidence updates

## Drift checks

Drift checks must verify consistency across:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr/README.md`
- all `docs/specs/usr-core-*.md`
- `docs/specs/usr-consolidation-coverage-matrix.md`
- `TES_LAYN_ROADMAP.md`
- `tests/lang/matrix/usr-*.json`

Drift checks must also verify:

1. contract references in roadmap appendices H/J/M
2. consolidation mapping completeness in `usr-consolidation-coverage-matrix.md`
3. no orphan blocking evidence artifacts without contract ownership

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
- `usr-contract-ownership-report.json`
- `usr-rfc-change-impact-summary.json`

## References

- `docs/specs/usr-consolidation-coverage-matrix.md`
- `docs/specs/usr-core-rollout-release-migration.md`
