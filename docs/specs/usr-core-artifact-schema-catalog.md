# Spec -- USR Core Artifact and Schema Catalog

Status: Draft v2.0
Last updated: 2026-02-12T01:20:00Z

## Purpose

Define the canonical machine-readable registries, schema requirements, and validator behavior for consolidated USR contracts.

## Consolidated source coverage

This contract absorbs:

- `usr-registry-schema-contract.md` (legacy)
- `usr-schema-artifact-catalog.md` (legacy)
- `usr-validation-cli-contract.md` (legacy)
- `usr-feature-flag-catalog.md` (legacy)
- `usr-lane-policy-catalog.md` (legacy)

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
- `tests/lang/matrix/usr-ownership-matrix.json`
- `tests/lang/matrix/usr-escalation-policy.json`

## Registry invariants

1. every `languageId` in capability/version/embedding registries must exist in language profiles
2. every `frameworkProfile` in framework edge-case matrices must exist in framework profiles
3. every blocking gate row must define evidence artifact IDs and policy owner
4. every enum value used by registries must exist in the corresponding schema
5. every ownership row must reference a valid escalation policy row

Required registry row keys:

| Registry | Mandatory keys |
| --- | --- |
| `usr-language-profiles.json` | `id`, `requiredNodeKinds`, `requiredEdgeKinds`, `requiredConformance` |
| `usr-framework-profiles.json` | `id`, `detectionPrecedence`, `routeSemantics`, `bindingSemantics`, `segmentationRules` |
| `usr-capability-matrix.json` | `languageId`, `frameworkProfile`, `capability`, `state`, `requiredConformance` |
| `usr-backcompat-matrix.json` | `id`, `producerVersion`, `readerVersions`, `readerMode`, `expectedOutcome`, `blocking` |

## Evidence artifact envelope

All blocking evidence artifacts must include:

- `schemaVersion`
- `artifactId`
- `generatedAt`
- `producerId`
- `runId`
- `lane`
- `buildId` (or null for non-build harness runs)
- `status`
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

CLI determinism requirements:

1. identical inputs must produce byte-for-byte identical JSON output ordering
2. all emitted timestamps must be in RFC 3339 UTC format
3. exit code priority must be deterministic when both advisory and blocking failures exist

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

## Acceptance criteria

This contract is green only when:

1. all required registries validate against active schemas
2. cross-registry invariants pass with zero blocking failures
3. validator output is deterministic across reruns
4. lane and feature-flag policy catalogs are complete for active gates

## References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/schemas/usr/README.md`
