# PREMATURE FLIGHTULATION

## Mission
Move SourceKit package preflight from late provider-time execution to an early, deterministic, lifecycle-owned preflight system, then generalize that system into a reusable tooling preflight framework for all applicable providers.

## Primary Outcomes
- Reliability: no late-stage hangs caused by tooling preflight subprocesses.
- Throughput: preflight work overlaps with indexing startup instead of blocking provider collect paths.
- Determinism: one preflight execution per repo/build context with explicit state transitions.
- Observability: clear preflight lifecycle events in logs and diagnostics.
- Generalization: shared preflight framework used by SourceKit first, then other providers.

## Hard-Cutover Rules
- One active behavior: provider paths do not run toolchain preflight directly.
- No dual-path long-term shims for SourceKit preflight.
- Runtime + diagnostics + tests land together per phase.

## Non-Goals
- No temporary gate based on provider latency pass/fail.
- No legacy compatibility mode for old provider-owned preflight behavior.

## Current Problem Statement
- `sourcekit package preflight` currently runs from SourceKit provider collection time.
- If `swift package resolve` is slow/fails/stalls, this occurs late in stage execution and can destabilize closeout.
- Provider collect path currently owns preflight orchestration concerns (lock/marker/resolve), mixing responsibilities.

## Target Architecture

### A. Preflight Manager (Shared)
A shared manager owns:
- preflight registration and dispatch
- single-flight dedupe per repo/build key
- lifecycle ownership (abort, timeout, reap, teardown)
- durable state and diagnostics emission

### B. Provider Contract
Providers consume preflight state:
- `ready` -> proceed
- `degraded` -> fail-open with structured diagnostic
- `blocked` -> skip provider with explicit reason
Providers never launch preflight subprocesses directly.

### C. Startup Orchestration
Build startup kicks preflights early:
- detect needed preflights from repo/config/tooling profile
- start non-blocking background preflights immediately
- await only at provider use boundary if not yet resolved

### D. Lifecycle/Closeout Guarantees
All preflight subprocesses are:
- registered in shared subprocess tracking
- abortable via build abort signal
- forcibly reaped with bounded wait on teardown
- emitted in final diagnostics if non-clean shutdown occurs

## Parallel Lanes (Up to 5)

### Lane 1: SourceKit Hard Cutover (Highest Priority)
Owner scope:
- `src/index/tooling/sourcekit-provider.js`
- new shared preflight modules
- build runtime/preflight bootstrap wiring

Tasks:
- Extract SourceKit-specific preflight logic into a dedicated preflight implementation module.
- Remove provider-local execution of `swift package resolve`.
- Replace provider behavior with preflight state consumption only.
- Keep existing marker fingerprint + lock semantics, but relocate ownership to preflight layer.
- Ensure provider diagnostics include explicit `sourcekit_preflight_state`.

Acceptance:
- SourceKit provider no longer calls subprocess for package resolve.
- Logs show preflight start/result before tooling collection begins.
- Provider path only reads/awaits preflight state.

---

### Lane 2: Shared Tooling Preflight Framework
Owner scope:
- `src/index/tooling/**` shared modules
- `src/integrations/tooling/**` shared runtime hooks

Tasks:
- Introduce shared preflight registry:
  - registration API (`id`, `detect`, `run`, `policy`, `timeouts`)
  - repo/build keyed single-flight execution
  - state machine (`idle`, `running`, `ready`, `degraded`, `blocked`, `failed`)
- Add preflight coordinator:
  - early kickoff API from runtime startup
  - provider await/read API
  - bounded teardown hook
- Add standardized diagnostics payload shape for all preflights.
- Add metrics envelope fields (`durationMs`, `startedAt`, `finishedAt`, `outcome`, `reasonCode`).

Acceptance:
- SourceKit uses framework path, not custom orchestration.
- Framework supports at least one no-op/mock provider in tests besides SourceKit.
- Teardown always drains or force-terminates active preflight tasks.

---

### Lane 3: Lifecycle + Subprocess Hardening
Owner scope:
- `src/shared/subprocess/**`
- build lifecycle integration modules

Tasks:
- Ensure preflight subprocesses use shared subprocess runner with:
  - abort propagation
  - timeout cancellation
  - full child-tree kill/reap
  - bounded wait + deterministic completion
- Add explicit lifecycle registration for preflight tasks in runtime cleanup.
- Emit structured warnings when reap fallback is needed.
- Add post-run invariant check: no owned preflight subprocesses remain.

Acceptance:
- Forced timeout/abort tests verify deterministic settle and no dangling process ownership.
- Build closeout can complete even if preflight subprocess misbehaves.

---

### Lane 4: Generalization to Additional Providers
Owner scope:
- provider modules with preflight-like behavior
- tooling command profile and doctor integration

Tasks:
- Define candidate providers for preflight migration (phased):
  - initial: SourceKit only
  - next: providers with heavy workspace bootstrap/runtime checks
- Move provider bootstrap checks that are long-running or side-effectful into framework preflight tasks.
- Ensure doctor reports surface preflight capability and expected runtime prerequisites.
- Add provider capability metadata indicating whether preflight is required/optional.

Acceptance:
- At least 2 providers total wired through framework by end of phase.
- Provider code paths become thinner (consume state, avoid orchestration logic duplication).

---

### Lane 5: Observability, SLO Reporting, and Policy
Owner scope:
- bench logs/diagnostics emitters
- tooling doctor/report scripts
- CI reporting logic (informational, non-gating)

Tasks:
- Add canonical preflight log events:
  - `preflight:start`
  - `preflight:cache_hit`
  - `preflight:ok`
  - `preflight:degraded`
  - `preflight:blocked`
  - `preflight:timeout`
  - `preflight:teardown_reap`
- Add per-provider preflight summary line at end of tooling phase.
- Keep CI informational: collect and publish preflight performance/health reports without hard fail by default.
- Add bench summarizer section for preflight outcomes and top offenders.

Acceptance:
- Bench and test logs clearly indicate preflight path and result.
- CI output includes preflight report artifact with no default hard gate.

## Detailed Phase Plan (Execution Grade)

### Phase 0: Contracts, Taxonomy, and Ownership Boundaries
Goal:
- Freeze the canonical preflight model before implementation code is spread across modules.

Deliverables:
- Shared contract for preflight states and reason codes.
- Shared diagnostics payload schema.
- Written ownership model (who starts, who awaits, who tears down).

Work packages:
- P0.1 Define canonical preflight lifecycle:
  - `idle -> running -> ready | degraded | blocked | failed`.
  - Disallow illegal transitions (for example `ready -> running`).
- P0.2 Define reason code taxonomy:
  - command unavailable
  - lock unavailable
  - timeout
  - non-zero exit
  - subprocess failure
  - teardown forced reap
  - cache hit
  - cache stale
- P0.3 Define diagnostics payload fields:
  - `providerId`, `preflightId`, `state`, `reasonCode`, `message`, `durationMs`, `timedOut`, `cached`, `startedAt`, `finishedAt`.
- P0.4 Define provider contract:
  - provider can read or await preflight state.
  - provider cannot launch preflight subprocess.
- P0.5 Define runtime contract:
  - runtime is responsible for kickoff and teardown.
  - runtime owns abort signal propagation into preflight coordinator.

File targets:
- `src/index/tooling/**` new preflight contract + type helpers.
- `src/index/tooling/provider-contract.js` or equivalent diagnostics contract surface.
- `docs/` design notes for ownership boundaries.

Acceptance gate:
- Contract tests exist and fail on invalid state transitions and malformed payloads.
- SourceKit provider call path has an explicit TODO removal map for provider-owned preflight logic.

---

### Phase 1: Shared Preflight Framework Core
Goal:
- Build a reusable framework that supports registration, detection, execution, caching, and state read/await.

Deliverables:
- Preflight registry + coordinator + state store.
- Deterministic single-flight behavior keyed by repo/build/provider/preflight key.

Work packages:
- P1.1 Build preflight registry API:
  - register preflight with `id`, `providerId`, `detect(ctx)`, `run(ctx)`, `policy`, timeout settings.
  - reject duplicate registration for same `id`.
- P1.2 Build state store:
  - in-memory authoritative state for current run.
  - optional marker/file integration delegated to specific preflight implementation.
- P1.3 Build single-flight dedupe:
  - only one run per key.
  - concurrent awaiters attach to same promise.
- P1.4 Build coordinator APIs:
  - `kickoffEarly(ctx, candidates)`
  - `awaitPreflight(ctx, id, options?)`
  - `readPreflightState(ctx, id)`
  - `teardownPreflights(ctx)`
- P1.5 Build policy handling:
  - required vs optional preflight policy.
  - fail-open behavior for optional tooling preflights.
  - required preflights return blocked state with explicit reason.
- P1.6 Build framework-level instrumentation:
  - event hooks for start/end/cache-hit/timeout/blocked/degraded.
  - counters for runs, cache hits, timeouts, forced reaps.

File targets:
- `src/index/tooling/preflight/registry.js`
- `src/index/tooling/preflight/coordinator.js`
- `src/index/tooling/preflight/state-store.js`
- `src/index/tooling/preflight/events.js`
- `src/index/tooling/preflight/policy.js`

Acceptance gate:
- Unit tests for registry lifecycle, single-flight dedupe, and policy handling pass.
- No provider integration yet except mock/test provider.

---

### Phase 2: SourceKit Hard Cutover onto Framework
Goal:
- Fully remove provider-owned SourceKit preflight execution and shift to framework-owned orchestration.

Deliverables:
- SourceKit-specific preflight module registered in framework.
- SourceKit provider converted to state-consumer mode only.

Work packages:
- P2.1 Extract SourceKit-specific detect/marker/lock/fingerprint/resolve logic into `preflight/sourcekit-package-resolve.js`.
- P2.2 Implement `detect(ctx)`:
  - check repo has `Package.swift`
  - detect `.package(...)` dependency usage
  - derive fingerprint from manifest + resolved lock + schema version.
- P2.3 Implement `run(ctx)`:
  - resolve swift command profile
  - acquire host lock
  - run `swift package resolve` with subprocess guardrails
  - persist marker on success
  - emit structured degraded/blocked states on failure classes.
- P2.4 Wire early kickoff:
  - runtime startup detects SourceKit preflight candidate and launches asynchronously.
- P2.5 Convert SourceKit provider path:
  - replace direct `ensureSourcekitPackageResolutionPreflight(...)` execution with `read/await` coordinator calls.
  - preserve fail-open semantics for tooling enrichment.
- P2.6 Remove dead orchestration code from provider module.

File targets:
- `src/index/tooling/sourcekit-provider.js`
- `src/index/tooling/preflight/sourcekit-package-resolve.js`
- runtime bootstrap location for tooling kickoff (`src/index/build/runtime/**` or integration startup module).

Acceptance gate:
- SourceKit provider never calls subprocess for preflight directly.
- Logs show preflight kickoff before provider collection begins.
- Existing SourceKit enrichment behavior unchanged when preflight is successful.

---

### Phase 3: Lifecycle, Abort, and Teardown Hardening
Goal:
- Guarantee no lingering preflight tasks/processes after build shutdown, timeout, or abort.

Deliverables:
- Preflight tasks are lifecycle-registered and teardown-safe.
- Deterministic termination protocol for preflight subprocesses.

Work packages:
- P3.1 Register all preflight task promises in lifecycle registry.
- P3.2 Ensure abort propagation:
  - runtime abort signal fans out to active preflights.
- P3.3 Ensure teardown protocol:
  - stop accepting new runs
  - await active tasks with bounded timeout
  - force-kill/reap if still active
  - mark final outcome (`teardown_reap` reason code) when forced.
- P3.4 Add post-teardown invariant check:
  - no owned preflight subprocesses remain tracked.
- P3.5 Ensure teardown errors are surfaced as structured diagnostics and do not deadlock stage closeout.

File targets:
- shared lifecycle and subprocess integration points.
- preflight coordinator teardown module.
- any existing teardown wrappers in build runtime.

Acceptance gate:
- Abort and timeout scenario tests pass with deterministic completion.
- No leaked subprocess ownership entries after teardown.

---

### Phase 4: Logging, Diagnostics, and Informational Reporting
Goal:
- Make preflight behavior explicitly observable in bench/test/doctor outputs without introducing hard fail gates.

Deliverables:
- Canonical preflight event stream.
- Summaries in doctor and benchmark reports.

Work packages:
- P4.1 Emit canonical events:
  - `preflight:start`, `preflight:cache_hit`, `preflight:ok`, `preflight:degraded`, `preflight:blocked`, `preflight:timeout`, `preflight:teardown_reap`.
- P4.2 Add provider summary lines at end of tooling phase with preflight state snapshot.
- P4.3 Extend doctor output:
  - show configured preflights, last state, reason codes, duration percentiles.
- P4.4 Extend bench summary:
  - per-provider preflight health and top timeout/offender list.
- P4.5 Keep CI informational:
  - report artifacts generated
  - default pipeline does not hard fail on preflight health outliers.

File targets:
- tooling report scripts
- bench summarizer scripts
- doctor output modules

Acceptance gate:
- Logs are sufficient to diagnose preflight path from one run without source inspection.
- CI includes preflight report artifact and never gates pass/fail by default on these metrics.

---

### Phase 5: Framework Generalization to Additional Providers
Goal:
- Prove framework reusability by migrating at least one more complex provider and setting migration pattern for others.

Deliverables:
- At least one non-SourceKit provider preflight integrated.
- Migration template and checklist for future providers.

Work packages:
- P5.1 Select first expansion provider based on operational value and complexity (examples: Java, Elixir, Haskell, Dart).
- P5.2 Extract provider preflight-like bootstrap logic into framework task.
- P5.3 Add provider capability metadata:
  - preflight required/optional
  - expected runtime prerequisites
  - timeout profile class.
- P5.4 Integrate with provider runtime path as state consumer only.
- P5.5 Add migration checklist document for all remaining providers.

File targets:
- selected provider module(s)
- preflight provider module(s)
- provider metadata/config modules

Acceptance gate:
- Two providers total (SourceKit + at least one additional) operate through framework.
- No duplicate orchestration logic remains in migrated provider codepaths.

### Phase 5A: Language-by-Language Generalization Backlog
Goal:
- Track provider-specific preflight generalization work per language so nothing is implicit or missed.

#### 1. Swift (`sourcekit-lsp`)
- Generalization items:
  - Keep `swift package resolve` as framework-owned preflight task.
  - Keep fingerprint marker and lock behavior in SourceKit preflight module only.
  - Keep provider consume-only (no subprocess orchestration).
  - Add cache invalidation on `Package.swift` or `Package.resolved` hash change.
  - Add lock contention behavior with explicit `lock_unavailable` reason code.
  - Add preflight duration telemetry and timeout tier for SwiftPM-heavy repos.

#### 2. C/C++ (`clangd`)
- Generalization items:
  - Add lightweight workspace readiness preflight:
    - compile database presence classification (`compile_commands.json`).
    - include-root inference sanity checks.
  - Keep preflight non-blocking/fail-open when compile DB absent.
  - Emit structured reason codes for inferred/partial workspace state.
  - Add timeout-tiered probe for command profile and startup sanity.

#### 3. Python (`pyright`)
- Generalization items:
  - Add runtime preflight for command availability and project config parse sanity.
  - Add workspace root classification (single-root vs mono-root).
  - Emit explicit degraded reasons for missing config vs failed parse vs timeout.
  - Add preflight metrics for workspace scan cost outliers.

#### 4. Go (`gopls`)
- Generalization items:
  - Add module/workspace preflight:
    - `go.mod`/`go.work` detection.
    - command profile and version sanity.
  - Add reason codes for module root ambiguity and command mismatch.
  - Add optional workspace bootstrap warmup preflight for large modules.

#### 5. Rust (`rust-analyzer`)
- Generalization items:
  - Add cargo workspace fetch/readiness preflight.
  - Classify failure reasons:
    - missing toolchain
    - workspace metadata fetch failure
    - proc-macro diagnostics suppression policy active.
  - Add preflight timeout and fail-open policy to prevent request-path timeouts.

#### 6. Java (`jdtls`)
- Generalization items:
  - Add runtime preflight for Java availability and command profile correctness.
  - Add workspace bootstrap preflight classification (project model and launch contract).
  - Add state reasons for launch script mismatch, runtime missing, workspace lock contention.
  - Add aggressive teardown invariants due to OpenJDK orphan risk.

#### 7. C# (`csharp-ls`)
- Generalization items:
  - Add .NET runtime availability preflight and version compatibility checks.
  - Add workspace bootstrap preflight for solution/project detection.
  - Add structured reason codes for SDK/runtime missing and launch failures.
  - Add teardown invariants focused on orphan child process cleanup.

#### 8. Lua (`lua-language-server`)
- Generalization items:
  - Add workspace library/config preflight for known library roots.
  - Add command profile + startup sanity preflight.
  - Add reason codes for missing runtime config and invalid workspace library config.

#### 9. Ruby (`solargraph`)
- Generalization items:
  - Add ruby/gem runtime preflight and command profile checks.
  - Add workspace dependency/model sanity preflight.
  - Add reason codes for gem runtime/toolchain deficiencies.
  - Add teardown assertions for Ruby subprocess lifecycle completeness.

#### 10. Elixir (`elixir-ls`)
- Generalization items:
  - Add OTP/Elixir runtime preflight.
  - Add workspace project bootstrap preflight classification.
  - Add reason codes for Erlang/Elixir runtime mismatch.
  - Add orphan cleanup assertions for Erlang VM subprocess trees.

#### 11. Haskell (`haskell-language-server`)
- Generalization items:
  - Add GHC/HLS runtime preflight and workspace cradle detection.
  - Add reason codes for missing cradle/toolchain mismatch.
  - Add timeout-tier policy for larger dependency resolution behavior.

#### 12. YAML (`yaml-language-server`)
- Generalization items:
  - Add command profile and schema behavior preflight.
  - Add optional policy to disable remote schema fetch in constrained environments.
  - Add reason codes for schema mode degradation.

#### 13. PHP (`phpactor`)
- Generalization items:
  - Add php runtime + phpactor command profile preflight.
  - Add workspace bootstrap classification.
  - Add reason codes for PHP runtime mismatch and bootstrap failures.

#### 14. Zig (`zls`)
- Generalization items:
  - Add command availability + workspace root preflight.
  - Add reason codes for missing binary and unsupported workspace shape.
  - Add timeout tier tuned for zls startup behavior.

#### 15. Dart (`dart language-server`)
- Generalization items:
  - Add Dart SDK/runtime preflight.
  - Add workspace project bootstrap preflight classification.
  - Add reason codes for SDK availability and project model mismatch.

---

### Phase 5B: Language-by-Language Cutover Checklist
Goal:
- Force explicit cutover state per language so provider-owned preflight paths cannot remain accidentally.

For every language provider above, execute these cutover items:

1. Preflight ownership cutover
- Remove provider-local preflight subprocess calls.
- Route preflight through shared framework registration only.
- Enforce with tests that direct provider preflight subprocess usage is disallowed.

2. Startup orchestration cutover
- Ensure runtime startup can detect and kickoff preflight for that provider.
- Ensure provider collect path reads/awaits existing state only.

3. Diagnostics cutover
- Emit canonical preflight state payload for provider diagnostics.
- Remove legacy provider-specific ad hoc warning shape when superseded.

4. Teardown cutover
- Ensure provider-related preflight tasks are lifecycle-registered.
- Ensure abort/timeout/teardown paths terminate and reap subprocesses deterministically.

5. Test cutover
- Add/upgrade tests for:
  - preflight success
  - preflight timeout
  - preflight lock/contention path (if applicable)
  - provider fail-open behavior with degraded preflight
  - no orphan process ownership after run

6. Logging/reporting cutover
- Confirm canonical preflight events appear for provider in logs and reports.
- Confirm provider summary includes preflight state in doctor/bench outputs.

---

### Phase 6: Throughput and Contention Optimization
Goal:
- Prevent preflights from causing startup contention or resource spikes at scale.

Deliverables:
- Global preflight scheduler controls.
- Provider-class timeout tiers and concurrency budgets.

Work packages:
- P6.1 Add global preflight concurrency cap by host policy.
- P6.2 Add preflight class tiers:
  - fast probe
  - workspace bootstrap
  - dependency resolution
- P6.3 Add adaptive timeout model by provider class + environment profile.
- P6.4 Add queue/backpressure telemetry for preflight manager.
- P6.5 Add starvation safeguards so preflights cannot block core indexing scheduler resources.

Acceptance gate:
- Bench startup remains stable under multi-repo runs.
- No preflight storm behavior under parallel runs.

Status (2026-03-02T09:12:02.4476562-05:00):
- Implemented global preflight scheduler cap (`toolingConfig.preflight.maxConcurrency`) with queueing and canonical queue/dequeue logs.
- Implemented preflight timeout tiers by class (`probe`, `workspace`, `dependency`) with per-class and global config overrides.
- Implemented scheduler telemetry (`queueDepthPeak`, queue wait metrics, running peak, timedOut/failed counts) in tooling metrics output.
- Added class-aware preflight diagnostics rollups (`metrics.preflights.byClass`, `metrics.preflights.topSlow`) plus scheduler envelope.

---

### Phase 7: Final Cleanup and Enforced Invariants
Goal:
- Remove superseded paths and lock in hard-cutover behavior.

Deliverables:
- Dead code removal complete.
- Invariants codified in tests and assertions.

Work packages:
- P7.1 Remove all provider-local preflight subprocess orchestration that framework now owns.
- P7.2 Add assertions:
  - provider attempting direct preflight subprocess call fails tests.
  - coordinator required for any registered preflight id.
- P7.3 Remove temporary migration toggles not needed after cutover.
- P7.4 Final docs pass:
  - architecture, lifecycle, provider integration guide, troubleshooting guide.

Acceptance gate:
- Codebase has one active preflight orchestration path.
- All migration TODOs closed.

## Dependency and Parallelization Map
- Phase 0 must complete before implementation phases.
- Phase 1 can proceed in parallel with preparatory scaffolding for Phase 2.
- Phase 2 depends on Phase 1 core framework.
- Phase 3 starts once Phase 2 has a runnable path.
- Phase 4 can start once Phase 2 events are available, and can continue while Phase 5 progresses.
- Phase 5 depends on stable framework from Phases 1-3.
- Phase 6 depends on at least two providers migrated (Phase 5).
- Phase 7 is last.

## Per-Phase Exit Criteria
- Each phase closes only when:
  - implementation is merged for scoped work packages,
  - required tests for that phase are added and passing,
  - docs for newly introduced behavior are updated,
  - no temporary TODO markers remain for phase scope.

## Test Matrix (Required)

### Unit Tests
- Preflight registry single-flight behavior per key.
- State machine transitions and invalid transition rejection.
- Provider consume-only behavior with ready/degraded/blocked states.
- Marker/lock cache hit/miss and fingerprint invalidation.

### Integration Tests
- SourceKit repo fixture:
  - preflight required + success
  - preflight required + timeout
  - preflight lock unavailable
  - preflight cached marker hit
- Build abort during preflight subprocess.
- Teardown while preflight still running.

### Process/Lifecycle Tests
- No orphan subprocesses after success/failure/abort.
- Timeout path sends termination and reaps descendants.
- Runtime cleanup remains bounded and deterministic.

### Bench/Perf Validation
- Compare timeline:
  - old provider-time preflight latency
  - new early preflight overlap behavior
- Validate no increase in end-stage hang incidence.
- Capture preflight duration distributions by provider/repo.

### Regression Tests
- Existing SourceKit enrichment output shape unchanged when preflight succeeds.
- Fail-open behavior remains intact when preflight degrades.
- Log message contracts remain parseable by diagnostics tooling.

## Implementation Notes and Better-Than-Before Improvements
- Keep preflight manager isolated from provider-specific parsing/typing logic.
- Reuse shared subprocess and lifecycle modules; do not reimplement process control.
- Make preflight policy configurable per provider (required vs optional), defaulting to fail-open for tooling enrichment.
- Keep provider-level command probes lightweight; move heavy side-effect work to preflight manager.
- Add reusable test fixtures for fake preflight subprocesses (hang, slow, malformed output, exit code variations).

## Completion Checklist
- [x] SourceKit preflight is no longer executed from provider collect path.
- [x] Early preflight kickoff is active in runtime startup.
- [x] Shared preflight framework merged and documented.
- [x] Lifecycle cleanup/reap invariants are enforced and tested.
- [x] At least one additional provider integrated into framework.
- [x] Informational CI/doctor reporting for preflight health is live.
- [x] Bench/log diagnostics include canonical preflight lifecycle events.

## Execution Log
- 2026-03-02T09:30:17.1397807-05:00: Migrated dedicated-provider command profile probing into framework preflight; run-path now consumes preflight-resolved command profiles.
- 2026-03-02T09:30:17.1397807-05:00: Migrated clangd command profile probing into preflight (workspace gating preserved) and reused preflight command profile in collect path.
- 2026-03-02T09:30:17.1397807-05:00: Migrated sourcekit command profile probing into preflight and removed dead provider-local candidate/probe path left from preflight ownership cutover.
- 2026-03-02T09:37:03.7156135-05:00: Hoisted shared command-profile preflight helper and migrated configured/dedicated/pyright/clangd/sourcekit providers to consume the shared implementation.
- 2026-03-02T09:45:20.4788483-05:00: Enforced no runtime command reprobes for preflight-owned providers; added static guard test and ci-lite lane coverage.
- 2026-03-02T09:45:20.4788483-05:00: Hoisted shared runtime command resolution from preflight output and migrated configured/dedicated/pyright/clangd/sourcekit callsites.
- 2026-03-02T09:46:26.6314426-05:00: Added coordinator ownership invariant guard to ensure provider preflight execution remains centralized in preflight-manager.
- 2026-03-02T09:48:05.5946190-05:00: Fixed probe-state modeling for runtime command resolution so missing commandProfile no longer emits false command-unavailable warnings.
- 2026-03-02T09:49:19.4345025-05:00: Added shared preflight-check merge dedupe utility and applied it to configured/dedicated preflight check aggregation.
- 2026-03-02T09:50:57.6755577-05:00: Enhanced preflight teardown timeout diagnostics with active offender details (provider/id/class/age) and added test coverage.
- 2026-03-02T09:51:54.6183250-05:00: Added guard coverage to enforce shared runtime-command helper usage across all migrated preflight-owned providers.
- 2026-03-02T09:54:06.9523509-05:00: Added scheduler metrics by preflight class (probe/workspace/dependency) and validated class counters in concurrency tests.
- 2026-03-02T09:56:10.1593384-05:00: Extended bench-language report diagnostics to parse preflight summary lines (queue peak, teardown timeout, class/state aggregates).
- 2026-03-02T09:57:33.5749448-05:00: Extended bench-language report diagnostics to parse preflight slowest summary lines and surface parsed offender lists.
- 2026-03-02T10:04:20.4891399-05:00: Added provider-declared preflight policy/runtime-prerequisite metadata across dedicated/configured providers and made tooling doctor consume/report metadata first (with command-heuristic fallback).
- 2026-03-02T10:13:05.0043036-05:00: Added static preflight provider metadata coverage guard (preflight id/class/policy/runtime requirements) and wired it into ci-lite to enforce hard-cutover invariants.
- 2026-03-02T10:15:53.1310996-05:00: Added Lua workspace-library preflight validation (missing path degraded warning, non-blocking) for configured providers with coverage in ci-lite.
- 2026-03-02T10:17:40.5364622-05:00: Added YAML schema-mode preflight classification for configured providers and surfaced remote schemaStore mode as explicit degraded diagnostics (non-blocking) with ci-lite coverage.
- 2026-03-02T10:22:29.1734065-05:00: Propagated preflight policy metadata into manager snapshots/orchestrator diagnostics+metrics, logged policy aggregates in preflight summaries, and extended bench preflight parser/reporting for policy counts.
- 2026-03-02T10:24:34.0665498-05:00: Refreshed tooling doctor/reporting spec to match current doctor artifact schema and preflight metadata surfaces (provider policy/class/runtime requirements + bench policy rollups).
- 2026-03-02T10:26:33.9588791-05:00: Added shared configured-provider runtime-requirement preflight validation (metadata-driven, fail-open degraded warnings) to generalize prerequisite checks across preset LSPs.
- 2026-03-02T10:37:16.8472420-05:00: Hoisted runtime-requirement preflight probing into a shared helper and applied it to both configured and dedicated provider preflight paths; added dedicated-path coverage and ci-lite lane wiring.
- 2026-03-02T10:39:15.9431048-05:00: Added Rust workspace metadata preflight classification (`cargo metadata` fail-open degraded path) for configured providers with deterministic degraded-path coverage and ci-lite assignment.
- 2026-03-02T10:40:58.9941037-05:00: Updated preflight-manager failure semantics so explicit `preflightPolicy: optional` preflight exceptions fail open as degraded snapshots/results (required policies remain fail-closed), with single-flight coverage for both paths.
- 2026-03-02T10:43:49.0325246-05:00: Added Go workspace module preflight classification for configured providers (`go list -m`/override command) with deterministic failed/timeout degraded-path coverage and ci-lite lane wiring.
- 2026-03-02T10:48:10.8417446-05:00: Added phpactor workspace bootstrap manifest preflight classification (invalid/unreadable/oversized `composer.json`) with fail-open degraded diagnostics and ci-lite coverage.
- 2026-03-02T10:49:46.8674648-05:00: Expanded solargraph preflight runtime requirements to include Bundler (`bundle --version`) so Ruby workspace dependency readiness is surfaced in doctor/runtime checks.
- 2026-03-02T10:51:00.8800730-05:00: Expanded jdtls runtime prerequisite preflight to require both `java` and `javac`, improving detection of JRE-only environments that cannot support full Java workspace modeling.
- 2026-03-02T10:51:54.0594379-05:00: Expanded elixir-ls runtime prerequisite preflight to require `mix` in addition to `elixir`/`erl`, improving project bootstrap readiness checks for Mix-based workspaces.
- 2026-03-02T10:52:56.2622364-05:00: Tightened csharp-ls runtime prerequisite preflight from generic `dotnet --version` to explicit SDK probing via `dotnet --list-sdks` to detect runtime-only .NET installations.
- 2026-03-02T10:53:55.7038658-05:00: Expanded phpactor runtime prerequisite preflight to include Composer availability (`composer --version`) so PHP workspace dependency tooling readiness is surfaced in doctor/runtime diagnostics.
- 2026-03-02T10:56:10.8472577-05:00: Hoisted shared workspace-command preflight probe execution helper and migrated Go/Rust workspace preflight implementations to it, eliminating duplicated timeout/error classification logic.
- 2026-03-02T10:57:30.4695078-05:00: Added configured rust metadata timeout-override coverage to enforce that `rustWorkspaceMetadataCmd/Args/TimeoutMs` overrides are honored end-to-end (regression guard for server normalization).
- 2026-03-02T11:16:56.9923183-05:00: Added explicit clangd preflight degraded classification for missing `compile_commands.json` when include-root inference is disabled and no fallback flags are configured, with ci-lite coverage.
- 2026-03-02T11:18:46.9806871-05:00: Added pyright workspace-config preflight classification for malformed/unreadable/oversized `pyrightconfig.json` (fail-open degraded) with ci coverage.
- 2026-03-02T11:20:27.3409850-05:00: Added jdtls workspace-bootstrap lock contention classification (`jdtls_workspace_lock_unavailable`) with dedicated ci-lite coverage to surface concurrent bootstrap conflicts deterministically.
- 2026-03-02T11:22:35.1051311-05:00: Added dart project-model preflight classification for missing/invalid `.dart_tool/package_config.json` when `pubspec.yaml` is present (fail-open degraded) with ci-lite coverage.
- 2026-03-02T11:25:35.1651980-05:00: Added haskell workspace ambiguous-cradle preflight classification (`haskell_workspace_ambiguous_cradle`) when Stack and Cabal markers coexist without `hie.yaml`, with ci-lite coverage and fail-open degraded diagnostics.
- 2026-03-02T11:27:48.1149856-05:00: Added csharp workspace bootstrap preflight classification for ambiguous repo-root solution/project layouts (`csharp_workspace_ambiguous_solution`/`csharp_workspace_ambiguous_project`) with ci-lite coverage and fail-open degraded diagnostics.
- 2026-03-02T11:29:30.3165004-05:00: Added configured zls workspace-root preflight classification for nested/ambiguous marker layouts (`zls_workspace_nested_root`/`zls_workspace_ambiguous_root`) with ci-lite coverage and fail-open degraded diagnostics.
- 2026-03-02T11:31:12.3205022-05:00: Added jdtls launch-contract preflight validation for malformed/missing `-configuration` and `-jar` paths (`jdtls_launch_contract_invalid`, `jdtls_launch_configuration_missing`, `jdtls_launch_jar_missing`) with ci-lite coverage.
- 2026-03-02T11:32:33.1570190-05:00: Added elixir workspace bootstrap preflight classification for missing `mix.lock` (`elixir_workspace_mix_lock_missing`) to surface incomplete Mix dependency state as fail-open degraded diagnostics with ci-lite coverage.
