# Broken Tests

- services/mcp/tool-search-defaults-and-filters.test (hangs for minutes; suspected stuck rebuild)
  - Command attempted: `node --import ./tests/helpers/test-env.js tests/services/mcp/tool-search-defaults-and-filters.test.js`
  - Behavior: rebuild loop for fixtures; no output progress for minutes
  - Rebuilds both fixtures (sample + languages) via `ensureFixtureIndex`
  - `current.json` exists in cache roots; index_state compat keys match
  - Manual prebuilds succeed but test still re-runs build step
  - Likely stuck in compatibility detection or cache root mismatch
