# Command Surface

PairOfCleats uses the `pairofcleats` CLI as the primary interface. `npm run <script>`
wrappers remain available for CI and convenience, but the documentation below
uses the CLI names for consistency.

## Core
- `pairofcleats setup` (guided install/config flow)
- `pairofcleats bootstrap` (fast bootstrap, no prompts)
- `pairofcleats build-index`
- `pairofcleats watch-index`
- `pairofcleats search`
- `pairofcleats status`
- `pairofcleats index-validate`

## SQLite
- `pairofcleats build-sqlite-index`
- `pairofcleats compact-sqlite-index`
- `pairofcleats search-sqlite`

## Tooling + assets
- `pairofcleats download-dicts`
- `pairofcleats download-models`
- `pairofcleats download-extensions`
- `pairofcleats verify-extensions`
- `pairofcleats generate-repo-dict`
- `pairofcleats tooling-detect`
- `pairofcleats tooling-install`

## Symbol ingests + structural
- `pairofcleats ctags-ingest`
- `pairofcleats scip-ingest`
- `pairofcleats lsif-ingest`
- `pairofcleats gtags-ingest`
- `pairofcleats structural-search`

## Services + reports
- `pairofcleats server`
- `pairofcleats indexer-service`
- `pairofcleats mcp-server`
- `pairofcleats repometrics-dashboard`
- `pairofcleats compare-models`
- `pairofcleats summary-report`
- `pairofcleats eval-run`

## Benchmarks
- `pairofcleats bench-language`
- `pairofcleats bench-language-matrix`

## Maintenance
- `pairofcleats cache-gc`
- `pairofcleats clean-artifacts`
- `pairofcleats report-artifacts`
- `pairofcleats uninstall`

## Tests
- `npm run test-all` / `npm run test-all-no-bench`
- `npm run verify`
- `npm run script-coverage-test`

For the full list of test scripts, see `package.json` or run `npm run`.
