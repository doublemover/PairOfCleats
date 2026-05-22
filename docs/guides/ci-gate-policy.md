# CI Gate Policy

Status: Active guide v1.1
Last audited: 2026-05-21

## Purpose

Define required and advisory CI jobs and enforce a single blocking policy for release and merge readiness.

## Job classes

- `required`: must pass before merge/release.
- `advisory`: informative only; does not block.

## Required jobs

1. CI `gate` job: lint, config budget, env usage guardrail, generated-surface freshness, command-surface audit, and the `gate` lane.
2. CI platform jobs: `ubuntu`, `windows`, and `macos`, each running `node tools/ci/run-suite.js --mode ci --skip-prechecks` under Node 24.13.0.
3. CI TUI job: Rust formatting, check, test, and clippy for the Rust TUI package.
4. CI Long job: `node tools/ci/run-suite.js --mode ci --lane ci-long` under Node 24.13.0.
5. Required targeted suites for touched areas, using `node tests/run.js '<selector>' --lane=all --timeout-ms 30000`.
6. Deterministic release-check, release-surface verification, release bundle, trust-material, and readiness-gate jobs on release candidates.
7. Contract/docs drift checks, generated-surface freshness, USR technical contract guards, and release evidence shape checks.

## Advisory jobs

1. Extended perf/benchmark runs.
2. Long-horizon stress/nightly reliability jobs.
3. Optional integration experiments.

## Failure handling

- `infra_flake`: rerun once with linked incident note.
- `product_regression`: must be fixed or reverted before merge.
- `toolchain_missing`: fix environment/tooling policy and rerun.

## Enforcement

1. Required-job summary must include every required job name.
2. Missing required-job entries are treated as failures.
3. Required job set changes must be updated in:
   - this document
   - `docs/guides/release-matrix.md`
   - workflow files
   - any summary checker config
4. Release readiness is decided by required technical checks and evidence shape validation, not by the archived USR approval-lock process.

## Related docs

- `docs/guides/release-matrix.md`
- `.github/workflows/ci.yml`
- `.github/workflows/ci-long.yml`
- `.github/workflows/release.yml`
- `.github/workflows/nightly.yml`
