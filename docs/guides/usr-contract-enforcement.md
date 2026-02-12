# USR Contract Enforcement Guide

Last updated: 2026-02-12T06:20:00Z

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

3. Roadmap/spec alignment
- `TES_LAYN_ROADMAP.md` contract references resolve
- roadmap phase gates reference current core contracts and evidence outputs

## CI lanes

- `ci-lite`: reference drift and schema shape checks (includes USR schema/matrix and language-contract harness checks)
- `ci`: blocking validators, conformance checks, and gate evaluation (includes full USR contract enforcement suite)
- `ci-long`: expanded compatibility matrix, drill checks, and stress/failure scenarios

## Failure protocol

1. classify as blocking or advisory
2. attach failing contract IDs and artifact IDs
3. assign owner and due date
4. require waiver metadata for advisory carry-forward

## PR requirements

- list modified contracts and matrix/schema artifacts
- include validation outputs and failed/passed gate summary
- update roadmap and consolidation matrix when contract ownership changes
