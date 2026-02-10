# Spec: Tree-sitter Native Scheduler Runtime

Status: Active.

Goal: run Stage1 tree-sitter chunking through a native-only, scheduler-driven pipeline with deterministic artifacts and strict failure behavior.

## Scope
- Stage1 code-mode tree-sitter scheduling and execution.
- Native grammar target resolution and preflight.
- Scheduler artifact contracts used by file processing.

Out of scope:
- Mixed native + WASM runtime strategies.
- WASM preload/eviction lifecycle behavior.

## Architecture
- Planner: `src/index/build/tree-sitter-scheduler/plan.js`
- Executor/subprocess runner:
  - `src/index/build/tree-sitter-scheduler/executor.js`
  - `src/index/build/tree-sitter-scheduler/runner.js`
  - `src/index/build/tree-sitter-scheduler/subprocess-exec.js`
- Lookup/cache: `src/index/build/tree-sitter-scheduler/lookup.js`
- Native runtime bindings: `src/lang/tree-sitter/native-runtime.js`

## Scheduler Identity Contract
- Scheduler batch identity is `grammarKey`.
- Grammar keys are native-only and MUST use `native:<languageId>`.
- `wasmKey` is not used in scheduler plans, jobs, indexes, or result rows.

## Planner Contract
- Eligible code segments are discovered from segment metadata and language routing.
- Native target resolution MUST use `resolveNativeTreeSitterTarget(languageId, ext)`.
- When tree-sitter strict mode is enabled:
  - Missing native target MUST throw.
  - Native grammar preflight failures MUST throw.
- Planner output MUST include `requiredNativeLanguages` and deterministic `grammarKeys` ordering.

## Executor Contract
- Execution is grouped by `grammarKey` and run in subprocess isolation.
- Parser activation MUST use native parser activation only.
- Missing parser activation or empty chunk results in strict mode MUST throw.
- Result manifests and index rows MUST be deterministic for identical input.

## Stage1 Integration Contract
- With tree-sitter enabled in code mode, Stage1 MUST read tree-sitter chunks from scheduler artifacts.
- Missing scheduler artifact rows/chunks for eligible segments MUST be treated as hard errors.
- Context-window estimation and non-scheduler fallback paths MUST keep tree-sitter disabled.

## Validation
Minimum suite:
- `tests/indexing/tree-sitter/tree-sitter-scheduler-native-smoke.test.js`
- `tests/indexing/tree-sitter/tree-sitter-scheduler-native-plan-contract.test.js`
- `tests/indexing/tree-sitter/tree-sitter-scheduler-native-determinism.test.js`
- `tests/indexing/tree-sitter/tree-sitter-scheduler-stage1-contract.test.js`
- `tests/indexing/tree-sitter/tree-sitter-scheduler-swift-subprocess.test.js`
