# Sweet16 Roadmap

## Status legend

Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete

Completed Phases: `COMPLETED_PHASES.md`

### Phase status summary (update as you go)
| Phase | Status | Notes |
| --- | --- | --- |
| 16.0 | [@] | Specs drafted; tests pending |
| 16.1 | [x] | Scheduler core + stage wiring + embeddings integration + tests/bench complete |
| 16.2 | [x] | Shared artifact IO pipeline complete |
| 16.3 | [@] | Cache key schema/helpers in progress |
| 16.4 | [ ] |  |
| 16.5 | [ ] |  |
| 16.13 | [ ] |  |
| 16.14 | [ ] |  |
| 16.6 | [ ] |  |
| 16.7 | [ ] |  |
| 16.8 | [ ] |  |
| 16.9 | [ ] |  |
| 16.10 | [ ] |  |
| 16.11 | [ ] |  |
| 16.12 | [ ] |  |
| 16.15 | [ ] |  |

### Source-of-truth hierarchy (when specs disagree)
When a document/spec conflicts with the running code, follow this order:

1) **`src/contracts/**` and validators** are authoritative for artifact shapes and required keys.
2) **Current implementation** is authoritative for runtime behavior *when it is already validated by contracts/tests*.
3) **Docs** (`docs/contracts/**`, `docs/specs/**`) must be updated to match (never the other way around) unless we have a deliberate migration plan.

If you discover a conflict:
- **Prefer "fix docs to match code"** when the code is already contract-validated and has tests.
- **Prefer "fix code to match docs/contracts"** only when the contract/validator is explicit and the code violates it.

### Touchpoints + line ranges (important: line ranges are approximate)
This document includes file touchpoints with **approximate** line ranges like:

- `src/foo/bar.js` **(~L120-L240)**  -  anchor: `someFunctionName`

Line numbers drift as the repo changes. Treat them as a **starting hint**, not a hard reference.
Always use the **anchor string** (function name / constant / error message) as the primary locator.

### Tests: lanes + name filters (use them aggressively)
The repo has a first-class test runner with lanes + filters:

- Runner: `npm test` (alias for `node tests/run.js`)
- List lanes/tags: `npm test -- --list-lanes` / `npm test -- --list-tags`
- Run a lane: `npm run test:unit`, `npm run test:integration`, `npm run test:services`, etc.
- Filter by name/path (selectors):
  - `npm test -- --match risk_interprocedural`
  - `npm run test:unit -- --match chunk-uid`
  - `npm run test:integration -- --match crossfile`

**Lane rules are defined in:** `tests/run.rules.jsonc` (keep new tests named/placed so they land in the intended lane).

- All new tests introduced by this roadmap must be placed in the perf lane (name + location per rules).
- All benchmarks must support running against this repo (`--repo-root .`) or its built index (`--index-dir <path>`).

### Deprecating spec documents: archive policy (MANDATORY)
When a spec/doc is replaced (e.g., a reconciled spec supersedes an older one):

- **Move the deprecated doc to:** `docs/archived/` (create this folder if missing).
- Keep a short header in the moved file indicating:
  - what replaced it,
  - why it was deprecated,
  - the date/PR.
- Add/update the repository process in **`AGENTS.md`** so future agents follow the same archival convention.

---

## Parallelism Guide
- Phase 16.0: Subphases 16.0.1–16.0.7 can run in parallel with a shared glossary/terminology pass at the end.
- Phase 16.1: 16.1.1 first; then 16.1.2 and 16.1.3 in parallel; 16.1.4 last.
- Phase 16.2: 16.2.1 and 16.2.2 can run in parallel; 16.2.3 and 16.2.4 after core readers; 16.2.5 last.
- Phase 16.3: 16.3.1 first; then 16.3.2 and 16.3.3 in parallel; 16.3.4 after schema; 16.3.5 last.
- Phase 16.4: 16.4.1 and 16.4.2 in parallel; 16.4.3 after both; 16.4.4 next; 16.4.5 last.
- Phase 16.5: 16.5.1 first; 16.5.4 can run in parallel with 16.5.1; 16.5.2 and 16.5.3 after merge core; 16.5.5 last.
- Phase 16.6: 16.6.1 before 16.6.2; 16.6.3 last.
- Phase 16.7: 16.7.1 and 16.7.2 can run in parallel if file ownership is split; 16.7.3 last.
- Phase 16.8: 16.8.1 and 16.8.2 can run in parallel with clear file ownership; 16.8.3 last.
- Phase 16.9: 16.9.1 before 16.9.2; 16.9.3 last.
- Phase 16.10: 16.10.1 and 16.10.2 can run in parallel; 16.10.3 last.
- Phase 16.11: 16.11.1 and 16.11.2 can run in parallel with clear file ownership; 16.11.3 last.
- Phase 16.12: 16.12.1 and 16.12.2 can run in parallel with clear module ownership; 16.12.3 last.
- Phase 16.13: 16.13.1 and 16.13.2 can run in parallel; 16.13.3 then 16.13.4.
- Phase 16.14: 16.14.1, 16.14.2, and 16.14.3 can run in parallel; 16.14.4 then 16.14.5.
- Phase 16.15: 16.15.1 can run in parallel with 16.15.2/16.15.3; ensure bench harness exists before validating outputs.

## Roadmap Table of Contents
- Phase 16.0 -- Cross-cutting Spec Foundations (Subphases: 16.0.1 Build Scheduler Spec; 16.0.2 Artifact IO Spec; 16.0.3 Cache Key Spec; 16.0.4 Build Truth Ledger Spec; 16.0.5 Spill/Merge Spec; 16.0.6 Byte Budget Spec; 16.0.7 Deterministic Ordering Spec)
- Phase 16.1 -- Unified Build Scheduler + Backpressure Implementation (Subphases: 16.1.1 Core Scheduler; 16.1.2 Stage Wiring; 16.1.3 Embeddings/IO Integration; 16.1.4 Scheduler Tests + Bench)
- Phase 16.2 -- Shared Artifact IO Pipeline (Subphases: 16.2.1 Core Readers; 16.2.2 Compression/Offsets; 16.2.3 Writer Migration; 16.2.4 Loader Migration; 16.2.5 Validation + Bench)
- Phase 16.3 -- Global Cache Key + Invalidation (Subphases: 16.3.1 Schema + Helpers; 16.3.2 Embeddings Cache; 16.3.3 File Meta/Import/VFS; 16.3.4 Cache Reset + Cleanup; 16.3.5 Tests + Bench)
- Phase 16.4 -- Build Truth Ledger + Deterministic Ordering (Subphases: 16.4.1 Ledger Core; 16.4.2 Ordering Library; 16.4.3 Wiring; 16.4.4 Validation; 16.4.5 Tests + Bench)
- Phase 16.5 -- Unified Spill/Merge + Byte Budget (Subphases: 16.5.1 Merge Core; 16.5.2 Postings Adoption; 16.5.3 VFS/Relations/Artifacts Adoption; 16.5.4 Byte Budget Policy; 16.5.5 Tests + Bench)
- Phase 16.13 -- Artifact Pipeline Optimization (Subphases: 16.13.1 Offsets + Shards; 16.13.2 Loader Parallelism; 16.13.3 Tests + Bench; 16.13.4 Full Streaming Loaders + Minimal-Impl Hardening)
- Phase 16.14 -- Index State + File Meta + Minhash (Subphases: 16.14.1 Index State; 16.14.2 File Meta; 16.14.3 Minhash; 16.14.4 Tests + Bench; 16.14.5 Full Streaming File Meta + Minimal-Impl Hardening)
- Phase 16.6 -- Stage1 Postings Throughput (Subphases: 16.6.1 Token/Postings Core; 16.6.2 Backpressure + Concurrency; 16.6.3 Tests + Bench)
- Phase 16.7 -- Stage2 Relations + Filter Index (Subphases: 16.7.1 Relations Core; 16.7.2 Filter Index + Repo Map; 16.7.3 Tests + Bench)
- Phase 16.8 -- Embeddings Pipeline Throughput (Subphases: 16.8.1 Cache + Keys; 16.8.2 IO + Batching; 16.8.3 Tests + Bench)
- Phase 16.9 -- SQLite Build Throughput (Subphases: 16.9.1 Bulk Load Core; 16.9.2 FTS/Index Build; 16.9.3 Tests + Bench)
- Phase 16.10 -- VFS Manifest Throughput (Subphases: 16.10.1 Segment IO; 16.10.2 Merge/Compaction; 16.10.3 Tests + Bench)
- Phase 16.11 -- Tree-sitter Throughput (Subphases: 16.11.1 Grammar/Parser Caching; 16.11.2 Parse Scheduling; 16.11.3 Tests + Bench)
- Phase 16.12 -- Graph + Context Pack Throughput (Subphases: 16.12.1 Graph Store; 16.12.2 Traversal + Filtering; 16.12.3 Tests + Bench)
- Phase 16.15 -- Usage Verification + Cross-Phase Bench Coverage (Subphases: 16.15.1 Usage Checklist; 16.15.2 Bench Harness; 16.15.3 Bench Output Contracts)
---

## Phase 16.0 -- Cross-cutting Spec Foundations

### Objective
Define authoritative specs for systemwide behaviors before implementation to avoid inconsistent semantics.
Docs/specs to update: `docs/specs/build-scheduler.md`, `docs/specs/artifact-io-pipeline.md`, `docs/specs/cache-key-invalidation.md`, `docs/specs/build-truth-ledger.md`, `docs/specs/spill-merge-framework.md`, `docs/specs/byte-budget-policy.md`, `docs/specs/deterministic-ordering.md`
Touchpoints: `docs/specs/build-scheduler.md` (anchor: Goals), `docs/specs/artifact-io-pipeline.md` (anchor: Overview), `docs/specs/cache-key-invalidation.md` (anchor: Key Schema), `docs/specs/build-truth-ledger.md` (anchor: Schema), `docs/specs/spill-merge-framework.md` (anchor: API), `docs/specs/byte-budget-policy.md` (anchor: Budgets), `docs/specs/deterministic-ordering.md` (anchor: Ordering Rules)

### Docs/specs to add or update
- `docs/specs/build-scheduler.md` (new)
- `docs/specs/artifact-io-pipeline.md` (new)
- `docs/specs/cache-key-invalidation.md` (new)
- `docs/specs/build-truth-ledger.md` (new)
- `docs/specs/spill-merge-framework.md` (new)
- `docs/specs/byte-budget-policy.md` (new)
- `docs/specs/deterministic-ordering.md` (new)
Touchpoints: `docs/specs/build-scheduler.md` (anchor: Goals), `docs/specs/artifact-io-pipeline.md` (anchor: Overview), `docs/specs/cache-key-invalidation.md` (anchor: Key Schema), `docs/specs/build-truth-ledger.md` (anchor: Schema), `docs/specs/spill-merge-framework.md` (anchor: API), `docs/specs/byte-budget-policy.md` (anchor: Budgets), `docs/specs/deterministic-ordering.md` (anchor: Ordering Rules)

### Subphase 16.0.1 -- Build Scheduler Spec
Parallel: Can run alongside 16.0.2–16.0.7; reconcile glossary/terms at end of Phase 16.0.
Touchpoints: `docs/specs/*` (anchor: section headers in the spec for this subphase)
Docs/specs to update: `docs/specs/build-scheduler.md`, `docs/specs/artifact-io-pipeline.md`, `docs/specs/cache-key-invalidation.md`, `docs/specs/build-truth-ledger.md`, `docs/specs/spill-merge-framework.md`, `docs/specs/byte-budget-policy.md`, `docs/specs/deterministic-ordering.md`
Tasks:
- [x] Task 16.0.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.0.1.a: Draft `docs/specs/build-scheduler.md` with goals, non-goals, and scope.
Details: Include explicit definitions of CPU/IO/memory tokens, what “backpressure” means in this system, and what is explicitly out-of-scope for v1.
- [x] Task 16.0.1.b: Define resource model (CPU, IO, memory tokens) and backpressure algorithm.
Details: Specify token acquisition/release rules, fairness guarantees, starvation limits, and how memory pressure is measured.
- [x] Task 16.0.1.c: Define scheduler API surface and config schema (env + CLI + config file).
Details: Document config keys, defaults, precedence rules (env vs CLI vs config), and example configurations.
- [x] Task 16.0.1.d: Define priority/queue classes for Stage1/2/4 and embeddings.
Details: List queue names, priority ordering, and which stage operations map to each queue.
- [x] Task 16.0.1.e: Define failure/abort semantics and retry policy.
Details: Specify how cancellations propagate, when retries occur, and which failures are terminal vs recoverable.
- [x] Task 16.0.1.f: Define telemetry fields and required logs.
Details: Enumerate counters/metrics and required log lines for diagnosing starvation or backlog.
Notes: Include diagrams for scheduling flow and queue ownership.

Tests:
- [ ] `tests/shared/concurrency/scheduler-contract.test.js` (perf lane) (new)
- [ ] `tests/shared/concurrency/scheduler-config-parse.test.js` (perf lane) (new)

### Subphase 16.0.2 -- Artifact IO Pipeline Spec
Parallel: Can run alongside 16.0.1 and 16.0.3–16.0.7; reconcile glossary/terms at end of Phase 16.0.
Touchpoints: `docs/specs/*` (anchor: section headers in the spec for this subphase)
Docs/specs to update: `docs/specs/build-scheduler.md`, `docs/specs/artifact-io-pipeline.md`, `docs/specs/cache-key-invalidation.md`, `docs/specs/build-truth-ledger.md`, `docs/specs/spill-merge-framework.md`, `docs/specs/byte-budget-policy.md`, `docs/specs/deterministic-ordering.md`
Tasks:
- [x] Task 16.0.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.0.2.a: Draft `docs/specs/artifact-io-pipeline.md` with reader/writer lifecycle.
Details: Define lifecycle steps, expected inputs/outputs, and invariants shared across readers and writers.
- [x] Task 16.0.2.b: Specify sharding rules (bytes), offsets format, and compression negotiation.
Details: Include the exact offsets schema, shard naming, and compression fallback behavior.
- [x] Task 16.0.2.c: Define streaming parser behavior and validation modes.
Details: Define strict vs fast-path validation and which modes are used in CI vs runtime.
- [x] Task 16.0.2.d: Define telemetry and sampling rules for large reads.
Details: Specify sampling rates, thresholds, and required telemetry fields.
- [x] Task 16.0.2.e: Define atomic write/rename rules and failure handling.
Details: Document temp file naming, swap rules, cleanup behavior, and partial-write detection.
Notes: Breaking changes are allowed; no backward compatibility required.

Tests:
- [ ] `tests/shared/artifact-io/artifact-io-spec-contract.test.js` (perf lane) (new)

### Subphase 16.0.3 -- Cache Key + Invalidation Spec
Parallel: Can run alongside 16.0.1–16.0.2 and 16.0.4–16.0.7; reconcile glossary/terms at end of Phase 16.0.
Touchpoints: `docs/specs/*` (anchor: section headers in the spec for this subphase)
Docs/specs to update: `docs/specs/build-scheduler.md`, `docs/specs/artifact-io-pipeline.md`, `docs/specs/cache-key-invalidation.md`, `docs/specs/build-truth-ledger.md`, `docs/specs/spill-merge-framework.md`, `docs/specs/byte-budget-policy.md`, `docs/specs/deterministic-ordering.md`
Tasks:
- [x] Task 16.0.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.0.3.a: Draft `docs/specs/cache-key-invalidation.md` with key schema.
Details: Provide the full key schema with all fields and required hashes.
- [x] Task 16.0.3.b: Define repo hash, build config hash, mode, and schema version inputs.
Details: Specify how each hash is computed and which files/configs are included.
- [x] Task 16.0.3.c: Define invalidation triggers for embeddings/file_meta/import/VFS caches.
Details: List explicit invalidation triggers and how they are detected.
- [x] Task 16.0.3.d: Define migration rules for older cache entries.
Details: Specify version checks and force-rebuild rules (breaking changes allowed).
- [x] Task 16.0.3.e: Define explicit TTL/expiry rules where needed.
Details: Identify which caches can expire by time and the default TTLs.
Notes: Provide a table mapping cache types to required key components.

Tests:
- [ ] `tests/shared/cache/cache-key-schema.test.js` (perf lane) (new)

### Subphase 16.0.4 -- Build Truth Ledger Spec
Parallel: Can run alongside 16.0.1–16.0.3 and 16.0.5–16.0.7; reconcile glossary/terms at end of Phase 16.0.
Touchpoints: `docs/specs/*` (anchor: section headers in the spec for this subphase)
Docs/specs to update: `docs/specs/build-scheduler.md`, `docs/specs/artifact-io-pipeline.md`, `docs/specs/cache-key-invalidation.md`, `docs/specs/build-truth-ledger.md`, `docs/specs/spill-merge-framework.md`, `docs/specs/byte-budget-policy.md`, `docs/specs/deterministic-ordering.md`
Tasks:
- [x] Task 16.0.4.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.0.4.a: Draft `docs/specs/build-truth-ledger.md` with schema and purpose.
Details: Include schema fields, storage location, and example ledger entries per stage.
- [x] Task 16.0.4.b: Define ordering hash rules for chunk_meta, relations, graph outputs.
Details: Specify ordering inputs and hash algorithm requirements.
- [x] Task 16.0.4.c: Define write cadence and storage location (build_state sidecar).
Details: Define when ledger entries are appended vs replaced and file naming.
- [x] Task 16.0.4.d: Define validation rules and mismatch behaviors.
Details: Specify warn vs error behavior, and when to trigger rebuilds.
- [x] Task 16.0.4.e: Define integration with contracts and validators.
Details: Document how ledger validation integrates with `index-validate`.
Notes: Include examples of ledger entries for each stage.

Tests:
- [ ] `tests/indexing/build-state/build-truth-ledger-contract.test.js` (perf lane) (new)

### Subphase 16.0.5 -- Spill/Merge Framework Spec
Parallel: Can run alongside 16.0.1–16.0.4 and 16.0.6–16.0.7; reconcile glossary/terms at end of Phase 16.0.
Touchpoints: `docs/specs/*` (anchor: section headers in the spec for this subphase)
Docs/specs to update: `docs/specs/build-scheduler.md`, `docs/specs/artifact-io-pipeline.md`, `docs/specs/cache-key-invalidation.md`, `docs/specs/build-truth-ledger.md`, `docs/specs/spill-merge-framework.md`, `docs/specs/byte-budget-policy.md`, `docs/specs/deterministic-ordering.md`
Tasks:
- [x] Task 16.0.5.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.0.5.a: Draft `docs/specs/spill-merge-framework.md` with API and lifecycle.
Details: Define API surface, expected inputs/outputs, and lifecycle states.
- [x] Task 16.0.5.b: Define k-way merge semantics, heap bounds, and ordering guarantees.
Details: Specify merge ordering, tie-breakers, and deterministic guarantees.
- [x] Task 16.0.5.c: Define spill triggers (bytes/rows) and retention strategy.
Details: Include thresholds, how to measure size, and cleanup rules.
- [x] Task 16.0.5.d: Define file naming, cleanup, and crash recovery.
Details: Specify temp naming, recovery heuristics, and cleanup lifecycle.
- [x] Task 16.0.5.e: Define telemetry fields and performance counters.
Details: Enumerate required metrics (spill count, bytes, merge duration, peak heap).
Notes: Include determinism guarantees and merge stability rules.

Tests:
- [ ] `tests/shared/merge/spill-merge-contract.test.js` (perf lane) (new)

### Subphase 16.0.6 -- Byte Budget Policy Spec
Parallel: Can run alongside 16.0.1–16.0.5 and 16.0.7; reconcile glossary/terms at end of Phase 16.0.
Touchpoints: `docs/specs/*` (anchor: section headers in the spec for this subphase)
Docs/specs to update: `docs/specs/build-scheduler.md`, `docs/specs/artifact-io-pipeline.md`, `docs/specs/cache-key-invalidation.md`, `docs/specs/build-truth-ledger.md`, `docs/specs/spill-merge-framework.md`, `docs/specs/byte-budget-policy.md`, `docs/specs/deterministic-ordering.md`
Tasks:
- [x] Task 16.0.6.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.0.6.a: Draft `docs/specs/byte-budget-policy.md` with global thresholds.
Details: Specify default budgets, units, and how they scale with repo size.
- [x] Task 16.0.6.b: Define per-artifact budget allocation and enforcement strategy.
Details: Provide allocation table and how budgets are derived per artifact type.
- [x] Task 16.0.6.c: Define guard behavior (skip, spill, warn, abort).
Details: Specify behavior by severity and artifact category.
- [x] Task 16.0.6.d: Define telemetry fields for budget usage.
Details: List counters, gauges, and log outputs for budget tracking.
- [x] Task 16.0.6.e: Define how budgets affect sharding, compression, and spill.
Details: Specify decision flow and precedence rules.
Notes: Include a mapping table from artifact type to default budgets.

Tests:
- [ ] `tests/indexing/runtime/byte-budget-policy-contract.test.js` (perf lane) (new)

### Subphase 16.0.7 -- Deterministic Ordering Spec
Parallel: Can run alongside 16.0.1–16.0.6; reconcile glossary/terms at end of Phase 16.0.
Touchpoints: `docs/specs/*` (anchor: section headers in the spec for this subphase)
Docs/specs to update: `docs/specs/build-scheduler.md`, `docs/specs/artifact-io-pipeline.md`, `docs/specs/cache-key-invalidation.md`, `docs/specs/build-truth-ledger.md`, `docs/specs/spill-merge-framework.md`, `docs/specs/byte-budget-policy.md`, `docs/specs/deterministic-ordering.md`
Tasks:
- [x] Task 16.0.7.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.0.7.a: Draft `docs/specs/deterministic-ordering.md` with ordering rules.
Details: Include ordering rules per artifact and any required stable sorts.
- [x] Task 16.0.7.b: Define tie-breakers for chunk_meta, relations, and graph edges.
Details: Specify tie-breaker fields and their precedence.
- [x] Task 16.0.7.c: Define ordering helpers and API surface.
Details: Document helper functions, inputs, and expected outputs.
- [x] Task 16.0.7.d: Define determinism verification strategy and hashes.
Details: Specify how hashes are computed and when they are validated.
Details: Document breaking-change behavior and how ordering updates are handled.
Notes: Include a table of ordering keys per artifact.

Tests:
- [ ] `tests/shared/order/deterministic-ordering-contract.test.js` (perf lane) (new)

---

## Phase 16.1 -- Unified Build Scheduler + Backpressure Implementation

### Objective
Implement a shared scheduler that coordinates CPU/IO/memory across stages to avoid saturation.
Docs/specs to update: `docs/specs/concurrency-abort-runwithqueue.md`, `docs/specs/runtime-envelope.md`, `docs/perf/indexing-stage-audit.md`, `docs/perf/shared-component-audit.md`
Touchpoints: `src/shared/concurrency.js (anchor: runWithQueue)`, `src/shared/runtime/thread-limits.js (anchor: resolveThreadLimits)`, `src/index/build/indexer/pipeline.js (anchor: runPipeline)`, `src/index/build/indexer/steps/process-files.js (anchor: processFiles)`, `tools/build/embeddings/runner.js (anchor: runEmbeddings)`

### Subphase 16.1.1 -- Core Scheduler
Parallel: Must land before 16.1.2 and 16.1.3.
Docs/specs to update: `docs/specs/concurrency-abort-runwithqueue.md`, `docs/specs/runtime-envelope.md`, `docs/perf/indexing-stage-audit.md`, `docs/perf/shared-component-audit.md`
Touchpoints: `src/shared/concurrency.js (anchor: runWithQueue)`, `src/shared/runtime/thread-limits.js (anchor: resolveThreadLimits)`, `src/index/build/indexer/pipeline.js (anchor: runPipeline)`, `src/index/build/indexer/steps/process-files.js (anchor: processFiles)`, `tools/build/embeddings/runner.js (anchor: runEmbeddings)`
Tasks:
- [x] Task 16.1.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.1.1.a: Implement scheduler core and resource tokens in `src/shared/concurrency.js`.
- [x] Task 16.1.1.b: Add queue classes with priorities and fairness.
- [x] Task 16.1.1.c: Add config loader for scheduler limits (env/CLI/config).
- [x] Task 16.1.1.d: Expose hooks for stage registration and lifecycle.
- [x] Task 16.1.1.e: Add telemetry counters and diagnostics export.
- [x] Task 16.1.1.f: Add admission-control caps per queue (max backlog) to prevent unbounded memory growth.
- [x] Task 16.1.1.g: Add starvation detection metrics (max wait time, token debt) with a fairness override.
- [x] Task 16.1.1.h: Add a CPU-only “low-resource mode” fallback for small repos to avoid scheduler overhead.
Notes: Ensure scheduler can be disabled for baseline comparisons.

Tests:
- [x] `tests/perf/scheduler-core.test.js` (perf lane) (new)
- [x] `tests/perf/scheduler-fairness.test.js` (perf lane) (new)
- [x] `tests/perf/scheduler-starvation-detection.test.js` (perf lane) (new)

### Subphase 16.1.2 -- Stage Wiring
Parallel: Can run alongside 16.1.3 after 16.1.1; coordinate file ownership.
Docs/specs to update: `docs/specs/concurrency-abort-runwithqueue.md`, `docs/specs/runtime-envelope.md`, `docs/perf/indexing-stage-audit.md`, `docs/perf/shared-component-audit.md`
Touchpoints: `src/shared/concurrency.js (anchor: runWithQueue)`, `src/shared/runtime/thread-limits.js (anchor: resolveThreadLimits)`, `src/index/build/indexer/pipeline.js (anchor: runPipeline)`, `src/index/build/indexer/steps/process-files.js (anchor: processFiles)`, `tools/build/embeddings/runner.js (anchor: runEmbeddings)`
Tasks:
- [x] Task 16.1.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.1.2.a: Wire Stage1 file processing through scheduler queues.
- [x] Task 16.1.2.b: Wire Stage2 relations tasks through scheduler queues.
- [x] Task 16.1.2.c: Wire Stage4 sqlite build through scheduler queues.
- [x] Task 16.1.2.d: Replace per-stage IO caps with scheduler hooks.
- [x] Task 16.1.2.e: Ensure per-stage progress reporting uses scheduler metrics.
Notes: Keep a fallback mode to compare old behavior.

Tests:
- [x] `tests/perf/indexing/runtime/scheduler-stage-wiring.test.js` (perf lane) (new)

### Subphase 16.1.3 -- Embeddings + IO Integration
Parallel: Can run alongside 16.1.2 after 16.1.1; coordinate file ownership.
Docs/specs to update: `docs/specs/concurrency-abort-runwithqueue.md`, `docs/specs/runtime-envelope.md`, `docs/perf/indexing-stage-audit.md`, `docs/perf/shared-component-audit.md`
Touchpoints: `src/shared/concurrency.js (anchor: runWithQueue)`, `src/shared/runtime/thread-limits.js (anchor: resolveThreadLimits)`, `src/index/build/indexer/pipeline.js (anchor: runPipeline)`, `src/index/build/indexer/steps/process-files.js (anchor: processFiles)`, `tools/build/embeddings/runner.js (anchor: runEmbeddings)`
Tasks:
- [x] Task 16.1.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.1.3.a: Gate embeddings compute concurrency via scheduler CPU tokens.
- [x] Task 16.1.3.b: Gate embeddings write queue via scheduler IO tokens.
- [x] Task 16.1.3.c: Coordinate artifact IO loads with scheduler IO pool.
- [x] Task 16.1.3.d: Add scheduler-aware backpressure to embedding runner.
- [x] Task 16.1.3.e: Add logging for token starvation events.
Notes: Ensure scheduler defaults do not regress small repos.

Tests:
- [x] `tests/perf/indexing/embeddings/scheduler-backpressure.test.js` (perf lane) (new)

### Subphase 16.1.4 -- Scheduler Tests + Bench
Parallel: Run after 16.1.1–16.1.3.
Docs/specs to update: `docs/specs/concurrency-abort-runwithqueue.md`, `docs/specs/runtime-envelope.md`, `docs/perf/indexing-stage-audit.md`, `docs/perf/shared-component-audit.md`
Touchpoints: `src/shared/concurrency.js (anchor: runWithQueue)`, `src/shared/runtime/thread-limits.js (anchor: resolveThreadLimits)`, `src/index/build/indexer/pipeline.js (anchor: runPipeline)`, `src/index/build/indexer/steps/process-files.js (anchor: processFiles)`, `tools/build/embeddings/runner.js (anchor: runEmbeddings)`
Tasks:
- [x] Task 16.1.4.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.1.4.a: Add benchmark comparing scheduler on/off for large builds.
- [x] Task 16.1.4.b: Add benchmark for IO starvation avoidance.
- [x] Task 16.1.4.c: Add regression test ensuring scheduler does not change outputs.
- [x] Task 16.1.4.d: Add telemetry assertions in tests.
- [x] Task 16.1.4.e: Add docs update to reference scheduler config.
- [x] Task 16.1.4.f: Add deterministic scheduling tests with synthetic CPU-only workloads.

Tests:
- [x] `tests/perf/indexing/runtime/scheduler-no-output-regression.test.js` (perf lane) (new)
- [x] `tests/perf/indexing/runtime/scheduler-telemetry.test.js` (perf lane) (new)
- [x] `tests/perf/indexing/runtime/scheduler-deterministic.test.js` (perf lane) (new)

---

## Phase 16.2 -- Shared Artifact IO Pipeline

### Objective
Standardize artifact IO (streaming, sharding, offsets, compression) across all writers and loaders.
Docs/specs to update: `docs/specs/json-stream-atomic-replace.md`, `docs/specs/artifact-schemas.md`, `docs/perf/index-artifact-pipelines.md`, `docs/perf/shared-io-serialization.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/json-stream.js (anchor: writeJsonLinesShardedAsync)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/storage/sqlite/build/from-artifacts.js (anchor: buildDatabaseFromArtifacts)`

### Subphase 16.2.1 -- Core Readers
Parallel: Can run alongside 16.2.2; complete before 16.2.3/16.2.4.
Docs/specs to update: `docs/specs/json-stream-atomic-replace.md`, `docs/specs/artifact-schemas.md`, `docs/perf/index-artifact-pipelines.md`, `docs/perf/shared-io-serialization.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/json-stream.js (anchor: writeJsonLinesShardedAsync)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/storage/sqlite/build/from-artifacts.js (anchor: buildDatabaseFromArtifacts)`
Tasks:
- [x] Task 16.2.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.2.1.a: Implement buffer-scanner JSONL reader (replace readline).
- [x] Task 16.2.1.b: Add adaptive highWaterMark based on file size.
- [x] Task 16.2.1.c: Add shard read concurrency with deterministic ordering.
- [x] Task 16.2.1.d: Add telemetry sampling for large reads.
- [x] Task 16.2.1.e: Add decompression offload for large shards.
- [x] Task 16.2.1.f: Add small-file fast path to avoid overhead on tiny artifacts.

Tests:
- [x] `tests/shared/artifact-io/jsonl-buffer-scan.test.js` (perf lane) (new)
- [x] `tests/shared/artifact-io/jsonl-concurrency-order.test.js` (perf lane) (new)

### Subphase 16.2.2 -- Compression + Offsets
Parallel: Can run alongside 16.2.1; complete before 16.2.3/16.2.4.
Docs/specs to update: `docs/specs/json-stream-atomic-replace.md`, `docs/specs/artifact-schemas.md`, `docs/perf/index-artifact-pipelines.md`, `docs/perf/shared-io-serialization.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/json-stream.js (anchor: writeJsonLinesShardedAsync)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/storage/sqlite/build/from-artifacts.js (anchor: buildDatabaseFromArtifacts)`
Tasks:
- [x] Task 16.2.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.2.2.a: Define unified offsets format and shared writer.
- [x] Task 16.2.2.b: Generate offsets during write (no second pass).
- [x] Task 16.2.2.c: Standardize byte-based sharding thresholds.
- [x] Task 16.2.2.d: Ensure compression suffix matches per-artifact mode.
- [x] Task 16.2.2.e: Add offset index validation in loaders.
- [x] Task 16.2.2.f: Add explicit offsets version + compression mode to shard metadata.

Tests:
- [x] `tests/shared/artifact-io/offsets-unified.test.js` (perf lane) (new)

### Subphase 16.2.3 -- Writer Migration
Parallel: Start after 16.2.1/16.2.2; can run alongside 16.2.4 with clear file ownership.
Docs/specs to update: `docs/specs/json-stream-atomic-replace.md`, `docs/specs/artifact-schemas.md`, `docs/perf/index-artifact-pipelines.md`, `docs/perf/shared-io-serialization.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/json-stream.js (anchor: writeJsonLinesShardedAsync)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/storage/sqlite/build/from-artifacts.js (anchor: buildDatabaseFromArtifacts)`
Tasks:
  - [x] Task 16.2.3.doc: Update docs/specs and touchpoints listed for this subphase.
  - [x] Task 16.2.3.a: Migrate chunk_meta writer to unified pipeline.
  - [x] Task 16.2.3.b: Migrate symbol artifacts writers to unified pipeline.
  - [x] Task 16.2.3.c: Migrate relations/map writers to unified pipeline.
  - [x] Task 16.2.3.d: Enforce atomic swap for all artifact sets.
  - [x] Task 16.2.3.e: Add writer-side byte-budget guards.

Tests:
  - [x] `tests/perf/writer-unified-pipeline.test.js` (perf lane) (new)

### Subphase 16.2.4 -- Loader Migration
Parallel: Start after 16.2.1/16.2.2; can run alongside 16.2.3 with clear file ownership.
Docs/specs to update: `docs/specs/json-stream-atomic-replace.md`, `docs/specs/artifact-schemas.md`, `docs/perf/index-artifact-pipelines.md`, `docs/perf/shared-io-serialization.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/json-stream.js (anchor: writeJsonLinesShardedAsync)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/storage/sqlite/build/from-artifacts.js (anchor: buildDatabaseFromArtifacts)`
  Tasks:
    - [x] Task 16.2.4.doc: Update docs/specs and touchpoints listed for this subphase.
    - [x] Task 16.2.4.a: Migrate loader paths to unified pipeline (chunk_meta, symbols).
    - [x] Task 16.2.4.b: Add hot parse cache for manifest + meta files.
  - [x] Task 16.2.4.c: Add bounded parallel artifact loads.
  - [x] Task 16.2.4.d: Add fallback to full scan when per-file index is invalid.
- [ ] Task 16.2.4.e: Add missing-artifact detection for partial shards.
- [ ] Task 16.2.4.f: Add JSONL reader fuzz tests for malformed/corrupt shards.

Tests:
- [ ] `tests/shared/artifact-io/loader-fallbacks.test.js` (perf lane) (new)
- [ ] `tests/shared/artifact-io/jsonl-fuzz.test.js` (perf lane) (new)

### Subphase 16.2.5 -- Validation + Bench
Parallel: Run after 16.2.3/16.2.4.
Docs/specs to update: `docs/specs/json-stream-atomic-replace.md`, `docs/specs/artifact-schemas.md`, `docs/perf/index-artifact-pipelines.md`, `docs/perf/shared-io-serialization.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/json-stream.js (anchor: writeJsonLinesShardedAsync)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/storage/sqlite/build/from-artifacts.js (anchor: buildDatabaseFromArtifacts)`
  Tasks:
    - [x] Task 16.2.5.doc: Update docs/specs and touchpoints listed for this subphase.
    - [x] Task 16.2.5.a: Add trusted fast-path validation mode for hot paths.
    - [x] Task 16.2.5.b: Add strict validation mode for CI/validation flows.
  - [x] Task 16.2.5.c: Add `artifact-io-read` benchmark baseline/current.
  - [x] Task 16.2.5.d: Add `jsonl-offset-index` benchmark on real index.
- [ ] Task 16.2.5.e: Add docs update referencing the unified pipeline.

Tests:
- [ ] `tests/shared/artifact-io/validation-fastpath.test.js` (perf lane) (new)

---

## Phase 16.3 -- Global Cache Key + Invalidation

### Objective
Apply a unified cache key schema and invalidation rules across caches.
Docs/specs to update: `docs/specs/embeddings-cache.md`, `docs/specs/import-resolution.md`, `docs/specs/vfs-index.md`, `docs/specs/vfs-hash-routing.md`
Touchpoints:
- `src/shared/cache-key.js` (anchor: buildCacheKey)
- `src/shared/cache-roots.js` (anchor: getCacheRoot)
- `src/shared/cache.js` (anchor: createCache)
- `src/shared/artifact-io/cache.js` (anchor: buildCacheKey)
- `src/context-pack/assemble.js` (anchor: EXCERPT_CACHE_MAX)
- `src/config/validate.js` (anchor: validatorCache)
- `src/index/tooling/vfs.js` (anchor: VFS_DISK_CACHE)
- `src/index/build/vfs-segment-hash-cache.js` (anchor: buildSegmentHashCacheKey)
- `src/index/build/import-resolution.js` (anchor: cacheKeyFor)
- `src/index/build/tokenization.js` (anchor: cacheKey)
- `src/index/build/file-processor/process-chunks/index.js` (anchor: complexityCache)
- `src/index/build/file-processor/cpu.js` (anchor: treeSitterCacheKey)
- `src/index/git.js` (anchor: gitMetaCache)
- `src/index/tooling/orchestrator.js` (anchor: computeCacheKey)
- `src/retrieval/cli/run-search-session.js` (anchor: buildQueryCacheKey)
- `src/retrieval/query-plan-cache.js` (anchor: buildQueryCacheKey)
- `src/shared/onnx-embeddings.js` (anchor: onnxCache)
- `src/lang/tree-sitter/chunking.js` (anchor: resolveChunkCacheKey)
- `src/graph/store.js` (anchor: buildGraphIndexCacheKey)
- `src/graph/suggest-tests.js` (anchor: TEST_MATCHER_CACHE_MAX)
- `src/retrieval/output/summary.js` (anchor: summaryCache)
- `src/retrieval/output/format.js` (anchor: formatCache)
- `src/retrieval/cli-sqlite.js` (anchor: sqliteChunkCountCache)
- `src/retrieval/cli-index.js` (anchor: buildQueryCacheKey)
- `src/retrieval/cli/run-search-session.js` (anchor: embeddingCache)
- `src/retrieval/query-plan-cache.js` (anchor: buildQueryPlanCacheKey)
- `src/retrieval/index-cache.js` (anchor: indexSignatureCache)
- `src/context-pack/assemble.js` (anchor: excerptCache)
- `src/graph/suggest-tests.js` (anchor: testMatcherCache)
- `src/graph/store.js` (anchor: buildGraphIndexCacheKey)
- `src/map/build-map.js` (anchor: buildMapCacheKey)
- `src/index/git.js` (anchor: gitMetaCache)
- `src/shared/artifact-io/cache.js` (anchor: pieceCache)
- `src/shared/embedding-adapter.js` (anchor: pipelineCache)
- `tools/build/embeddings/cache.js` (anchor: buildCacheKey)
- `tools/build/embeddings/runner.js` (anchor: buildCacheIdentity)
- `tools/cache/clear-cache.js` (anchor: clear-cache)
- `tools/reports/report-code-map.js` (anchor: buildMapCacheKey)
- `tools/sqlite/vector-extension.js` (anchor: getLoadCacheKey)

### Subphase 16.3.1 -- Schema + Helpers
Parallel: Must land before 16.3.2/16.3.3/16.3.4.
Docs/specs to update: `docs/specs/cache-key-invalidation.md`, `docs/specs/embeddings-cache.md`, `docs/specs/import-resolution.md`, `docs/specs/vfs-index.md`, `docs/specs/vfs-hash-routing.md`
Touchpoints: see Phase 16.3 list (primary anchors: `src/shared/cache-key.js`, `src/shared/cache.js`, `tools/build/embeddings/cache.js`).
Tasks:
- [x] Task 16.3.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.3.1.a: Implement cache key builder with repo hash + build config.
- [x] Task 16.3.1.b: Include mode + schema version tags in keys.
- [x] Task 16.3.1.c: Add helpers for key serialization and hashing.
- [x] Task 16.3.1.d: Add config-based overrides for cache namespace.
- [x] Task 16.3.1.e: Add migration note in spec and docs.
- [x] Task 16.3.1.f: Include normalized path policy and feature flags in cache keys.
- [x] Task 16.3.1.g: Add local cache key helper and migrate in-memory cache keys (graph/query/map/git/context-pack/sqlite/artifact-io).

Tests:
- [x] `tests/perf/cache-key-builder.test.js` (perf lane) (new)

### Subphase 16.3.2 -- Embeddings Cache
Parallel: Can run alongside 16.3.3 after 16.3.1; coordinate file ownership.
Docs/specs to update: `docs/specs/embeddings-cache.md`, `docs/specs/import-resolution.md`, `docs/specs/vfs-index.md`, `docs/specs/vfs-hash-routing.md`
Touchpoints: see Phase 16.3 list (primary anchors: `tools/build/embeddings/cache.js`, `tools/build/embeddings/runner.js`, `src/shared/cache-key.js`).
Tasks:
- [x] Task 16.3.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.3.2.a: Apply new key schema to embeddings cache.
- [x] Task 16.3.2.b: Add cache validation fast-path (bitset + checksum).
- [x] Task 16.3.2.c: Ensure cross-mode reuse is keyed consistently.
- [x] Task 16.3.2.d: Add invalidation when model/quant changes.
- [x] Task 16.3.2.e: Record cache hit stats in build telemetry.

Tests:
- [x] `tests/perf/embeddings-cache-key-schema.test.js` (perf lane) (new)

### Subphase 16.3.3 -- File Meta, Import, VFS
Parallel: Can run alongside 16.3.2 after 16.3.1; coordinate file ownership.
Docs/specs to update: `docs/specs/import-resolution.md`, `docs/specs/vfs-index.md`, `docs/specs/vfs-hash-routing.md`, `docs/specs/file-meta.md`
Touchpoints: see Phase 16.3 list (primary anchors: `src/index/build/import-resolution.js`, `src/index/tooling/vfs.js`, `src/index/build/vfs-segment-hash-cache.js`, `src/index/build/artifacts/file-meta.js`).
Tasks:
- [x] Task 16.3.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.3.3.a: Apply key schema to file_meta cache reuse.
- [x] Task 16.3.3.b: Apply key schema to import-resolution cache.
- [x] Task 16.3.3.c: Apply key schema to VFS routing/index caches.
- [x] Task 16.3.3.d: Add invalidation on file set changes.
- [x] Task 16.3.3.e: Add logs for cache eviction reason.
- [x] Task 16.3.3.f: Invalidate resolved imports on file-set change (not just unresolved).

Tests:
- [x] `tests/indexing/imports/cache-invalidation.test.js` (perf lane) (new)

### Subphase 16.3.4 -- Cache Reset + Cleanup
Parallel: Run after 16.3.1; can overlap with 16.3.2/16.3.3 if isolated to tooling.
Docs/specs to update: `docs/specs/cache-key-invalidation.md`, `docs/specs/embeddings-cache.md`, `docs/specs/import-resolution.md`, `docs/specs/vfs-index.md`, `docs/specs/vfs-hash-routing.md`
Touchpoints: see Phase 16.3 list (primary anchors: `src/shared/cache-key.js`, `tools/build/embeddings/cache.js`, `src/index/tooling/orchestrator.js`).
Tasks:
- [x] Task 16.3.4.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.3.4.a: Introduce a versioned cache root (breaking change).
- [x] Task 16.3.4.b: Purge all legacy cache layouts unconditionally on upgrade.
- [x] Task 16.3.4.c: Add CLI/env flag to force cache rebuild.
- [x] Task 16.3.4.d: Add cache size cap + eviction for on-disk caches.
- [x] Task 16.3.4.e: Add clear-cache tooling command with safety prompt.

Tests:
- [x] `tests/shared/cache/cache-migration.test.js` (perf lane) (new)

### Subphase 16.3.5 -- Tests + Bench
Parallel: Run after 16.3.2–16.3.4.
Docs/specs to update: `docs/specs/cache-key-invalidation.md`, `docs/specs/embeddings-cache.md`, `docs/specs/import-resolution.md`, `docs/specs/vfs-index.md`, `docs/specs/vfs-hash-routing.md`
Touchpoints: see Phase 16.3 list (primary anchors: `tools/bench/*`, `tests/perf/*`).
Tasks:
- [x] Task 16.3.5.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.3.5.a: Add cache hit/miss benchmark to `cache-hit-rate`.
- [x] Task 16.3.5.b: Add determinism tests for cache reuse.
- [x] Task 16.3.5.c: Add regression test for missing-file invalidation.
- [x] Task 16.3.5.d: Add docs update for cache key schema.
- [x] Task 16.3.5.e: Add telemetry sampling for cache performance.

Tests:
- [x] `tests/shared/cache/cache-hit-rate-contract.test.js` (perf lane) (new)

---

## Phase 16.4 -- Build Truth Ledger + Deterministic Ordering

### Objective
Guarantee determinism via a shared ordering library and ledger validation.
Docs/specs to update: `docs/specs/build-state-integrity.md`, `docs/specs/deterministic-ordering.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/graph-filtering-and-dedupe.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeBuildState)`, `src/shared/order.js (anchor: stableOrder)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/graph/store.js (anchor: buildAdjacencyCsr)`, `src/index/validate/index-validate.js (anchor: validateIndex)`

### Subphase 16.4.1 -- Ledger Core
Parallel: Can run alongside 16.4.2; both must land before 16.4.3.
Docs/specs to update: `docs/specs/build-state-integrity.md`, `docs/specs/deterministic-ordering.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/graph-filtering-and-dedupe.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeBuildState)`, `src/shared/order.js (anchor: stableOrder)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/graph/store.js (anchor: buildAdjacencyCsr)`, `src/index/validate/index-validate.js (anchor: validateIndex)`
Tasks:
- [x] Task 16.4.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.4.1.a: Implement ledger schema writer in build_state.
- [x] Task 16.4.1.b: Record per-stage ordering hashes.
- [x] Task 16.4.1.c: Add schema versioning and upgrade rules.
- [x] Task 16.4.1.d: Add ledger read/validate helpers.
- [x] Task 16.4.1.e: Add ledger export for tooling.
- [x] Task 16.4.1.f: Record ordering seed inputs (discovery/file list hashes) for diagnosis.

Tests:
- [x] `tests/indexing/build-state/ledger-roundtrip.test.js` (perf lane) (new)

### Subphase 16.4.2 -- Ordering Library
Parallel: Can run alongside 16.4.1; both must land before 16.4.3.
Docs/specs to update: `docs/specs/build-state-integrity.md`, `docs/specs/deterministic-ordering.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/graph-filtering-and-dedupe.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeBuildState)`, `src/shared/order.js (anchor: stableOrder)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/graph/store.js (anchor: buildAdjacencyCsr)`, `src/index/validate/index-validate.js (anchor: validateIndex)`
Tasks:
- [x] Task 16.4.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.4.2.a: Implement shared ordering helpers in `src/shared/order.js`.
- [x] Task 16.4.2.b: Define stable bucket ordering and tie-breakers.
- [x] Task 16.4.2.c: Add helpers for deterministic map/repo-map ordering.
- [x] Task 16.4.2.d: Add tests for ordering stability.
- [x] Task 16.4.2.e: Add docs for ordering rules.

Tests:
- [x] `tests/shared/order/order-stability.test.js` (perf lane) (new)

### Subphase 16.4.3 -- Wiring
Parallel: Run after 16.4.1/16.4.2.
Docs/specs to update: `docs/specs/build-state-integrity.md`, `docs/specs/deterministic-ordering.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/graph-filtering-and-dedupe.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeBuildState)`, `src/shared/order.js (anchor: stableOrder)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/graph/store.js (anchor: buildAdjacencyCsr)`, `src/index/validate/index-validate.js (anchor: validateIndex)`
Tasks:
- [x] Task 16.4.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.4.3.a: Apply ordering helpers to chunk_meta emission.
- [x] Task 16.4.3.b: Apply ordering helpers to relations emission.
- [x] Task 16.4.3.c: Apply ordering helpers to graph outputs.
- [x] Task 16.4.3.d: Apply ordering helpers to repo map outputs.
- [x] Task 16.4.3.e: Record ordering hashes in ledger for each artifact.

Tests:
- [x] `tests/indexing/determinism/ordering-ledger-integration.test.js` (perf lane) (new)

### Subphase 16.4.4 -- Validation
Parallel: Run after 16.4.3.
Docs/specs to update: `docs/specs/build-state-integrity.md`, `docs/specs/deterministic-ordering.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/graph-filtering-and-dedupe.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeBuildState)`, `src/shared/order.js (anchor: stableOrder)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/graph/store.js (anchor: buildAdjacencyCsr)`, `src/index/validate/index-validate.js (anchor: validateIndex)`
Tasks:
- [x] Task 16.4.4.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.4.4.a: Add validator to check ledger hashes on load.
- [x] Task 16.4.4.b: Add warning vs error policy for mismatches.
- [x] Task 16.4.4.c: Add reporting for mismatch source.
- [x] Task 16.4.4.d: Add fallback path to rebuild ordering.
- [x] Task 16.4.4.e: Add CLI flag to force validation.
- [x] Task 16.4.4.f: Add determinism drift report with artifact + rule attribution.

Tests:
- [x] `tests/indexing/validate/ledger-validation.test.js` (perf lane) (new)

### Subphase 16.4.5 -- Tests + Bench
Parallel: Run after 16.4.1–16.4.4.
Docs/specs to update: `docs/specs/build-state-integrity.md`, `docs/specs/deterministic-ordering.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/graph-filtering-and-dedupe.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeBuildState)`, `src/shared/order.js (anchor: stableOrder)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`, `src/graph/store.js (anchor: buildAdjacencyCsr)`, `src/index/validate/index-validate.js (anchor: validateIndex)`
Tasks:
- [x] Task 16.4.5.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.4.5.a: Add determinism bench on large repo.
- [x] Task 16.4.5.b: Add unit tests for ledger hash computation.
- [x] Task 16.4.5.c: Add regression test for chunk_meta ordering drift.
- [x] Task 16.4.5.d: Add docs update for ledger usage.
- [x] Task 16.4.5.e: Add benchmark flag for ledger on/off.

Tests:
- [x] `tests/shared/order/order-hash.test.js` (perf lane) (new)
- [x] `tests/indexing/determinism/chunk-meta-ordering-drift.test.js` (perf lane) (new)

---

## Phase 16.5 -- Unified Spill/Merge + Byte Budget

### Objective
Provide shared spill/merge and consistent byte-budget enforcement across artifacts.
Docs/specs to update: `docs/specs/spimi-spill.md`, `docs/specs/segmentation-perf.md`, `docs/specs/vfs-io-batching.md`, `docs/specs/byte-budget-policy.md`
Touchpoints: `src/shared/merge.js (anchor: mergeSortedRuns)`, `src/index/build/postings.js (anchor: buildPostings)`, `src/index/vfs/merge.js (anchor: mergeRuns)`, `src/index/build/indexer/steps/relations.js (anchor: buildRelations)`, `src/index/build/build-state.js (anchor: byteBudgets)`, `src/index/build/byte-budget.js (anchor: resolveByteBudgetMap)`

### Subphase 16.5.1 -- Merge Core
Parallel: Must land before 16.5.2/16.5.3.
Docs/specs to update: `docs/specs/spimi-spill.md`, `docs/specs/segmentation-perf.md`, `docs/specs/vfs-io-batching.md`, `docs/specs/byte-budget-policy.md`
Touchpoints: `src/shared/merge.js (anchor: mergeSortedRuns)`, `src/index/build/postings.js (anchor: buildPostings)`, `src/index/vfs/merge.js (anchor: mergeRuns)`, `src/index/build/indexer/steps/relations.js (anchor: buildRelations)`, `src/index/build/build-state.js (anchor: byteBudgets)`, `src/index/build/byte-budget.js (anchor: resolveByteBudgetMap)`
Tasks:
- [x] Task 16.5.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.5.1.a: Implement shared k-way merge core in `src/shared/merge.js`.
- [x] Task 16.5.1.b: Add bounded heap and chunked write support.
- [x] Task 16.5.1.c: Add stable ordering guarantees for merges.
- [x] Task 16.5.1.d: Add cleanup hooks for spill files.
- [x] Task 16.5.1.e: Add telemetry counters for merge throughput.
- [x] Task 16.5.1.f: Add resumable merge checkpoints for large merges.
- [x] Task 16.5.1.g: Define merge core API contract (inputs/outputs, comparator contract, serialization hooks).
- [x] Task 16.5.1.h: Add comparator total-order validation guard for debug builds.
- [x] Task 16.5.1.i: Define spill run manifest schema + naming conventions.
- [x] Task 16.5.1.j: Add standardized spill recovery + cleanup path.

Tests:
- [x] `tests/shared/merge/merge-core.test.js` (perf lane) (new)

### Subphase 16.5.2 -- Postings Adoption
Parallel: Can run alongside 16.5.3 after 16.5.1; coordinate file ownership.
Docs/specs to update: `docs/specs/spimi-spill.md`, `docs/specs/segmentation-perf.md`, `docs/specs/vfs-io-batching.md`, `docs/specs/byte-budget-policy.md`
Touchpoints: `src/shared/merge.js (anchor: mergeSortedRuns)`, `src/index/build/postings.js (anchor: buildPostings)`, `src/index/vfs/merge.js (anchor: mergeRuns)`, `src/index/build/indexer/steps/relations.js (anchor: buildRelations)`, `src/index/build/state.js (anchor: byteBudgets)`
Tasks:
- [x] Task 16.5.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.5.2.a: Replace postings spill/merge with shared merge core.
- [x] Task 16.5.2.b: Add byte-based spill threshold for postings.
- [x] Task 16.5.2.c: Add deterministic merge ordering for postings.
- [x] Task 16.5.2.d: Add merge stats to build_state.
- [x] Task 16.5.2.e: Add tests for spill/merge determinism.
- [x] Task 16.5.2.f: Define postings merge comparator + tie-break rules in code/docs.
- [x] Task 16.5.2.g: Add baseline compatibility check against legacy postings output.

Tests:
- [x] `tests/indexing/postings/spill-merge-unified.test.js` (perf lane) (new)
- [x] `tests/indexing/postings/spill-merge-compat.test.js` (perf lane) (new)

### Subphase 16.5.3 -- VFS/Relations/Artifacts Adoption
Parallel: Can run alongside 16.5.2 after 16.5.1; coordinate file ownership.
Docs/specs to update: `docs/specs/spimi-spill.md`, `docs/specs/segmentation-perf.md`, `docs/specs/vfs-io-batching.md`, `docs/specs/byte-budget-policy.md`
Touchpoints: `src/shared/merge.js (anchor: mergeSortedRuns)`, `src/index/build/postings.js (anchor: buildPostings)`, `src/index/vfs/merge.js (anchor: mergeRuns)`, `src/index/build/indexer/steps/relations.js (anchor: buildRelations)`, `src/index/build/state.js (anchor: byteBudgets)`
Tasks:
- [x] Task 16.5.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.5.3.a: Replace VFS merge with shared merge core.
- [x] Task 16.5.3.b: Replace relations spill/merge with shared merge core.
- [x] Task 16.5.3.c: Replace artifact shard merge with shared merge core.
- [x] Task 16.5.3.d: Ensure byte thresholds are used consistently.
- [x] Task 16.5.3.e: Add unified cleanup for spill artifacts.
- [x] Task 16.5.3.f: Define per-adopter comparator + serializer contracts for VFS/relations/artifacts.
- [x] Task 16.5.3.g: Add byte-budget policy mapping for VFS/relations/artifacts (fail vs truncate).
- [x] Task 16.5.3.h: Add spill cleanup regression test for VFS/relations/artifacts.

Tests:
- [x] `tests/indexing/vfs/merge-core-integration.test.js` (perf lane) (new)
- [x] `tests/indexing/relations/merge-core-integration.test.js` (perf lane) (new)

### Subphase 16.5.4 -- Byte Budget Policy
Parallel: Can run alongside 16.5.1; must land before 16.5.5.
Docs/specs to update: `docs/specs/spimi-spill.md`, `docs/specs/segmentation-perf.md`, `docs/specs/vfs-io-batching.md`, `docs/specs/byte-budget-policy.md`
Touchpoints: `src/shared/merge.js (anchor: mergeSortedRuns)`, `src/index/build/postings.js (anchor: buildPostings)`, `src/index/vfs/merge.js (anchor: mergeRuns)`, `src/index/build/indexer/steps/relations.js (anchor: buildRelations)`, `src/index/build/state.js (anchor: byteBudgets)`
Tasks:
- [x] Task 16.5.4.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.5.4.a: Implement global byte budget map in build_state.
- [x] Task 16.5.4.b: Add per-artifact budget caps and defaults.
- [x] Task 16.5.4.c: Add enforcement hooks to writers.
- [x] Task 16.5.4.d: Add warnings/abort policy for overages.
- [x] Task 16.5.4.e: Add telemetry outputs for budget usage.
- [x] Task 16.5.4.f: Define byte-budget policy table (artifact -> cap -> overflow behavior).
- [x] Task 16.5.4.g: Add strict perf-lane budget enforcement policy.
- [x] Task 16.5.4.h: Add shared `resolveByteBudget(artifactName, config)` helper.

Tests:
- [x] `tests/indexing/runtime/byte-budget-enforcement.test.js` (perf lane) (new)

### Subphase 16.5.5 -- Tests + Bench
Parallel: Run after 16.5.1–16.5.4.
Docs/specs to update: `docs/specs/spimi-spill.md`, `docs/specs/segmentation-perf.md`, `docs/specs/vfs-io-batching.md`, `docs/specs/byte-budget-policy.md`
Touchpoints: `src/shared/merge.js (anchor: mergeRunsWithPlanner)`, `src/index/build/postings.js (anchor: buildPostings)`, `src/index/build/artifacts/helpers.js (anchor: createRowSpillCollector)`, `src/index/build/artifacts/writers/symbol-edges.js (anchor: writeSymbolEdges)`, `src/index/build/artifacts/writers/symbol-occurrences.js (anchor: writeSymbolOccurrences)`, `src/index/build/build-state.js (anchor: byteBudgets)`, `tools/bench/merge/merge-core-throughput.js`, `tools/bench/merge/spill-merge-compare.js`, `tools/bench/merge/missing-run-file.js`
Tasks:
- [x] Task 16.5.5.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.5.5.a: Add merge throughput benchmark for large runs.
- [x] Task 16.5.5.b: Add byte budget regression test.
- [x] Task 16.5.5.c: Add benchmark comparing old/new spill merges.
- [x] Task 16.5.5.d: Add documentation updates for budgets and merges.
- [x] Task 16.5.5.e: Add build_state counters for spill/merge.
- [x] Task 16.5.5.f: Add merge cleanup/compaction regression test.
- [x] Task 16.5.5.g: Add benchmark metrics for throughput + heap + spill bytes.
- [x] Task 16.5.5.h: Add baseline/current delta line (amount, throughput, percent, duration).
- [x] Task 16.5.5.i: Add failure simulation bench for missing run file handling.

Tests:
- [x] `tests/indexing/runtime/byte-budget-enforcement.test.js` (perf lane) (new)
- [x] `tests/shared/merge/merge-cleanup-regression.test.js` (perf lane) (new)
- [x] `tests/shared/merge/merge-benchmark-contract.test.js` (perf lane) (new)

---

## Phase 16.13 -- Artifact Pipeline Optimization

### Subphase 16.13.1 -- Offsets + Shards
Parallel: Can run alongside 16.13.2 with clear file ownership.
Docs/specs to update: `docs/specs/artifact-schemas.md`, `docs/specs/json-stream-atomic-replace.md`, `docs/perf/index-artifact-pipelines.md`, `docs/perf/shared-io-serialization.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/artifact-io/offsets.js (anchor: readOffsetsIndex)`, `src/shared/artifact-io/manifest.js (anchor: readPiecesManifest)`, `src/index/build/artifacts/*.js (anchor: writeArtifacts)`, `src/shared/json-stream.js (anchor: writeJsonLinesShardedAsync)`
Tasks:
- [x] Task 16.13.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.13.1.doc.1: Audit existing offsets/manifest formats and enumerate legacy readers/writers.
- [x] Task 16.13.1.doc.2: Define versioned offsets schema and migration notes in specs.
- [x] Task 16.13.1.a: Implement unified offsets format across JSONL artifacts.
- [x] Task 16.13.1.a.1: Standardize offsets header fields (version, rows, bytes, shardCount, compression).
- [x] Task 16.13.1.a.2: Add offsets writer helper that emits per-shard offset tables.
- [x] Task 16.13.1.a.3: Update manifest/pieces metadata to reference offsets file names.
- [x] Task 16.13.1.b: Generate offsets during write (no second pass).
- [x] Task 16.13.1.b.1: Extend JSONL writer to capture byte positions during streaming writes.
- [x] Task 16.13.1.b.2: Ensure offsets match post-compression byte positions.
- [x] Task 16.13.1.b.3: Add guard for empty shard creation at max-byte boundary.
- [x] Task 16.13.1.c: Enforce byte-based sharding for all artifacts.
- [x] Task 16.13.1.c.1: Normalize shard thresholds via shared helper (maxBytes and minRows).
- [x] Task 16.13.1.c.2: Add per-artifact override mapping in writeArtifacts.
- [x] Task 16.13.1.c.3: Emit shard byte counts in sharded meta for validators.
- [x] Task 16.13.1.d: Add atomic swap for artifact sets.
- [x] Task 16.13.1.d.1: Write into temp dir and rename into place on success.
- [x] Task 16.13.1.d.2: Ensure manifest update is atomic with shard set.
- [x] Task 16.13.1.d.3: Add cleanup on failure and ensure partial shards are removed.
- [x] Task 16.13.1.e: Add lazy validation mode for hot paths.
- [x] Task 16.13.1.e.1: Add load flag to skip full JSON validation when offsets are trusted.
- [x] Task 16.13.1.e.2: Add sampling-based validation to detect drift.
- [x] Task 16.13.1.e.3: Force strict validation in perf lane and during schema upgrades.

Tests:
- [x] `tests/indexing/artifacts/offsets-unified-roundtrip.test.js` (perf lane) (new)

### Subphase 16.13.2 -- Loader Parallelism
Parallel: Can run alongside 16.13.1 with clear file ownership.
Docs/specs to update: `docs/specs/artifact-schemas.md`, `docs/specs/json-stream-atomic-replace.md`, `docs/perf/index-artifact-pipelines.md`, `docs/perf/shared-io-serialization.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/artifact-io/jsonl.js (anchor: readJsonlRows)`, `src/shared/artifact-io/manifest.js (anchor: readPiecesManifest)`, `src/shared/artifact-io/offsets.js (anchor: readOffsetsIndex)`, `src/shared/json-stream.js (anchor: writeJsonLinesShardedAsync)`
Tasks:
- [x] Task 16.13.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.13.2.doc.1: Document loader concurrency caps + default values.
- [x] Task 16.13.2.doc.2: Document fallback/strict error behavior for missing parts.
- [x] Task 16.13.2.a: Add bounded parallel artifact loads.
- [x] Task 16.13.2.a.1: Implement queue with max concurrency and max pending.
- [x] Task 16.13.2.a.2: Separate IO vs CPU parsing limits for loaders.
- [x] Task 16.13.2.a.3: Add scheduler tokens for large artifact loads.
- [x] Task 16.13.2.b: Add hot parse cache for manifest/meta files.
- [x] Task 16.13.2.b.1: Add LRU keyed by path+mtime+size hash.
- [x] Task 16.13.2.b.2: Cache parse errors briefly to avoid retry storms.
- [x] Task 16.13.2.b.3: Track cache hit rate in telemetry.
- [x] Task 16.13.2.c: Add fallback to full scan when per-file index invalid.
- [x] Task 16.13.2.c.1: Detect missing offsets/data shards and mark index unusable.
- [x] Task 16.13.2.c.2: Fall back to full JSONL scan with warning.
- [x] Task 16.13.2.c.3: Add guard to prevent partial results when index invalid.
- [x] Task 16.13.2.d: Add missing-part detection and failure mode.
- [x] Task 16.13.2.d.1: Fail fast when manifest lists missing shards.
- [x] Task 16.13.2.d.2: Include artifact name + shard id in error.
- [x] Task 16.13.2.d.3: Add optional strict/lenient toggle in loader options.
- [x] Task 16.13.2.e: Add loader telemetry sampling.
- [x] Task 16.13.2.e.1: Record bytes read, rows parsed, time per artifact.
- [x] Task 16.13.2.e.2: Emit sampling rate and skipped samples.
- [x] Task 16.13.2.f: Add loader determinism stress test under parallel loads.
- [x] Task 16.13.2.f.1: Run repeated parallel loads and compare hashes.
- [x] Task 16.13.2.f.2: Inject randomized ordering to ensure stability.

Tests:
- [x] `tests/shared/artifact-io/loader-parallelism.test.js` (perf lane) (new)
- [x] `tests/shared/artifact-io/broken-offsets-fallback.test.js` (perf lane) (new)

### Subphase 16.13.3 -- Tests + Bench
Parallel: Run after 16.13.1/16.13.2.
Docs/specs to update: `docs/specs/artifact-schemas.md`, `docs/specs/json-stream-atomic-replace.md`, `docs/perf/index-artifact-pipelines.md`, `docs/perf/shared-io-serialization.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/artifact-io/offsets.js (anchor: readOffsetsIndex)`, `src/shared/artifact-io/manifest.js (anchor: readPiecesManifest)`, `src/shared/json-stream.js (anchor: writeJsonLinesShardedAsync)`
Tasks:
- [x] Task 16.13.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.13.3.doc.1: Define benchmark CLI flags and expected output schema.
- [x] Task 16.13.3.doc.2: Document perf lane coverage for artifact pipeline tests.
- [x] Task 16.13.3.a: Implement `jsonl-offset-index` benchmark on real index.
- [x] Task 16.13.3.a.1: Baseline uses full scan loader; current uses offsets.
- [x] Task 16.13.3.a.2: Output delta line (duration, throughput, percent).
- [x] Task 16.13.3.b: Add artifact IO throughput benchmark baseline/current.
- [x] Task 16.13.3.b.1: Compare sharded vs unsharded for same artifact.
- [x] Task 16.13.3.b.2: Record heap delta and bytes read.
- [x] Task 16.13.3.c: Add regression test for loader determinism.
- [x] Task 16.13.3.c.1: Repeat load with parallelism and compare hash of rows.
- [x] Task 16.13.3.d: Add docs update for artifact pipeline.
- [x] Task 16.13.3.d.1: Include failure modes for missing shards and offsets.
- [x] Task 16.13.3.e: Add validation fast-path regression test.
- [x] Task 16.13.3.e.1: Ensure fast-path rejects invalid schema.
- [x] Task 16.13.3.f: Add broken-offsets fallback regression test (full scan).
- [x] Task 16.13.3.f.1: Simulate missing offsets and ensure fallback loads rows.

Tests:
- [x] `tests/shared/artifact-io/artifact-io-bench-contract.test.js` (perf lane) (new)
- [x] `tests/shared/artifact-io/validation-fastpath.test.js` (perf lane) (new)

### Subphase 16.13.4 -- Full Streaming Loaders + Minimal-Impl Hardening
Parallel: Run after 16.13.3; depends on offsets + loader parallelism.
Docs/specs to update: `docs/specs/artifact-io-pipeline.md`, `docs/perf/shared-io-serialization.md`, `docs/perf/index-artifact-pipelines.md`
Touchpoints: `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/shared/artifact-io/offsets.js (anchor: readOffsetsIndex)`, `src/shared/json-stream.js (anchor: readJsonlRows)`, `src/index/build/artifacts/helpers.js (anchor: mergeSortedRuns)`
Tasks:
- [x] Task 16.13.4.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.13.4.a: Add streaming row iterator API that never materializes arrays by default.
- [x] Task 16.13.4.a.1: Support offsets index to jump to shard ranges and stream rows in order.
- [x] Task 16.13.4.a.2: Add max in-flight row cap + backpressure hooks.
- [x] Task 16.13.4.b: Switch loader fast-paths to streaming when offsets exist; require explicit opt-in to materialize.
- [x] Task 16.13.4.b.1: Add `materialize` option to load helpers and update call sites.
- [x] Task 16.13.4.c: Convert artifact consumers that read large JSONL arrays to use iterators (graph, relations, file_meta, symbol artifacts).
- [x] Task 16.13.4.d: Enforce strict missing-part checks for streaming loaders (no partial results).
- [x] Task 16.13.4.e: Add streaming vs materialized benchmark and output delta line (duration, throughput, percent, heap).
- [x] Task 16.13.4.f: Add regression test for streaming correctness vs full scan (row hash match).
- [x] Task 16.13.4.g: Add regression test for streaming memory cap under large artifacts.
- [x] Task 16.13.4.h: Add determinism stress test under streaming + parallel loads.

Tests:
- [x] `tests/perf/artifact-io/streaming-vs-full.test.js` (perf lane) (new)
- [x] `tests/perf/artifact-io/streaming-memory-cap.test.js` (perf lane) (new)
- [x] `tests/perf/artifact-io/streaming-determinism.test.js` (perf lane) (new)

---

## Phase 16.14 -- Index State + File Meta + Minhash

### Subphase 16.14.1 -- Index State
Parallel: Can run alongside 16.14.2/16.14.3 with clear ownership.
Docs/specs to update: `docs/perf/index-state-file-meta.md`, `docs/specs/metadata-schema-v2.md`, `docs/specs/symbol-artifacts-and-pipeline.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeIndexState)`, `src/index/build/artifacts/file-meta.js (anchor: buildFileMeta)`, `src/index/build/postings.js (anchor: buildMinhash)`, `src/shared/artifact-io/loaders.js (anchor: loadMinhashSignatures)`
Tasks:
- [x] Task 16.14.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.14.1.doc.1: Enumerate current index_state fields and delta log format.
- [x] Task 16.14.1.doc.2: Define compatibility rules for compressed vs plain state.
- [x] Task 16.14.1.a: Implement index_state delta compression.
- [x] Task 16.14.1.a.1: Define delta encoding (patch list + binary diff) with schema version.
- [x] Task 16.14.1.a.2: Add reader that replays deltas into a snapshot.
- [x] Task 16.14.1.a.3: Add corruption detection and fallback to last full snapshot.
- [x] Task 16.14.1.b: Add comparable-hash skip logic for unchanged writes.
- [x] Task 16.14.1.b.1: Track lastComparableHash only after successful write.
- [x] Task 16.14.1.b.2: Add guard to reset hash on error.
- [x] Task 16.14.1.c: Add size instrumentation with thresholds.
- [x] Task 16.14.1.c.1: Emit size stats in build_state and stage audit.
- [x] Task 16.14.1.c.2: Define warning/abort thresholds in policy.
- [x] Task 16.14.1.d: Add compressed write path for large state.
- [x] Task 16.14.1.d.1: Use jsonl + zstd for large state snapshots.
- [x] Task 16.14.1.d.2: Ensure loader auto-detects compression by extension.
- [x] Task 16.14.1.e: Add ledger integration for index_state.
- [x] Task 16.14.1.e.1: Store ordering ledger hash in index_state metadata.
- [x] Task 16.14.1.f: Add full snapshot after N deltas to cap chain length.
- [x] Task 16.14.1.f.1: Add rolling snapshot cadence (configurable N).

Tests:
- [ ] `tests/indexing/artifacts/index-state-skip-write.test.js` (perf lane)

### Subphase 16.14.2 -- File Meta
Parallel: Can run alongside 16.14.1/16.14.3 with clear ownership.
Docs/specs to update: `docs/perf/index-state-file-meta.md`, `docs/specs/metadata-schema-v2.md`, `docs/specs/symbol-artifacts-and-pipeline.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeIndexState)`, `src/index/build/artifacts/file-meta.js (anchor: buildFileMeta)`, `src/index/build/postings.js (anchor: buildMinhash)`, `src/shared/artifact-io/loaders.js (anchor: loadMinhashSignatures)`
Tasks:
- [x] Task 16.14.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.14.2.doc.1: Define columnar schema fields and binary layout.
- [x] Task 16.14.2.doc.2: Document fallback behavior and max-bytes thresholds.
- [x] Task 16.14.2.a: Default to binary columnar for large repos.
- [x] Task 16.14.2.a.1: Add size estimator to choose columnar vs JSONL.
- [x] Task 16.14.2.a.2: Emit columnar meta with row counts and checksums.
- [x] Task 16.14.2.b: Add JSONL fallback when columnar exceeds cap.
- [x] Task 16.14.2.b.1: Detect oversize columnar output and re-run JSONL path.
- [x] Task 16.14.2.b.2: Ensure fallback removes columnar outputs to avoid stale reads.
- [x] Task 16.14.2.c: Stream file_meta into sqlite build.
- [x] Task 16.14.2.c.1: Allow sqlite builder to accept async iterator of rows.
- [x] Task 16.14.2.c.2: Add batch insert size config for file_meta ingest.
- [x] Task 16.14.2.d: Add reuse cache based on file hash list.
- [x] Task 16.14.2.d.1: Persist fingerprint (hash list) in meta extensions.
- [x] Task 16.14.2.d.2: Validate fingerprint before reuse and log reuse reason.
- [x] Task 16.14.2.e: Add file_meta validity checks.
- [x] Task 16.14.2.e.1: Validate required fields + row count parity.
- [x] Task 16.14.2.e.2: Detect stale columnar payload and fall back to JSONL.
- [x] Task 16.14.2.f: Add MAX_JSON_BYTES guard to force sharding for large columnar outputs.
- [x] Task 16.14.2.f.1: Ensure loader uses JSONL when columnar exceeds cap.

Tests:
- [ ] `tests/indexing/artifacts/file-meta-columnar-roundtrip.test.js` (perf lane)
- [ ] `tests/indexing/artifacts/file-meta-bench-contract.test.js` (perf lane) (new)

### Subphase 16.14.3 -- Minhash
Parallel: Can run alongside 16.14.1/16.14.2 with clear ownership.
Docs/specs to update: `docs/perf/index-state-file-meta.md`, `docs/specs/metadata-schema-v2.md`, `docs/specs/symbol-artifacts-and-pipeline.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeIndexState)`, `src/index/build/artifacts/file-meta.js (anchor: buildFileMeta)`, `src/index/build/postings.js (anchor: buildMinhash)`, `src/shared/artifact-io/loaders.js (anchor: loadMinhashSignatures)`
Tasks:
- [x] Task 16.14.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.14.3.doc.1: Document packed layout (endianness, alignment, row order).
- [x] Task 16.14.3.doc.2: Define skip behavior and cache invalidation rules.
- [x] Task 16.14.3.a: Implement SIMD-friendly packed minhash layout.
- [x] Task 16.14.3.a.1: Define fixed-width row structure with SIMD alignment.
- [x] Task 16.14.3.a.2: Add packer/unpacker utilities with schema version.
- [x] Task 16.14.3.b: Add packed consistency checks (checksum + count).
- [x] Task 16.14.3.b.1: Store checksum + row count in packed meta file.
- [x] Task 16.14.3.b.2: Reject packed reads on mismatch and fall back to JSONL.
- [x] Task 16.14.3.c: Add streaming minhash emission to avoid full arrays.
- [x] Task 16.14.3.c.1: Emit minhash rows during postings build.
- [x] Task 16.14.3.c.2: Allow packer to stream from iterator.
- [x] Task 16.14.3.d: Add cleanup of stale packed artifacts when skipped.
- [x] Task 16.14.3.d.1: Remove packed files when minhash is intentionally skipped.
- [x] Task 16.14.3.e: Add skip guard for large corpora with telemetry.
- [x] Task 16.14.3.e.1: Add threshold config and stage audit output.
- [x] Task 16.14.3.f: Ensure packed minhash always invalidates when skipped in a build.
- [x] Task 16.14.3.f.1: Gate packed loads on manifest or current build signature.

Tests:
- [x] `tests/indexing/artifacts/minhash-packed-roundtrip.test.js` (perf lane)
- [x] `tests/indexing/artifacts/minhash-packed-bench-contract.test.js` (perf lane) (new)

### Subphase 16.14.4 -- Tests + Bench
Parallel: Run after 16.14.1–16.14.3.
Docs/specs to update: `docs/perf/index-state-file-meta.md`, `docs/specs/metadata-schema-v2.md`, `docs/specs/symbol-artifacts-and-pipeline.md`
Touchpoints: `src/index/build/build-state.js (anchor: writeIndexState)`, `src/index/build/artifacts/file-meta.js (anchor: buildFileMeta)`, `src/index/build/postings.js (anchor: buildMinhash)`, `src/shared/artifact-io/loaders.js (anchor: loadMinhashSignatures)`
Tasks:
- [x] Task 16.14.4.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.14.4.a: Add `file-meta-compare` benchmark baseline/current.
- [x] Task 16.14.4.b: Add `minhash-packed` benchmark baseline/current.
- [x] Task 16.14.4.c: Add regression test for file_meta reuse.
- [x] Task 16.14.4.d: Add docs update for index_state/file_meta/minhash.
- [x] Task 16.14.4.e: Add load-time benchmark for sqlite file_meta ingestion.

Tests:
- [x] `tests/indexing/artifacts/file-meta-bench-contract.test.js` (perf lane) (new)
- [x] `tests/indexing/artifacts/minhash-packed-bench-contract.test.js` (perf lane) (new)

### Subphase 16.14.5 -- Full Streaming File Meta + Minimal-Impl Hardening
Parallel: Run after 16.14.4; depends on 16.13.4 streaming loader work.
Docs/specs to update: `docs/perf/index-state-file-meta.md`, `docs/specs/metadata-schema-v2.md`, `docs/specs/artifact-io-pipeline.md`
Touchpoints: `src/index/build/artifacts/file-meta.js (anchor: buildFileMeta)`, `src/shared/artifact-io/loaders.js (anchor: loadJsonArrayArtifact)`, `src/storage/sqlite/build/from-artifacts.js (anchor: buildDatabaseFromArtifacts)`, `src/storage/sqlite/utils.js (anchor: loadIndex)`
Tasks:
- [x] Task 16.14.5.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.14.5.a: Implement full streaming file_meta loader that yields rows without materializing arrays.
- [x] Task 16.14.5.a.1: Use offsets index when available and fall back to JSONL streaming when columnar is too large.
- [x] Task 16.14.5.a.2: Add row-level validation during streaming and abort on invalid rows.
- [x] Task 16.14.5.b: Update sqlite build to accept streaming file_meta iterator with backpressure.
- [x] Task 16.14.5.b.1: Add batch sizing by bytes + rows to keep steady memory usage.
- [x] Task 16.14.5.c: Remove minimal optional-array fallback in loadIndex; default to streaming unless explicitly materialized.
- [x] Task 16.14.5.d: Stream file_meta + minhash ingest in sqlite builder (no Promise handoff).
- [x] Task 16.14.5.e: Add benchmark comparing streaming vs materialized file_meta load with delta line.
- [x] Task 16.14.5.f: Add regression test for streaming correctness vs materialized load.
- [x] Task 16.14.5.g: Add regression test for streaming memory cap under large file_meta.
- [x] Task 16.14.5.h: Add regression test for MAX_JSON_BYTES behavior with streaming columnar fallback.

Tests:
- [x] `tests/perf/indexing/artifacts/file-meta-streaming-roundtrip.test.js` (perf lane) (new)
- [x] `tests/perf/indexing/artifacts/file-meta-streaming-memory.test.js` (perf lane) (new)
- [x] `tests/perf/indexing/artifacts/file-meta-streaming-reuse.test.js` (perf lane) (new)

---

## Phase 16.6 -- Stage1 Postings Throughput

### Subphase 16.6.1 -- Token/Postings Core
Parallel: Must land before 16.6.2.
Docs/specs to update: `docs/specs/segmentation-perf.md`, `docs/specs/large-file-caps-strategy.md`, `docs/specs/spimi-spill.md`, `docs/perf/indexing-stage-audit.md`
Touchpoints: `src/index/build/postings.js (anchor: buildPostings)`, `src/index/build/tokenization.js (anchor: tokenizeFile)`, `src/index/build/indexer/steps/process-files.js (anchor: processFiles)`, `src/index/build/indexer/steps/postings.js (anchor: buildPostingsStep)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`
Tasks:
- [x] Task 16.6.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.6.1.a: Implement token ID canonicalization at tokenize time.
- [x] Task 16.6.1.a.1: Define deterministic token ID assignment (order-independent) and persist `token_vocab` mapping.
- [x] Task 16.6.1.a.2: Plumb token IDs through `chunk_meta` + postings (retain legacy string tokens as optional fallback).
- [x] Task 16.6.1.b: Replace substring chargrams with rolling hash generation.
- [x] Task 16.6.1.b.1: Use a 64-bit rolling hash for chargrams (no substring allocations) with fixed seed/salt.
- [x] Task 16.6.1.b.2: Record hash parameters in artifacts and update retrieval/SQLite to consume hashed chargrams.
- [x] Task 16.6.1.b.3: Provide compatibility fallback for legacy string-chargram artifacts.
- [x] Task 16.6.1.c: Implement compact chunk token representation.
- [x] Task 16.6.1.c.1: Add packed/varint token ID encoding for chunk tokens and update readers/validators.
- [x] Task 16.6.1.d: Add pooling for hot arrays in postings.
- [x] Task 16.6.1.d.1: Pool per-chunk frequency maps/arrays and reuse buffers across chunks.
- [x] Task 16.6.1.e: Validate determinism across new token pipelines.
- [x] Task 16.6.1.e.1: Add ordering hash for token/chargram vocab outputs and enforce via validation.
- [x] Task 16.6.1.f: Enforce stable vocab ordering artifact to prevent nondeterminism.
- [x] Task 16.6.1.f.1: Emit a dedicated vocab-order artifact with stable hash (token/phrase/chargram).
- [x] Task 16.6.1.g: Add max token length guard in rolling chargram flow.
- [x] Task 16.6.1.g.1: Apply max token-length guard even when precomputed chargrams are supplied.

Tests:
- [x] `tests/indexing/postings/token-id-canonicalization.test.js` (perf lane) (new)
- [x] `tests/indexing/postings/chargram-rolling-hash.test.js` (perf lane) (new)
- [x] `tests/indexing/postings/compact-token-roundtrip.test.js` (perf lane) (new)
- [x] `tests/indexing/postings/vocab-order-determinism.test.js` (perf lane) (new)

### Subphase 16.6.2 -- Backpressure + Concurrency
Parallel: Run after 16.6.1.
Docs/specs to update: `docs/specs/segmentation-perf.md`, `docs/specs/large-file-caps-strategy.md`, `docs/specs/spimi-spill.md`, `docs/perf/indexing-stage-audit.md`
Touchpoints: `src/index/build/postings.js (anchor: buildPostings)`, `src/index/build/tokenization.js (anchor: tokenizeFile)`, `src/index/build/indexer/steps/process-files.js (anchor: processFiles)`, `src/index/build/indexer/steps/postings.js (anchor: buildPostingsStep)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`
Tasks:
- [x] Task 16.6.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.6.2.a: Add bounded queue between tokenization and postings.
- [x] Task 16.6.2.a.1: Define chunk-queue limits (rows + bytes) and enforce ordering during async postings apply.
- [x] Task 16.6.2.a.2: Emit backpressure when postings queue reaches maxPending and surface wait time.
- [x] Task 16.6.2.b: Split CPU vs IO concurrency knobs for Stage1.
- [x] Task 16.6.2.b.1: Add Stage1 postings concurrency + pending limit config keys.
- [x] Task 16.6.2.b.2: Add Stage1 tokenize concurrency + pending limit config keys (worker pool or CPU queue).
- [x] Task 16.6.2.c: Add scheduler integration hooks for Stage1.
- [x] Task 16.6.2.c.1: Add scheduler queue for postings apply with CPU+memory tokens.
- [x] Task 16.6.2.c.2: Route tokenization worker jobs through scheduler/proc queue.
- [x] Task 16.6.2.d: Add memory-based throttling in postings build.
- [x] Task 16.6.2.d.1: Implement heap-pressure throttling that reduces postings concurrency and queue depth.
- [x] Task 16.6.2.e: Add metrics for queue depth and backpressure events.
- [x] Task 16.6.2.e.1: Record queue depth high-water + backpressure wait in build_state/metrics.

Tests:
- [x] `tests/indexing/postings/backpressure-queue.test.js` (perf lane) (new)
- [x] `tests/indexing/postings/postings-queue-metrics.test.js` (perf lane) (new)

### Subphase 16.6.3 -- Tests + Bench
Parallel: Run after 16.6.1/16.6.2.
Docs/specs to update: `docs/specs/segmentation-perf.md`, `docs/specs/large-file-caps-strategy.md`, `docs/specs/spimi-spill.md`, `docs/perf/indexing-stage-audit.md`
Touchpoints: `src/index/build/postings.js (anchor: buildPostings)`, `src/index/build/tokenization.js (anchor: tokenizeFile)`, `src/index/build/indexer/steps/process-files.js (anchor: processFiles)`, `src/index/build/indexer/steps/postings.js (anchor: buildPostingsStep)`, `src/index/build/artifacts/chunk-meta.js (anchor: writeChunkMeta)`
Tasks:
- [x] Task 16.6.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.6.3.a: Implement `postings-real` benchmark baseline/current.
- [x] Task 16.6.3.a.1: Define a fixed fixture corpus for `postings-real` (size + source documented).
- [x] Task 16.6.3.a.2: Add `tools/bench/index/postings-real.js` with stable baseline/current schema + Stage1 config.
- [x] Task 16.6.3.b: Add chargram throughput benchmark.
- [x] Task 16.6.3.b.1: Extend `tools/bench/index/chargram-postings.js` to cover rolling-hash path + baseline/current compare.
- [x] Task 16.6.3.b.2: Add contract test for chargram benchmark output format.
- [x] Task 16.6.3.c: Add heap plateau regression test.
- [x] Task 16.6.3.c.1: Promote `postings-heap-plateau` to perf lane and cover Stage1 end-to-end.
- [x] Task 16.6.3.c.2: Assert plateau after postings build completes + pool cleanup.
- [x] Task 16.6.3.d: Add determinism regression test for chunk_meta.
- [x] Task 16.6.3.d.1: Run Stage1 twice with different concurrency and compare `chunk_meta.json`.
- [x] Task 16.6.3.d.2: Compare stable vocab ordering artifact (from 16.6.1.f) between runs.
- [x] Task 16.6.3.e: Add documentation update for Stage1 changes.
- [x] Task 16.6.3.e.1: Document bench usage + perf lane coverage for Stage1 changes.
- [x] Task 16.6.3.f: Add memory budget enforcement regression test for Stage1.
- [x] Task 16.6.3.f.1: Use tiny memory budget to trigger backpressure/spill and assert metrics from 16.6.2.

Tests:
- [x] `tests/indexing/postings/postings-real-bench-contract.test.js` (perf lane) (new)
- [x] `tests/indexing/postings/chargram-bench-contract.test.js` (perf lane) (new)
- [x] `tests/perf/indexing/postings/postings-heap-plateau.test.js` (perf lane) (existing)
- [x] `tests/indexing/postings/chunk-meta-determinism.test.js` (perf lane) (new)
- [x] `tests/perf/indexing/postings/stage1-memory-budget.test.js` (perf lane) (new)

---

## Phase 16.7 -- Stage2 Relations + Filter Index

### Subphase 16.7.1 -- Relations Core
Parallel: Can run alongside 16.7.2 with clear file ownership.
Docs/specs to update: `docs/specs/symbol-artifacts-and-pipeline.md`, `docs/specs/map-artifact.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/deterministic-ordering.md`
Touchpoints: `src/index/build/indexer/steps/relations.js (anchor: buildRelations)`, `src/index/build/artifacts/filter-index.js (anchor: writeFilterIndex)`, `src/index/build/artifacts/writers/repo-map.js (anchor: writeRepoMap)`, `src/shared/hash.js (anchor: hash64)`
Tasks:
- [x] Task 16.7.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.7.1.a: Implement typed edge storage during build.
- [ ] Task 16.7.1.a.1: Define edge schema version + canonical field ordering in spec.
- [x] Task 16.7.1.b: Implement two-phase streaming relations build.
- [x] Task 16.7.1.b.1: Define spill file format + merge contract (ordering + dedupe).
- [x] Task 16.7.1.b.2: Add staging directory for spill outputs and atomic finalization.
- [x] Task 16.7.1.b.3: Eliminate in-memory Graphology relation graphs; build `graph_relations` from streamed edges during write phase.
- [x] Task 16.7.1.b.4: Preserve `graph_relations` ordering hash compatibility with `src/index/validate.js` (row serialization must match).
- [x] Task 16.7.1.c: Add deterministic ordering without global sort.
- [x] Task 16.7.1.c.1: Deterministic ordering for spill merge without global sort.
- [x] Task 16.7.1.c.2: Preserve stable JSON key ordering for `graph_relations` rows and node fields to prevent ordering hash drift.
- [ ] Task 16.7.1.d: Add edge dedupe via compact hashes.
- [ ] Task 16.7.1.d.1: Add collision strategy (hash + fingerprint or secondary compare).
- [x] Task 16.7.1.d.2: Add max edges per file/repo guardrails.
- [x] Task 16.7.1.d.3: Ensure dedupe/collision handling works on a streamed edge merge (no full materialization).
- [x] Task 16.7.1.e: Add spill thresholds by bytes.
- [ ] Task 16.7.1.e.1: Add memory budget enforcement + backpressure integration for Stage2.
- [ ] Task 16.7.1.f: Add fast reject filter for excluded files before edge creation.
- [ ] Task 16.7.1.g: Add scheduler queue integration for relations IO/CPU.

Tests:
- [x] `tests/perf/indexing/relations/relations-streaming-build.test.js` (perf lane) (new)

### Subphase 16.7.2 -- Filter Index + Repo Map
Parallel: Can run alongside 16.7.1 with clear file ownership.
Docs/specs to update: `docs/specs/symbol-artifacts-and-pipeline.md`, `docs/specs/map-artifact.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/deterministic-ordering.md`
Touchpoints: `src/index/build/indexer/steps/relations.js (anchor: buildRelations)`, `src/index/build/artifacts/filter-index.js (anchor: writeFilterIndex)`, `src/index/build/artifacts/writers/repo-map.js (anchor: writeRepoMap)`, `src/shared/hash.js (anchor: hash64)`
Tasks:
- [x] Task 16.7.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.7.2.a: Add per-file bitmaps in filter index.
- [ ] Task 16.7.2.a.1: Specify bitmap format (sparse/dense) + versioning.
- [x] Task 16.7.2.b: Add repo map batching + safer writes (defer delta compression).
- [ ] Task 16.7.2.b.1: Define delta compression header/version and fallback handling.
- [ ] Task 16.7.2.c: Add concurrency split for relations IO.
- [ ] Task 16.7.2.c.1: Tie IO split to scheduler queues + memory budget.
- [x] Task 16.7.2.d: Add filter index size telemetry.
- [ ] Task 16.7.2.d.1: Record size + compression ratio in build_state/metrics.
- [x] Task 16.7.2.e: Add fallback to previous filter index on failure.
- [ ] Task 16.7.2.e.1: Validate new filter index before swap; keep previous on validation failure.
- [x] Task 16.7.2.f: Add atomic staging + swap for filter index and repo map outputs.
- [x] Task 16.7.2.f.1: Update piece manifest only after successful swap; retain previous pieces on failure.

Tests:
- [x] `tests/perf/indexing/filter-index/bitmap-roundtrip.test.js` (perf lane) (new)

### Subphase 16.7.3 -- Tests + Bench
Parallel: Run after 16.7.1/16.7.2.
Docs/specs to update: `docs/specs/symbol-artifacts-and-pipeline.md`, `docs/specs/map-artifact.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/deterministic-ordering.md`
Touchpoints: `src/index/build/indexer/steps/relations.js (anchor: buildRelations)`, `src/index/build/artifacts/filter-index.js (anchor: writeFilterIndex)`, `src/index/build/artifacts/writers/repo-map.js (anchor: writeRepoMap)`, `src/shared/hash.js (anchor: hash64)`
Tasks:
- [x] Task 16.7.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.7.3.a: Add `filter-index-build` benchmark baseline/current.
- [x] Task 16.7.3.a.1: Add `relations-build` benchmark baseline/current.
- [x] Task 16.7.3.a.2: Add `repo-map-compress` benchmark baseline/current.
- [x] Task 16.7.3.b: Add relations memory regression test.
- [x] Task 16.7.3.b.1: Assert memory budget throttling + metrics for relations build.
- [x] Task 16.7.3.c: Add determinism test for relations output.
- [ ] Task 16.7.3.c.1: Run with differing concurrency and compare outputs byte-for-byte.
- [ ] Task 16.7.3.d: Add repo map delta compression test.
- [ ] Task 16.7.3.d.1: Roundtrip delta compression with versioned header.
- [x] Task 16.7.3.e: Add docs update for Stage2 changes.
- [x] Task 16.7.3.e.1: Document staging/atomic swap + fallback behavior.
- [ ] Task 16.7.3.f: Add relations atomicity regression test for partial output rollback.
- [ ] Task 16.7.3.g: Add collision regression test for hash dedupe.
- [ ] Task 16.7.3.h: Update script inventory + commands docs for new bench scripts.
- [ ] Task 16.7.3.i: Update any tests that directly read `graph_relations.json`/filter index files to load via artifact loaders (shards/legacy compatible).

Tests:
- [ ] `tests/indexing/relations/relations-determinism-bench-contract.test.js` (perf lane) (new)
- [ ] `tests/indexing/relations/relations-collision-guard.test.js` (perf lane) (new)
- [x] `tests/indexing/relations/relations-memory-budget.test.js` (perf lane) (new)
- [ ] `tests/indexing/filter-index/filter-index-atomic-swap.test.js` (perf lane) (new)
- [x] `tests/indexing/filter-index/filter-index-metrics.test.js` (perf lane) (new)
- [x] `tests/indexing/repo-map/repo-map-delta-roundtrip.test.js` (perf lane) (new)

---

## Phase 16.8 -- Embeddings Pipeline Throughput

Implementation note: Stage3 embeddings pipeline currently lives under `tools/build/embeddings/*`; avoid introducing a parallel pipeline under `src/index/build/embeddings/*`.

### Subphase 16.8.1 -- Cache + Keys
Parallel: Can run alongside 16.8.2 with clear file ownership.
Docs/specs to update: `docs/specs/embeddings-cache.md`, `docs/specs/runtime-envelope.md`, `docs/perf/indexing-stage-audit.md`
Touchpoints: `tools/build/embeddings/runner.js (anchor: runBuildEmbeddingsWithConfig)`, `tools/build/embeddings/cache.js (anchor: buildCacheKey)`, `src/shared/embedding-identity.js (anchor: buildEmbeddingIdentity)`, `src/shared/cache-key.js (anchor: buildCacheKey)`, `tools/build/embeddings/scheduler.js (anchor: createEmbeddingsScheduler)`
Tasks:
- [x] Task 16.8.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.8.1.a: Cache identity must be derived from `src/shared/embedding-identity.js` only; audit coverage for provider/modelId/dims/normalize/quantization/pooling/truncation/stub.
- [x] Task 16.8.1.b: Keep cache fast-reject O(1) via `cache.index.json` metadata (identityKey/hash/chunkSignature) without reading shard payloads; add telemetry + regression test.
- [x] Task 16.8.1.c: Enforce per-mode cache isolation (mode always in key); add regression test for cross-mode collision prevention.
- [x] Task 16.8.1.d: Fail-closed cache validity: reject on dims/normalize mismatch, incomplete vectors, or signature/hash mismatch; never partially apply an invalid entry.
- [x] Task 16.8.1.e: Telemetry: standardize cacheStats fields and ensure they land in `index_state.embeddings.cacheStats` + metrics output.
- [x] Task 16.8.1.f: Pruning safety: verify prune plan is safe under concurrent builds (append-only shards, atomic index updates); update docs and tests.

Tests:
- [x] `tests/indexing/embeddings/embeddings-cache-identity.test.js` (perf lane)
- [x] `tests/indexing/embeddings/embeddings-cache-invalidation.test.js` (perf lane)
- [x] `tests/indexing/embeddings/cache-index-append-only.test.js` (perf lane)
- [x] `tests/indexing/embeddings/embeddings-cache-fast-reject.test.js` (perf lane) (new)

### Subphase 16.8.2 -- IO + Batching
Parallel: Can run alongside 16.8.1 with clear file ownership.
Docs/specs to update: `docs/specs/embeddings-cache.md`, `docs/specs/runtime-envelope.md`, `docs/perf/indexing-stage-audit.md`
Touchpoints: `tools/build/embeddings/runner.js (anchor: runBuildEmbeddingsWithConfig)`, `tools/build/embeddings/pipeline.js (anchor: createFileEmbeddingsProcessor)`, `tools/build/embeddings/batch.js (anchor: flushEmbeddingsBatch)`, `tools/build/embeddings/scheduler.js (anchor: createEmbeddingsScheduler)`, `src/shared/embedding-batch.js (anchor: resolveAutoEmbeddingBatchSize)`
Tasks:
- [x] Task 16.8.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.8.2.a: Implement writer pipeline as a bounded queue (all writes go through the IO scheduler; no bypass paths).
- [x] Task 16.8.2.b: Add IO backpressure to compute path (when writer queue is saturated, compute awaits).
- [x] Task 16.8.2.c: Batch-size auto-tuning: centralize in `src/shared/embedding-batch.js`, plumb to Stage3, and document provider limits.
- [x] Task 16.8.2.d: Vector pre-allocation + pooling for hot paths (typed arrays); add guardrails against cross-file mutation.
- [x] Task 16.8.2.e: Enforce chunk-stable batching (deterministic chunk ordering independent of concurrency and batch size).
- [x] Task 16.8.2.f: Add CPU-only batch sizing tuned by available threads (stub/onnx paths).

Tests:
- [x] `tests/indexing/embeddings/embedding-queue.test.js` (perf lane)
- [x] `tests/indexing/embeddings/embedding-batch-autotune.test.js` (perf lane)
- [x] `tests/indexing/embeddings/embedding-batcher-flush-reentrancy.test.js` (perf lane)
- [x] `tests/indexing/embeddings/embeddings-writer-backpressure.test.js` (perf lane) (new)

### Subphase 16.8.3 -- Tests + Bench
Parallel: Run after 16.8.1/16.8.2.
Docs/specs to update: `docs/specs/embeddings-cache.md`, `docs/specs/runtime-envelope.md`, `docs/perf/indexing-stage-audit.md`
Touchpoints: `tools/build/embeddings/runner.js (anchor: runBuildEmbeddingsWithConfig)`, `tools/build/embeddings/batch.js (anchor: flushEmbeddingsBatch)`, `tools/bench/cache-hit-rate.js`, `src/shared/embedding-utils.js (anchor: mergeEmbeddingVectors)`, `src/shared/concurrency.js (anchor: runWithQueue)`
Tasks:
- [x] Task 16.8.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.8.3.a: Extend `cache-hit-rate` bench to include writer queue + backpressure.
- [x] Task 16.8.3.b: Add throughput benchmark for batch-size tuning across providers (stub/onnx/openai).
- [x] Task 16.8.3.c: Add regression test for embedding output determinism (same inputs produce identical vectors + manifests).
- [x] Task 16.8.3.d: Add docs update for embeddings pipeline (include queue/backpressure knobs + telemetry fields).
- [x] Task 16.8.3.e: Add memory regression test for embeddings (heap plateau under backlog).

Tests:
- [x] `tests/shared/cache/cache-hit-rate-contract.test.js` (perf lane)
- [x] `tests/indexing/embeddings/embedding-batch-throughput.test.js` (perf lane)
- [x] `tests/indexing/embeddings/embedding-normalization-consistency.test.js` (perf lane)
- [x] `tests/indexing/embeddings/embeddings-determinism.test.js` (perf lane) (new)
- [x] `tests/indexing/embeddings/embeddings-memory-plateau.test.js` (perf lane) (new)

---

## Phase 16.9 -- SQLite Build Throughput

Implementation note: SQLite build code lives under `src/storage/sqlite/build/*` and is invoked by Stage4 via `src/storage/sqlite/build/runner.js`. Keep build behavior atomic and deterministic (build to temp, validate, then swap), and avoid introducing a second competing build path.

### Subphase 16.9.1 -- Bulk Load Core
Parallel: Must land before 16.9.2.
Docs/specs to update: `docs/perf/sqlite-build.md`, `docs/specs/artifact-schemas.md`, `docs/perf/index-artifact-pipelines.md`
Touchpoints: `src/storage/sqlite/build/runner.js (anchor: runBuildSqliteIndexWithConfig)`, `src/storage/sqlite/build/output-paths.js (anchor: resolveOutputPaths)`, `src/storage/sqlite/build/from-artifacts.js (anchor: buildDatabaseFromArtifacts)`, `src/storage/sqlite/build/from-bundles.js (anchor: buildDatabaseFromBundles)`, `src/storage/sqlite/build/statements.js (anchor: createInsertStatements)`, `src/storage/sqlite/build/pragmas.js (anchor: applyBuildPragmas)`, `src/storage/sqlite/utils.js (anchor: resolveSqliteBatchSize)`, `src/storage/sqlite/schema.js (anchor: CREATE_TABLES_BASE_SQL)`
Tasks:
- [x] Task 16.9.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.9.1.a: Ensure BOTH artifact builds and bundle builds use a consistent load-first flow (schema base, ingest, then indexes/optimize) and share common ingestion helpers where possible.
- [x] Task 16.9.1.b: Add a top-level transaction boundary for full builds (one `BEGIN`/`COMMIT` spanning all table loads + index creation); ensure no accidental autocommit islands (including `db.exec()` multi-statement inserts).
- [x] Task 16.9.1.c: Split statements for full rebuild vs incremental update: full rebuild must prefer `INSERT` (fail-fast on duplicates) while incremental update may use `INSERT OR REPLACE` where needed.
- [x] Task 16.9.1.d: Reduce prepare/parse overhead: prepare insert statements once per DB handle and reuse across all artifact shards (no per-shard `db.prepare` churn).
- [x] Task 16.9.1.e: Batch sizing: make batch size decisions observable in telemetry (input bytes, chosen batch size, rows/sec per table) and ensure overrides are consistently plumbed through Stage4 runner.
- [x] Task 16.9.1.f: Evaluate multi-row INSERT vs statement loops for heavy tables (token/phrase/chargram postings); pick the faster path per benchmark and document the decision in `docs/perf/sqlite-build.md`.

Tests:
- [x] `tests/storage/sqlite/sqlite-build-pragmas-dynamic.test.js` (perf lane)
- [x] `tests/storage/sqlite/sqlite-build-pragmas-restore.test.js` (perf lane)
- [x] `tests/storage/sqlite/sqlite-build-full-transaction.test.js` (perf lane) (new)

### Subphase 16.9.2 -- FTS/Index Build
Parallel: Run after 16.9.1.
Docs/specs to update: `docs/perf/sqlite-build.md`, `docs/specs/artifact-schemas.md`, `docs/perf/index-artifact-pipelines.md`
Touchpoints: `src/storage/sqlite/schema.js (anchor: CREATE_INDEXES_SQL)`, `src/storage/sqlite/schema.js (anchor: CREATE_TABLES_BASE_SQL)`, `src/storage/sqlite/build/pragmas.js (anchor: optimizeBuildDatabase)`, `src/storage/sqlite/build/validate.js (anchor: validateSqliteDatabase)`, `src/retrieval/sqlite-helpers.js (anchor: rankSqliteFts)`
Tasks:
- [x] Task 16.9.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.9.2.a: FTS strategy: make `chunks_fts` contentless (`content=''`) to avoid duplicating chunk text; confirm runtime does not depend on reading FTS-stored content (ranking-only is OK).
- [x] Task 16.9.2.b: Add explicit FTS post-load optimization (`INSERT INTO chunks_fts(chunks_fts) VALUES('optimize')`) and include it in Stage4 telemetry.
- [x] Task 16.9.2.c: Index plan: audit `CREATE_INDEXES_SQL` for redundant indexes (especially those subsumed by PRIMARY KEY ordering); remove/adjust indexes based on query plans + benchmarks and update tests accordingly.
- [x] Task 16.9.2.d: Row-shape optimizations: evaluate `WITHOUT ROWID` for postings/vocab tables with composite PRIMARY KEYs; document which tables change and why (size vs build time vs query plan effects).
- [x] Task 16.9.2.e: Artifact read pipeline: keep reads streaming and bounded (no full materialization of large JSONL shards); add guardrails for maxBytes enforcement on all artifact readers used by Stage4.
- [x] Task 16.9.2.f: Post-build sequencing: run index creation, then `PRAGMA optimize`, then `ANALYZE` (gated by size), and finish with an explicit WAL checkpoint/cleanup step when building a new DB.

Tests:
- [x] `tests/storage/sqlite/sqlite-build-indexes.test.js` (perf lane)
- [x] `tests/storage/sqlite/sqlite-fts-contentless-schema.test.js` (perf lane) (new)

### Subphase 16.9.3 -- Tests + Bench
Parallel: Run after 16.9.1/16.9.2.
Docs/specs to update: `docs/perf/sqlite-build.md`, `docs/specs/artifact-schemas.md`, `docs/perf/index-artifact-pipelines.md`
Touchpoints: `tools/bench/sqlite/build-from-artifacts.js (anchors: parseArgs, runBuild)`, `src/storage/sqlite/build/from-artifacts.js (anchors: loadIndexPieces, buildDatabaseFromArtifacts)`, `src/storage/sqlite/build/statements.js (anchor: createInsertStatements)`, `src/storage/sqlite/build/pragmas.js (anchors: applyBuildPragmas, optimizeBuildDatabase)`, `src/storage/sqlite/build/validate.js (anchor: validateSqliteDatabase)`, `src/storage/sqlite/schema.js (anchors: CREATE_TABLES_BASE_SQL, CREATE_INDEXES_SQL)`
Tasks:
- [x] Task 16.9.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.9.3.a: Extend `tools/bench/sqlite/build-from-artifacts.js` with `--index-dir <dir>` so the bench can run against a real Stage2/Stage3 index output (when absent, keep the synthetic artifact generator path).
- [x] Task 16.9.3.b: Add a bench switch for statement strategy (prepared reuse vs prepare-per-shard vs multi-row exec) and report per-table ingestion stats (rows, rows/sec, prepare counts) so 16.9.1 decisions stay measurable.
- [x] Task 16.9.3.c: Add a row-count contract test that derives expected counts from artifacts (chunk_meta totals, postings meta, dense/minhash presence) and asserts per-mode table counts match (including FTS).
- [x] Task 16.9.3.d: Add regression test enforcing prepared statement reuse (no `db.prepare()` churn per shard) using ingestion stats or explicit instrumentation.
- [x] Task 16.9.3.e: Add post-build validation "fast path" test for `validateMode=auto` (quick_check for large DBs; integrity_check for small DBs) while still enforcing expected row-count guards.
- [x] Task 16.9.3.f: Add docs update for the Stage4 build/validate flow (transaction boundary, validate modes, per-table stats, and bench commands).

Tests:
- [x] `tests/storage/sqlite/sqlite-build-bench-contract.test.js` (perf lane) (new)
- [x] `tests/storage/sqlite/sqlite-build-rowcount-contract.test.js` (perf lane) (new)
- [x] `tests/storage/sqlite/sqlite-build-prepared-statement-reuse.test.js` (perf lane) (new)
- [x] `tests/storage/sqlite/sqlite-build-validate-auto-fast-path.test.js` (perf lane) (new)

---

## Phase 16.10 -- VFS Manifest Throughput

### Subphase 16.10.1 -- Segment IO
Parallel: Can run alongside 16.10.2 with clear file ownership.
Docs/specs to update: `docs/specs/vfs-manifest-artifact.md`, `docs/specs/vfs-io-batching.md`, `docs/specs/vfs-index.md`, `docs/specs/vfs-segment-hash-cache.md`
Touchpoints: `src/index/tooling/vfs.js (anchors: buildToolingVirtualDocuments, loadVfsManifestRowByPath, loadVfsManifestBloomFilter, loadVfsManifestIndex, readVfsManifestRowAtOffset)`, `src/index/build/artifacts/writers/vfs-manifest.js (anchor: enqueueVfsManifestArtifacts)`, `src/index/tooling/vfs-hash-routing.js (anchor: buildVfsRoutingToken)`, `src/integrations/tooling/providers/lsp.js (anchor: ensureVirtualFilesBatch)`, `src/index/segments/jsx.js (anchor: segmentJsx)`, `src/index/segments.js (anchor: chunkSegments)`
Tasks:
- [x] Task 16.10.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.10.1.a: Harden the VFS manifest lookup fast-path (bloom -> vfsidx -> offset read); add telemetry for scan fallbacks and negative-cache hit rates.
- [x] Task 16.10.1.b: Add batched row loads that reuse a single file handle and pooled buffers for offset reads (critical for per-language tooling batching without N open/close churn).
- [x] Task 16.10.1.c: Fix `[tooling] Invalid virtualRange ...; skipping target.` by making chunk-to-virtual range mapping segment-safe (no full-container AST reuse for sliced segments), and add a degraded fallback target (whole-container) so we never silently drop work.
- [x] Task 16.10.1.d: Ensure VFS routing supports per-language batching deterministically (stable `languageId`/`effectiveExt` on rows, stable `virtualPath` and routing token composition across runs).
- [x] Task 16.10.1.e: Decide and document whether extracted-prose participates in VFS routing/manifests; if yes, add coverage and ensure per-language bucketing remains deterministic.

Tests:
- [x] `tests/tooling/vfs/vfs-bloom-negative-lookup.test.js` (perf lane)
- [x] `tests/tooling/vfs/vfs-index-lookup.test.js` (perf lane)
- [x] `tests/tooling/vfs/vfs-io-batch-consistency.test.js` (perf lane)
- [x] `tests/tooling/vfs/vfs-maps-segment-offsets.test.js` (perf lane)
- [x] `tests/tooling/vfs/vfs-invalid-virtual-range-regression.test.js` (perf lane) (new)

### Subphase 16.10.2 -- Merge/Compaction
Parallel: Can run alongside 16.10.1 with clear file ownership.
Docs/specs to update: `docs/specs/vfs-manifest-artifact.md`, `docs/specs/vfs-io-batching.md`, `docs/specs/vfs-index.md`, `docs/specs/vfs-segment-hash-cache.md`
Touchpoints: `src/index/build/vfs-manifest-collector.js (anchor: createVfsManifestCollector)`, `src/index/build/artifacts/writers/vfs-manifest.js (anchor: enqueueVfsManifestArtifacts)`, `src/shared/merge.js (anchor: mergeSortedRuns)`, `src/index/tooling/vfs-index.js (anchor: buildVfsManifestSortKey)`
Tasks:
- [x] Task 16.10.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [x] Task 16.10.2.a: Audit spill and compaction thresholds (bytes and record-count) and ensure they remain bounded-memory under worst-case VFS density.
- [x] Task 16.10.2.b: Ensure merge/compaction is deterministic under concurrency (stable compare keys, stable trim/drop policy); add telemetry for merge fan-in and spill frequency.
- [x] Task 16.10.2.c: Ensure manifest + vfsidx + bloom are swapped atomically as a unit; on failure keep the previous artifact set and clean partial outputs.
- [x] Task 16.10.2.d: Define and implement an incremental rebuild story (when allowed) keyed by CDC/segmentUid/docHash so rebuilds avoid full rewrites and reduce IO churn.

Tests:
- [x] `tests/tooling/vfs/vfs-collector-cleanup-on-error.test.js` (perf lane)
- [x] `tests/tooling/vfs/vfs-merge-heap-deterministic.test.js` (perf lane)
- [x] `tests/indexing/vfs/merge-core-integration.test.js` (perf lane)
- [x] `tests/indexing/vfs/vfs-manifest-row-trimming.test.js` (perf lane)
- [x] `tests/indexing/vfs/vfs-compaction-atomic-swap.test.js` (perf lane) (new)

### Subphase 16.10.3 -- Tests + Bench
Parallel: Run after 16.10.1/16.10.2.
Docs/specs to update: `docs/specs/vfs-manifest-artifact.md`, `docs/specs/vfs-io-batching.md`, `docs/specs/vfs-index.md`, `docs/specs/vfs-segment-hash-cache.md`
Touchpoints: `tools/bench/vfs/parallel-manifest-build.js`, `tools/bench/vfs/merge-runs-heap.js`, `tools/bench/vfs/vfsidx-lookup.js`, `tools/bench/vfs/hash-routing-lookup.js`, `tools/bench/vfs/bloom-negative-lookup.js`, `tools/bench/micro/utils.js (anchors: summarizeDurations, formatStats)`, `src/index/tooling/vfs.js (anchors: buildVfsManifestRowsForFile, createVfsColdStartCache, loadVfsManifestRowByPath, loadVfsManifestIndex)`, `src/index/build/artifacts/writers/vfs-manifest.js (anchor: enqueueVfsManifestArtifacts)`
Tasks:
- [ ] Task 16.10.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.10.3.a: Add VFS bench contract coverage for manifest build + merge paths using relative invariants (e.g., concurrency scaling in `parallel-manifest-build`, heap merge dominating linear merge at high run-count) rather than hard machine-specific thresholds.
- [ ] Task 16.10.3.b: Add VFS lookup bench contract coverage validating fast-path behavior (bloom/vfsidx negative lookups must avoid full scans; hash-routing lookups must match vfs manifest routing; surface fallbacks explicitly in JSON output).
- [ ] Task 16.10.3.c: Add memory regression test for cold-start cache + index load (repeat load/lookup loops must plateau; caches must honor maxBytes/maxAge and not grow unbounded under repeated queries).
- [ ] Task 16.10.3.d: Add docs update for VFS manifest and per-language batching expectations (include "invalid virtualRange" behavior and how it is surfaced/guarded).

Tests:
- [ ] `tests/indexing/vfs/vfs-manifest-streaming.test.js` (perf lane) (existing)
- [ ] `tests/tooling/vfs/vfs-cold-start-cache.test.js` (perf lane) (existing)
- [ ] `tests/tooling/vfs/vfs-parallel-manifest-deterministic.test.js` (perf lane) (existing)
- [ ] `tests/perf/vfs-bench-contract.test.js` (perf lane) (new)
- [ ] `tests/perf/vfs-memory-plateau.test.js` (perf lane) (new)

---

## Phase 16.11 -- Tree-sitter Throughput

### Subphase 16.11.1 -- Grammar/Parser Caching
Parallel: Can run alongside 16.11.2 with clear file ownership.
Docs/specs to update: `docs/specs/segmentation-perf.md`, `docs/specs/large-file-caps-strategy.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/tree-sitter-runtime.md` (new)
Touchpoints: `src/lang/tree-sitter/runtime.js (anchors: initTreeSitterWasm, preloadTreeSitterLanguages, pruneTreeSitterLanguages, getTreeSitterParser)`, `src/lang/tree-sitter/state.js (anchor: treeSitterState)`, `src/lang/tree-sitter/chunking.js (anchors: buildTreeSitterChunks, buildTreeSitterChunksAsync, resolveChunkCacheKey)`, `src/lang/tree-sitter/worker.js (anchors: getTreeSitterWorkerPool, sanitizeTreeSitterOptions)`, `src/index/build/indexer/steps/process-files/tree-sitter.js (anchor: resolveTreeSitterPreloadPlan)`
Tasks:
- [ ] Task 16.11.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.11.1.a: Audit and harden WASM grammar caching (alias dedupe, in-flight load dedupe, LRU eviction) and ensure `maxLoadedLanguages` caps behave predictably on main thread vs worker threads.
- [ ] Task 16.11.1.b: Document and lock in the single shared `Parser` strategy (avoid per-language parser pools by default due to memory/Windows OOM risk); if we ever add pooling it must be explicitly opt-in with guardrails.
- [ ] Task 16.11.1.c: Ensure preload planning stays deterministic and bounded (stable order, stable caps) and avoid redundant preloads across shards/batches.
- [ ] Task 16.11.1.d: Harden grammar load fallback (path load vs bytes load) and add telemetry for load mode + failures.
- [ ] Task 16.11.1.e: Expose tree-sitter cache metrics in the stage audit (wasm loads/evictions, parser activations, query cache hits, chunk cache hits, worker fallbacks).

Tests:
- [ ] `tests/indexing/tree-sitter/tree-sitter-runtime.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-wasm-path-cache.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-preload-limited.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-preload-order-deterministic.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-eviction-determinism.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-query-precompile-cache.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-worker-prune-bounds.test.js` (perf lane)

### Subphase 16.11.2 -- Parse Scheduling
Parallel: Can run alongside 16.11.1 with clear file ownership.
Docs/specs to update: `docs/specs/segmentation-perf.md`, `docs/specs/large-file-caps-strategy.md`, `docs/perf/indexing-stage-audit.md`, `docs/specs/concurrency-abort-runwithqueue.md`
Touchpoints: `src/index/build/indexer/steps/process-files.js (anchor: processFiles)`, `src/index/build/indexer/steps/process-files/tree-sitter.js (anchors: applyTreeSitterBatching, buildTreeSitterEntryBatches, preloadTreeSitterBatch, sortEntriesByTreeSitterBatchKey)`, `src/index/build/file-processor/cpu/chunking.js (anchor: chunkSegmentsWithTreeSitterPasses)`, `src/lang/tree-sitter/chunking.js (anchors: buildTreeSitterChunksAsync, ensureChunkCache)`, `src/lang/tree-sitter/worker.js (anchor: getTreeSitterWorkerPool)`
Tasks:
- [ ] Task 16.11.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.11.2.a: Make batch-by-language scheduling explicitly deadlock-safe with ordered output/backpressure (no uncontrolled reordering that can pin queue reservations); document the invariants.
- [ ] Task 16.11.2.b: Strengthen batch execution: reset/prune/preload strategy per batch, metrics for batch sizes, deferrals, and parser activation churn.
- [ ] Task 16.11.2.c: Tighten incremental reuse via chunk cache (cache key, option invalidation, max entries) so unchanged files do not re-parse, while bounding memory.
- [ ] Task 16.11.2.d: Ensure parse tree memory stays bounded (explicit `Tree.delete()`, `Parser.reset()`, worker timeouts/disable logic, per-language budgets) and add telemetry for budget abort reasons.
- [ ] Task 16.11.2.e: Validate deterministic chunk outputs across scheduling strategies (language passes within file + batch-by-language across files) and ensure final chunk ordering is stable.

Tests:
- [ ] `tests/indexing/tree-sitter/tree-sitter-batch-by-language.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-timeout-disable.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-adaptive-budget.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-streaming-chunking.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/tree-sitter-fallback-missing-wasm.test.js` (perf lane)
- [ ] `tests/indexing/tree-sitter/js-tree-sitter-maxbytes.test.js` (perf lane)

### Subphase 16.11.3 -- Tests + Bench
Parallel: Run after 16.11.1/16.11.2.
Docs/specs to update: `docs/specs/segmentation-perf.md`, `docs/specs/large-file-caps-strategy.md`, `docs/perf/indexing-stage-audit.md`
Touchpoints: `src/lang/tree-sitter/runtime.js (anchors: preloadTreeSitterLanguages, getTreeSitterStats)`, `src/lang/tree-sitter/chunking.js (anchors: buildTreeSitterChunks, buildTreeSitterChunksAsync, resolveChunkCacheKey)`, `src/index/build/indexer/steps/process-files/tree-sitter.js (anchors: applyTreeSitterBatching, resolveTreeSitterPreloadPlan)`, `tools/bench/index/tree-sitter-load.js` (new), `tests/indexing/tree-sitter/*`
Tasks:
- [ ] Task 16.11.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.11.3.a: Implement `tree-sitter-load` benchmark (place under `tools/bench/index/tree-sitter-load.js`) to measure parse/chunk throughput per language and per batching policy (file-order vs batch-by-language), emitting JSON with `getTreeSitterStats()` counters.
- [ ] Task 16.11.3.b: Add cold vs warm cache modes in the benchmark (clear caches vs reuse) and add contract coverage asserting warm is faster than cold and that batch-by-language reduces redundant WASM loads under mixed-language inputs.
- [ ] Task 16.11.3.c: Add regression test for parse determinism (same inputs must yield identical chunk boundaries/names/kinds across runs and across worker vs main thread where applicable).
- [ ] Task 16.11.3.d: Add regression test for parse reuse on unchanged files (chunk cache hits and query cache reuse must be observable via stats; no re-parse when content hash unchanged).
- [ ] Task 16.11.3.e: Add memory regression test for parse trees/caches (repeat parse loops must plateau; `maxLoadedLanguages` must cap growth on both main and worker pools).
- [ ] Task 16.11.3.f: Add docs update for tree-sitter load strategy (batching, cache knobs, determinism invariants, telemetry fields surfaced in stage audit).

Tests:
- [ ] `tests/indexing/tree-sitter/tree-sitter-load-bench-contract.test.js` (perf lane) (new)
- [ ] `tests/indexing/tree-sitter/tree-sitter-parse-determinism.test.js` (perf lane) (new)
- [ ] `tests/indexing/tree-sitter/tree-sitter-chunk-cache-reuse.test.js` (perf lane) (new)
- [ ] `tests/indexing/tree-sitter/tree-sitter-memory-plateau.test.js` (perf lane) (new)

---

## Phase 16.12 -- Graph + Context Pack Throughput

### Subphase 16.12.1 -- Graph Store
Parallel: Can run alongside 16.12.2 with clear module ownership.
Docs/specs to update: `docs/specs/graph-filtering-and-dedupe.md`, `docs/specs/context-packs.md`, `docs/specs/impact-analysis.md`, `docs/perf/graph-context-pack.md`, `docs/perf/retrieval-pipeline.md`
Touchpoints: `src/graph/store.js (anchors: createGraphStore, buildGraphIndex, buildGraphIndexCacheKey)`, `src/graph/indexes.js (anchors: buildAdjacencyIndex, buildAdjacencyCsr, buildIdTable)`, `src/shared/artifact-io/loaders.js (anchor: loadGraphRelations)`
Tasks:
- [ ] Task 16.12.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.12.1.a: Teach `GraphStore` to load the `graph_relations_csr` artifact from the pieces manifest (add `loadGraphRelationsCsr` to artifact-io).
- [ ] Task 16.12.1.b: Plumb CSR into `GraphIndex` (`graphRelationsCsr`) and ensure `buildGraphIndexCacheKey` segments caches on CSR presence and graph selection.
- [ ] Task 16.12.1.c: Add strict validation + fallback behavior for CSR payloads (offset monotonicity, edge bounds, stable node ordering); fall back to `graph_relations` on invalid CSR.
- [ ] Task 16.12.1.d: Reduce redundant in-memory structures when CSR is available (avoid building per-node `both` adjacency lists; keep legacy path as fallback).
- [ ] Task 16.12.1.e: Add graph store cache telemetry (hit/miss, build time, eviction) and basic memory accounting for loaded graph artifacts/indexes.

Tests:
- [ ] `tests/graph/graph-store-cache-eviction.test.js` (existing)
- [ ] `tests/graph/graph-index-cache-reuse.test.js` (existing)
- [ ] `tests/graph/graph-id-remap-roundtrip.test.js` (existing)
- [ ] `tests/graph/graph-store-csr-artifact-load.test.js` (perf lane) (new)

### Subphase 16.12.2 -- Traversal + Filtering
Parallel: Can run alongside 16.12.1 with clear module ownership.
Docs/specs to update: `docs/specs/graph-filtering-and-dedupe.md`, `docs/specs/context-packs.md`, `docs/specs/impact-analysis.md`, `docs/perf/graph-context-pack.md`, `docs/perf/retrieval-pipeline.md`
Touchpoints: `src/graph/neighborhood.js (anchor: buildGraphNeighborhood)`, `src/graph/impact.js (anchor: buildImpactAnalysis)`, `src/graph/context-pack.js (anchor: buildGraphContextPack)`, `src/context-pack/assemble.js (anchors: buildChunkIndex, assembleCompositeContextPack)`, `src/retrieval/output/graph-impact.js (anchor: renderGraphImpact)`
Tasks:
- [ ] Task 16.12.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.12.2.a: Use CSR-backed neighbor resolution in `buildGraphNeighborhood` when `graphIndex.graphRelationsCsr` is available (preserve determinism + cap enforcement).
- [ ] Task 16.12.2.b: Add a reverse-edge index strategy for `direction=in|both` without materializing full `in`/`both` adjacency lists (build once per graphIndex and cache).
- [ ] Task 16.12.2.c: Add traversal-result caching keyed by query signature (seed(s), graphs/edgeTypes, depth, direction, caps, includePaths, indexSignature) with telemetry and strict invalidation.
- [ ] Task 16.12.2.d: Define "streaming context-pack assembly" precisely and add an assembly path that does not require a full in-memory `chunkMeta` array or `chunkIndex` (provider-based lookup for required chunks/excerpts).
- [ ] Task 16.12.2.e: Lock determinism across legacy vs CSR paths and across caching (explicit invariants + regression tests).
- [ ] Task 16.12.2.f: Expand traversal stats to include cap trigger counts + import graph lookup misses, and ensure they are surfaced consistently in outputs.

Tests:
- [ ] `tests/graph/graph-output-deterministic.test.js` (existing)
- [ ] `tests/graph/graph-filter-predicate-deterministic.test.js` (existing)
- [ ] `tests/graph/graph-truncation-deterministic.test.js` (existing)
- [ ] `tests/retrieval/graph/context-pack-determinism.test.js` (existing)
- [ ] `tests/graph/graph-csr-neighbors-deterministic.test.js` (perf lane) (new)

### Subphase 16.12.3 -- Tests + Bench
Parallel: Run after 16.12.1/16.12.2.
Docs/specs to update: `docs/specs/graph-filtering-and-dedupe.md`, `docs/specs/context-packs.md`, `docs/specs/impact-analysis.md`, `docs/perf/graph-context-pack.md`, `docs/perf/retrieval-pipeline.md`
Touchpoints: `tools/bench/graph/context-pack-latency.js (anchors: runContextPackLatencyBench, runContextPackLatencyBenchCli)`, `tools/bench/graph/neighborhood-cache.js (anchors: runNeighborhoodBench, runNeighborhoodBenchCli)`, `tools/bench/graph/neighborhood-index-dir.js` (new), `tools/bench/graph/store-lazy-load.js`, `src/graph/store.js (anchors: createGraphStore, buildGraphIndexCacheKey)`, `src/graph/neighborhood.js (anchor: buildGraphNeighborhood)`, `src/graph/impact.js (anchor: buildImpactAnalysis)`, `src/context-pack/assemble.js (anchors: buildChunkIndex, assembleCompositeContextPack)`
Tasks:
- [ ] Task 16.12.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.12.3.a: Extend `context-pack-latency` bench to report cache effectiveness and artifact load costs (GraphStore cache hits/misses, CSR vs legacy path when both are available) and keep output schema stable for contract tests.
- [ ] Task 16.12.3.b: Add a real-index traversal bench (new: `tools/bench/graph/neighborhood-index-dir.js`) that loads graph artifacts via `GraphStore` and measures traversal/impact throughput (baseline vs current, warm vs cold caches, includePaths on/off).
- [ ] Task 16.12.3.c: Add perf contract coverage for graph/context-pack benches using relative invariants (current must outperform baseline in the same run; CSR must not regress determinism/caps; warm must outperform cold).
- [ ] Task 16.12.3.d: Add determinism regression coverage specific to cache boundaries (GraphStore cache reuse must not change output ordering; CSR vs legacy output equality where applicable).
- [ ] Task 16.12.3.e: Add memory regression test for graph traversal/output (repeat expansions must plateau; spill/merge windows must cap edge buffering; caps must bound work).
- [ ] Task 16.12.3.f: Add streaming context-pack integration test once 16.12.2.d exists (provider-based assembly must not require full `chunkMeta` materialization).
- [ ] Task 16.12.3.g: Add docs update for graph/context-pack changes (bench commands, determinism invariants, caching boundaries, and how to interpret stats/memory fields).

Tests:
- [ ] `tests/perf/graph-context-pack-latency-bench-contract.test.js` (perf lane) (new)
- [ ] `tests/perf/graph-neighborhood-bench-contract.test.js` (perf lane) (new)
- [ ] `tests/graph/graph-output-deterministic.test.js` (existing)
- [ ] `tests/retrieval/graph/context-pack-determinism.test.js` (existing)
- [ ] `tests/graph/graph-memory-plateau.test.js` (perf lane) (new)
- [ ] `tests/retrieval/graph/context-pack-streaming-assembly.test.js` (perf lane) (new)

---

## Phase 16.15 -- Usage Verification + Cross-Phase Bench Coverage

### Subphase 16.15.1 -- Usage Checklist
Parallel: Can run alongside 16.15.2/16.15.3.
Docs/specs to update: `docs/perf/indexing-stage-audit.md`, `docs/perf/retrieval-pipeline.md`, `docs/perf/map-pipeline.md`, `docs/perf/shared-component-audit.md`, `docs/specs/test-strategy-and-conformance-matrix.md`
Touchpoints: `tools/bench/* (anchor: benchRunner)`, `tests/tooling/bench/* (anchor: bench output schema)`, `src/index/build/indexer/* (anchor: runPipeline)`, `src/retrieval/* (anchor: runSearch)`
Tasks:
- [ ] Task 16.15.1.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.15.1.a: Verify Phase 0 usage (shared components in graph/context-pack).
- [ ] Task 16.15.1.b: Verify Phase 1 usage (stage checkpoints in build_state).
- [ ] Task 16.15.1.c: Verify Phase 2 usage (shared IO paths in build/search).
- [ ] Task 16.15.1.d: Verify Phase 3 usage (postings guards in Stage1).
- [ ] Task 16.15.1.e: Verify Phase 4 usage (relations/filter index in Stage2).
- [ ] Task 16.15.1.f: Verify Phase 5 usage (embeddings cache in Stage3).
- [ ] Task 16.15.1.g: Verify Phase 6 usage (sqlite optimizations in Stage4).
- [ ] Task 16.15.1.h: Verify Phase 7 usage (VFS pipeline in build/tooling).
- [ ] Task 16.15.1.i: Verify Phase 8 usage (tree-sitter load strategy).
- [ ] Task 16.15.1.j: Verify Phase 9 usage (retrieval pipeline in search).
- [ ] Task 16.15.1.k: Verify Phase 10 usage (graph/context-pack in search).
- [ ] Task 16.15.1.l: Verify Phase 11 usage (CLI startup fast paths).
- [ ] Task 16.15.1.m: Verify Phase 12 usage (map build/viewer).
- [ ] Task 16.15.1.n: Verify Phase 13 usage (doc/JSDoc guardrails).
- [ ] Task 16.15.1.o: Verify Phase 14 usage (artifact pipeline optimizations).
- [ ] Task 16.15.1.p: Verify Phase 15 usage (index_state/file_meta/minhash paths).

Tests:
- [ ] `tests/indexing/validate/phase-usage-checklist.test.js` (perf lane) (new)

### Subphase 16.15.2 -- Bench Harness
Parallel: Can run alongside 16.15.1; ensure bench harness exists before validating outputs.
Docs/specs to update: `docs/perf/indexing-stage-audit.md`, `docs/perf/retrieval-pipeline.md`, `docs/perf/map-pipeline.md`, `docs/perf/shared-component-audit.md`, `docs/specs/test-strategy-and-conformance-matrix.md`
Touchpoints: `tools/bench/* (anchor: benchRunner)`, `tests/tooling/bench/* (anchor: bench output schema)`, `src/index/build/indexer/* (anchor: runPipeline)`, `src/retrieval/* (anchor: runSearch)`
Tasks:
- [ ] Task 16.15.2.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.15.2.a: Ensure each phase has a baseline/current benchmark.
- [ ] Task 16.15.2.b: Enforce delta reporting (amount, throughput, percentage, duration).
- [ ] Task 16.15.2.c: Add real-index inputs for all benchmarks where applicable.
- [ ] Task 16.15.2.d: Add bench runner that batches all phase benches.
- [ ] Task 16.15.2.e: Add bench output summary report in CI artifacts.

Tests:
- [ ] `tests/tooling/bench/bench-runner-contract.test.js` (perf lane) (new)

### Subphase 16.15.3 -- Bench Output Contracts
Parallel: Run after 16.15.2; can overlap with 16.15.1.
Docs/specs to update: `docs/perf/indexing-stage-audit.md`, `docs/perf/retrieval-pipeline.md`, `docs/perf/map-pipeline.md`, `docs/perf/shared-component-audit.md`, `docs/specs/test-strategy-and-conformance-matrix.md`
Touchpoints: `tools/bench/* (anchor: benchRunner)`, `tests/tooling/bench/* (anchor: bench output schema)`, `src/index/build/indexer/* (anchor: runPipeline)`, `src/retrieval/* (anchor: runSearch)`
Tasks:
- [ ] Task 16.15.3.doc: Update docs/specs and touchpoints listed for this subphase.
- [ ] Task 16.15.3.a: Add schema for bench output JSON.
- [ ] Task 16.15.3.b: Enforce schema in bench scripts.
- [ ] Task 16.15.3.c: Add regression test for bench output format.
- [ ] Task 16.15.3.d: Add docs for bench output semantics.
- [ ] Task 16.15.3.e: Add tool to diff bench results between commits.

Tests:
- [ ] `tests/tooling/bench/bench-output-schema.test.js` (perf lane) (new)

---

## Acceptance (overall)
- [ ] All Phase 16 specs exist and align with contracts.
- [ ] Cross-stage scheduler + artifact IO pipeline are in active use.
- [ ] Cache keys are unified and invalidation is correct across caches.
- [ ] Determinism is enforced via ledger + ordering helpers.
- [ ] All phases have baseline/current benchmarks with deltas.
- [ ] Usage checklist is complete and verified.

---

## Post-Phase Tasks (For the next Roadmap)
- Fix --help on `node tests/run.js --help`, it currently starts running tests after printing its help output
- what generates artifacts directory? Just junit xml output? That should probably be emitted to a better location like in .testlogs
- do we deliberately have an empty tools/perf/ folder? Let's get rid of that 
- Confirm that when I see `[budget] symbol_edges exceeded budget 128.0MB by 58.2MB (trim).` It doesn't mean we're just chopping off all of the extra data. We can totally include all of this. 

- Unify shard threshold normalization across writer/loader paths (ensure a single shared helper is used everywhere).
- We need to evaluate the performance of indexing and searching on the repo itself to determine correct limits/safeguards/values
- Have been seeing errors like `[tooling] Invalid virtualRange for tests/fixtures/languages/src/javascript_component.jsx (117-157); skipping target.`, let's ensure that is fixed by now
- ensure we're wasming correctly
- evaluate context window sizing
- we need a 'merged' c8 coverage generation ci job
- what is tools/dict-utils/, why is it named that? it seems like it does a lot of stuff completely unrelated to dictionaries and is referenced by a lot, perhaps that code should be moved to shared?
- what is pairofcleats.json used for anymore? it doesn't seem necessary?
