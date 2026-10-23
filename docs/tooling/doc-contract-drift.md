# Doc Contract Drift

Status: DRIFT

## searchCliFlags
- doc: docs/contracts/search-cli.md
- source: src/retrieval/cli-options.js
- missing in docs: none
- extra in docs: none

## searchContractFlags
- doc: docs/contracts/search-contract.md
- source: src/retrieval/cli-options.js
- note: non-blocking drift (informational)
- missing in docs (81): --alias, --allow-sparse-fallback, --allow-unsafe-mix, --ann, --ann-backend, --ann-candidates, --as-of, --async, --author, --awaits
- extra in docs: none

## artifactSchemas
- doc: docs/contracts/artifact-schemas.md
- source: src/contracts/schemas/artifacts.js
- missing in docs (2): graph_relation_edges, graph_relation_edges_meta
- extra in docs: none

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

