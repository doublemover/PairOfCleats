# Plan

We will reorganize the tests tree so tests live under subsystem-first folders with feature subfolders, eliminate root-level test files, standardize naming to *.test.js, and consolidate shared test logic into helpers while updating runner rules, lane configs, and docs to match the new layout.

## Scope
- In: Tests folder structure, test naming, helper consolidation, runner/lane config updates, docs/test inventories.
- Out: Production code changes unrelated to test paths or helper reuse.

## Action items
[ ] Inventory tests at tests/ root and all subfolders; build a mapping table (current path -> new path, rename, helper extraction notes).
[ ] Define the target taxonomy: subsystem-first folders with feature subfolders; keep unit/integration only as lanes (not as folders).
[ ] Create missing top-level folders (runner, smoke, shared) and subsystem feature subfolders (indexing/watch, indexing/imports, retrieval/ann, storage/lmdb, tooling/reports, etc.).
[ ] Move all root-level test files into subsystem/feature folders; leave only run.js, run.rules.jsonc, run.config.jsonc, and README.md at tests/ root.
[ ] Move runner-related files (all.js, test-runner.js, discovery/reporting helpers) into tests/runner and update their import paths.
[ ] Rehome CLI tests into tests/cli/build-index and tests/cli/search subfolders; update references in docs and runner config.
[ ] Rehome indexing tests into tests/indexing/<feature> (chunking, watch, ignore, imports, incremental, promotion, embeddings, relations, etc.).
[ ] Rehome indexer tests into tests/indexer/<feature> (metav2, sharded-meta, signatures, artifacts, pipeline, service, etc.).
[ ] Rehome retrieval tests into tests/retrieval/<feature> (ann, postings, query, ranking, filters, cache, output, explain, etc.).
[ ] Rehome storage tests into tests/storage/<backend> (sqlite, lmdb, vector-extension) and keep other storage-related tests adjacent.
[ ] Rehome tooling tests into tests/tooling/<feature> (reports, ingest, script-coverage, structural, vscode, doctor, etc.).
[ ] Rehome crossfile/type-inference/identity/map/relations/risk tests into the most natural subsystem folder with feature subfolders.
[ ] Rename all test files to *.test.js and ensure helpers remain *.js; update any references, lists, and docs that mention old names.
[ ] Centralize repeated test setup (fixtures, env sync, spawn wrappers, build_index helpers) into tests/helpers; remove duplicated logic in tests.
[ ] Create or update shared helpers for common build-index and fixture operations; refactor tests to consume them.
[ ] Update tests/run.rules.jsonc lane and tag rules to match new paths; keep unit/integration lanes as tags only.
[ ] Update tests/run.config.jsonc, tests/ci/ci.order.txt, tests/ci-lite/ci-lite.order.txt, and tools/test_times/* for the new paths.
[ ] Update any docs referencing test paths or layout (README.md, docs guides, AGENTS.md as needed).
[ ] Verify helpers/support folders remain excluded in test discovery (excludedDirs) and that tests/shared contains only src/shared tests.
[ ] Run test discovery (node tests/run.js --list) and a small smoke subset to validate moves; stop any test > 1 minute and ask you to run it.
[ ] Final sweep: confirm no test files remain at tests/ root and no stale paths remain in repo search.
[ ] Update AVISPROVOC.md progress log with each batch move, helper extraction, and any conflicts or ambiguities.

## Progress log
- 2026-02-01: Added `tests/README.md` documenting layout, naming, and lane rules.
- 2026-02-01: Created subsystem/feature folders, moved tests out of `tests/` root, and renamed tests to `*.test.js`.
- 2026-02-01: Updated test runner discovery rules and lane/tag rules for the new layout; CI-lite order list updated.
- 2026-02-01: In progress: update package.json scripts and all docs/config references to new test paths.
- 2026-02-01: Removed all test-related scripts from package.json.
- 2026-02-01: Updated docs/config/test logs to point at new test paths.
- 2026-02-01: Refined test documentation (commands, runner interface, decomposition plan, dependency refs) for the new layout.
- 2026-02-01: Fixed runner helper import path (tests/runner/run-execution.js).
- 2026-02-01: Normalized relative imports across tests to match new folder layout.
- 2026-02-01: Tagged long-only tests for tooling triage context-pack and MCP search defaults so they move to ci-long.
- 2026-02-01: Renamed helper-only test modules to `.js` (validate helpers, smoke utils, script-coverage helpers) and updated imports.
- 2026-02-01: Repointed runner harness tests to repoRoot and updated the cwd-independence target path.
- 2026-02-01: Fixed root/path resolution in type-inference crossfile/LSP tests and shared runtime spawn-env test.
- 2026-02-01: Updated tree-sitter chunk fixtures path to tests/fixtures and corrected hnsw insert failures tool import.
- 2026-02-01: Updated stable entrypoint expectations in policy tests and switched CI/nightly workflows to run-suite + .testLogs.
- 2026-02-01: Re-mapped script-coverage action paths to new test locations and filled remaining manual mappings.
- 2026-02-01: Ran ci-lite (172 tests) successfully; ci lane timed out only on script-coverage (30s limit).
- 2026-02-01: Marked tooling/script-coverage as long to move it to ci-long and avoid ci timeouts.
- 2026-02-01: Re-ran ci lane with 30s timeout after tagging long; all 457 tests passed (2 skips, destructive excluded).

## Open questions
- None (answered: add README, allow full restructure, no external references).
