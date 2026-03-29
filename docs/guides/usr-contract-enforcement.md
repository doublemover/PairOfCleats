# USR Contract Enforcement Guide

Last updated: 2026-03-29

## Purpose

Define the current enforcement model for PairOfCleats unified syntax representation work without pinning the guide to hundreds of per-file validator names that change as the suite is consolidated.

## Canonical docs

These documents are the current source of truth for USR scope and rollout expectations:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr/README.md`
- `docs/specs/usr-consolidation-coverage-matrix.md`
- `docs/language/onboarding-playbook.md`

## Current enforcement surfaces

USR enforcement is now anchored to stable contract families rather than one leaf test per checklist item.

### Language contract suites

- `tests/lang/contracts/language-fixture-contracts.test.js`
- `tests/lang/fixtures-sample/metadata-matrix.test.js`
- `tests/lang/registry/registry-contract-matrix.test.js`
- `tests/lang/javascript/javascript-contract-matrix.test.js`
- `tests/lang/typescript/typescript-contract-matrix.test.js`
- `tests/lang/python/python-contract-matrix.test.js`

### Indexing and identity seams that USR depends on

- `tests/indexing/identity/contract-matrix.test.js`
- `tests/indexer/signatures/contract-matrix.test.js`
- `tests/indexer/metav2/contract-matrix.test.js`
- `tests/indexer/incremental/contract-matrix.test.js`

### Runtime and lane governance

- `tests/runner/consolidation-ownership.test.js`
- `tests/runner/lane-evidence.test.js`
- `tests/runner/suite-taxonomy-report.test.js`
- `tests/runner/diagnostics-governance.test.js`

## Required checks

When USR contracts change, verify all of the following:

1. The canonical docs above still describe the active rollout and coverage model.
2. The language contract suites still cover every supported language/profile family.
3. Identity, signature, and metav2 contract matrices still pass, since USR consumers depend on those invariants.
4. Lane evidence and ownership reports still map the surviving contract suites into runnable CI coverage.

## CI lanes

- `ci-lite`: fast contract and regression coverage
- `ci`: broader functional and integration coverage
- `ci-long`: long-running stress, replay, and heavyweight integration coverage
- `gate`: blocking contract and governance enforcement

## Failure protocol

1. Classify the failure as blocking contract drift, integration regression, or governance drift.
2. Record the affected doc/spec and contract family.
3. Update the relevant matrix or contract suite in the same change as the behavior update.
4. If the guide or spec becomes stale again, update it to the surviving suite family instead of reintroducing leaf-test inventories here.

## PR requirements

- List the USR-facing docs/specs touched.
- List the contract families exercised.
- Include the relevant lane or direct test output for the changed contract families.
