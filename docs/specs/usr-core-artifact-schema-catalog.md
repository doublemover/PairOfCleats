# Spec -- USR Core Artifact and Schema Catalog

Status: Draft v2.0
Last updated: 2026-02-11T07:35:00Z

## Purpose

Define the canonical machine-readable registries, schema requirements, and validator behavior for consolidated USR contracts.

## Consolidated source coverage

This contract absorbs:

- `docs/specs/usr-registry-schema-contract.md`
- `docs/specs/usr-schema-artifact-catalog.md`
- `docs/specs/usr-validation-cli-contract.md`
- `docs/specs/usr-feature-flag-catalog.md`
- `docs/specs/usr-lane-policy-catalog.md`

## Required registries

The following registries are authoritative and must remain schema-validated:

- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-framework-profiles.json`
- `tests/lang/matrix/usr-capability-matrix.json`
- `tests/lang/matrix/usr-language-version-policy.json`
- `tests/lang/matrix/usr-language-embedding-policy.json`
- `tests/lang/matrix/usr-backcompat-matrix.json`
- `tests/lang/matrix/usr-quality-gates.json`
- `tests/lang/matrix/usr-waiver-policy.json`

## Registry invariants

1. every `languageId` in capability/version/embedding registries must exist in language profiles
2. every `frameworkProfile` in framework edge-case matrices must exist in framework profiles
3. every blocking gate row must define evidence artifact IDs and policy owner
4. every enum value used by registries must exist in the corresponding schema

## Evidence artifact envelope

All blocking evidence artifacts must include:

- `schemaVersion`
- `artifactId`
- `generatedAt`
- `producerId`
- `lane`
- `scope`
- `summary`

## Feature-flag policy

Feature flags controlling USR behavior must define:

- flag key
- default state
- rollout scope
- owner
- rollback trigger
- compatibility impact

## Lane policy

Lane catalog rows must define:

- lane ID (`ci-lite`, `ci`, `ci-long`, plus targeted lanes)
- blocking vs advisory policy class
- required registry/schema/evidence checks
- timeout/runtime budget class

## Validator CLI contract

Validator tooling must provide deterministic output and exit codes:

- `0`: pass
- `2`: advisory failures only
- `3`: blocking failures

Required CLI capabilities:

- schema validation
- cross-registry invariants
- freshness checks for evidence TTL
- strict/non-strict profile execution
- machine-readable JSON output

## Required outputs

- `usr-registry-schema-validation.json`
- `usr-registry-cross-invariant-validation.json`
- `usr-validation-report.json`
- `usr-evidence-freshness-report.json`
- `usr-feature-flag-policy-evaluation.json`
- `usr-lane-policy-evaluation.json`

## Drift prevention

- schema IDs/versions in `docs/schemas/usr/*.json` must match matrix entries
- registry key additions/removals must update this contract and roadmap in the same change
- validator must fail on unknown blocking artifact IDs

## References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/schemas/usr/README.md`
