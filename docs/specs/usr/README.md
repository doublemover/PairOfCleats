# USR Consolidated Contract Set

Status: Draft v2.1
Last updated: 2026-02-13T09:58:25Z

USR now uses a consolidated architecture: one umbrella spec plus a focused core contract set.

## Authoritative docs

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-governance-change.md`
- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-pipeline-incremental-transforms.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
- `docs/specs/usr-core-security-risk-compliance.md`
- `docs/specs/usr-core-observability-performance-ops.md`
- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-diagnostics-reasoncodes.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`

## Traceability

Legacy coverage and one-to-many merge mapping is tracked in:

- `docs/specs/usr-consolidation-coverage-matrix.md`

Every removed split contract must map to one of the consolidated core docs above.

## Templates

- `docs/specs/usr/languages/TEMPLATE.md`
- `docs/specs/usr/frameworks/TEMPLATE.md`

Templates are optional extension docs for exceptional cases. The default path is updating the consolidated catalogs and machine-readable matrices.

## Supporting references

- `TES_LAYN_ROADMAP.md`
- `TES_LAYN_EXECUTION_PACKS.md`
- `TES_LAYN_GOVERNANCE.md`
- `docs/schemas/usr/README.md`

## Policy

- Do not reintroduce many single-purpose `usr-*.md` contracts.
- Extend consolidated contracts and machine-readable registries instead.
- Any contract change must update roadmap references and coverage matrix in the same change.
