# Spec -- USR Component Lifecycle Contract

Status: Draft v0.1
Last updated: 2026-02-11T04:05:00Z

## 0. Purpose and scope

Defines unified lifecycle phase representation for component frameworks.

This contract extends docs/specs/unified-syntax-representation.md and must remain consistent with roadmap gates in TES_LAYN_ROADMAP.md.

## 1. Normative requirements

1. Define normalized lifecycle phase taxonomy and edge-kind mapping.
2. Define state and effect transitions and async boundary behavior across lifecycles.
3. Define mandatory diagnostics for lifecycle ambiguities and transform-induced loss.
4. Implementations MUST emit explicit diagnostics for unsupported or degraded execution paths in this domain.
5. Strict-mode behavior MUST fail closed when blocking constraints in this contract are violated.

## 2. Determinism and compatibility requirements

- Outputs and validations defined by this contract MUST be deterministic for identical input and runtime policy.
- Contract changes MUST be versioned and assessed for backward-compat impact before rollout.
- Non-strict allowances MUST remain explicitly diagnosable and auditable.

## 3. Required evidence outputs

- usr-component-lifecycle-contract-validation.json
- usr-component-lifecycle-contract-drift-report.json
- usr-release-readiness-scorecard.json linkage entry for this contract domain

## 4. Cross-contract dependencies

- docs/specs/usr-framework-profile-catalog.md
- docs/specs/usr-generated-provenance-contract.md
- docs/specs/usr-registry-schema-contract.md
- docs/specs/usr-audit-and-reporting-contract.md

## 5. Governance notes

- Domain owners MUST define blocking and advisory gates for this contract in roadmap phase checklists.
- Waivers for this domain MUST use docs/specs/usr-waiver-and-exception-contract.md and be time-bounded.
