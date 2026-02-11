# USR Schema Index

Last updated: 2026-02-11T07:25:00Z

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
