# USR Language Authoring

Status: Draft v1.1
Last updated: 2026-02-12T05:57:28Z

Language behavior is primarily specified in:

- `docs/specs/usr-core-language-framework-catalog.md`

Use `docs/specs/usr/languages/TEMPLATE.md` only for exceptional language deep-dives that cannot be represented cleanly in consolidated tables and matrices.

Any language extension document must define:

- owner role and backup owner role matching `tests/lang/matrix/usr-ownership-matrix.json` language-framework governance
- review cadence days, last reviewed timestamp, and explicit ownership rotation policy
- required normalized node kinds and edge kinds
- capability states and fallback behavior
- raw-kind to normalized-kind mapping constraints
- resolution/linking expectations and known ambiguity classes
- risk source/sink/sanitizer expectations where applicable
- conformance fixture family requirements and acceptance thresholds
- phase-9-oriented approval checklist section with owner/backup signoff and matrix-link verification
- completion evidence artifact section mapping required report IDs to language-level conformance scope

Parent contracts:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-security-risk-compliance.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
