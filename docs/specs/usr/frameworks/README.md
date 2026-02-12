# USR Framework Authoring

Status: Draft v1.2
Last updated: 2026-02-12T06:00:40Z

Framework behavior is primarily specified in:

- `docs/specs/usr-core-language-framework-catalog.md`

Use `docs/specs/usr/frameworks/TEMPLATE.md` only when a framework needs a temporary deep-dive appendix that cannot fit cleanly in the consolidated catalog.

Any framework extension document must:

- reference the canonical framework profile ID in matrix files
- define detection precedence, segmentation, route semantics, template binding semantics, and style scope semantics
- define SSR/CSR/hydration/island boundaries where applicable
- define diagnostics and fallback behavior for unsupported features
- include an `## 9. Approval checklist` section with owner/backup signoff and matrix-link verification
- include an `## 10. Completion evidence artifacts` section mapping required report IDs to framework conformance scope

Parent contracts:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-pipeline-incremental-transforms.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
