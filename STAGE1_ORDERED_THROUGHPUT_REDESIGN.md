# Stage1 Ordered Throughput Redesign

## Summary

This design replaces gap-recovery-driven ordered flush behavior with an order-contiguous execution model that is deadlock-proof by construction and throughput-first under heavy repositories.

The core idea is simple:

1. Keep one immutable global sequence (`seq`) for all discovered files.
2. Partition work into contiguous `seq` windows.
3. Run compute out-of-order within active windows.
4. Commit in strict `seq` order with explicit terminal outcomes for every `seq`.
5. Remove correctness dependence on "recover missing gap" heuristics.

This turns ordering from a recovery problem into an invariant.

## Why Current Behavior Stalls

The existing pipeline establishes a global canonical order, then repartitions work by shard/cost/directory. That creates sparse order ranges per worker/subset. Ordered append therefore sees holes and can block on not-yet-run lower indices.

Even with watchdogs and recovery, this creates a control-plane stall surface:

1. Cross-subset order dependencies.
2. Head-of-line blocking in ordered drain.
3. Gap recovery logic that depends on dispatch timing state.
4. High tail latency when one lower-order subset is delayed.

## Goals

1. Eliminate deadlock and indefinite ordered-drain stalls.
2. Increase steady-state throughput (files/s, lines/s, bytes/s).
3. Improve p95/p99 build time and queue latency.
4. Keep deterministic artifacts and stable chunk/doc ids.
5. Bound memory with explicit byte budgets.
6. Make cancellation/retry semantics deterministic and auditable.

## Non-Goals

1. Changing retrieval semantics.
2. Changing artifact contracts or schema surface.
3. Removing concurrency. Concurrency remains high in compute lanes.

## Core Model

### 1) Global Sequence Ledger

At discovery, assign each file a monotonic immutable `seq` id.

Each `seq` has exactly one lifecycle:

1. `UNSEEN`
2. `DISPATCHED`
3. `IN_FLIGHT`
4. `TERMINAL_SUCCESS` or `TERMINAL_SKIP` or `TERMINAL_FAIL`
5. `COMMITTED` (for success paths with payload commit)

Every `seq` must reach a terminal state exactly once.

### 2) Contiguous Window Planner

Replace shard-first planning with `seq` windows:

1. Input: sorted entries with `seq`, estimated per-entry cost, bytes, lines.
2. Output: windows with contiguous ranges `[startSeq, endSeq]`.
3. Window sizing uses target cost and hard byte bounds.
4. No window contains discontiguous ranges.
5. Windows are deterministic for identical input and runtime config.

### 3) Two-Lane Runtime

Lane A: compute lane (parallel)

1. Parse/chunk/relations/tokenize/embed in parallel across active windows.
2. Store `ResultEnvelope(seq, outcome, payload, metrics)` in a bounded buffer.

Lane B: commit lane (ordered)

1. Maintain `nextCommitSeq`.
2. While envelope for `nextCommitSeq` exists and is terminal, commit/skip/fail and advance.
3. Batch contiguous commit runs for high write throughput.

Compute remains parallel. Commit remains deterministic and efficient.

## Throughput Enhancements (Folded In)

### A) Budget-Driven Backpressure

Use byte budgets, not just pending counts.

1. Global buffered bytes budget.
2. Per-window buffered bytes budget.
3. Backpressure engages before GC pressure spikes.
4. Dispatch resumes with hysteresis thresholds.

### B) Adaptive Window Sizing

Tune window size from live telemetry.

1. Start from predicted cost target.
2. Shrink windows when commit lag or memory pressure rises.
3. Grow windows when CPUs are underutilized and commit lag is low.
4. Keep deterministic behavior by using deterministic policy + telemetry snapshots.

### C) Active Window Overlap

Keep up to two active windows:

1. Window N commits.
2. Window N+1 computes.
3. Preserves order while hiding long-tail compute outliers.

### D) Fast Commit Micro-Batching

Commit contiguous runs in one pass:

1. Coalesce postings reservations.
2. Coalesce manifest and metadata updates.
3. Coalesce sqlite apply bursts where safe.
4. Reduce queue churn and lock handoffs.

### E) Language Locality Without Order Breakage

Do parser/language micro-batching inside each window:

1. Group compute dispatch by tree-sitter batch key within a window.
2. Keep window order for commit only.
3. Preserve grammar cache locality and warm parser state.

### F) Low-Overhead State Structures

Use dense arrays where possible:

1. `Uint8Array` for per-`seq` state.
2. Dense arrays for minimal metadata (`attempts`, `lastErrorCode`, `bytes`).
3. Sparse map only for heavy payload envelopes.
4. Aggressive payload release on commit.

### G) Retry Discipline for Throughput

Retries stay tied to original `seq`.

1. No new order slot created by retry.
2. Exponential backoff only for retryable classes.
3. Retry budget per `seq` and per window to avoid starvation.
4. Fast-fail known terminal classes immediately.

### H) Work Stealing with Guardrails

Allow workers to steal from active windows while honoring memory and fairness constraints.

1. Prefer oldest active window first.
2. Age-based fairness to prevent long-tail starvation.
3. Never dispatch outside active-window set.

### I) Zero-Copy Envelope Path

Avoid repeated payload copying.

1. Keep compute outputs in envelope references until commit.
2. Transform to final write format during commit only.
3. Free memory immediately after commit call returns.

### J) Optional Commit Worker Thread

For very large runs, optionally move commit serialization and write batching to a dedicated worker thread with bounded channel depth. Keep deterministic commit cursor in one place.

## Correctness Invariants

These are mandatory and enforced at runtime:

1. `terminalCount === totalSeqCount` at stage end.
2. `nextCommitSeq` only increases by 1.
3. Each `seq` receives at most one terminal event.
4. No `COMMITTED` state before terminal success.
5. Window close condition: all seqs in window terminal and cursor passed end of window.
6. Any invariant violation aborts stage with structured diagnostic snapshot.

## Failure and Cancellation Semantics

1. Cancellation stops new dispatch immediately.
2. In-flight tasks get bounded grace period.
3. Pending undispatched `seq` values become terminal `FAIL` with cancellation reason.
4. Commit lane drains all terminal envelopes up to policy boundary.
5. Stage exits with deterministic summary; no orphan pending state.

## Recovery and Checkpointing

Persist minimal deterministic state:

1. `nextCommitSeq`
2. per-`seq` terminal bitmap
3. retry counters and terminal reason codes
4. window planner seed/config hash

On resume:

1. Rebuild planner deterministically.
2. Skip already terminal+committed `seq` values.
3. Resume from `nextCommitSeq`.

## Observability and KPIs

Emit structured telemetry:

1. Throughput: files/s, lines/s, bytes/s.
2. Queueing: dispatch wait, compute wait, commit wait.
3. Buffers: pending envelopes, buffered bytes, per-window occupancy.
4. Ordering: commit lag (`maxSeenSeq - nextCommitSeq`), terminal lag.
5. Reliability: retries, terminal fail classes, invariant violations.
6. Tail behavior: p95/p99 per-file compute latency, commit latency.

## Implementation Plan

### Execution Status (2026-02-24T00:10:00Z)

- [x] Docs/spec baseline created for Stage1 order-contiguous runtime and hard cutover.
- [ ] Runtime implementation converted to seq-ledger + contiguous windows + commit cursor.
- [ ] Legacy gap-recovery and compatibility branches removed from Stage1 path.
- [ ] Stage1 tests updated and expanded for new invariants.

### Phase 1: Ledger and Window Planner

Files:

1. `src/index/build/indexer/steps/process-files.js`
2. `src/index/build/shards.js`
3. `src/index/build/indexer/steps/process-files/ordering.js`

Tasks:

1. Add `seq` ledger structures and terminal state machine.
2. Add contiguous window planner.
3. Hard-cut Stage1 runtime to contiguous-window behavior without legacy guard paths.

### Phase 2: Dual-Lane Runtime

Files:

1. `src/index/build/indexer/steps/process-files.js`
2. `src/index/build/indexer/steps/process-files/ordered.js`

Tasks:

1. Replace gap-recovery correctness path with commit-cursor lane.
2. Add envelope buffering and micro-batch commit.
3. Add byte-budgeted backpressure.

### Phase 3: Throughput Features

Files:

1. `src/index/build/indexer/steps/process-files.js`
2. `src/index/build/indexer/steps/process-files/tree-sitter.js`
3. `src/index/build/runtime/scheduler.js`

Tasks:

1. Adaptive window sizing.
2. Active window overlap.
3. Intra-window language micro-batching.
4. Work stealing with fairness.

### Phase 4: Cleanup and Hard Cutover

Tasks:

1. Remove legacy gap recovery correctness logic.
2. Remove per-subset ordered-drain waits and compatibility branches.
3. Keep one active Stage1 path only (no shim, no dual-run toggle).

## Required Specs and Documents

Create or update the following artifacts as part of implementation:

| File | Location | Action | Contents Summary |
|---|---|---|---|
| `docs/specs/stage1-order-contiguous-runtime.md` | `docs/specs/` | New | Normative end-to-end runtime contract for seq-ledger, windowing, dispatch, commit lane, and deterministic guarantees. |
| `docs/specs/stage1-seq-ledger-state-machine.md` | `docs/specs/` | New | Exact state model, transition table, illegal-transition behavior, ownership lease semantics, and replay-safe invariants. |
| `docs/specs/stage1-window-planner.md` | `docs/specs/` | New | Deterministic contiguous window planner rules, cost model, sizing constraints, and adaptive resizing policy. |
| `docs/specs/stage1-commit-journal-replay.md` | `docs/specs/` | New | Commit journal record schema, fsync policy, recovery/replay algorithm, truncation/compaction behavior. |
| `docs/specs/stage1-backpressure-controller.md` | `docs/specs/` | New | Byte-budget controller math, hysteresis thresholds, lag signals, and dispatch throttling policy. |
| `docs/specs/stage1-retry-and-terminal-outcome-taxonomy.md` | `docs/specs/` | New | Retryability classes, bounded retry budgets, terminalization policy, cancellation terminal outcomes. |
| `docs/specs/stage1-cancellation-and-shutdown.md` | `docs/specs/` | New | Deterministic cancellation semantics, in-flight grace behavior, and orderly drain requirements. |
| `docs/specs/stage1-observability.md` | `docs/specs/` | New | Required telemetry fields/counters for dispatch/compute/commit, lag, memory, retries, and invariant failures. |
| `docs/specs/stage1-hard-cutover-plan.md` | `docs/specs/` | New | Cutover steps, legacy path deletions, rollback boundary, and final cleanup checklist. |
| `docs/guides/architecture.md` | `docs/guides/` | Update | Update Stage1 architecture diagram and runtime flow with contiguous windows + commit cursor lane. |
| `docs/worklogs/stage1-ordered-throughput-rollout.md` | `docs/worklogs/` | New | Timestamped implementation journal of phases, perf snapshots, failures, and fixes. |
| `STAGE1_ORDERED_THROUGHPUT_REDESIGN.md` | repo root | Update | Keep this implementation plan in sync with actual landed touchpoints and tests. |

## Code Touchpoints (Comprehensive)

### Primary Implementation Touchpoints

| File | Change Type | Scope |
|---|---|---|
| `src/index/build/indexer/steps/process-files.js` | Major rewrite | Introduce seq ledger lifecycle, active windows, compute lane dispatch, commit cursor lane, deterministic terminalization, cancellation drain. |
| `src/index/build/indexer/steps/process-files/ordered.js` | Major rewrite or replacement | Replace gap-recovery correctness path with commit-cursor mechanics and contiguous run commit batching. |
| `src/index/build/indexer/steps/process-files/ordering.js` | Major update | Add contiguous window planner helpers, deterministic tie-break rules, state transition utilities. |
| `src/index/build/shards.js` | Major update | Remove shard-first ordering assumptions for Stage1 path; provide order-contiguous planning path. |
| `src/index/build/indexer/steps/process-files/planner.js` | Update | Integrate window constraints and runtime policy plumbing for Stage1 planner surfaces. |
| `src/index/build/indexer/steps/process-files/postings-queue.js` | Update | Support contiguous commit micro-batching and byte-budget-aware backpressure integration. |
| `src/index/build/indexer/steps/process-files/runtime.js` | Update | Runtime knobs/defaults for window sizing, active window overlap, budget thresholds. |
| `src/index/build/indexer/steps/process-files/stall-diagnostics.js` | Update | Remove obsolete gap-recovery assumptions; snapshot new seq/window/lag primitives. |
| `src/index/build/indexer/steps/process-files/watchdog.js` | Update | Re-anchor stall logic to commit lag and terminalization progress. |
| `src/index/build/indexer/steps/process-files/tree-sitter.js` | Update | Keep language locality batching constrained within active windows. |

### Secondary Implementation Touchpoints

| File | Change Type | Scope |
|---|---|---|
| `src/index/build/runtime/runtime.js` | Update | New runtime config schema/defaults for window planner and backpressure controls. |
| `src/index/build/runtime/scheduler.js` | Update | Scheduler normalization and runtime policy integration for commit/dispatch interplay. |
| `src/index/build/runtime/queues.js` | Update | Queue wiring and lane-specific limits for compute vs commit workload. |
| `src/index/build/stage-checkpoints.js` | Update | Include seq-ledger/checkpoint handoff metadata. |
| `src/index/build/build-state/checkpoints.js` | Update | Persist and restore seq ledger summary and commit cursor state. |
| `src/index/build/build-state/progress.js` | Update | Progress semantics from order index completion to seq terminalization and commit progression. |
| `src/index/build/build-state/order-ledger.js` | Update | Align truth-ledger integration with seq terminal state semantics. |
| `src/index/build/build-state/patch-queue.js` | Update | Ensure durable state updates from commit lane are atomic and replay-safe. |
| `src/index/build/build-state/store.js` | Update | Journal/checkpoint persistence and restore for new state model. |
| `src/index/build/build-state/phases.js` | Update | Phase metadata for new Stage1 runtime topology. |
| `src/index/build/build-state.js` | Update | Stage1 state envelope extensions for seq/window metadata. |
| `src/index/build/runtime/stage.js` | Update | Stage runtime plumbing and surface cleanup for removed legacy behavior. |
| `src/shared/concurrency.js` or underlying `src/shared/concurrency/*` | Update | If needed for lane-level queue semantics and safe cancellation behavior. |

### Touchpoints to Delete or Simplify After Cutover

| File | Change Type | Scope |
|---|---|---|
| `src/index/build/indexer/steps/process-files/ordered.js` | Remove legacy branches | Delete gap-recovery correctness branches and per-subset drain logic. |
| `src/index/build/indexer/steps/process-files.js` | Remove legacy branches | Delete per-subset ordered completion wait code and compatibility fallback paths. |
| `src/index/build/shards.js` | Simplify Stage1 path | Remove stale Stage1-only shard ordering paths no longer used by contiguous window planner. |

## Test Touchpoints (Comprehensive)

### Existing Tests to Update

| File | Update Focus |
|---|---|
| `tests/indexing/stage1/process-files-ordering-sort.test.js` | Replace assumptions tied to old shard-order drain behavior; validate seq-window dispatch invariants. |
| `tests/indexing/stage1/process-files-refactor-helpers.test.js` | Add coverage for new helper contracts (window planning, commit lane integration). |
| `tests/indexing/stage1/process-files-stall-snapshot-policy.test.js` | Update stall semantics to commit lag + terminal progress model. |
| `tests/indexing/stage1/process-files-cleanup-timeout.test.js` | Validate deterministic cancellation/drain behavior under new lanes. |
| `tests/indexing/ordering/ordered-completion-tracker.test.js` | Align expected usage with mode-level drain semantics. |
| `tests/indexing/ordering/ordered-appender-progress-stall.test.js` | Replace gap-stall assumptions with commit-cursor lag behavior. |
| `tests/indexing/ordering/ordered-appender-recover-missing-range.test.js` | Retire or repurpose for invariant-fail path after gap-recovery removal. |
| `tests/indexing/ordering/ordered-appender-emergency-capacity.test.js` | Rework around byte budgets and window buffering. |
| `tests/indexing/ordering/ordered-appender-capacity-bypass.test.js` | Rework around window overlap and dispatch policy. |
| `tests/indexing/ordering/ordered-appender-bucketed-watermark.test.js` | Replace with contiguous commit micro-batch behavior checks. |
| `tests/indexing/shards/shard-plan.test.js` | Add Stage1 contiguous window planning assertions. |
| `tests/indexing/shards/cluster-mode-deterministic-merge.test.js` | Update to deterministic window merge/commit semantics. |
| `tests/indexer/hang-safety-guards.test.js` | Add deadlock-proof guarantees for no-progress ordered drain cases. |
| `tests/perf/indexing/postings/stage1-memory-budget.test.js` | Validate byte-budget controller behavior with window buffering. |
| `tests/shared/concurrency/concurrency-run-with-queue-abort-inflight-hang.test.js` | Validate cancellation and no-hang drain behavior with staged lanes. |

### New Tests to Add

| File (new) | Coverage |
|---|---|
| `tests/indexing/stage1/seq-ledger-state-machine.test.js` | Full transition table coverage, illegal transitions, terminal uniqueness. |
| `tests/indexing/stage1/window-planner-contiguous-ranges.test.js` | Deterministic contiguous ranges, cost caps, tie-break stability. |
| `tests/indexing/stage1/window-planner-adaptive-resize.test.js` | Window resize policy and deterministic behavior under fixed telemetry snapshots. |
| `tests/indexing/stage1/commit-cursor-monotonicity.test.js` | Commit cursor strict monotonic advancement under randomized completion order. |
| `tests/indexing/stage1/commit-journal-replay-idempotence.test.js` | Replay correctness and no double-commit after simulated crash/restart. |
| `tests/indexing/stage1/cancellation-terminalization.test.js` | Deterministic undispatched terminal-cancel behavior and clean drain. |
| `tests/indexing/stage1/retry-same-seq-contract.test.js` | Retries never create new sequence slots and obey retry class budgets. |
| `tests/indexing/stage1/byte-budget-hysteresis.test.js` | Backpressure engage/release behavior under memory pressure. |
| `tests/indexing/stage1/two-window-overlap-contract.test.js` | Window N commit + N+1 compute overlap without commit-order violation. |
| `tests/indexing/stage1/terminal-count-integrity.test.js` | `terminalCount === totalSeqCount` invariant under mixed success/skip/fail/cancel outcomes. |
| `tests/indexing/stage1/commit-microbatch-coalescing.test.js` | Contiguous run batching and expected downstream write call consolidation. |
| `tests/indexing/stage1/no-gap-recovery-correctness.test.js` | Assert correctness no longer depends on missing-range recovery branch. |
| `tests/perf/bench/stage1-windowed-throughput-bench.test.js` | Stable perf harness for before/after throughput and lag telemetry capture. |

### Test Infrastructure Touchpoints

| File | Scope |
|---|---|
| `tests/run.js` | If needed, register new stage1 lanes/categories for targeted execution. |
| `tests/helpers/*` | Add reusable fixtures/build harness for synthetic seq-window scenarios and deterministic replay. |
| `tests/fixtures/*` | Add deterministic mixed-language fixture repos for planner and overlap stress cases. |

## Testing Strategy

1. Unit tests for ledger transitions and invariant enforcement.
2. Unit tests for deterministic window planner output.
3. Property tests for monotonic commit under random completion order.
4. Stress tests with synthetic skew and retries.
5. Perf tests tracking throughput and p95/p99 latency.
6. Recovery tests validating restart from checkpoint.

## Risk and Mitigation

1. Risk: commit lane becomes bottleneck.
   Mitigation: micro-batching, write coalescing, optional commit worker, adaptive active-window count.

2. Risk: memory spikes from buffered envelopes.
   Mitigation: strict byte budgets and early backpressure.

3. Risk: throughput drop from overly small windows.
   Mitigation: adaptive sizing with guardrail min/max bounds.

4. Risk: complexity during migration.
   Mitigation: short dual-run validation and immediate hard cutover after confidence.

## Acceptance Criteria

1. Zero deadlocks/hangs attributable to ordered drain.
2. Deterministic outputs unchanged for equivalent inputs.
3. Throughput improvement on large repos and no regression on small repos.
4. Bounded memory under defined tier limits.
5. Clear telemetry proving where time is spent (dispatch/compute/commit).

## Notes for Implementation

1. Keep all complex ordering and commit-cursor logic heavily documented with JSDoc.
2. Keep data structures simple and explicit before micro-optimizing.
3. Prioritize invariant failures over silent recovery when ambiguity occurs.
4. Treat timeouts as guardrails only, never as correctness mechanisms.

## Required Implementation Additions

The following are mandatory implementation details for this redesign:

1. Use a fixed-size typed-array `seq` ledger for hot-path state (`Uint8Array` for state, parallel numeric arrays for attempts/timestamps/ownership ids) instead of `Map/Set` scans in core loops.
2. Enforce atomic state transitions only (`UNSEEN -> DISPATCHED -> IN_FLIGHT -> TERMINAL_* -> COMMITTED`) with explicit transition guards and immediate hard-fail on illegal transitions.
3. Add per-`seq` lease ownership with heartbeat and reclaim semantics so worker loss cannot strand a sequence indefinitely.
4. Implement a single-writer commit engine with idempotent commit journal records (`seq`, terminal outcome, write offsets/checksums) so restart/replay is deterministic.
5. Use zero-copy payload transport where possible (`ArrayBuffer` transfer / shared views) between compute workers and commit lane.
6. Separate envelope metadata from heavy payload data and free payload memory immediately after commit/terminal handling.
7. Use byte-driven backpressure (`bufferedBytes`, `commitLag`, memory pressure) with hysteresis instead of pending-count-only thresholds.
8. Implement contiguous window planning with constrained cost binning and hard caps (`maxWindowBytes`, `maxWindowCost`, `maxInFlightSeqSpan`).
9. Allow at most two active windows with strict semantics: current window advances commit cursor, next window is compute-only prefetch overlap.
10. Preserve intra-window parser/language locality batching for cache efficiency while keeping commit order strictly `seq`-monotonic.
11. Keep retries bound to the same `seq` with class-based retryability and bounded retry budgets; terminalize unrecoverable errors immediately.
12. Micro-batch contiguous commit runs across downstream writes (postings/manifest/sqlite) to reduce lock contention and transaction overhead.
13. Define deterministic cancellation semantics: stop dispatch, mark undispatched entries as terminal-cancelled per policy, then drain ordered commit path cleanly.
14. Add constant-time integrity checks at commit tick boundaries (`nextCommitSeq`, terminal counts, in-flight counts, window bounds), avoiding expensive full rescans in steady state.
