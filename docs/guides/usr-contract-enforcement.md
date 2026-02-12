# USR Contract Enforcement Guide

Last updated: 2026-02-12T03:15:00Z

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

3. Roadmap/spec alignment
- `TES_LAYN_ROADMAP.md` contract references resolve
- roadmap phase gates reference current core contracts and evidence outputs

## CI lanes

- `ci-lite`: reference drift and schema shape checks
- `ci`: blocking validators, conformance checks, and gate evaluation
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
