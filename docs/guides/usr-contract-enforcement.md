# USR Contract Enforcement Guide

Last updated: 2026-02-12T06:46:23Z

## Purpose

Define CI/local enforcement for the consolidated USR contract model.

## Required scope checks

1. Contract set integrity
- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr/README.md`
- all `docs/specs/usr-core-*.md`
- `docs/specs/usr-consolidation-coverage-matrix.md`

2. Matrix/schema integrity
- required `tests/lang/matrix/usr-*.json` files exist and validate
- full matrix schema coverage is enforced for every registry under `tests/lang/matrix` via `listUsrMatrixRegistryIds()` / `validateUsrMatrixRegistry(...)`
- required `docs/schemas/usr/*.json` files exist for blocking evidence artifacts
- cross-registry invariants are enforced
- minimum-slice harness (`tests/lang/contracts/usr-minimum-slice-harness.test.js`) validates executable TypeScript+Vue slice contracts
- framework contract template enforcement (`tests/lang/contracts/usr-framework-contract-template-validation.test.js`) validates framework deep-dive template governance, approval checklist controls, and completion-evidence artifact requirements
- framework contract freshness and rotation enforcement (`tests/lang/contracts/usr-framework-contract-freshness-validation.test.js`) validates owner-role alignment to governance policy, review cadence freshness, and explicit ownership rotation metadata
- language contract template enforcement (`tests/lang/contracts/usr-language-contract-template.test.js`) validates per-language contract structure, matrix linkage, approval checklist controls, and completion-evidence artifact coverage
- language contract matrix-sync enforcement (`tests/lang/contracts/usr-language-contract-matrix-sync-validation.test.js`) validates exact-set equality between per-language contract conformance/framework/node/edge declarations and `usr-language-profiles.json`, plus blocking fixture-ID mapping parity against `usr-fixture-governance.json`
- parser/runtime lock reproducibility enforcement (`tests/lang/contracts/usr-parser-runtime-lock-reproducibility-validation.test.js`) validates deterministic parser-lock ordering, referenced parser-source coverage, and lock upgrade-budget invariants
- language contract freshness and rotation enforcement (`tests/lang/contracts/usr-language-contract-freshness-validation.test.js`) validates owner-role alignment to governance policy, review cadence freshness, and explicit ownership rotation metadata
- canonical example bundle enforcement (`tests/lang/contracts/usr-canonical-example-validation.test.js`) validates section 34.11 fixture checklist and cross-entity coherence
- framework canonicalization fixture enforcement (`tests/lang/contracts/usr-framework-canonicalization.test.js`) validates section 35 canonical attrs plus framework edge-case checklist coverage
- framework contract matrix-sync enforcement (`tests/lang/contracts/usr-framework-contract-matrix-sync-validation.test.js`) validates framework contract appliesTo/edge-case/conformance and blocking fixture evidence parity against framework profile and fixture-governance registries
- framework profile matrix-sync enforcement (`tests/lang/contracts/usr-framework-profile-matrix-sync-validation.test.js`) validates framework applicability, edge-case linkage, and route/hydration/binding semantic coherence across framework registries
- embedding bridge fixture enforcement (`tests/lang/contracts/usr-embedding-bridge-validation.test.js`) validates bridge-case matrix coverage, bridge metadata fields, and section 38 bridge edge obligations
- generated provenance fixture enforcement (`tests/lang/contracts/usr-generated-provenance-validation.test.js`) validates section 39 generated/macro/transpile provenance mapping expectations and diagnostics
- bridge/provenance dashboard enforcement (`tests/lang/contracts/usr-bridge-provenance-dashboard-validation.test.js`) validates section 15.2 coverage dashboard emission for embedded-language bridge and generated-provenance fixtures
- language batch shard enforcement (`tests/lang/contracts/usr-language-batch-shards-validation.test.js`) validates section 4/phase-10 batch partition coverage, deterministic language assignment, and lane manifest path consistency
- matrix-driven harness coverage enforcement (`tests/lang/contracts/usr-matrix-driven-harness-validation.test.js`) validates profile-wide lane/fixture/batch coverage for every language and framework profile
- core artifact-schema catalog alignment enforcement (`tests/lang/contracts/usr-core-artifact-schema-catalog-alignment.test.js`) validates mandatory-key tables in `docs/specs/usr-core-artifact-schema-catalog.md` against active matrix schema-required keys
- blocking evidence schema catalog enforcement (`tests/lang/contracts/usr-blocking-evidence-schema-catalog-validation.test.js`) validates blocking evidence artifact rows in `docs/specs/usr-core-artifact-schema-catalog.md` against active report schema registry and required-audit artifact set
- change-tier policy enforcement (`tests/lang/contracts/usr-change-tier-policy-validation.test.js`) validates Tier 1/2/3 workflow, reviewer threshold requirements, and Tier 2/3 update obligations in governance docs and PR template policy markers
- extension policy enforcement (`tests/lang/contracts/usr-extension-policy-validation.test.js`) validates section 29 namespaced-extension constraints, canonical override prohibitions, deterministic extension requirements, and schema-confusion gate linkage
- F.5 hard-requirements enforcement (`tests/lang/contracts/usr-f5-hard-requirements-validation.test.js`) validates sections 33-36 anchors, CI execution hooks, and backcompat matrix/report coverage constraints
- F.6 synchronization enforcement (`tests/lang/contracts/usr-f6-sync-requirements-validation.test.js`) validates decomposed contract sync requirements across language/framework/risk/schema/readiness/ops governance controls
- rollout/migration policy enforcement (`tests/lang/contracts/usr-rollout-migration-policy-validation.test.js`) validates rollout phase gates, runtime rollout flags, readiness-phase coverage, CI hook coverage, and rollout-approval lock contract linkage
- rollout phase-gate enforcement (`tests/lang/contracts/usr-rollout-phase-gate-validation.test.js`) validates A/B/C/D roadmap phase mapping, legacy-output retention policy, and rollout/deprecation CI execution hooks
- rollout Appendix F.1 checklist lock enforcement (`tests/lang/contracts/usr-rollout-f1-checklist-validation.test.js`) validates strict A->B->C->D promotion ordering and readiness/Gate C checklist preconditions for Phase C and Phase D completion lines
- phase 9 readiness authorization lock enforcement (`tests/lang/contracts/usr-phase9-readiness-authorization-lock-validation.test.js`) validates readiness/test-rollout checklist gating against Phase 9.1/9.2 completion state and Gate B1-B8 regression behavior
- Gate B1-B7 language-batch completion lock enforcement (`tests/lang/contracts/usr-gate-b-language-batch-lock-validation.test.js`) validates batch-gate checklist state against Appendix C completion state, Phase 8/11 exit criteria dependencies, and diagnostic enforcement lane requirements
- rollout approval-lock enforcement (`tests/lang/contracts/usr-rollout-approval-lock-validation.test.js`) validates rollout approval lock metadata, required role decision rows, and checklist-state gating for readiness and rollout authorization lines
- Gate C prerequisite lock enforcement (`tests/lang/contracts/usr-gate-c-prereq-lock-validation.test.js`) enforces roadmap-state ordering so rollout authorization cannot be checked before prior gate checklist completion
- archival/deprecation policy enforcement (`tests/lang/contracts/usr-archival-deprecation-policy-validation.test.js`) validates required DEPRECATED header metadata for archived USR specs and CI policy hook coverage
- report schema file coverage enforcement (`tests/lang/contracts/usr-report-schema-file-coverage-validation.test.js`) validates one-to-one coverage between registered USR report validators and `docs/schemas/usr/*.schema.json` files
- doc schema contract enforcement (`tests/lang/contracts/usr-doc-schema-contract-validation.test.js`) validates envelope composition, artifactId const mapping, required payload fields, and strict unknown-key rejection across doc schemas
- traceability approval lock enforcement (`tests/lang/contracts/usr-traceability-approval-validation.test.js`) validates phase 0.3 closure requirements against approved consolidation-traceability metadata and roadmap appendix N.7 lock policy
- C0/C1 baseline conformance enforcement (`tests/lang/contracts/usr-c0-baseline-validation.test.js`, `tests/lang/contracts/usr-c1-baseline-validation.test.js`) validates C0/C1 required/blocking level coverage for all language profiles and report generation
- C2/C3 deep-profile conformance enforcement (`tests/lang/contracts/usr-c2-baseline-validation.test.js`, `tests/lang/contracts/usr-c3-baseline-validation.test.js`) validates C2/C3 required/blocking level coverage for eligible language profiles and report generation
- language risk-profile conformance enforcement (`tests/lang/contracts/usr-language-risk-profile-validation.test.js`) validates machine-readable risk source/sink/sanitizer taxonomy coverage and interprocedural gating invariants
- C4 framework-profile conformance enforcement (`tests/lang/contracts/usr-c4-baseline-validation.test.js`) validates C4 required/blocking level coverage for framework-required language profiles and report generation
- conformance dashboard enforcement (`tests/lang/contracts/usr-conformance-dashboard-validation.test.js`) validates section 15.2 language/framework conformance dashboard emission and summary-report schema invariants
- diagnostic remediation-routing enforcement (`tests/lang/contracts/usr-diagnostic-remediation-routing-validation.test.js`) validates strict diagnostic taxonomy routing to section 33.4 remediation classes
- cross-language canonical bundle coherence enforcement (`tests/lang/contracts/usr-cross-language-canonical-bundle-coherence-validation.test.js`) validates multi-language canonical example bundle coverage and coherent cross-language relation edges for Appendix B8 bundle checks
- implementation readiness enforcement (`tests/lang/contracts/usr-implementation-readiness-validation.test.js`) validates section 40 operational-readiness and quality-gate schema invariants, evidence-schema coverage, promotion blockers for C0/C1 rollout, C2/C3 deep conformance, and C4 framework conformance readiness, and report emission for `usr-operational-readiness-validation` / `usr-release-readiness-scorecard`
- conformance matrix readiness-by-language enforcement (`tests/lang/contracts/usr-conformance-matrix-readiness-by-language-validation.test.js`) validates per-language conformance-row completeness, level parity with language profiles, blocking-level parity, and required fixture-family/lane readiness invariants
- Gate A registry readiness enforcement (`tests/lang/contracts/usr-gate-a-registry-readiness-validation.test.js`) validates required Gate A matrix registries/schema coverage, language-version/embedding key synchronization, strict diagnostic/reason-code taxonomy validation hooks, and CI drift/contract validator anchors
- harness-lane materialization enforcement (`tests/lang/contracts/usr-harness-lane-materialization-validation.test.js`) validates contract-lane to harness-lane mappings (`lang-*` -> runnable lanes), required lane presence in `tests/run.rules.jsonc`, and CI lane order materialization files
- phase-9 readiness evidence enforcement (`tests/lang/contracts/usr-phase9-readiness-evidence-validation.test.js`) validates checked readiness controls against CI validator coverage and required artifact/report schema/catalog references
- observability rollup enforcement (`tests/lang/contracts/usr-observability-rollup-validation.test.js`) validates section 41 SLO budget and alert-policy evaluations, blocking-threshold behavior, deterministic per-batch hotspot reporting, and `usr-observability-rollup` report emission
- batch SLO threshold coverage enforcement (`tests/lang/contracts/usr-batch-slo-threshold-coverage-validation.test.js`) validates per-batch (`B1`-`B7`) runtime/memory threshold coverage and blocking lane policy invariants in `usr-slo-budgets.json`
- phase-8 hardening readiness enforcement (`tests/lang/contracts/usr-phase8-hardening-readiness-validation.test.js`) validates deterministic matrix ordering/serialization invariants, cap-trigger diagnostic/remediation expectations, and blocking SLO coverage for required lanes
- security-gate compliance enforcement (`tests/lang/contracts/usr-security-gate-validation.test.js`) validates section 42 security-gate and redaction policy controls, strict fail-closed behavior for blocking controls, and validation-report emission
- runtime config and feature-flag enforcement (`tests/lang/contracts/usr-runtime-config-feature-flag-validation.test.js`) validates section 43 precedence resolution, strict-mode policy behavior, and disallowed feature-flag conflicts
- failure-injection enforcement (`tests/lang/contracts/usr-failure-injection-validation.test.js`) validates section 44 strict/non-strict scenario outcomes, required diagnostics/reason codes, and recovery-evidence coverage
- failure-injection recovery-threshold enforcement (`tests/lang/contracts/usr-failure-injection-recovery-threshold-validation.test.js`) validates rollback trigger thresholds, required recovery artifacts, and rollback-drill evidence coverage for blocking fault classes
- failure-mode suite enforcement (`tests/lang/contracts/usr-failure-mode-suite-validation.test.js`) validates phase 14.2 parser-recovery, schema-mismatch, partial-extraction, redaction fail-safe, and strict security gate fail-closed invariants across failure-injection/security/threat matrices
- mixed-repo integration enforcement (`tests/lang/contracts/usr-mixed-repo-integration-validation.test.js`) validates phase 14.1 cross-language/cross-framework fixture coverage and route/template/API/data boundary fixture families for blocking mixed-repo integration scenarios
- fixture-governance enforcement (`tests/lang/contracts/usr-fixture-governance-validation.test.js`) validates section 45 owner/reviewer/mutation-policy controls, blocking-row ownership/reviewer assignment constraints, and roadmap linkage tags (`appendix-c:*`, `appendix-d:*`) for blocking fixture families
- fixture mutation-policy coverage enforcement (`tests/lang/contracts/usr-fixture-mutation-policy-coverage-validation.test.js`) validates full policy-class coverage (`require-rfc`, `require-review`, `allow-generated-refresh`) and baseline/non-blocking policy safety constraints
- fixture-governance coverage-floor enforcement (`tests/lang/contracts/usr-fixture-governance-coverage-floor-validation.test.js`) validates blocking fixture coverage for every language/framework profile, required conformance levels, semantic family expectations, and roadmap task-pack linkage coverage
- fixture/golden readiness enforcement (`tests/lang/contracts/usr-fixture-golden-readiness-validation.test.js`) validates exhaustive blocking fixture evidence per language/framework profile and deterministic serialization hashes for canonical/framework/embedding/provenance golden bundles
- benchmark-policy enforcement (`tests/lang/contracts/usr-benchmark-policy-validation.test.js`) validates section 46 methodology controls, lane/SLO alignment, and blocking regression thresholds
- cross-batch regression-resolution enforcement (`tests/lang/contracts/usr-cross-batch-regression-resolution-validation.test.js`) validates B8 integration shard regression expectations, mixed-repo/language-batch benchmark readiness, and baseline benchmark regression pass criteria
- threat-model coverage enforcement (`tests/lang/contracts/usr-threat-model-coverage-validation.test.js`) validates section 47 threat/control/fixture mappings and control-gap detection for critical threats
- waiver-policy enforcement (`tests/lang/contracts/usr-waiver-policy-validation.test.js`) validates section 48 expiry controls, approver governance, compensating-control artifact coverage, and disallowed strict-bypass classes
- report-envelope enforcement (`tests/lang/contracts/usr-report-envelope-validation.test.js`) validates section 30 required audit envelope fields and strict unknown-key rejection across required report artifacts
- PR/release template policy enforcement (`tests/lang/contracts/usr-pr-template-policy-validation.test.js`) validates required USR change-control checklist markers and contract/matrix references in `.github/pull_request_template.md` and `.github/release_template.md`, including waiver expiry-cadence release review
- maintenance-controls stability enforcement (`tests/lang/contracts/usr-maintenance-controls-stability.test.js`) validates phase 15.3 closure, required maintenance validators in `ci`/`ci-lite`, and template-governance marker presence
- onboarding policy enforcement (`tests/lang/contracts/usr-onboarding-policy-validation.test.js`) validates new-language onboarding and framework-interop requirements in `docs/guides/usr-new-language-onboarding.md`

3. Roadmap/spec alignment
- `TES_LAYN_ROADMAP.md` contract references resolve
- roadmap phase gates reference current core contracts and evidence outputs

## CI lanes

- `ci-lite`: reference drift and schema shape checks (includes USR schema/matrix, language-contract harness checks, and `decomposed-drift/decomposed-drift-validation`)
- `ci`: blocking validators, conformance checks, and gate evaluation (includes full USR contract enforcement suite plus Gate A/B1-B8/C shard checks via `batch-b0..batch-b8`, `conformance-c0..conformance-c4`, `backcompat`, `harness-core`, and `decomposed-drift`)
- `ci-long`: expanded compatibility matrix, drill checks, and stress/failure scenarios
- `conformance-c0`: focused C0 baseline harness coverage (`tests/conformance-c0/conformance-c0-validation.test.js`) including language-wide C0 matrix validation
- `conformance-c1`: focused C1 baseline contract enforcement (`tests/conformance-c1/conformance-c1-validation.test.js`) including language-wide C1 matrix validation
- `conformance-c2`: focused C2 embedded/provenance semantic coverage (`tests/conformance-c2/conformance-c2-validation.test.js`) including language-wide C2 eligibility matrix validation
- `conformance-c3`: focused C3 failure/risk/fixture governance coverage (`tests/conformance-c3/conformance-c3-validation.test.js`) including language-wide C3 eligibility matrix validation and risk-profile taxonomy/gating validation
- `conformance-c4`: focused C4 framework-profile conformance coverage (`tests/conformance-c4/conformance-c4-validation.test.js`) including language-wide C4 eligibility matrix validation
- `backcompat`: focused section 36 compatibility matrix contract coverage (`tests/backcompat/backcompat-matrix-validation.test.js`)
- `diagnostics-summary`: focused diagnostic taxonomy strictness and capability-transition reporting checks (`tests/diagnostics/diagnostics-transition-validation.test.js`)
- `runtime-config`: focused section 43 runtime config and feature-flag conflict enforcement (`tests/runtime-config/runtime-config-validation.test.js`)
- `failure-injection`: focused section 44 strict/non-strict failure scenario enforcement (`tests/failure-injection/failure-injection-validation.test.js`)
- `fixture-governance`: focused section 45 owner/reviewer/mutation-policy enforcement (`tests/fixture-governance/fixture-governance-validation.test.js`)
- `benchmark-regression`: focused section 46 benchmark methodology and threshold enforcement (`tests/benchmark-regression/benchmark-regression-validation.test.js`)
- `threat-model`: focused section 47 threat/control/fixture coverage enforcement (`tests/threat-model/threat-model-validation.test.js`)
- `waiver-enforcement`: focused waiver-policy expiry/bypass governance checks (`tests/waiver-enforcement/waiver-policy-governance.test.js`)
- `report-schema`: focused section 30/31/43/44/45/46/47/48 report-envelope/audit artifact validation (`tests/report-schema/report-schema-audit-contracts.test.js`)
- `implementation-readiness`: focused section 40 operational-readiness policy, quality-gate, conformance-promotion, and readiness-scorecard enforcement (`tests/implementation-readiness/implementation-readiness-validation.test.js`)
- `observability`: focused section 41 SLO budget and alert-policy rollup enforcement (`tests/observability/observability-rollup-validation.test.js`)
- `security-gates`: focused section 42 security-gate and redaction-policy compliance enforcement (`tests/security-gates/security-gates-validation.test.js`)
- `harness-core`: focused section 6.7/8.5/12.3 harness checks for canonical IDs, edge endpoints, capability transitions, strict diagnostic/reason validation, and section 33.4 remediation routing (`tests/harness-core/harness-core-validation.test.js`)
- `canonical-example`: focused section 34 canonical-example fixture bundle validation (`tests/canonical-example/canonical-example-validation.test.js`)
- `decomposed-drift`: focused decomposed-contract drift and roadmap alignment validation (`tests/decomposed-drift/decomposed-drift-validation.test.js`)
- `batch-b0`: focused foundation shard validation and deterministic order manifest checks (`tests/batch-b0/batch-b0-validation.test.js`)
- `batch-b1`: focused JS/TS shard validation and deterministic order manifest checks (`tests/batch-b1/batch-b1-validation.test.js`)
- `batch-b2`: focused systems-language shard validation and deterministic order manifest checks (`tests/batch-b2/batch-b2-validation.test.js`)
- `batch-b3`: focused managed-language shard validation and deterministic order manifest checks (`tests/batch-b3/batch-b3-validation.test.js`)
- `batch-b4`: focused dynamic-language shard validation and deterministic order manifest checks (`tests/batch-b4/batch-b4-validation.test.js`)
- `batch-b5`: focused markup/style/template shard validation and deterministic order manifest checks (`tests/batch-b5/batch-b5-validation.test.js`)
- `batch-b6`: focused data/interface DSL shard validation and deterministic order manifest checks (`tests/batch-b6/batch-b6-validation.test.js`)
- `batch-b7`: focused build/infra DSL shard validation and deterministic order manifest checks (`tests/batch-b7/batch-b7-validation.test.js`)
- `batch-b8`: focused cross-batch integration shard validation and deterministic order manifest checks (`tests/batch-b8/batch-b8-validation.test.js`)

## Failure protocol

1. classify as blocking or advisory
2. attach failing contract IDs and artifact IDs
3. assign owner and due date
4. require waiver metadata for advisory carry-forward

## PR requirements

- list modified contracts and matrix/schema artifacts
- include validation outputs and failed/passed gate summary
- update roadmap and consolidation matrix when contract ownership changes
