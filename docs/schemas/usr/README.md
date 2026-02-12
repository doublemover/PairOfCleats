# USR Schema Index

Last updated: 2026-02-12T00:40:00Z

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
