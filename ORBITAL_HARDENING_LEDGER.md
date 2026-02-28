# ORBITAL_HARDENING_LEDGER

## Scope
Static audit findings across `NEON_TIDE`, including deeper remediation guidance beyond the initial fix suggestions.

## Prioritization
- `P1`: correctness, data integrity, or indefinite hang risks.
- `P2`: reliability drift, false gates, stale state, or major observability blind spots.

## Cross-cutting implementation principles
- Fail closed for integrity checks that already have explicit metadata (checksums, cardinalities, schema invariants).
- Split durable writes into explicit two-phase commit + garbage collection.
- Separate transient runtime diagnostics from deterministic cached artifacts.
- Normalize Windows/POSIX behavior through shared helpers (`PATH` key handling, timeout defaults, process lifecycle).

## Issue Ledger

### Core Runtime Safety

#### 1) P1 - Atomic backup swap can cross volumes
- Location: `src/shared/io/atomic-write.js:61`
- Problem: backup path generation for swap may fall back to a different volume, so `rename(target -> backup)` can fail with `EXDEV` under long-path fallback conditions.
- Baseline fix: keep backup path on same directory as target.
- Better fix:
  - Introduce a dedicated `createSiblingBackupPath(target)` helper that never leaves `dirname(target)`.
  - Reserve fallback logic only for temp payload files, never for rename-swap backups.
  - Add explicit `EXDEV` handling metric/log counter so this class is visible in telemetry.

#### 2) P2 - `onStale` callback can perturb lock progress
- Location: `src/shared/locks/file-lock.js:246`
- Problem: callback execution is inside stale-removal control flow; callback exceptions can alter acquisition behavior.
- Baseline fix: isolate callback failure from acquisition path.
- Better fix:
  - Move callbacks to `safeInvokeHook(hook, payload)` utility that never throws.
  - Emit structured hook-failure diagnostics (`code=LOCK_HOOK_ERROR`) without changing lock decisions.

#### 3) P2 - Stale removal remains fragile under lockfile mutation race
- Location: `src/shared/locks/file-lock.js:232`
- Problem: owner-based remove can fail if lockfile mutates between reads; stale file can remain blocking.
- Baseline fix: if owner-remove fails, force-remove stale lock once.
- Better fix:
  - Add a compare-and-fallback loop:
    1. read lock snapshot (mtime + content hash),
    2. attempt owner remove,
    3. if failed and still stale with same snapshot age class, force remove,
    4. if snapshot changed, re-evaluate.
  - Add `stale_remove_owner_failed_force_succeeded` metric to monitor path frequency.

#### 26) P1 - Lock acquire can fail on lock-directory ENOENT race
- Location: `src/shared/locks/file-lock.js` (`acquireFileLock` `fs.open(lockPath, 'wx')` path)
- Problem: when `.fixture-locks` (or parent lock directory) is removed between initial `mkdir` and `open`, lock acquisition fails with `ENOENT` instead of retrying; this causes intermittent fixture/service failures.
- Baseline fix:
  - On `ENOENT` from `open`, re-create parent directory and retry within the same lock wait/deadline semantics.
- Better fix:
  - Treat `ENOENT` as transient lock-acquire contention state:
    - keep retrying with `pollMs` and `waitMs`/`timeoutBehavior` semantics,
    - preserve `AbortSignal` behavior,
    - emit one structured diagnostic counter (`lock_parent_missing_retry`).
  - Add race test that deletes lock parent directory during acquire and verifies eventual success or deterministic timeout behavior.

---

### Tooling/LSP Stack

#### 4) P1 - Re-initialize on pooled LSP sessions
- Location: `src/integrations/tooling/providers/lsp.js:422`
- Problem: reused pooled sessions can receive duplicate `initialize`, causing protocol errors and churn.
- Baseline fix: only initialize fresh/restarted sessions.
- Better fix:
  - Add session state machine in pool: `new -> initializing -> ready -> poisoned -> retired`.
  - Bind initialization state to transport generation ID; auto-reinit only when generation changes.
  - Add invariant checks in debug mode: no request before `ready`, no second initialize on same generation.

#### 5) P2 - Signature parse cache key misses symbol context
- Location: `src/integrations/tooling/providers/lsp/hover-types.js:1040`
- Problem: cache key excludes `symbolName`, allowing incorrect parse reuse.
- Baseline fix: include `symbolName` in key.
- Better fix:
  - Version cache key schema: `v2::<language>::<parser>::<symbol>::<detailHash>`.
  - Add parser capability flag `isSymbolSensitive`; only include symbol when required to keep cache efficient.

#### 6) P2 - Cached diagnostics are reused as live diagnostics
- Location: `src/index/tooling/orchestrator.js:596`
- Problem: stale warnings/timeouts become sticky via cache hits.
- Baseline fix: don’t cache transient diagnostics/runtime fields.
- Better fix:
  - Split provider output contract into:
    - `deterministicPayload` (cacheable)
    - `runtimeEnvelope` (non-cacheable)
  - On cache hit, emit explicit `diagnosticsSource: cache-suppressed` to avoid misleading health interpretation.

#### 24) P1 - Skip `initialize` on reused pooled LSP sessions
- Location: `src/integrations/tooling/providers/lsp.js`
- Problem: `collectLspTypes` can issue `initialize` unconditionally for every lease, including pooled reused sessions that were intentionally kept alive (`shouldShutdownClient=false`), causing second-initialize protocol failures and fail-open enrichment drops.
- Baseline fix: detect reused initialized leases and skip `initialize`.
- Better fix:
  - Treat this as a protocol invariant in the pool contract:
    - record `initialized=true` with transport/session generation,
    - require `initialize` exactly once per generation,
    - enforce via runtime assertions + metrics (`double_initialize_attempt`).
  - Add explicit fallback path when a supposedly initialized session is desynchronized:
    - mark lease poisoned,
    - recreate process,
    - initialize once on fresh generation.

#### 25) P2 - Restore SourceKit candidate score ordering
- Location: `src/index/tooling/sourcekit-provider.js`
- Problem: candidate scoring penalizes `+asserts` / `preview`, but descending sort now prefers higher score first, selecting less stable binaries.
- Baseline fix: restore sort ordering so penalty scores are deprioritized.
- Better fix:
  - Replace implicit numeric sort with explicit comparator policy:
    - primary: `isStableRelease`,
    - secondary: semantic version/channel rank,
    - tertiary: deterministic path order.
  - Add fixture tests for mixed PATH scenarios (`stable + asserts + preview`) to lock expected selection behavior.

---

### Index Build / Import / Incremental

#### 7) P1 - Non-indexed import fallback probes outside repo root
- Location: `src/index/build/import-resolution/engine.js:346`
- Problem: `../` candidates may resolve outside root and be treated based on host FS state.
- Baseline fix: enforce root containment before stat.
- Better fix:
  - Use one canonical `resolveWithinRepoRoot(root, candidate)` helper returning `{ok, resolved, escaped}`.
  - Mark escaped paths with explicit unresolved reason (`escape_out_of_repo`) for deterministic diagnostics.

#### 8) P1 - Non-indexed local fallback cached as stable external
- Location: `src/index/build/import-resolution/engine.js:537,582,668`
- Problem: fallback classification persists without existence-sensitive invalidation.
- Baseline fix: don’t persist or add TTL/revalidation.
- Better fix:
  - Store as separate cache class `ephemeral_external` with short TTL + mandatory existence recheck.
  - Invalidate on directory mtime bloom/signature changes for importer neighborhood.

#### 9) P2 - Incremental shard cleanup before manifest durability
- Location: `src/index/build/incremental/writeback.js:188,474`
- Problem: crash window can leave manifest referencing deleted files.
- Baseline fix: two-phase swap and post-commit GC.
- Better fix:
  - Stage manifests with generation IDs (`manifest.next.json`), fsync, then atomic pointer flip.
  - GC only generations `< activeGeneration` after pointer confirmation.

---

### Storage / Artifact Pipeline

#### 10) P1 - Bundle checksum verification is fail-open
- Location: `src/shared/bundle-io.js:493,510`
- Problem: large/unknown-checksum bundles may be accepted silently.
- Baseline fix: fail closed when checksum present but unverifiable.
- Better fix:
  - Add streaming checksum verifier for large bundles.
  - Add strict policy switch defaulting to strict in CI/build paths.
  - Persist checksum verification result in manifest diagnostics.

#### 11) P1 - Offsets validation misses first-offset and boundary invariants
- Location: `src/shared/artifact-io/offsets.js:416`
- Problem: malformed offsets can pass and shift/drop rows.
- Baseline fix: enforce `offsets[0] === 0` and newline boundary checks.
- Better fix:
  - Validate monotonicity + terminal boundary + per-offset alignment in one linear pass.
  - Add fast “paranoid mode” sampler for production and full mode for CI.

#### 12) P1 - Binary-columnar chunk_meta path bypasses budget and materializes large blobs
- Location: `src/storage/sqlite/build/from-artifacts/sources.js:327`, `src/shared/artifact-io/loaders/core.js:53`, `src/shared/artifact-io/loaders/core-binary-columnar.js:229`
- Problem: large artifacts can spike memory / OOM.
- Baseline fix: enforce budget and stream decode.
- Better fix:
  - Introduce bounded windowed reader abstraction for sidecars (`offset`, `length`, `data`) and decode row-wise.
  - Track memory watermark and backpressure ingestion queue when near budget.

#### 13) P1 - Minhash loader can allocate unbounded buffers from `dims`
- Location: `src/shared/artifact-io/loaders/minhash.js:164`
- Problem: hostile/invalid dimensions can force multi-GB allocations.
- Baseline fix: cap bytes per read and derive bounded buffer size.
- Better fix:
  - Validate dimensions against contract max before allocation.
  - Convert to chunked reader with adaptive chunk size based on available memory budget.

#### 14) P2 - Bundle writer/reader max-size contract mismatch
- Location: `src/shared/bundle-io.js:430,470`
- Problem: writer can emit bundles reader rejects.
- Baseline fix: enforce coordinated max at write time.
- Better fix:
  - Centralize size constants in one shared contract module used by both writer and reader.
  - Include emitted max-size version in artifact metadata to catch skew.

#### 15) P2 - `coercePositiveInt` maps fractional positive to zero
- Location: `src/shared/number-coerce.js:22`, `src/shared/artifact-io/offsets.js:89`
- Problem: brittle semantics (`0.5 -> 0`) create surprising validation failures.
- Baseline fix: reject non-integers or clamp to min 1.
- Better fix:
  - Add explicit mode param: `strictInteger` vs `flooring`.
  - Use strict mode for all limits/budgets; forbid ambiguous coercion in policy inputs.

#### 16) P2 - Token postings cardinality consistency not enforced
- Location: `src/shared/artifact-io/loaders/binary-columnar.js:385`, `src/storage/sqlite/build/from-artifacts/token-ingest.js:76`
- Problem: malformed artifacts can emit postings with missing vocab rows.
- Baseline fix: enforce cardinality equality before ingest.
- Better fix:
  - Add hard schema-level invariant check in loader and fail before ingestion begins.
  - Include mismatch diagnostics in artifact validation report for triage.

#### 27) P1 - Binary-columnar meta envelope parsing is inconsistent across loaders/writers
- Location: `src/shared/artifact-io/loaders/binary-columnar.js`, `src/index/build/artifacts/token-postings.js`, related artifact loaders.
- Problem: loader paths can require `metaRaw.arrays.*` while some writers emit array payload fields at top-level (or vice versa), creating false artifact invalidation (`vocab=0`, cardinality mismatch) and broad downstream failures.
- Baseline fix:
  - Normalize binary meta parsing in one shared helper returning canonical `{ fields, arrays }` for both top-level and nested envelope shapes.
- Better fix:
  - Introduce strict artifact envelope contract module for binary metadata:
    - canonicalize read-path envelope (`fields`/`arrays`) with deterministic fallback rules,
    - validate writer output against the same contract before publish,
    - fail at write time if envelope is ambiguous/incomplete.
  - Add contract tests for both accepted envelope shapes and round-trip load/write invariants.
  - Add a targeted regression test: `token_postings.binary-columnar.meta.json` produced by build must load without fallback and preserve `count===vocab.length===postings.length`.

---

### CI / Bench / Install Tooling

#### 17) P1 - LSP embeddings gate subprocesses lack timeout
- Location: `tools/ci/run-lsp-embeddings-gates.js:38`
- Problem: hanging process can block CI indefinitely.
- Baseline fix: pass timeout and fail deterministically.
- Better fix:
  - Add per-gate timeout profiles and classify timeout reason in JUnit artifacts.
  - Emit partial diagnostics bundle on timeout for debugging without rerun.

#### 18) P2 - `PAIROFCLEATS_TESTING` not force-set in gate runtime
- Location: `tools/ci/run-lsp-embeddings-gates.js:12`
- Problem: inherited non-`1` values can disable expected test env behavior.
- Baseline fix: set to `'1'` unconditionally.
- Better fix:
  - Use shared env normalization helper (`buildTestRuntimeEnv`) so all gate scripts are consistent.

#### 19) P2 - SLO gate uses fixed absolute timeout count in some paths
- Location: `tools/bench/language/tooling-lsp-guardrail.js:55`
- Problem: absolute counts can false-fail larger samples.
- Baseline fix: ratio-based thresholding for SLO input.
- Better fix:
  - Use dual threshold model: `ratio <= rMax` and `absolute <= aMax(sampleSize)` with sample-scaled bound.

#### 20) P2 - PATH normalization can drop effective PATH on Windows
- Location: `tools/ci/run-suite.js:42`
- Problem: case-variant key handling (`PATH`/`Path`) can clobber command resolution.
- Baseline fix: merge variants, choose canonical key safely.
- Better fix:
  - Create shared `normalizeEnvPathKeys(env)` utility and consume it from all tooling entrypoints.

#### 21) P2 - PHAR download has no timeout/abort guard
- Location: `tools/tooling/install-phpactor-phar.js:44`
- Problem: installer can hang indefinitely on stalled network.
- Baseline fix: timeout + retries + cleanup.
- Better fix:
  - Add deterministic retry policy with capped jitter and checksum verification after download.
  - Emit machine-readable failure reason for installer report.

#### 22) P2 - Windows pyright fallback only checks `PATH`, not `Path`
- Location: `tools/tooling/utils.js:618`
- Problem: false negatives in tool detection on some Windows environments.
- Baseline fix: read `PATH || Path`.
- Better fix:
  - Reuse shared path-entry resolver everywhere (`splitPathEntries(resolveEnvPath(env))`) to eliminate per-callsite divergence.

#### 23) P1 - Orphaned subprocesses (OpenJDK/Erlang/Node/etc.) after index/build/test flows
- Location: `src/shared/subprocess/**`, `src/integrations/tooling/providers/lsp/**`, `src/index/tooling/**`, `tools/**`, and any direct `spawn`/`spawnSync` callsites used by indexing/testing.
- Problem: some subprocesses survive beyond their intended lifecycle (normal completion and failure paths), indicating inconsistent cleanup ownership and non-uniform use of shared process lifecycle modules.
- Baseline fix:
  - Trace all subprocess creation paths and migrate stragglers to shared subprocess lifecycle wrappers with explicit ownership scope and deterministic teardown.
  - Ensure failure paths (`throw`, timeout, abort, protocol failure) always trigger the same cleanup path as success.
- Better fix:
  - Introduce a process-lifecycle audit mode:
    - emit structured `process_spawned` and `process_reaped` events with `pid`, `ppid`, `ownershipId`, `scope`, `command`, and `origin`.
    - maintain an in-memory + optional persisted process ledger per build/test run.
  - Add end-of-run leak check:
    - compare spawned vs reaped PIDs by ownership scope,
    - probe for still-alive descendants,
    - fail gate (or hard-warn in non-gate mode) when leaked process count exceeds strict threshold.
  - Add targeted tests for abrupt-failure scenarios (timeout/abort/crash-loop) to verify no lingering child processes across platforms.

#### 28) P2 - Timeout policy misclassifies slow-pass tests as hard failures
- Location: `tests/run.js`, lane ordering files (`tests/ci-lite/ci-lite.order.txt`, `tests/ci/ci.order.txt`, `tests/ci-long/ci-long.order.txt`)
- Problem: some tests complete successfully (`stdout` says passed, `exit=0`) but are marked failed because they exceed lane timeout budget; this creates false red builds and obscures real regressions.
- Baseline fix:
  - Re-lane tests that consistently exceed `ci-lite` budget and tighten fixture/runtime setup for borderline tests.
- Better fix:
  - Add explicit timeout classification in harness output:
    - `timed_out_after_pass`,
    - `timed_out_no_pass_signal`,
    - `timed_out_with_failure`.
  - Gate policy should treat `timed_out_after_pass` as infra/laning hygiene debt (separate bucket) rather than product regression.
  - Add lane budget calibration report generated from recent timing ledger to keep lane assignments stable.

#### 29) P2 - Test wrappers hide root-cause stderr from build/search failures
- Location: shared test helpers and wrapper tests (`tests/helpers/run-node.js`, fixture index helpers, search/build wrapper callsites)
- Problem: wrappers often emit generic messages (`Failed: build index`, `Failed: search`) without forwarding the first meaningful underlying error, slowing triage.
- Baseline fix:
  - Ensure wrappers print structured stderr excerpts for failed subprocess calls.
- Better fix:
  - Add shared failure formatter utility:
    - extract first actionable signature (`ERR_*`, assertion, stack head, artifact invariant),
    - include command, cwd, exit/signal, and clipped stderr sections.
  - Standardize across build/search/api/fixture helpers so every failure message contains root signature and diagnostic context.
  - Add tests that intentionally fail subprocesses and assert root-cause forwarding is present.

---

## Suggested execution order
1. P1 integrity/safety fixes: 4, 7, 10, 11, 12, 13, 17, 23, 24, 26, 27.
2. P1 runtime correctness: 1.
3. P2 stale-state/caching correctness: 6, 8, 9, 16, 25, 29.
4. P2 cross-platform/env hardening: 18, 20, 22, 28.
5. P2 contract consistency + ergonomics: 5, 14, 15, 19, 21, 2, 3.
