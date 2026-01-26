# Test Runner Entrypoint -- Interface Sketch

## Context / problem
The current developer experience for running tests is dominated by a very large `package.json` scripts surface that mostly expands to `node tests/<file>.js`. In this repo, **204** top-level scripts live directly under `tests/*.js` (plus many more under `tests/**`). This causes:

- **Discovery overhead:** developers search for "the right script name" instead of selecting a test intent (unit/integration/services/etc.).
- **Poor triage:** many "tests" are actually *suites* that cover multiple domains; a single failure gives little guidance.
- **Inconsistent invocation:** tests accept flags ad-hoc (some use `createCli`, some do manual parsing), and skipping behavior differs per file.

This document specifies a **single, stable test entrypoint** and its interface, so the project can collapse many scripts into a few entrypoints without losing capability.

## Goals

1. Provide one canonical entrypoint to run tests locally and in CI.
2. Support **lanes** (curated groups) and **selectors** (run a subset quickly).
3. Preserve existing tests as-is (at first): the runner can execute the existing `tests/*.js` scripts.
4. Make failures easier to interpret: stable output, deterministic ordering, and clear summaries.
5. Support CI needs: retries, timeouts, logging, and optionally machine-readable output.

## Non-goals

- Rewriting the entire test suite to a new framework in the first pass.
- Changing test semantics. The runner orchestrates; tests remain authoritative.

## Entrypoint names

Canonical entrypoints:

- `pairofcleats test ...` (CLI subcommand)
- `node tests/run.js ...` (repo-local runner)
- `npm test` (wired to `node tests/run.js`)

The docs below describe behavior independent of the concrete executable name.

## Command synopsis

```text
pairofcleats test [selectors...] [options] [-- <pass-through args>]
```

- **selectors**: one or more strings used to select tests (by id/path/name). If omitted, the default lane is executed (typically `ci`).
- `--` terminates runner flags; anything after is passed to selected tests.

## Options

### Selection

- `--lane <name>[,<name>...]`
  - Runs the tests belonging to one or more curated lanes.
  - Default: `ci`

- `--tag <tag>` (repeatable)
  - Include only tests carrying one of these tags.

- `--exclude-tag <tag>` (repeatable)
  - Exclude tests carrying one of these tags.

- `--match <pattern>` (repeatable)
  - Include tests whose id/path matches the pattern.
  - Pattern forms:
    - Substring (case-insensitive): `sqlite`
    - Regex literal: `/sqlite-(incremental|cache)/`

- `--exclude <pattern>` (repeatable)
  - Exclude tests matching the pattern.

- `--list`
  - Print the resolved test list and exit (no execution).

### Execution controls

- `--jobs <n>`
  - Maximum parallelism.
  - Default: 1 initially (many tests share caches/ports); can move to >1 once isolation improves.

- `--retries <n>`
  - Retries for a failing test.
  - Default: 0 locally, 1-2 in CI.

- `--timeout-ms <n>`
  - Hard timeout per test process.
  - Default: 120000 (align with existing long-running tests).
  - On timeout, the runner terminates the entire process tree (SIGTERM then SIGKILL, or `taskkill` on Windows).

- `--fail-fast`
  - Stop on first failure.

### Output / reporting

- `--quiet`
  - Minimal output: only failures + final summary.

- `--json`
  - Emit machine-readable summary to stdout.

- `--junit <path>`
  - Write JUnit XML output for CI systems.

- `--log-dir <path>`
  - Directory where per-test stdout/stderr are persisted.
  - Mirrors the existing `PAIROFCLEATS_TEST_LOG_DIR` convention used by some tests.
  - Each run writes to a unique subdirectory: `<log-dir>/run-<id>/`.

- `--timings-file <path>`
  - Write a JSON summary of per-test durations for later analysis.

### Environment normalization (runner responsibility)

The runner should set or normalize a small set of env vars (unless explicitly overridden):

- `PAIROFCLEATS_TEST_TIMEOUT_MS` (mirrors `--timeout-ms`)
- `PAIROFCLEATS_TEST_LOG_DIR` (mirrors `--log-dir`)
- `PAIROFCLEATS_TEST_RETRIES` (mirrors `--retries`)
- `PAIROFCLEATS_TEST_LOG_DIR` is set to the resolved run-specific log directory.

The runner **must not** globally force cache roots or embeddings provider; many tests already manage `PAIROFCLEATS_CACHE_ROOT` internally.

## Discovery model

The runner needs a stable way to know "what tests exist." Two compatible approaches:

### A) Convention-based discovery (recommended initially)

- Discover tests as executable Node scripts under `tests/`, e.g. `tests/*.js`, excluding:
  - `tests/fixtures/**`
  - `tests/**/helpers/**` (if created)
  - Orchestrators that are not leaf tests (`tests/all.js`, `tests/run.js`, `tests/script-coverage.js`)
  - Internal helpers under `tests/script-coverage/**`

Test **id** is the relative path from `tests/` without extension, e.g. `storage/sqlite/incremental/file-manifest-updates.test`.

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

Lanes are the main lever for "few comprehensive entrypoints." Proposed lane set:

- `smoke`
  - Fast, high-signal checks.
  - Example contents: `tests/smoke.js`, plus a small set of fast contract tests.

- `unit`
  - Pure logic tests, no indexing, no servers, no external binaries.

- `integration`
  - Index build + search + storage tests; moderate runtime.

- `services`
  - API/MCP server tests and stream/protocol tests.

- `storage`
  - SQLite/LMDB/index artifact consistency and migration behavior.

- `perf`
  - Benchmarks and performance guardrails. Not part of default CI unless explicitly enabled.

- `ci`
  - Default lane.
  - Composition: `unit + integration + services` minus `perf` and minus any explicitly flaky/slow tests.

## Exit codes

- `0`: all selected tests passed
- `1`: one or more selected tests failed
- `2`: runner usage error (bad flags, unknown lane)
- `77`: test skipped (use `tests/helpers/skip.js` for standard behavior)

## Output format (human)

Runner should print:

1. A preamble showing lane(s), filters, and resolved count.
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
pairofcleats test mcp --lane services

# List what would run
pairofcleats test --lane integration --list

# Pass through args to leaf tests (only if the leaf test supports them)
pairofcleats test perf/bench/run.test -- --limit 10
```

## Migration plan (runner adoption)

1. **Introduce runner (no test moves required):** runner discovers and executes existing `tests/*.js` scripts.
2. **Define lanes:** start with a small explicit map for `smoke`, `services`, `storage`, `perf`; default everything else to `integration`.
3. **Split monolith tests (see companion document):** convert the biggest multi-domain suites into multiple smaller tests.
4. **Optional:** move to a manifest-based system to stabilize ids and lane membership.

