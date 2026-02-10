# Entrypoint coverage ledger

| Entrypoint | Contract | Content-asserting tests | Gaps/notes |
| --- | --- | --- | --- |
| `build_index.js` | `docs/contracts/indexing.md` | `tests/services/api/core-api.test.js`, `tests/indexing/fixtures/build-and-artifacts.test.js`, `tests/cli/build-index/build-index-all.test.js`, `tests/indexing/extracted-prose/extracted-prose.test.js` | - |
| `tools/build/embeddings.js` | `docs/contracts/indexing.md` | `tests/indexing/embeddings/build/build-embeddings-cache.test.js`, `tests/indexing/embeddings/embeddings-validate.test.js`, `tests/indexing/embeddings/embeddings-dims-mismatch.test.js` | - |
| `build_index.js --stage 4` | `docs/contracts/sqlite.md` | `tests/storage/sqlite/incremental/file-manifest-updates.test.js`, `tests/storage/sqlite/migrations/schema-mismatch-rebuild.test.js`, `tests/storage/sqlite/sqlite-build-indexes.test.js`, `tests/storage/sqlite/ann/sqlite-ann-extension.test.js`, `tests/storage/sqlite/ann/sqlite-ann-fallback.test.js` | - |
| `search.js` | `docs/contracts/search-cli.md` | `tests/cli/search/search-help.test.js`, `tests/retrieval/filters/query-syntax/negative-terms.test.js`, `tests/cli/search/search-rrf.test.js`, `tests/cli/search/search-symbol-boost.test.js` | - |
| `search.js --backend sqlite` | `docs/contracts/sqlite.md` | `tests/storage/sqlite/sqlite-auto-backend.test.js`, `tests/storage/sqlite/sqlite-missing-dep.test.js` | - |
| `bin/pairofcleats.js` | `docs/contracts/search-cli.md` | `tests/cli/general/cli.test.js` | - |
| `tools/api/server.js` | `docs/contracts/mcp-api.md` | `tests/services/api/health-and-status.test.js`, `tests/services/api/search-happy-path.test.js`, `tests/services/api/api-server-stream.test.js` | - |
| `tools/mcp/server.js` | `docs/contracts/mcp-api.md` | `tests/services/mcp/tools-list.test.js`, `tests/services/mcp/protocol-initialize.test.js`, `tests/services/mcp/mcp-schema.test.js`, `tests/services/mcp/mcp-schema-version.test.js`, `tests/services/mcp/mcp-search-arg-mapping.test.js`, `tests/services/mcp/sdk-mode.test.js` | - |
| `tools/service/indexer-service.js` | `docs/contracts/indexing.md` | `tests/services/indexer/indexer-service.test.js`, `tests/services/queue/service-queue.test.js`, `tests/indexing/runtime/two-stage-state.test.js` | - |
| `tools/index/validate.js` | `docs/contracts/indexing.md` | `tests/indexing/validate/index-validate.test.js`, `tests/indexing/embeddings/embeddings-dims-mismatch.test.js` | - |
| `tools/index/assemble-pieces.js` | `docs/contracts/indexing.md` | - | Gap: no fixture-based assembly test yet. |
| `tools/index/compact-pieces.js` | `docs/contracts/indexing.md` | - | Gap: no regression/perf assertion in CI yet. |
| `tools/ci/restore-artifacts.js` | `docs/contracts/indexing.md` | - | Gap: no checksum-validation test yet. |
| `tools/ingest/ctags.js` | `docs/contracts/indexing.md` | `tests/tooling/ingest/ctags/ctags-ingest.test.js` | - |
| `tools/ingest/lsif.js` | `docs/contracts/indexing.md` | `tests/tooling/ingest/lsif/lsif-ingest.test.js` | - |
| `tools/ingest/scip.js` | `docs/contracts/indexing.md` | `tests/tooling/ingest/scip/scip-ingest.test.js` | - |
| `tools/ingest/gtags.js` | `docs/contracts/indexing.md` | `tests/tooling/ingest/gtags/gtags-ingest.test.js` | - |
| `tools/download/dicts.js` | `docs/contracts/indexing.md` | `tests/tooling/install/download-dicts.test.js` | - |
| `tools/download/extensions.js` | `docs/contracts/sqlite.md` | `tests/tooling/install/download-extensions.test.js` | - |
| `tools/bench/language-repos.js` | `docs/contracts/retrieval-ranking.md` | `tests/perf/bench/run.test.js` (harness only) | Gap: long-running benchmarks are not asserted in CI. |

