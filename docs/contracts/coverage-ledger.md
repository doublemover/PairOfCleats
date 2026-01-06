# Entrypoint coverage ledger

| Entrypoint | Contract | Content-asserting tests | Gaps/notes |
| --- | --- | --- | --- |
| `build_index.js` | `docs/contracts/indexing.md` | `tests/core-api.js`, `tests/fixture-smoke.js`, `tests/build-index-all.js`, `tests/extracted-prose.js` | - |
| `tools/build-embeddings.js` | `docs/contracts/indexing.md` | `tests/build-embeddings-cache.js`, `tests/embeddings-validate.js`, `tests/embeddings-dims-mismatch.js` | - |
| `tools/build-sqlite-index.js` | `docs/contracts/sqlite.md` | `tests/sqlite-incremental.js`, `tests/sqlite-build-indexes.js`, `tests/sqlite-ann-extension.js`, `tests/sqlite-ann-fallback.js` | - |
| `search.js` | `docs/contracts/search-cli.md` | `tests/search-help.js`, `tests/search-filters.js`, `tests/search-explain.js`, `tests/search-rrf.js`, `tests/search-symbol-boost.js` | - |
| `search.js --backend sqlite` | `docs/contracts/sqlite.md` | `tests/sqlite-auto-backend.js`, `tests/sqlite-missing-dep.js` | - |
| `bin/pairofcleats.js` | `docs/contracts/search-cli.md` | `tests/cli.js` | - |
| `tools/api-server.js` | `docs/contracts/api-mcp.md` | `tests/api-server.js`, `tests/api-server-stream.js` | - |
| `tools/mcp-server.js` | `docs/contracts/api-mcp.md` | `tests/mcp-server.js` | - |
| `tools/indexer-service.js` | `docs/contracts/indexing.md` | `tests/indexer-service.js`, `tests/service-queue.js`, `tests/two-stage-state.js` | - |
| `tools/index-validate.js` | `docs/contracts/indexing.md` | `tests/index-validate.js`, `tests/embeddings-dims-mismatch.js` | - |
| `tools/ctags-ingest.js` | `docs/contracts/indexing.md` | `tests/ctags-ingest.js` | - |
| `tools/lsif-ingest.js` | `docs/contracts/indexing.md` | `tests/lsif-ingest.js` | - |
| `tools/scip-ingest.js` | `docs/contracts/indexing.md` | `tests/scip-ingest.js` | - |
| `tools/gtags-ingest.js` | `docs/contracts/indexing.md` | `tests/gtags-ingest.js` | - |
| `tools/download-dicts.js` | `docs/contracts/indexing.md` | `tests/download-dicts.js` | - |
| `tools/download-extensions.js` | `docs/contracts/sqlite.md` | `tests/download-extensions.js` | - |
| `tools/bench-language-repos.js` | `docs/contracts/retrieval-ranking.md` | `tests/bench.js` (harness only) | Gap: long-running benchmarks are not asserted in CI. |
