# Spec -- USR Fixture and Golden Governance Contract

Status: Draft v0.2
Last updated: 2026-02-11T02:40:00Z

## 0. Purpose and scope

This document defines governance rules for fixture metadata, golden lifecycle, deterministic regeneration, and review policy.

It decomposes `docs/specs/unified-syntax-representation.md` sections 16, 30, 31, and 36.

## 1. Canonical fixture governance schema

```ts
type USRFixtureGovernanceRowV1 = {
  fixtureId: string; // <language-or-framework>::<family>::<case-id>
  profileType: "language" | "framework" | "cross-cutting";
  profileId: string;
  conformanceLevels: Array<"C0" | "C1" | "C2" | "C3" | "C4">;
  families: string[];
  owner: string;
  reviewers: string[];
  stabilityClass: "stable" | "volatile" | "experimental";
  mutationPolicy: "require-rfc" | "require-review" | "allow-generated-refresh";
  goldenRequired: boolean;
  blocking: boolean;
};
```

Required matrix file:

- `tests/lang/matrix/usr-fixture-governance.json`

## 2. Fixture lifecycle requirements

Each fixture MUST declare:

- ownership and reviewer set
- conformance-level linkage
- golden requirement and mutation policy
- stability class and blocking impact

Fixture IDs MUST be globally unique.

## 3. Golden regeneration policy

Golden regeneration MUST:

- be deterministic and reproducible
- attach per-entity diff summaries
- include explicit reason for regeneration
- enforce reviewer quorum for blocking fixtures

## 4. Required artifact outputs

Runs affecting fixtures/goldens MUST emit:

- `usr-fixture-governance-validation.json`
- `usr-golden-regeneration-summary.json`
- `usr-golden-diff-audit.json`
- `usr-fixture-ownership-coverage.json`

## 5. Blocking policy

Blocking fixtures MUST NOT be changed without:

- linked change-control record
- owner acknowledgment
- required reviewer approvals

Violations are release-blocking in strict lanes.

## 6. Drift policy

Fixture-governance rows MUST stay synchronized with:

- conformance fixture inventories
- language/framework profile IDs
- backward-compat scenario coverage

## 7. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-audit-and-reporting-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
