# Doc Contract Drift

Status: DRIFT

## searchCliFlags
- doc: docs/contracts/search-cli.md
- source: src/retrieval/cli-args.js
- missing in docs: none
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
- missing in docs (4): dense_vectors_binary_meta, dense_vectors_code_binary_meta, dense_vectors_doc_binary_meta, scan_profile
- extra in docs (7): author, bookmarks, branch, changeId, commitId, operationId, timestamp

## scoreBreakdown
- doc: docs/contracts/search-contract.md
- source: src/retrieval/pipeline.js
- missing in docs: none
- extra in docs: none

## testRunnerLanes
- doc: docs/testing/test-runner-interface.md
- source: tests/run.rules.jsonc
- missing in docs: none
- extra in docs: none

## testRegroupingLanes
- doc: docs/testing/test-decomposition-regrouping.md
- source: tests/run.rules.jsonc
- missing in docs: none
- extra in docs: none

