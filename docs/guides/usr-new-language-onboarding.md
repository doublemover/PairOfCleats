# USR New Language Onboarding Guide

Last updated: 2026-02-11T04:25:00Z

## Purpose

This guide defines the mandatory process for introducing a new language into USR coverage with deterministic, auditable behavior.

## Prerequisites

- language is added to `src/index/language-registry/registry-data.js`
- ownership is defined in `docs/specs/usr-ownership-and-raci-contract.md`
- rollout plan is aligned to `docs/specs/usr-rollout-and-migration-contract.md`

## Required specification updates

1. add language contract:
- `docs/specs/usr/languages/<language-id>.md`

2. update catalog and mapping contracts:
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-resolution-and-linking-contract.md`
- `docs/specs/usr-language-risk-contract.md`
- any relevant type/module/concurrency/error contracts

3. update roadmap:
- `TES_LAYN_ROADMAP.md` language batch tasks
- Appendix E conformance expectations
- Appendix H traceability if new contract files were introduced

## Required matrix updates

- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-language-version-policy.json`
- `tests/lang/matrix/usr-language-embedding-policy.json`
- `tests/lang/matrix/usr-capability-matrix.json`
- `tests/lang/matrix/usr-conformance-levels.json`
- additional domain matrices as required by language profile capabilities

## Required fixture families

- parser normalization fixtures
- symbol and identity fixtures
- resolution and import/reference fixtures
- risk fixtures (if C3 applies)
- framework overlay fixtures (if C4 applies)
- generated/embedding bridge fixtures where applicable

## Promotion gates

- strict schema and invariant validation green
- required conformance levels green
- blocking quality/security/performance gates green
- readiness scorecard updated with evidence links

## Rollout expectations

- start with shadow and dual-write mode where required
- measure parity against full-build baseline
- cut over only when blocking gates are green and no expired waivers exist
