# STARFALL_LSP_BLUEPRINT

## Objective
Expand tooling-based type/symbol enrichment beyond the currently integrated providers (`clangd`, `pyright`, `sourcekit-lsp`) with production-grade LSP coverage for additional languages used in benchmark and real repositories.

This is a hard-cutover plan for new capability: one active behavior per surface, no long-term compatibility shims.

## Baseline
- Existing architecture already supports:
  - Built-in providers (`typescript`, `clangd`, `pyright`, `sourcekit`)
  - Generic configurable LSP providers (`tooling.lsp.servers`)
- Existing resilience primitives to reuse:
  - timeout/retry/circuit-breaker
  - virtual document routing
  - provider gating/order selection
  - diagnostics capture/merge

## Core Design Decisions (Updated)

### 1. Dual-Track Provider Model
Use two implementation tracks instead of a single generic approach:
1. Generic LSP provider track (simple servers):
   - Go (`gopls`)
   - Rust (`rust-analyzer`)
   - YAML (`yaml-language-server`)
   - Zig (`zls`)
   - Lua (`lua-language-server`)
2. Dedicated provider track (complex startup/workspace semantics):
   - Java (`jdtls`)
   - C# (`csharp-ls`)
   - Elixir (`elixir-ls`)
   - Haskell (`haskell-language-server`)
   - PHP (`phpactor`)
   - Ruby (`solargraph`)
   - Dart (`dart language-server`)

Rationale: complex servers need custom launch, workspace bootstrapping, and health controls that should not be overfit into generic config.

### 2. Capability-Probed Feature Activation
After `initialize`, probe server capabilities and enable only supported behaviors:
- `textDocument/documentSymbol`
- `textDocument/hover`
- `textDocument/signatureHelp`

If a capability is absent or unstable, degrade feature scope for that provider instead of failing indexing.

### 3. Strict Payload Contract at Provider Boundary
Before merge, run all provider outputs through one shared schema validator/normalizer:
- null-prototype maps for keyed objects
- deterministic arrays for candidate lists
- safe handling of prototype-like keys (`toString`, `constructor`, `__proto__`)
- reject/diagnose invalid payload shapes with explicit codes

### 4. Fail-Open Runtime Policy
Tooling must never block primary indexing completion:
- if server unhealthy/unavailable, continue indexing with non-tooling inference
- emit explicit degraded-mode diagnostics + metrics
- no silent drop of enrichment state

## Server Selection (Best Choice Per Language)

| Language | Selected LSP | Why | Notes |
|---|---|---|---|
| Go | `gopls` | Official server, strong type/symbol quality | Use command resolver to handle version differences |
| Rust | `rust-analyzer` | De-facto standard, fast semantic feedback | Prefer rust-toolchain-aware diagnostics |
| Java | `jdtls` | Most complete Java semantic model | Dedicated provider required |
| C# | `csharp-ls` | Lighter operational footprint than OmniSharp | Dedicated provider + .NET health checks |
| Lua | `lua-language-server` | Mature and widely used | Generic track candidate |
| Ruby | `solargraph` | Strong ecosystem support | Dedicated provider for env handling |
| Elixir | `elixir-ls` | Standard Elixir server | Dedicated provider for OTP/Elixir checks |
| Haskell | `haskell-language-server` | Canonical implementation | Dedicated provider + cradle checks |
| YAML | `yaml-language-server` | Standard YAML support | Disable remote schema fetch by default |
| PHP | `phpactor` | Open-source/self-hostable | Dedicated provider for project/env checks |
| Zig | `zls` | De-facto Zig server | Generic track candidate |
| Dart | `dart language-server` | Official SDK server | Dedicated provider with SDK probing |

## Implementation Plan

### Phase 0: Foundation Hardening
1. Add shared payload validator/normalizer module for all tooling providers.
2. Add shared capability probe layer and per-capability gating.
3. Add shared process health model:
   - restart window tracking
   - crash-loop breaker
   - FD-pressure backoff hooks
4. Add shared provider metrics envelope (structured, machine-readable).

Deliverable: all existing providers (`clangd`, `pyright`, `sourcekit`, `typescript`) migrated to these shared primitives before adding new languages.

### Phase 1: Doctor + Command Resolution Layer
1. Implement per-server command resolver abstraction with OS-specific resolution.
2. Add machine-readable doctor report (`tooling_doctor_report.json`) including:
   - binary discovery
   - version capture
   - minimal initialize handshake
   - runtime dependency checks (JDK/.NET/OTP/GHC/etc)
3. Add CI gating checks consuming doctor report.

#### Command Profile Corrections
- Go: prefer `gopls` by default; use `gopls serve` only when probe confirms support.
- Java/Elixir/Haskell: launch through dedicated resolver workflow, not bare command assumptions.

### Phase 2: Generic Track Rollout
Languages: Go, Rust, YAML, Lua, Zig.

1. Add provider presets that compile into `tooling.lsp.servers` entries.
2. Add per-language fixture suites (small canonical + medium realistic).
3. Add protocol-level integration tests and bench subset runs.
4. Enable by default only after SLO gate pass.

### Phase 3: Dedicated Track Rollout
Languages: Java, C#, Ruby, Elixir, Haskell, PHP, Dart.

1. Implement dedicated providers with custom bootstrap and environment checks.
2. Add workspace bootstrap safeguards (project model detection, config probes).
3. Add crash-loop quarantine and fallback behavior assertions.
4. Enable by default only after SLO gate pass.

### Phase 4: Hard Cutover Cleanup
1. Remove temporary rollout toggles introduced solely for migration.
2. Keep one active configuration path per language.
3. Freeze tests/docs to authoritative behavior.

## Runtime Reliability Requirements

### Process Lifecycle Pooling
1. Pool LSP sessions per `(repoRoot, providerId, workspaceKey)`.
2. Reuse sessions across files/targets to reduce startup cost.
3. Idle timeout + max-lifetime recycle.
4. On repeated crashes, quarantine provider for current repo run.

### Circuit + Backpressure Policy
1. Circuit opens on repeated failures/timeouts.
2. Breaker state and reason logged once and emitted as structured metric.
3. FD-pressure detector reduces concurrency and postpones new session launches.

### Degraded-Mode Behavior
When tooling disabled for a provider during a run:
1. Continue with non-tooling inference.
2. Mark enrichment source as degraded for affected chunk set.
3. Emit one operator-visible summary line and structured event.

## Testing Plan (Exhaustive)

### A. Unit Contract Tests
1. Payload normalization/validation:
   - null-prototype maps
   - prototype-key safety
   - candidate truncation determinism
2. Capability probe behavior:
   - missing capabilities
   - partial capability responses
3. Circuit/retry policies:
   - timeout escalation
   - breaker open/close transitions

### B. Protocol Harness Tests (Fake LSP)
Build a deterministic fake-LSP harness used across providers:
1. Normal request/response flows.
2. Partial frame delivery and fragmentation.
3. Malformed JSON-RPC payloads.
4. Server stall/timeout conditions.
5. Disconnect/reconnect and shutdown races.

### C. Parser/Signature Tests
1. Per-language signature fixtures:
   - optional/default params
   - generics
   - destructured/complex parameter forms
2. Stable normalization assertions for param and return types.

### D. Provider Integration Tests
For each language/provider:
1. Initialize + capability probe + documentSymbol + hover/signature path.
2. Assert enrichment artifacts contain expected param/return metadata.
3. Assert no fatal failures under missing-toolchain scenarios.

### E. End-to-End Indexing Tests
1. Fixture corpora per language:
   - small canonical fixtures (high precision assertions)
   - medium realistic fixtures (operational confidence)
2. Regression suites for:
   - shape corruption
   - prototype-key regressions
   - non-array param bucket regressions

### F. Stability/Soak Tests
1. Repeated-run loops (long duration) to catch:
   - memory growth
   - leaked subprocesses
   - descriptor leaks
2. Crash-loop resilience tests with forced server failures.

### G. Performance + Bench Tests
1. Per-provider latency micro-bench (`p50`, `p95`, timeout ratio).
2. Bench-lang subset with tooling on per language.
3. Guardrails:
   - max incremental wall-time overhead
   - max timeout/error rate
   - max breaker-open incidence

### H. CI Lane Placement
1. `ci-lite`:
   - schema/shape/capability contract tests
2. `ci`:
   - protocol harness + parser + provider smoke integration
3. `ci-long`:
   - full language matrix E2E + soak + perf guardrails

## SLO Gates for Default Enablement
A language is enabled-by-default only when all pass:
1. Tooling timeout ratio <= target threshold.
2. Fatal provider failure rate <= target threshold.
3. Enrichment coverage meets minimum fixture+bench target.
4. Added indexing wall-time within budget.
5. No shape-contract violations in CI.

## Operational Monitoring
Emit structured per-provider metrics:
- request counts, success/error/timeout rates
- breaker state transitions
- restart counts + quarantine events
- capability mask
- p50/p95 latency
- degraded-mode activation counts

Add weekly benchmark report for tooling-enabled languages with regression diff.

## Per-Language Detailed Tasks

### Go (`gopls`)
1. Implement command resolver (`gopls` first, probe `serve` support).
2. Add module/workspace diagnostics handling.
3. Add fixture suite + bench subset.
4. Gate default enablement on SLOs.

### Rust (`rust-analyzer`)
1. Add proc-macro diagnostic suppression policy (non-fatal categories only).
2. Add fixture suite for trait/generic-heavy signatures.
3. Add long-run stability checks in rust-heavy repos.

### YAML (`yaml-language-server`)
1. Default remote schema fetch off for deterministic CI.
2. Add schema-map override config tests.
3. Validate no network dependency in baseline test lanes.

### Lua (`lua-language-server`)
1. Add optional workspace library settings support.
2. Add fixture coverage for module/require patterns.
3. Verify stable performance on medium repos.

### Zig (`zls`)
1. Add zig/zls compatibility checks in doctor.
2. Add fixture coverage for generic/error union signatures.
3. Validate degraded-mode fallback when toolchain absent.

### Java (`jdtls`)
1. Implement dedicated provider bootstrap and workspace model resolution.
2. Add JDK/version checks and structured failure reasons.
3. Add fixture + medium project integration tests.

### C# (`csharp-ls`)
1. Implement dedicated provider with .NET runtime checks.
2. Add solution/project probing and diagnostics.
3. Add fixture coverage for method overload signatures.

### Ruby (`solargraph`)
1. Implement environment-aware launch (gem/runtime checks).
2. Add fixture tests for module/class method signatures.
3. Add fallback behavior tests when gem env is invalid.

### Elixir (`elixir-ls`)
1. Implement dedicated provider with OTP/Elixir compatibility checks.
2. Add fixture coverage for module/function signatures.
3. Add startup timeout/handshake reliability tests.

### Haskell (`haskell-language-server`)
1. Add cradle + GHC compatibility doctor checks.
2. Add fixture coverage for typeclass-heavy signatures.
3. Add degraded-mode path assertions for cradle failures.

### PHP (`phpactor`)
1. Implement dedicated provider with project readiness checks.
2. Add fixture coverage for namespaced symbol signatures.
3. Add fallback tests for missing composer context.

### Dart (`dart language-server`)
1. Implement dedicated provider with SDK path checks.
2. Add fixture coverage for class/method signatures.
3. Add process reuse + startup cost assertions.

## Acceptance Checklist (Per Language)
1. Doctor check green and machine-readable output present.
2. Capability probe stable in integration tests.
3. Fixture E2E enrichment assertions pass.
4. Soak/stability tests pass.
5. Bench subset passes within guardrails.
6. SLO gates met for default enablement.

## New Workstream: Contract-Driven Enrichment Completeness

### Objective
Guarantee baseline function-signature enrichment quality (return type + typed params when available) with minimal latency overhead, while preserving fail-open behavior.

### Design Principles
1. `documentSymbol.detail` is a hint, not an authoritative type payload.
2. Enrichment quality is evaluated against an explicit completeness contract.
3. Source-signature fallback is last-resort after LSP attempts.
4. Merge logic is quality-scored, not first-wins.
5. Annotation and tooling evidence are both retained with explicit provenance.

### Phase A: Completeness Contract + Hover Trigger Policy
1. Add `isIncompleteTypePayload(...)` in `src/integrations/tooling/providers/lsp/hover-types.js`.
2. Mark function/method symbols incomplete when return type is missing/ambiguous.
3. Mark function/method symbols incomplete when typed params are missing for declared params.
4. Trigger hover on incompleteness, not only ambiguous return type.
5. Keep existing hover dedupe, timeout suppression, and per-file budget controls active.

### Phase B: Quality-Scored Merge
1. Introduce `scoreSignatureInfo(...)` in `src/integrations/tooling/providers/lsp/hover-types.js`.
2. Update `mergeSignatureInfo(...)` to choose higher-quality fields deterministically.
3. Prefer richer hover payloads over weaker symbol-detail payloads when scores differ.
4. Keep deterministic tie-break behavior for reproducibility.

### Phase C: Source Fallback Discipline
1. Keep source extraction fallback only when post-hover payload is still incomplete.
2. Preserve same-line return annotation text when deriving source signature candidates.
3. Add explicit fallback reason codes for each fallback path.

### Phase D: Parser Hardening (Python First)
1. Expand Python signature parsing in `src/index/tooling/signature-parse/python.js` for hover markdown/code-fence variants.
2. Normalize additional pyright formatting variants without widening false positives.
3. Add strict parser fixtures for multiline and decorated signatures.

### Phase E: Telemetry + Operator Visibility
1. Add counters in `src/integrations/tooling/providers/lsp.js`:
2. `incompleteSymbols`.
3. `hoverTriggeredByIncomplete`.
4. `fallbackUsed`.
5. `fallbackReasonCounts`.
6. Emit one concise summary log line when fallback use crosses threshold in a run.

### Phase F: Command Resolution Determinism for Tests
1. Ensure LSP integration tests can pin exact provider command paths when required.
2. Update pyright-sensitive tests to avoid implicit command-resolution ambiguity.
3. Keep production command resolution behavior unchanged unless explicitly configured.

### Testing Tasks (Mandatory)
1. Add protocol test: documentSymbol missing params, hover fills params+return, tooling provenance retained.
2. Add protocol test: documentSymbol missing return, hover fills return deterministically.
3. Add protocol test: hover timeout, fallback applies with reason code and no fatal failure.
4. Add parser test matrix for Python hover payload variants.
5. Add merge-quality tests to ensure richer payload supersedes weaker payload.
6. Add command-resolution determinism tests for pyright fixture runs.
7. Keep existing `tests/indexing/type-inference/providers/type-inference-lsp-enrichment.test.js` as baseline regression coverage.

### Performance Guardrails
1. Added hover requests per file must remain bounded by existing budget controls.
2. No regression in timeout ratio beyond agreed SLO threshold.
3. No regression in bench-lang wall-time beyond agreed SLO threshold.
4. No increase in breaker-open incidence for LSP providers.

### Acceptance Criteria
1. Python enrichment consistently produces tooling-origin return and param entries on fixture corpus.
2. Fallback reason metrics are visible and non-zero only under incomplete payload conditions.
3. CI contract, protocol, and parser suites pass with no new flake signatures.
4. Bench-lang subset validates no material throughput regression.

## New Workstream: LSP Max-Performance + Max-Fidelity Program (All Supported Providers)

### Scope and Supported Providers
This workstream applies to every currently supported LSP-backed provider and command profile:
1. `clangd`
2. `pyright`
3. `sourcekit-lsp`
4. `gopls`
5. `rust-analyzer`
6. `yaml-language-server`
7. `lua-language-server`
8. `zls`
9. `jdtls`
10. `csharp-ls`
11. `elixir-ls`
12. `haskell-language-server`
13. `phpactor`
14. `solargraph`
15. `dart language-server`

### Program Goal
Build a multi-stage, capability-aware, high-throughput enrichment system that:
1. Maximizes type/symbol accuracy.
2. Preserves deterministic performance and bounded overhead.
3. Survives provider instability without indexing failure.
4. Produces explicit quality and reliability telemetry suitable for CI gating and operator triage.

### Workstream A: Multi-Stage Enrichment Pipeline (Contract-Driven)
1. Implement unified stage sequencing for symbol/type extraction:
2. Stage 1: `documentSymbol` primary pass.
3. Stage 2: targeted `hover` for incomplete symbol payloads.
4. Stage 3: targeted `signatureHelp` for unresolved signature shape.
5. Stage 4: bounded source-signature fallback with reason codes.
6. Add completeness contracts per symbol kind:
7. Function/method: return + typed params contract.
8. Constructor/init: parameter contract, optional return contract.
9. Variable/property/function-typed field: type contract.
10. Add deterministic merge scoring:
11. Rank by provider capability confidence and payload richness.
12. Prefer richer typed payload over partial payload.
13. Preserve multi-source provenance and confidence in final artifacts.

### Workstream B: Symbol Resolution Expansion (`definition`, `typeDefinition`, `references`)
1. Add optional targeted `textDocument/definition` requests for unresolved symbols.
2. Add optional targeted `textDocument/typeDefinition` requests for unresolved type references.
3. Add optional `textDocument/references` for high-value symbols only:
4. Public functions/methods.
5. Exported symbols.
6. Symbols participating in unresolved import diagnostics.
7. Integrate resolved locations into existing cross-file relation graph.
8. Add confidence tiers for location-derived links:
9. exact location hit.
10. same-file narrowed candidate.
11. cross-file heuristic candidate.
12. Add strict caps per file/workspace for these requests.

### Workstream C: Provider-Adaptive Request Budgeting + Throughput Control
1. Add separate adaptive budgets for each request class:
2. `documentSymbol` concurrency budget.
3. `hover` request budget.
4. `signatureHelp` request budget.
5. `definition/typeDefinition/references` request budget.
6. Adapt budgets by live provider health metrics:
7. timeout rate.
8. failed request rate.
9. median and tail latency.
10. breaker/quarantine state.
11. Add weighted fairness scheduler across providers to prevent one slow server from stalling global tooling progress.
12. Add workspace-level cost ceilings to bound absolute latency overhead.

### Workstream D: LSP Cache Architecture (Deterministic + High Hit Rate)
1. Introduce per-request normalized cache keys:
2. `(providerId, providerVersion, workspaceKey, docHash, position, requestKind, policyVersion)`.
3. Add cache tiers:
4. in-memory hot cache per run.
5. persisted cache with bounded size and LRU trimming.
6. Add strict invalidation triggers:
7. doc hash change.
8. provider binary/version/config hash change.
9. workspace model hash change.
10. request-policy version change.
11. Add negative caching for known unsupported capabilities with short TTL.
12. Add cache hit/miss telemetry split by request kind and provider.

### Workstream E: Semantic Tokens + Inlay Hints Ingestion
1. Add capability-gated ingestion of semantic tokens for symbol/category precision.
2. Add low-confidence ingestion of inlay/inline type hints where available.
3. Normalize semantic token categories into index-internal type classes.
4. Prevent noisy or unstable token streams from overriding higher-confidence signature data.
5. Add provider-specific token mapping tables and tests.

### Workstream F: Type Normalization and Canonicalization Layer
1. Build shared type normalization module with per-language adapters:
2. nullability normalization.
3. generic syntax normalization.
4. namespace/module prefix normalization.
5. alias/canonical type mapping.
6. Add stable string canonical forms for index/retrieval.
7. Preserve original source type text alongside canonical form for debugging and display.
8. Add per-language fixtures for tricky forms:
9. nested generics.
10. union/intersection or equivalent.
11. type aliases.
12. optional/default parameter variants.

### Workstream G: Provider Quality Scoring + Confidence Calibration
1. Add provider quality model producing per-run and rolling quality scores:
2. completeness ratio.
3. conflict rate with parser/annotation data.
4. unresolved symbol rate.
5. timeout/error rate.
6. Add confidence calibration pipeline:
7. map request/source kind to base confidence.
8. decay confidence when instability indicators rise.
9. raise confidence for validated definition/typeDefinition matches.
10. Use quality score to weight merge decisions and downstream retrieval metadata.

### Workstream H: Workspace Modeling for Monorepos and Multi-Root
1. Add workspace discovery model per provider:
2. root marker scan.
3. nested workspace detection.
4. multi-root partitioning.
5. route files to provider session by workspace partition key.
6. Add per-provider workspace bootstrap checks:
7. `go.mod/go.work` for Go.
8. Cargo workspace markers for Rust.
9. Gradle/Maven markers for Java.
10. solution/project markers for C#.
11. OTP/project markers for Elixir.
12. Cradle/GHC markers for Haskell.
13. Composer markers for PHP.
14. Gem/Bundler markers for Ruby.
15. SDK/project markers for Dart.
16. emit deterministic workspace-model diagnostics when model incomplete.

### Workstream I: Reliability Hardening (Crash-Loop, Quarantine, Auto-Recovery)
1. Expand lifecycle health tracker to include:
2. startup failure streak.
3. handshake failure streak.
4. protocol parse failure rate.
5. FD-pressure event density.
6. Add two-level quarantine:
7. short quarantine for transient instability.
8. extended quarantine for repeated crash loops.
9. Add controlled auto-recovery probes after quarantine cooldown.
10. Add per-provider fail-open policies with explicit degraded-mode reason codes.
11. Ensure non-fatal degraded provider paths never block index completion.

### Workstream J: Observability and Operator Tooling
1. Expand structured runtime envelope per provider:
2. capability mask.
3. request counts/success/fail/timeout by request kind.
4. p50/p95/p99 latency by request kind.
5. cache hit/miss rates.
6. completeness and fallback reason metrics.
7. breaker/quarantine transitions.
8. Add concise end-of-run provider summary lines in benchmark/index logs.
9. Add machine-readable diagnostics artifacts for CI and triage.
10. Add regression diff reports between runs for quality and latency metrics.

### Workstream K: Test Harness and Fault Injection Expansion
1. Extend fake-LSP harness to support:
2. method-specific malformed payloads.
3. delayed partial responses.
4. inconsistent cross-method metadata.
5. capability drift mid-session.
6. forced disconnects on specific methods.
7. Add replay harness for real JSON-RPC traces:
8. capture from live providers.
9. deterministic replay in CI.
10. Add exhaustive contract tests for every request stage and fallback path.
11. Add per-provider compatibility suites under `ci` and stability/perf suites under `ci-long`.

### Workstream L: Bench + CI Guardrails (Hard Gates)
1. Add CI gates for:
2. enrichment completeness minimums.
3. request timeout ratio maximums.
4. breaker/quarantine incidence maximums.
5. end-to-end wall-time overhead budgets.
6. cache effectiveness minimums.
7. Add bench-lang subset validation across all supported providers.
8. Fail CI when guardrails regress beyond configured thresholds.

### Workstream M: Per-Provider Detailed Delta Tasks

#### `clangd`
1. Improve overload and template signature normalization.
2. Add targeted definition/typeDefinition for unresolved C/C++ references.
3. Harden fallback for header/source split symbols.

#### `pyright`
1. Expand parser coverage for hover markdown variants.
2. Add signatureHelp fallback for incomplete parameter lists.
3. Improve workspace-root behavior for nested Python projects.

#### `sourcekit-lsp`
1. Improve Swift generic and protocol-conformance signature normalization.
2. Add targeted definition for unresolved framework symbols.
3. Add stability tuning for workspace indexing warmup spikes.

#### `gopls`
1. Prefer workspace-mode correctness in monorepos with nested modules.
2. Add definition/typeDefinition for interface and method sets.
3. Add request-budget tuning for large module graphs.

#### `rust-analyzer`
1. Integrate richer typeDefinition paths for trait and generic contexts.
2. Keep proc-macro warning suppression strict and non-fatal.
3. Add aggressive timeout safeguards for heavy macro workspaces.

#### `yaml-language-server`
1. Preserve deterministic no-network baseline behavior.
2. Improve schema-driven hover/type extraction.
3. Add schema-map aware confidence adjustments.

#### `lua-language-server`
1. Improve workspace library-aware type extraction paths.
2. Add module `require` resolution enrichment.
3. Add fallback precision tests for dynamic table types.

#### `zls`
1. Improve error-union and optional type normalization.
2. Add targeted definition for unresolved Zig symbols.
3. Add compatibility checks for Zig/ZLS version mismatches.

#### `jdtls`
1. Improve workspace bootstrap and classpath diagnostics.
2. Add definition/typeDefinition for Java generics and overloads.
3. Add startup resilience for heavy project model initialization.

#### `csharp-ls`
1. Improve solution/project model routing.
2. Add overload and nullable reference type normalization.
3. Add reliability gates for SDK/runtime mismatch scenarios.

#### `elixir-ls`
1. Improve OTP-aware workspace checks.
2. Add richer type extraction from specs/docs when available.
3. Add resilience for slower handshake/project bootstrap phases.

#### `haskell-language-server`
1. Improve cradle-aware fallback reasoning and diagnostics.
2. Add typeclass-heavy signature normalization fixtures.
3. Add conservative request budget defaults for large projects.

#### `phpactor`
1. Improve namespace and classmap-driven type normalization.
2. Add definition-based recovery for unresolved namespaced symbols.
3. Add composer/project-readiness diagnostics and confidence effects.

#### `solargraph`
1. Improve module/class method signature handling.
2. Add definition recovery for unresolved Ruby constants.
3. Add runtime environment diagnostics integration.

#### `dart language-server`
1. Improve null-safety and generic signature normalization.
2. Add targeted definition/typeDefinition for unresolved framework symbols.
3. Add workspace SDK/model readiness gating.

### Workstream N: Documentation, Contracts, and Operator Playbooks
1. Update provider contract docs with stage semantics and completeness rules.
2. Document fallback reason codes and reliability states.
3. Document performance tuning knobs and recommended defaults.
4. Add operator playbook for degraded-mode triage and provider quarantine events.

### Master Acceptance Criteria
1. All supported providers run through the multi-stage contract pipeline.
2. All supported providers emit standardized runtime/quality telemetry.
3. No provider can block indexing completion due to tooling failures.
4. Bench and CI guardrails pass with no unacceptable throughput regression.
5. Accuracy/completeness improves measurably on fixture and benchmark corpora.
6. Replay/fault-injection suites validate reliability under adversarial protocol conditions.

## Immediate Next Actions
1. Implement shared payload validator + capability probe + lifecycle health primitives.
2. Migrate existing providers to new shared primitives.
3. Add fake-LSP harness and protocol fault-injection tests.
4. Land generic track languages first (Go/Rust/YAML/Lua/Zig).
5. Land dedicated track providers with doctor gates.
6. Flip defaults language-by-language only after SLO approval.
