# Spec -- USR Data Classification Contract

Status: Draft v0.1
Last updated: 2026-02-11T04:05:00Z

## 0. Purpose and scope

Defines data sensitivity classes and propagation requirements in artifacts.

This contract extends docs/specs/unified-syntax-representation.md and must remain consistent with roadmap gates in TES_LAYN_ROADMAP.md.

## 1. Normative requirements

1. Define classification taxonomy and required redaction control mapping per class.
2. Define propagation and downgrade or upgrade rules for derived artifacts.
3. Define strict-mode blocking policy for unclassified sensitive fields.
4. Implementations MUST emit explicit diagnostics for unsupported or degraded execution paths in this domain.
5. Strict-mode behavior MUST fail closed when blocking constraints in this contract are violated.

## 2. Determinism and compatibility requirements

- Outputs and validations defined by this contract MUST be deterministic for identical input and runtime policy.
- Contract changes MUST be versioned and assessed for backward-compat impact before rollout.
- Non-strict allowances MUST remain explicitly diagnosable and auditable.

## 3. Required evidence outputs

- usr-data-classification-contract-validation.json
- usr-data-classification-contract-drift-report.json
- usr-release-readiness-scorecard.json linkage entry for this contract domain

## 4. Cross-contract dependencies

- docs/specs/usr-security-and-data-governance-contract.md
- docs/specs/usr-audit-and-reporting-contract.md
- docs/specs/usr-registry-schema-contract.md

## 5. Governance notes

- Domain owners MUST define blocking and advisory gates for this contract in roadmap phase checklists.
- Waivers for this domain MUST use docs/specs/usr-waiver-and-exception-contract.md and be time-bounded.
