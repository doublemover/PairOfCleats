# WOODROADMAP - Native-Only Tree-sitter Scheduler

## Snapshot
- Last rewritten: 2026-02-09T18:31:41.0670000Z
- Branch intent: remove WASM tree-sitter entirely and standardize indexing on native tree-sitter grammars only.
- Current branch state: native grammar support is implemented for all target scheduler languages.

## State Assessment

### What is already done (committed)
- Native runtime exists and is integrated into chunking on Windows for mapped grammars.
- Native grammar loading/parsing has been validated for these 17 languages:
  `javascript`, `typescript`/`tsx`, `python`, `json`, `yaml`, `toml`, `markdown`, `kotlin`, `csharp`, `c`, `cpp`, `objc`, `go`, `rust`, `java`, `css`, `html`.
- Native grammar dependency set is present in `package.json`.

### What is already done (currently uncommitted)
- Scheduler execution isolation via subprocess is implemented (`src/index/build/tree-sitter-scheduler/runner.js`, `src/index/build/tree-sitter-scheduler/subprocess-exec.js`).
- Scheduler planner hardening is in place for symlink/minified/unreadable/skip handling (`src/index/build/tree-sitter-scheduler/plan.js`).
- Executor memory/load logging and scheduler strictness work is in place (`src/index/build/tree-sitter-scheduler/executor.js`).
- Strict worker behavior improvements for tree-sitter parsing are in place (`src/lang/workers/tree-sitter-worker.js`).
- Added scheduler subprocess regression test for Swift (`tests/indexing/tree-sitter/tree-sitter-scheduler-swift-subprocess.test.js`).

### Key gaps vs native-only target
- Scheduler data model still uses `wasmKey` naming and grouping.
- Planner/executor still contain WASM preload/prune assumptions.
- Runtime exports and options still carry WASM lifecycle paths that should be removed from indexing path.
- Tests/docs still describe or permit WASM behavior.

## Strategic Direction
Adopt a native-only scheduling model:
- Batch key becomes `grammarKey` in format `native:<languageId>`.
- Every scheduled tree-sitter job uses native runtime only.
- No WASM runtime init, preload, prune, unload, or fallback paths in indexing.
- Stage1 remains strict: tree-sitter work must come from scheduler artifacts; missing scheduler outputs are fatal.

## Scope
- In:
  - Tree-sitter scheduler planning/execution/lookup.
  - Native runtime routing and strictness.
  - Removal of WASM indexing paths, tests, and docs.
- Out:
  - New language onboarding beyond the current native set.
  - Rework of non-tree-sitter chunkers/tokenizers.

## Phase Status Summary
| Phase | Status | Notes |
| --- | --- | --- |
| N0 Baseline + Decisions | completed | Decisions locked at 2026-02-09T18:31:41.0670000Z |
| N1 Schema + Naming Migration | completed | `grammarKey` migration landed in scheduler plan/runner/executor/lookup |
| N2 Planner Native-Only Routing | completed | Planner now resolves native targets + native preflight gating |
| N3 Executor Native-Only Batching | completed | Scheduler executor now runs native-only parse activation/chunking |
| N4 Stage1 Contract Tightening | completed | Stage1 enforces scheduler contract and logs artifact violations |
| N5 Native Coverage + Regression Tests | completed | Native scheduler tests added and passing as of 2026-02-09T18:53:21.1939237Z |
| N6 WASM Removal + Docs Archive | planned | Delete WASM indexing paths and specs |

## Phase N0 - Baseline + Decisions
Objective: lock architecture so implementation proceeds without mixed-runtime ambiguity.

Tasks:
- [x] Confirm canonical batch key: `grammarKey = native:<languageId>`.
- [x] Confirm hard cutover strategy for artifact fields (`wasmKey` removed, not dual-written).
- [x] Confirm native runtime requirement policy in indexing mode (missing native grammar = hard error).
- [x] Confirm scheduler subprocess policy (always-on in indexing mode).

Decisions (locked):
- `grammarKey` is the only batch identity in scheduler artifacts and filenames.
- `wasmKey` is removed from scheduler plan/jobs/results/index schema (no dual-write transition).
- In indexing mode with tree-sitter enabled, unresolved native grammar support is a hard error.
- Scheduler execution runs in subprocess mode by default for all native grammar batches.

## Phase N1 - Schema + Naming Migration
Objective: remove WASM-centric naming and artifacts.

Touchpoints:
- `src/index/build/tree-sitter-scheduler/paths.js`
- `src/index/build/tree-sitter-scheduler/plan.js`
- `src/index/build/tree-sitter-scheduler/executor.js`
- `src/index/build/tree-sitter-scheduler/lookup.js`

Tasks:
- [x] Replace `wasmKey` fields and filenames with `grammarKey`.
- [x] Update plan/jobs/results/index schemas to native-only metadata.
- [x] Keep deterministic ordering and hashing rules unchanged after migration.
- [x] Update lookup loading and stats reporting for `grammarKey`.

## Phase N2 - Planner Native-Only Routing
Objective: planner resolves only native execution targets.

Touchpoints:
- `src/index/build/tree-sitter-scheduler/plan.js`
- `src/lang/tree-sitter/native-runtime.js`

Tasks:
- [x] Add scheduler resolver: `resolveNativeTreeSitterTarget(languageId, ext)`.
- [x] Route all eligible tree-sitter segments through native target resolution.
- [x] Add native preflight for module resolution/parser activation.
- [x] Fail hard when a scheduled language lacks native grammar support in strict mode.

## Phase N3 - Executor Native-Only Batching
Objective: execute by native grammar key only; remove WASM lifecycle assumptions.

Touchpoints:
- `src/index/build/tree-sitter-scheduler/executor.js`
- `src/index/build/tree-sitter-scheduler/subprocess-exec.js`
- `src/index/build/tree-sitter-scheduler/runner.js`

Tasks:
- [x] Remove `preloadTreeSitterLanguages` and `pruneTreeSitterLanguages` usage from scheduler executor.
- [x] Activate parser via native runtime only.
- [x] Preserve subprocess isolation and memory diagnostics.
- [x] Keep strict failure behavior for missing/empty scheduler output.

## Phase N4 - Stage1 Contract Tightening
Objective: ensure indexing tree-sitter path is scheduler-only and native-only.

Touchpoints:
- `src/index/build/indexer/steps/process-files.js`
- `src/index/build/file-processor/cpu.js`
- `src/index/build/context-window.js`

Tasks:
- [x] Enforce scheduler as authoritative tree-sitter source for eligible code segments.
- [x] Remove any remaining WASM fallback assumptions in Stage1 integration.
- [x] Keep context-window estimation tree-sitter disabled.
- [x] Add explicit telemetry/errors for scheduler artifact contract violations.

## Phase N5 - Native Coverage + Regression Tests
Objective: prove native-only scheduler correctness and determinism.

Touchpoints:
- `tests/indexing/tree-sitter/tree-sitter-scheduler-swift-subprocess.test.js`
- `tests/indexing/tree-sitter/*` (new native-only scheduler tests)

Tasks:
- [x] Add scheduler-native smoke test covering all 17 languages.
- [x] Add planner contract test for native target resolution and preflight failures.
- [x] Add determinism test for native scheduler outputs across repeated runs.
- [x] Add regression test proving Stage1 does not perform non-scheduler tree-sitter parsing when enabled.
- [x] Run targeted scheduler suite with `PAIROFCLEATS_TESTING=1` and record outcomes.

Validation (2026-02-09T18:53:21.1939237Z):
- `node tests/indexing/tree-sitter/tree-sitter-scheduler-swift-subprocess.test.js` (pass)
- `node tests/indexing/tree-sitter/tree-sitter-scheduler-native-smoke.test.js` (pass)
- `node tests/indexing/tree-sitter/tree-sitter-scheduler-native-plan-contract.test.js` (pass)
- `node tests/indexing/tree-sitter/tree-sitter-scheduler-native-determinism.test.js` (pass)
- `node tests/indexing/tree-sitter/tree-sitter-scheduler-stage1-contract.test.js` (pass)
- `node tests/run.js --lane all --match tree-sitter-scheduler` (pass)

## Phase N6 - WASM Removal + Docs Archive
Objective: remove WASM indexing code paths and align docs/specs.

Touchpoints:
- `src/lang/tree-sitter/runtime.js`
- `src/lang/tree-sitter/config.js`
- `src/lang/tree-sitter/chunking.js`
- `docs/specs/vfs-tree-sitter-scheduler.md`
- `docs/language/parser-backbone.md`
- `docs/archived/*`

Tasks:
- [ ] Remove WASM runtime usage from indexing path (init/load/preload/prune/reset integration points).
- [ ] Remove scheduler references to WASM keys/files.
- [ ] Update specs/docs to native-only architecture.
- [ ] Archive superseded WASM scheduler guidance with deprecation headers (replacement + reason + date/commit).

## Validation Commands (to run as phases land)
- `node tests/indexing/tree-sitter/tree-sitter-scheduler-swift-subprocess.test.js`
- `node tests/indexing/tree-sitter/tree-sitter-chunks.test.js`
- `node tests/run.js --match tree-sitter-scheduler`

## Exit Criteria
- Scheduler artifacts and execution are native-only (`grammarKey=native:*`).
- No WASM preload/prune/load paths are used by indexing tree-sitter flow.
- Stage1 tree-sitter path is scheduler-driven and strict.
- Native scheduler smoke coverage exists and passes for all 17 languages.
- Docs/specs no longer describe WASM scheduler behavior for indexing.
