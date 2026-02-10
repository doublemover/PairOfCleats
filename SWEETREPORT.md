# SWEET16 Review Report

Generated: 2026-02-10T15:41:35Z (local session)

## Scope And Method
1. Reviewed `SWEET16_ROADMAP.md` end-to-end.
2. Split all roadmap work into 5 batches.
3. Ran 5 parallel explorer-agent audits across all batches.
4. Consolidated agent findings into one severity-ranked report.

## Batch Breakdown (All Tasks)
| Batch | Phases | Total Tasks | Done `[x]` | Open `[ ]` |
| --- | --- | ---: | ---: | ---: |
| A | 16.0, 16.1, 16.2 | 109 | 95 | 14 |
| B | 16.3, 16.4, 16.5 | 132 | 132 | 0 |
| C | 16.6, 16.7, 16.8, 16.9 | 180 | 180 | 0 |
| D | 16.10, 16.11, 16.12 | 103 | 103 | 0 |
| E | 16.13, 16.14, 16.15 | 209 | 203 | 6 |
| Total | 16.0-16.15 | 733 | 713 | 20 |

## Top Findings (Severity-Ordered)
1. Critical: Phase `16.15` is marked complete while overall acceptance is still fully unchecked in `SWEET16_ROADMAP.md`.
2. High: Multiple roadmap items in `16.3-16.5` are marked done but implementation/specs disagree (cache root versioning, ledger schema/hash mismatch, comparator validation usage).
3. High: `16.0` contract tests are still missing on disk (scheduler/artifact-io/cache/ledger/merge/byte-budget/order contract suite).
4. High: `16.2` loader hardening tasks are still open (partial shard detection + JSONL fuzz coverage).
5. High: Stage1 token ID collisions are collected but not enforced/surfaced, risking silent postings correctness issues (`src/index/build/state.js`, `src/index/build/postings.js`).
6. High: Stage2 filter index build can hard-fail on missing `effectiveLang`, with fallback only after exception and only useful if a prior artifact exists (`src/retrieval/filter-index.js`, `src/index/build/artifacts.js`).
7. Medium: VFS fast-path telemetry and batched manifest row loading called out in roadmap are not present (`src/index/tooling/vfs.js`).
8. Medium: Tree-sitter scheduler plan/executor can desync if files change between planning and execution (`src/index/build/tree-sitter-scheduler/plan.js`, `src/index/build/tree-sitter-scheduler/executor.js`).
9. Medium: Bench output contracts are strong for bench-runner aggregate schema, but per-bench JSON schema coverage is incomplete (`docs/schemas/bench-runner-report.schema.json`, `tests/perf/tooling/bench/bench-output-schema.test.js`).
10. Medium: Minhash packed artifact checksum validation expected by roadmap is not implemented in writer/loader (`src/index/build/artifacts.js`, `src/shared/artifact-io/loaders.js`).

## Batch A Findings (16.0-16.2)
1. Confirmed gap: all phase `16.0` contract tests listed in roadmap are missing and unchecked.
2. Confirmed gap: `16.2.4.e` and `16.2.4.f` remain unchecked (partial shard missing-artifact detection + JSONL fuzz tests).
3. Confirmed gap: `16.2.5.e` docs update remains unchecked.
4. Possible bookkeeping mismatch: `tests/shared/artifact-io/validation-fastpath.test.js` exists, but roadmap still shows it unchecked.

### Batch A Open Items (Roadmap)
1. `tests/shared/concurrency/scheduler-contract.test.js`
2. `tests/shared/concurrency/scheduler-config-parse.test.js`
3. `tests/shared/artifact-io/artifact-io-spec-contract.test.js`
4. `tests/shared/cache/cache-key-schema.test.js`
5. `tests/indexing/build-state/build-truth-ledger-contract.test.js`
6. `tests/shared/merge/spill-merge-contract.test.js`
7. `tests/indexing/runtime/byte-budget-policy-contract.test.js`
8. `tests/shared/order/deterministic-ordering-contract.test.js`
9. Task `16.2.4.e` missing-artifact detection for partial shards
10. Task `16.2.4.f` JSONL reader fuzz tests for malformed/corrupt shards
11. `tests/shared/artifact-io/loader-fallbacks.test.js`
12. `tests/shared/artifact-io/jsonl-fuzz.test.js`
13. Task `16.2.5.e` docs update for unified pipeline
14. `tests/shared/artifact-io/validation-fastpath.test.js` status mismatch in roadmap

## Batch B Findings (16.3-16.5)
1. High: Cache root is not actually versioned though roadmap/spec claim it is (`src/shared/cache-roots.js`, `docs/specs/cache-key-invalidation.md`).
2. High: Build truth ledger docs/specs diverge from implementation format and hashing (`docs/specs/build-truth-ledger.md`, `src/index/build/build-state.js`, `src/shared/order.js`).
3. High: Determinism validation hashing uses re-serialized JSON (`JSON.stringify`) rather than exact emitted JSONL lines (`src/index/validate.js`), conflicting with deterministic-ordering spec intent.
4. Medium: Byte-budget default overflow behavior differs from policy table (`docs/specs/byte-budget-policy.md`, `src/index/build/byte-budget.js`).
5. Medium: Comparator validation guard exists in merge core but is not wired in adopters (`src/shared/merge.js`, `src/index/build/postings.js`, others).

## Batch C Findings (16.6-16.9)
1. High: Filter index build throws on missing language and can repeatedly fail generation (`src/retrieval/filter-index.js:64`, `src/index/build/artifacts.js:360`).
2. High: Token ID collision handling is non-enforcing and non-failing (`src/index/build/state.js:377`, `src/index/build/postings.js:742`).
3. High: Postings queue byte accounting is heuristic and likely underestimates memory under heavy payloads (`src/index/build/indexer/steps/process-files/postings-queue.js`).
4. Medium: SQLite build still fully materializes `chunk_meta` in JSON/columnar paths (no streaming on that branch) (`src/storage/sqlite/build/from-artifacts.js`).
5. Medium: Cache fast-reject path has limited guarding against cache index corruption scenarios (`tools/build/embeddings/cache.js`).
6. Opportunity: Skip `tokensText` generation when FTS is contentless to reduce allocations in Stage4 (`src/storage/sqlite/build/from-artifacts.js`).

## Batch D Findings (16.10-16.12)
1. High: Tree-sitter scheduler plan/execution may use stale ranges if source files change between planning/execution (`src/index/build/tree-sitter-scheduler/plan.js`, `src/index/build/tree-sitter-scheduler/executor.js`).
2. Medium: VFS lookup path does not emit telemetry for scan fallback and negative-cache hit rates despite roadmap claim (`src/index/tooling/vfs.js`).
3. Medium: VFS batch offset-read API with single handle/pool is not present despite roadmap claim (`src/index/tooling/vfs.js`).
4. Medium: Streaming context-pack path still performs linear map scan for seed resolution, leaving perf headroom (`src/context-pack/assemble.js`).

## Batch E Findings (16.13-16.15 + Acceptance)
1. Critical: Overall acceptance checklist is unchecked while phase status text states completion (`SWEET16_ROADMAP.md` summary vs acceptance section).
2. High: Bench-output contract coverage is centered on runner aggregate; per-bench JSON contract enforcement is not comprehensive.
3. High: Usage checklist test validates broad behavior but not explicit phase-by-phase usage signals (`tests/perf/indexing/validate/phase-usage-checklist.test.js`).
4. Medium: Minhash packed checksum/consistency requirement in roadmap not enforced by code (`src/index/build/artifacts.js`, `src/shared/artifact-io/loaders.js`).
5. Medium: Artifact sharded byte accounting uses logical bytes and may diverge from compressed on-disk bytes (`src/shared/json-stream.js`, spec notes).

### Batch E Open Items (Roadmap Acceptance)
1. All Phase 16 specs exist and align with contracts.
2. Cross-stage scheduler + artifact IO pipeline are in active use.
3. Cache keys are unified and invalidation is correct across caches.
4. Determinism is enforced via ledger + ordering helpers.
5. All phases have baseline/current benchmarks with deltas.
6. Usage checklist is complete and verified.

## Recommended Next Fix Order
1. Resolve roadmap truth mismatch first: update `SWEET16_ROADMAP.md` status for all open/mismatched items.
2. Land missing `16.0`/`16.2` contract+fuzz tests.
3. Fix cache-root versioning implementation (`src/shared/cache-roots.js`) or adjust docs/roadmap if intentionally deferred.
4. Reconcile ledger/order specs with runtime format and hashing implementation.
5. Add filter-index malformed-language resilience and token-ID collision enforcement policy/tests.
6. Implement/verify VFS telemetry + batch lookup path (or explicitly re-scope roadmap claims).
7. Add minhash checksum metadata + validation and add per-bench JSON schema coverage.
