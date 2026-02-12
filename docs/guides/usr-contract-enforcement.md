# USR Contract Enforcement Guide

Last updated: 2026-02-12T09:55:00Z

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
- required `docs/schemas/usr/*.json` files exist for blocking evidence artifacts
- cross-registry invariants are enforced
- minimum-slice harness (`tests/lang/contracts/usr-minimum-slice-harness.test.js`) validates executable TypeScript+Vue slice contracts
- language contract template enforcement (`tests/lang/contracts/usr-language-contract-template.test.js`) validates per-language contract structure and matrix linkage
- canonical example bundle enforcement (`tests/lang/contracts/usr-canonical-example-validation.test.js`) validates section 34.11 fixture checklist and cross-entity coherence
- framework canonicalization fixture enforcement (`tests/lang/contracts/usr-framework-canonicalization.test.js`) validates section 35 canonical attrs plus framework edge-case checklist coverage
- embedding bridge fixture enforcement (`tests/lang/contracts/usr-embedding-bridge-validation.test.js`) validates bridge-case matrix coverage, bridge metadata fields, and section 38 bridge edge obligations
- generated provenance fixture enforcement (`tests/lang/contracts/usr-generated-provenance-validation.test.js`) validates section 39 generated/macro/transpile provenance mapping expectations and diagnostics
- implementation readiness enforcement (`tests/lang/contracts/usr-implementation-readiness-validation.test.js`) validates section 40 operational-readiness policy invariants, evidence-schema coverage, and promotion blocker logic
- runtime config and feature-flag enforcement (`tests/lang/contracts/usr-runtime-config-feature-flag-validation.test.js`) validates section 43 precedence resolution, strict-mode policy behavior, and disallowed feature-flag conflicts
- failure-injection enforcement (`tests/lang/contracts/usr-failure-injection-validation.test.js`) validates section 44 strict/non-strict scenario outcomes, required diagnostics/reason codes, and recovery-evidence coverage
- fixture-governance enforcement (`tests/lang/contracts/usr-fixture-governance-validation.test.js`) validates section 45 owner/reviewer/mutation-policy controls for blocking fixture families
- benchmark-policy enforcement (`tests/lang/contracts/usr-benchmark-policy-validation.test.js`) validates section 46 methodology controls, lane/SLO alignment, and blocking regression thresholds
- threat-model coverage enforcement (`tests/lang/contracts/usr-threat-model-coverage-validation.test.js`) validates section 47 threat/control/fixture mappings and control-gap detection for critical threats
- waiver-policy enforcement (`tests/lang/contracts/usr-waiver-policy-validation.test.js`) validates section 48 expiry controls, approver governance, compensating-control artifact coverage, and disallowed strict-bypass classes
- report-envelope enforcement (`tests/lang/contracts/usr-report-envelope-validation.test.js`) validates section 30 required audit envelope fields and strict unknown-key rejection across required report artifacts

3. Roadmap/spec alignment
- `TES_LAYN_ROADMAP.md` contract references resolve
- roadmap phase gates reference current core contracts and evidence outputs

## CI lanes

- `ci-lite`: reference drift and schema shape checks (includes USR schema/matrix and language-contract harness checks)
- `ci`: blocking validators, conformance checks, and gate evaluation (includes full USR contract enforcement suite)
- `ci-long`: expanded compatibility matrix, drill checks, and stress/failure scenarios
- `conformance-c0`: focused C0 baseline harness coverage (`tests/conformance-c0/conformance-c0-validation.test.js`)
- `conformance-c1`: focused C1 baseline contract enforcement (`tests/conformance-c1/conformance-c1-validation.test.js`)
- `conformance-c2`: focused C2 embedded/provenance semantic coverage (`tests/conformance-c2/conformance-c2-validation.test.js`)
- `conformance-c3`: focused C3 failure/risk/fixture governance coverage (`tests/conformance-c3/conformance-c3-validation.test.js`)
- `conformance-c4`: focused C4 framework-profile conformance coverage (`tests/conformance-c4/conformance-c4-validation.test.js`)
- `backcompat`: focused section 36 compatibility matrix contract coverage (`tests/backcompat/backcompat-matrix-validation.test.js`)
- `diagnostics-summary`: focused diagnostic taxonomy strictness and capability-transition reporting checks (`tests/diagnostics/diagnostics-transition-validation.test.js`)
- `runtime-config`: focused section 43 runtime config and feature-flag conflict enforcement (`tests/runtime-config/runtime-config-validation.test.js`)
- `failure-injection`: focused section 44 strict/non-strict failure scenario enforcement (`tests/failure-injection/failure-injection-validation.test.js`)
- `fixture-governance`: focused section 45 owner/reviewer/mutation-policy enforcement (`tests/fixture-governance/fixture-governance-validation.test.js`)
- `benchmark-regression`: focused section 46 benchmark methodology and threshold enforcement (`tests/benchmark-regression/benchmark-regression-validation.test.js`)
- `threat-model`: focused section 47 threat/control/fixture coverage enforcement (`tests/threat-model/threat-model-validation.test.js`)
- `waiver-enforcement`: focused waiver-policy expiry/bypass governance checks (`tests/waiver-enforcement/waiver-policy-governance.test.js`)
- `report-schema`: focused section 30/31/43/44/45/46/47/48 report-envelope/audit artifact validation (`tests/report-schema/report-schema-audit-contracts.test.js`)

## Failure protocol

1. classify as blocking or advisory
2. attach failing contract IDs and artifact IDs
3. assign owner and due date
4. require waiver metadata for advisory carry-forward

## PR requirements

- list modified contracts and matrix/schema artifacts
- include validation outputs and failed/passed gate summary
- update roadmap and consolidation matrix when contract ownership changes
