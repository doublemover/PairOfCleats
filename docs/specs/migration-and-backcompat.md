# Phase 9 Spec -- Migration and Backward Compatibility

Last updated: 2026-02-11T07:25:00Z

## Alignment

This migration contract aligns with:

- `docs/specs/unified-syntax-representation.md` (sections 19, 27, 36)
- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-pipeline-incremental-transforms.md`
- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
- `docs/specs/usr-core-observability-performance-ops.md`
- `docs/specs/usr-core-security-risk-compliance.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/specs/usr-core-governance-change.md`

## Why this exists

Phase 9 replaces legacy join behavior (`file::name`) with canonical identity/linking semantics and explicit compatibility gates.

## Compatibility model

- artifacts are schema-versioned
- readers must support N-1 major compatibility policy via explicit adapters where allowed
- strict and non-strict mode behavior must match USR compatibility classes (`BC-001` .. `BC-012`)

## Strict mode

Strict mode requires:

- canonical ID grammar compliance
- no unknown schema fields
- no unknown diagnostic or reason codes
- no legacy name-only cross-file joins

## Non-strict mode

Non-strict mode allows additive minor fields through adapters with explicit compatibility diagnostics, but still rejects major semantic breaks.

## Required compatibility artifacts

- matrix source: `tests/lang/matrix/usr-backcompat-matrix.json`
- result output: `usr-backcompat-matrix-results.json`
- compatibility rollups: by scenario, language, framework profile, reader mode

## Release-blocking scenarios

- `BC-001`, `BC-002`, `BC-003`, `BC-005`, `BC-006`, `BC-008`, `BC-009`, `BC-010`, `BC-012`

## Required migration evidence

- `usr-backcompat-matrix-results.json`
- `usr-conformance-summary.json`
- `usr-operational-readiness-validation.json`
- `usr-release-readiness-scorecard.json`

## Rollout sequence

1. dual-write and shadow-read
2. strict matrix checks enabled in CI
3. parity thresholds met and sustained
4. cutover with rollback drills validated

Rollback must be one-step and pre-documented.
