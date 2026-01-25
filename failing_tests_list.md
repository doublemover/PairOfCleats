# Currently Failing Tests

These are the tests that are currently failing and still need fixes.

- [ ] services/mcp/tool-search-defaults-and-filters.test (exit 1)
  - Logs (latest run): `baseline risk MCP search returned no results` (from `tests/.logs/run-1769300131446-2bbk8h/services_mcp_tool-search-defaults-and-filters_test.attempt-1.log`).
  - Purpose: Ensure MCP search defaults to compact JSON payloads and risk/type filters change results.
  - Attempts:
    - Set `PAIROFCLEATS_TESTING=1` when spawning MCP servers via `tests/helpers/mcp-client.js`.
    - Align MCP server cache root with test-runner suffix (`PAIROFCLEATS_TEST_CACHE_SUFFIX`) so the server uses the same cache root as `ensureFixtureIndex`.
    - Disable sqlite + embeddings for this test via `PAIROFCLEATS_TEST_CONFIG` to reduce build time.
    - Manual rerun (`node tests/services/mcp/tool-search-defaults-and-filters.test.js`) rebuilt indexes and ran long; process terminated after >90s without completing (needs a successful rerun to confirm pass/fail after fixes).
    - Manual rerun after watch fixes: saw full index build for ~51 files (code/prose/extracted-prose), then started a second build (24 files) and stalled with no output for ~20s; process terminated to avoid hanging.
