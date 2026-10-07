# USR Framework Authoring

Status: Draft v1.3
Last updated: 2026-05-21T18:25:13Z

Framework behavior is defined by a two-layer contract:

- `docs/specs/usr-core-language-framework-catalog.md` (normative matrix and policy layer)
- `docs/specs/usr/frameworks/*.md` (framework-specific contract layer)

`docs/specs/usr/frameworks/TEMPLATE.md` is the required authoring template for all framework contracts.

Every framework profile row in `tests/lang/matrix/usr-framework-profiles.json` must have exactly one matching framework contract document.

Each framework contract document must:

- reference the canonical framework profile ID in matrix files
- define detection precedence, segmentation, route semantics, template binding semantics, and style scope semantics
- define SSR/CSR/hydration/island boundaries where applicable
- define diagnostics and fallback behavior for unsupported features
- include an `## 9. Approval checklist` section with owner/backup signoff and matrix-link verification
- include an `## 10. Completion evidence artifacts` section mapping required report IDs to framework conformance scope

C4 execution is carried by the applicable language conformance shard validation tests under `tests/conformance/language-shards/**/validation.test.js`. The `lang-framework-canonicalization` ID in `usr-slo-budgets` and `usr-benchmark-policy` is the framework overlay SLO/benchmark policy lane, not a standalone `tests/run.js --lane` value.

Framework contract set:

- `docs/specs/usr/frameworks/angular.md`
- `docs/specs/usr/frameworks/astro.md`
- `docs/specs/usr/frameworks/next.md`
- `docs/specs/usr/frameworks/nuxt.md`
- `docs/specs/usr/frameworks/react.md`
- `docs/specs/usr/frameworks/svelte.md`
- `docs/specs/usr/frameworks/sveltekit.md`
- `docs/specs/usr/frameworks/vue.md`

Parent contracts:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-pipeline-incremental-transforms.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
