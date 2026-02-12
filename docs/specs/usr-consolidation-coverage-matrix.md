# USR Consolidation Coverage Matrix

Status: Approved v1.1
Last updated: 2026-02-12T05:53:57Z

Purpose: document the one-to-many merge of the legacy USR documentation set into the consolidated core contract set.

Policy:
- Every legacy USR doc listed below is reviewed and merged into a canonical destination contract.
- Legacy docs are deleted only after destination contract sections and umbrella references are updated.
- This matrix is normative for traceability and contract-drift checks.

## Approval lock

Approval record ID: `usr-traceability-approval-2026-02-12`
Approved at: 2026-02-12T05:53:57Z

Approval scope:
- section-to-task anchors for USR sections 5 through 36 remain complete in `TES_LAYN_ROADMAP.md` appendix N.1
- decomposition coverage between legacy and core contracts remains complete and machine-auditable
- roadmap phase 0 exit criteria may treat traceability coverage as approved only while this lock remains valid

Required approver roles:
- `usr-architecture`
- `usr-conformance`
- `usr-operations`

| Role | Decision | Approved at |
| --- | --- | --- |
| `usr-architecture` | approved | 2026-02-12T05:53:57Z |
| `usr-conformance` | approved | 2026-02-12T05:53:57Z |
| `usr-operations` | approved | 2026-02-12T05:53:57Z |

## Consolidated destinations

- `docs/specs/unified-syntax-representation.md` (umbrella semantic source)
- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-diagnostics-reasoncodes.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/specs/usr-core-governance-change.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-observability-performance-ops.md`
- `docs/specs/usr-core-pipeline-incremental-transforms.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-security-risk-compliance.md`

## Legacy-to-core mapping

| Legacy doc | Lines (HEAD) | Canonical destination |
| --- | ---: | --- |
| `docs/guides/usr-contract-enforcement.md` | 47 | `docs/specs/usr-core-governance-change.md` |
| `docs/guides/usr-cutover-runbook.md` | 7 | `docs/specs/usr-core-rollout-release-migration.md` |
| `docs/guides/usr-incident-severity-matrix.md` | 7 | `docs/specs/usr-core-rollout-release-migration.md` |
| `docs/guides/usr-new-language-onboarding.md` | 44 | `docs/specs/usr-core-governance-change.md` |
| `docs/guides/usr-release-checklist.md` | 7 | `docs/specs/usr-core-rollout-release-migration.md` |
| `docs/guides/usr-rollback-runbook.md` | 6 | `docs/specs/usr-core-rollout-release-migration.md` |
| `docs/guides/usr-waiver-audit-checklist.md` | 7 | `docs/specs/usr-core-evidence-gates-waivers.md` |
| `docs/specs/usr-audit-and-reporting-contract.md` | 203 | `docs/specs/usr-core-observability-performance-ops.md` |
| `docs/specs/usr-build-tooling-integration-contract.md` | 59 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-change-management-contract.md` | 59 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-component-lifecycle-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-concurrency-and-async-semantics-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-conformance-and-fixture-contract.md` | 132 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/specs/usr-contract-drift-check-contract.md` | 53 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-cross-parser-differential-contract.md` | 59 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/specs/usr-data-classification-contract.md` | 58 | `docs/specs/usr-core-security-risk-compliance.md` |
| `docs/specs/usr-determinism-and-reproducibility-contract.md` | 59 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-diagnostic-catalog.md` | 60 | `docs/specs/usr-core-diagnostics-reasoncodes.md` |
| `docs/specs/usr-diagnostics-lifecycle-contract.md` | 58 | `docs/specs/usr-core-diagnostics-reasoncodes.md` |
| `docs/specs/usr-doc-lifecycle-policy.md` | 43 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-doc-style-guide.md` | 48 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-documentation-quality-contract.md` | 58 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/specs/usr-embedded-language-matrix.md` | 45 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr-embedding-bridge-contract.md` | 95 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-error-handling-semantics-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-evidence-catalog.md` | 59 | `docs/specs/usr-core-evidence-gates-waivers.md` |
| `docs/specs/usr-failure-injection-and-resilience-contract.md` | 71 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-feature-flag-catalog.md` | 55 | `docs/specs/usr-core-artifact-schema-catalog.md` |
| `docs/specs/usr-fixture-governance-contract.md` | 59 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/specs/usr-framework-interactions.md` | 51 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr-framework-macro-transform-contract.md` | 59 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr-framework-profile-catalog.md` | 226 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr-fuzzing-and-property-testing-contract.md` | 59 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/specs/usr-gate-evaluation-algorithm.md` | 59 | `docs/specs/usr-core-evidence-gates-waivers.md` |
| `docs/specs/usr-generated-provenance-contract.md` | 76 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-generics-and-polymorphism-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-glossary.md` | 41 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-golden-diff-and-triage-contract.md` | 59 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/specs/usr-identity-stability-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-implementation-playbook.md` | 60 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-implementation-readiness-contract.md` | 161 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-incremental-indexing-contract.md` | 59 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-lane-policy-catalog.md` | 53 | `docs/specs/usr-core-artifact-schema-catalog.md` |
| `docs/specs/usr-language-feature-coverage-contract.md` | 59 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr-language-profile-catalog.md` | 184 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr-language-risk-contract.md` | 112 | `docs/specs/usr-core-security-risk-compliance.md` |
| `docs/specs/usr-license-and-third-party-attribution-contract.md` | 59 | `docs/specs/usr-core-security-risk-compliance.md` |
| `docs/specs/usr-module-system-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-normalization-mapping-contract.md` | 105 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-observability-and-slo-contract.md` | 68 | `docs/specs/usr-core-observability-performance-ops.md` |
| `docs/specs/usr-open-questions.md` | 40 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-operational-runbook-contract.md` | 52 | `docs/specs/usr-core-rollout-release-migration.md` |
| `docs/specs/usr-ownership-and-raci-contract.md` | 59 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-packaging-and-artifact-layout-contract.md` | 58 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-parser-adapter-sdk-contract.md` | 59 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-performance-benchmark-contract.md` | 79 | `docs/specs/usr-core-observability-performance-ops.md` |
| `docs/specs/usr-preprocessor-and-conditional-compilation-contract.md` | 59 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-quality-evaluation-contract.md` | 51 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/specs/usr-query-semantics-contract.md` | 58 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-reason-code-catalog.md` | 58 | `docs/specs/usr-core-diagnostics-reasoncodes.md` |
| `docs/specs/usr-registry-schema-contract.md` | 517 | `docs/specs/usr-core-artifact-schema-catalog.md` |
| `docs/specs/usr-regression-budget-contract.md` | 59 | `docs/specs/usr-core-observability-performance-ops.md` |
| `docs/specs/usr-release-train-contract.md` | 59 | `docs/specs/usr-core-rollout-release-migration.md` |
| `docs/specs/usr-resolution-and-linking-contract.md` | 115 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-resource-and-capacity-contract.md` | 59 | `docs/specs/usr-core-observability-performance-ops.md` |
| `docs/specs/usr-rfc-template.md` | 43 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-risk-register.md` | 40 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-rollout-and-migration-contract.md` | 108 | `docs/specs/usr-core-rollout-release-migration.md` |
| `docs/specs/usr-routing-normalization-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-runtime-config-contract.md` | 81 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-schema-artifact-catalog.md` | 67 | `docs/specs/usr-core-artifact-schema-catalog.md` |
| `docs/specs/usr-schema-evolution-and-versioning-contract.md` | 58 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-security-and-data-governance-contract.md` | 66 | `docs/specs/usr-core-security-risk-compliance.md` |
| `docs/specs/usr-ssr-csr-hydration-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-state-management-integration-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-styling-and-css-semantics-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-supply-chain-integrity-contract.md` | 59 | `docs/specs/usr-core-security-risk-compliance.md` |
| `docs/specs/usr-template-expression-binding-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-test-data-generation-contract.md` | 59 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/specs/usr-threat-model-and-abuse-case-contract.md` | 77 | `docs/specs/usr-core-security-risk-compliance.md` |
| `docs/specs/usr-threat-response-playbook-catalog.md` | 59 | `docs/specs/usr-core-security-risk-compliance.md` |
| `docs/specs/usr-traceability-index.md` | 49 | `docs/specs/usr-core-governance-change.md` |
| `docs/specs/usr-transforms-stage-map.md` | 58 | `docs/specs/usr-core-pipeline-incremental-transforms.md` |
| `docs/specs/usr-type-system-normalization-contract.md` | 59 | `docs/specs/usr-core-normalization-linking-identity.md` |
| `docs/specs/usr-validation-cli-contract.md` | 58 | `docs/specs/usr-core-artifact-schema-catalog.md` |
| `docs/specs/usr-waiver-and-exception-contract.md` | 82 | `docs/specs/usr-core-evidence-gates-waivers.md` |
| `docs/specs/usr-waiver-request-template.md` | 65 | `docs/specs/usr-core-evidence-gates-waivers.md` |
| `docs/specs/usr/frameworks/angular.md` | 22 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/frameworks/astro.md` | 22 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/frameworks/next.md` | 22 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/frameworks/nuxt.md` | 22 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/frameworks/react.md` | 22 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/frameworks/README.md` | 15 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/frameworks/svelte.md` | 22 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/frameworks/sveltekit.md` | 22 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/frameworks/TEMPLATE.md` | 13 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/frameworks/vue.md` | 22 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/clike.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/cmake.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/csharp.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/css.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/dart.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/dockerfile.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/go.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/graphql.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/groovy.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/handlebars.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/html.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/java.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/javascript.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/jinja.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/julia.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/kotlin.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/lua.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/makefile.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/mustache.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/nix.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/perl.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/php.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/proto.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/python.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/r.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/razor.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/README.md` | 93 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/ruby.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/rust.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/scala.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/shell.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/sql.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/starlark.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/swift.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/TEMPLATE.md` | 20 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/languages/typescript.md` | 105 | `docs/specs/usr-core-language-framework-catalog.md` |
| `docs/specs/usr/README.md` | 120 | `docs/specs/usr-core-governance-change.md` |
| `docs/testing/usr-fixture-minimums.md` | 7 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/testing/usr-fixture-taxonomy.md` | 11 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/testing/usr-flaky-test-policy.md` | 5 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/testing/usr-golden-update-policy.md` | 5 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/testing/usr-regression-triage-playbook.md` | 7 | `docs/specs/usr-core-quality-conformance-testing.md` |
| `docs/testing/usr-test-runtime-budget-policy.md` | 8 | `docs/specs/usr-core-quality-conformance-testing.md` |


## Coverage summary

| Bucket | Legacy docs |
| --- | ---: |
| `artifact-schema` | 5 |
| `diagnostics-gates` | 8 |
| `framework-profile` | 10 |
| `governance` | 12 |
| `language-profile` | 36 |
| `misc` | 10 |
| `ops-performance` | 5 |
| `pipeline-runtime` | 10 |
| `quality-testing` | 14 |
| `rollout-operations` | 7 |
| `security-risk` | 7 |
| `semantic-normalization` | 16 |
