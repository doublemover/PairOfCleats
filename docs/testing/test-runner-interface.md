# Test Runner Entrypoint -- Interface Sketch

## Context / problem
Historically the test surface was flat and dominated by many one-off scripts under `tests/*.js`. The suite now lives under subsystem folders with `*.test.js` files, but the same discovery and triage issues remain without a stable runner entrypoint. This causes:

- **Discovery overhead:** developers search for "the right script name" instead of selecting a test intent (unit/integration/services/etc.).
- **Poor triage:** many "tests" are actually *suites* that cover multiple domains; a single failure gives little guidance.
- **Inconsistent invocation:** tests accept flags ad-hoc (some use `createCli`, some do manual parsing), and skipping behavior differs per file.

This document specifies a **single, stable test entrypoint** and its interface, so the project can collapse many scripts into a few entrypoints without losing capability.

## Goals

1. Provide one canonical entrypoint to run tests locally and in CI.
2. Support **lanes** (curated groups) and **selectors** (run a subset quickly).
3. Preserve existing tests as-is (at first): the runner can execute existing `tests/**/*.test.js` scripts.
4. Make failures easier to interpret: stable output, deterministic ordering, and clear summaries.
5. Support CI needs: retries, timeouts, logging, and optionally machine-readable output.

## Non-goals

- Rewriting the entire test suite to a new framework in the first pass.
- Changing test semantics. The runner orchestrates; tests remain authoritative.

## Entrypoint names

Canonical entrypoints:

- `pairofcleats test ...` (CLI subcommand)
- `node tests/run.js ...` (repo-local runner)

The docs below describe behavior independent of the concrete executable name.

## Command synopsis

```text
pairofcleats test [selectors...] [options] [-- <pass-through args>]
```

- **selectors**: one or more match strings (same rules as `--match`) applied to test ids and paths. If omitted, the default lane is executed (`ci`).
- `--` terminates runner flags; anything after is passed to selected tests.

## Options

### Selection

- `--lane <name>[,<name>...]`
  - Runs tests in one or more lanes (comma-separated or repeatable).
  - Special values: `all`, `<lane>-with-destructive`, `all-with-destructive`.
  - `<lane>-with-destructive` removes the `destructive` tag from config excludes for the run.
  - Default: `ci`

- `--tag <tag>` (repeatable or comma-separated)
  - Include only tests carrying one of these tags.

- `--exclude-tag <tag>` (repeatable or comma-separated)
  - Exclude tests carrying one of these tags.

- `--match <pattern>` (repeatable or comma-separated)
  - Include tests whose id/path matches the pattern.
  - Pattern forms:
    - Substring (case-insensitive): `sqlite`
    - Regex literal: `/sqlite-(incremental|cache)/`
  - Invalid or unsafe regex literals exit with code 2.

- `--exclude <pattern>` (repeatable or comma-separated)
  - Exclude tests matching the pattern.

- `--list`
  - Print the resolved test list and exit (no execution). With `--json`, emit structured output.
- `--list-lanes`
  - Print known lanes and exit. With `--json`, emit structured output.
- `--list-tags`
  - Print known tags and exit. With `--json`, emit structured output.
- `--config <path>`
  - Override `tests/run.config.jsonc` (exclude tags, lane-specific excludes, timeout overrides).
  - Config excludes are ignored for `--lane ci-lite`, `--lane all`, and `--lane all-with-destructive`.

### Execution controls

- `--jobs <n>`
  - Maximum parallelism.
  - Default: physical core count (see `resolvePhysicalCores` in `tests/runner/run-helpers.js`).

- `--retries <n>`
  - Retries for a failing test.
  - Default: 0 locally, 1 when `CI` is set.

- `--timeout-ms <n>`
  - Hard timeout per test process.
  - Default: 30000, with lane overrides:
    - `ci-lite`: 15000
    - `ci`: 90000
    - `ci-long`: 240000
  - When multiple lanes are requested, the runner picks the longest matching default.
  - On timeout, the runner terminates the entire process tree (SIGTERM then SIGKILL, or `taskkill` on Windows).
- `--allow-timeouts`
  - Do not fail the run when a test times out.
- `--node-options "<flags>"`
  - Extra `NODE_OPTIONS` passed to child test processes.
- `--max-old-space-mb <n>`
  - Inject `--max-old-space-size` into `NODE_OPTIONS`.
- `--pairofcleats-threads <n>`
  - Overrides `PAIROFCLEATS_THREADS` for child processes.

- `--fail-fast`
  - Stop on first failure.

### Output / reporting

- `--no-color`
  - Disable colored output (also disabled when `NO_COLOR` is set or `--json` is used).
- `--quiet`
  - Minimal output: only failures + final summary.

- `--json`
  - Emit machine-readable summary to stdout.

- `--junit <path>`
  - Write JUnit XML output for CI systems.

- `--log-dir <path>`
  - Root directory where per-test stdout/stderr are persisted (default: `.testLogs`).
  - Each run writes to `<log-dir>/run-<epoch>-<rand>/` and updates `.testLogs/latest`.
  - Log files are named `<sanitized-id>.attempt-<n>.log` (slashes become `_`).
- `--log-times[=<path>]`
  - Write a per-test timing list (`<ms>\t<id>`) to `.testLogs/<lane>-testRunTimes.txt` by default.
  - If a path is provided, write there instead.
  - When multiple lanes are selected, the default filename uses `multi`.

- `--timings-file <path>`
  - Write a JSON summary of per-test durations for later analysis (`runId`, `totalMs`, `tests`).

### Environment normalization (runner responsibility)

The runner sets or normalizes these env vars for child tests:

- `PAIROFCLEATS_TESTING=1`
- `PAIROFCLEATS_CACHE_ROOT` defaults to `.testCache` if unset.
- `PAIROFCLEATS_TEST_TIMEOUT_MS` is set to the resolved timeout unless already set and no CLI override is provided.
- `PAIROFCLEATS_TEST_RETRIES` is set to the resolved retry count unless already set and no CLI override is provided.
- `PAIROFCLEATS_TEST_LOG_DIR` is set to the run-specific log dir when `--log-dir` is provided or the env var was previously unset.
- `PAIROFCLEATS_THREADS` is set from `--pairofcleats-threads` or `PAIROFCLEATS_TEST_THREADS`.
- `PAIROFCLEATS_TEST_CACHE_SUFFIX` defaults to a sanitized test id per test if unset.

The runner injects `tests/helpers/test-env.js` via `NODE_OPTIONS` and merges in `--node-options` / `--max-old-space-size`.

## Discovery model

The runner needs a stable way to know "what tests exist." Two compatible approaches:

### A) Convention-based discovery (recommended initially)

- Discover tests as executable Node scripts under `tests/`, e.g. `tests/**/*.test.js`, excluding dirs/files from `tests/run.rules.jsonc`:
  - `tests/fixtures/**`
  - `tests/helpers/**`
  - `.testLogs`, `.testCache`, `.logs`, `.cache`, `.worktrees`, `worktree`, `worktrees`
  - `tests/run.js`

Test **id** is the relative path from `tests/` without `.test.js`, e.g. `storage/sqlite/incremental/file-manifest-updates`.

### B) Manifest-based discovery (recommended long-term)

Maintain `tests/manifest.json` (or `tests/manifest.js`) containing metadata per test:

```json
{
  "tests": [
    {"id": "storage/sqlite/incremental/file-manifest-updates.test", "path": "tests/storage/sqlite/incremental/file-manifest-updates.test.js", "tags": ["sqlite","integration"]}
  ]
}
```

Benefits:
- Eliminates heuristics.
- Supports stable ids even after refactors.
- Allows lane membership to be defined explicitly.

## Lanes

Lanes are the main lever for "few comprehensive entrypoints." Lane membership is derived from
`tests/run.rules.jsonc` and defaults to `integration` unless a lane rule matches. Tests listed in
`tests/ci-lite/ci-lite.order.txt` are tagged as lane `ci-lite` (overriding path-based lanes).

- `smoke`
  - Fast, high-signal checks under `tests/smoke/`.

- `unit`
  - Pure logic tests under `tests/shared/`, `tests/tooling/`, `tests/lang/`, `tests/cli/`, `tests/runner/`, `tests/indexer/`.

- `integration`
  - Default lane for everything not matched by lane rules.

- `services`
  - Service tests under `tests/services/` (excluding `services/api` and `services/mcp` which have their own lanes).

- `api`
  - API server tests under `tests/services/api/`.

- `mcp`
  - MCP server tests under `tests/services/mcp/`.

- `storage`
  - SQLite/LMDB/index artifact consistency and migration behavior under `tests/storage/`.

- `perf`
  - Benchmarks and performance guardrails under `tests/perf/`.

- `ci-lite`
  - Curated PR lane defined by `tests/ci-lite/ci-lite.order.txt` (also used to tag those tests as `ci-lite`).

- `ci`
  - Default lane when none is specified. When run as the only lane, uses `tests/ci/ci.order.txt`.

- `ci-long`
  - Long-running curated lane; auto-includes the `long` tag whenever requested. When run as the only lane, uses `tests/ci-long/ci-long.order.txt`.

Note: When `--lane ci` or `--lane ci-long` is combined with other lanes (or `--lane all`), they expand to
`unit + integration + services` for filtering; order files are only required when the lane is the sole selection.

## Lane ordering (ci/ci-lite/ci-long)

For `ci`, `ci-lite`, and `ci-long`, the runner requires an explicit order file:
`tests/<lane>/<lane>.order.txt`. Each line is a test id (relative to `tests/` without `.test.js`).

Failure semantics:
- Missing order file or an empty file: runner exits with code `2`.
- Missing test ids referenced by the file: runner exits with code `2` and prints up to 50 missing ids.
- Duplicate ids are allowed; duplicates are disambiguated by appending `#<n>` to the id in the run list.

Ordering semantics:
- `ci` and `ci-lite` preserve the order file sequence.
- `ci-long` uses the order file to define the set, then re-sorts by id (current runner behavior).

## Tag catalog (from tests/run.rules.jsonc)

Tags are assigned by path/regex rules (and always include the lane name) and can be used with `--tag/--exclude-tag`.
Current tags (in addition to lane names):
- `perf`, `bench`
- `services`, `api`, `mcp`
- `storage`, `indexing`, `retrieval`, `lang`, `tooling`, `harness`, `smoke`
- `sqlite`, `lmdb`, `jj`, `watch`, `embeddings`
- `long`, `destructive`, `DelayedUntilPhase7_8`

Refer to `tests/run.rules.jsonc` for the exact match rules.

## Exit codes

- `0`: all selected tests passed
- `1`: one or more selected tests failed
- `2`: runner usage error (bad flags, unknown lane)
- `77`: test skipped (use `tests/helpers/skip.js` for standard behavior)

`--allow-timeouts` suppresses timeouts from contributing to exit code `1`.

## Output format (human)

Runner prints:

1. A preamble showing lane(s), resolved count, and jobs (when >1).
2. Per-test status lines: `PASS <id> (<duration>)` / `FAIL <id> (<duration>)`.
3. A final summary:

```text
Summary: 132 passed, 2 failed, 4 skipped
Failures:
  - sqlite/incremental/schema-mismatch (exit 1)
  - services/mcp/search-errors (exit 1)
Logs: <log-dir>
```

## Usage examples

```bash
# Default CI lane
pairofcleats test

# Quick smoke lane
pairofcleats test --lane smoke

# Run all SQLite-related tests
pairofcleats test --match sqlite

# Run just the MCP server contract tests
pairofcleats test --lane mcp

# List what would run
pairofcleats test --lane integration --list

# Pass through args to leaf tests (only if the leaf test supports them)
pairofcleats test perf/bench/run -- --limit 10
```

## Migration plan (runner adoption)

1. **Introduce runner (no test moves required):** runner discovers and executes existing `tests/**/*.test.js` scripts.
2. **Define lanes:** start with a small explicit map for `smoke`, `services`, `storage`, `perf`; default everything else to `integration`.
3. **Split monolith tests (see companion document):** convert the biggest multi-domain suites into multiple smaller tests.
4. **Optional:** move to a manifest-based system to stabilize ids and lane membership.

