# USR Framework Authoring

Status: Draft v1.1
Last updated: 2026-02-11T07:25:00Z

Framework behavior is primarily specified in:

- `docs/specs/usr-core-language-framework-catalog.md`

Use `docs/specs/usr/frameworks/TEMPLATE.md` only when a framework needs a temporary deep-dive appendix that cannot fit cleanly in the consolidated catalog.

Any framework extension document must:

- reference the canonical framework profile ID in matrix files
- define detection precedence, segmentation, route semantics, template binding semantics, and style scope semantics
- define SSR/CSR/hydration/island boundaries where applicable
- define diagnostics and fallback behavior for unsupported features

Parent contracts:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-pipeline-incremental-transforms.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
