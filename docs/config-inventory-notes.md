# Config Inventory Notes

This file complements `docs/config-inventory.md` with manual analysis and ownership hints.

## Ownership map (primary modules)
- cache: `tools/dict-utils.js`, `src/shared/cache.js`, `src/shared/bench-profile.js`
- dictionary: `tools/dict-utils.js`, `src/index/build/runtime.js`, `src/index/build/tokenization.js`
- extensions: `tools/download-extensions.js`, `tools/verify-extensions.js`, `tools/vector-extension.js`
- indexing: `src/index/build/runtime.js`, `src/index/build/indexer.js`, `src/index/build/file-processor.js`
- models: `tools/dict-utils.js`, `src/shared/embedding.js`, `src/index/build/runtime.js`
- profile: `src/shared/cli.js`, `src/shared/bench-profile.js`, `tools/dict-utils.js`
- runtime: `tools/dict-utils.js`, `src/shared/cli.js`
- search: `src/retrieval/cli.js`, `src/retrieval/pipeline.js`, `src/retrieval/sqlite-helpers.js`
- sql: `src/index/build/runtime.js`, `src/lang/sql.js`
- sqlite: `src/storage/sqlite/*`, `tools/build-sqlite-index.js`, `tools/compact-sqlite-index.js`
- tooling: `tools/tooling-detect.js`, `tools/tooling-install.js`, `src/integrations/tooling/*`
- triage: `src/integrations/triage/*`, `tools/triage/*`

## Overlap candidates to consolidate (initial)
- Profiles: `PAIROFCLEATS_PROFILE`, `--profile`, and `--index-profile` overlap and need a single precedence rule.
- Embeddings: `PAIROFCLEATS_EMBEDDINGS`, `indexing.embeddings.*`, `--stub-embeddings`, and `--real-embeddings` are redundant toggles.
- Threads/concurrency: `PAIROFCLEATS_THREADS`, `indexing.concurrency`, `--threads`, per-feature concurrency fields, and worker-pool max workers overlap.
- Cache roots: `cache.root`, `PAIROFCLEATS_CACHE_ROOT`, `--cache-root`, and per-benchmark cache overrides are duplicated.
- SQLite paths: `sqlite.dbDir`, `codeDbPath`, `proseDbPath`, `--out`, and `--code-dir/--prose-dir` overlap in purpose.
- Search defaults: `search.annDefault`, `--ann/--no-ann`, `search.bm25.*`, and `--bm25-*` duplicate control surfaces.
- Watch/index toggles: `build_index.js` CLI flags vs indexing config `watch` and `incremental` semantics.

## Suspected unused or legacy knobs
- Requires targeted audit; config schema currently does not distinguish between deprecated and active keys.
- Flags and env vars in `docs/config-inventory.md` with low call-site counts are good candidates for pruning once behavior is traced.
