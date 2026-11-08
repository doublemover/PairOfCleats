# CI Capability Policy

This policy defines how optional capabilities are handled by the test runner (`node tests/run.js`).

## CI (ci-lite lane)

The required `ubuntu`, `windows` and `macos` checks each own a separate OS cohort
group through `.github/workflows/ci-platform.yml`. After the common gate, the OS
preparation job freezes one source/runtime-bound test plan. Four correctness jobs
partition the original CI-lite selection; compiler/build, API, runtime budgets,
ANN generation, native lifecycle, USR, LSP shutdown and crash-log checks run as
independent serial jobs. Windows subprocess ownership has its own Windows-only
job. SDK delivery, actual provider qualification and the core API integration
that requires installed language servers stay in the tooling job. Portable API
authorization, search and runtime-evidence contracts use the separate API job.

Every job restores dependency inputs and verifies current native/patch readiness;
the OS preparation job alone may populate the dependency cache. Fixture caches,
logs and artifacts remain isolated per job. Matrix fail-fast is disabled so one
failure does not cancel unrelated evidence. Every fixture has a30-second bound,
zero retries and native-status redo disabled. Correctness jobs use two workers;
serial jobs use one worker and one indexing thread.
Windows preparation and authority jobs select a unique physical directory under
the runner-owned temporary root. This keeps transient vaults outside repository
trees and gives the job owner their cleanup; original operation limits remain.
Native Windows jobs use that same temporary-root owner. Native-search inputs use
compact physical private roots; original build, terminal, source and PID evidence
is retained under `.testLogs/**/native-search-*/` even if preparation fails.
Completed inputs are removed only after their original native owners close.
Tooling provisions a fresh standalone clangd through the existing official stable
release, SHA256, target-header and executable-version owners. Its exact SDK receipt
is retained, and the core API fixture still requires successful normal provider
preflight and real protocol requests. Ambient OS launchers do not supply this SDK.
CI authenticates only the exact vendor release-metadata endpoint with its existing
read-only `GITHUB_TOKEN`, following [GitHub's CI authentication guidance](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
The transport removes authorization on asset/redirect requests, and the setup
process removes the token before extraction or SDK children can inherit it.
HTTP403 still fails after its original response closes; it never triggers a retry
or an anonymous fallback. Product downloads remain anonymous by default.

The final OS job requires every declared cohort and original test/step assignment.
Missing/foreign reports, unexpected skips, retries, timeouts, duplicate cases or
failed/cancelled jobs fail acceptance. Only the runner's explicitly planned tag
exclusions and the exact platform/optional cases below may be reported skipped.
Runtime exclusions must execute once, return77 and retain the exact reason.
Original overlapping selections retain their
separate owners; correctness partitioning introduces no additional duplicates.
Existing native-terminal, physical-authority and Rust jobs remain independent.

Each shard retains its own profiles, stability records, JUnit and raw failures.
Aggregation combines test outcomes, JUnit and exact V8 range keys using the same
OR/union as unsharded collection; adding summarized range counts would change
coverage. Compact range receipts avoid transferring raw V8 directories. The
existing coverage-policy owner evaluates the merged coverage, and release keeps
the `ci-quality-artifacts-<os>` artifact names. Original cohort evidence remains
under `.diagnostics/cohorts/` and `.testLogs/cohorts/`.
Full crash-log latency samples are written there before threshold assertions;
runner stdout limits cannot truncate the retained operation timings.

| Existing runtime exclusion | Applies on | Coverage owner |
| --- | --- | --- |
| `smoke/tantivy` | All three | Experimental native qualification deferred under #1627 |
| `shared/subprocess/tracked-leak-fails-process` | Windows | Windows process-ownership cohort; actual POSIX injection runs on Linux/macOS |
| `cli/general/signal-cleanup` | Windows | Windows native terminal/lifetime jobs; POSIX signal checks run on Linux/macOS |
| `tooling/index/clean-artifacts-multi-repository/windows-locked-reader` | Linux/macOS | Actual Windows sharing case; portable cleanup cases run on all three |

Scheduling measurements are optional hints only. A frozen plan balances known
per-OS durations, uses equal costs on the first run and retains lane order inside
each shard. Subsequent jobs consume that exact plan instead of reading changing
timing caches independently. Measurements never admit readiness or omit tests.

The ANN rebuild regression now has independent memory, SQLite and automatic-ANN
cases. Each starts from a fresh canonical Stage1/SQLite generation, executes the
same original native writer fault and retains every identity, byte-retention,
availability and positive-query assertion. The setup uses the production API;
the compiler/build cohort owns actual Stage1 CLI coverage. Every complete case
keeps its original30-second limit. Phase receipts retain child commands, raw
statuses and output instead of hiding progress until the aggregate completes.

The CI and nightly plan contracts also run as separate complete cases, preserving
all actual CLI selections and ownership checks inside the30-second bound.
The bakeoff resume controller has separate publication, query-policy and held-input
cases, retaining all checkpoint, receipt, counter and input-refusal assertions.
Nightly script-plan dispatch and complete ownership checks run separately; every
distinct original CLI selection still executes in a fresh child, with at most
three read-only selection processes at once. Throughput family and comparison
controls likewise retain every text/JSON/CSV invocation in bounded cases.

- Required: `node tests/run.js --lane ci-lite` using `tests/ci-lite/ci-lite.order.txt`.
- The runner ignores `tests/run.config.jsonc` excludes for `ci-lite`, so the order file must list only core tests.
- Optional capability tests that are included must self-skip with exit code 77 (use `tests/helpers/skip.js`) and print a reason.
- Missing optional capabilities must not fail CI.

## Nightly or extended runs (ci / ci-long lanes)
- `--lane ci` uses `tests/ci/ci.order.txt` when it is the only lane and applies `tests/run.config.jsonc` excludes unless overridden.
- `--lane ci-long` auto-includes the `long` tag; when it is the only lane, it requires `tests/ci-long/ci-long.order.txt`.
- Optional capability tests should be tagged (for example: `sqlite`, `lmdb`, `embeddings`, `bench`) and self-skip when dependencies are missing.

## Reporting
- The runner writes per-test logs under `.testLogs/run-<epoch>-<rand>/` by default (override with `--log-dir` or `PAIROFCLEATS_TEST_LOG_DIR`).
- Use `--json` or `--junit <path>` for machine-readable summaries.
- Use `--timings-file <path>` for versioned timings ledgers.
- Use `--watchdog-ms <n>` to enforce global inactivity shutdown when jobs hang without output or completion.
- Use `--coverage[=<path>]` and `--profile[=<path>]` for deterministic coverage/profile artifacts when CI lanes require them.
