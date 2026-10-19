# Doc Contract Drift

Status: DRIFT

## searchCliFlags
- doc: docs/contracts/search-cli.md
- source: src/retrieval/cli-args.js
- missing in docs: none
- extra in docs (106): --alias, --allow-sparse-fallback, --allow-unsafe-mix, --ann, --ann-backend, --ann-candidates, --as-of, --async, --author, --awaits

## searchContractFlags
- doc: docs/contracts/search-contract.md
- source: src/retrieval/cli-args.js
- note: non-blocking drift (informational)
- missing in docs (1): -n
- extra in docs (24): --calls, --candidates, --deadline-ms, --explain, --ext, --file, --inferred-type, --lang, --match, --output-bytes

## artifactSchemas
- doc: docs/contracts/artifact-schemas.md
- source: src/contracts/schemas/artifacts.js
- missing in docs: none
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

