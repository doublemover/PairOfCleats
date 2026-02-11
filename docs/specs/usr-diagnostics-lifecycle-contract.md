# Spec -- USR Diagnostics Lifecycle Contract

Status: Draft v0.1
Last updated: 2026-02-11T04:05:00Z

## 0. Purpose and scope

Defines the complete lifecycle of diagnostics from emission to expiry.

This contract extends docs/specs/unified-syntax-representation.md and must remain consistent with roadmap gates in TES_LAYN_ROADMAP.md.

## 1. Normative requirements

1. Define canonical lifecycle states, deduping keys, and state transition policy.
2. Define suppression and waiver linkage, expiry behavior, and notification escalation rules.
3. Define release-window aggregation and recurrence thresholds for forced escalation.
4. Implementations MUST emit explicit diagnostics for unsupported or degraded execution paths in this domain.
5. Strict-mode behavior MUST fail closed when blocking constraints in this contract are violated.

## 2. Determinism and compatibility requirements

- Outputs and validations defined by this contract MUST be deterministic for identical input and runtime policy.
- Contract changes MUST be versioned and assessed for backward-compat impact before rollout.
- Non-strict allowances MUST remain explicitly diagnosable and auditable.

## 3. Required evidence outputs

- usr-diagnostics-lifecycle-contract-validation.json
- usr-diagnostics-lifecycle-contract-drift-report.json
- usr-release-readiness-scorecard.json linkage entry for this contract domain

## 4. Cross-contract dependencies

- docs/specs/usr-waiver-and-exception-contract.md
- docs/specs/usr-audit-and-reporting-contract.md
- docs/specs/usr-registry-schema-contract.md

## 5. Governance notes

- Domain owners MUST define blocking and advisory gates for this contract in roadmap phase checklists.
- Waivers for this domain MUST use docs/specs/usr-waiver-and-exception-contract.md and be time-bounded.
