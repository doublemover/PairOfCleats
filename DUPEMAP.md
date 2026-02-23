# DUPEMAP

Generated: 2026-02-23T00:30:00.000Z (working draft; actively updated during sweep)

## Method

- Pass 1 (base scan): broad duplicate detection across runtime, scripts, and tests.
- Pass 2 (2x depth): semantic duplicate hunt for near-miss implementations and wrapper copies.
- Pass 3 (4x depth): cross-surface consistency audit for shared-module extraction opportunities.

## Sweep Scope Snapshot

- Files discovered by sweep tooling: `3668`.
- Largest surfaces by file count:
- `tests`: `1975`
- `src`: `842`
- `docs`: `460`
- `tools`: `295`
- Additional covered surfaces: `bin`, `extensions`, `sublime`, root scripts/config.

## Implementation Matrix (2026-02-23T00:30:00.000Z)

- Totals:
- `closed`: `70`
- `partial`: `0`
- `open`: `0`

- `closed`:
- `1, 2, 3, 4, 5, 6, 7, 8, 9, 10`
- `11, 12, 13, 14, 15, 16, 17, 18, 19, 20`
- `21, 22, 23, 24, 25, 26, 27, 28, 29, 30`
- `31, 32, 33, 34, 35, 36, 37, 38, 39, 40`
- `41, 42, 43, 44, 45, 46, 47, 48, 49, 50`
- `51, 52, 53, 54, 55, 56, 57, 58, 59, 60`
- `61, 62, 63, 64, 65, 66, 67, 68, 69, 70`

- `partial`:
- none

- `open`:
- none

## Findings

### 1) Repeated `resolveFormat` helper across tooling CLIs

- Files:
- `src/integrations/tooling/context-pack.js`
- `src/integrations/tooling/graph-context.js`
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/architecture-check.js`
- `src/integrations/tooling/suggest-tests.js`
- Why this is duplicated:
- Each file normalizes `--format`/`--json` into `md|json` via nearly identical lowercase + fallback logic.
- Risk:
- Behavior drifts when adding aliases/default behavior (fixes must be patched in many places).
- Shared-module fix:
- Extract one `resolveFormat(argv)` helper in a shared CLI utility module and import everywhere.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

- Audit (2026-02-23T00:20:00.000Z): Deep re-audit pass: fixed a regression where resolveFormat defaulted to json instead of md; added resolveFormat contract regression coverage.

### 2) Duplicated `mergeCaps(baseCaps, overrides)` logic

- Files:
- `src/integrations/tooling/context-pack.js`
- `src/integrations/tooling/graph-context.js`
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/suggest-tests.js`
- Why this is duplicated:
- The same cap-override merge pattern is reimplemented with equivalent semantics.
- Risk:
- New cap fields can be omitted or merged differently in one CLI.
- Shared-module fix:
- Create `mergeOverrideCaps(baseCaps, overrides)` in shared tooling helpers.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 3) Repeated graph metadata loading sequence

- Files:
- `src/integrations/tooling/context-pack.js`
- `src/integrations/tooling/graph-context.js`
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/suggest-tests.js`
- `src/integrations/tooling/architecture-check.js`
- Why this is duplicated:
- Multiple CLIs repeat the same sequence: manifest/chunk metadata/compat key/signature loading.
- Risk:
- Cache invalidation and size-limit behavior can diverge subtly across commands.
- Shared-module fix:
- Build `prepareGraphInputs({ repoRoot, indexDir, strict })` to centralize metadata plumbing.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 4) Repeated graph cache key + graph index loading

- Files:
- `src/integrations/tooling/context-pack.js`
- `src/integrations/tooling/graph-context.js`
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/suggest-tests.js`
- `src/integrations/tooling/architecture-check.js`
- Why this is duplicated:
- Building cache keys and loading `graph_relations_csr`/graph index appears near-verbatim.
- Risk:
- Memory/perf and fallback semantics drift between CLIs.
- Shared-module fix:
- Add `prepareGraphIndex({ repoRoot, indexDir, selection })` helper reused by all CLIs.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 5) Identical `parseList` list-normalization helpers

- Files:
- `src/integrations/tooling/graph-context.js`
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/suggest-tests.js`
- Why this is duplicated:
- Same array/comma-separated string parsing and trim/filter behavior in each file.
- Risk:
- CLI option semantics diverge with future list-format changes.
- Shared-module fix:
- Move to `src/shared/cli-helpers.js` as `parseList`.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 6) Duplicated changed-file parsing (`--changed`, `--changed-file`)

- Files:
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/suggest-tests.js`
- Why this is duplicated:
- Same merge + file-read + repo-relative normalization + invalid filtering flow.
- Risk:
- Path validation and changed-file behavior become inconsistent.
- Shared-module fix:
- Extract `parseChangedInputs(argv, repoRoot)` helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 7) Duplicated output rendering and error emission pattern

- Files:
- `src/integrations/tooling/context-pack.js`
- `src/integrations/tooling/graph-context.js`
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/suggest-tests.js`
- `src/integrations/tooling/architecture-check.js`
- Why this is duplicated:
- Same `format === 'md' ? render : JSON.stringify` branch and same JSON/stderr error split in catch.
- Risk:
- Inconsistent error contract and output formatting between commands.
- Shared-module fix:
- Introduce `renderCliResult({ format, renderMd, payload, errorCode })`.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 8) Redundant repo-path wrapper around shared normalize function

- Files:
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/suggest-tests.js`
- Why this is duplicated:
- Both define tiny wrappers that simply call `normalizeRepoRelativePath`.
- Risk:
- Extra wrappers hide common behavior and invite accidental divergence when expanded.
- Shared-module fix:
- Use shared `normalizeRepoRelativePath` directly or create one shared wrapper used by both.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 9) Repeated path normalization in extracted-prose tests

- Files:
- `tests/indexing/extracted-prose/document-extractor-version-recorded.test.js`
- `tests/indexing/extracted-prose/documents-skipped-when-unavailable.test.js`
- `tests/indexing/extracted-prose/documents-included-when-available.test.js`
- Why this is duplicated:
- Multiple tests locally redefine path normalization (`replace('\\', '/')`, lowercase) instead of reusing a shared helper.
- Risk:
- Test behavior drifts from production path normalization semantics.
- Shared-module fix:
- Add `tests/helpers/path-normalize.js` (or re-export `src/shared/path-normalize.js`) and reuse it.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): regression found in newer extracted-prose tests; path matching now reuses shared fixture normalization helpers and migrated tests.

### 10) Duplicated extracted-prose fixture setup

- Files:
- `tests/indexing/extracted-prose/document-extractor-version-recorded.test.js`
- `tests/indexing/extracted-prose/documents-skipped-when-unavailable.test.js`
- `tests/indexing/extracted-prose/documents-included-when-available.test.js`
- Why this is duplicated:
- Same cache/repo creation, sample document writing, env setup, and `build_index --stub-embeddings` orchestration.
- Risk:
- Fixture setup changes (paths/env/flags) require multi-file edits and can desynchronize.
- Shared-module fix:
- Create `tests/helpers/extracted-prose-fixture.js` to encapsulate setup and index-build steps.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): regression found in newer extracted-prose tests; fixture scaffolding and build invocation now flow through shared extracted-prose fixture helpers.

- Audit (2026-02-23T00:20:00.000Z): Deep re-audit pass: migrated extraction-report fixture orchestration onto shared extracted-prose fixture/build helpers to prevent setup drift.

### 11) Repeated document-extraction state inspection

- Files:
- `tests/indexing/extracted-prose/document-extractor-version-recorded.test.js`
- `tests/indexing/extracted-prose/documents-skipped-when-unavailable.test.js`
- `tests/indexing/extracted-prose/documents-included-when-available.test.js`
- Why this is duplicated:
- Tests repeat parsing of `build_state.json`/`.filelists.json` and extraction of `documentExtraction['extracted-prose']`.
- Risk:
- Assertion plumbing errors and field-path drift across tests.
- Shared-module fix:
- Add helper(s) returning parsed state + normalized extracted-prose entry per path.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): regression found in newer extracted-prose tests; build-state and artifact reads now flow through shared extracted-prose artifact readers for deterministic inspection.

- Audit (2026-02-23T00:20:00.000Z): Deep re-audit pass: migrated extraction-report artifact/state reads onto shared extracted-prose artifact readers for deterministic state plumbing.

### 12) Repeated TUI supervisor session wiring in tests

- Files:
- `tests/tui/supervisor-stream-cancel-integration.test.js`
- `tests/tui/supervisor-retry-policy.test.js`
- `tests/tui/supervisor-stdout-progress-default-stream.test.js`
- Why this is duplicated:
- Multiple tests reimplement the same child-process spawn, stdout buffering, JSON event parse, and `waitFor` flow.
- Risk:
- Race condition fixes and timeout tuning applied inconsistently.
- Shared-module fix:
- Create `tests/helpers/tui-supervisor-session.js` exposing spawn/send/waitForEvent utilities.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 13) Repeated search test lifecycle (repo scaffold + index + search run)

- Files:
- `tests/cli/search/search-contract.test.js`
- `tests/cli/search/search-determinism.test.js`
- `tests/cli/search/search-explain-symbol.test.js`
- `tests/cli/search/search-topn-filters.test.js`
- `tests/cli/search/search-windows-path-filter.test.js`
- Why this is duplicated:
- Same temporary repo creation + `applyTestEnv` + `build_index` + `search.js` execution and JSON parsing.
- Risk:
- Test harness drift obscures true search behavior changes.
- Shared-module fix:
- Introduce `tests/helpers/search-runner.js` for setup, command execution, and parsed response.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 14) Duplicate `spawnSync` command-wrapper patterns in fixtures

- Files:
- `tests/tooling/fixtures/fixture-parity.test.js`
- `tests/tooling/fixtures/fixture-empty.test.js`
- Why this is duplicated:
- Very similar `run(args, label, cwd, env)` wrappers with timeout/error logging are redefined per file.
- Risk:
- Timeout defaults and failure diagnostics diverge.
- Shared-module fix:
- Centralize in `tests/helpers/run-command.js`.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 15) Repeated install/uninstall workspace scaffolding

- Files:
- `tests/tooling/install/uninstall.test.js`
- `tests/tooling/install/tool-root.test.js`
- Why this is duplicated:
- Both tests recreate directory trees, marker files, and env plumbing for tooling lifecycle scenarios.
- Risk:
- Inconsistent setup can produce false negatives/positives in install behavior tests.
- Shared-module fix:
- Extract shared helper for install test workspace bootstrapping and post-checks.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 16) Editor integrations reimplement shared CLI config resolution

- Files:
- `extensions/vscode/extension.js`
- `sublime/PairOfCleats/lib/config.py`
- Resolution status:
- Closed (2026-02-22T07:35:44.8865850-05:00) via canonical contract at `docs/tooling/editor-config-contract.json` consumed by both adapters with local fallback defaults.
- Why this is duplicated:
- Repo-root detection, CLI path resolution, env/args merge, and validation are independently reimplemented.
- Risk:
- Different editors can behave differently for the same user configuration.
- Shared-module fix:
- Define canonical editor-integration config behavior in shared tooling module or schema-driven contract and align both adapters.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 17) Duplicate `copyDir` helper behavior in CI artifact scripts

- Files:
- `tools/ci/build-artifacts.js`
- `tools/ci/restore-artifacts.js`
- Why this is duplicated:
- Both scripts implement near-identical recursive copy logic with existence checks and destination mkdir.
- Risk:
- Copy semantics diverge between artifact build and restore flows.
- Shared-module fix:
- Move to `tools/shared/fs-copy.js` (or an existing shared fs helper module).

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 18) Repeated subprocess spawn + exit/error handling in tools

- Files:
- `tools/ci/build-artifacts.js`
- `tools/reports/combined-summary.js`
- `tools/reports/compare-models.js`
- Why this is duplicated:
- Multiple scripts repeat child invocation, exit-code checks, logging, cleanup, and `process.exit(...)`.
- Risk:
- Error contracts and logging output become inconsistent across scripts.
- Shared-module fix:
- Standardize on one command-runner helper for sync child execution and failure handling.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 19) Repeated repo/config/env bootstrap flow

- Files:
- `tools/ci/build-artifacts.js`
- `tools/reports/combined-summary.js`
- `tools/reports/compare-models.js`
- Why this is duplicated:
- Scripts independently repeat `resolveRepoConfig` + `getRuntimeConfig` + `resolveRuntimeEnv` scaffolding.
- Risk:
- Runtime env mutation and override semantics diverge.
- Shared-module fix:
- Introduce one shared `bootstrapRuntime(argv)` returning `{ repoRoot, userConfig, runtimeConfig, baseEnv }`.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 20) Duplicated git metadata read/check logic

- Files:
- `tools/ci/build-artifacts.js`
- `tools/ci/restore-artifacts.js`
- Why this is duplicated:
- Both scripts initialize simple-git, inspect HEAD/dirty state, and branch behavior by commit identity.
- Risk:
- Commit-detection behavior can drift and create hard-to-debug CI mismatches.
- Shared-module fix:
- Extract a shared `readRepoGitState(root)` helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 21) Duplicate `parseMeta` implementation across triage scripts

- Files:
- `tools/triage/ingest.js`
- `tools/triage/decision.js`
- Why this is duplicated:
- `key=value` parsing helper is effectively copied between both files.
- Risk:
- Metadata parsing behavior diverges when accepted syntax evolves.
- Shared-module fix:
- Create shared triage metadata parser utility.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 22) Duplicate `name=url` source parsing in download tooling

- Files:
- `tools/download/dicts.js`
- `tools/download/extensions.js`
- Why this is duplicated:
- Both parse source overrides with near-identical `name=url` and hash handling behavior.
- Risk:
- Users get inconsistent parsing behavior depending on download surface.
- Shared-module fix:
- Consolidate to one shared source-spec parser.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

- Audit (2026-02-23T00:20:00.000Z): Deep re-audit pass: hardened download dictionary workflow to exit non-zero when any source fails; added partial-failure exit-code regression test.

### 23) Repeated manifest JSON read/write boilerplate

- Files:
- `tools/download/dicts.js`
- `tools/download/extensions.js`
- Why this is duplicated:
- Both scripts implement similar read-fallback and write-with-newline logic for JSON manifests.
- Risk:
- Error handling and persistence behavior can diverge.
- Shared-module fix:
- Add shared manifest manager (`readManifest`/`writeManifest`) in tooling utilities.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 24) Duplicate safe-JSON-read try/catch pattern

- Files:
- `tools/ci/restore-artifacts.js`
- `tools/index/report-artifacts.js`
- Why this is duplicated:
- Both wrap `JSON.parse(fs.readFileSync(...))` in silent fallback code returning null.
- Risk:
- Silent parse failures can differ in logs or fallback semantics.
- Shared-module fix:
- Reuse a single `safeReadJson(path, { onError })` helper across scripts.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 25) Local `emitJson` helpers duplicated despite shared CLI utilities

- Files:
- `tools/index-snapshot.js`
- `tools/index-diff.js`
- Why this is duplicated:
- Both define local JSON emitter helpers while shared CLI utility support already exists.
- Risk:
- Output stream and JSON formatting behavior diverge between index tools.
- Shared-module fix:
- Reuse shared `emitJson` from tooling utilities everywhere.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

- Audit (2026-02-23T00:28:00.000Z): Deep re-audit pass: index-diff CLI flag contract aligned with implementation (--mode alias wired in tools/index-diff and stale --compact acceptance removed from bin validation).

### 26) Local `emitError` helpers duplicated in index tooling

- Files:
- `tools/index-snapshot.js`
- `tools/index-diff.js`
- Why this is duplicated:
- Both files reimplement code/message to JSON-or-stderr error emission.
- Risk:
- Error payload shape and stderr fallback behavior can drift.
- Shared-module fix:
- Add one shared error emitter with consistent JSON/stderr contract.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 27) Duplicate `normalizeNumber` helper in index CLIs

- Files:
- `tools/index-snapshot.js`
- `tools/index-diff.js`
- Why this is duplicated:
- Same numeric coercion/normalization logic appears in both files.
- Risk:
- Numeric bounds/rounding semantics diverge.
- Shared-module fix:
- Move number normalization to shared CLI numeric helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 28) Duplicate comma-list parsing with dedupe

- Files:
- `tools/index-snapshot.js`
- `tools/index-diff.js`
- Why this is duplicated:
- Both parse strings/arrays of comma-separated values into trimmed deduplicated lists.
- Risk:
- Accepted input formats and dedupe behavior diverge.
- Shared-module fix:
- Create shared `parseCommaList(value, fallback)` helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 29) Version resolution duplicated across entrypoints despite shared helper

- Files:
- `search.js`
- `bin/pairofcleats.js`
- `tools/tui/supervisor.js`
- `tools/mcp/server-config.js`
- Why this is duplicated:
- Multiple scripts read `package.json` directly instead of central version helper.
- Risk:
- Version reporting can differ or regress with path/caching changes.
- Shared-module fix:
- Use `tools/shared/dict-utils/tool.js` version helper consistently.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 30) Boolean string parsing reimplemented across CLI/config/env surfaces

- Files:
- `tools/index-diff.js`
- `tools/config/reset.js`
- `src/shared/env.js`
- Why this is duplicated:
- Equivalent truthy/falsy string parsing logic appears in multiple places.
- Risk:
- Inconsistent interpretation of values like `yes`, `1`, `true`, `on`.
- Shared-module fix:
- Standardize on one shared boolean normalization function.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 31) Duplicated config-path resolution in config tools

- Files:
- `tools/config/validate.js`
- `tools/config/reset.js`
- Why this is duplicated:
- Both implement default `.pairofcleats.json` path resolution, existence checks, and response shaping.
- Risk:
- Config command behavior diverges for missing/explicit paths.
- Shared-module fix:
- Extract `resolveUserConfigPath(argv, repoRoot)` helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 32) Recursive directory traversal logic reimplemented

- Files:
- `tools/docs/repo-inventory.js`
- `tools/tooling/archive-determinism.js`
- Why this is duplicated:
- Both perform custom DFS traversal with `readdir`/file filtering scaffolding.
- Risk:
- Traversal order/exclusion behavior diverges in tooling pipelines.
- Shared-module fix:
- Move deterministic traversal to shared fs utility.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 33) Path separator normalization reimplemented despite shared function

- Files:
- `tools/tooling/archive-determinism.js`
- `tools/testing/coverage/index.js`
- Why this is duplicated:
- Local `toPosix` utilities are defined rather than using shared path normalization.
- Risk:
- Regex/path edge-case behavior can drift across tools.
- Shared-module fix:
- Reuse `src/shared/files.js` path normalization helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 34) Indexing section default-resolution duplicated

- Files:
- `tools/index-snapshot.js`
- `tools/index-diff.js`
- Why this is duplicated:
- Both walk `userConfig.indexing` with repeated guard/default logic.
- Risk:
- Defaults and defensive checks diverge between related CLIs.
- Shared-module fix:
- Introduce shared `getIndexingSection(userConfig, key, defaults)` helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 35) Manifest parsing reimplemented in artifact consistency tests

- Files:
- `tests/indexing/artifacts/sharded-meta/sharded-meta-manifest-consistency.test.js`
- `tests/indexing/artifacts/manifest/pieces-manifest-precomputed-checksum.test.js`
- Why this is duplicated:
- Tests manually `JSON.parse` `pieces/manifest.json` instead of shared manifest loader.
- Risk:
- Tests bypass canonical manifest strictness/size/schema behavior.
- Shared-module fix:
- Use `loadPiecesManifest()` from `src/shared/artifact-io/manifest.js`.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 36) Manifest parsing reimplemented in embeddings tests

- Files:
- `tests/indexing/embeddings/manifest-embeddings-pieces.test.js`
- `tests/indexing/embeddings/embeddings-determinism.test.js`
- Why this is duplicated:
- Tests reconstruct manifest maps via ad hoc parsing logic.
- Risk:
- Test semantics can drift from runtime manifest normalization.
- Shared-module fix:
- Replace ad hoc parsing with `loadPiecesManifest()` and shared manifest utilities.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 37) Manifest parsing reimplemented in piece-assembly tests

- Files:
- `tests/indexing/piece-assembly/piece-assembly.test.js`
- Why this is duplicated:
- Same test file manually loads manifest multiple times for different assertions.
- Risk:
- Redundant parsing logic increases maintenance burden and inconsistency risk.
- Shared-module fix:
- Load once through shared helper and reuse normalized manifest object.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 38) Manifest parsing reimplemented in validator risk tests

- Files:
- `tests/indexing/validate/validator/risk-interprocedural.test.js`
- Why this is duplicated:
- Test manually parses/edits manifest for scenario setup.
- Risk:
- Future manifest shape changes can silently break test setup logic.
- Shared-module fix:
- Seed scenario via `loadPiecesManifest()` then mutate test-specific fields.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 39) Manifest parsing reimplemented in unknown-piece validation test

- Files:
- `tests/indexing/validate/index-validate-unknown-piece.test.js`
- Why this is duplicated:
- Test performs ad hoc manifest load before missing-piece assertions.
- Risk:
- Inconsistent strictness with production validator behavior.
- Shared-module fix:
- Reuse shared manifest loader in test scaffolding.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 40) Manifest parsing reimplemented in strict unknown-artifact validation test

- Files:
- `tests/indexing/validate/index-validate-unknown-artifact-fails-strict.test.js`
- Why this is duplicated:
- Manual manifest parsing repeated for strict-failure setup.
- Risk:
- Strict-mode assumptions diverge from runtime parse path.
- Shared-module fix:
- Use shared loader + artifact presence resolution helpers.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 41) Manifest parsing reimplemented in required-keys validation test

- Files:
- `tests/indexing/validate/index-validate-jsonl-required-keys.test.js`
- Why this is duplicated:
- Test reads/parses manifest manually prior to fixture mutation.
- Risk:
- Validation tests couple to local parsing logic rather than canonical loader behavior.
- Shared-module fix:
- Route manifest loading through shared helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 42) Manifest parsing reimplemented in file-name-collision validation test

- Files:
- `tests/indexing/validate/index-validate-file-name-collision.test.js`
- Why this is duplicated:
- Local parse/mutate flow reimplements same manifest load mechanics.
- Risk:
- Edge-case coverage may mismatch runtime parsing on malformed inputs.
- Shared-module fix:
- Replace manual parse with shared loader before mutation.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 43) Docs tooling CLIs reimplement shared parser scaffolding

- Files:
- `tools/docs/script-inventory.js`
- `tools/docs/repo-inventory.js`
- `tools/docs/export-artifact-schema-index.js`
- `tools/docs/contract-drift.js`
- Why this is duplicated:
- Each file recreates near-identical `yargs` setup (script name, parser config, help alias, permissive strictness).
- Risk:
- CLI behavior drift across docs tools when parser policy changes.
- Shared-module fix:
- Use `src/shared/cli.js` `createCli(...)` to centralize parser defaults.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 44) CI/bench CLIs reimplement parser scaffolding instead of shared CLI wrapper

- Files:
- `tools/test_times/report.js`
- `tools/ci/run-suite.js`
- `tools/ci/capability-gate.js`
- `tools/bench/symbol-resolution-bench.js`
- `tools/bench/micro/run.js`
- `tools/bench/micro/hash.js`
- Why this is duplicated:
- Each script manually wires `yargs(hideBin(process.argv))` with similar parser config and help alias rules.
- Risk:
- Flag parsing and help behavior become inconsistent across operational tools.
- Shared-module fix:
- Route all through `createCli` shared wrapper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 45) Chunk-row normalization duplicated across SQLite ingest surfaces

- Files:
- `src/storage/sqlite/build-helpers.js`
- `src/storage/sqlite/build/from-artifacts/chunk-ingest.js`
- Why this is duplicated:
- Both build chunk rows with repeated normalization/serialization/signature/docmeta extraction logic.
- Risk:
- Schema evolution and chunk integrity behavior diverge across ingest pathways.
- Shared-module fix:
- Introduce shared `normalizeChunkForSqlite(chunk)` utility.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 46) File-manifest row generation duplicated across ingest/compact flows

- Files:
- `src/storage/sqlite/build/from-artifacts/chunk-ingest.js`
- `src/storage/sqlite/build/from-bundles.js`
- `tools/build/compact-sqlite-index.js`
- Why this is duplicated:
- Same `fileCounts` accumulation + normalized manifest lookup + `file_manifest` row assembly pattern.
- Risk:
- Hash/mtime population rules drift across build modes.
- Shared-module fix:
- Extract `buildFileManifestRows(...)` shared helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 47) Normalized manifest map construction reimplemented

- Files:
- `src/storage/sqlite/build/from-artifacts/chunk-ingest.js`
- `src/storage/sqlite/build/from-bundles.js`
- Why this is duplicated:
- Both build `manifestByNormalized` via near-identical path normalization and map insertion.
- Risk:
- Path-key canonicalization differences produce mismatched lookups.
- Shared-module fix:
- Create shared manifest-entry collector utility.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 48) Docmeta signature/document extraction duplicated

- Files:
- `src/storage/sqlite/build/from-artifacts/chunk-ingest.js`
- `tools/build/compact-sqlite-index.js`
- Why this is duplicated:
- Both parse chunk docmeta payloads and fallback to top-level signature fields with similar logic.
- Risk:
- Signature/doc extraction diverges between compaction and ingest.
- Shared-module fix:
- Centralize extraction helper in shared chunk-meta utilities.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 49) Batched insert buffering logic reimplemented

- Files:
- `src/storage/sqlite/build/from-artifacts/chunk-ingest.js`
- Why this is duplicated:
- Multiple ingestors in same module recreate row-buffer/byte-budget/flush thresholds and bookkeeping.
- Risk:
- Flush policy changes require multi-site edits and can desync metrics.
- Shared-module fix:
- Add generic `createBatchInserter({ batchSize, byteBudget, insertFn })`.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 50) Chunk-meta source format dispatch duplicated

- Files:
- `src/storage/sqlite/build/from-artifacts/chunk-ingest.js`
- `tools/index/compact-pieces.js`
- Why this is duplicated:
- Both detect JSON vs columnar vs sharded JSONL chunk-meta layouts and route to different readers.
- Risk:
- One surface may miss new format variants or precedence rules.
- Shared-module fix:
- Build shared `resolveChunkMetaSources(indexDir)` dispatcher.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 51) JSONL reading helper reimplemented in tooling

- Files:
- `tools/index/compact-pieces.js`
- `src/storage/sqlite/build/from-artifacts/sources.js`
- Why this is duplicated:
- Equivalent JSONL/decompression-aware row reading exists in both locations.
- Risk:
- Parser fixes/compression handling updates diverge.
- Shared-module fix:
- Reuse shared reader from artifact source utilities.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 52) Chunk-meta part path normalization duplicated

- Files:
- `tools/index/compact-pieces.js`
- `src/index/build/artifacts/writers/chunk-meta/writer.js`
- `src/storage/sqlite/build/from-artifacts/sources.js`
- Why this is duplicated:
- Same expansion of `{ path }`/string parts to normalized absolute paths is repeated.
- Risk:
- Part discovery behavior becomes inconsistent across writer/reader/tooling.
- Shared-module fix:
- Extract `expandChunkMetaParts(metaFields, baseDir)`.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 53) Chunk-count aggregation logic repeated

- Files:
- `src/storage/sqlite/build/from-artifacts/chunk-ingest.js`
- `src/storage/sqlite/build/from-bundles.js`
- Why this is duplicated:
- Same map increment pattern for normalized-file chunk counts appears in multiple ingestion paths.
- Risk:
- Dedup/count semantics drift.
- Shared-module fix:
- Share `accumulateFileCounts(chunks)` helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 54) Chunk-meta shard discovery order duplicated

- Files:
- `src/storage/sqlite/build/from-artifacts/chunk-ingest.js`
- `tools/index/compact-pieces.js`
- Why this is duplicated:
- Both search for `chunk_meta.meta.json`/`chunk_meta.parts` and fallback shard file discovery.
- Risk:
- Non-deterministic discovery behavior across ingestion vs tooling.
- Shared-module fix:
- Add shared `locateChunkMetaShards(indexDir)` function.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 55) Positive-integer guardrail normalization duplicated

- Files:
- `src/retrieval/cli/normalize-options.js`
- `src/retrieval/pipeline.js`
- Why this is duplicated:
- Both clamp/coerce guardrail values via repeated `Math.max(1, Math.floor(Number(...)))` patterns.
- Risk:
- Guardrail semantics diverge between CLI normalization and runtime pipeline enforcement.
- Shared-module fix:
- Add shared `normalizePositiveInt(value, fallback, min)` helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 56) Search result limit normalization duplicated across backends

- Files:
- `src/retrieval/pipeline.js`
- `src/retrieval/lancedb.js`
- `tools/sqlite/vector-extension.js`
- Why this is duplicated:
- Top-N limit normalization/clamping appears across fusion layer and backend-specific implementations.
- Risk:
- Different backends may return inconsistent candidate pool sizes.
- Shared-module fix:
- Centralize query-limit normalization helper consumed by all retrieval backends.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 57) Numeric clamp helpers duplicated in SQLite modules

- Files:
- `src/storage/sqlite/utils.js`
- `src/storage/sqlite/build/pragmas.js`
- `src/storage/sqlite/build/multi-row.js`
- Why this is duplicated:
- Equivalent local `clamp` helpers are independently defined.
- Risk:
- Bounds behavior can diverge in write/read paths.
- Shared-module fix:
- Use one shared clamp utility in `src/shared`.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 58) Dense vector mode normalization duplicated

- Files:
- `src/retrieval/cli/normalize-options.js`
- `tools/build/embeddings/runner.js`
- Why this is duplicated:
- Mode normalization/validation logic appears in both CLI and embeddings pipeline tooling.
- Risk:
- Unsupported-mode handling can differ across entrypoints.
- Shared-module fix:
- Extract shared `normalizeDenseVectorMode` function.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 59) File signature probing duplicated for cache/index metadata

- Files:
- `src/retrieval/index-cache.js`
- `src/retrieval/cli-index.js`
- Why this is duplicated:
- Similar `safeStat` + signature assembly across variant artifact extensions (`.json`, `.jsonl`, `.meta`, compressed files).
- Risk:
- Cache invalidation keys diverge across CLI/runtime.
- Shared-module fix:
- Move to shared file-signature helper in retrieval/shared fs metadata module.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 60) File-relations path lookup logic duplicated

- Files:
- `src/retrieval/pipeline/relations.js`
- `src/retrieval/output/filters.js`
- Why this is duplicated:
- Both resolve relation maps with similar case-handling/path lookup semantics.
- Risk:
- Relation filtering and relation derivation can disagree on equivalent paths.
- Shared-module fix:
- Consolidate into one shared file-relation resolver.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 61) Optional artifact loader error-plumbing duplicated

- Files:
- `src/storage/sqlite/utils.js`
- Why this is duplicated:
- Multiple `loadOptional*` helpers repeat try/catch and fallback/warning behavior for missing/oversize artifacts.
- Risk:
- Inconsistent warning and fallback behavior across optional artifact types.
- Shared-module fix:
- Add generic `loadOptionalArtifact(loader, fallback)` wrapper for shared error handling.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 62) Chunk-meta artifact existence checks duplicated

- Files:
- `src/retrieval/cli-index.js`
- `src/storage/sqlite/utils.js`
- Why this is duplicated:
- Both implement chunk-meta artifact presence guards with similar manifest/existence checks.
- Risk:
- Preflight and loader may disagree on chunk-meta availability.
- Shared-module fix:
- Create one shared chunk-meta presence predicate.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 63) Cache eviction/trimming logic duplicated

- Files:
- `src/retrieval/query-cache.js`
- `src/retrieval/query-plan-cache.js`
- Why this is duplicated:
- Both sort by timestamps, drop expired entries, and truncate to max-entry limits.
- Risk:
- Different caches evict differently under pressure.
- Shared-module fix:
- Reuse shared eviction utility with TTL + max-entry policy.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 64) Boolean normalization reimplemented in retrieval CLI options

- Files:
- `src/retrieval/cli/normalize-options.js`
- `src/shared/env.js`
- Why this is duplicated:
- Retrieval CLI adds local boolean-string normalization overlapping shared env normalization.
- Risk:
- Different accepted truthy/falsy inputs depending on call path.
- Shared-module fix:
- Standardize on shared boolean normalizer (or shared superset function).

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 65) Query-file parsing/normalization duplicated across reports and tests

- Files:
- `tools/reports/compare-models.js`
- `tools/reports/parity-matrix.js`
- `tests/retrieval/parity/parity.test.js`
- `tests/perf/bench/run.test.js`
- Why this is duplicated:
- Multiple flows parse `.txt`/`.json` query sources with similar trim/comment-skip/array-shape handling.
- Risk:
- Query ingestion behavior diverges across benches/reports/parity tests.
- Shared-module fix:
- Extract shared `loadQueriesFromFile(filePath)` helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 66) Search CLI invocation harness duplicated across evaluators/tests

- Files:
- `tools/reports/compare-models.js`
- `tests/retrieval/parity/parity.test.js`
- `tests/perf/bench/run.test.js`
- `tests/cli/search/search-determinism.test.js`
- `tests/cli/search/search-windows-path-filter.test.js`
- Why this is duplicated:
- Same `search.js` args construction (`--json`, `--stats`, backend/repo/topN flags) and spawn/error handling repeated.
- Risk:
- Search-run semantics and failure handling drift between tooling and tests.
- Shared-module fix:
- Use one shared `runSearchCli({ ... })` helper for all evaluator surfaces.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 67) Duration formatting duplicated in benchmark/parity reporting

- Files:
- `tests/retrieval/parity/parity.test.js`
- `tests/perf/bench/run.test.js`
- Why this is duplicated:
- Both define similar `formatDuration(ms)` logic (`Xm Ys`) instead of shared time formatter usage.
- Risk:
- Reporting formats and unit conversions diverge.
- Shared-module fix:
- Reuse shared duration-format utility.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 68) Index/artifact ensure-build flow duplicated for parity/reporting

- Files:
- `tools/reports/combined-summary.js`
- `tests/retrieval/parity/parity.test.js`
- Why this is duplicated:
- Both implement similar checks for existing index artifacts and fallback build behavior with stub embeddings.
- Risk:
- Build preflight behavior diverges and causes inconsistent parity/report outputs.
- Shared-module fix:
- Extract shared `ensureParityIndexes(...)` helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

- Audit (2026-02-23T00:20:00.000Z): Deep re-audit pass: parity artifact detection now accepts compressed chunk meta and parts/manifest-backed layouts; combined-summary and summary fixture detection aligned to shared artifact checks.

### 69) Mean aggregation helpers duplicated

- Files:
- `tools/reports/compare-models.js`
- `tests/retrieval/parity/parity.test.js`
- Why this is duplicated:
- Equivalent `mean`/`meanNullable` functions are reimplemented.
- Risk:
- Aggregation edge-case behavior diverges.
- Shared-module fix:
- Move to shared stats helper module.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.

### 70) Top-N/limit parsing and query slicing duplicated

- Files:
- `tests/retrieval/parity/parity.test.js`
- `tests/perf/bench/run.test.js`
- Why this is duplicated:
- Both parse and clamp `top`/`limit` with identical defaults and selection logic.
- Risk:
- Query-selection semantics diverge across test/benchmark runners.
- Shared-module fix:
- Create shared query option normalization helper.

- Audit (2026-02-22T22:35:00.000Z): Manual re-audit (8x detail): verified implementation remains complete with no new duplicate-helper regressions in the scoped files.
