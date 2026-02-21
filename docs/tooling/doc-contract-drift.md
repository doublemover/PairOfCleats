# Doc Contract Drift

Status: DRIFT

## searchCliFlags
- doc: docs/contracts/search-cli.md
- source: src/retrieval/cli-args.js
- missing in docs (18): --allow-sparse-fallback, --allow-unsafe-mix, --as-of, --cohort, --concurrency, --debug-include-paths, --federated-strict, --fts-stemming, --fts-trigram, --include-disabled
- extra in docs: none

## searchContractFlags
- doc: docs/contracts/search-contract.md
- source: src/retrieval/cli-args.js
- note: non-blocking drift (informational)
- missing in docs (76): --alias, --allow-sparse-fallback, --allow-unsafe-mix, --ann, --ann-backend, --as-of, --async, --author, --awaits, --backend
- extra in docs: none

## artifactSchemas
- doc: docs/contracts/artifact-schemas.md
- source: src/contracts/schemas/artifacts.js
- missing in docs (9): boilerplate_catalog, chunk_meta_cold, chunk_meta_cold_meta, determinism_report, extraction_report, field_tokens_meta, file_meta_meta, vfs_manifest_bloom, vocab_order
- extra in docs: none

## scoreBreakdown
- doc: docs/contracts/search-contract.md
- source: src/retrieval/pipeline.js
- missing in docs: none
- extra in docs (13): ann, blend, confidence, confidenceByType, effectiveType, phrase, reasonCodes, rrf, selected, signals

## testRunnerLanes
- doc: docs/testing/test-runner-interface.md
- source: tests/run.rules.jsonc
- missing in docs (5): backcompat, decomposed-drift, diagnostics-summary, gate, iq
- extra in docs: none

## testRegroupingLanes
- doc: docs/testing/test-decomposition-regrouping.md
- source: tests/run.rules.jsonc
- missing in docs (5): backcompat, decomposed-drift, diagnostics-summary, gate, iq
- extra in docs: none

