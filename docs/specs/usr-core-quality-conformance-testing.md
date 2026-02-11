# Spec -- USR Core Quality, Conformance, and Testing Contract

Status: Draft v2.0
Last updated: 2026-02-11T07:40:00Z

## Purpose

Define C0-C4 conformance levels, fixture governance, quality thresholds, and deterministic test evidence policy.

## Consolidated source coverage

This contract absorbs:

- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-fixture-governance-contract.md`
- `docs/specs/usr-quality-evaluation-contract.md`
- `docs/specs/usr-cross-parser-differential-contract.md`
- `docs/specs/usr-fuzzing-and-property-testing-contract.md`
- `docs/specs/usr-golden-diff-and-triage-contract.md`
- `docs/specs/usr-test-data-generation-contract.md`
- `docs/testing/usr-fixture-minimums.md`
- `docs/testing/usr-fixture-taxonomy.md`
- `docs/testing/usr-flaky-test-policy.md`
- `docs/testing/usr-golden-update-policy.md`
- `docs/testing/usr-regression-triage-playbook.md`
- `docs/testing/usr-test-runtime-budget-policy.md`
- `docs/specs/usr-documentation-quality-contract.md`

## Conformance levels

- `C0`: schema/envelope correctness and deterministic serialization
- `C1`: identity and normalization correctness
- `C2`: linking/resolution/query correctness
- `C3`: risk/security behavior correctness
- `C4`: framework route/template/style/hydration correctness

Each language/framework profile must explicitly declare required target class.

## Required fixture families

- parser normalization fixtures
- identity/linking fixtures
- embedded-language bridge fixtures
- framework route/template/style fixtures
- risk source/sink/sanitizer fixtures
- compatibility matrix fixtures
- failure-injection fixtures

## Golden policy

- golden updates must be explicit, attributable, and reviewed
- deterministic reruns must produce stable outputs for unchanged inputs
- diff triage must classify expected, regression, or unknown drift

## Differential/fuzzing policy

Differential tests must compare parser/tooling outputs for consistency classes.

Fuzzing/property tests must run on schedule by lane with triage artifacts.

## Flake policy

- tests exceeding runtime budget are triaged and either optimized or lane-moved
- flaky tests require issue linkage and owner assignment
- recurring flake threshold breaches can block release lanes

## Required outputs

- `usr-conformance-summary.json`
- `usr-quality-evaluation-results.json`
- `usr-determinism-rerun-diff.json`
- `usr-differential-drift-report.json`
- `usr-fuzzing-summary.json`
- `usr-fixture-governance-report.json`

## References

- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-rollout-release-migration.md`
