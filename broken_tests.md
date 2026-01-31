# Broken Tests

All reported failures are resolved as of 2026-01-31.

## Resolution log

### truth-table
- Attempt 1 (failed): truth table validator reported missing Config line for optional deps policy.
- Fix: added Config line to optional dependency policy in `docs/testing/truth-table.md`.
- Attempt 2 (passed): `node tests/truth-table.js`.

### watch-attempts / watch-shutdown / watch-e2e-promotion / watch-atomicity / promotion-safety
- Attempt 1 (failed): tests importing `applyTestEnv` errored because it was not exported.
- Fix: export `applyTestEnv` from `tests/helpers/test-env.js`.
- Attempt 2 (passed):
  - `node tests/watch-attempts.js`
  - `node tests/promotion-safety.js`
  - `node tests/watch-shutdown.js`
  - `node tests/watch-e2e-promotion.js`
  - `node tests/watch-atomicity.js`

### encoding-fallback / repo-root / retrieval filters
- Attempt 1 (failed): search CLI crashed on missing `dense_vectors_lancedb` manifest entry.
- Fix: treat missing/invalid lancedb manifest entries as unavailable in `src/retrieval/cli/load-indexes.js`.
- Attempt 2 (passed):
  - `node tests/encoding-fallback.js`
  - `node tests/repo-root.js`
  - `node tests/retrieval/filters/file-and-token/file-selector-case.test.js`
  - `node tests/retrieval/filters/file-and-token/punctuation-tokenization.test.js`

### core-api
- Attempt 1 (failed): missing pieces manifest during LanceDB attachment for extracted-prose.
- Fix 1: treat missing/invalid manifests as LanceDB-unavailable in `src/retrieval/cli/load-indexes.js`.
- Attempt 2 (failed): compatibilityKey mismatch between code and extracted-prose build roots.
- Fix 2: skip extracted-prose comment joins when extracted-prose is optional and compatibility mismatches.
- Attempt 3 (passed): `node tests/core-api.js`.
