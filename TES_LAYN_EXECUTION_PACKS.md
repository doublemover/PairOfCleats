# TES_LAYN_EXECUTION_PACKS - USR Batch and Framework Packs

Last updated: 2026-02-13T09:58:25Z
Status: active
Parent roadmap: `TES_LAYN_ROADMAP.md`
Governance reference: `TES_LAYN_GOVERNANCE.md`

## 0) Purpose

This document carries detailed execution packs for roadmap implementation phases.

Use this file for:
- language batch delivery detail (B0-B8)
- framework overlay delivery detail (C4-required profiles)
- concrete touchpoints (code, matrix, docs, tests)

Keep implementation straightforward:
- no placeholder paths
- no speculative work items
- no phase/batch closure without runnable tests

## 1) Global Completion Contract

A pack is complete only when all conditions below are true:

1. Runtime touchpoints are implemented and merged.
2. Matrix and spec touchpoints are updated and consistent.
3. Required fixture/golden artifacts are present for affected scope.
4. Required contract and conformance tests pass.
5. Diagnostics for partial/unsupported states are explicit where applicable.

Primary runtime touchpoints:
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/import-collectors/*.js`
- `src/index/language-registry/control-flow.js`
- `src/index/segments.js`
- `src/index/segments/vue.js`
- `src/index/identity/chunk-uid.js`
- `src/index/identity/symbol.js`
- `src/index/build/runtime/normalize.js`
- `src/contracts/validators/usr.js`
- `src/contracts/validators/usr-matrix.js`

Primary matrix/spec touchpoints:
- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-conformance-levels.json`
- `tests/lang/matrix/usr-language-batch-shards.json`
- `tests/lang/matrix/usr-framework-profiles.json`
- `tests/lang/matrix/usr-framework-edge-cases.json`
- `docs/specs/usr/languages/*.md`
- `docs/specs/usr/frameworks/*.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`

Primary fixture/test touchpoints:
- `tests/fixtures/usr/**`
- `tests/conformance/language-shards/**`
- `tests/conformance/framework-canonicalization/**`
- `tests/conformance/embedding-provenance/**`
- `tests/conformance/risk-fixture-governance/**`
- `tests/unified-syntax-representation/lang/contracts/**`

## 2) Batch Execution Packs (B0-B8)

Completion status:
- [ ] B0 foundation pack complete
- [ ] B1 javascript/typescript pack complete
- [ ] B2 systems-languages pack complete
- [ ] B3 managed-languages pack complete
- [ ] B4 dynamic-languages pack complete
- [ ] B5 markup-style-template pack complete
- [ ] B6 data-interface-dsl pack complete
- [ ] B7 build-infra-dsl pack complete
- [ ] B8 cross-language integration pack complete

Batch map (authoritative source: `tests/lang/matrix/usr-language-batch-shards.json`):

| Batch | Scope | Required conformance | Order manifest | Primary shard test |
| --- | --- | --- | --- | --- |
| B0 | foundation | C0,C1 | `tests/conformance/language-shards/foundation/foundation.order.txt` | `tests/conformance/language-shards/foundation/foundation-validation.test.js` |
| B1 | javascript, typescript | C0,C1,C2,C3,C4 | `tests/conformance/language-shards/javascript-typescript/javascript-typescript.order.txt` | `tests/conformance/language-shards/javascript-typescript/javascript-typescript-validation.test.js` |
| B2 | clike, go, rust, swift | C0,C1,C2,C3 | `tests/conformance/language-shards/systems-languages/systems-languages.order.txt` | `tests/conformance/language-shards/systems-languages/systems-languages-validation.test.js` |
| B3 | csharp, dart, groovy, java, kotlin, scala | C0,C1,C2,C3 | `tests/conformance/language-shards/managed-languages/managed-languages.order.txt` | `tests/conformance/language-shards/managed-languages/managed-languages-validation.test.js` |
| B4 | julia, lua, perl, php, python, r, ruby, shell | C0,C1,C2,C3 | `tests/conformance/language-shards/dynamic-languages/dynamic-languages.order.txt` | `tests/conformance/language-shards/dynamic-languages/dynamic-languages-validation.test.js` |
| B5 | css, handlebars, html, jinja, mustache, razor | C0,C1,C4 | `tests/conformance/language-shards/markup-style-template/markup-style-template.order.txt` | `tests/conformance/language-shards/markup-style-template/markup-style-template-validation.test.js` |
| B6 | graphql, proto, sql | C0,C1,C2,C3 | `tests/conformance/language-shards/data-interface-dsl/data-interface-dsl.order.txt` | `tests/conformance/language-shards/data-interface-dsl/data-interface-dsl-validation.test.js` |
| B7 | cmake, dockerfile, makefile, nix, starlark | C0,C1,C2 | `tests/conformance/language-shards/build-infra-dsl/build-infra-dsl.order.txt` | `tests/conformance/language-shards/build-infra-dsl/build-infra-dsl-validation.test.js` |
| B8 | cross-batch integration | C0,C1,C2,C3,C4 | `tests/conformance/language-shards/cross-language-integration/cross-language-integration.order.txt` | `tests/conformance/language-shards/cross-language-integration/cross-language-integration-validation.test.js` |

Minimum required checks for every batch pack:

1. Registry and matrix rows are complete for in-scope languages.
2. Required parser/collector/control-flow hooks are implemented or explicitly marked unsupported with diagnostics.
3. Shard order manifest and shard validation test pass.
4. Impacted per-language spec docs are updated (`docs/specs/usr/languages/*.md`).
5. Matrix contract tests remain green:
- `tests/unified-syntax-representation/shared/contracts/schema-validators.test.js`
- `tests/unified-syntax-representation/shared/contracts/matrix-validators.test.js`
- `tests/unified-syntax-representation/lang/contracts/language-contract-matrix-sync-validation.test.js`
- `tests/unified-syntax-representation/lang/contracts/language-batch-shards-validation.test.js`

## 3) Framework Execution Packs (C4)

Completion status:
- [ ] react pack complete
- [ ] vue pack complete
- [ ] next pack complete
- [ ] nuxt pack complete
- [ ] svelte pack complete
- [ ] sveltekit pack complete
- [ ] angular pack complete
- [ ] astro pack complete

Framework map (authoritative source: `tests/lang/matrix/usr-framework-profiles.json`):

| Framework | Applies to languages | Required conformance | Edge-case matrix source |
| --- | --- | --- | --- |
| react | javascript, typescript | C4 | `tests/lang/matrix/usr-framework-edge-cases.json` |
| vue | css, html, javascript, typescript | C4 | `tests/lang/matrix/usr-framework-edge-cases.json` |
| next | javascript, typescript | C4 | `tests/lang/matrix/usr-framework-edge-cases.json` |
| nuxt | css, html, javascript, typescript | C4 | `tests/lang/matrix/usr-framework-edge-cases.json` |
| svelte | css, html, javascript, typescript | C4 | `tests/lang/matrix/usr-framework-edge-cases.json` |
| sveltekit | css, html, javascript, typescript | C4 | `tests/lang/matrix/usr-framework-edge-cases.json` |
| angular | html, typescript | C4 | `tests/lang/matrix/usr-framework-edge-cases.json` |
| astro | css, html, javascript, typescript | C4 | `tests/lang/matrix/usr-framework-edge-cases.json` |

Minimum required checks for every framework pack:

1. Framework profile and edge-case rows are complete and schema-valid.
2. Route/template/style/hydration semantics are implemented for required cases.
3. Framework fixtures and canonical bundles are updated under `tests/fixtures/usr/`.
4. Framework spec docs are updated (`docs/specs/usr/frameworks/*.md`).
5. Required framework tests pass:
- `tests/conformance/framework-canonicalization/framework-canonicalization-validation.test.js`
- `tests/unified-syntax-representation/lang/contracts/framework-contract-matrix-sync-validation.test.js`
- `tests/unified-syntax-representation/lang/contracts/framework-profile-matrix-sync-validation.test.js`
- `tests/unified-syntax-representation/lang/contracts/framework-canonicalization-baseline-validation.test.js`

## 4) Semantics and Hardening Packs (Phase E and Phase F)

Completion status:
- [ ] semantics/risk pack complete
- [ ] fixture/golden determinism pack complete
- [ ] readiness/hardening pack complete

Semantics/risk pack touchpoints:
- `src/index/risk.js`
- `src/index/risk-rules.js`
- `src/index/risk-interprocedural/*.js`
- `tests/lang/matrix/usr-language-risk-profiles.json`
- `tests/lang/matrix/usr-failure-injection-matrix.json`
- `tests/lang/matrix/usr-security-gates.json`

Fixture/golden determinism pack touchpoints:
- `tests/fixtures/usr/canonical-examples/`
- `tests/fixtures/usr/framework-canonicalization/`
- `tests/fixtures/usr/embedding-bridges/`
- `tests/fixtures/usr/generated-provenance/`

Readiness/hardening pack touchpoints:
- `src/index/build/runtime/caps.js`
- `tests/lang/matrix/usr-operational-readiness-policy.json`
- `tests/lang/matrix/usr-slo-budgets.json`
- `tests/lang/matrix/usr-waiver-policy.json`

Minimum required checks for these packs:
- `tests/unified-syntax-representation/lang/contracts/risk-fixture-governance-baseline-validation.test.js`
- `tests/unified-syntax-representation/lang/contracts/embedding-provenance-baseline-validation.test.js`
- `tests/unified-syntax-representation/lang/contracts/hardening-readiness-validation.test.js`
- `tests/unified-syntax-representation/lang/contracts/implementation-readiness-validation.test.js`
- `tests/unified-syntax-representation/lang/contracts/observability-rollup-validation.test.js`
- `tests/unified-syntax-representation/lang/contracts/security-gate-validation.test.js`

## 5) Quick Execution Sequence

1. Complete B0 and B1 first.
2. Execute B2-B7 in parallel where owners and dependencies allow.
3. Complete B8 integration only after B1-B7 are green.
4. Complete framework packs and C4 checks.
5. Complete semantics/risk/fixture/readiness packs before rollout authorization.

This file remains the detailed checklist companion to `TES_LAYN_ROADMAP.md`.
