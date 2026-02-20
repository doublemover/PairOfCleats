# CI Gate Policy

Status: Draft v1.0  
Last updated: 2026-02-20T00:00:00Z

## Purpose

Define required and advisory CI jobs and enforce a single blocking policy for release and merge readiness.

## Job classes

- `required`: must pass before merge/release.
- `advisory`: informative only; does not block.

## Required jobs

1. `ci-lite` lane.
2. `ci` lane.
3. Required targeted suites for touched areas.
4. Deterministic release-check on release candidates.
5. Contract/docs drift checks.

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
   - workflow files
   - any summary checker config

## Related docs

- `docs/guides/release-matrix.md`
- `.github/workflows/ci.yml`
- `.github/workflows/ci-long.yml`
- `.github/workflows/nightly.yml`
