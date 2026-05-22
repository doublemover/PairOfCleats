# USR Schema Index

Last updated: 2026-05-21T00:00:00Z

This directory contains JSON schemas for USR artifacts, reports, and gate evidence payloads.

Primary contract references:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/specs/usr-core-quality-conformance-testing.md`

Schema policy:

- Every blocking evidence artifact must have an active schema.
- Schema evolution must be backward-compatibility tested per rollout policy.
- Schema IDs and versions must match matrix entries and validator outputs.
- Shared envelope schema stays extension-safe for composed artifacts; strict unknown-key rejection is enforced at artifact schemas via `unevaluatedProperties: false`.
- Evidence envelope is required to carry run metadata (`runId`, `lane`, `buildId`, `status`) in addition to producer and scope identity fields.
- Report schemas MUST require payload fields (`summary`, `rows`) so envelope-only artifacts cannot validate.
- Every report in `USR_REPORT_SCHEMA_DEFS` must have a matching `usr-*.schema.json` file here with the same `artifactId` const.
- `usr-evidence-envelope.schema.json` is the registry alias for the shared `evidence-envelope.schema.json` base used by report schemas.
- `usr-capability-transition.schema.json` covers the non-report capability transition schema in the USR registry.
- Gate evaluation, registry validation, evidence freshness, feature/lane policy, and governance outputs required by the USR core specs must remain schema-backed in both `src/contracts/schemas/usr.js` and this directory.
