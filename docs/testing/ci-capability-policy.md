# CI Capability Policy

This policy defines how optional capabilities are handled by the test runner (`node tests/run.js`).

## CI (ci-lite lane)
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
