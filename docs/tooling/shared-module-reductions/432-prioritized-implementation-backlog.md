# Shared Module Reduction: #432

- Issue: `#432`
- Title: `Shared-module findings reduction and prioritized implementation backlog`
- Reduced: `2026-03-26`
- Updated: `2026-05-21`
- Canonical execution source: `docs/roadmap.md`
- Generated source data: `docs/tooling/shared-module-reductions/432-prioritized-implementation-backlog.json`

## What this does

This backlog reduces the H30/H31/H32 shared-module output into a smaller execution queue grouped by engineering value instead of discovery order. Historical remaining work should be treated as refactor implementation work, not as another discovery pass.

The active objective is to preserve current behavior, reduce overloaded shared surfaces, keep hot-path imports small, and avoid creating generic helpers that only hide domain ownership. As of the 2026-05-21 checkpoint, no known implementation-ready shared-module batch remains open; future work should start only from a fresh governance failure, measured import/performance regression, intentional duplicate-audit refresh, or another roadmap lane with live evidence.

## Current status

1. `P0-tools-shared-runtime-exit` - `done` as of 2026-05-20.
   - `docs/tooling/shared-module-boundary-waivers.json` is empty.
   - `node tools/testing/shared-module-migration.js --check` reports 0 pending recipe rewrites.
   - The boundary guard remains in place to prevent new runtime `src/** -> tools/shared/**` imports.

2. `P1-root-shared-deflation` - `done` as of 2026-05-21.
   - First facade-deflation pass is complete: internal production code now imports narrow concurrency and subprocess owners instead of the root facades.
   - The dead concurrency facade has been deleted after all consumers moved to narrow owners.
   - The dead progress facade has been deleted after consumers moved to `progress-runtime.js` and `progress-context.js`.
   - The dead runtime-envelope facade has been deleted after consumers moved to `runtime-envelope/resolve.js` and `runtime-envelope/env-patch.js`.
   - The dead risk-explain facade has been deleted after consumers moved to `risk-explain-summary.js` and `risk-explain-model.js`.
   - The dead cache facade has been deleted after consumers moved to `cache/layers.js`, `cache/lru.js`, and `cache/size.js`.
   - The dead subprocess facade has been deleted after active consumers and the shared-module performance metric moved to narrow subprocess owners.
   - The legacy CLI entrypoint warning helper has moved from `src/shared/legacy-cli-entrypoint.js` into the existing CLI family at `src/shared/cli/legacy-entrypoint.js`.
   - The bounded object pool helper has moved from the root to `src/shared/workers/bounded-object-pool.js`.
   - The optional artifact sync fallback helper has moved from the root to `src/shared/artifact-io/optional-fallback.js`.
   - The cache CAS helper has split from `src/shared/cache-cas.js` into `src/shared/cache-cas/{paths,metadata,objects,gc,leases}.js`.
   - The auto-policy root facade has been deleted after consumers moved to `src/shared/auto-policy/build.js`.
   - The command-registry root facade has been deleted after consumers moved to `src/shared/command-registry-data.js` and `src/shared/command-registry-query.js`.
   - The ONNX config, run-queue, and tokenization helpers have moved from root files to `src/shared/onnx-embeddings/{config,run-queue,tokenization}.js`.
   - The CLI completions renderer has moved from `src/shared/cli-completions.js` to `tools/cli/completions-renderer.js`.
   - The TUI progress-context env helper has moved from `src/shared/progress-context.js` to `tools/tui/supervisor/progress-context.js`.
   - Runtime capability builder helpers have moved from `src/shared/runtime-capability-builders.js` to `src/shared/runtime-capability/builders.js`.
   - Internal env consumers now import `src/shared/env/{runtime,core,tui}.js` directly instead of the root `src/shared/env.js` facade; the root remains a public compatibility surface.
   - The root `src/shared/files.js` facade has been deleted after active consumers moved to `src/shared/file-paths.js` or `src/shared/file-read.js`.
   - The root `src/shared/json-stream.js` facade has been deleted after active consumers moved to `src/shared/json-stream/{atomic,jsonl-write,jsonl-sharded,json-writers}.js`.
   - The root `src/shared/io/atomic-persistence.js` facade has been deleted after active consumers moved to `src/shared/io/{temp-path,replace-file,replace-dir}.js`.
   - The root `src/shared/index-artifact-helpers.js` helper has been deleted after chunk_meta presence probes moved to `src/shared/artifact-io/chunk-meta-presence.js` and optional fallback/error helpers moved to `src/shared/artifact-io/optional-fallback.js`.
   - Retrieval CLI startup graph is below the tightened performance baseline after relocating newly extracted helper modules into already-loaded owners or lazy paths.
   - Current closure evidence: internal root facade imports for concurrency, subprocess, progress, runtime-envelope, risk-explain, cache, files, JSON stream, atomic persistence, index artifact helpers, artifact-IO, and env have either been deleted or narrowed to public compatibility surfaces with guard tests. Future root shared moves should be driven by a fresh governance failure, a new measured cold-import regression, or a new duplicate-audit refresh rather than this closed P1 batch.
   - Remaining work: none in this batch; reopen only from a fresh concrete P2 adoption, duplicate-code, governance, or performance/import signal.

3. `P1-artifact-io-and-storage-split` - `done` as of 2026-05-21.
   - Break up `artifact-io`, bundle/file helpers, and schema-oriented storage helpers by responsibility.
   - First slices complete: SQLite storage, piece-assembly, retrieval, context-pack, graph, validation, index build, production tooling, and benchmark/tool consumers import direct artifact constants, JSON/JSONL readers, loaders, and manifest owners instead of the root `src/shared/artifact-io.js` facade; bundle path/name/format helpers now import `src/shared/bundle-io-paths.js` or `src/shared/bundle-io-constants.js`; `src/shared/bundle-io.js` now re-exports behavior implemented by `src/shared/bundle-io/{read,write,patch,support}.js`; manifest entry selection lives in `src/shared/artifact-io/manifest-entry-selection.js`; core streaming row dispatch lives in `src/shared/artifact-io/loaders/core-row-stream.js`; binary-columnar JSON row decode lives in `src/shared/artifact-io/loaders/core-binary-columnar-json-rows.js`; JSONL worker compression pooling lives in `src/shared/json-stream/jsonl-compression-pool.js` instead of the batch writer module; and byte accounting/checksum hashing lives in `src/shared/json-stream/byte-counter.js` instead of `streams.js`.
   - Remaining work: none in this batch; downstream P1/P2 batches are complete or checkpoint clean.

4. `P1-concurrency-and-subprocess-core` - `done` as of 2026-05-20.
   - Split correctness-critical lock/process/progress/controller modules into narrower units.
   - Completed slices: tracked subprocess ownership is split into runtime, termination, registration, and scope leaves; stale split flags are closed for runner, kill-tree, and adaptive-controller facades; file-lock acquisition remains in `file-lock.js` while constants, timing, metrics, info parsing, owner probing, stale cleanup, and release behavior live in focused lock leaves.
   - Remaining work: none in this batch; downstream P2 CLI-dispatch cleanup is complete.

5. `P2-cli-dispatch-capability-cleanup` - `done` as of 2026-05-20.
   - Simplify display/render/registry/capability ownership and finish the dispatch env cleanup.
   - First slice complete: `src/shared/cli/display.js` now keeps the public `createDisplay()` facade while `src/shared/cli/display/state.js` owns display task/log state mutation and `src/shared/cli/display/events.js` owns JSONL log/task event writing.
   - Completed follow-through: `src/shared/cli/display/render.js` now delegates layout, palette/theme state, and terminal row-diff writes to `layout.js`, `palette.js`, and `frame.js`; dispatch projection helpers moved into `src/shared/command-registry-query.js`; `src/shared/dispatch/env.js` moved to `bin/dispatch-runtime-env.js`; and runtime-capability flag/surface assembly moved to `src/shared/runtime-capability/surfaces.js`.
   - Remaining work: none in this batch; P2 adoption-and-hoisting follow-through is checkpoint clean.

6. `P2-adoption-and-hoisting-follow-through` - `checkpoint clean` as of 2026-05-21.
   - Scan artifacts, run-node/helper adoption, duplicate-cluster seeds, generated-report sharing, config/generated-surface sharing, and shared-module review sync follow-through have been reduced to concrete validated slices.
   - Current closure evidence: no known behavior-proof timeout selector remains from the scan 20/21 run-node/helper adoption caveats, the saved duplicate-report follow-up, or the indexer-service queue/repair CLI proof follow-up. Generated surfaces plus review artifacts pass freshness/review guards in `temp/validation/roadmap-final-focused-validation-20260521.log`; queue identity split validation passed in `temp/validation/queue-identity-cli-split-validation-20260521.log`; repair CLI runner validation passed in `temp/validation/repair-cli-split-validation-rerun-20260521.log`, which intentionally preserves an initial malformed ESLint invocation, and the corrected repair CLI ESLint proof passed in `temp/validation/repair-cli-split-eslint-rerun-20260521.log`.
   - Remaining work: none known; continue only from a fresh governance failure, a new measured performance/import regression, a future intentional `jscpd` refresh, or another roadmap lane with live evidence.

## Global implementation rules

- Do not reintroduce any `src/** -> tools/shared/**` runtime import. If a runtime caller needs a helper, move or duplicate the minimal stable implementation into `src/shared/**` or a subsystem-local runtime module.
- Prefer hard ownership moves over compatibility wrappers. A temporary barrel is acceptable only when it is the existing public surface and the same change also rewrites direct internal consumers to the narrower destination.
- Keep existing public exports stable until all direct consumers have moved. Then shrink the barrel in the same batch or in the next explicitly scoped cleanup.
- Use exact import-specifier rewrites. Do not run broad semantic codemods for these batches.
- Keep generated files unchanged unless a separate task explicitly owns regeneration.
- When splitting a module, first classify every export as one of: generic primitive, artifact/storage IO, indexing runtime, CLI display, dispatch/capability, process lifecycle, tool-only helper, or domain-local helper. Move only exports with a stable owner.
- Add tests at the level of the moved contract. For pure re-export removals, use existing contract tests and import-shape tests; for behavior moves, add or update the narrow unit test next to the affected family.
- Keep the Node test environment intact. Test commands should use `tests/run.js` whenever the test is registered; direct test helpers must import the repo test-env helper instead of requiring callers to set `PAIROFCLEATS_TESTING=1` manually.
- If an individual validation command runs longer than 30 seconds, cancel it, record it as skipped/too slow, and continue with the next targeted command.

## Shared validation floor

Run these after any batch that changes imports or shared module boundaries:

```powershell
node tools/testing/shared-module-migration.js --check
node tools/testing/shared-module-cycles.js
node tools/testing/shared-module-performance.js --check
node tests/run.js tests/indexing/policy/shared-module-boundary-guard.test.js tests/indexing/policy/shared-module-cycle-guard.test.js tests/indexing/policy/shared-module-ledger.test.js tests/tooling/shared-module-migration.test.js tests/tooling/shared-module-performance.test.js tests/tooling/shared-module-cycles.test.js --lane=all --timeout-ms 30000
```

Run `npm run format` before committing implementation work. For documentation-only edits to this backlog, targeted markdown/link validation is enough if the implementation code did not change.

## P1-root-shared-deflation

### Intent

Deflate the `src/shared` root so it stops acting as a catch-all for domain helpers, runtime policy, and compatibility barrels. The current ledger shows root shared files as the highest-consumer surfaces after P0: `src/shared/cli.js`, `src/shared/hash.js`, `src/shared/artifact-io.js`, `src/shared/env.js`, `src/shared/path-normalize.js`, and `src/shared/number-coerce.js`. The goal is not to move all of these; it is to remove misleading root ownership where a narrower family already exists or should exist.

The following module-family inventory and refactor pattern are historical/future-reopen guidance only. This P1 batch is checkpoint clean; do not treat the inventory as an active implementation queue unless fresh governance, duplicate-audit, performance/import, or roadmap evidence reopens a specific owner.

### Historical/Future-only Module Families To Inspect

- Environment and runtime policy:
  - `src/shared/env.js`
  - `src/shared/env/core.js`
  - `src/shared/env/runtime.js`
  - `src/shared/env/testing.js`
  - `src/shared/runtime-envelope/**`
  - `src/shared/auto-policy.js` (removed)
  - `src/shared/auto-policy/**`
  - `src/shared/repo-cache-config.js`
  - `src/shared/cache-roots.js`
- Root barrels and thin re-exports:
  - `src/shared/concurrency.js` (removed)
  - `src/shared/progress.js` (removed)
  - `src/shared/runtime-envelope.js` (removed)
  - `src/shared/subprocess.js` (removed)
  - `src/shared/command-registry.js` (removed)
  - `src/shared/artifact-io.js`
  - `src/shared/bundle-io.js`
  - `src/shared/cache.js` (removed)
  - `src/shared/risk-explain.js` (removed)
- Domain helpers currently in root:
  - token and text: `src/shared/tokenize.js`, `src/shared/tokenize-*`, `src/shared/token-id.js`, `src/shared/type-*`, `src/shared/lines.js`, `src/shared/truncation.js`
  - embeddings/vector: `src/shared/embedding*.js`, `src/shared/embeddings-cache/**`, `src/shared/onnx-*.js`, `src/shared/dense-vector-*.js`, `src/shared/hnsw.js`, `src/shared/lancedb.js`
  - indexing policy: `src/shared/indexing/**`, `src/shared/index-state-utils.js`, `src/shared/postings-config.js`
  - risk/search: `src/shared/risk-*`, `src/shared/search-request.js`, `src/shared/seed-ref.js`

### Future-only Conservative Refactor Pattern

1. For each target root file, list its exported symbols and current direct consumers with `rg`.
2. Move implementation into an existing family directory when one exists, such as `src/shared/env/**`, `src/shared/indexing/**`, `src/shared/embeddings-cache/**`, `src/shared/concurrency/**`, `src/shared/subprocess/**`, or `src/shared/cli/**`.
3. Keep the root file as a minimal export surface only if external or widespread internal imports still depend on it.
4. Rewrite internal consumers that are clearly in the same family to import the narrow module directly.
5. Delete the root shim only when no consumers remain and the public CLI/runtime surface does not rely on it.

### Current completed hard cuts

- `src/shared/concurrency.js`: deleted after consumers moved to narrow concurrency owner modules. Evidence: `temp/validation/concurrency-facade-removal-20260520-071900.log`.
- `src/shared/progress.js`: deleted after consumers moved to `progress-runtime.js` and the then-existing `progress-context.js`. Evidence: `temp/validation/progress-facade-removal-boundary-no-migration-20260520-073158.log` and `temp/validation/progress-facade-removal-focused-tests-clean-20260520-073235.log`.
- `src/shared/progress-context.js`: moved to `tools/tui/supervisor/progress-context.js` because the only live owner is the TUI supervisor job env propagation path. Evidence: `temp/validation/progress-context-supervisor-owner-clean-20260520-104500.log`.
- `src/shared/runtime-envelope.js`: deleted after consumers moved to `runtime-envelope/resolve.js` and `runtime-envelope/env-patch.js`. Evidence: `temp/validation/runtime-envelope-facade-removal-clean-20260520-073705.log`.
- `src/shared/risk-explain.js`: deleted after consumers moved to `risk-explain-summary.js` and `risk-explain-model.js`. Evidence: `temp/validation/risk-explain-facade-removal-20260520-074411.log`.
- `src/shared/cache.js`: deleted after consumers moved to `cache/layers.js`, `cache/lru.js`, and `cache/size.js`. Evidence: `temp/validation/cache-facade-removal-clean-20260520-075228.log`.
- `src/shared/subprocess.js`: deleted after active consumers moved to `subprocess/{runner,tracking,snapshot,sync-command,options}.js` and the shared-module performance metric moved to `subprocess/runner.js`. Evidence: `temp/validation/subprocess-facade-hard-cut-clean-20260520-085000.log`.
- `src/shared/legacy-cli-entrypoint.js`: moved to `src/shared/cli/legacy-entrypoint.js` so the root shared bucket no longer owns CLI-specific warning policy. Evidence: `temp/validation/legacy-cli-entrypoint-family-clean-20260520-090500.log`.
- `src/shared/bounded-object-pool.js`: moved to `src/shared/workers/bounded-object-pool.js` so root shared no longer owns worker-pool pooling policy. Evidence: `temp/validation/bounded-object-pool-worker-family-clean-20260520-091500.log`.
- `src/shared/optional-artifact-fallback.js`: moved to `src/shared/artifact-io/optional-fallback.js` so root shared no longer owns artifact fallback policy. Evidence: `temp/validation/optional-artifact-fallback-family-clean-20260520-092500.log`.
- `src/shared/cache-cas.js`: split into `src/shared/cache-cas/{paths,metadata,objects,gc,leases}.js` so root shared no longer mixes CAS path/hash, object write/touch, metadata, object enumeration, and lease reads. Evidence: `temp/validation/cache-cas-family-clean-20260520-095000.log`.
- `src/shared/auto-policy.js`: deleted after callers moved to `src/shared/auto-policy/build.js`. Evidence: `temp/validation/auto-policy-facade-removal-clean-20260520-100000.log`.
- `src/shared/command-registry.js`: deleted after callers moved to `src/shared/command-registry-data.js` and `src/shared/command-registry-query.js`; the shared-module performance probe now measures `shared.command-registry.query`. Evidence: `temp/validation/command-registry-facade-removal-clean-20260520-101000.log`.
- `src/shared/onnx-config.js`, `src/shared/onnx-run-queue.js`, and `src/shared/onnx-tokenization.js`: moved to `src/shared/onnx-embeddings/{config,run-queue,tokenization}.js` while keeping the public `src/shared/onnx-embeddings.js` export surface stable. Evidence: `temp/validation/onnx-embedding-helper-family-clean-20260520-102500.log`.
- `src/shared/cli-completions.js`: moved to `tools/cli/completions-renderer.js` because the only live consumer is the completions CLI tool. Evidence: `temp/validation/cli-completions-tool-owner-clean-20260520-103500.log`.
- `src/shared/runtime-capability-builders.js`: moved to `src/shared/runtime-capability/builders.js` because it is only consumed by the runtime-capability manifest assembler. Evidence: `temp/validation/runtime-capability-builder-family-clean-20260520-105500.log`.
- `src/shared/files.js`: deleted after active consumers moved directly to `src/shared/file-paths.js` for path predicates/conversion or `src/shared/file-read.js` for range/existence/safe JSON reads.
- `src/shared/json-stream.js`: deleted after active consumers moved directly to `json-stream/atomic.js`, `json-stream/jsonl-write.js`, `json-stream/jsonl-sharded.js`, or the new `json-stream/json-writers.js`.
- `src/shared/io/atomic-persistence.js`: deleted after active consumers moved directly to `io/temp-path.js`, `io/replace-file.js`, and `io/replace-dir.js`.
- `src/shared/index-artifact-helpers.js`: deleted after chunk_meta presence probes moved directly to `src/shared/artifact-io/chunk-meta-presence.js` and optional fallback/error helpers moved to `src/shared/artifact-io/optional-fallback.js`. Evidence: `temp/validation/index-artifact-helper-split-clean-20260520-110119.log`.
- `src/shared/env.js`: retained as the public env facade, but internal callers under `bin`, `src`, `tools`, and `tests` now import `env/runtime.js`, `env/core.js`, or `env/tui.js` directly. `tests/tooling/shared-adoption-contract.test.js` enforces the no-new-internal-root-env-import rule. Evidence: `temp/validation/env-facade-deflation-20260521.log`.

### Acceptance criteria

- No new root-level shared file is added unless it is a genuinely generic primitive.
- Each moved export has one clear owner directory and one clear contract test or existing test family.
- Existing import surfaces used by CLI entrypoints still load without expanding the measured shared-module import graph.
- `src/shared/dict-utils.js` remains a real runtime owner, not a bridge back to `tools/shared/dict-utils.js`.
- Root barrels that remain are documented by their export list and do not import unrelated heavy domains as a side effect.

### 2026-05-20 first-pass evidence

- Production `src/**` imports no longer target `src/shared/concurrency.js`; all current call sites use the narrow owners under `src/shared/concurrency/**`.
- Production `src/**` imports no longer target `src/shared/subprocess.js`; all current call sites use the narrow owners under `src/shared/subprocess/**`.
- Tool and test consumers were migrated off `shared/concurrency.js`; the boundary scan found no `shared/concurrency.js` imports under `src`, `tests`, `tools`, `bin`, `extensions`, or `sublime`.
- The new helper modules `src/index/tooling/pyright-paths.js`, `src/retrieval/output/filters/docmeta.js`, `src/index/build/build-state/lock-owner.js`, and `src/storage/sqlite/build/dense-metadata.js` were removed from the retrieval CLI graph by moving their contracts into already-loaded owners. `src/shared/bundle-patch.js` remains worker-owned and is lazy-loaded only from the async bundle patch write path.
- `node tools/testing/shared-module-migration.js --check`, `node tools/testing/shared-module-cycles.js`, and `node tools/testing/shared-module-performance.js --check` passed in `temp/validation/p1-root-shared-deflation-boundary-20260520-070415.log`; `retrieval.cli` stayed at 1,134 transitive local modules.
- Focused shared-module tests passed: 24 passed, 0 failed, 0 timeouts, 0 skipped in `temp/validation/p1-root-shared-deflation-focused-tests-20260520-070608.log`.
- Focused helper-relocation tests passed: 11 passed, 0 failed, 0 timeouts, 0 skipped in `temp/validation/p1-root-shared-deflation-helper-relocation-tests-20260520-070655.log`.
- Targeted syntax and ESLint checks passed in `temp/validation/p1-root-shared-deflation-syntax-20260520-070339.log` and `temp/validation/p1-root-shared-deflation-eslint-20260520-070733.log`.

### 2026-05-20 subprocess facade consumer follow-through

- Tools, tests, and `bin/pairofcleats.js` no longer import `src/shared/subprocess.js`; they import the narrow owners under `src/shared/subprocess/{runner,tracking,snapshot,sync-command,options}.js`.
- Child-process test snippets that execute with `node --input-type=module -e` use repo-root-relative narrow imports so they preserve their original execution context.
- Syntax and ESLint passed for the 66-file affected subprocess consumer set in `temp/validation/subprocess-facade-import-migration-syntax-20260520-071404.log` and `temp/validation/subprocess-facade-import-migration-eslint-20260520-071416.log`.
- Focused subprocess/tooling validation passed with 33 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/subprocess-facade-import-migration-focused-tests-clean-20260520-071631.log`.
- Boundary, migration, cycle, and performance checks passed in `temp/validation/subprocess-facade-import-migration-boundary-20260520-071712.log`; `shared.subprocess` stayed at 16 transitive local modules and `retrieval.cli` stayed at 1,134.
- Final hard cut: `src/shared/subprocess.js` is removed, `tests/shared/subprocess/tracked-leak-fails-process.test.js` imports `subprocess/tracking.js` in its child fixture, and `tools/testing/shared-module-performance.js` now measures `shared.subprocess.runner` at `src/shared/subprocess/runner.js`. Final validation is logged at `temp/validation/subprocess-facade-hard-cut-clean-20260520-085000.log`; `shared.subprocess.runner` measures 3 direct imports and 14 transitive local modules, and `retrieval.cli` measures 1,130 transitive local modules.

### 2026-05-20 concurrency facade removal

- `src/shared/concurrency.js` was deleted after `rg` confirmed no `shared/concurrency.js` references remained under `src`, `tests`, `tools`, `bin`, `extensions`, or `sublime`.
- The narrow owner modules remain `src/shared/concurrency/run-with-queue.js`, `src/shared/concurrency/scheduler-core.js`, `src/shared/concurrency/queue-adapter.js`, `src/shared/concurrency/task-queues.js`, and `src/shared/concurrency/ordered-completion.js`.
- Cycles and shared-module performance passed in `temp/validation/concurrency-facade-removal-20260520-071900.log`; the scan covered 313 shared files after the deletion and `retrieval.cli` stayed at 1,134 transitive local modules.

### 2026-05-20 progress facade removal

- `src/shared/progress.js` was deleted after consumers moved to narrow owners; `src/shared/progress-runtime.js` remains the shared logging/progress handler owner, and progress context env propagation now lives in `tools/tui/supervisor/progress-context.js`.
- Root-progress imports are gone under `build_index.js`, `src`, `tests`, `tools`, `bin`, `extensions`, and `sublime`.
- Syntax and ESLint passed for the affected import set in `temp/validation/progress-facade-removal-syntax-clean-20260520-072842.log` and `temp/validation/progress-facade-removal-eslint-clean-20260520-072842.log`.
- Cycles and shared-module performance passed in `temp/validation/progress-facade-removal-boundary-no-migration-20260520-073158.log`; `shared.artifact-io` dropped to 71 transitive local modules and `retrieval.cli` dropped to 1,132 at that checkpoint. `node tools/testing/shared-module-migration.js --check` exceeded 30 seconds in this slice and was recorded as skipped in the same log.
- Focused progress, artifact manifest, build-state, and SCM tests passed with 5 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/progress-facade-removal-focused-tests-clean-20260520-073235.log`.

### 2026-05-20 runtime-envelope facade removal

- `src/shared/runtime-envelope.js` was deleted after consumers moved to `src/shared/runtime-envelope/resolve.js` and `src/shared/runtime-envelope/env-patch.js`.
- Root-runtime-envelope imports are gone under `build_index.js`, `src`, `tests`, `tools`, `bin`, `extensions`, and `sublime`.
- Syntax, ESLint, root import scan, cycles, shared-module performance, and focused runtime/config/scheduler tests passed in `temp/validation/runtime-envelope-facade-removal-clean-20260520-073705.log`; the focused runner summary was 4 passed, 0 failed, 0 timeouts, and 0 skipped. `retrieval.cli` was 1,131 transitive local modules in the final performance checkpoint.

### 2026-05-20 risk-explain facade removal

- `src/shared/risk-explain.js` was deleted after consumers moved to `src/shared/risk-explain-summary.js` and `src/shared/risk-explain-model.js`.
- Root-risk-explain imports are gone under `src`, `tests`, `tools`, `bin`, `extensions`, and `sublime`.
- Syntax, ESLint, root import scan, cycles, shared-module performance, and focused risk/context-pack/retrieval/service tests passed in `temp/validation/risk-explain-facade-removal-20260520-074411.log`; the focused runner summary was 6 passed, 0 failed, 0 timeouts, and 0 skipped. `retrieval.cli` remained 1,131 transitive local modules.

### Targeted validation

```powershell
node tools/testing/shared-module-performance.js --check
node tools/testing/shared-module-cycles.js
node tests/run.js tests/shared/runtime/runtime-contract-matrix.test.js tests/shared/runtime/env-envelope-overrides.test.js tests/shared/env-boolean-case-insensitive.test.js tests/shared/search-request-contract.test.js tests/shared/indexing/build-pointer.test.js tests/shared/indexing/progress-timeout-policy.test.js tests/shared/indexing/stage1-watchdog-policy.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/retrieval/cli/run-search-module-load.test.js tests/cli/search/startup-profiler.test.js tests/cli/general/cli.test.js --lane=all --timeout-ms 30000
```

### Performance and quality guidance

- Treat `src/shared/env.js`, `src/shared/cli.js`, `src/shared/progress-runtime.js`, `src/shared/artifact-io.js`, and `src/shared/subprocess/runner.js` as startup-sensitive. Do not add heavy transitive imports to them.
- Do not move hot-path tokenization, path normalization, or hashing behind an abstraction that allocates closures, option objects, or per-call regular expressions.
- Do not hoist domain-local indexing helpers into generic root helpers just because their filenames are common (`runtime`, `policy`, `state`, `registry`, `shared`).
- Keep environment reads centralized. Do not scatter direct `process.env.PAIROFCLEATS_*` access outside the existing env/shared helpers.

## P1-artifact-io-and-storage-split

### Intent

Make artifact, bundle, file, and storage helper ownership narrower without weakening streaming behavior. This family is performance-sensitive because it reads large JSONL, compressed artifacts, binary columnar payloads, token postings, minhash signatures, chunk metadata, and SQLite build inputs.

The following module-family inventory and refactor pattern are future-reopen guidance only. The P1 artifact/storage batch is complete for the current checkpoint.

### Historical/Future-only Module Families To Inspect

- Artifact IO public surfaces:
  - `src/shared/artifact-io.js`
  - `src/shared/artifact-io/constants.js`
  - `src/shared/artifact-io/json.js`
  - `src/shared/artifact-io/jsonl.js`
  - `src/shared/artifact-io/binary-columnar.js`
  - `src/shared/artifact-io/offsets.js`
  - `src/shared/artifact-io/manifest*.js`
  - `src/shared/artifact-io/loaders.js`
  - `src/shared/artifact-io/loaders/**`
  - `src/shared/artifact-io/cache.js`
  - `src/shared/artifact-io/fs.js`
  - `src/shared/artifact-io/compression.js`
  - `src/shared/artifact-io/checksum.js`
- Bundle and file helpers:
  - `src/shared/bundle-io.js`
  - `src/shared/bundle-io-paths.js`
  - `src/shared/bundle-io-constants.js`
  - `src/shared/bundle-io-checksum.js`
  - `src/shared/bundle-checksum.js`
  - `src/shared/file-read.js`
  - `src/shared/file-signature.js`
  - `src/shared/file-stats.js`
  - `src/shared/io/**`
  - `src/shared/json-stream/**`
- Storage/indexing consumers:
  - `src/storage/sqlite/build/**`
  - `src/storage/sqlite/build/from-artifacts/**`
  - `src/storage/sqlite/build/incremental-update/**`
  - `src/index/build/artifacts/**`
  - `src/index/build/artifacts-write/**`
  - `src/index/build/file-processor/cached-bundle.js`
  - `src/index/validate/artifacts.js`
  - `src/integrations/tooling/api-contracts.js`

### Future-only Conservative Refactor Pattern

1. Split by data responsibility, not by current file size:
   - manifest discovery and read plans stay under `artifact-io/manifest*`;
   - row streaming stays under `artifact-io/json/**` or `json-stream/**`;
   - binary columnar frame reading stays under `artifact-io/binary-columnar*`;
   - loader orchestration stays under `artifact-io/loaders/**`;
   - filesystem/path safety stays under `artifact-io/fs.js`, `src/shared/file-paths.js`, `src/shared/file-read.js`, or `src/shared/io/**` depending on scope.
2. Keep `src/shared/artifact-io.js` as a public export facade only while consumers are migrating. Do not add new implementation to it.
3. Move storage-only schema/docmeta behavior to `src/contracts/**` or `src/storage/**` if it encodes storage contract semantics rather than generic artifact reading.
4. When splitting bundle helpers, separate:
   - naming and shard path derivation;
   - bundle format normalization;
   - checksum and integrity policy;
   - streaming reads/writes;
   - manifest compatibility.
5. Preserve streaming and allocation behavior. Any move from iterator/stream APIs to full materialization is a regression unless the test fixture proves bounded size.

### Current progress

- 2026-05-20 storage/piece-assembly direct-import slice:
  - `src/storage/sqlite/utils.js` now imports `MAX_JSON_BYTES`, artifact loaders, and `readJsonFile` from their direct artifact-io owner modules.
  - `src/storage/sqlite/build/from-artifacts/sources.js` now imports constants, JSONL streaming, JSONL required-key resolution, loaders, and manifest/shard helpers from direct artifact-io owner modules.
  - `src/storage/sqlite/build/runner/chunk-meta.js` now imports manifest read/presence helpers and constants directly.
  - `src/index/build/piece-assembly/load.js` and `src/index/build/piece-assembly/helpers.js` now import loader, manifest, and JSON helpers directly.
  - `tests/tooling/shared-module-performance.test.js` now asserts the current `shared.command-registry.query` performance metric created by the command-registry hard cut.
  - `node tools/docs/shared-module-ledger.js` reports `src/shared/artifact-io.js` at 66 direct consumers after this slice.
  - Evidence: `temp/validation/artifact-io-storage-direct-import-regenerate-20260520-110500.log`, `temp/validation/artifact-io-storage-direct-import-boundary-clean-20260520-111700.log`, and `temp/validation/artifact-io-storage-direct-import-focused-tests-clean-20260520-111500.log`.
- 2026-05-20 bundle helper import-deflation slice:
  - Bundle path/name/format helpers moved to direct imports from `src/shared/bundle-io-paths.js`.
  - `BUNDLE_CHECKSUM_SCHEMA_VERSION` consumers moved to direct imports from `src/shared/bundle-io-constants.js`.
  - `src/shared/bundle-io.js` now retains behavior-facing direct consumers for `readBundleFile`, `writeBundleFile`, `writeBundlePatch`, and `removeBundleWriteArtifacts`.
  - `node tools/docs/shared-module-ledger.js` reports `src/shared/bundle-io.js` at 9 direct consumers after this slice.
  - Evidence: `temp/validation/bundle-io-helper-import-regenerate-20260520-113000.log` and `temp/validation/bundle-io-helper-imports-clean-20260520-113300.log`.
- 2026-05-20 bundle behavior owner split:
  - `src/shared/bundle-io.js` is a re-export-only public facade.
  - `src/shared/bundle-io/read.js` owns `readBundleFile` and patch application before checksum verification.
  - `src/shared/bundle-io/write.js` owns `writeBundleFile` and `removeBundleWriteArtifacts`.
  - `src/shared/bundle-io/patch.js` owns `writeBundlePatch`, patch validation/application, patch metadata accounting, and append-vs-rewrite behavior.
  - `src/shared/bundle-io/support.js` owns shared worker offload, checksum sidecar writes, patch cleanup, and file-removal helpers without importing read/write/patch owners.
  - `tools/docs/shared-module-ledger.js` classifies `src/shared/bundle-io/**` under issue `#411`.
  - Evidence: `temp/validation/bundle-io-behavior-split-regenerate-20260520-114300.log` and `temp/validation/bundle-io-behavior-split-clean-20260520-114500.log`.
- 2026-05-20 manifest entry-selection split:
  - `src/shared/artifact-io/manifest-entry-selection.js` now owns manifest piece indexing, sorted entry selection, named path lookup, binary-columnar sidecar lookup, piece-by-path matching, and canonical compressed/hot-layout variant selection.
  - `src/shared/artifact-io/manifest-sources.js` now focuses on source resolution, fallback behavior, artifact presence, and binary/directory artifact path resolution.
  - Evidence: `temp/validation/manifest-entry-selection-split-clean-20260520-115800.log` and `temp/validation/manifest-entry-selection-regenerate-20260520-120000.log`.
- 2026-05-20 binary-columnar domain adapter split:
  - `src/shared/artifact-io/loaders/binary-columnar.js` now owns generic binary-columnar frame metadata, row slicing, budget checks, and shared metadata validation.
  - `src/shared/artifact-io/loaders/binary-columnar-chunk-meta.js` owns `chunk_meta` binary-columnar layout resolution, file-table row expansion, and optional materialized load behavior, and is lazy-loaded by the async `chunk_meta` reader.
  - `src/shared/artifact-io/loaders/token-postings.js` keeps `token_postings` binary-columnar layout resolution, varint posting-pair decode, and cardinality invariants inline because `loadTokenPostings` remains synchronous.
  - Evidence: `temp/validation/binary-columnar-lazy-adapter-clean-20260520-124500.log` and `temp/validation/artifact-loader-splits-final-regenerate-20260520-135000.log`.
- 2026-05-20 columnar row helper split:
  - `src/shared/artifact-io/columnar-rows.js` now owns pure columnar row context, row creation, materialized row inflation, and streaming row iteration.
  - `src/shared/artifact-io/loaders/shared.js` no longer carries columnar row helpers; it stays focused on loader errors, cache reads, metadata envelope normalization, shard gap checks, and offset validation.
  - `src/storage/sqlite/build/from-artifacts/sources.js` imports columnar inflation from the artifact family owner instead of loader internals.
  - Evidence: `temp/validation/columnar-rows-family-split-clean-20260520-122000.log` and `temp/validation/artifact-loader-splits-final-regenerate-20260520-135000.log`.
- 2026-05-20 retrieval/import-graph artifact facade deflation:
  - Retrieval, context-pack, graph, validation, SQLite, and index build paths that are reachable from `retrieval.cli` now import artifact constants, JSON readers, manifest helpers, and loader owners directly instead of broad artifact facades.
  - `src/shared/artifact-io.js` stays at the shared-module performance baseline of 73 transitive local modules, and `retrieval.cli` is back below baseline at 1,132 transitive local modules.
  - Evidence: `temp/validation/sqlite-index-state-artifact-direct-import-clean-20260520-134500.log` and `temp/validation/artifact-loader-splits-final-regenerate-20260520-135000.log`.
- 2026-05-21 production/tool artifact facade deflation:
  - Remaining production and tool consumers under `src/**` and `tools/**` now import artifact constants, JSON readers, loaders, and manifest helpers from `src/shared/artifact-io/{constants,json,loaders,manifest}.js` instead of the root `src/shared/artifact-io.js` facade.
  - The current `rg -n 'artifact-io\.js' src tools --glob '*.js'` audit leaves only intentional string literal references in `tools/docs/shared-module-ledger.js` and `tools/testing/shared-module-performance.js`.
  - Syntax, targeted ESLint, shared-module migration/cycles/performance, 9 focused tests, and `git diff --check` passed in `temp/validation/artifact-io-root-deflation-rerun-20260521.log`; the pre-fix duplicate import caught by `node --check` remains recorded in `temp/validation/artifact-io-root-deflation-20260521.log`.

### Completed implementation slices

1. Remaining artifact loader internal splits are complete: source resolution, materialized payloads, streaming row dispatch, binary-columnar context/checksum/JSON rows, file_meta, and chunk_meta behavior have narrow owners.
2. Atomic persistence mechanics stay under `src/shared/io/{temp-path,replace-file,replace-dir,persistence-helpers}.js`; no root persistence barrel remains.
3. Schema/docmeta helpers have already moved out of generic `src/shared` storage buckets into contracts or metadata owners.
4. Production and tool artifact consumers no longer import the root artifact facade; the root remains a public/test compatibility surface instead of a default internal implementation dependency.

### Acceptance criteria

- `src/shared/artifact-io.js` contains only intentional public exports and does not grow its direct or transitive local import count beyond the performance baseline.
- Manifest readers, offset readers, JSONL row readers, binary columnar readers, and loader orchestration each have narrow owners and targeted tests.
- SQLite build and retrieval paths continue to accept compressed JSONL, binary columnar artifacts, packed postings, sharded chunk metadata, and fallback manifests.
- Path traversal and `..` prefix checks remain fail-closed for manifest and binary-columnar payloads.
- No storage schema helper is moved into a generic IO module unless it is schema-agnostic.

### Targeted validation

```powershell
node tools/testing/shared-module-performance.js --check
node tests/run.js tests/shared/artifact-io/spec-contract.test.js tests/shared/artifact-io/manifest-streaming.test.js tests/shared/artifact-io/manifest-read-plan.test.js tests/shared/artifact-io/loader-fallbacks.test.js tests/shared/artifact-io/prefer-binary-columnar-loaders.test.js tests/shared/artifact-io/jsonl-stream-roundtrip.test.js tests/shared/artifact-io/binary-columnar-streaming-frames.test.js tests/shared/artifact-io/offsets-unified.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/shared/io/atomic-write-contract.test.js tests/shared/io/atomic-persistence-contract.test.js tests/shared/io/bundle-io-checksum-fail-closed.test.js tests/shared/json-stream/large-array-stream.test.js tests/shared/json-stream/atomic-replace.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/storage/sqlite/chunk-meta-streaming.test.js tests/storage/sqlite/jsonl-streaming-gzip.test.js tests/storage/sqlite/jsonl-streaming-zstd.test.js tests/storage/sqlite/bundle-loader-worker.test.js tests/storage/sqlite/build-full-transaction.test.js tests/storage/sqlite/incremental/manifest-normalization.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/indexing/artifacts/artifact-formats.test.js tests/indexing/artifacts/artifact-io-manifest-discovery.test.js tests/indexing/artifacts/token-postings-binary-columnar-streaming.test.js tests/indexing/artifacts/chunk-meta-binary-eager-start.test.js --lane=all --timeout-ms 30000
```

### Performance and quality guidance

- Do not replace streaming JSONL reads with `JSON.parse` on full files for artifact rows, token postings, chunk metadata, file meta, graph relations, or minhash rows.
- Do not duplicate gzip/zstd fallback logic in consumers. Keep compression decisions in the artifact/json-stream family.
- Avoid extra checksum passes when a manifest already provides a verified piece checksum. Reuse existing checksum context helpers.
- Do not hoist SQLite-specific build batching or transaction logic into artifact IO. That belongs in `src/storage/sqlite/build/**`.
- Keep memory-sensitive tests in the validation set when touching streaming, binary columnar, or large-array code.

## P1-concurrency-and-subprocess-core

### Intent

Reduce correctness risk in process supervision, lock files, progress, and adaptive scheduling. These modules sit on critical execution paths for indexing, build runners, language tooling providers, and service shutdown.

The following module-family inventory and refactor pattern are future-reopen guidance only. The P1 concurrency/subprocess batch is complete for the current checkpoint.

### Historical/Future-only Module Families To Inspect

- Subprocess and process lifecycle:
  - `src/shared/subprocess.js` (removed)
  - `src/shared/subprocess/**`
  - `src/shared/kill-tree.js`
  - `src/shared/kill-tree/**`
  - `src/shared/process-signals.js`
  - `src/shared/piscina-cleanup.js`
  - `src/integrations/core/build-index/runtime.js`
  - `src/integrations/tooling/lsp/client.js`
  - `tools/service/subprocess-log.js`
- Locks:
  - `src/shared/locks/file-lock.js`
  - `src/shared/locks/file-lock-runtime.js`
  - `src/index/build/lock.js`
  - `src/index/build/watch/lock.js`
- Concurrency and scheduler:
  - `src/shared/concurrency.js`
  - `src/shared/concurrency/**`
  - `src/shared/concurrency/scheduler-core/**`
  - `src/index/build/indexer/steps/process-files/**`
  - `src/index/build/tree-sitter-scheduler/**`
- Progress:
  - `src/shared/progress-runtime.js`
  - `src/shared/progress-events.js`
  - `tools/tui/supervisor/progress-context.js`
  - `src/shared/cli/progress-*`
  - `src/index/build/indexer/steps/process-files/progress.js`
  - `src/integrations/core/build-index/progress.js`

### Current progress

- Tracking split complete: `src/shared/subprocess/tracking.js` is now a public facade over `tracking-runtime.js`, `tracking-terminate.js`, `tracking-register.js`, and `tracking-scope.js`. Scope propagation, child registration, runtime bookkeeping, and termination flow are no longer interleaved in one file; startup-sensitive `src` paths import narrow leaves directly, and heavy indexing/tooling modules lazy-load the scope-only owner. Evidence: `temp/validation/tracking-split-regenerate-20260520-112726.log` and `temp/validation/subprocess-tracking-split-clean-20260520-112813.log`.
- Stale split flags closed: `src/shared/subprocess/runner.js` is already a facade over async/sync/error leaves, `src/shared/kill-tree.js` already delegates to platform-specific leaves, and `src/shared/concurrency/scheduler-core/adaptive-controller.js` already composes signal, snapshot, surface-controller, and token-controller leaves.
- File-lock runtime split complete: `src/shared/locks/file-lock.js` stays the public acquisition facade; `file-lock-runtime.js` is now an internal aggregation surface over `file-lock-constants.js`, `file-lock-timing.js`, `file-lock-metrics.js`, `file-lock-info.js`, `file-lock-owner.js`, `file-lock-stale.js`, and `file-lock-release.js`. Build/tooling paths imported by retrieval CLI lazy-load lock behavior at execution time, keeping `retrieval.cli` under the shared-module performance baseline. Evidence: `temp/validation/file-lock-runtime-split-regenerate-20260520-114241.log` and `temp/validation/file-lock-runtime-split-clean-20260520-114241.log`.
- Remaining active split target in this batch: none.

### Future-only Conservative Refactor Pattern

1. Split state, policy, and side effects:
   - subprocess command option normalization;
   - async runner execution;
   - sync runner execution;
   - child-process tracking registry;
   - termination and signal binding;
   - snapshot/diagnostic capture;
   - Windows command invocation normalization.
2. Keep lock-file acquisition, stale detection, release, and runtime diagnostics separate. Do not mix file-lock semantics with build-watch policy.
3. For scheduler-core, avoid changing behavior while moving code. Extract config parsing, adaptive signal capture, dispatch, queue lifecycle, and shutdown one piece at a time.
4. Keep the subprocess family split by narrow owner. `src/shared/subprocess.js`, `src/shared/concurrency.js`, and `src/shared/progress.js` root facades have already been removed.
5. When consumers are internal to one family, import the narrow module directly after the extraction.

### Acceptance criteria

- Process timeout, abort, signal, detached/unref, output capture, and cleanup semantics are unchanged.
- Tracked subprocess cleanup remains scoped; nested signal scopes do not leak handlers.
- Lock tests still cover stale locks, release behavior, and fail-closed error paths.
- Scheduler tests still cover pending limits, byte limits, fd pressure, nested deadlock prevention, abort behavior, and shutdown drain.
- Progress output remains deterministic for TTY, non-TTY, JSONL, quiet, and verbose modes.

### Targeted validation

```powershell
node tools/testing/shared-module-performance.js --check
node tests/run.js tests/shared/subprocess/timeout-kills-child.test.js tests/shared/subprocess/abort-kills-child.test.js tests/shared/subprocess/sync-command-timeout.test.js tests/shared/subprocess/tracked-shutdown-cleanup.test.js tests/shared/subprocess/tracked-signal-scope-binding.test.js tests/shared/subprocess/windows-cmd.test.js tests/tooling/service/subprocess-contract-matrix.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/shared/locks/file-lock-contract.test.js tests/indexing/build/stage-progression-contract.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/shared/concurrency/scheduler-contract.test.js tests/shared/concurrency/scheduler-core-modularization.test.js tests/shared/concurrency/scheduler-shutdown-drain.test.js tests/shared/concurrency/scheduler-stage1-proc-nested-deadlock.test.js tests/shared/concurrency/run-with-queue-contract-matrix.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/shared/progress/contract-matrix.test.js tests/shared/progress-events.test.js tests/indexing/stage1/process-files-progress-heartbeat.test.js tests/indexing/runtime/process-files-progress-module.test.js --lane=all --timeout-ms 30000
```

### Performance and quality guidance

- Do not add per-task timers, listeners, or closures in scheduler hot paths unless existing tests prove bounded cleanup.
- Do not make process tracking global in a way that crosses isolated test/process scopes.
- Do not weaken fail-fast behavior for invalid abort signals or invalid subprocess options.
- Do not mix display formatting with scheduler policy. Progress formatting can depend on snapshots; scheduler control must not depend on render modules.
- Preserve Windows command quoting and shell-metacharacter tests when touching subprocess invocation.

## P2-cli-dispatch-capability-cleanup

### Intent

Separate CLI presentation, command metadata, dispatch resolution, and runtime capability projection. This is lower risk than storage and process work but still important because CLI startup and help output are broad user-facing surfaces.

### Current progress

- `src/shared/cli/display.js` has been split enough to keep `createDisplay()` as a facade over display-internal owners. Task state, log coalescing, reset preservation, and task mutation live in `src/shared/cli/display/state.js`; JSONL log/task event writing lives in `src/shared/cli/display/events.js`; safe-stream, terminal, text, progress math, and rendering remain in their existing display-family owners. Evidence: `temp/validation/cli-display-state-events-split-syntax-eslint-20260520-120352.log`, `temp/validation/cli-display-state-events-split-focused-tests-20260520-120403.log`, and `temp/validation/cli-display-state-events-split-regenerate-20260520-120416.log`.
- `src/shared/cli/display/render.js` now focuses on row assembly. Task ordering, label sizing, ETA/rate/detail layout, and adaptive bar width live in `src/shared/cli/display/layout.js`; palette scheme state, task color assignment, shade scales, and background inheritance live in `src/shared/cli/display/palette.js`; frame construction and terminal row-diff writes live in `src/shared/cli/display/frame.js`. Evidence: `temp/validation/cli-display-render-split-syntax-eslint-20260520-121416.log` and `temp/validation/cli-display-render-split-focused-tests-clean-20260520-121425.log`. `perf/bench/run` exceeded the 30-second repository cutoff and is recorded as skipped/too slow in `temp/validation/cli-display-render-split-focused-tests-20260520-121247.log`.
- Dispatch registry projection helpers now live in `src/shared/command-registry-query.js`; `src/shared/dispatch/registry.js` is a thin public facade preserving existing dispatch exports. Evidence: `temp/validation/dispatch-registry-projection-syntax-full-20260520-121003.log`, `temp/validation/dispatch-registry-projection-eslint-20260520-120838.log`, and `temp/validation/dispatch-registry-projection-focused-tests-20260520-120947.log`.
- The CLI dispatch runtime-env adapter moved from `src/shared/dispatch/env.js` to `bin/dispatch-runtime-env.js`, removing the `src/shared` dependency on tool config helpers while preserving the CLI behavior and runtime contract tests. Evidence: `temp/validation/dispatch-runtime-env-relocation-syntax-eslint-20260520-121550.log` and `temp/validation/dispatch-runtime-env-relocation-focused-tests-20260520-121559.log`.
- Runtime-capability flag-set and surface assembly moved from `src/shared/runtime-capability-manifest.js` to `src/shared/runtime-capability/surfaces.js`; the manifest file remains the public API over runtime probes, risk features, and assembled surfaces. Evidence: `temp/validation/runtime-capability-surfaces-split-syntax-eslint-20260520-121703.log` and `temp/validation/runtime-capability-surfaces-split-focused-tests-20260520-121716.log`.
- Stale doc targets in this batch are closed or downgraded: `src/shared/command-registry.js`, `src/shared/cli-completions.js`, and `src/shared/runtime-capability-builders.js` are gone; `src/shared/cli-options.js` is already split into option-set and validator owners; `src/shared/dispatch/manifest.js` is gone, so dispatch projection cleanup should target the live `src/shared/dispatch/registry.js`.
- This batch has no remaining implementation target. P2 adoption-and-hoisting follow-through is checkpoint clean; the module-family inventory and refactor pattern below are retained only as future-reopen guidance, not as active work. Reopen only from fresh evidence rather than the historical scan artifacts alone.

### Historical/Future-only Module Families To Inspect

- CLI core:
  - `src/shared/cli.js`
  - `src/shared/cli/legacy-entrypoint.js`
  - `src/shared/cli-options.js`
  - `src/shared/cli-option-sets.js`
  - `src/shared/cli-option-validators.js`
  - `src/shared/cli-completions.js`
  - `bin/pairofcleats.js`
  - `bin/pairofcleats-tui.js`
- Display/render:
  - `src/shared/cli/display.js`
  - `src/shared/cli/display/events.js`
  - `src/shared/cli/display/frame.js`
  - `src/shared/cli/display/layout.js`
  - `src/shared/cli/display/palette.js`
  - `src/shared/cli/display/state.js`
  - `src/shared/cli/display/**`
  - `src/retrieval/cli/render.js`
  - `src/retrieval/cli/render-output.js`
  - `tools/shared/cli-display.js`
  - `tools/reports/show-throughput/render.js`
- Registry and capability:
  - `src/shared/command-registry-data.js`
  - `src/shared/command-registry-query.js`
  - `src/shared/command-aliases.js`
  - `src/shared/capabilities.js`
  - `src/shared/runtime-capability-manifest.js`
  - `src/shared/runtime-capability/builders.js`
  - `src/shared/runtime-capability/surfaces.js`
  - `src/shared/runtime-capability-specs.js`
  - `tools/ci/check-command-surface.js`
- Dispatch:
  - `bin/dispatch-runtime-env.js`
  - `src/shared/dispatch/registry.js`
  - `src/shared/dispatch/resolve.js`
  - `tools/dispatch/manifest.js`
  - `tools/ci/check-command-surface.js`

### Future-only Conservative Refactor Pattern

1. Keep command registry data pure. Do not let display modules, process execution, or environment reads enter `command-registry-data.js`.
2. Keep query helpers pure and deterministic. They may shape command metadata but should not read runtime capabilities directly.
3. Keep capability manifest projection in the runtime capability family. The command registry can be an input, not a dependency sink for CLI render code.
4. Split display render code by concern: ANSI/color/cursor primitives, progress bar rendering, terminal stream management, text formatting, and high-level display orchestration.
5. For dispatch env cleanup, preserve exact CLI environment behavior and avoid moving tool-only manifest logic into runtime `src/shared/**` unless it is consumed by runtime code.

### Acceptance criteria

- `pairofcleats help`, command-specific help, shell completions, command aliases, and hidden-topic behavior remain unchanged.
- Runtime capability manifest command IDs match the command registry and config dump surfaces.
- Display modules do not pull command execution or storage/indexing dependencies into startup.
- `src/shared/dispatch/**` owns runtime dispatch helpers only; tool-only manifest generation stays in `tools/**`.
- Thin wrappers are removed only after imports are migrated and tests prove parity.

### Targeted validation

```powershell
node tools/testing/shared-module-performance.js --check
node tests/run.js tests/cli/general/cli.test.js tests/cli/general/help-hidden-topics.test.js tests/cli/general/cli-completions-and-audit.test.js tests/cli/general/cli-options-schema-drift.test.js tests/cli/search/help-surface.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/dispatch/command-registry-parity.test.js tests/dispatch/manifest-list.test.js tests/dispatch/manifest-describe-search.test.js tests/dispatch/search-flag-passthrough.test.js tests/tooling/ci/command-surface-audit.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/shared/runtime-capability-manifest-contract.test.js tests/services/mcp/capabilities-payload.test.js tests/tooling/reports/capabilities-report.test.js --lane=all --timeout-ms 30000
```

### Performance and quality guidance

- Keep `src/shared/command-registry-query.js` and `src/shared/runtime-capability-manifest.js` within their shared-module performance baselines.
- Do not import `terminal-kit`, storage backends, LSP providers, or artifact loaders from command registry or help rendering modules.
- Do not hoist CLI text formatting into generic shared text helpers unless it is independent of terminal state, command metadata, and progress semantics.
- Avoid changing help text order unless the test update and product decision are part of the same batch.

## P2-adoption-and-hoisting-follow-through

### Intent

Use the scan artifacts and duplicate-cluster seeds to choose narrow, high-value migrations. This batch should not become a broad "shared everything" program. It should reduce repeated code where the destination is already proven and where the resulting import graph is smaller or clearer.

### Current progress

The slice inventory below is historical closure evidence for this checkpoint. Intermediate timeout, selector, and "not rerun" notes are preserved for auditability; they are not active work unless a later current-status row explicitly reopens them.

- First slice complete: tool entrypoints with local direct-execution guards now use the shared realpath-aware `src/shared/direct-execution.js` owner. Migrated callers are `tools/tooling/install-lua-language-server.js`, `tools/ci/run-suite.js`, `tools/eval/risk-pack.js`, `tools/config/contract-doc.js`, `tools/mcp/server-sdk.js`, and `tools/bench/query-generator.js`; `tests/tooling/shared-adoption-contract.test.js` now covers those entrypoints against local guard regressions. Evidence: `temp/validation/direct-execution-adoption-focused-tests-20260520-122945.log`, `temp/validation/direct-execution-adoption-cli-probes-20260520-123019.log`, and `temp/validation/direct-execution-adoption-final-checks-20260520-123210.log`.
- Second slice complete: the packaged VS Code Windows command mirror in `extensions/vscode/windows-cmd-core.cjs` now matches the shared `src/shared/subprocess/windows-cmd-core.cjs` bare-shim contract, including env-aware `PATH` probing and exported `resolveWindowsCmdShimPath()`. `tests/tooling/vscode/windows-cmd.test.js` now pins parity for explicit `.cmd` paths and bare `npm`-style PATH shims. Evidence: `temp/validation/windows-cmd-vscode-mirror-focused-tests-20260520-123541.log` and `temp/validation/windows-cmd-vscode-mirror-final-checks-20260520-123632.log`.
- Third slice complete: `tools/setup/rebuild-native.js` now runs npm through `spawnResolvedSubprocessSync('npm', ...)`, preserving its native rebuild env policy while adopting the shared Windows command-shim resolver, collapsing duplicated spawn-result handling into one local helper, and sharing package-name validation before rebuild/install-script paths diverge. Evidence: `temp/validation/rebuild-native-resolved-npm-focused-tests-20260520-123837.log`, `temp/validation/rebuild-native-resolved-npm-final-checks-20260520-123946.log`, and `temp/validation/rebuild-native-package-helper-focused-tests-20260520-125613.log`.
- Fourth slice complete: API index snapshot/diff routes now share `decodeRoutePathSegment()` from `tools/api/router/request-helpers.js` for path-segment decoding and malformed URI classification, preserving the existing `INVALID_REQUEST` messages for `snapshot id` and `diff id` while removing route-local decode helpers. Evidence: `temp/validation/api-route-segment-helper-focused-20260521.log`; the earlier selector mistake and aborted full-suite attempt is preserved separately in `temp/validation/api-route-segment-helper-20260521.log`.
- Fifth slice complete: `bin/pairofcleats-tui.js` now starts spawned native TUI binaries from the same dispatch/runtime env baseline as the main CLI through the bin-local `bin/tui-wrapper-env.js` helper, then layers `PAIROFCLEATS_TUI_RUN_ID`, `PAIROFCLEATS_TUI_INSTALL_ROOT`, and `PAIROFCLEATS_TUI_EVENT_LOG_DIR` on top. Install-manifest and checksum failures still happen before env resolution, preserving actionable wrapper diagnostics. Evidence: `temp/validation/p2-tui-runtime-env-helper-rerun-20260521.log`; the earlier transient runtime-matrix failure is preserved in `temp/validation/p2-tui-runtime-env-helper-20260521.log`.
- Sixth slice complete: service embedding queue path normalization now infers `buildRoot` from index-dir-only jobs, exposes `indexDirUnderBuildRoot`, and shares backend-stage directory resolution through `tools/service/indexer-service-helpers.js`; replay and job execution now consume the same normalized path relationship while preserving legacy `indexRoot` support and the existing "continue with buildRoot only" behavior for escaped `indexDir` values. Evidence: `temp/validation/p2-service-build-root-normalization-20260521.log`.
- Seventh slice complete: MCP handlers now share `resolveMcpRepoContext()` from `tools/mcp/tools/helpers.js` for artifact-aware repo resolution, user config loading, runtime config, and runtime env derivation. The adoption covers analysis, artifacts, bootstrap, downloads, indexing, and triage handlers while preserving public MCP tool payload shapes and schema snapshots. Evidence: `temp/validation/p2-mcp-bootstrap-helper-20260521.log`.
- Eighth slice complete: integration tooling commands now share `getRepoRoot()` from `src/shared/repo-paths.js` for repo-root identity in suggest-tests, impact, graph-context, context-pack, architecture-check, and API-contract tooling. The context-pack federated workspace membership realpath check remains local because it enforces a different allowlist/trust boundary than CLI repo-root selection. Evidence: `temp/validation/p2-tooling-repo-root-helper-20260521.log`.
- Ninth slice complete: context-pack API, MCP, and CLI surfaces now share `src/shared/context-pack-request.js` for pure request projection into `buildCompositeContextPackPayload()` input. Surface-specific validation, repo resolution, progress reporting, error mapping, and workspace trust checks remain local. Evidence: `temp/validation/p2-context-pack-request-helper-rerun-20260521.log`; the first pass caught and preserved a missed import in `temp/validation/p2-context-pack-request-helper-20260521.log`.
- Tenth slice complete: risk explain and risk delta API, MCP, and CLI surfaces now share `tools/analysis/risk-request.js` for pure request projection. `src/shared/risk-filters.js` owns normalized/validated filter helpers, while repo resolution, index checks, progress reporting, and API/MCP/CLI error transport stay local. Evidence: `temp/validation/p2-risk-request-helper-20260521.log`.
- Eleventh slice complete: `tools/service/indexer-service-helpers.js` now owns service runtime-env resolution, repo-config mtime cache invalidation, runtime cache key normalization, and UV threadpool diagnostics. `tools/service/indexer-service.js` now creates the helper and passes the resolver into the job executor instead of owning those env/cache internals inline. Evidence: `temp/validation/p2-service-runtime-env-helper-rerun2-20260521.log`; the earlier helper-test assumption failures are preserved in `temp/validation/p2-service-runtime-env-helper-20260521.log` and `temp/validation/p2-service-runtime-env-helper-rerun-20260521.log`.
- Twelfth slice complete: `tools/reports/show-throughput/build-root.js` now uses the shared build-pointer generation and canonical build-root resolver for `builds/current.json` interpretation, rejects out-of-cache current pointers through the same cache-scoped rules as the index runtime, preserves the existing SQLite artifact and mtime directory fallbacks, and keeps report-specific build-state compatibility local. Evidence: `temp/validation/p2-show-throughput-build-pointer-helper-rerun2-20260521.log`; the earlier selector and Windows path-case assertion failures are preserved in `temp/validation/p2-show-throughput-build-pointer-helper-20260521.log` and `temp/validation/p2-show-throughput-build-pointer-helper-rerun-20260521.log`.
- Thirteenth slice complete: `tools/shared/cli-display.js` now exports a reusable display logger adapter that preserves `meta` and routes status logs to `display.logLine()`. `tools/bench/language-repos/logging.js` consumes that adapter while retaining file writes, log rotation, emergency sync closeout, disk-full history, and durability behavior locally. Evidence: `temp/validation/p2-display-logger-adapter-20260521.log`.
- Fourteenth slice complete: MCP analysis handlers now share a handler-local observability envelope builder for risk explain, context pack, and risk delta operations while leaving repo resolution, progress messages, transport errors, and payload-specific context local. Evidence: `temp/validation/mcp-analysis-observability-helper-20260521.log`.
- Fifteenth slice complete: saved-report exact-fragment follow-through now removes several remaining small duplicates without rerunning `jscpd`: TypeScript signature splitting shares one top-level delimiter scanner, Rust heuristic macro/type metadata shares one declaration-meta builder, SourceKit preflight diagnostics share one details projector, MCP workspace select schemas share one schema constant, model-bakeoff subprocess failure formatting is shared locally, chunk-author hydration uses one existing-author detector, display long-duration formatting shares one compact piece joiner, postings-packed fixture generation shares one allocation-light synthetic postings builder, and selected test fixtures share local setup factories. Evidence: `temp/validation/dup-refactor-batch2-syntax-rerun-20260521.log`, `temp/validation/dup-refactor-targeted-eslint-20260521.log`, `temp/validation/dup-refactor-focused-tests-20260521.log`, `temp/validation/dup-refactor-typescript-signature-tests-20260521.log`, and `temp/validation/dup-refactor-postings-packed-smoke-20260521.log`; the initial Rust redeclaration syntax failure is preserved in `temp/validation/dup-refactor-batch2-syntax-20260521.log`.
- Sixteenth slice complete: service build-state snapshot reading is now owned by `tools/service/indexer-service-helpers.js` through `resolveServiceBuildStatePath()` and `readServiceBuildStateSnapshot()`. `tools/service/indexer-service/progress-monitor.js` and `tools/service/embedding-replay.js` consume the same helper, so progress monitoring and replay diagnostics no longer carry separate `build_state.json` path/JSON parsing copies. Evidence: `temp/validation/service-build-state-helper-syntax-eslint-20260521.log` and `temp/validation/service-build-state-helper-focused-tests-20260521.log`.
- Seventeenth slice complete: report scripts with the same pretty-JSON-to-stdout contract now reuse `emitJson()` from `tools/shared/cli-utils.js`. The adoption covers `tools/reports/combined-summary.js`, `tools/reports/compare-models.js`, `tools/reports/diagnostics-report.js`, and `tools/reports/show-throughput.js`; `metrics-dashboard.js` and `indexer-service.js` stay local because their stdout/stderr and compact-vs-pretty contracts differ. Evidence: `temp/validation/report-json-emit-helper-syntax-eslint-20260521.log` and `temp/validation/report-json-emit-helper-focused-tests-20260521.log`.
- Eighteenth slice complete: API federated workspace path/cache-root allowlist policy now lives in `tools/api/router/workspace-allowlist.js`, keeping authz/trust semantics API-local while removing closure-local repo/workspace normalization from `tools/api/router.js`. The same slice cleaned two test-harness adoption stragglers: ONNX env override coverage now uses `withTemporaryEnv()`, and dict-utils build-root coverage now uses `prepareTestCacheDir()` plus `applyTestEnv()`/`withTemporaryEnv()` instead of manual temp/env restoration. Evidence: `temp/validation/workspace-allowlist-targeted-validation-rerun-20260521.log`; the first runner-selector mistake is preserved in `temp/validation/workspace-allowlist-targeted-validation-20260521.log`.
- Nineteenth slice complete: Java, Kotlin, and C# docmeta output now shares the existing `buildDefaultDocMeta()` owner in `src/lang/shared.js`; Kotlin/C# inheritance payloads stay language-local through a narrow `extraFields` option. Evidence: `temp/validation/docmeta-shared-projection-validation-20260521.log`.
- Twentieth slice complete: `tools/tooling/navigation.js` now shares definition/document-symbol row projection through one file-local helper while leaving completion scoring, definition scoring, document-symbol sorting, and filters local. Evidence: `temp/validation/navigation-projection-helper-validation-20260521.log`.
- Twenty-first slice complete: API status route repo error classification now shares `classifyRepoResolveError()`/`resolveRepoOrSendError()` from `tools/api/router/request-helpers.js` for both `/status` and `/status/stream`. `tests/services/api/status-repo-error-classification.test.js` covers allowed-but-missing and forbidden repo cases across JSON and SSE envelopes. Evidence: `temp/validation/api-status-repo-error-classification-20260521.log`; the broader `services/api/search-contract-matrix` and `services/api/server-stream` checks exceeded the 30-second rule in that log and were not rerun.
- Twenty-second slice complete: Kotlin relation assembly now reuses `buildBraceDelimitedMethodRelations()` from `src/lang/shared.js` with a narrow `shouldScanCallable` option to preserve Kotlin's relation-size guard. Evidence: `temp/validation/kotlin-relation-helper-validation-20260521.log`.
- Twenty-third slice complete: context-pack risk truncation now records through `createTruncationRecorder()` instead of hand-building pack-level and risk-level records at each budget branch. `src/context-pack/assemble/budgets.js` owns the shared risk truncation sink for direct and assembled callers, `src/context-pack/assemble/risk-slice.js` shares the same recorder across full-flow, partial-flow, and call-site-excerpt caps, and `src/context-pack/assemble/finalize.js` initializes the pack truncation list through the shared recorder. The same slice corrected partial-flow truncation record caps to `maxPartialFlows`, `maxPartialBytes`, and `maxPartialTokens`, matching the existing cap-hit model. Evidence: `temp/validation/context-pack-truncation-recorder-focused-20260521.log` and `temp/validation/context-pack-truncation-recorder-contracts-20260521.log`.
- Twenty-fourth slice complete: `src/retrieval/cli.js` now keeps the small preflight helper exports static but lazy-loads the full `runSearchCli` plan runner through an async public wrapper. This preserves the named export used by integration and tests while removing the full search execution graph from module-load/startup measurement. `docs/tooling/shared-module-performance-baselines.json` was tightened for `retrieval.cli` from 1,134 transitive local modules to a 60-module ceiling after the current graph measured 39. Evidence: `temp/validation/retrieval-cli-lazy-runner-performance-fix-20260521.log` and `temp/validation/context-pack-truncation-recorder-post-doc-shared-checks-rerun-20260521.log`; the first post-doc/shared run preserved the pre-fix regression in `temp/validation/context-pack-truncation-recorder-post-doc-shared-checks-20260521.log`.
- Twenty-fifth slice complete: generated docs/report JSON output now shares `tools/shared/generated-report.js` for byte-stable, write-if-changed output and `generatedAt` preservation when the payload is otherwise unchanged. The adoption covers `tools/docs/repo-inventory.js`, `tools/docs/shared-module-ledger.js`, `tools/docs/script-inventory.js`, `tools/docs/contract-drift.js`, `tools/docs/export-artifact-schema-index.js`, and the repo-inventory/shared-module-ledger idempotence tests while leaving each generator's inventory/markdown rendering logic local. The same follow-up corrected the artifact-schema-index generated-surface audit command to point at the live contract-matrix test that already validates the committed artifact schema index. Evidence: `temp/validation/generated-report-stable-json-final-20260521.log` and `temp/validation/generated-report-contract-artifact-followup-clean-20260521.log`; the earlier PowerShell logging-wrapper failures are preserved in `temp/validation/generated-report-stable-json-20260521.log`, and the unrelated broad generated-surfaces-tool failure for current config surfaces is preserved in `temp/validation/generated-report-contract-artifact-followup-20260521.log`.
- Twenty-sixth slice complete: `tools/reports/report-code-map.js` now uses `writeJsonFileSyncResolved()` for cache, `--model-out`, `--node-list-out`, and JSON `--out` writes, and routes `--json` report stdout through `emitJson()` while preserving compact-vs-`--pretty` output. `tools/shared/cli-utils.js` gained a default-preserving `emitJson(..., { spaces })` option for callers that need compact JSON without duplicating stdout emission. Dot, SVG, and HTML output remain report-local. Evidence: `temp/validation/report-code-map-slice-2026-05-21.log` and `temp/validation/report-generated-writer-integrated-clean-20260521.log`; the `tests/run.js` execution of `indexing/map/code-map-contract-matrix` exceeded the 30-second rule in `temp/validation/report-generated-writer-integrated-20260521.log` and was not rerun.
- Twenty-seventh slice complete: `tools/docs/generated-surfaces.js` now reuses `normalizeGeneratedJsonValue()`/`stringifyGeneratedJson()` from `tools/shared/generated-report.js` for generated-output freshness normalization and uses `emitJson()` for `--json` registry output. The helper keeps writer output order unchanged while making comparison normalization shared and sorted. Evidence: `temp/validation/generated-surfaces-normalization-helper-20260521.log`.
- Twenty-eighth slice complete: `tools/reports/compare-models.js` now uses `writeJsonFileResolved()` for `--out` JSON report files instead of manually creating the directory and writing `JSON.stringify()` output. The existing `emitJson()` stdout path, compact report behavior, command aliases, model/cache/ANN behavior, and human summary output stay unchanged. Evidence: `temp/validation/compare-models-json-file-helper-20260521.log`.
- Twenty-ninth slice complete: runner governance generated reports now share the generated-report writer path. `tests/runner/suite-taxonomy-report.js` and `tests/runner/lane-evidence.js` call `writeStableGeneratedJsonReport()` and render markdown from the returned timestamp-preserved report; lane evidence timing artifacts and markdown writes now use `writeTextIfChanged()`. The validation generator commands refreshed `docs/testing/suite-taxonomy.{json,md}` and `docs/testing/lane-evidence.{json,md}` to the branch's current test inventory and timing evidence. Evidence: `temp/validation/runner-governance-generated-report-helper-20260521.log`.
- Thirtieth slice complete: coverage report artifacts now use the shared writer path where their contracts match. `tools/testing/coverage/index.js` writes coverage artifacts through `writeJsonFileResolved()`, and `tools/testing/coverage/policy.js` writes policy JSON through `writeJsonFileResolved()` plus unchanged markdown through `writeTextIfChanged()`. Coverage collection, threshold evaluation, report shaping, and markdown rendering remain coverage-local. Evidence: `temp/validation/coverage-report-json-helper-20260521.log`.
- Thirty-first slice complete: config/release generated outputs now use shared writers where the contracts match. `tools/config/inventory.js` writes timestamp-preserving inventory JSON through `writeStableGeneratedJsonReport()` and inventory markdown through `writeTextIfChanged()`, while `tools/config/contract-doc.js` and `tools/release/export-surface-guide.js` write generated markdown through `writeTextIfChanged()`. Inventory scanning, budget checks, contract rendering, and release-surface rendering remain local. Evidence: `temp/validation/config-release-writer-helper-20260521.log`.
- Thirty-second slice complete: `tools/config/generate-demo-config.js` now imports the live `tools/config/default-template.js` source, writes generated JSONC through `writeTextIfChanged()`, and creates nested `--out` parents through the shared helper. `tests/tooling/config/generate-demo-config-output.test.js` covers the CLI output path and JSONC parseability. Evidence: `temp/validation/config-demo-writer-helper-20260521.log`; the first pass preserved the missing-template import failure before the fix.
- Thirty-third slice complete: triage record artifact output now shares `tools/triage/record-writer.js` for safe record-id path resolution plus JSON/markdown writes. `tools/triage/ingest.js` and `tools/triage/decision.js` use that shared writer, and `tools/triage/context-pack.js` writes generated context-pack JSON through `writeJsonFileResolved()`. Evidence: `temp/validation/triage-writer-helper-focused-clean-20260521.log`; the full `tooling/triage/context-pack` runtime test exceeded the 30-second rule in `temp/validation/triage-writer-helper-20260521.log` and was not rerun.
- Thirty-fourth slice complete: CI diagnostics output now uses shared writers. `tools/ci/capability-gate.js` writes capability reports through `writeJsonFileResolved()`, and `tools/ci/run-lsp-embeddings-gates.js` writes diagnostics JSON through `writeJsonFileResolved()` plus JUnit XML through `writeTextIfChanged()`. Probe logic, subprocess execution, XML rendering, and exit mapping remain CI-local. Evidence: `temp/validation/ci-writer-helper-20260521.log`.
- Thirty-fifth slice complete: benchmark/report generated outputs now use shared writers. `tools/bench/bench-runner.js`, `tools/bench/ab-sweep.js`, `tools/bench/language-summarize.js`, `tools/bench/language-canaries.js`, `tools/bench/language-blocker-closure.js`, and `tools/bench/query-generator.js` write JSON/text artifacts through `writeJsonFileResolved()` and/or `writeTextIfChanged()` while keeping stdout JSON, benchmark execution, scoring, rendering, and query generation local. Evidence: `temp/validation/bench-writer-helper-20260521.log`.
- Thirty-sixth slice complete: release metadata/readiness/check/trust/bundle generated outputs now use shared writers. `tools/release/metadata.js` writes release metadata JSON through `writeJsonFileResolved()` and notes through `writeTextIfChanged()`, `tools/release/readiness-gate.js` writes readiness JSON/markdown through the same helper pair, `tools/release/check.js` writes release report/manifest JSON through `writeJsonFileSyncResolved()`, `tools/release/generate-trust-materials.js` writes trust JSON artifacts through `writeJsonFileSyncResolved()`, and `tools/release/assemble-bundle.js` writes bundle manifest/checksum outputs through `writeJsonFileResolved()` and `writeTextIfChanged()`. Release validation, surface selection, artifact inventory, SBOM copying/generation, markdown rendering, and exit behavior remain release-local. Evidence: `temp/validation/release-writer-helper-20260521.log` and `temp/validation/release-trust-bundle-writer-helper-20260521.log`.
- Thirty-seventh slice complete: ingest summary metadata and JSON stdout now use ingest-owned helper wrappers around the shared JSON writer and CLI JSON emitter. `tools/ingest/shared.js` exports `writeIngestSummaryReport()` and `emitIngestSummaryJson()`, and `tools/ingest/ctags.js`, `tools/ingest/gtags.js`, `tools/ingest/lsif.js`, and `tools/ingest/scip.js` use those helpers for `.meta.json` and `--json` summaries while preserving format-specific parsing, streaming JSONL writes, runner command behavior, and path-filter rules. Evidence: `temp/validation/ingest-summary-writer-helper-rerun-20260521.log`; the accidental broad ESLint invocation is preserved in `temp/validation/ingest-summary-writer-helper-20260521.log` and failed only on unrelated existing files.
- Thirty-eighth slice complete: CLI general subprocess tests now use the existing `tests/helpers/run-node.js` helper instead of local `spawnSync(process.execPath, ...)` wrappers. `tests/cli/general/canonical-workflows.test.js`, `tests/cli/general/help-hidden-topics.test.js`, and `tests/cli/general/workspace-build-dispatch.test.js` preserve their route/status/assertion coverage while sharing Node process setup and failure formatting. Evidence: `temp/validation/cli-general-run-node-helper-20260521.log`.
- Thirty-ninth slice complete: LSP workspace-root relative normalization now has one owner in `src/index/tooling/workspace-model.js`. The Go workspace partitioner, Rust workspace partitioner, LSP workspace router, and Go workspace preflight path now consume `normalizeWorkspaceRootRel()` directly instead of maintaining same-contract local normalizers. `tests/tooling/lsp/workspace-routing.test.js` pins empty, dot, slash, backslash, duplicate-slash, and trailing-slash behavior. Evidence: `temp/validation/p2-workspace-root-rel-normalizer-20260521.log`.
- Fortieth slice complete: API SSE stream test harness setup now shares `tests/helpers/api-server.js`. The helper exports `parseSseEvent()`/`parseSseEvents()` and the `startApiServer()` return shape now includes `requestSse()` with the same auth/header/body setup as the JSON/raw request helpers plus stop-on-event and abort-after-first-chunk support. `tests/services/api/server-stream.test.js` now uses `prepareFixtureApiServerCohort()` and `requestSse()` instead of local cache setup, index build, auth header construction, SSE parsing, stream reading, and abort helper code. `tests/services/api/status-repo-error-classification.test.js` reuses `parseSseEvents()` for its in-memory router checks. Evidence: syntax, focused ESLint, and parser smoke validation are logged in `temp/validation/api-server-stream-helper-fast-final-20260521.log`; focused runner output is logged in `temp/validation/api-server-stream-helper-20260521.log`. `services/api/status-repo-error-classification` passed, while `services/api/fixture-api-server-cohort` and `services/api/server-stream` exceeded the 30-second rule and were not rerun.
- Forty-first slice complete: ingest repo-relative path normalization now keeps only ingest-specific virtual-root preprocessing in `tools/ingest/shared.js` and delegates final containment, platform, and mixed-separator normalization to `src/shared/path-normalize.js`. The wrapper still preserves the `/repo` root sentinel for LSIF input but routes `/repo/...`, absolute paths, relative paths, Windows-drive virtual paths, and escape checks through the shared `normalizeRepoRelativePath()` owner. `tests/tooling/ingest/normalize-path.test.js` covers direct relative, absolute in-repo, escaped, virtual `/repo`, virtual `/repo/../...`, `..config`, and Windows-drive virtual-root behavior. Evidence: `temp/validation/ingest-path-normalizer-helper-20260521.log`.
- Forty-second slice complete: analysis surface parity CLI execution now uses the shared `tests/helpers/run-node.js` helper. `tests/helpers/analysis-surface-parity.js` no longer imports `spawnSync`; `runCliJson()` calls `runNode([binPath, ...args], ..., { stdio: 'pipe', allowFailure: true })` and preserves the status/stdout/stderr/parsed return shape for success and intentional invalid-request cases. Evidence: `temp/validation/analysis-surface-run-node-helper-20260521.log`; `context-pack/risk-filters-parity` was already a recorded 30-second timeout and was not rerun.
- Forty-third slice complete: remaining `tests/cli/general` local Node subprocess wrappers now share `tests/helpers/run-node.js`. The follow-up covers `cli.test.js`, `cli-completions-and-audit.test.js`, `repo-root.test.js`, `setup-bootstrap-flag-passthrough.test.js`, `service-indexer-json-flags.test.js`, `legacy-entrypoint-warning.test.js`, `legacy-entrypoint-symlink-contract.test.js`, `tui-install-missing-cargo.test.js`, and `tui-build-install.test.js`; a focused scan now reports no `spawnSync(process.execPath, ...)` or `node:child_process` imports in `tests/cli/general`. Evidence: `temp/validation/cli-general-run-node-followup-rerun-20260521.log`; the first no-match scan wrapper failure is preserved in `temp/validation/cli-general-run-node-followup-20260521.log`.
- Forty-fourth slice complete: `tools/reports/metrics-dashboard.js` now uses `emitJson()` for `--json` stdout emission while preserving its leading blank line, two-space formatting, stderr summary, and `writeJsonFileResolved()` file output. `tests/tooling/reports/metrics-dashboard.test.js` now executes the report through `runNode()` and asserts stdout JSON matches the written dashboard payload. Evidence: `temp/validation/cli-search-metrics-strict-harness-20260521.log`; the first logging wrapper failure is preserved in `temp/validation/cli-search-and-metrics-helper-20260521.log`.
- Forty-fifth slice complete: CLI/search and context-pack parity tests now avoid local direct CLI bypasses where helper contracts already exist. `tests/cli/search/non-result-surfaces.test.js`, `tests/dispatch/search-flag-passthrough.test.js`, and `tests/cli/error-contract.test.js` use `runNode()` plus `applyTestEnv()` for child Node execution while keeping intentional no-test-env legacy-warning checks explicit. `tests/context-pack/strict-evidence-parity.test.js` now routes the CLI assertion through `createAnalysisSurfaceHarness().runCli()` instead of importing the production context-pack CLI function directly. Evidence: `temp/validation/cli-search-metrics-strict-harness-20260521.log`.
- Forty-sixth slice complete: runner and build-index smoke tests now use `runNode()` where they execute successful child Node commands. `tests/cli/build-index/all.test.js`, `tests/ci/suite-runner.smoke.test.js`, and `tests/runner/list-json-lane-explanation.test.js` preserve artifact/listing assertions while sharing child process failure formatting and test env setup. `tests/runner/test-runner.js` was intentionally left unchanged at this point after direct execution showed its `runner/harness/skip-semantics` assertion was stale against current discovery and the file is excluded from runner selection; the later runner-list slice repaired this stale assertion directly. Evidence: `temp/validation/runner-ci-build-index-run-node-helper-rerun-20260521.log`; the stale excluded-file attempt is preserved in `temp/validation/runner-ci-build-index-run-node-helper-20260521.log`.
- Forty-seventh slice complete: runner harness artifact/log wrapper tests now share `runNode()` for successful nested `tests/run.js` execution. The adoption covers profile artifact, profile normalization, report-file, stability artifact, and log runId contract tests while leaving artifact parsing and schema assertions local. Evidence: `temp/validation/runner-harness-run-node-helper-20260521.log`.
- Forty-eighth slice complete: tooling config tests now share `runNode()` for config generator, validator, and dump script execution. `tests/tooling/config/generate-demo-config-output.test.js` keeps its JSONC/output assertions while sharing timeout/failure formatting, and `tests/tooling/config/contract-matrix.test.js` preserves valid/anyOf/invalid validator assertions with `allowFailure` only for the invalid-config case. Evidence: `temp/validation/tooling-config-run-node-helper-20260521.log`.
- Forty-ninth slice complete: tooling install/setup tests now share `runNode()` for successful child Node execution while preserving JSON stdout/stderr assertions and fixture-specific env behavior. The adoption covers tooling install dry-run, bootstrap JSON output with fake npm PATH/maxBuffer, setup JSON output, and outside-root tool search. Evidence: `temp/validation/tooling-install-run-node-helper-20260521.log`.
- Fiftieth slice complete: `tests/tui/wrapper-behavior.test.js` now uses `runNode()` with `allowFailure` for expected missing-manifest and checksum-mismatch wrapper failures while preserving install-manifest fixture setup and assertions. Evidence: `temp/validation/tui-wrapper-run-node-helper-20260521.log`. A broader TUI attempt is preserved in `temp/validation/tui-run-node-helper-20260521.log`; `tui/build-verify-manifest` and `tui/headless-smoke` exceeded the 30-second rule and were restored to their prior local wrappers rather than kept unproven.
- Fifty-first slice complete: runner coverage harness tests now share `runNode()` for nested runner calls. `tests/runner/harness/coverage-equals-form.test.js` preserves coverage artifact schema assertions, and `tests/runner/harness/coverage-flags.test.js` preserves list-output parsing while both consume shared child-process setup and test env handling. Evidence: `temp/validation/runner-coverage-run-node-helper-20260521.log`.
- Fifty-second slice complete: tooling CI script wrapper tests now share `runNode()` for successful Node script execution. `tests/tooling/ci/get-last-failure-latest-pointer.test.js` preserves stderr-selected-path assertions for `.testLogs/latest`, and `tests/tooling/ci/command-surface-audit.test.js` preserves command-alias and success-summary checks. Evidence: `temp/validation/tooling-ci-run-node-helper-20260521.log`.
- Fifty-third slice complete: postinstall patch/rebuild tests now share `runNode()` for postinstall script execution. Expected patch-package failure cases use `allowFailure`, while no-patch and rebuild-native success paths keep normal failure handling. Evidence: `temp/validation/postinstall-run-node-helper-20260521.log`.
- Fifty-fourth slice complete: show-throughput report test helpers now share `runNode()` for child report execution. `tests/tooling/reports/show-throughput-report-fixture.js` preserves shared payload/temp-root setup for compare and JSON contract tests, and `tests/tooling/reports/show-throughput-scan-test-helpers.js` preserves ANSI stripping and scan-profile fixture assertions while consuming the shared child-process helper. Evidence: `temp/validation/show-throughput-run-node-helper-20260521.log`.
- Fifty-fifth slice complete: small lexicon and editor packaging policy tests now share `runNode()` for Node script execution. Lexicon report/validate tests preserve JSON payload assertions and invalid-wordlist failure checks through `allowFailure`, and the VS Code/Sublime toolchain policy tests preserve missing-toolchain failure assertions through helper-built test envs. Evidence: `temp/validation/lexicon-editor-run-node-helper-20260521.log`.
- Fifty-sixth slice complete: tooling setup/index-detection/uninstall tests now share `runNode()` for child setup and uninstall script execution. `tests/tooling/install/setup.test.js` preserves text and JSON setup assertions, `tests/tooling/install/setup-index-detection.test.js` preserves artifact-readiness matrix checks plus inline index-dir resolution, and `tests/tooling/install/uninstall.test.js` preserves destructive fixture cleanup assertions while consuming shared child-process setup. Evidence: `temp/validation/tooling-install-setup-run-node-helper-20260521.log`.
- Fifty-seventh slice complete: remaining bounded install helper tests now share `runNode()` for child installer execution. `tests/tooling/install/tooling-install-test-helper.js` preserves empty-PATH failure payload inspection through `allowFailure`, `install-phpactor-phar-network-guards` preserves timeout/retry report assertions, and `lua-language-server-install` preserves good-archive success plus broken-archive failure handling. Evidence: `temp/validation/tooling-install-remaining-run-node-helper-20260521.log`.
- Fifty-eighth slice complete: additional show-throughput tests now route through the helper-backed `runNode()` path. Profiles, USR filtering, language normalization, statistical summary, ledger diff, and materialize deep-analysis coverage preserve local fixture setup and output assertions while sharing report/materializer subprocess setup. Evidence: `temp/validation/show-throughput-additional-run-node-helper-20260521.log` and `temp/validation/report-additional-run-node-helper-20260521.log`.
- Fifty-ninth slice complete: the summary report JSON error contract now uses `runNode()` with `allowFailure` for its intentional invalid-baseline error path while preserving JSON error payload assertions. Evidence: `temp/validation/summary-report-error-run-node-helper-20260521.log`.
- Sixtieth slice complete with historical timeout follow-up: summary report compare helpers and SQLite parity wrappers now share `runNode()` for child Node execution. Compare-memory and compare-sqlite direct checks passed against the existing fixture cache, while the initial `report-parity-sqlite` and `report-parity-sqlite-fts` runs exceeded the 30-second repository cutoff and were recorded as timeouts rather than rerun in the original slice log. Later deterministic-payload proof closed those parity checks in `temp/validation/summary-report-proof-followup-20260521.log`, so this is not active work. Original evidence: `temp/validation/summary-report-run-node-helper-20260521.log`.
- Sixty-first slice complete: the synchronous verify-extensions step in `tests/tooling/install/download-extensions.test.js` now uses `runNode()` while the async download subprocess remains on `spawn()` so the in-process HTTP server can serve fixture archives. Evidence: `temp/validation/download-extensions-verify-run-node-helper-20260521.log`.
- Sixty-second slice complete: shared helper wrappers for triage CLI tests, SQLite incremental fixtures, and tooling LSP SLO gate tests now route child Node execution through `runNode()` while preserving their local fixture setup, expected-failure status assertions, pipe/inherit stdio behavior, and 30-second focused validation surface. Evidence: `temp/validation/p2-shared-helper-run-node-cluster-20260521-rerun.log`; the first validation log is preserved in `temp/validation/p2-shared-helper-run-node-cluster-20260521.log` because it only failed on the expected no-match `rg` exit code after all focused tests passed.
- Sixty-third slice complete: CI gate smoke tests for tooling LSP default-enable policy and bench-language rollout gates now use `runNode()` with `allowFailure` for enforced error cases while preserving JSON artifact assertions and success/failure status checks. Evidence: `temp/validation/ci-gate-smoke-run-node-helper-20260521.log`.
- Sixty-fourth slice complete: the workspace manifest contract matrix now uses `runNode()` for the catalog JSON subprocess while preserving workspace fixture setup, generated manifest checks, cache-root assertions, and success-only stdout JSON parsing. Evidence: `temp/validation/workspace-manifest-run-node-helper-20260521.log`.
- Sixty-fifth slice complete: the reconcile-identity CLI drift test now uses `runNode()` with `allowFailure` for the expected failing JSON report while preserving drift fixture setup and issue-message assertions. Evidence: `temp/validation/reconcile-identity-cli-run-node-helper-20260521.log`.
- Sixty-sixth slice complete: indexing lifecycle build-entry success/failure tests now use `runNode()` while preserving the expected unknown-flag failure path, timeout bounds, isolated success fixture, and no-unsettled-warning assertions. Evidence: `temp/validation/indexing-lifecycle-run-node-helper-20260521-rerun.log`; the first validation log is preserved in `temp/validation/indexing-lifecycle-run-node-helper-20260521.log` because it only failed on an unsupported runner option after syntax, ESLint, and direct-wrapper scans passed.
- Sixty-seventh slice complete: release blocker-flag rejection and index-diff mode/compact validation tests now use `runNode()` while preserving intentional unsupported-flag failures, JSON stdout parsing, and compact rejection assertions. Evidence: `temp/validation/release-index-diff-run-node-helper-20260521.log`.
- Sixty-eighth slice complete: the index-stats contract matrix now uses a local `runStats()` wrapper backed by `runNode()` for index-dir, explicit repo, repo JSON, and verify-failure cases while preserving cache-root env isolation and expected verify status `1`. Evidence: `temp/validation/index-stats-contract-run-node-helper-20260521.log`.
- Sixty-ninth slice complete: analysis wrapper exit propagation, index config dump, and cache GC tests now use `runNode()` while preserving expected CLI error exits, config JSON parsing, cache-root test env isolation, and GC removal assertions. Evidence: `temp/validation/analysis-indexdump-cachegc-run-node-helper-20260521.log`.
- Seventieth slice complete: search-showcase fixture list probes and the Sublime python-policy check now use `runNode()` while preserving showcase dataset assertions, PTY list coverage, and Python behavior-helper execution through the discovered Python executable. Evidence: `temp/validation/showcase-sublime-run-node-helper-20260521-rerun.log`.
- Seventy-first slice complete: strict JSONL triage ingest expected-failure coverage now uses `runNode()` with `allowFailure` while preserving the malformed-record audit/error-payload assertions and shared triage fixture setup. Evidence: `temp/validation/triage-jsonl-strict-run-node-helper-20260521.log`.
- Seventy-second slice complete: shared-module migration tooling, merge benchmark smoke, embedding-batcher keepalive, and Perl tree-sitter native reset regression tests now use `runNode()` while preserving the migration check-mode failure, benchmark output assertions, unref timer timeout bound, and native reset child script behavior. Evidence: `temp/validation/run-node-small-wrapper-batch-20260521.log`.
- Seventy-third slice complete: search/retrieval/Rust wrapper tests now use `runNode()` for build/search child Node execution while preserving cwd, env, inherited build output where intentional, and captured stdout for JSON assertions. Evidence: syntax, ESLint, direct-wrapper scan, compact-json pass, and recorded 30-second timeout outcomes are in `temp/validation/run-node-search-retrieval-wrapper-batch-20260521.log`; corrected lane proof for `retrieval/pipeline/search-startup-fastpath` and the ci-long `fielded-bm25` timeout are in `temp/validation/run-node-search-retrieval-wrapper-batch-lane-followup-rerun-20260521.log`; the bad lane-flag-order attempt is preserved in `temp/validation/run-node-search-retrieval-wrapper-batch-lane-followup-20260521.log`.
- Seventy-fourth slice complete: query-cache contract wrappers and the backend contract matrix now use `runNode()` for successful and expected-failure child Node calls while preserving cwd/env isolation, captured stdout JSON parsing, and manifest-missing failure assertions through `allowFailure`. Evidence: syntax, ESLint, direct-wrapper scan, and the passing backend selector are in `temp/validation/run-node-query-cache-backend-wrapper-batch-20260521.log`; direct runtime attempts for the two query-cache scripts exceeded the 30-second cutoff and are preserved in `temp/validation/run-node-query-cache-wrapper-batch-20260521.log`.
- Seventy-fifth slice complete: HNSW atomic, HNSW ANN, and LanceDB ANN tests now use `runNode()` for build, embedding, and search child Node calls while preserving optional native dependency skips, repo cwd/env, inherited build output, and captured search JSON assertions. Evidence: `temp/validation/run-node-ann-wrapper-batch-20260521.log`.
- Seventy-sixth slice complete: shared build/search fixture helpers now use `runNode()` for Node subprocess execution in `build-index-fixture`, `extracted-prose-fixture`, `fixture-index`, and `search-filters-repo`, while preserving crash-log tailing, custom throw/exit behavior, fixture cwd/env, inherited build output, search JSON parsing, and existing formatted command-failure output. Evidence: `temp/validation/run-node-helper-wrapper-batch-20260521.log`.
- Seventy-seventh slice complete: indexing validate/import/filter/format wrapper tests now use `runNode()` for successful and expected-failure child Node calls while preserving captured stderr/stdout assertions, inherited build output, fixture cwd/env, and JSON validation parsing. Evidence: `temp/validation/run-node-indexing-wrapper-batch-20260521.log`.
- Seventy-eighth slice complete: the import-links indexing regression now uses `runNode()` for its build-index subprocess while preserving repo cwd/env, inherited output, and import-link artifact assertions. Evidence: `temp/validation/run-node-import-links-wrapper-20260521.log`.
- Seventy-ninth slice complete: the comment-join indexing regression now uses `runNode()` for its build and four search subprocesses while preserving captured JSON payload parsing and comment/extracted-prose assertion behavior. Evidence: `temp/validation/run-node-comment-join-wrapper-20260521.log`.
- Eightieth slice complete: the MetaV2 finalization, call-sites contract matrix, and extracted-prose core tests now use `runNode()` for build/search child Node execution while preserving fixture cwd/env isolation, custom failure assertions, and captured JSON parsing. Evidence: syntax, ESLint, and direct-wrapper scans passed in `temp/validation/run-node-indexer-extracted-prose-wrapper-timeboxed-20260521.log`; the `indexer/metav2/contract-matrix` selector passed in 52.8s in `temp/validation/run-node-indexer-extracted-prose-wrapper-batch-rerun-20260521.log`, and direct `call-sites` plus `extracted-prose/core` behavior checks were stopped at the 30-second cutoff in the timeboxed log.
- Eighty-first slice complete: small artifact bench and cleanup contract tests now use `runNode()` for bounded tool subprocesses while preserving captured bench output assertions and inherited clean-artifacts output. Evidence: `temp/validation/run-node-artifact-bench-clean-wrapper-20260521.log`.
- Eighty-second slice complete: tooling ingest ctags/gtags/lsif/scip tests and the missing-input helper now use `runNode()` for CLI subprocesses while preserving captured JSON/error output, escape-path filtering assertions, and expected missing-input failures through `allowFailure`. Evidence: `temp/validation/run-node-tooling-ingest-wrapper-20260521.log`.
- Eighty-third slice complete with caveat, later closed by proof follow-up: tooling eval quality wrappers now use `runNode()` for child Node execution while preserving captured JSON assertions and inherited build output. Evidence: syntax, ESLint, direct-wrapper scans, and a passing `risk-pack-quality` direct check are in `temp/validation/run-node-tooling-eval-wrapper-20260521.log`; `eval-quality` initially hit the 30-second cutoff during `build_index`, then passed after moving to a tiny generated code-only fixture in `temp/validation/proof-followups-final-validation-20260521.log`.
- Eighty-fourth slice complete: tooling triage/cache/structural-search tests now use `runNode()` while preserving expected nonzero triage assertions, cache JSON parsing, fixture PATH setup, and structural result assertions. Evidence: `temp/validation/run-node-tooling-triage-cache-structural-wrapper-20260521.log`.
- Eighty-fifth slice complete: perf bench tooling wrappers now use `runNode()` in the bench-runner fixture, guardrails contract, output-schema, per-output-schema, and AB sweep contract tests while preserving captured JSON payload parsing, expected guardrail failure assertions, and fixture env setup. Evidence: `temp/validation/run-node-perf-bench-wrapper-20260521.log` and `temp/validation/run-node-perf-bench-wrapper-consumers-20260521.log`.
- Eighty-sixth slice complete: CI LSP gate wrappers now use `runNode()` for LSP embeddings gate testing-env, timeout JUnit, and tooling-LSP guardrail regression-diff child Node calls while preserving explicit gate timeouts, expected timeout exit assertions, diagnostics/JUnit parsing, and guardrail diff payload assertions. Evidence: `temp/validation/run-node-ci-lsp-gate-wrapper-20260521.log`.
- Eighty-seventh slice complete: small benchmark contract wrappers now use `runNode()` for artifact-IO throughput, SQLite build-from-artifacts, and chargram-postings bench child Node calls while preserving captured bench output assertions and SQLite fixture env setup. Evidence: `temp/validation/run-node-small-bench-contract-wrapper-20260521.log`.
- Eighty-eighth slice complete: Sublime package structure, release sanity, determinism, and archive metadata tests now use `runNode()` for `tools/package-sublime.js` child Node calls while preserving package output, manifest, checksum, command/menu/keymap/settings, and metadata assertions. Evidence: `temp/validation/run-node-sublime-package-wrapper-20260521.log`.
- Eighty-ninth slice complete: VS Code package determinism, archive metadata, and contract matrix tests now use `runNode()` for `tools/package-vscode.js` child Node calls while preserving package output, manifest, walkthrough, configuration, command/menu/keybinding, and shipped-entry assertions. Evidence: `temp/validation/run-node-vscode-package-wrapper-20260521.log`.
- Ninetieth slice complete: shared lifecycle and runtime contract matrices now use `runNode()` for synchronous child Node probes while preserving the lifecycle unref keepalive timeout, wrapper config-dump JSON assertions, and the intentionally local async lifecycle keepalive `spawn()` assertion. Evidence: `temp/validation/run-node-runtime-lifecycle-wrapper-20260521.log`.
- Ninety-first slice complete with validation caveat, later closed by proof follow-up: tooling install detect/plan and fixture-eval wrappers now use `runNode()` for child Node execution while preserving JSON parsing, fixture env, inherited build output, and expected success handling. Syntax, targeted ESLint, direct-wrapper scans, and the install detect/plan direct check passed. Fixture-eval was stopped at the 30-second cutoff during a real index build; the current runner list has no standalone `fixture-eval` selector, and the script-coverage harness that covers the fixture action passed in `temp/validation/production-verify-current-20260521.log`. Evidence: `temp/validation/run-node-install-fixture-wrapper-20260521.log`.
- Ninety-second slice complete with validation caveats, later closed by proof follow-up: small synthetic index/build wrappers now use `runNode()` for manifest embeddings pieces, embeddings validation, incremental manifest, two-stage state, structural filters, and the map build fixture while preserving cache/test env setup, stub embeddings, inherited build output, and artifact assertions. Syntax, targeted ESLint, and direct-wrapper scans passed; `indexing/embeddings/manifest-pieces` and `tooling/structural/filters` passed under 30 seconds. `indexing/incremental/manifest`, `indexing/embeddings/validate`, `indexing/runtime/two-stage-state`, and `map/build-contract-matrix` initially exceeded the cutoff, then passed after code-only fixture tightening in `temp/validation/proof-followups-final-validation-20260521.log`. Evidence: `temp/validation/run-node-synthetic-index-build-wrapper-20260521.log`.
- Ninety-third slice complete with validation caveat, later closed by proof follow-up: Sublime pycompile and package-harness tests now use `runNode()` for the Node `python-check.js` policy probe while leaving the actual Python subprocesses local to their Python behavior checks. Syntax, targeted ESLint, direct Node-wrapper scans, retained-Python-call scans, and `tooling/sublime/pycompile` passed; `tooling/sublime/package-harness` initially hit the 30-second cutoff, then passed with behavior and pycompile checks in `temp/validation/sublime-package-harness-proof-followup-rerun-20260521.log`. Evidence: `temp/validation/run-node-sublime-python-policy-wrapper-20260521.log`.
- Ninety-fourth slice complete: runner list wrappers now use `runNode()` for runner list/error subprocesses, and stale list assertions were repaired to the current runner contract. `tests/runner/test-runner.js` now checks the live `runner/harness/skip-target` discovery entry, while `tests/runner/ci-long-order-selection.test.js` keeps ordered-manifest equality and current selection metadata assertions without hardcoding removed ci-long entries or old list-size expectations. Evidence: `temp/validation/run-node-runner-list-wrapper-20260521.log`, with stale/current-shape proof in `temp/validation/runner-list-current-proof-20260521.log` and `temp/validation/runner-ci-long-current-shape-20260521.log`.
- Ninety-fifth slice complete with validation caveat, later closed by proof follow-up: artifact build-wrapper tests now use `runNode()` for packed artifact fastpath, dynamic write-concurrency ordering, and artifact-size guardrail build subprocesses while preserving inherited build output, cache/test env setup, and artifact assertions. Syntax, targeted ESLint, and direct-wrapper scans passed; `indexing/artifacts/packed-artifact-fastpath` and `indexing/artifacts/dynamic-write-concurrency-preserves-order` passed under 30 seconds. `indexing/artifacts/artifact-size-guardrails` initially hit the cutoff, then passed after redundant build reduction in `temp/validation/proof-followups-final-validation-20260521.log`. Evidence: `temp/validation/run-node-artifact-build-wrapper-20260521.log`.
- Ninety-sixth slice complete with validation caveat, later closed by proof follow-up: code-map guardrail and contract matrix tests now use `runNode()` for build and report-code-map child Node calls while preserving fixture env setup, inherited build output, captured JSON/dot output, and expected status assertions. Syntax, targeted ESLint, and direct-wrapper scans passed; both `indexing/map/code-map-guardrail-matrix` and `indexing/map/code-map-contract-matrix` initially hit the cutoff, then passed after reusing one built fixture in `temp/validation/proof-followups-final-validation-20260521.log`. Evidence: `temp/validation/run-node-code-map-wrapper-20260521.log`.
- Ninety-seventh slice complete with validation caveat, later closed by proof follow-up: smoke utility, e2e, and retrieval wrappers now use `runNode()` for child Node calls while preserving smoke helper APIs, fixture env setup, inherited build output, captured search/map output, and the non-Node Graphviz `dot` probe. Syntax, targeted ESLint, direct Node-wrapper scans, and retained-Graphviz scans passed; `smoke/e2e` and `smoke/retrieval` initially hit the cutoff, then passed after stage1/code/no-sqlite fixture tightening in `temp/validation/smoke-query-cache-proof-followup-final-20260521.log`. Evidence: `temp/validation/run-node-smoke-wrapper-20260521.log`.
- Ninety-eighth slice complete: optional dependency policy, shared-module performance, Python contract fail-open, and tooling navigation-query tests now use `runNode()` for child Node calls while preserving expected skip/failure statuses, shared test env setup, performance JSON assertions, Python external-command probing, and navigation CLI output assertions. Syntax, targeted ESLint, direct Node-wrapper scans, retained-Python-probe scans, and all four direct 30-second checks passed. Evidence: `temp/validation/run-node-policy-tooling-wrapper-20260521.log`.
- Ninety-ninth slice complete with validation caveat, later closed by proof follow-up: piece-assembly core and missing-manifest tests now use `runNode()` for build/assemble child Node calls while preserving inherited build output, expected manifest failure handling, cache/test env setup, and assembled artifact assertions. Syntax, targeted ESLint, and direct-wrapper scans passed; `indexing/piece-assembly/assemble-pieces-no-guess` passed under 30 seconds, while `indexing/piece-assembly/core` initially hit the cutoff after a successful build sub-step, then passed after redundant repeat-build removal in `temp/validation/proof-followups-final-validation-20260521.log`. Evidence: `temp/validation/run-node-piece-assembly-wrapper-20260521.log`.
- One-hundredth slice complete with validation caveats: CI import-resolution SLO gate, risk-explain adapter CLI, encoding fallback, indexer-service CLI, and TUI installer/build/capture wrappers now use `runNode()` while preserving captured stdout/stderr, expected nonzero statuses, test-env propagation, cwd/env, and package/build output behavior. Syntax, targeted ESLint, direct-wrapper scans, and most focused selectors passed in `temp/validation/run-node-ci-risk-encoding-wrapper-20260521.log`, `temp/validation/run-node-encoding-fallback-wrapper-rerun-3-20260521.log`, `temp/validation/run-node-indexer-service-wrapper-20260521.log`, and `temp/validation/run-node-tui-wrapper-20260521.log`; `services/risk-explain-adapter-matrix` printed its pass line before `timed_out_after_pass`.
- One-hundred-first slice complete with validation caveats, later closed by proof follow-up: SQLite storage, LMDB storage, and service SQLite/smoke wrapper tests now use `runNode()` for build/search/service child Node calls while preserving inherited build output, captured JSON, expected failures, and helper-built envs. LMDB and service SQLite selectors passed; SQLite `index-state-fail-closed`, `incremental-no-change`, and `bundle-missing` passed under 30 seconds after fixture env tightening. SQLite search-backend and maintenance selectors initially exceeded the 30-second cutoff; the one-hundred-eighth proof follow-up below closes them. Evidence: `temp/validation/run-node-sqlite-storage-wrapper-20260521.log`, `temp/validation/run-node-sqlite-storage-rerun-20260521.log`, `temp/validation/run-node-lmdb-storage-wrapper-20260521.log`, and `temp/validation/run-node-service-sqlite-wrapper-20260521.log`.
- One-hundred-second slice complete with validation caveat, later closed by proof follow-up: indexing metadata, metrics, records, file-processor, chunk-id, and retrieval filter wrapper tests now use `runNode()` where the subprocess is ordinary child Node execution. Syntax, targeted ESLint, direct-wrapper scans, and all five indexing selectors passed under 30 seconds; `retrieval/filters/filter-index-artifact` passed. `retrieval/filters/search-filter-contract-matrix` initially exceeded the 30-second cutoff; the one-hundred-eighth proof follow-up below closes it. Evidence: `temp/validation/run-node-indexing-artifact-wrapper-20260521.log` and `temp/validation/run-node-retrieval-filter-wrapper-20260521.log`.
- One-hundred-third slice complete: indexing determinism, incremental cache, tokenization cache, and chunk-meta determinism wrappers now use `runNode()` for build-index child Node execution while preserving inherited build output, captured chunk-meta failure formatting, cache/test env setup, and explicit status assertions through `allowFailure` where the tests inspect results directly. Syntax, targeted ESLint, a direct-wrapper no-match scan for the touched files, and all five focused selectors passed under the 30-second runner cutoff. Evidence: `temp/validation/run-node-indexing-determinism-wrapper-20260521.log`.
- One-hundred-fourth slice complete with validation caveat, later closed by proof follow-up: the remaining ordinary indexing child-Node wrappers now use `runNode()` across embeddings explicit-index-root failure, extracted-prose chunk-id collision, file-caps, Git blame range, vector-only postings policy/pending-artifacts, SCM provider/build-id coverage, shard merge/progress determinism, and type-inference crossfile/provider fixtures. The slice also fixed SCM annotate behavior so a file-level metadata `unavailable` result no longer suppresses line-level blame authors; only metadata timeouts still block annotate to avoid doubling timeout pressure. Syntax, targeted ESLint, direct-wrapper scans, the Git blame fix proof, and SCM regression selectors passed in `temp/validation/run-node-indexing-safe-wrapper-final-20260521.log` and `temp/validation/git-blame-annotate-unavailable-fix-20260521.log`. The first full behavior batch is preserved in `temp/validation/run-node-indexing-safe-wrapper-batch-20260521.log`; `indexing/file-caps/contract-matrix` initially hit the 30-second cutoff, and the follow-up proof closes it.
- One-hundred-fifth slice complete with validation caveat, later closed by proof follow-up: the remaining ordinary non-indexing candidates from scan 20 now use `runNode()` where they were ordinary child-Node execution. `tests/tooling/script-coverage/group-runner.js` preserves group env/cache setup and inherited output, `tests/shared/logging/contract-matrix.test.js` preserves captured version stderr/stdout assertions, `tests/retrieval/parity/equivalence.test.js` preserves parity build-stage status inspection, and `tests/storage/sqlite/helpers/incremental-scenarios.js` preserves captured search JSON parsing. Docs guard and focused behavior selectors passed; `shared/logging/contract-matrix` and `tooling/script-coverage/core` passed under 30 seconds. `retrieval/parity/equivalence` and `storage/sqlite/incremental/update-contract-matrix` initially hit the 30-second cutoff, and the follow-up proof closes them. Evidence: `temp/validation/run-node-non-indexing-safe-docs-20260521.log` and `temp/validation/run-node-non-indexing-safe-focused-tests-20260521.log`.
- One-hundred-sixth slice complete with validation caveat, later closed by proof follow-up: the scan-21 ordinary perf, optional-backend, graph, daemon, and indexing micro-benchmark wrappers now use `runNode()` while preserving captured JSON/stdout/stderr, inherited build output, explicit expected-nonzero assertions, timeout skip handling, optional dependency gates, Node flag self-reexec, and search/build status checks. The slice also repaired the stale perf-budget selector in `tests/perf/bench/language-regression-gate.test.js` from removed `runner/harness/copy-fixture` to current `runner/harness/pass-target`. Docs guard and focused behavior selectors passed in `temp/validation/run-node-safe-batch2-docs-20260521.log` and `temp/validation/run-node-safe-batch2-focused-tests-20260521.log`, and the repaired perf-budget selector passed in `temp/validation/run-node-safe-batch2-regression-gate-rerun-20260521.log`. The focused batch initially timed out under the 30-second policy for `perf/baseline-artifacts`, `perf/indexing/embeddings/scheduler-backpressure`, `perf/indexing/runtime/scheduler-no-output-regression`, `perf/sqlite-p95-latency`, `retrieval/ann/parity`, `storage/sqlite/ann/sqlite-fallback`, and `tools/service/indexer-daemon-mode`; perf-lane remediation and the follow-up proof close these named caveats.
- One-hundred-seventh slice complete: `tests/tooling/run-node-residual-policy.test.js` now enforces the direct Node subprocess no-adopt policy. It scans `tests/**` for direct `spawnSync(process.execPath, ...)` calls and fails unless each residual call is one of the explicit process-policy owners with the expected count: the `runNode()` helper itself, benchmark runner orchestration, runner meta/harness process-behavior tests, and shared subprocess timeout/abort/quoting/leak semantics. Syntax, targeted ESLint, and the focused policy selector passed in `temp/validation/run-node-residual-policy-20260521.log`.
- Current residual run-node adoption scan: `temp/validation/run-node-current-direct-wrapper-scan-23-20260521.log` records 21 direct `spawnSync(process.execPath, ...)` match lines across 13 files, down from 193 matches across 90 files at `temp/validation/run-node-current-direct-wrapper-scan-11-20260521.log`, 85 across 42 in scan 20, and 79 across 39 in scan 21. Remaining entries are intentionally enforced process-policy categories covered by `tests/tooling/run-node-residual-policy.test.js`: `tests/helpers/run-node.js` itself, `tests/perf/bench/run.test.js` and `tests/perf/bench/scenarios/matrix.test.js` benchmark runner orchestration, `tests/runner/all.js`, `tests/runner/harness/**` process-behavior tests, and `tests/shared/subprocess/**` timeout/abort/quoting/leak semantics.
- Historical deferred attempt, later closed by proof follow-up: `tests/tooling/install/detect-and-plan-contract-matrix.test.js` was reverted to its prior local wrapper after the first child detect command exceeded the 30-second repository cutoff under `runNode()`; the timeout is preserved in `temp/validation/tooling-install-detect-plan-run-node-helper-20260521.log`, and the selector now passes in the one-hundred-eighth proof follow-up below.
- Historical deferred attempt, later superseded by the current runner-list proof: `tests/runner/ci-long-order-selection.test.js` was temporarily restored after focused validation exposed a stale ordered-lane assertion (`indexing/imports/replay-perf-budget` is not present in current child selection). The stale assertion was later repaired in the ninety-fourth runner-list slice, and the live test now uses `runNode()` with current ordered-manifest and selection metadata assertions. Historical timeout/assertion evidence remains in `temp/validation/runner-showcase-sublime-run-node-helper-20260521.log`; current proof is `temp/validation/runner-list-current-proof-20260521.log` and `temp/validation/runner-ci-long-current-shape-20260521.log`.
- One-hundred-eighth proof follow-up complete: the remaining roadmap/backlog timeout-proof selectors from the prior caveats are now covered by bounded production-path fixtures or split selectors without raising the 30-second test limit. The final focused proof passed 11 selectors with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/roadmap-unresolved-proof-fixes-final-20260521.log`: `retrieval/parity/equivalence`, `retrieval/ann/parity`, `retrieval/filters/search-filter-contract-matrix`, `retrieval/filters/search-filter-git-prose-contract`, `storage/sqlite/search-backend-contract-matrix`, `storage/sqlite/search-backend-disabled-dependency`, `storage/sqlite/incremental/update-contract-matrix`, `storage/sqlite/incremental/wal-checkpoint-contract`, `storage/sqlite/maintenance-contract-matrix`, `storage/sqlite/maintenance-sidecar-cleanup`, and `tooling/install/detect-and-plan-contract-matrix`. The first unresolved proof batch also passed `indexing/file-caps/contract-matrix`, `storage/sqlite/ann/sqlite-fallback`, and `tools/service/indexer-daemon-mode` in `temp/validation/roadmap-unresolved-proof-fixes-20260521.log`.
- Remaining work: no known behavior-proof timeout selector remains from the scan 20/21 run-node/helper adoption caveats, the saved duplicate-report follow-up, or the indexer-service queue/repair CLI proof follow-up. Continue only from a fresh governance failure, a new measured performance/import regression, a future intentional `jscpd` refresh, or another roadmap lane with live evidence.

### Future Refresh Reference

The artifacts, seam list, acceptance criteria, validation commands, and checklist below are retained as future-refresh guidance only. They are not an active implementation queue while the shared-module lane is checkpoint clean; reopen them only from fresh governance, duplicate-audit, performance/import, or roadmap evidence.

### Future-only artifacts to inspect

- `docs/tooling/shared-module-ledger.md`
- `docs/tooling/shared-module-ledger.json`
- `docs/tooling/shared-module-scans/416-runtime-server-adoption.md`
- `docs/tooling/shared-module-scans/417-core-product-adoption.md`
- `docs/tooling/shared-module-scans/418-tooling-surface-adoption.md`
- `docs/tooling/shared-module-scans/419-tests-benchmarks-reporting-adoption.md`
- `docs/tooling/shared-module-scans/420-editor-integration-adoption.md`
- `docs/tooling/shared-module-scans/421-platform-path-env-repo-workspace.md`
- `docs/tooling/shared-module-migration-recipes.json`

### Future-only seams to reconsider after fresh evidence

- Repo/workspace identity and path/env normalization:
  - `src/shared/repo-paths.js`
  - `src/shared/path-normalize.js`
  - `src/shared/file-paths.js`
  - `src/shared/file-read.js`
  - `src/shared/env*.js`
  - `src/workspace/**`
  - `tools/shared/fs-utils.js`
  - `tools/shared/git-state.js`
- Search, risk, and context-pack payload shaping:
  - `src/shared/search-request.js`
  - `src/shared/risk-filters.js`
  - `src/context-pack/**`
  - `src/retrieval/**`
  - `src/graph/**`
  - `tools/analysis/**`
  - `tools/mcp/**`
- Progress and report/logging helpers:
  - `src/shared/progress*.js`
  - `src/shared/cli/progress-*`
  - `tools/bench/**`
  - `tools/reports/**`
  - `tools/service/**`
- Test harness and surface parity helpers:
  - `tests/helpers/**`
  - `tools/testing/**`
  - `tests/tooling/shared-module-*.test.js`
  - `tests/indexing/policy/shared-module-*.test.js`

### Future-only Conservative Refactor Pattern

1. Start from one ledger cluster or scan finding, not from a filename stem alone.
2. Confirm at least two consumers have the same contract, error behavior, and path normalization rules.
3. If the shared destination exists, migrate imports directly and add a codemod recipe only for repeated exact-specifier rewrites.
4. If no destination exists, create the smallest owner under the domain that already owns the behavior. Prefer subsystem-local helpers over `src/shared` for ambiguous semantics.
5. Add or update the ledger/scans only in a separate generated-doc refresh task. Do not hand-edit generated files while implementing a migration.

### Future-refresh acceptance criteria

- Every hoist names the duplicate source files, the chosen owner, and the reason the contract is actually shared.
- No migration increases startup-sensitive transitive import counts.
- New shared helpers have at least one direct contract test and at least one migrated real consumer.
- Tool-only helpers stay in `tools/shared/**`; runtime helpers stay in `src/shared/**` or a runtime subsystem.
- Duplicate clusters marked as domain-local are explicitly left alone rather than forced into weak abstractions.

### Future-refresh targeted validation

```powershell
node tools/testing/shared-module-migration.js --check
node tools/testing/shared-module-cycles.js
node tools/testing/shared-module-performance.js --check
node tests/run.js tests/tooling/shared-adoption-contract.test.js tests/tooling/shared-module-migration.test.js tests/tooling/shared-module-performance.test.js tests/tooling/shared-module-cycles.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/shared/repo-paths-parity.test.js tests/shared/path-normalize/path-containment-contract.test.js tests/shared/path-handling.test.js tests/shared/no-path-leak.test.js --lane=all --timeout-ms 30000
node tests/run.js tests/shared/search-request-contract.test.js tests/shared/risk-filters.test.js tests/shared/risk-filter-input.test.js tests/tooling/impact/cli-helpers-format.test.js --lane=all --timeout-ms 30000
```

### Performance and quality guidance

- Do not hoist helpers just because a duplicate stem appears in the ledger. Common stems such as `runtime`, `shared`, `cache`, `utils`, `manifest`, `runner`, `registry`, `relations`, `state`, `validate`, `policy`, and `helpers` are often domain-local.
- Do not move test-only helper behavior into runtime shared modules.
- Do not create helpers that accept broad option bags when each caller currently passes stable, typed values.
- Avoid adding new migration recipes until the destination module and exported names are stable.

## What not to hoist

- Domain-specific `runtime.js`, `policy.js`, `state.js`, `registry.js`, `manifest.js`, or `shared.js` files whose behavior is tied to a single subsystem lifecycle.
- SQLite transaction, prepared statement, WAL, chunk ingest, vector ingest, and incremental-update rules into generic artifact IO.
- CLI help/render details into command registry data.
- Scheduler adaptive policy into progress display or CLI display modules.
- Tool-only filesystem/git/download helpers into `src/shared/**` unless runtime code already needs the same contract.
- Test fixtures and harness conveniences into production shared modules.
- Compatibility shims that only preserve an old path without reducing consumer complexity.

## Why this sequence is best

- The boundary-waiver debt is gone, so the next highest-risk areas are the big shared families used on critical runtime paths: root shared, artifact/storage IO, and subprocess/concurrency.
- CLI/dispatch cleanup matters, but it is less likely to cause correctness regressions than the runtime families above.
- Broad follow-through adoption work should use the new guards and codemods rather than proceeding as a fresh discovery pass.

## Future-refresh completion checklist for each reopened batch

- Current branch and worktree were checked before editing.
- The batch changed only owned implementation files and intentionally scoped tests/docs.
- No unrelated generated files were edited.
- `src/** -> tools/shared/**` runtime imports remain blocked.
- Shared-module migration, cycle, and performance checks were run or explicitly skipped because they exceeded the 30-second limit.
- Targeted tests for the touched families were run or explicitly skipped because they exceeded the 30-second limit.
- Any remaining root facade or wrapper has a clear follow-up reason and is not pretending to be final completion.
