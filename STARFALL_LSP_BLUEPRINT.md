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

## Immediate Next Actions
1. Implement shared payload validator + capability probe + lifecycle health primitives.
2. Migrate existing providers to new shared primitives.
3. Add fake-LSP harness and protocol fault-injection tests.
4. Land generic track languages first (Go/Rust/YAML/Lua/Zig).
5. Land dedicated track providers with doctor gates.
6. Flip defaults language-by-language only after SLO approval.