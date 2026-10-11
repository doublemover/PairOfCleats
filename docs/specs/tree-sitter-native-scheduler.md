# Spec: Tree-sitter Native Scheduler Runtime

Status: Active v2.0  
Last updated: 2026-10-11T00:00:00Z

## Goal

Run Stage1 code-mode tree-sitter chunking through a native scheduler-driven pipeline with deterministic artifacts, bounded runtime, and strict failure behavior.

## Scope

- Stage1 tree-sitter planning/execution.
- Native grammar target resolution and preflight.
- Parser pool lifecycle for scheduled grammar work.
- Scheduler artifact contracts consumed by file processing.

Out of scope:

- Mixed native + WASM fallback runtime policy.

## Architecture

- Planner: `src/index/build/tree-sitter-scheduler/plan.js`
- Executor/runner: `executor.js`, `runner.js`, `subprocess-exec.js`
- Lookup/cache: `lookup.js`
- Native runtime bindings: `src/lang/tree-sitter/native-runtime.js`

## Identity contract

- Batch identity: `grammarKey`.
- Grammar keys must be native-only: `native:<languageId>`.
- Scheduler manifests must include parser/grammar version metadata used by cache invalidation.

## Parser lifecycle contract

- Parser pools are keyed by grammar.
- Pool size is bounded and subject to eviction policy.
- Heavy grammars may be preloaded at runtime bootstrap.
- Timeout policy scales by file size/line count/language historical parse cost.

## Planner contract

- Eligible code segments are routed by language and segment metadata.
- Native target resolution must use canonical native target resolver.
- Missing native targets or preflight failures are hard errors in strict mode.
- Planner output ordering must be deterministic.

## Executor contract

- Execution groups by `grammarKey` in subprocess isolation.
- Missing parser activation is a hard error in strict mode.
- Empty chunk result for eligible inputs is a hard error in strict mode.
- Output rows/manifests must be deterministic for identical inputs.

## Stage1 integration

- Stage1 reads tree-sitter chunks from scheduler artifacts when enabled.
- Missing required artifact rows for eligible segments is a hard error.
- Context-window estimation paths keep tree-sitter disabled unless explicitly enabled.

## Validation

Minimum suite:

- `tests/indexing/tree-sitter/scheduler-native-smoke.test.js`
- `tests/indexing/tree-sitter/scheduler-native-plan-contract.test.js`
- `tests/indexing/tree-sitter/scheduler-native-determinism.test.js`
- `tests/indexing/tree-sitter/scheduler-stage1-contract.test.js`
- `tests/indexing/tree-sitter/scheduler-swift-subprocess.test.js`

## Compatibility policy

No legacy scheduler keying or runtime fallback aliases are supported.

## Warm-pool cost handoff

Warm-pool lanes reuse the shard planner's extracted shared `planWeightedBatches`
helper. When every wave in a base grammar has a finite positive
`estimatedParseCost`, independent waves are assigned by that existing deterministic
balancer rather than wave-count round robin. Canonical execution order is restored
inside each lane; each grammar wave is assigned exactly once. Lane count and
subprocess concurrency policy are unchanged. Missing/invalid costs retain the
previous count-based assignment for the entire grammar, so unknown work is not
silently treated as cheap. Task logs expose planned lane cost and cost/count mode.
This does not introduce dependency reordering, new prescans, or different parser
output identities. Cost units predict load; they are not milliseconds or a claim
of measured corpus speedup.
