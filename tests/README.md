# Tests layout

This repository keeps tests organized by subsystem first, then by feature. Test discovery is driven by `tests/run.js` + `tests/run.rules.jsonc`.

## Root rules
- The tests root only contains runner/config/docs:
  - `run.js`
  - `run.rules.jsonc`
  - `run.config.jsonc`
  - `README.md`
- No test cases live at `tests/` root.

## Naming
- Test files must use `*.test.js`.
- Helpers/support modules use plain `*.js` and live in `tests/helpers/` (excluded from discovery).

## Subsystem-first layout
- Organize tests by subsystem, then feature:
  - `tests/cli/` (e.g. `build-index/`, `search/`)
  - `tests/indexing/` (chunking, watch, imports, incremental, promotion, embeddings, relations, etc.)
  - `tests/indexer/` (metav2, sharded-meta, signatures, artifacts, pipeline)
  - `tests/retrieval/` (ann, postings, query, ranking, filters, cache, output)
  - `tests/storage/` (sqlite, lmdb, vector-extension)
  - `tests/tooling/` (reports, ingest, script-coverage, structural, vscode, doctor)
  - `tests/lang/` (language-specific behavior)
  - `tests/services/` (api, mcp, service queue)
  - `tests/shared/` (tests for src/shared utilities)
  - `tests/runner/` (tests about the test runner itself)
  - `tests/smoke/` (smoke/e2e style tests)

## Fixtures and helpers
- Fixtures live in `tests/fixtures/`.
- Support code lives in `tests/helpers/` and should be reused across tests.

## Lanes
- Unit/integration are lanes/tags only, not folders.
- Update `tests/run.rules.jsonc` when adding new folders so lane/tag rules remain accurate.

## Coverage (line/branch)
- Run the suite under c8 when you need code coverage:
  - `npx c8 node tests/run.js --lane ci`
  - Add `--reporter=text --reporter=lcov` if you want console + HTML/LCOV output.

### Generate Merged Report
```powershell
    # Clean
  Remove-Item -Recurse -Force .c8, coverage-merged -ErrorAction SilentlyContinue;New-Item -ItemType Directory -Force -Path .c8 | Out-Null

  # Run each lane into its own temp dir (no report yet)
  npx c8 --temp-directory .c8/ci-lite --reporter=none node tests/run.js --lane ci-lite;npx c8 --temp-directory .c8/ci --reporter=none node tests/run.js --lane ci;npx c8 --temp-directory .c8/ci-long --reporter=none node tests/run.js --lane ci-long

  # Merge the raw coverage JSON files
  New-Item -ItemType Directory -Force -Path .c8/merged | Out-Null;Get-ChildItem .c8/ci-lite -File | Copy-Item -Destination .c8/merged;Get-ChildItem .c8/ci -File | Copy-Item -Destination .c8/merged;Get-ChildItem .c8/ci-long -File | Copy-Item -Destination .c8/merged

  # Generate merged report
  npx c8 report --temp-directory .c8/merged --reporter=text --reporter=html --report-dir coverage-merged --clean=false
```