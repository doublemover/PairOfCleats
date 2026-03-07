# NOVA Import Resolution Blueprint

## Mission
Comprehensively hard-cut unresolved import handling to a high-reliability, high-throughput, low-noise architecture that:
- Separates real failures from expected/generated/parser artifacts.
- Preserves deterministic behavior and strict cache compatibility.
- Scales to large benchmark repos without pathological latency.

## Primary Goals
- Reliability: zero ambiguous unresolved states in emitted artifacts.
- Throughput: bounded resolver work per specifier with stable worst-case behavior.
- Performance: reduce filesystem probe amplification and resolver churn.
- Accuracy: sharply reduce false positives (parser artifacts and resolver gaps misclassified as missing files).

## Non-Goals
- No legacy compatibility mode.
- No dual-read/dual-write taxonomy.
- No gradual migration shims.

## Hard-Cutover Policy
- One active behavior only.
- Old import-resolution cache and taxonomy artifacts become incompatible in a single cutover commit.
- Contract, runtime, and tests update together in the same phase.

## New Canonical Decision Model
Replace single bucket categories with orthogonal fields:
- `resolutionState`: `resolved | unresolved`
- `failureCause`: `missing_file | missing_dependency | generated_expected_missing | parser_artifact | resolver_gap | parse_error | unknown`
- `disposition`: `actionable | suppress_live | suppress_gate`
- `resolverStage`: `collector | normalize | language_resolver | build_system_resolver | filesystem_probe | classify`
- `reasonCode`: stable enum key for machine analysis and gating.

## Lanes (Up To 5 Parallel Tracks)
Work that can run in parallel is explicitly split. Merge order is controlled by dependency waves.

### Lane A - Contracts, Taxonomy, and Diagnostics Schema
Owner scope:
- `src/contracts/**`
- unresolved diagnostics record shape in artifacts
- reason-code registry

Tasks:
- Define `failureCause`, `disposition`, `resolverStage`, and `reasonCode` enums in contracts.
- Add schema version bump for import diagnostics payload.
- Add strict validation helper for unresolved records.
- Add normalization helper for legacy/unknown values (for in-process safety only, not backcompat).
- Add invariants:
  - `resolutionState=resolved` => no `failureCause`.
  - `resolutionState=unresolved` => required `failureCause`, `reasonCode`, `disposition`.
  - `disposition=actionable` allowed only for actionable causes.

Acceptance:
- Contract tests reject malformed unresolved entries.
- Artifact validators fail fast with precise reason code.

Parallelism:
- Can start immediately.
- Must land before final integration of Lanes B/C/D/E.

---

### Lane B - Collector Precision and Parser-Artifact Suppression
Owner scope:
- `src/index/language-registry/import-collectors/**`
- collector shared utils

Tasks:
- Move parser-artifact suppression upstream into collectors.
- Introduce comment/doc masking helpers for noisy grammars (Nix, Starlark, template-like syntaxes).
- Add strict token-context validation:
  - token appears in import-expression context, not doc/example literal.
  - quoted/unquoted path tokens parsed with stateful quote/comment handling.
- Replace regex-only capture where feasible with parse-aware extraction hooks.
- Add collector-level cause tagging hints (`collectorHint`) for downstream classifier.
- Add bounded line/token scanning budgets with deterministic fallback.

Advanced improvements:
- Per-collector lightweight DFA scanners for quotes/comments.
- Shared fast-path filter before expensive parsing.

Acceptance:
- False-positive-heavy fixtures move to `parser_artifact`.
- Bench replay fixtures show reduced unresolved noise without missed true positives.

Parallelism:
- Can run in parallel with Lane A and Lane C.
- Minimal dependency on Lane D/E.

---

### Lane C - Build-System and Generated-Expectation Resolver
Owner scope:
- `src/index/build/import-resolution/**`
- repository metadata resolvers

Tasks:
- Add plugin-driven build-context resolver layer with precompiled repo context:
  - TypeScript: `tsconfig` aliases, `baseUrl`, `paths`, outDir/source emit mapping.
  - Bazel/Starlark: label parsing (`//pkg:target`, `:target`, `@repo//pkg:target`), ext inference rules.
  - Nix/flake: local path imports vs flake input references.
  - Proto/OpenAPI/codegen conventions: emitted target expectations.
- Build a per-repo expected-artifacts index at init:
  - deterministic map of likely generated outputs.
  - immutable during run except explicit invalidation.
- Classify unresolveds matching expected outputs as `generated_expected_missing`.
- Classify unsupported build-system forms as `resolver_gap` (not `missing_file`).

Advanced improvements:
- Resolver plugin capability registry with deterministic priority.
- Pre-hashed lookup tables for O(1)-style matching.

Acceptance:
- Known generated-target unresolved imports no longer counted actionable.
- Bazel/Nix hotspot repos reclassified correctly.

Parallelism:
- Can run in parallel with A/B.
- Integrates with Lane D staged pipeline before final merge.

---

### Lane D - Staged Resolver Pipeline, Budgets, and Caching
Owner scope:
- `src/index/build/import-resolution/engine.js`
- resolver orchestration and cache modules

Tasks:
- Refactor resolver into explicit staged pipeline:
  - Stage 1 normalize
  - Stage 2 language resolver
  - Stage 3 build-system resolver (Lane C)
  - Stage 4 bounded filesystem probe
  - Stage 5 classification + disposition
- Add stage-level timing and per-stage reason codes.
- Add bounded search budgets:
  - max candidates/specifier
  - max fs probes/specifier
  - max fallback depth
- Add adaptive budget policy tied to queue pressure/runtime envelope.
- Add robust negative cache key:
  - `(importer, specifier, resolverVersion, workspaceFingerprint, buildContextFingerprint)`
- Add fast filesystem existence accelerator:
  - repo-level compact existence index (Bloom + exact verification map)
  - avoid repeated `stat` churn.

Advanced improvements:
- Failure-aware short-circuiting when resolver stages prove non-actionable paths.
- Adaptive fanout tuned by observed hit-rate and queue pressure.

Acceptance:
- No unbounded resolver behavior.
- Reduced filesystem probes and improved p95 import-resolution time.

Parallelism:
- Can start after initial Lane C interfaces are defined.
- Can run in parallel with Lane E test harness build-out.

---

### Lane E - Logging, SLO/Gating, Replay Testing, and Bench Validation
Owner scope:
- import scan step logging
- CI gates and test fixtures
- benchmark replay tooling

Tasks:
- Split unresolved telemetry into three explicit rates:
  - `actionable_unresolved_rate`
  - `parser_artifact_rate`
  - `resolver_gap_rate`
- Gate only on actionable unresolved rate.
- Alert/report on parser artifact and resolver gap drift.
- Add reason-code histogram logging and top hotspot emitters by language/repo/path.
- Add replay harness consuming captured bench unresolved samples.
- Add metamorphic tests:
  - path normalization variants equivalent classification.
  - comment/doc placement changes do not alter real import detection.
- Add deterministic performance tests:
  - fs probe budget enforcement.
  - cache hit/miss behavior by resolver stage.

Acceptance:
- CI failures become high-signal.
- Bench diagnostics artifacts are root-cause actionable.

Parallelism:
- Can start once Lane A field contracts are stable.
- Final gate tuning happens after B/C/D merge.

## Dependency Waves

### Wave 0 (Parallel bootstrap)
- Lane A: schema and enum definitions
- Lane B: collector hardening scaffolding
- Lane C: plugin interfaces and build-context index design
- Lane E: replay harness skeleton and metrics scaffolding

### Wave 1 (Core behavior)
- Lane C implements generated/build-system classification.
- Lane D integrates staged pipeline and bounded budgets using Lane C interfaces.
- Lane B completes parser-artifact suppression and plugs into new classifier.

### Wave 2 (Cutover integration)
- Lane A final schema enforcement merged with runtime writes.
- Lane E switches SLO/gates to new actionable metric only.
- Cache schema/version bump and strict invalidation.

### Wave 3 (Stabilization and perf hardening)
- Bench replay corpus validation.
- Real benchmark validation on hotspot repos.
- Tune adaptive budgets and cache policies.

## Detailed Work Items Mapped to the 8 Core Items

### Item 1 - First-class outcome model (upgraded)
- Implement orthogonal decision fields (not one category enum).
- Add reason-code registry module with stable IDs.
- Replace downstream logic that assumes category-only decisions.
- Ensure artifacts and live logs emit identical semantics.

### Item 2 - Generated expectation resolver (upgraded)
- Build repo-scoped expected-artifacts index once per run.
- Add resolver plugin SDK for language/build-system-specific expectations.
- Keep generated expectation checks before filesystem fallback when possible.

### Item 3 - Parser-artifact verification (upgraded)
- Shift filtering to collector-time.
- Introduce collector confidence tiers and downstream sanity checks.
- Add strict handling for comments/examples/docstrings.

### Item 4 - Resolver semantics and bounds (upgraded)
- Stage pipeline with explicit per-stage outcomes.
- Introduce bounded probe budgets and adaptive throttling.
- Track and expose budget exhaustion reason codes.

### Item 5 - Rich unresolved evidence (upgraded)
- Store compact structured diagnostics with enum-backed fields.
- Sample full evidence details while keeping artifact size bounded.
- Preserve deterministic sort and stable keying.

### Item 6 - Logging and SLO split (upgraded)
- Gate only actionable unresolveds.
- Keep parser/resolver artifact rates as quality drift indicators.
- Add hotspot aggregation per language/repo/stage.

### Item 7 - Test strategy (upgraded)
- Add replay tests from real bench unresolved artifacts.
- Add metamorphic/path normalization tests.
- Add performance budget tests and cache invalidation tests.

### Item 8 - Hard cutover/cache invalidation (upgraded)
- Bump import-resolution schema and cache key version atomically.
- Hard-fail incompatible caches with explicit remediation logs.
- Remove old taxonomy handling paths in same commit set.

## Required New Shared Modules
- `src/index/build/import-resolution/reason-codes.js`
- `src/index/build/import-resolution/disposition.js`
- `src/index/build/import-resolution/stage-pipeline.js`
- `src/index/build/import-resolution/expected-artifacts-index.js`
- `src/index/build/import-resolution/build-context/plugins/*.js`
- `src/index/language-registry/import-collectors/comment-aware.js`
- `src/index/build/import-resolution/fs-exists-index.js`

## Performance and Reliability Guardrails
- Hard caps:
  - max candidates/specifier
  - max probe ops/specifier
  - max warnings emitted live
- Adaptive controls:
  - lower probe budget under queue pressure
  - raise short-circuit aggressiveness when cache miss storm detected
- Determinism:
  - stable sorting for diagnostics output
  - stable reason-code ordering in summaries
- Failure safety:
  - resolver stage timeouts become stage-scoped degraded reasons, not global failure

## Observability Requirements
- Per-stage counters:
  - attempts, hits, misses, budget_exhausted, degraded, elapsed_ms
- Per-cause counters:
  - actionable and non-actionable split
- Per-repo hotspots:
  - top importers with unresolved actionable count
  - top reason codes
- Cache diagnostics:
  - positive/negative cache hit rates
  - invalidation reasons and frequencies

## Test Matrix (Must Implement)
- Unit:
  - classifier invariants and reason-code mappings
  - disposition assignment rules
  - build-context resolvers per ecosystem
- Integration:
  - import-resolution pipeline stage transitions
  - cache compatibility and invalidation behavior
  - emitted artifact schema conformance
- Replay:
  - benchmark unresolved corpora replay with expected taxonomy outputs
- Performance:
  - bounded fs probes under pathological unresolved sets
  - p50/p95/p99 stage timings vs baseline
- Regression:
  - hotspot repos: GraphQL TS emit mismatch, Bazel labels, Nix examples/comments, Makefile generated helper refs

## CI and Lane Placement Updates
- Add dedicated import-resolution replay lane test(s) to `ci`.
- Put long-running corpus/perf replay checks in `ci-long`.
- Keep deterministic unit contracts in `ci-lite` where runtime < 15s.

## Rollout Steps
1. Land contracts + reason-code registry.
2. Land collector hardening and parser-artifact suppression.
3. Land build-context plugins + expected-artifacts index.
4. Land staged resolver + bounded budgets + caches.
5. Flip logging/gates to actionable-only unresolved SLO.
6. Perform hard cache/schema cutover.
7. Run replay and benchmark hotspot validation.
8. Remove superseded code paths and finalize docs/contracts.

## Definition of Done
- All unresolved diagnostics conform to new schema.
- No legacy unresolved category path remains.
- Actionable unresolved rate reflects real failures only.
- Parser-artifact and resolver-gap drift is observable and non-gating.
- Bench hotspot repos show materially improved classification accuracy.
- Resolver remains bounded and stable under high-pressure repos.

## Risk Register and Mitigations
- Risk: over-suppression hides real failures.
  - Mitigation: disposition rules require explicit reason codes and confidence floors.
- Risk: plugin complexity regresses throughput.
  - Mitigation: compile build-context once; strict per-stage budgets.
- Risk: cache invalidation churn.
  - Mitigation: deterministic fingerprints and explicit invalidation reasons.
- Risk: noisy collector changes break language coverage.
  - Mitigation: replay corpus + language-specific regression fixtures.

## Execution Notes
- Prefer small, granular commits per lane milestone.
- Keep artifact contract updates and runtime writer updates in same commit.
- Every new reason code must include tests, docs, and live-log formatting support.
- Any new resolver plugin must include benchmark replay fixture coverage.
