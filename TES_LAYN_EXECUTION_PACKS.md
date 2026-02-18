# TES_LAYN_EXECUTION_PACKS - USR Language and Framework Delivery Packs

Last updated: 2026-02-18T02:30:50Z
Status: active
Parent roadmap: `TES_LAYN_ROADMAP.md`
Governance reference: `TES_LAYN_GOVERNANCE.md`

## 0) Purpose

This document carries detailed execution packs for roadmap implementation phases.

Use this file for:
- language batch delivery detail (B0-B8)
- framework overlay delivery detail (required framework profiles)
- concrete runtime, fixture, and spec touchpoints

Keep implementation straightforward:
- no placeholder paths
- no speculative work items
- no batch closure without runnable functional scenarios

## 1) Global Completion Contract

A pack is complete only when all conditions below are true:

1. Runtime touchpoints are implemented and merged.
2. Matrix and spec touchpoints are updated and consistent.
3. Required fixture/canonical artifacts are present for affected scope.
4. Functional language/framework scenarios pass for indexed/searchable behavior.
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

Primary fixture/functional touchpoints:
- `tests/fixtures/usr/**`
- `tests/indexing/language-fixture/**`
- `tests/retrieval/**`
- `tests/services/**`

## 2) Batch Execution Packs (B0-B8)

Completion status:
- [x] B0 foundation pack complete
- [x] B1 javascript/typescript pack complete
- [x] B2 systems-languages pack complete
- [x] B3 managed-languages pack complete
- [x] B4 dynamic-languages pack complete
- [x] B5 markup-style-template pack complete
- [x] B6 data-interface-dsl pack complete
- [x] B7 build-infra-dsl pack complete
- [x] B8 cross-language integration pack complete

Batch map (authoritative source: `tests/lang/matrix/usr-language-batch-shards.json`):

| Batch | Scope | Capability targets |
| --- | --- | --- |
| B0 | foundation | C0,C1 |
| B1 | javascript, typescript | C0,C1,C2,C3,C4 |
| B2 | clike, go, rust, swift | C0,C1,C2,C3 |
| B3 | csharp, dart, groovy, java, kotlin, scala | C0,C1,C2,C3 |
| B4 | julia, lua, perl, php, python, r, ruby, shell | C0,C1,C2,C3 |
| B5 | css, handlebars, html, jinja, mustache, razor | C0,C1,C4 |
| B6 | graphql, proto, sql | C0,C1,C2,C3 |
| B7 | cmake, dockerfile, makefile, nix, starlark | C0,C1,C2 |
| B8 | cross-batch integration | C0,C1,C2,C3,C4 |

Minimum required checks for every batch pack:

1. Registry and matrix rows are complete for in-scope languages.
2. Parser/collector/control-flow hooks are implemented or explicitly marked unsupported with diagnostics.
3. Functional scenarios cover parsing, segmentation, identity mapping, and retrieval surfaces.
4. Impacted per-language spec docs are updated (`docs/specs/usr/languages/*.md`).
5. Output determinism is stable on rerun for active fixtures.

## 3) Framework Execution Packs

Completion status:
- [x] react pack complete
- [x] vue pack complete
- [x] next pack complete
- [x] nuxt pack complete
- [x] svelte pack complete
- [x] sveltekit pack complete
- [x] angular pack complete
- [x] astro pack complete

Framework map (authoritative source: `tests/lang/matrix/usr-framework-profiles.json`):

| Framework | Applies to languages | Capability target | Edge-case matrix source |
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

1. Framework profile and edge-case rows are complete and consistent.
2. Route/template/style/hydration semantics are implemented for required cases.
3. Framework fixtures and canonical bundles are updated under `tests/fixtures/usr/`.
4. Framework spec docs are updated (`docs/specs/usr/frameworks/*.md`).
5. Deterministic framework overlay behavior is stable in functional scenarios.

## 4) Semantics and Hardening Packs

Completion status:
- [ ] semantics/risk pack complete
- [ ] fixture/golden determinism pack complete
- [ ] readiness/hardening pack complete

Semantics/risk pack touchpoints:
- `src/index/risk.js`
- `src/index/risk-rules.js`
- `src/index/risk-interprocedural/*.js`
- `tests/lang/matrix/usr-language-risk-profiles.json`

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
- semantics/risk outputs are functionally correct for target profiles
- canonical and generated artifacts remain deterministic
- caps/perf fallback behavior is explicit and stable
- readiness and observability evidence is current

## 5) Fast Repeatable Pack Template (for 20+ languages)

For each language/framework pack, execute this order:

1. wire registry/profile row and capability target
2. implement parser/segment/identity mapping path
3. implement import/call/control-flow edges
4. implement language/framework-specific edge handling
5. add/update fixtures and canonical outputs
6. verify determinism and diagnostics
7. update language/framework spec notes
8. mark pack complete only when runtime behavior is production-usable

## 6) Quick Execution Sequence

1. Complete B0 and B1 first.
2. Execute B2-B7 in parallel where owners and dependencies allow.
3. Complete B8 integration only after B1-B7 functional readiness is achieved.
4. Complete framework packs for all required profiles.
5. Complete semantics/risk/fixture/readiness packs before rollout authorization.

This file remains the detailed checklist companion to `TES_LAYN_ROADMAP.md`.
