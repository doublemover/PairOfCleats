# USR Language Authoring

Status: Draft v1.1
Last updated: 2026-02-11T07:25:00Z

Language behavior is primarily specified in:

- `docs/specs/usr-core-language-framework-catalog.md`

Use `docs/specs/usr/languages/TEMPLATE.md` only for exceptional language deep-dives that cannot be represented cleanly in consolidated tables and matrices.

Any language extension document must define:

- required normalized node kinds and edge kinds
- capability states and fallback behavior
- raw-kind to normalized-kind mapping constraints
- resolution/linking expectations and known ambiguity classes
- risk source/sink/sanitizer expectations where applicable
- conformance fixture family requirements and acceptance thresholds

Parent contracts:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-security-risk-compliance.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
