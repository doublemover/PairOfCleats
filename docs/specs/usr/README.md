# USR Decomposed Contract Set

Status: Draft v1.4
Last updated: 2026-02-11T05:30:00Z

This directory decomposes the monolithic USR spec into focused normative contract documents.

Primary contracts:

- `docs/specs/usr-audit-and-reporting-contract.md`
- `docs/specs/usr-build-tooling-integration-contract.md`
- `docs/specs/usr-change-management-contract.md`
- `docs/specs/usr-component-lifecycle-contract.md`
- `docs/specs/usr-concurrency-and-async-semantics-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-contract-drift-check-contract.md`
- `docs/specs/usr-cross-parser-differential-contract.md`
- `docs/specs/usr-data-classification-contract.md`
- `docs/specs/usr-determinism-and-reproducibility-contract.md`
- `docs/specs/usr-diagnostic-catalog.md`
- `docs/specs/usr-diagnostics-lifecycle-contract.md`
- `docs/specs/usr-doc-lifecycle-policy.md`
- `docs/specs/usr-doc-style-guide.md`
- `docs/specs/usr-documentation-quality-contract.md`
- `docs/specs/usr-embedded-language-matrix.md`
- `docs/specs/usr-embedding-bridge-contract.md`
- `docs/specs/usr-error-handling-semantics-contract.md`
- `docs/specs/usr-evidence-catalog.md`
- `docs/specs/usr-failure-injection-and-resilience-contract.md`
- `docs/specs/usr-feature-flag-catalog.md`
- `docs/specs/usr-fixture-governance-contract.md`
- `docs/specs/usr-framework-interactions.md`
- `docs/specs/usr-framework-macro-transform-contract.md`
- `docs/specs/usr-framework-profile-catalog.md`
- `docs/specs/usr-fuzzing-and-property-testing-contract.md`
- `docs/specs/usr-gate-evaluation-algorithm.md`
- `docs/specs/usr-generated-provenance-contract.md`
- `docs/specs/usr-generics-and-polymorphism-contract.md`
- `docs/specs/usr-glossary.md`
- `docs/specs/usr-golden-diff-and-triage-contract.md`
- `docs/specs/usr-identity-stability-contract.md`
- `docs/specs/usr-implementation-playbook.md`
- `docs/specs/usr-implementation-readiness-contract.md`
- `docs/specs/usr-incremental-indexing-contract.md`
- `docs/specs/usr-lane-policy-catalog.md`
- `docs/specs/usr-language-feature-coverage-contract.md`
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-language-risk-contract.md`
- `docs/specs/usr-license-and-third-party-attribution-contract.md`
- `docs/specs/usr-module-system-contract.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-observability-and-slo-contract.md`
- `docs/specs/usr-open-questions.md`
- `docs/specs/usr-operational-runbook-contract.md`
- `docs/specs/usr-ownership-and-raci-contract.md`
- `docs/specs/usr-packaging-and-artifact-layout-contract.md`
- `docs/specs/usr-parser-adapter-sdk-contract.md`
- `docs/specs/usr-performance-benchmark-contract.md`
- `docs/specs/usr-preprocessor-and-conditional-compilation-contract.md`
- `docs/specs/usr-quality-evaluation-contract.md`
- `docs/specs/usr-query-semantics-contract.md`
- `docs/specs/usr-reason-code-catalog.md`
- `docs/specs/usr-registry-schema-contract.md`
- `docs/specs/usr-regression-budget-contract.md`
- `docs/specs/usr-release-train-contract.md`
- `docs/specs/usr-resolution-and-linking-contract.md`
- `docs/specs/usr-resource-and-capacity-contract.md`
- `docs/specs/usr-rfc-template.md`
- `docs/specs/usr-risk-register.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-routing-normalization-contract.md`
- `docs/specs/usr-runtime-config-contract.md`
- `docs/specs/usr-schema-artifact-catalog.md`
- `docs/specs/usr-schema-evolution-and-versioning-contract.md`
- `docs/specs/usr-security-and-data-governance-contract.md`
- `docs/specs/usr-ssr-csr-hydration-contract.md`
- `docs/specs/usr-state-management-integration-contract.md`
- `docs/specs/usr-styling-and-css-semantics-contract.md`
- `docs/specs/usr-supply-chain-integrity-contract.md`
- `docs/specs/usr-template-expression-binding-contract.md`
- `docs/specs/usr-test-data-generation-contract.md`
- `docs/specs/usr-threat-model-and-abuse-case-contract.md`
- `docs/specs/usr-threat-response-playbook-catalog.md`
- `docs/specs/usr-traceability-index.md`
- `docs/specs/usr-transforms-stage-map.md`
- `docs/specs/usr-type-system-normalization-contract.md`
- `docs/specs/usr-validation-cli-contract.md`
- `docs/specs/usr-waiver-and-exception-contract.md`
- `docs/specs/usr-waiver-request-template.md`

Per-language contracts:

- `docs/specs/usr/languages/README.md`

Per-framework contracts:

- `docs/specs/usr/frameworks/README.md`

Governance:

- `docs/specs/unified-syntax-representation.md` remains the umbrella contract.
- Child contracts in this directory are normative decompositions and MUST stay semantically aligned with the umbrella contract.

Update workflow:

1. update child contracts in this directory
2. update umbrella USR spec references and impacted sections
3. update machine-readable matrix/schema files when contract keys change
4. update roadmap traceability links and required gates
5. run decomposed-contract drift checks and attach evidence artifact links
6. update per-language contracts impacted by changed keys or conformance rules

Drift enforcement expectations:

- evidence artifact schemas under `docs/schemas/usr/*.json` MUST remain synchronized with `docs/specs/usr-schema-artifact-catalog.md` and `docs/specs/usr-evidence-catalog.md`
- testing policy docs under `docs/testing/usr-*.md` MUST remain synchronized with conformance, fixture, and lane policy contracts
- operational workflow guides under `docs/guides/usr-*.md` MUST remain synchronized with rollout, ownership, and operational contracts

- every contract file with prefix `usr-` under `docs/specs/` MUST be represented in roadmap traceability (`TES_LAYN_ROADMAP.md` Appendix H)
- machine-readable matrix files referenced by child contracts MUST exist in Phase 1 registry inventory
- machine-readable matrix files MUST be regenerable via `tools/usr/generate-usr-matrix-baselines.mjs`
- language version/embedding policy matrices MUST stay key-synchronized with `usr-language-profiles.json`
- parser/runtime lock matrix MUST stay synchronized with parser sources referenced by profiles and mappings
- SLO/alert and redaction/security matrices MUST stay synchronized with blocking gate policies in roadmap and CI
- report envelope and row schemas MUST stay synchronized with section 30 required report outputs
- runtime config policy matrix MUST stay synchronized with rollout/strict-mode and feature-flag contract semantics
- failure-injection and fixture-governance matrices MUST stay synchronized with failure-mode and conformance fixture coverage requirements
- benchmark policy matrix MUST stay synchronized with SLO budgets and benchmark regression gates
- threat-model matrix MUST stay synchronized with security gates, redaction classes, and abuse-case fixture coverage
- waiver policy matrix MUST stay synchronized with rollout gates, scorecard policy, and expiry enforcement checks
- quality-gate policy matrix MUST stay synchronized with labeled fixture sets and quality regression reporting
- operational-readiness policy matrix MUST stay synchronized with rollout runbooks, drill artifacts, and escalation roles
- expanded contract suite MUST stay synchronized with `TES_LAYN_ROADMAP.md` Appendix H traceability and Appendix J dependency graph
- hard-block vs advisory classification for contract gates MUST stay synchronized with `TES_LAYN_ROADMAP.md` Appendix L
- required evidence artifacts for active contracts MUST stay synchronized with `docs/specs/usr-evidence-catalog.md`




