# CI Gate Policy

Status: Active guide v1.6
Last audited: 2026-11-07 (checked-in workflow inventory; repository protection observation remains dated October 20)

## Purpose

Define separate merge and release evidence requirements. CI Long qualifies releases;
it is not a required PR check and has no ordinary PR/branch-push trigger.

## Job classes

- `required`: must pass at the candidate SHA for the stated merge or release scope.
- `advisory`: informative only; does not block.

## Required merge evidence

The required CI job IDs are `gate`, `ubuntu`, `windows`, `macos`, `rust-tui`,
`native-inspection`, `native-index-workflows-windows` and `windows-authority`. The adaptive workflow's `policy` job must also pass when
its workflow/path filters apply. Targeted suites for touched areas remain required
local evidence; they are not invented hosted check names. An absent, cancelled,
skipped or failed required result does not establish merge readiness.

The machine-readable inventory below is checked against actual workflow jobs:

<!-- required-check-inventory -->
```json
{"mergeWorkflow":"ci.yml","mergeJobs":["gate","ubuntu-cohorts","windows-cohorts","macos-cohorts","ubuntu","windows","macos","rust-tui","native-inspection","native-index-workflows-windows","windows-authority"],"conditionalMergeWorkflow":"adaptive-policy-checks.yml","conditionalMergeJobs":["policy"],"releaseWorkflows":["CI","CI Long"]}
```

Read-only GitHub inspection on October 20 returned `Branch not protected` for
`main` and an empty repository/parent ruleset list. This guide states review
requirements; it does not claim GitHub enforces them. The OS completion jobs
aggregate their own workflow results. No repository protection settings change.

The merge checks establish:

1. CI `gate` job: live dependency security audit, bootstrap/runtime contracts,
   lint, config budget, env usage guardrail, generated-surface freshness,
   command-surface audit, and the `gate` lane. The bootstrap/runtime step runs
   the dependency-security, duplicate-scanner, workflow and three postinstall
   contract tests plus the ONNX CPU install-policy check directly, without changing
   broad lane membership.
   The gate lane also checks the complete required-job inventory and actual
   CI/nightly cohort selection before the platform suites start.
2. Separate Ubuntu, Windows and macOS cohort workflows use the shared
   `tools/ci/run-suite.js --mode ci --skip-prechecks` recipes under Node 26.13.0.
   Each freezes its own exact plan, runs four correctness shards and independent
   serial and tooling jobs, then validates complete evidence. Stable `ubuntu`,
   `windows`, and `macos` checks require their entire OS workflow to succeed.
   SDKs and language servers are installed only in the tooling job. See
   [cohort scheduling and evidence](../testing/ci-capability-policy.md).
   In correctness and tooling jobs, `node tools/ci/provision-jj.js` admits the official stable
   Jujutsu0.46.0 archive pinned in `tools/ci/jj-recipe.js`. The shared download and
   extraction owners enforce vendor origins, exact bytes/SHA256 and bounded
   contents. It runs the original executable's version probe, records its binary
   SHA256 in `.diagnostics/jj-provisioning.json`, then publishes only its new
   runner-temporary directory to the job PATH. No machine installation or
   repository workspace creation occurs during provisioning. Actual isolated SCM
   session fixtures remain required; successful installation is not their pass.
3. CI TUI job: Rust formatting, check, test, and clippy for the Rust TUI package.
4. Native inspection matrix: serial real-terminal TUI workflows, PTY disposal,
   parser patch/lifecycle checks and produced index contracts on each supported
   workflow platform. Windows keeps49 inspection/PTY/parser/producer cases in
   one job;22 index workflows,18 native-search and seven TypeScript vendor cases
   run in the independent native-workflow job. Both retain20-minute job and
   30-second fixture bounds. A configured job is not a passing result.
5. Windows authority job: real symlink-capable authority cohort at the candidate SHA.
6. Targeted suites for touched areas, using `node tests/run.js --match '<selector>' --lane all --timeout-ms 30000 --retries 0`.
7. Contract/docs drift and generated-surface freshness within their owning gates.

The platform suite runs all19 JS/TS compiler/API export, warning-cap, parameter
and qualified-target fixtures in a
separate serial correctness cohort alongside its parallel shards. The complete case has a
30-second process limit and the public CLI keeps its five-second limit. The
retired nested 10-second setup timers did not qualify API latency. Every case retains
its ordered-lane membership and executes exactly once. Its report is retained
separately from measured runtime budgets. Serial scheduling supplies independent
qualification of these resource bounds, not a production latency claim.

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
