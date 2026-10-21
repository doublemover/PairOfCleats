# CI Gate Policy

Status: Active guide v1.2
Last audited: 2026-10-20 (workflow contracts and read-only repository rules inspection)

## Purpose

Define separate merge and release evidence requirements. CI Long qualifies releases;
it is not a required PR check and has no ordinary PR/branch-push trigger.

## Job classes

- `required`: must pass at the candidate SHA for the stated merge or release scope.
- `advisory`: informative only; does not block.

## Required merge evidence

The required CI job names are `gate`, `ubuntu`, `windows`, `macos`, `rust-tui`
and `windows-authority`. The adaptive workflow's `policy` job must also pass when
its workflow/path filters apply. Targeted suites for touched areas remain required
local evidence; they are not invented hosted check names. An absent, cancelled,
skipped or failed required result does not establish merge readiness.

The machine-readable inventory below is checked against actual workflow jobs:

<!-- required-check-inventory -->
```json
{"mergeWorkflow":"ci.yml","mergeJobs":["gate","ubuntu","windows","macos","rust-tui","windows-authority"],"conditionalMergeWorkflow":"adaptive-policy-checks.yml","conditionalMergeJobs":["policy"],"releaseWorkflows":["CI","CI Long"]}
```

Read-only GitHub inspection on October 20 returned `Branch not protected` for
`main` and an empty repository/parent ruleset list. This guide states review
requirements; it does not claim GitHub enforces them or that a required-check
aggregate exists. No repository protection settings are changed by this repair.

The merge checks establish:

1. CI `gate` job: live dependency security audit, bootstrap/runtime contracts,
   lint, config budget, env usage guardrail, generated-surface freshness,
   command-surface audit, and the `gate` lane. The bootstrap/runtime step runs
   the dependency-security, duplicate-scanner, workflow and three postinstall
   contract tests plus the ONNX CPU install-policy check directly, without changing
   broad lane membership.
2. CI platform jobs: `ubuntu`, `windows`, and `macos`, each running `node tools/ci/run-suite.js --mode ci --skip-prechecks` under Node 26.12.1.
3. CI TUI job: Rust formatting, check, test, and clippy for the Rust TUI package.
4. Windows authority job: real symlink-capable authority cohort at the candidate SHA.
5. Targeted suites for touched areas, using `node tests/run.js --match '<selector>' --lane all --timeout-ms 30000 --retries 0`.
6. Contract/docs drift and generated-surface freshness within their owning gates.

## Required release evidence

Release readiness requires successful `CI` and `CI Long` workflows at the exact
release SHA. CI Long runs on release tags or manual dispatch; release polling
dispatches/waits for the candidate when necessary. Missing or unsuccessful
workflows fail `readiness-gate`, as do statuses for another SHA.
Deterministic release-check, surface verification, release bundle, trust
materials, USR technical evidence and target-specific packaging are also required
as specified by the [release matrix](release-matrix.md). PR CI alone cannot
substitute for these release qualifications.

See [Node runtime policy](node-runtime.md) for application and action runtimes.

## Advisory jobs

1. Extended perf/benchmark runs.
2. Long-horizon stress/nightly reliability jobs.
3. Optional integration experiments.

## Failure handling

- `infra_flake`: rerun once with linked incident note.
- `product_regression`: must be fixed or reverted before merge.
- `toolchain_missing`: fix environment/tooling policy and rerun.

## Enforcement

1. Review merge evidence using the complete inventory above at the PR head.
2. Release readiness must include both required workflows; missing entries fail.
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
