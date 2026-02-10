# Spec -- USR Conformance and Fixture Contract

Status: Draft v0.3
Last updated: 2026-02-10T06:20:00Z

## 0. Purpose and scope

This document defines exact conformance assertions, fixture requirements, deterministic rerun policy, and triage protocol for USR.

It decomposes `docs/specs/unified-syntax-representation.md` section 16 and related sections 33-36.

## 1. Conformance levels (normative assertions)

### C0 -- segmentation and coordinate integrity

Required assertions:

- valid container/virtual ranges
- required document/segment identity fields
- coordinate normalization and ordering invariants

### C1 -- symbols and relation baseline

Required assertions:

- symbol extraction with deterministic IDs
- import/reference relation extraction with valid endpoints
- resolution envelope compliance for non-resolved outcomes

### C2 -- deep syntax and flow

Required assertions:

- normalized node kind coverage for required language profile node kinds
- control/data flow edges where profile requires

### C3 -- risk semantics

Required assertions:

- required risk source/sink/sanitizer coverage by profile
- risk local/interprocedural capability state correctness

### C4 -- framework overlays

Required assertions:

- framework segmentation rules
- canonical route/template/style edge mappings
- framework edge-case fixtures

## 2. Required fixture families (normative)

Each language/profile MUST have fixtures for:

1. positive canonical examples
2. negative malformed syntax
3. fallback/degraded parser behavior
4. ambiguity/unresolved linking cases
5. cap-triggered truncation behavior
6. deterministic rerun stress fixtures

Framework profiles additionally require:

- route canonicalization family
- template binding family
- style scope family
- hydration boundary family (where applicable)

Cross-language and generation requirements:

- embedded-language bridge family (`usr-embedding-bridge-cases.json`)
- generated/macro provenance family (`usr-generated-provenance-cases.json`)

Minimum fixture counts per language/profile:

- C0: at least 6 fixtures (`positive`, `negative`, `fallback`, `determinism` families represented)
- C1: at least 8 fixtures (includes unresolved/ambiguous linking)
- C2: at least 10 fixtures (includes control/data flow families)
- C3: at least 12 fixtures (includes risk local and interprocedural gating families)
- C4 framework overlays: at least 14 fixtures per framework profile (route/template/style/hydration edge families included)

Fixture ID format:

- `<language-or-framework>::<family>::<case-id>`

Examples:

- `typescript::fallback::parser-unavailable-001`
- `vue::template-binding::slot-prop-ambiguous-002`

## 3. Golden generation contract

Golden files MUST:

- be generated from canonical serialization
- include schema version and generation metadata
- be deterministic across reruns with identical inputs

Regeneration policy:

- goldens may be regenerated only when change-control criteria are met
- diffs MUST be reviewed with per-entity change summaries

## 4. Deterministic rerun requirements

Minimum rerun protocol:

1. run same fixture suite twice in clean environment
2. compare canonical serialized outputs
3. assert zero diff except allowed timestamp fields
4. fail on any entity ordering or numeric normalization drift

Required outputs:

- `usr-determinism-rerun-diff.json`
- `usr-conformance-summary.json`

Pass thresholds:

- strict conformance lane: 100% pass for required assertions
- warning-budget lane: failures allowed only for explicitly budgeted non-blocking scenarios

## 5. Failure triage protocol (normative)

On failure:

1. classify failure domain:
   - schema/contract
   - identity/range
   - normalization mapping
   - resolution/linking
   - framework overlay
   - risk semantics
   - compatibility matrix
2. attach failing fixture IDs, entity IDs, and diagnostics
3. classify blocker level:
   - release-blocking
   - lane-blocking
   - warning-budget
4. document remediation owner and ETA

## 6. Test matrix linkage

Conformance fixtures MUST link to:

- language profiles (`usr-language-profiles.json`)
- framework profiles (`usr-framework-profiles.json`)
- backcompat matrix (`usr-backcompat-matrix.json`)

## 7. Required triage metadata fields

Every conformance failure record MUST include:

- `fixtureId`
- `languageId`
- `frameworkProfile` (nullable)
- `conformanceLevel`
- `diagnosticCodes`
- `reasonCodes`
- `owner`
- `blocking`
- `firstSeenAt` (ISO 8601)
- `lastSeenAt` (ISO 8601)

## 8. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-framework-profile-catalog.md`
- `docs/specs/usr-rollout-and-migration-contract.md`


