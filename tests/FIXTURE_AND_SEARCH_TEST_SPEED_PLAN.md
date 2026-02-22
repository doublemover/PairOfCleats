# Fixture/Search Test Speed Plan

## Scope
This plan covers:
- The original 13 slow tests from `ci-long`.
- A full scan of other tests that use the same expensive helper patterns.

Static analysis only. No tests were executed.

## Implementation Status (2026-02-22T00:00:00Z)
- Completed:
  - `ensureFixtureIndex` now supports `cacheScope: 'shared'`.
  - Added a cross-process fixture build lock.
  - Added `requiredModes` and mode-specific build invocation.
  - Added fixture health-stamp caching to skip repeated deep validations when indexes are unchanged.
  - Migrated all `ensureFixtureIndex` callsites to shared cache scope.
  - Migrated code-only tests to `requiredModes: ['code']` where safe.
  - Added `createInProcessSearchRunner` and migrated fixture filter/contract/search tests away from repeated `spawnSync(search.js)`.
  - `ensureSearchFiltersRepo` now supports shared cache scope and locking (defaults to shared).
  - Added shared cache mode to `createSearchLifecycle` and migrated all Group 3 callers.

## Root Causes
1. Per-test cache isolation forces redundant fixture builds:
   - `tests/runner/run-execution.js:107` sets `PAIROFCLEATS_TEST_CACHE_SUFFIX` to each test id.
   - `tests/helpers/fixture-index.js:45` appends that suffix to `cacheName`.
2. `ensureFixtureIndex` rebuilds full index surfaces by default:
   - Build call has no explicit mode restriction: `tests/helpers/fixture-index.js:206`.
   - Compatibility/chunkUid checks include `code + prose + extracted-prose (+ records)`: `tests/helpers/fixture-index.js:187`.
3. Search-heavy tests pay repeated process startup:
   - `runSearch` shells out via `spawnSync` for each query: `tests/helpers/fixture-index.js:285`.
4. Other helpers also force one-build-per-test:
   - `ensureSearchFiltersRepo` creates random repo/cache paths each run: `tests/helpers/search-filters-repo.js`.
   - `createSearchLifecycle` creates temp repo/cache each run: `tests/helpers/search-lifecycle.js`.

## Shared Changes (Implement Once)
1. Add shared cache mode to `ensureFixtureIndex`:
   - Option: `cacheScope: 'shared'` (ignore `PAIROFCLEATS_TEST_CACHE_SUFFIX` for selected tests).
   - Keep current isolated behavior as default.
2. Add cross-process build lock in `ensureFixtureIndex`:
   - One builder, other tests wait + reuse.
3. Add required mode support:
   - Option: `requiredModes`, and build with `build_index.js --mode code` when only code is needed.
   - Skip prose/extracted/records validation when not required.
4. Add reusable index health stamp:
   - Avoid reloading full chunk metadata on every `ensureFixtureIndex` call.
5. Add in-process search helper (or batched search helper):
   - Avoid repeated `spawnSync(search.js)` in filter/contract tests.
6. Add shared mode to `ensureSearchFiltersRepo` and `createSearchLifecycle`:
   - Stable repo/cache for test cohorts instead of random per-test roots.

## Original 13 Tests (Priority A)
- `tests/indexing/language-fixture/postings-integrity.test.js`
- `tests/indexing/language-fixture/chunk-meta-exists.test.js`
- `tests/retrieval/filters/file-selector.test.js`
- `tests/retrieval/filters/control-flow.test.js`
- `tests/retrieval/filters/behavioral.test.js`
- `tests/retrieval/filters/types.test.js`
- `tests/retrieval/filters/risk.test.js`
- `tests/lang/contracts/go.test.js`
- `tests/lang/contracts/javascript.test.js`
- `tests/lang/contracts/misc-buildfiles.test.js`
- `tests/lang/contracts/python.test.js`
- `tests/lang/contracts/sql.test.js`
- `tests/lang/contracts/typescript.test.js`

Additional targeted tweaks for this set:
- `postings-integrity`: use `codeDir` returned by `ensureFixtureIndex`; do not call `loadFixtureIndexMeta` just to resolve `codeDir`.
- `risk` and `types`: move to minimal fixtures (or at least code-only fixture builds with dedicated shared caches).

## Other Tests That Benefit

### Group 1: Other `ensureFixtureIndex` callers (30 tests)
- `tests/cli/general/risk-explain.test.js`
- `tests/cli/search/search-startup-checkpoints-order.test.js`
- `tests/indexing/artifacts/chunk-meta-trim-strict.test.js`
- `tests/indexing/artifacts/determinism-report-artifact.test.js`
- `tests/indexing/contracts/golden-surface-suite.test.js`
- `tests/indexing/fixtures/build-and-artifacts.test.js`
- `tests/indexing/fixtures/minhash-consistency.test.js`
- `tests/indexing/risk/interprocedural/artifacts-written.test.js`
- `tests/lang/fixtures-sample/python-metadata.test.js`
- `tests/lang/fixtures-sample/rust-metadata.test.js`
- `tests/lang/fixtures-sample/swift-metadata.test.js`
- `tests/retrieval/backend/cli-sqlite-sparse-preflight-allow-fallback-filtered.test.js`
- `tests/retrieval/backend/cli-sqlite-sparse-preflight-allow-fallback.test.js`
- `tests/retrieval/backend/cli-sqlite-sparse-preflight-missing-fts-fallback.test.js`
- `tests/retrieval/contracts/compact-json.test.js`
- `tests/retrieval/contracts/result-shape.test.js`
- `tests/retrieval/filters/ext-path.test.js`
- `tests/retrieval/filters/type-signature-decorator.test.js`
- `tests/retrieval/output/explain-output-includes-routing-and-fts-match.test.js`
- `tests/retrieval/pipeline/ann-lazy-import.test.js`
- `tests/retrieval/pipeline/index-loader-lazy.test.js`
- `tests/services/api/cors-allow.test.js`
- `tests/services/api/health-and-status.test.js`
- `tests/services/api/repo-authorization.test.js`
- `tests/services/api/search-happy-path.test.js`
- `tests/services/api/search-stream-abort.test.js`
- `tests/services/api/search-validation.test.js`
- `tests/services/asof-explicit-root-no-fallback.test.js`
- `tests/services/mcp/tool-search-defaults-and-filters.test.js`
- `tests/storage/sqlite/metav2-parity-with-jsonl.test.js`

### Group 2: `ensureSearchFiltersRepo` callers (8 tests)
- `tests/retrieval/filters/file-and-token/file-selector-case.test.js`
- `tests/retrieval/filters/file-and-token/punctuation-tokenization.test.js`
- `tests/retrieval/filters/file-and-token/token-case.test.js`
- `tests/retrieval/filters/git-metadata/branch.test.js`
- `tests/retrieval/filters/git-metadata/chunk-author.test.js`
- `tests/retrieval/filters/git-metadata/modified-time.test.js`
- `tests/retrieval/filters/query-syntax/negative-terms.test.js`
- `tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js`

### Group 3: `createSearchLifecycle` callers (5 tests)
- `tests/cli/search/search-contract.test.js`
- `tests/cli/search/search-determinism.test.js`
- `tests/cli/search/search-explain-symbol.test.js`
- `tests/cli/search/search-topn-filters.test.js`
- `tests/cli/search/search-windows-path-filter.test.js`

## Impact Estimate
- Group 1: High impact. Eliminates repeated fixture rebuilds and unnecessary multi-mode indexing.
- Group 2: High impact. Eliminates repeated git/bootstrap/index per test by sharing one prepared repo/cache per cohort.
- Group 3: Medium-high impact. Reuses lifecycle artifacts instead of recreating temp workspaces every test.

## Recommended Rollout Order
1. `ensureFixtureIndex` shared cache + lock + `requiredModes`.
2. Update original 13 tests to shared code-only fixture policy.
3. Apply same policy to Group 1.
4. Add shared-mode options to `ensureSearchFiltersRepo` and `createSearchLifecycle`, then migrate Groups 2 and 3.
