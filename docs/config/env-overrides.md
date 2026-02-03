# Env Overrides

This document lists the environment variables currently read by PairOfCleats.
Canonical sources:
- `src/shared/env.js` (runtime config + secrets)
- `src/shared/runtime-envelope.js` (process-level runtime tuning)
- `docs/config/inventory.md` (generated inventory of all `PAIROFCLEATS_*` usage)

Note: Several env vars are non-secret toggles used by dev tools, benchmarks, or
tests. They are documented here for completeness but are not part of the
public configuration contract unless explicitly called out.

## Secrets
- `PAIROFCLEATS_API_TOKEN` (bearer token for API/MCP auth when enabled)

## Runtime/config overrides (`src/shared/env.js`)
- `MCP_MODE` (alias for `PAIROFCLEATS_MCP_MODE`)
- `PAIROFCLEATS_MCP_MODE` (`legacy|sdk|auto`)
- `PAIROFCLEATS_HOME`
- `PAIROFCLEATS_CACHE_ROOT`
- `PAIROFCLEATS_EMBEDDINGS`
- `PAIROFCLEATS_WORKER_POOL`
- `PAIROFCLEATS_THREADS`
- `PAIROFCLEATS_BUNDLE_THREADS`
- `PAIROFCLEATS_WATCHER_BACKEND`
- `PAIROFCLEATS_VERBOSE`
- `PAIROFCLEATS_LOG_LEVEL`
- `PAIROFCLEATS_LOG_FORMAT`
- `PAIROFCLEATS_STAGE`
- `PAIROFCLEATS_XXHASH_BACKEND`
- `PAIROFCLEATS_DEBUG_CRASH`
- `PAIROFCLEATS_FILE_CACHE_MAX`
- `PAIROFCLEATS_SUMMARY_CACHE_MAX`
- `PAIROFCLEATS_IMPORT_GRAPH`
- `PAIROFCLEATS_DISCOVERY_STAT_CONCURRENCY`
- `PAIROFCLEATS_REGEX_ENGINE`
- `PAIROFCLEATS_COMPRESSION`
- `PAIROFCLEATS_DOC_EXTRACT`
- `PAIROFCLEATS_MCP_TRANSPORT`
- `PAIROFCLEATS_MODELS_DIR`
- `PAIROFCLEATS_DICT_DIR`
- `PAIROFCLEATS_EXTENSIONS_DIR`
- `PAIROFCLEATS_MCP_QUEUE_MAX`
- `PAIROFCLEATS_MCP_MAX_BUFFER_BYTES`
- `PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS`

## Runtime envelope overrides (`src/shared/runtime-envelope.js`)
- `PAIROFCLEATS_NODE_OPTIONS` (extra Node options appended at runtime)
- `PAIROFCLEATS_MAX_OLD_SPACE_MB`
- `PAIROFCLEATS_UV_THREADPOOL_SIZE`
- `PAIROFCLEATS_IO_OVERSUBSCRIBE`

## Tooling/bench/CI overrides (non-secret, internal)
- `PAIROFCLEATS_BENCH_RUN`
- `PAIROFCLEATS_SKIP_BENCH`
- `PAIROFCLEATS_SKIP_SCRIPT_COVERAGE`
- `PAIROFCLEATS_SKIP_SQLITE_INCREMENTAL`
- `PAIROFCLEATS_SUITE_MODE`
- `PAIROFCLEATS_UPDATE_SNAPSHOTS`
- `PAIROFCLEATS_MODEL` (bench/report tooling model selector)
- `PAIROFCLEATS_PROFILE` (legacy test fixture knob)

## Test-only overrides (require `PAIROFCLEATS_TESTING=1`)
- `PAIROFCLEATS_TESTING`
- `PAIROFCLEATS_TEST_CONFIG` (JSON object string)
- `PAIROFCLEATS_TEST_MAX_JSON_BYTES`
- `PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY`
- `PAIROFCLEATS_TEST_ALLOW_TIMEOUT_TARGET`
- `PAIROFCLEATS_TEST_CACHE_SUFFIX`
- `PAIROFCLEATS_TEST_CODE_MAP_BUDGET_MS`
- `PAIROFCLEATS_TEST_LOG_DIR`
- `PAIROFCLEATS_TEST_LOG_SILENT`
- `PAIROFCLEATS_TEST_MAX_OLD_SPACE_MB`
- `PAIROFCLEATS_TEST_MCP_DELAY_MS`
- `PAIROFCLEATS_TEST_NODE_OPTIONS`
- `PAIROFCLEATS_TEST_PID_FILE`
- `PAIROFCLEATS_TEST_RETRIES`
- `PAIROFCLEATS_TEST_TANTIVY`
- `PAIROFCLEATS_TEST_THREADS`
- `PAIROFCLEATS_TEST_TIMEOUT_MS`

## Precedence
- CLI flags override repo config where both exist.
- For runtime envelope fields, precedence is generally: CLI > config > env >
  defaults/AutoPolicy.
- Test overrides are ignored unless `PAIROFCLEATS_TESTING=1`.
