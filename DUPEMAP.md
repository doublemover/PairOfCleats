# DUPEMAP — Duplication Consolidation Execution Plan

Last updated: 2026-02-10T00:11:52.8315093-05:00

Purpose: remove all confirmed duplication clusters comprehensively, efficiently, and permanently.

Primary inputs:
- `duplication_consolidation_report.md`
- `duplication_report.md`
- `duplication_report.json`

Completed phases are appended to: `COMPLETED_PHASES.md`

---

## Status legend

- [x] Implemented and validated
- [@] In progress
- [.] Implemented but not yet tested
- [?] Correctness gap or insufficient tests
- [ ] Not started

---

## Operating rules

1. Hard cutovers only.
- No compatibility aliases/shims for duplicated helpers.
- Old helper implementations are deleted in the same phase as migration.

2. Canonical ownership.
- Cross-cutting shared runtime: `src/shared/**`
- Index/build orchestration: `src/index/**`
- Storage shared internals: `src/storage/**`
- Tools must consume canonical helpers, not fork them.

3. Exhaustive migration proof.
- Every phase must add/extend duplicate-ban entries in `docs/tooling/dupemap-migration-manifest.json`.
- Every phase must run the legacy usage audit and fail on any hit.

4. Test integrity.
- Merged/refactored tests must preserve distinct scenario assertions.
- Test helpers can be shared; scenario-specific expectations cannot be collapsed away.

5. Docs/contracts alignment.
- Any changed API surface or behavior must update docs/contracts in the same phase.

6. Change sizing and merge safety.
- Execute work in small vertical slices within each subphase (single module family + linked tests).
- Do not batch unrelated subsystem rewrites in the same commit.

7. Measure-before-merge rule.
- Any phase touching hot paths must include before/after metrics in its completion notes.
- Regressions above budget require either remediation in-phase or explicit time-bound waiver.

---

## Phase summary

| Phase | Status | Scope |
| --- | --- | --- |
| D0 | [x] | Baseline mapping + execution kickoff (no new scanner tooling) |
| D1 | [@] | Shared primitive consolidation |
| D2 | [x] | JSONL merge + artifact writer scaffolding |
| D4 | [x] | ANN + API/MCP + search request normalization |
| D5 | [x] | Tooling + language parser/extractor consolidation |
| D3 | [x] | SQLite/LMDB/quantization/vocab consolidation |
| D6 | [x] | Chunking + risk + import resolution + map consolidation |
| D7 | [@] | Test/bench dedupe and harness consolidation |
| D8 | [ ] | AJV/fetch consolidation + CI hardening + closeout |
| F0 | [x] | Findings phase mapping + ownership (no new audit tooling) |
| F1 | [ ] | Build/runtime lifecycle correctness remediation |
| F2 | [ ] | Language/chunking/import correctness remediation |
| F3 | [ ] | Artifact/storage I/O correctness + crash-safety |
| F4 | [ ] | Retrieval/ANN/embeddings correctness + boundedness |
| F5 | [ ] | Tooling/LSP/service resilience + diagnostics hygiene |
| F6 | [ ] | Map/graph/context-pack correctness + cleanup safety |
| F7 | [ ] | Security/path/input hardening across surfaces |
| F8 | [ ] | Contract-test expansion + `src/**` coverage lock |
| F9 | [ ] | CI gating + burn-down closure for all findings |

---

## Frontloaded execution order (mandatory)

This roadmap is intentionally ordered to frontload highest-leverage, cross-cutting foundations first, while pairing dedupe and findings remediation in the same touchpoints to avoid rework.

### Wave U0 — Governance/control plane (must complete first)
1. `D0` Migration manifest + execution kickoff.
2. `F0` Findings mapping + ownership alignment.

### Wave U1 — Foundational primitives and invariants
3. `D1` Shared primitives consolidation.
4. `F7` Security/path/input hardening foundations (shared containment/validation helpers).
5. `F1` Lifecycle/teardown foundations that depend on `D1` primitives.

### Wave U2 — Core I/O, artifacts, storage semantics
6. `D2` JSONL merge + writer scaffolding.
7. `F3` Artifact/storage crash-safety and bounds checks.
8. `D3` Storage internals consolidation (SQLite/LMDB/quantization/vocab).

### Wave U3 — Cross-surface runtime, retrieval, tooling
9. `D4` ANN + API/MCP normalization.
10. `F4` Retrieval/ANN/embeddings reliability.
11. `D5` Tooling/language helper consolidation.
12. `F5` Tooling/LSP/service resilience.

### Wave U4 — Domain helpers and feature correctness
13. `D6` Chunking/risk/import/map helper consolidation.
14. `F2` Language/chunking/import correctness remediation.
15. `F6` Map/graph/context-pack correctness.

### Wave U5 — Consolidation, testing lock, closeout
16. `D7` Test/bench dedupe.
17. `F8` Contract-test expansion + `src/**` coverage lock.
18. `D8` Final dedupe hardening/closeout.
19. `F9` Findings burn-down closure + CI acceptance.

Rationale:
- The largest cross-cutting foundations (`D0`, `F0`, `D1`) are executed first.
- I/O and persistence contracts are handled before domain-level migrations to prevent rework.
- Cross-surface runtime/retrieval/tooling are grouped so API/MCP/retrieval/tooling changes land together.
- Contract and CI lock phases happen last, after implementation churn stabilizes.
- Section order in this document remains numeric, but execution must follow this unified wave order.

---

## Phase dependencies and gates

| Phase | Hard dependencies | Why |
| --- | --- | --- |
| D0 | None | Captures baseline mapping and execution ordering |
| D1 | D0 | Primitive helper migration follows established baseline mapping |
| D2 | D1 | JSONL/writer scaffolding depends on shared primitives |
| D4 | D1 | API/MCP/retrieval normalization requires canonical shared baseline |
| D5 | D1 | Tooling/language helper extraction depends on shared primitives |
| D3 | D1, D2 | Storage migrations depend on shared primitive + JSONL foundation work |
| D6 | D1, D5 | Domain helper consolidation depends on language/tooling shared helper extraction |
| D7 | D1, D2, D3, D4, D5, D6 | Test dedupe should happen after production codepaths stabilize |
| D8 | All prior phases | Final hardening and CI lock-in only after full migration |
| F0 | D0 | Findings mapping aligns to baseline phase ordering |
| F1 | F0, D1, D2 | Lifecycle fixes depend on foundational helpers and normalized build plumbing |
| F2 | F0, D5, D6 | Language correctness depends on consolidated language/chunking helpers |
| F3 | F0, D1, D2, D3 | Crash-safe persistence depends on shared atomic I/O + storage consolidation |
| F4 | F0, D3, D4 | Retrieval/ANN fixes depend on storage contracts and ANN/request normalization |
| F5 | F0, D4, D5 | Tooling/service parity depends on shared API/MCP/tooling helpers |
| F6 | F0, D6 | Map/graph/context-pack correctness depends on consolidated domain helpers |
| F7 | F0, D1 | Security hardening depends on shared path/input primitives |
| F8 | F0, F1, F2, F3, F4, F5, F6, F7, D7 | Contract lock is meaningful only after implementations settle |
| F9 | F0, F8, D8 | Final closure requires complete implementation and final dedupe closeout |

Gate rule:
- Do not start a phase until hard dependencies are completed and committed.
- Exceptions require explicit note in this file with reason and rollback plan.
- Touch-once rule: when a phase touches a mapped module family, apply both dedupe and findings remediations for that family in the same change series; avoid deferred second-pass rewrites.
- No correctness debt carry-forward: a known high/critical finding in touched files cannot be deferred to a later phase unless explicitly accepted with expiry.

---

## Class-level remediation coverage (from `All_Findings.md` Part 4)

| Class-level remediation | Coverage status | Implementation phases | Verification gates |
| --- | --- | --- | --- |
| 1. Mandatory shared utility policy | [ ] Planned | D1, D8 | utility-import contract tests + closeout review sweep |
| 2. Atomic write by default | [ ] Planned | D1, D2, D3, D4, D8 | atomic-write contract tests + non-atomic write ban checks |
| 3. Standardized cache lifecycle contracts | [ ] Planned | D1, D3, D4, D5, D8 | cache-policy contract tests + boundedness/lifecycle assertions |
| 4. Explicit process lifecycle and shutdown contracts | [ ] Planned | D1, D5, D8 | shutdown/drain contract tests for workers/services/watchers |
| 5. Cross-surface contract tests | [ ] Planned | D2, D4, D7, D8 | parity suites for CLI/API/MCP, artifact strictness, ANN contract, stage progression |
| 6. Regression guardrails for known bug classes | [ ] Planned | D1, D8, F8, F9 | targeted regression suites + CI lane gating |

Implementation note:
- These six remediations are mandatory completion criteria for this roadmap.
- Subphase additions below explicitly wire each remediation to concrete tasks and tests.

---

## Findings remediation program (mandatory, `All_Findings.md` Parts 1-5)

### Objective
Execute a complete remediation program for every finding recorded in `All_Findings.md`, with explicit implementation phases, test evidence, and CI gating.

### Scope statement
- In scope: all findings from baseline Sections `A`..`O`, additional findings in Parts `2A/2B/2C`, conversation addendum findings, and Part 5 `src/**` expansion findings.
- Out of scope: deferral without explicit written acceptance (owner, rationale, risk, expiry phase).

### Findings-to-phase coverage matrix

| Findings domain | Remediation phase(s) | Primary touchpoints |
| --- | --- | --- |
| A Entry points + command surfaces | F5, F9 | `bin/**`, `tools/**`, CLI command routing, guardrails |
| B Config/policy/runtime envelope | F7, F9 | `src/shared/config/**`, env allowlists, budget checks |
| C Build orchestration/lifecycle | F1, F3, F9 | `src/index/build/**`, stage/promotion/lock flows |
| D Discovery/preprocess/incremental/watch | F1, F2, F3 | `src/index/build/file-scan.js`, watch/discovery helpers |
| E Language frontends/chunking/imports | F2, F8 | `src/lang/**`, `src/index/chunking/**`, import resolution |
| F Tokenization/postings/filter indexes | F2, F3 | token ids/postings/chunk metadata paths |
| G Enrichment/tooling/type/risk | F5, F7, F8 | `src/index/tooling/**`, risk/type inference/vfs |
| H Artifact I/O/schema/contracts | F3, F8 | `src/index/build/artifacts/**`, `src/contracts/**` |
| I Storage backends/maintenance | F3, F4 | `src/storage/**`, sqlite/lmdb lifecycle |
| J Retrieval engine/query pipeline | F4, F8 | `src/retrieval/**`, query cache/provider lifecycle |
| K Embeddings + ANN infra | F4, F8 | embeddings/ANN providers/cache format |
| L Graph analyses | F6, F8 | `src/graph/**`, graph artifact readers |
| M Context pack assembly | F6, F8 | `src/context-pack/**`, artifact assembly invariants |
| N Service layer HTTP/MCP/indexer service | F5, F7, F9 | `tools/api/**`, `tools/mcp/**`, `tools/service/**` |
| O Tooling/bench/tests harness | F5, F8, F9 | test runner, logs, script-coverage, CI guards |
| Part 5 `src/**` expansion findings | F1, F2, F3, F5, F6, F7 | explicit path-level fixes listed in phases below |

### Part 5 `src/**` finding integration map

| Finding group | Resolution phase | Primary fix touchpoints |
| --- | --- | --- |
| P5-01 token-postings shard-size NaN | F3 | `src/index/build/artifacts/token-postings.js` |
| P5-02 repo-map delta disable semantics | F1 | `src/index/build/artifacts/repo-map.js` |
| P5-03 file-meta O(n²) membership | F3 | `src/index/build/artifacts/file-meta.js` |
| P5-04 watch stability off-by-one | F1 | `src/index/build/watch/stability.js` |
| P5-05 vfs manifest collector shared cleanup | F1 | `src/index/build/vfs-manifest-collector.js` |
| P5-06 scheduler miss cache unbounded | F1 | `src/index/build/tree-sitter-scheduler/lookup.js` |
| P5-07 simple language relations contract mismatch | F2 | `src/index/language-registry/registry-data.js` |
| P5-08 callsite id rejects zero-based positions | F2 | `src/index/callsite-id.js` |
| P5-09 vfs sort key lexical numeric drift | F2 | `src/index/tooling/vfs-index.js` |
| P5-10 pyright runnable false positive | F5 | `src/index/tooling/pyright-provider.js` |
| P5-11 json encode cycle overflow risk | F3 | `src/shared/json-stream/encode.js` |
| P5-12 embeddings cache decode bounds | F3 | `src/shared/embeddings-cache/format.js` |
| P5-13 bloom decode payload length mismatch | F3 | `src/shared/bloom.js` |
| P5-14 html chunking fallback null-on-parse-error | F2 | `src/lang/html.js` |
| P5-15 unguarded URI decode throw path | F5/F7 | `src/integrations/tooling/lsp/uris.js` |
| P5-16 sqlite pragmas restore completeness | F3 | `src/storage/sqlite/build/pragmas.js` |
| P5-17 map member id zero handling | F6 | `src/map/isometric/client/map-data.js` |
| P5-18 map temp cleanup on failure | F6 | `src/map/build-map.js` |

### Execution order (mandatory)

Wave F-A:
1. `F0` Findings mapping + ownership gates
2. `F1` Build/runtime lifecycle correctness
3. `F2` Language/chunking/import correctness

Wave F-B:
4. `F3` Artifact/storage I/O crash-safety
5. `F4` Retrieval/ANN/embeddings reliability
6. `F5` Tooling/LSP/service resilience

Wave F-C:
7. `F6` Map/graph/context-pack correctness
8. `F7` Security/path/input hardening
9. `F8` Contract-test expansion + coverage lock
10. `F9` CI burn-down closure + acceptance

### D/F coupling map (mandatory touch-once execution)

| Primary phase | Must co-execute with | Shared touchpoints | Coupling intent |
| --- | --- | --- | --- |
| D0 | F0 | manifests, phase mappings, ownership tables | one governance control plane for dedupe + findings |
| D1 | F7, F1 (foundation subset) | shared path/cache/lock/io primitives | eliminate duplicate helpers while hardening safety/lifecycle contracts |
| D2 | F3 | JSONL merge/writer scaffolding + artifact writes | ship atomic/bounded writer semantics with helper consolidation |
| D3 | F3, F4 (storage subset) | sqlite/lmdb/quantization/vocab internals | align storage correctness, bounds, and retrieval contracts once |
| D4 | F4, F5 (API/MCP subset) | ANN + API/MCP request/filter/cache normalization | prevent repeated parity rewrites across retrieval + service surfaces |
| D5 | F2, F5 | tooling providers + language parser/extractor helpers | pair helper consolidation with correctness/resilience fixes |
| D6 | F2, F6 | chunking/risk/import/map helpers | converge helper APIs and domain correctness in same migrations |
| D7 | F8 | test harness + contract suite structure | build stable reusable tests before final CI lock |
| D8 | F9 | closeout docs/contracts/CI gates | one final acceptance gate for both programs |

Dependency rule:
- `F0` must complete before any `F1`..`F9` completion.
- No finding can be marked resolved without test evidence linked in this roadmap.

### Performance acceleration refinements (mandatory)

P1. Perf budgets and baseline capture:
- [ ] Add `docs/tooling/perf-budgets.json` (new) with per-domain p50/p95/peak-memory budgets.
- [ ] Capture baseline before each wave and post-wave deltas after completion.
- [ ] Fail phase completion if regression exceeds budget without explicit acceptance.

P2. Hot-path complexity elimination first:
- [ ] Prioritize known O(n²) and repeated scan hotspots before feature-level rewrites.
- [ ] Add static checks for accidental list-membership-in-loop patterns in hot files.
- [ ] Track resolved hotspots in findings manifest with benchmark evidence.

P3. Bounded-memory-by-default enforcement:
- [ ] Require explicit caps/eviction for module-level maps/sets/caches.
- [ ] Add explicit boundedness assertions in targeted tests for cache-heavy modules in `src/**`.
- [ ] Add cache metrics in tests: entry count, eviction count, peak estimate.

P4. Concurrency and backpressure contracts:
- [ ] Define per-subsystem concurrency knobs and safe defaults.
- [ ] Require queue/drain semantics for long-lived workers/providers.
- [ ] Add timeout and cancellation behavior contracts for tooling/service subprocesses.

P5. I/O amplification reduction:
- [ ] Coalesce multi-write artifact paths where safe.
- [ ] Ensure streaming readers/writers enforce max-bytes early.
- [ ] Measure and track bytes written/read in representative tests.

P6. Perf regression CI gates:
- [ ] Add lightweight perf guard tests to `ci-lite` for key hot paths.
- [ ] Run fuller perf checks in `ci-long` with trend comparison artifact.
- [ ] Publish top-offender report (latency, allocations, slowest files/modules) per run.

P7. Touchpoint-level profiling protocol:
- [ ] For each wave, profile one representative large-repo run.
- [ ] Require brief profiling note (`before`, `after`, `delta`, `root cause`) in roadmap status updates.
- [ ] Use profile evidence to reprioritize next-wave tasks when bottlenecks shift.

### Phase F0 — Findings manifest and ownership

Objective:
Create a direct execution source of truth for every finding without introducing new scanner/audit tooling.

Touchpoints:
- `All_Findings.md`
- `DUPEMAP.md`
- phase status notes in roadmap updates

Subphase F0.1 — Findings mapping baseline:
- [x] Ensure all findings families are mapped to phases in `DUPEMAP.md`.
- [x] Ensure each mapped finding family has explicit touchpoints and tests.
- [x] Keep consistent finding ID references (`A-*`, ..., `P5-*`) in planning notes.

F0.1 mapping confirmation:
- Findings families `A`..`O`, addendum (`2A/2B/2C`), and `P5-*` are mapped in `Findings-to-phase coverage matrix`.
- Path-level `P5-*` ownership is mapped in `Part 5 src/** finding integration map`.
- Phase-level tests are anchored in each phase section (`F1`..`F9`) and in D/F coupling checkpoints.

Subphase F0.2 — Ownership and closure criteria:
- [x] Assign owner responsibility by phase (not by separate tooling artifact).
- [x] Define what evidence closes a finding (code path + test coverage + commit ref).
- [x] Require severity-first burn-down ordering inside each phase.

F0.2 owner matrix (phase-scoped):
| Phase | Primary owner group |
| --- | --- |
| F1 | Build/runtime lifecycle |
| F2 | Language/chunking/import |
| F3 | Artifact/storage I/O and persistence |
| F4 | Retrieval/ANN/embeddings |
| F5 | Tooling/LSP/service surfaces |
| F6 | Map/graph/context-pack |
| F7 | Security/path/input hardening |
| F8 | Contract tests and coverage lock |
| F9 | CI gating and burn-down closure |

F0.2 closure evidence standard:
- A finding closes only with `code path` + `test evidence` + `commit reference` recorded in phase notes.
- `Code path` must list concrete changed files/functions and the invariant they enforce.
- `Test evidence` must name exact test files/commands and pass outcome.
- `Commit reference` must include at least one commit hash that contains the fix and tests.
- Burn-down order is severity-first inside each phase: `critical` then `high` then remaining severities, unless dependency constraints are explicitly documented.

Subphase F0.3 — Execution discipline:
- [x] Require phase updates to include resolved/remaining findings summary.
- [x] Block phase closeout when high/critical mapped findings for that phase are unresolved unless explicitly accepted with expiry.

F0.3 required phase findings update block:
- `resolved`: finding IDs closed in the phase (with commit refs and tests).
- `remaining`: finding IDs still open in phase scope.
- `severity snapshot`: count by severity (`critical/high/medium/low`) at phase start and phase end.
- `exceptions`: accepted deferrals with owner, reason, risk, and explicit expiry phase.

F0.3 closeout gate:
- A phase cannot be marked complete while any mapped `critical` or `high` finding remains unresolved unless an exception entry is recorded with expiry and owner.
- Exception records must be explicit, time-bound, and reviewed in the next dependent phase before additional scope expansion.

Tests:
- [x] no new tooling tests required in F0; enforce through phase-level remediation tests in F1-F9

Exit criteria:
- [x] Every finding family from `All_Findings.md` is mapped to at least one execution phase.
- [x] No standalone scanner/audit tooling work remains in F0.

### Phase F1 — Build/runtime lifecycle correctness

Objective:
Fix lifecycle, stage, lock, and runtime invariants in the indexing pipeline.

Touchpoints:
- `src/index/build/indexer/**`
- `src/index/build/runtime/**`
- `src/index/build/watch/**`
- `src/index/build/tree-sitter-scheduler/**`
- `src/index/build/vfs-manifest-collector.js`
- `src/index/build/artifacts/repo-map.js`

Subphase F1.1 — Stage progression and promotion correctness:
- [ ] Fix stage/promotion ordering findings from C/addendum (including partial promotion and stage-state visibility).
- [ ] Enforce per-stage fail-closed semantics; no silent stage failure.
- [ ] Ensure `build_state/current` progression reflects stage4 sqlite work when enabled.

Subphase F1.2 — Lock/process teardown correctness:
- [ ] Guarantee lock handler detachment and teardown execution even when release paths fail.
- [ ] Ensure subprocess timeout-kill logic is cancellation-safe and reports deterministic outcomes.
- [ ] Enforce deterministic shutdown ordering for runtime teardown on both success and failure.

Subphase F1.3 — Watch/scheduler/runtime hot-path issues:
- [ ] Fix `checks=1` off-by-one in `src/index/build/watch/stability.js:18`.
- [ ] Bound scheduler miss cache in `src/index/build/tree-sitter-scheduler/lookup.js:27`.
- [ ] Isolate collector run directories and cleanup ownership in `src/index/build/vfs-manifest-collector.js:124`.
- [ ] Fix delta-disable behavior in `src/index/build/artifacts/repo-map.js:60`.

Tests:
- [ ] `tests/indexing/build/stage-progression-contract.test.js` (from D8)
- [ ] `tests/indexing/build/promotion-timing-contract.test.js` (from D8)
- [ ] `tests/indexing/watch/watch-stability-checks.test.js` (new)
- [ ] `tests/indexing/tree-sitter/scheduler-miss-cache-bounded.test.js` (new)
- [ ] `tests/indexing/vfs/vfs-manifest-collector-isolation.test.js` (new)
- [ ] `tests/indexing/artifacts/repo-map-delta-eligibility.test.js` (new)

Exit criteria:
- [ ] No known stage lifecycle findings remain open.
- [ ] Long-running watch/scheduler paths are bounded and test-proven.

### Phase F2 — Language/chunking/import correctness

Objective:
Eliminate correctness drift in chunking, relations, offsets, and import extraction.

Touchpoints:
- `src/lang/**`
- `src/index/language-registry/**`
- `src/index/chunking/**`
- `src/index/callsite-id.js`
- `src/index/tooling/vfs-index.js`

Subphase F2.1 — Relations and import extraction:
- [ ] Fix simple-language relation importer contract mismatch in `src/index/language-registry/registry-data.js:419`.
- [ ] Complete Python relative import extraction and case-collision deterministic handling findings.
- [ ] Eliminate import candidate/path normalization divergence (shared helper path).

Subphase F2.2 — Chunking and parser fallback behavior:
- [ ] Fix HTML fallback behavior in `src/lang/html.js:408` to retain chunks on `parse5` failure.
- [ ] Standardize end-offset semantics (exclusive vs inclusive) across Python/TS and chunk boundaries.
- [ ] Remove duplicate/heuristic divergence in language chunk builders through shared contracts.

Subphase F2.3 — Callsite and ordering correctness:
- [ ] Allow `0`-based positions in `src/index/callsite-id.js:4`.
- [ ] Fix numeric ordering key in `src/index/tooling/vfs-index.js:12`.
- [ ] Verify callsite IDs and segment ordering parity across providers.

Tests:
- [ ] `tests/lang/contracts/simple-language-relations-contract.test.js` (new)
- [ ] `tests/lang/contracts/html-chunking-fallback.test.js` (new)
- [ ] `tests/lang/contracts/end-offset-normalization.test.js` (new)
- [ ] `tests/indexing/callsite-id/callsite-id-zero-based.test.js` (new)
- [ ] `tests/indexing/tooling/vfs-sort-key-numeric-order.test.js` (new)
- [ ] existing per-language metadata/relations suites expanded to contract assertions

Exit criteria:
- [ ] All language/import/chunking correctness findings mapped to resolved tests.
- [ ] Per-language relation and chunk contracts pass across supported languages.

### Phase F3 — Artifact/storage I/O crash-safety

Objective:
Enforce fail-closed, bounded, and atomic behavior for artifacts, manifests, and storage I/O.

Touchpoints:
- `src/index/build/artifacts/**`
- `src/shared/json-stream/**`
- `src/storage/sqlite/**`
- `src/storage/lmdb/**`
- `src/shared/io/**` (atomic write helpers)

Subphase F3.1 — Atomic persistence enforcement:
- [ ] Migrate manifest/cache/queue/pointer writes to shared atomic-write APIs.
- [ ] Ban direct non-atomic writes for stateful files via targeted sweeps and regression tests.
- [ ] Fix non-atomic persistence findings in incremental/cache/query-plan/tooling caches.

Subphase F3.2 — Bounds/safety checks in readers/decoders:
- [ ] Add cycle detection in `src/shared/json-stream/encode.js:20`.
- [ ] Enforce vector-section bounds in `src/shared/embeddings-cache/format.js:85`.
- [ ] Validate bloom payload length in `src/shared/bloom.js:102`.
- [ ] Resolve FD guard and varint/read-bound findings in artifact readers.

Subphase F3.3 — Storage lifecycle correctness:
- [ ] Restore captured pragmas in `src/storage/sqlite/build/pragmas.js:95`.
- [ ] Fix token posting shard-size NaN hazard in `src/index/build/artifacts/token-postings.js:29`.
- [ ] Remove O(n²) artifact merge hotspots such as `file-meta` membership checks.

Tests:
- [ ] `tests/shared/io/atomic-write-contract.test.js` (from D1)
- [ ] `tests/shared/json-stream/json-encode-cycle-guard.test.js` (new)
- [ ] `tests/shared/embeddings-cache/decode-vector-bounds.test.js` (new)
- [ ] `tests/shared/bloom/bloom-decode-length-contract.test.js` (new)
- [ ] `tests/storage/sqlite/pragmas-restore-contract.test.js` (new)
- [ ] `tests/indexing/artifacts/token-postings-shard-size-guard.test.js` (new)
- [ ] `tests/indexing/artifacts/file-meta-membership-performance.test.js` (new)

Exit criteria:
- [ ] No unbounded/corrupting reader-writer paths remain in artifact/storage hot paths.
- [ ] Atomic-write-by-default gate passes in CI.

### Phase F4 — Retrieval/ANN/embeddings reliability

Objective:
Resolve retrieval/ANN/provider/cache correctness drift and ensure bounded resource behavior.

Touchpoints:
- `src/retrieval/**`
- `src/storage/sqlite/quantization.js`
- `src/storage/sqlite/vocab.js`
- embeddings provider/cache initialization modules

Subphase F4.1 — Provider lifecycle and fallback behavior:
- [ ] Remove sticky-disable-once behavior for providers; add retry/backoff/reset semantics.
- [ ] Resolve ONNX/transformer initialization poison-cache issues.
- [ ] Close connection/table lifecycle gaps for ANN backends.

Subphase F4.2 — Scoring/contract semantics:
- [ ] Normalize ANN similarity semantics by metric/backend contract.
- [ ] Correct `annType`/`annSource` semantics.
- [ ] Resolve query negation/exclude semantics drift and stale signature cache behavior.

Subphase F4.3 — Cache boundedness:
- [ ] Enforce bounded query-plan/index signature/provider caches with TTL + capacity.
- [ ] Validate cache invalidation on configuration/signature drift.

Tests:
- [ ] `tests/retrieval/ann/ann-candidate-set-contract.test.js` (from D4)
- [ ] `tests/retrieval/ann/similarity-metric-contract.test.js` (new)
- [ ] `tests/retrieval/providers/provider-retry-reset-contract.test.js` (new)
- [ ] `tests/retrieval/cache/query-plan-cache-bounds.test.js` (new)
- [ ] `tests/retrieval/cache/index-signature-cache-bounds.test.js` (new)
- [ ] `tests/indexing/embeddings/provider-init-retry-contract.test.js` (new)

Exit criteria:
- [ ] Retrieval and ANN behavior are contract-tested and backend-consistent.
- [ ] Provider/cache paths are bounded and recover from transient failures.

### Phase F5 — Tooling/LSP/service resilience

Objective:
Stabilize tooling provider behavior, diagnostics flow, and service resource usage.

Touchpoints:
- `src/index/tooling/**`
- `src/integrations/tooling/**`
- `tools/api/**`
- `tools/mcp/**`
- `tools/service/**`

Subphase F5.1 — LSP provider hardening:
- [ ] Guard URI decode in `src/integrations/tooling/lsp/uris.js:21`.
- [ ] Replace executable-existence shortcuts with runnable checks in `src/index/tooling/pyright-provider.js:37`.
- [ ] Ensure timeout/circuit-breaker behavior degrades gracefully with actionable diagnostics.

Subphase F5.2 — Diagnostics/logging boundedness:
- [ ] Bound tooling diagnostics buffers and dedupe queues.
- [ ] Ensure byte-accurate logging/output accounting and timeout termination reporting.
- [ ] Remove silent-failure paths in service subprocess logging.

Subphase F5.3 — API/MCP/service parity contracts:
- [ ] Complete request/filter/cache config parity from D4 plus service runtime checks.
- [ ] Add service-level lifecycle tests for worker shutdown and queue drain.

Tests:
- [ ] `tests/integrations/lsp/uri-decode-malformed-input.test.js` (new)
- [ ] `tests/indexing/tooling/pyright-runnable-detection.test.js` (new)
- [ ] `tests/tooling/logging/output-byte-accounting.test.js` (new)
- [ ] `tests/tooling/service/subprocess-buffer-bounds.test.js` (new)
- [ ] `tests/tooling/api-mcp/search-request-parity.test.js` (from D4)
- [ ] `tests/indexing/lifecycle/shutdown-drain-contract.test.js` (from D8)

Exit criteria:
- [ ] Tooling and service failure modes are bounded, recoverable, and test-covered.

### Phase F6 — Map/graph/context-pack correctness

Objective:
Resolve functional correctness and cleanup/lifecycle gaps in map/graph/context-pack paths.

Touchpoints:
- `src/map/**`
- `src/graph/**`
- `src/context-pack/**`

Subphase F6.1 — Map correctness and cleanup:
- [ ] Fix member-id zero handling in `src/map/isometric/client/map-data.js:28`.
- [ ] Ensure cleanup in `src/map/build-map.js:365` always executes via `finally`.
- [ ] Verify filter/collapse/escape semantics after D6 helper consolidation.

Subphase F6.2 — Graph/context-pack contracts:
- [ ] Validate graph artifact assembly contracts for ordering/edge consistency.
- [ ] Validate context-pack assembly deterministic ordering and bound checks.

Tests:
- [ ] `tests/map/isometric/member-id-zero-contract.test.js` (new)
- [ ] `tests/map/build-map/temp-cleanup-on-failure.test.js` (new)
- [ ] `tests/graph/contracts/graph-artifact-ordering-contract.test.js` (new)
- [ ] `tests/context-pack/contracts/context-pack-determinism.test.js` (new)

Exit criteria:
- [ ] Map/graph/context-pack findings are closed with deterministic contract tests.

### Phase F7 — Security/path/input hardening

Objective:
Close cross-cutting security and unsafe-input findings with shared hardened utilities.

Touchpoints:
- path normalization and containment helpers
- VFS disk-path resolution and URI decode paths
- artifact/schema/manifest parsing boundaries

Subphase F7.1 — Path traversal and containment:
- [ ] Resolve VFS/baseDir escape findings and enforce canonical containment checks.
- [ ] Remove platform separator ambiguity in path validation.
- [ ] Add hard fail behavior for out-of-root resolutions.

Subphase F7.2 — Input validation and fail-closed behavior:
- [ ] Enforce strict type validation for manifest/config max-byte settings.
- [ ] Enforce reader bounds across JSONL/varint/file-descriptor flows.
- [ ] Add malformed URI and malformed payload tests for all public decode entry points.

Tests:
- [ ] `tests/shared/path-normalize/path-containment-contract.test.js` (from D1)
- [ ] `tests/indexing/vfs/vfs-path-traversal-deny.test.js` (new)
- [ ] `tests/shared/jsonl/read-row-max-bytes-enforced.test.js` (new)
- [ ] `tests/contracts/manifest-max-bytes-validation.test.js` (new)

Exit criteria:
- [ ] Security-relevant findings are fixed with explicit deny-path tests.

### Phase F8 — Contract-test expansion + coverage lock

Objective:
Turn one-off bug fixes into enduring contract coverage and keep full `src/**` coverage current.

Touchpoints:
- `tests/**` contract suites
- `docs/tooling/src-review-unreviewed-batches-2026-02-10.md`
- findings manifest and script-coverage tooling

Subphase F8.1 — Contract suite expansion:
- [ ] Add/upgrade contract suites across build, language, retrieval, storage, map, and tooling domains.
- [ ] Ensure each resolved finding references a corresponding contract or regression test.
- [ ] Ensure all new tests use shared env helper (`PAIROFCLEATS_TESTING` setup).

Subphase F8.2 — `src/**` review coverage lock:
- [ ] Add script to compute `src/**` files not explicitly covered by findings references.
- [ ] Fail CI if review coverage drops below required threshold (target: 100% explicitly referenced coverage state).
- [ ] Regenerate and version controlled coverage listing when intentional scope changes occur.

Tests:
- [ ] `tests/tooling/findings/findings-test-evidence-contract.test.js` (new)
- [ ] `tests/tooling/findings/src-review-coverage-lock.test.js` (new)
- [ ] existing tooling/docs/tests updated to reflect current intended state

Exit criteria:
- [ ] Every resolved finding is test-backed.
- [ ] `src/**` review coverage lock is CI-enforced.

### Phase F9 — CI burn-down closure and acceptance

Objective:
Close the entire findings burn-down with objective acceptance gates and no hidden debt.

Touchpoints:
- `.github/workflows/**`
- findings status and lane reports
- `All_Findings.md` status tables
- `DUPEMAP.md` phase checklists

Subphase F9.1 — CI gate integration:
- [ ] Add findings unresolved summary checks to CI workflows using existing phase status artifacts.
- [ ] Require pass of relevant contract suites per touched domains.
- [ ] Ensure shard/lane selection includes all findings-related suites in `ci-lite`/`ci`/`ci-long`.

Subphase F9.2 — Closure and documentation sync:
- [ ] Update `All_Findings.md` statuses to resolved/accepted with commit and test evidence.
- [ ] Remove or archive superseded temporary tests once replaced by stable contracts.
- [ ] Produce final remediation report artifact with unresolved count = 0 (or accepted-risk ledger only).

Tests:
- [ ] CI smoke for findings status gate integration
- [ ] lane-level validation that all findings suites are discoverable

Exit criteria:
- [ ] All required findings are resolved or explicitly accepted with risk records.
- [ ] No unresolved high/critical findings remain.
- [ ] Findings program is ready to move to `COMPLETED_PHASES.md` with the duplication program.

---

## Cluster mapping

| Cluster | Phase |
| --- | --- |
| 1 JSONL merge/spill helpers | D2 |
| 2 JSONL writer scaffolding + extension resolution | D2 |
| 3 SQLite build pipeline duplication | D3 |
| 4 SQLite src/tools duplicate helpers | D3 |
| 5 Embedding quantization normalization | D3 |
| 6 SQLite vocab lookup + stmt cache | D3 |
| 7 LMDB codec/presence/meta validation | D3 |
| 8 ANN readiness + backend normalization | D4 |
| 9 API/MCP request mapping drift | D4 |
| 10 Path normalization + containment | D1 |
| 11 Find-upwards logic | D1 |
| 12 Map-based LRU duplicates | D1 |
| 13 Bytes/size formatting + traversal | D1 |
| 14 warn-once variants | D1 |
| 15 Minified-file detection | D1 |
| 16 Root normalization duplicates | D1 |
| 17 File locking variants | D1 |
| 18 Chunking helper duplication | D6 |
| 19 Risk utility duplication | D6 |
| 20 Relative import resolution duplication | D6 |
| 21 Binary discovery helper duplication | D5 |
| 22 TypeScript loader duplication | D5 |
| 23 Signature parsing/readSignatureLines duplication | D5 |
| 24 JS/TS relations duplication | D5 |
| 25 Map filter/escape/config merge duplication | D6 |
| 26 AJV validation scaffolding duplication | D8 |
| 27 Misc helper duplicates | D1/D4/D8 |
| Additional: duplicate `resolveJsonlExtension` within `src/shared/json-stream.js` | D2 |
| Additional: duplicate `normalizeMetaFilters` in API/MCP | D4 |
| Additional: map bench wiring duplication | D7 |
| Additional: repo cache default duplication | D4 |

---

## Documentation update matrix (mandatory per phase)

Rules:
- Complete the phase-specific documentation task in the same commit series as the phase implementation.
- If behavior/contracts/config/scripting changed, update the listed docs before phase completion.
- If no listed doc requires changes, record a one-line `no-doc-change` rationale in phase notes with timestamp.

Phase documentation tasks:

- [ ] Task D0.DOC: Update migration and guardrail docs.
Documents: `docs/tooling/dupemap-migration-manifest.json`, `DUPEMAP.md`, `All_Findings.md`, `docs/guides/commands.md`, `docs/config/inventory.json`, `docs/config/inventory.md`.

- [ ] Task D1.DOC: Update shared primitive and lifecycle contract docs.
Documents: `docs/specs/*` (shared primitive usage specs touched by migration), `docs/contracts/*` (shared runtime contract docs touched by helper changes), `docs/config/inventory.json`, `docs/config/inventory.md`.

- [ ] Task D2.DOC: Update artifact/JSONL streaming and writer docs.
Documents: `docs/contracts/schemas/*` (artifact schemas touched), `docs/specs/*` (artifact writer behavior docs touched), `docs/sqlite/incremental-updates.md`, `docs/tooling/script-inventory.json`.

- [ ] Task D3.DOC: Update SQLite/LMDB/quantization/vocab docs.
Documents: `docs/sqlite/*`, `docs/contracts/schemas/*` (storage/index schemas touched), `docs/specs/*` (storage behavior docs touched), `docs/config/inventory.json`.

- [ ] Task D4.DOC: Update ANN/API/MCP/search normalization docs.
Documents: `docs/api/mcp-server.md`, `docs/contracts/mcp-tools.schema.json`, `docs/specs/tooling-and-api-contract.md`, `docs/guides/commands.md`, `docs/benchmarks/*` (if query/ann behavior or defaults changed).

- [ ] Task D5.DOC: Update tooling and language parser/extractor docs.
Documents: `docs/language/*`, `docs/testing/*` (if test harness/expectation changed), `docs/specs/*` (tooling behavior docs touched), `docs/guides/commands.md`.

- [ ] Task D6.DOC: Update chunking/risk/import/map behavior docs.
Documents: `docs/language/*`, `docs/specs/*` (chunking/risk/import/map behavior docs touched), `docs/contracts/*` (if output contracts changed), `docs/testing/*`.

- [ ] Task D7.DOC: Update test/bench harness and script coverage docs.
Documents: `docs/testing/*`, `docs/benchmarks/*`, `docs/tooling/script-inventory.json`, `docs/guides/commands.md`.

- [ ] Task D8.DOC: Final dedupe docs/contracts/config sync.
Documents: `docs/guides/commands.md`, `docs/config/inventory.json`, `docs/config/inventory.md`, `docs/contracts/*`, `docs/schemas/*`, `docs/tooling/script-inventory.json`.

- [ ] Task F0.DOC: Findings program control-plane docs.
Documents: `All_Findings.md`, `DUPEMAP.md`, `docs/guides/commands.md`.

- [ ] Task F1.DOC: Build/runtime lifecycle findings docs.
Documents: `docs/contracts/schemas/build-state.js` (and related contract docs in `docs/contracts/*`), `docs/sqlite/incremental-updates.md`, `docs/specs/*` (build/stage lifecycle docs touched).

- [ ] Task F2.DOC: Language/chunking/import correctness docs.
Documents: `docs/language/*`, `docs/contracts/*` (language output contracts touched), `docs/testing/*` (new contract-test expectations).

- [ ] Task F3.DOC: Artifact/storage crash-safety docs.
Documents: `docs/contracts/schemas/*` (artifact/storage schema docs touched), `docs/sqlite/*`, `docs/specs/*` (I/O safety behavior docs touched), `docs/testing/*`.

- [ ] Task F4.DOC: Retrieval/ANN/embeddings reliability docs.
Documents: `docs/benchmarks/*`, `docs/specs/tooling-and-api-contract.md` (if retrieval contract changes), `docs/contracts/*` (retrieval/ANN contracts touched), `docs/perf/*`.

- [ ] Task F5.DOC: Tooling/LSP/service resilience docs.
Documents: `docs/api/*`, `docs/specs/*` (tooling/service behavior docs touched), `docs/guides/commands.md`, `docs/testing/*`.

- [ ] Task F6.DOC: Map/graph/context-pack correctness docs.
Documents: `docs/specs/*` (map/graph/context-pack behavior docs touched), `docs/testing/*`, `docs/benchmarks/*` (if perf-sensitive map/graph behavior changed).

- [ ] Task F7.DOC: Security/path/input hardening docs.
Documents: `docs/contracts/*` (validation constraints touched), `docs/config/*` (new knobs/limits), `docs/specs/*` (security constraints), `docs/guides/*` (user-facing behavior changes).

- [ ] Task F8.DOC: Contract-test expansion and coverage-lock docs.
Documents: `docs/testing/*`, `docs/tooling/script-inventory.json`, `docs/guides/commands.md`, `docs/tooling/src-review-unreviewed-batches-2026-02-10.md` (or successor file).

- [ ] Task F9.DOC: Final findings closure docs.
Documents: `All_Findings.md`, `DUPEMAP.md`, `docs/worklogs/*`, `docs/guides/commands.md`.

---

## Global checklist for every migration task

- [ ] Define canonical target module and public API.
- [ ] Add manifest entry with old symbol/path -> replacement.
- [ ] Migrate all callsites.
- [ ] Delete duplicate implementation(s).
- [ ] Add/adjust tests validating canonical path behavior.
- [ ] Run targeted sweep queries and targeted tests.
- [ ] Update docs/contracts if behavior or options changed.

Subphase ordering rule (applies to D1-D8):
1. Foundation extraction: create/lock canonical helper API.
2. Migration pass: move all consumers to canonical API.
3. Deletion pass: remove duplicate bodies and dead exports.
4. Enforcement pass: run sweeps to verify no legacy callsites remain in touched scope.
5. Validation pass: run targeted tests, then lane subset.

---

## Phase D0 — Baseline and migration guardrails

### Objective
Freeze baseline mapping and move immediately into direct remediation work (no new scanner tooling).

### Files
- `docs/tooling/dupemap-migration-manifest.json` (new)
- `DUPEMAP.md`
- `All_Findings.md`
- `docs/guides/commands.md` (update)

### Subphase D0.1 — Manifest and schema
Tasks:
- [x] Task D0.1.a: Create manifest schema sections: `clusters`, `migrations`, `banPatterns`, `exceptions`.
Details: Each migration entry must include `phase`, `oldPathOrSymbol`, `newPathOrSymbol`, `status`.
- [x] Task D0.1.b: Populate initial entries for all 27 clusters plus 4 additional verified clusters.
Details: No placeholder entries; every cluster must have concrete symbols/files.
- [x] Task D0.1.c: Add explicit exception semantics.
Details: Exception entry requires reason + expiry phase; no permanent exceptions.

### Subphase D0.2 — Fix-first execution sequencing
Tasks:
- [x] Task D0.2.a: Convert D0 plan from tooling-build to direct-fix execution.
Details: No additional scanner or audit tools are added in D0.
- [x] Task D0.2.b: Keep remediation slices small and touchpoint-coupled.
Details: Prioritize high-severity and cross-cutting fixes first.
- [x] Task D0.2.c: Confirm each upcoming phase has concrete code/test/doc tasks before implementation.
Details: Avoid generic “infra-first” work that does not fix findings directly.

Execution directives (D0.2 lock-in):
- No new scanner/audit script deliverables are allowed in D0, F0, or as prerequisites for D1+ phase starts.
- Every phase kickoff must name concrete code touchpoints, concrete tests, and concrete docs/contracts updates in the phase body.
- Subphase commits must remain small and touchpoint-coupled: one module family + linked tests + linked docs/contracts updates.
- Within each phase, execute highest-severity and highest-fanout findings first unless an explicit dependency blocks them.

### Subphase D0.3 — Existing-lane enforcement only
Tasks:
- [x] Task D0.3.a: Use existing lane and targeted-test workflow as enforcement.
Details: Fixes are validated through phase tests and existing CI lanes.
- [x] Task D0.3.b: Do not add new scanner/audit scripts as D0 deliverables.
Details: Keep momentum on direct remediation.

Enforcement constraints (D0.3 lock-in):
- Validation for all follow-on phases uses targeted test files plus existing lane subsets (`ci-lite` minimum), not new D0 scanner deliverables.
- Sweep enforcement is done through documented `rg` checks in each phase body and CI lane assertions already present in the repository.
- Any proposal to add scanner/audit tooling must be tied to a later phase objective and cannot block active remediation.

### Tests
- [x] no new D0-specific tooling tests required

### Exit criteria
- [x] Manifest exists and covers all known clusters.
- [x] D0 is explicitly configured for fix-first execution with no new scanner/audit tooling tasks.
- [x] D0.DOC note (2026-02-09T20:54:16-05:00): no additional docs beyond `DUPEMAP.md` and `docs/tooling/dupemap-migration-manifest.json` required for this subphase conversion.

---

## Phase D1 — Shared primitive consolidation

### Objective
Consolidate high fan-out primitives and remove drift-prone helper forks.

### Scope
Clusters: 10, 11, 12, 13, 14, 15, 16, 17 and `escapeRegex`/`pickMinLimit` from 27.

### Canonical targets
- `src/shared/path-normalize.js`
- `src/shared/fs/find-upwards.js` (new)
- `src/shared/cache.js`
- `src/shared/disk-space.js`
- `src/shared/logging/warn-once.js` (new)
- `src/index/build/watch/shared.js` (new)
- `src/shared/locks/file-lock.js` (new)
- `src/shared/text/escape-regex.js` (new)
- `src/index/build/runtime/limits.js` (new)

### Subphase D1.1 — Path and find-upwards utilities
Tasks:
- [x] Task D1.1.a: Add `findUpwards(startDir, predicate, stopDir)`.
Details: Must support deterministic stop condition and symlink-safe behavior.
- [x] Task D1.1.b: Migrate `findGitRoot`, `findJjRoot`, tsconfig search, and repo-root walkups.
Details: Preserve existing stop behavior via predicate wrappers.
- [x] Task D1.1.c: Consolidate path containment checks.
Details: Replace `isInside`/`isPathUnderDir` variants with shared helper.

D1.1 status update (2026-02-09T21:10:22.3605834-05:00):
- resolved: D1.1 dedupe slice for upward walkups and path containment (`findUpwards`, `isPathUnderDir`) with migrated callsites in scm/tooling/repo-path helpers.
- remaining: D1.2–D1.5 tasks and all associated shared primitive migrations.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg "findGitRoot|findJjRoot|resolveNearestTsconfig|find-up" src tools` and `rg "const isInside|function isInside|const isPathUnderDir|function isPathUnderDir" src tools`.

### Subphase D1.2 — Cache/LRU and logging primitives
Tasks:
- [x] Task D1.2.a: Add shared warn-once API supporting keyed and unkeyed usage.
Details: Support logger injection and deterministic key formatting.
- [x] Task D1.2.b: Replace custom Map-LRU implementations with shared cache APIs.
Details: Preserve eviction semantics where externally observable.

D1.2 status update (2026-02-09T21:21:47.5908780-05:00):
- resolved: shared `warn-once` primitive added and migrated in scm/retrieval/json-stream/tooling vector-extension callsites.
- resolved: retrieval cache wrappers (`index`, `sqlite`, `query-plan`) and bounded VFS/scheduler LRU maps now use shared cache APIs.
- remaining: D1.3–D1.5 tasks and additional cache policy/lifecycle contracts.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.

### Subphase D1.3 — Bytes/size/minified/root normalization
Tasks:
- [x] Task D1.3.a: Standardize `formatBytes` usage on `src/shared/disk-space.js`.
Details: Pick one output format and update docs/tests accordingly.
- [x] Task D1.3.b: Standardize directory size traversal helper.
Details: Ensure same skip/exclude policy across tool and runtime.
- [x] Task D1.3.c: Move minified-name/root-normalization to watch shared helper.
Details: Delete local regex/function copies in discover/watch modules.
- [x] Task D1.3.d: Resolve `watch.js` `normalizeRoot` inconsistency during migration.
Details: Ensure watch uses imported helper only.

D1.3 status update (2026-02-09T21:32:49.8741942-05:00):
- resolved: centralized byte formatting and traversal on `src/shared/disk-space.js` via canonical `formatBytes` and `sizeOfPath`.
- resolved: migrated `src/integrations/core/status.js`, `tools/index/cache-gc.js`, `tools/index/report-artifacts.js`, and merge bench scripts to the shared disk-space helper APIs.
- resolved: extracted watch minified/root primitives to `src/index/build/watch/shared.js` and migrated discover/file-scan/watch/guardrails/records callsites.
- remaining: D1.4–D1.5 locking, atomic-write, cache-policy, and lifecycle primitives.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg "const normalizeRoot =|MINIFIED_NAME_REGEX" src/index/build` and `rg "formatBytes\(|sizeOfPath\(" src tools`.

### Subphase D1.4 — Locking and misc primitive helpers
Tasks:
- [x] Task D1.4.a: Implement shared file-lock primitive with stale detection + process-alive checks.
Details: Support configurable lock wait/poll/stale thresholds.
- [x] Task D1.4.b: Migrate index lock, embeddings cache lock, and service queue lock.
Details: Preserve lock scope names and signal handling semantics.
- [x] Task D1.4.c: Add shared `escapeRegex` and `pickMinLimit` helpers; migrate all variants.
Details: Remove duplicate helper bodies after migration.

D1.4 status update (2026-02-09T21:44:53.3841764-05:00):
- resolved: added canonical file locking primitive in `src/shared/locks/file-lock.js` with configurable wait/poll/stale behavior, stale-owner cleanup, and owner-safe release.
- resolved: migrated index/build lock path, embeddings cache lock path, service queue lock path, and sourcekit host lock gating to shared locking.
- resolved: added `src/shared/text/escape-regex.js` and `src/index/build/runtime/limits.js` then migrated duplicate `escapeRegex` and `pickMinLimit` implementations.
- remaining: D1.5 atomic-write, cache-policy, and lifecycle primitives plus associated migrations.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg "escapeRegex\(|pickMinLimit\(" src tools` and `rg "index\.lock|queue\.lock|staleMs|tasklist" src tools`.

### Subphase D1.5 — Atomic write + cache/process lifecycle primitives
Tasks:
- [x] Task D1.5.a: Implement shared `atomicWriteJson` and `atomicWriteText` helpers.
Details: Require temp-file + fsync + rename semantics with Windows-safe behavior and deterministic error surfaces.
- [x] Task D1.5.b: Implement shared cache policy contract helper.
Details: Every cache declares max entries/bytes, TTL, invalidation trigger, and shutdown cleanup hook.
- [x] Task D1.5.c: Implement shared lifecycle registry for timers/workers/promises.
Details: Support explicit `register` + `drain` + `close` flow for deterministic shutdown.
- [x] Task D1.5.d: Migrate high-fanout state/cache writes and lifecycle users to shared helpers.
Details: Prioritize queue/cache/manifest/pointer writers and long-lived service/watch/tooling modules.

D1.5 status update (2026-02-09T22:03:59.5825755-05:00):
- resolved: added `src/shared/io/atomic-write.js` with `atomicWriteJson` and `atomicWriteText` (temp-write + fsync + rename + deterministic error wrapping).
- resolved: added `src/shared/cache/policy.js` with explicit cache policy contract (`maxEntries`, `maxBytes`, `ttlMs`, invalidation trigger, shutdown hook).
- resolved: added `src/shared/lifecycle/registry.js` with `register`, `registerTimer`, `registerWorker`, `registerPromise`, `drain`, and `close`.
- resolved: migrated priority state/cache/manifest/pointer writers to atomic write helper (`src/index/build/import-resolution-cache.js`, `src/index/build/incremental.js`, `tools/service/queue.js`, `src/retrieval/cli/run-search-session.js`, `src/index/build/build-state.js`, `src/index/build/promotion.js`).
- resolved: migrated long-lived timer/promise flows to lifecycle registry in `src/index/build/build-state.js` and `tools/service/indexer-service.js`.
- remaining: D2+ phase work remains (JSONL merge/writer scaffolding and later phases).
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg "writeFileSync\(|writeFile\(|appendFile\(" src tools | rg -v "atomic-write|tests/"` and `rg "new Map\(|new Set\(" src | rg "cache|memo|seen|warn" | rg -v "max|ttl|limit|capacity|tests/"`.

### Exhaustive sweeps
- [x] `rg "const normalizeRoot =|MINIFIED_NAME_REGEX" src/index/build`
- [x] `rg "findGitRoot|findJjRoot|resolveNearestTsconfig|find-up" src tools`
- [x] `rg "warned = new Set|warnOnce" src tools`
- [x] `rg "formatBytes\(|sizeOfPath\(" src tools`
- [x] `rg "escapeRegex\(|pickMinLimit\(" src tools`
- [x] `rg "index\.lock|queue\.lock|staleMs|tasklist" src tools`
- [x] `rg "writeFileSync\(|writeFile\(|appendFile\(" src tools | rg -v "atomic-write|tests/"`
- [x] `rg "new Map\(|new Set\(" src | rg "cache|memo|seen|warn" | rg -v "max|ttl|limit|capacity|tests/"`

### Tests
- [x] `tests/shared/fs/find-upwards-contract.test.js` (new)
- [x] `tests/shared/path-normalize/path-containment-contract.test.js` (new)
- [x] `tests/shared/logging/warn-once.test.js` (new)
- [x] `tests/shared/cache/lru-parity.test.js` (new)
- [x] `tests/shared/disk-space/format-bytes-contract.test.js` (new)
- [x] `tests/shared/locks/file-lock-contract.test.js` (new)
- [x] `tests/indexing/watch/watch-root-normalization.test.js` (new)
- [x] `tests/shared/io/atomic-write-contract.test.js` (new)
- [x] `tests/shared/cache/cache-policy-contract.test.js` (new)
- [x] `tests/shared/lifecycle/lifecycle-registry-contract.test.js` (new)

### Exit criteria
- [ ] No D1 duplicate helper bodies remain.
- [ ] Ban patterns catch reintroduction of old primitives.

---

## Phase D2 — JSONL merge and artifact writer scaffolding

### Objective
Unify run-merge and artifact writer plumbing to one canonical path.

### Scope
Clusters: 1, 2, plus duplicate `resolveJsonlExtension` inside `src/shared/json-stream.js`.

### Canonical targets
- `src/shared/merge.js`
- `src/shared/json-stream.js`
- `src/index/build/artifacts/writers/_common.js` (new)

### Subphase D2.1 — Merge helper unification
Tasks:
- [x] Task D2.1.a: Expand shared merge API to cover local variant requirements.
Details: Include compare/readRun overrides and parse/error hooks.
- [x] Task D2.1.b: Migrate `src/index/build/artifacts/helpers.js` to shared merge APIs.
Details: Delete local `MinHeap`, `readJsonlRows`, `mergeSortedRuns`.
- [x] Task D2.1.c: Migrate `src/map/build-map/io.js` merge helpers.
Details: Preserve map-specific call semantics with adapter wrapper only.
- [x] Task D2.1.d: Evaluate and migrate local `readJsonlRows` variants in VFS-related modules.
Details: Keep only shared version unless strict functional difference is required.

D2.1 status update (2026-02-09T22:12:23.3819463-05:00):
- resolved: removed local merge helper bodies from `src/index/build/artifacts/helpers.js` and migrated remaining write path to `src/shared/merge.js::writeJsonlRunFile`.
- resolved: removed `MinHeap`/`readJsonlRows`/`mergeSortedRuns` duplicates from `src/map/build-map/io.js` and switched spill merge to `mergeSortedRuns(runs, { compare })`.
- resolved: migrated VFS-local JSONL row readers to shared `readJsonlRows` in `src/index/build/artifacts/writers/vfs-manifest.js` and `src/index/tooling/vfs.js`.
- resolved: migrated downstream read callsites in `src/integrations/tooling/api-contracts.js` and `tools/bench/merge/merge-core-throughput.js` to canonical shared merge exports.
- remaining: D2.2 writer scaffolding/extension resolver consolidation.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg "class MinHeap|function\* readJsonlRows|mergeSortedRuns\(" src`, `rg "resolveJsonlExtension\(" src/index/build/artifacts/writers src/shared/json-stream.js`, `rg "\.parts|\.meta\.json|jsonl\.zst|jsonl\.gz" src/index/build/artifacts/writers`.

### Subphase D2.2 — Writer scaffolding commonization
Tasks:
- [x] Task D2.2.a: Create `_common.js` helpers for extension resolution, cleanup, sizing, and shard/meta output.
Details: API must support all artifact writer combinations.
- [x] Task D2.2.b: Migrate all artifact writers to `_common.js`.
Details: Cover call-sites, chunk-meta, chunk-uid-map, file-relations, risk-interprocedural, symbol-edges, symbol-occurrences, symbols, vfs-manifest.
- [x] Task D2.2.c: Remove writer-local extension resolver and duplicate cleanup logic.
Details: Ensure all writers call canonical helpers.
- [x] Task D2.2.d: Remove duplicate `resolveJsonlExtension` body in `src/shared/json-stream.js`.
Details: Keep one implementation and one export path.

D2.2 status update (2026-02-09T22:25:47.8177996-05:00):
- resolved: added canonical writer scaffolding helper module `src/index/build/artifacts/writers/_common.js` (extension resolution, cleanup path builders, JSONL size measurement, sharded-part/meta construction).
- resolved: migrated writer callsites (`call-sites`, `chunk-meta`, `chunk-uid-map`, `file-relations`, `risk-interprocedural`, `symbol-edges`, `symbol-occurrences`, `symbols`, `vfs-manifest`) to shared writer scaffolding APIs.
- resolved: removed writer-local `resolveJsonlExtension` helper bodies and replaced duplicate cleanup/meta-part mapping blocks with shared helpers.
- resolved: consolidated `resolveJsonlExtension` in `src/shared/json-stream.js` to one exported implementation used by both sharded sync/async write paths.
- remaining: D4+ phase work remains (retrieval/API/MCP/ANN and later phases).
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg "class MinHeap|function\* readJsonlRows|mergeSortedRuns\(" src`, `rg "resolveJsonlExtension\(" src/index/build/artifacts/writers src/shared/json-stream.js`, `rg "\.parts|\.meta\.json|jsonl\.zst|jsonl\.gz" src/index/build/artifacts/writers`.

### Exhaustive sweeps
- [x] `rg "class MinHeap|function\* readJsonlRows|mergeSortedRuns\(" src`
- [x] `rg "resolveJsonlExtension\(" src/index/build/artifacts/writers src/shared/json-stream.js`
- [x] `rg "\.parts|\.meta\.json|jsonl\.zst|jsonl\.gz" src/index/build/artifacts/writers`

### Tests
- [x] `tests/shared/merge/merge-contract.test.js` (new)
- [x] `tests/shared/merge/merge-determinism.test.js` (new)
- [x] `tests/indexing/artifacts/writers/writer-common-contract.test.js` (new)
- [x] `tests/indexing/artifacts/resolution-strictness-parity.test.js` (new)
- [x] `tests/indexing/vfs/vfs-manifest-streaming.test.js` (update)
- [x] `tests/tooling/vfs/vfs-manifest-streaming.test.js` (update; merge plan in D7)

### Exit criteria
- [x] Exactly one merge/read stack and one writer scaffolding stack remain.

---

## Phase D4 — Retrieval/API/MCP/ANN consolidation

### Objective
Unify request/filters/cache config/ANN behavior across API, MCP, and retrieval.

### Scope
Clusters: 8, 9, additional `normalizeMetaFilters` and repo cache defaults duplication, and repo cache manager split from 27.

### Canonical targets
- `src/retrieval/ann/utils.js` (new)
- `src/retrieval/ann/normalize-backend.js` (new)
- `tools/shared/search-request.js` (new)
- `tools/shared/repo-cache-config.js` (new)

### Subphase D4.1 — ANN provider and backend normalization
Tasks:
- [x] Task D4.1.a: Define canonical ANN readiness/gating helper API.
Details: Must encapsulate signal/config/index/candidate-set checks.
- [x] Task D4.1.b: Migrate ANN providers to canonical gating helper.
Details: Remove local gating branches in provider modules.
- [x] Task D4.1.c: Define canonical backend normalization and migrate CLI/pipeline callsites.
Details: Remove divergent backend alias behavior.

D4.1 status update (2026-02-09T22:35:42.9880685-05:00):
- resolved: added canonical ANN gating helpers in `src/retrieval/ann/utils.js` (`isEmbeddingReady`, `isCandidateSetEmpty`, `isAnnProviderAvailable`, `canRunAnnQuery`).
- resolved: added canonical ANN backend normalization in `src/retrieval/ann/normalize-backend.js` and removed `src/retrieval/pipeline/ann-backends.js` shim.
- resolved: migrated ANN providers (`dense`, `hnsw`, `lancedb`, `sqlite-vec`) to shared gating semantics and removed provider-local readiness duplicates.
- resolved: migrated CLI and pipeline backend interpretation to canonical normalizer (`src/retrieval/cli/normalize-options.js`, `src/retrieval/pipeline.js`).
- remaining: D4.2 request/filter normalization and D4.3 repo cache config parity.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg "normalizeAnnBackend|ann-backends|annBackend" src/retrieval`.

### Subphase D4.2 — Search request and filter normalization
Tasks:
- [x] Task D4.2.a: Implement shared request normalizer + argv builder.
Details: API and MCP must call same core function.
- [x] Task D4.2.b: Consolidate `normalizeMetaFilters` into one shared helper.
Details: Remove local duplicates in API/MCP/validation.
- [x] Task D4.2.c: Fix API schema drift.
Details: Resolve `path` vs `paths`, add `filter` support, keep validation strict.

D4.2 status update (2026-02-09T22:50:52.2093313-05:00):
- resolved: added canonical request normalization/argv building in `tools/shared/search-request.js` and migrated API/MCP builders to call this shared core.
- resolved: removed duplicate `normalizeMetaFilters` from API validation and MCP helper stacks; canonical helper now lives in `tools/shared/search-request.js`.
- resolved: fixed API schema/request drift by supporting `paths` alias + `filter` in strict validation and routing both `path`/`paths` through shared normalization.
- remaining: D4.3 repo cache config parity.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `git grep -n -F "normalizeMetaFilters(" -- tools/api tools/mcp tools/shared`, `git grep -n -E "payload\.paths|payload\.path|payload\.filter" -- tools/api`.

### Subphase D4.3 — Repo cache config parity
Tasks:
- [x] Task D4.3.a: Consolidate default cache config values.
Details: API and MCP read from same source.
- [x] Task D4.3.b: Consolidate cache manager behavior and normalization.
Details: Keep explicit override behavior consistent.

D4.3 status update (2026-02-09T22:52:39.1297429-05:00):
- resolved: added canonical repo cache policy defaults/normalization + manager in `tools/shared/repo-cache-config.js`.
- resolved: migrated API cache manager wrapper to shared manager (`tools/api/router/cache.js`).
- resolved: migrated MCP repo cache manager behavior to shared manager (`tools/mcp/repo.js`) while preserving public MCP cache API (`getRepoCaches`, `refreshRepoCaches`, `clearRepoCaches`).
- remaining: phase D4 complete.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `git grep -n -E "DEFAULT_CACHE|cacheConfig|normalizeCacheConfig" -- tools/api tools/mcp tools/shared`.

### Exhaustive sweeps
- [x] `rg "normalizeAnnBackend|ann-backends|annBackend" src/retrieval`
- [x] `rg "normalizeMetaFilters\(" tools/api tools/mcp`
- [x] `rg "payload\.paths|payload\.path|payload\.filter" tools/api`
- [x] `rg "DEFAULT_CACHE|cacheConfig|normalizeCacheConfig" tools/api tools/mcp`

### Tests
- [x] `tests/retrieval/ann/ann-provider-gating-parity.test.js` (new)
- [x] `tests/retrieval/ann/ann-backend-normalization-parity.test.js` (new)
- [x] `tests/retrieval/ann/ann-candidate-set-contract.test.js` (new)
- [x] `tests/tooling/api-mcp/search-request-parity.test.js` (new)
- [x] `tests/tooling/api-mcp/meta-filter-normalization.test.js` (new)
- [x] `tests/tooling/api-mcp/repo-cache-config-parity.test.js` (new)
- [x] existing API/MCP/ANN suites updated for canonical path

### Exit criteria
- [x] API and MCP normalize requests identically.
- [x] ANN providers share one gating + backend interpretation path.

---

## Phase D5 — Tooling and language front-end consolidation

### Objective
Consolidate duplicated tooling utilities and shared language parsing/extraction logic.

### Scope
Clusters: 21, 22, 23, 24.

### Canonical targets
- `src/index/tooling/binary-utils.js` (new)
- `src/index/tooling/typescript/load.js` (new)
- `src/index/tooling/signature-parse/shared.js` (new)
- `src/lang/shared/signature-lines.js` (new)
- `src/lang/js-ts/relations-shared.js` (new)

### Subphase D5.1 — Tooling utility consolidation
Tasks:
- [x] Task D5.1.a: Extract shared binary discovery helper from doctor/pyright/tools.
Details: Preserve Windows suffix/path search behavior.
- [x] Task D5.1.b: Extract shared TypeScript loader helper.
Details: Preserve lookup order and fallback semantics.
- [x] Task D5.1.c: Migrate all callsites and delete local implementations.
Details: No duplicate copies remain.

D5.1 status update (2026-02-09T22:58:09.6974883-05:00):
- resolved: added canonical binary discovery helpers in `src/index/tooling/binary-utils.js` and migrated `doctor`, `pyright-provider`, and `tools/tooling/utils.js` callsites.
- resolved: added canonical TypeScript loader helpers in `src/index/tooling/typescript/load.js` and migrated `src/index/tooling/doctor.js`, `src/index/tooling/typescript-provider.js`, and `src/lang/typescript/parser.js`.
- resolved: removed duplicated local helper bodies (`candidateNames`, `findBinaryInDirs`, local async/sync TypeScript loader copies) from migrated modules.
- remaining: D5.2 signature parsing primitives and D5.3 JS/TS relations shared core.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `git grep -n -E "findBinaryInDirs|candidateNames|resolveTypeScript|loadTypeScript" -- src tools`.

### Subphase D5.2 — Signature parsing primitives
Tasks:
- [x] Task D5.2.a: Add shared signature splitting primitives for clike/python/swift.
Details: Handle nesting/quotes consistently.
- [x] Task D5.2.b: Add shared `readSignatureLines` helper and migrate language modules.
Details: Keep language-specific post-processing local.
- [x] Task D5.2.c: Remove duplicate helper bodies.
Details: Ban legacy helper names.

D5.2 status update (2026-02-09T23:09:10.7677920-05:00):
- resolved: added shared signature split primitives in `src/index/tooling/signature-parse/shared.js` and migrated clike/python/swift signature parsers to consume them.
- resolved: added shared signature line reader in `src/lang/shared/signature-lines.js` and migrated C-like/TS/perl/php/rust/shell language modules to shared `readSignatureLines`.
- resolved: removed duplicated `split*Params`, `findTopLevelIndex`, and `readSignatureLines` helper bodies from migrated modules while preserving parser/language-specific post-processing behavior.
- remaining: D5.3 JS/TS relations shared core.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `git grep -n -E "split.*Params|readSignatureLines" -- src/lang src/index/tooling/signature-parse`.

### Subphase D5.3 — JS/TS relations shared core
Tasks:
- [x] Task D5.3.a: Extract shared AST walk/callee/call-location logic.
Details: Keep parser setup and syntax-specific exceptions in per-language files.
- [x] Task D5.3.b: Migrate JS and TS relation builders to shared core.
Details: Preserve existing relation output contract.

D5.3 status update (2026-02-09T23:15:49.7166137-05:00):
- resolved: added shared JS/TS relation helpers in `src/lang/js-ts/relations-shared.js` for call-location normalization and callee decomposition.
- resolved: migrated both `src/lang/javascript/relations.js` and `src/lang/typescript/relations.js` to shared callee/call-location helpers while keeping parser/walk-specific behavior local.
- resolved: added explicit JS and TS relation contract tests to lock `callDetails` output semantics (`calleeRaw`, `calleeNormalized`, `receiver`, location fields).
- remaining: phase D5 complete.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `git grep -n -E "resolveCalleeParts|resolveCallLocation" -- src/lang/javascript src/lang/typescript src/lang/js-ts`.

### Exhaustive sweeps
- [x] `rg "findBinaryInDirs|candidateNames|resolveTypeScript|loadTypeScript" src tools`
- [x] `rg "split.*Params|readSignatureLines" src/lang src/index/tooling/signature-parse`
- [x] `rg "resolveCalleeParts|resolveCallLocation" src/lang/javascript src/lang/typescript`

### Tests
- [x] `tests/tooling/binary-utils-parity.test.js` (new)
- [x] `tests/tooling/typescript-loader-parity.test.js` (new)
- [x] `tests/tooling/signature-parse/shared-splitter.test.js` (new)
- [x] language signature/metadata tests updated
- [x] `tests/lang/contracts/javascript-relations-contract.test.js` (new)
- [x] `tests/lang/contracts/typescript-relations-contract.test.js` (new)

### Exit criteria
- [x] All tooling and language helper duplicates in scope are centralized.

---

## Phase D3 — Storage consolidation (SQLite/LMDB/quantization/vocab)

### Objective
Eliminate storage correctness drift by consolidating duplicated storage logic.

### Scope
Clusters: 3, 4, 5, 6, 7.

### Canonical targets
- `src/storage/sqlite/build/core.js` (new)
- `src/storage/sqlite/build/output-paths.js`
- `src/storage/sqlite/build/index-state.js`
- `src/storage/sqlite/quantization.js` (new)
- `src/storage/sqlite/vocab.js` (new)
- `src/storage/lmdb/utils.js` (new)

### Subphase D3.1 — SQLite build core
Tasks:
- [x] Task D3.1.a: Extract shared DB open/pragmas/schema/setup/insert pipeline core.
Details: Keep source enumeration in adapter modules.
- [x] Task D3.1.b: Refactor `from-artifacts` to adapter usage.
Details: Remove shared logic duplicates after migration.
- [x] Task D3.1.c: Refactor `from-bundles` to adapter usage.
Details: Preserve bundle-specific buffering/vector insertion.

D3.1 status update (2026-02-09T23:35:24.4525105-05:00):
- resolved: added canonical sqlite build core helper module `src/storage/sqlite/build/core.js` for shared batch/stat normalization, DB open/pragmas/schema setup, multi-row inserter setup, transaction accounting, post-commit validation/optimization, and cleanup.
- resolved: refactored `src/storage/sqlite/build/from-artifacts.js` to consume shared core helpers while preserving artifact-specific source enumeration/staging ingestion behavior.
- resolved: refactored `src/storage/sqlite/build/from-bundles.js` to consume shared core helpers while preserving bundle loader, progress logging, embedding/vector-ann insertion, and failure fallback contract.
- remaining: D3.2 completed previously; D3.3 quantization/vocab parity and D3.4 LMDB utility consolidation remain.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg --line-number 'createInsertStatements|createMultiRowInserter|applyBuildPragmas|restoreBuildPragmas|validateSqliteDatabase|resolveSqliteBatchSize|bumpSqliteBatchStat' src/storage/sqlite/build/from-artifacts.js src/storage/sqlite/build/from-bundles.js`; `rg --line-number 'createBuildExecutionContext|openSqliteBuildDatabase|createSqliteBuildInsertContext|runSqliteBuildPostCommit|closeSqliteBuildDatabase' src/storage/sqlite/build/from-artifacts.js src/storage/sqlite/build/from-bundles.js src/storage/sqlite/build/core.js`.

### Subphase D3.2 — src/tools SQLite helper unification
Tasks:
- [x] Task D3.2.a: Remove duplicate `tools/build/sqlite/output-paths.js`.
Details: Update tool imports to canonical source module.
- [x] Task D3.2.b: Consolidate index-state helper implementation.
Details: Keep one module and remove duplicate.
- [x] Task D3.2.c: Remove duplicate no-op task factories where shared utility exists.
Details: Ensure runner and tools use one task-factory source.

D3.2 status update (2026-02-09T23:25:58.0431998-05:00):
- resolved: removed duplicate `tools/build/sqlite/output-paths.js` and migrated all callsites/tests to canonical `src/storage/sqlite/build/output-paths.js`.
- resolved: removed duplicate `tools/build/sqlite/index-state.js`; `compact-sqlite-index` now imports canonical `src/storage/sqlite/build/index-state.js`.
- resolved: centralized no-op task helper in `src/shared/cli/noop-task.js` and migrated sqlite runner/tool display task-factory fallback to shared helper.
- remaining: D3.1 sqlite build core extraction, D3.3 quantization/vocab parity, D3.4 LMDB utilities.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg --line-number --glob '*.js' 'tools/build/sqlite/output-paths\\.js|tools/build/sqlite/index-state\\.js' src tools tests`; `rg --line-number --glob '*.js' 'function createNoopTask\\(|const createNoopTask\\s*=|resolveTaskFactory\\s*=\\s*\\(' src tools tests`; `rg --line-number 'output-paths\\.js|index-state\\.js|createNoopTask' src tools/build/sqlite tools/shared tests`.

### Subphase D3.3 — Quantization and vocab parity
Tasks:
- [x] Task D3.3.a: Extract canonical quantization metadata resolver.
Details: Retrieval and ranking must consume this resolver directly.
- [x] Task D3.3.b: Replace retrieval-side levels/scale derivation duplicates.
Details: Remove manual derivation branches.
- [x] Task D3.3.c: Extract canonical vocab fetch + statement cache helper.
Details: Build/retrieval call the same API.

D3.3 status update (2026-02-09T23:42:32.5534052-05:00):
- resolved: added canonical quantization resolver module `src/storage/sqlite/quantization.js` and migrated storage/runtime/tooling callsites from vector-local imports to canonical quantization imports.
- resolved: replaced retrieval dense-meta manual levels/scale derivation with `resolveDenseMetaRecord` in `src/retrieval/sqlite-helpers.js`.
- resolved: added canonical vocab module `src/storage/sqlite/vocab.js`, migrated incremental build + retrieval callsites, and removed legacy duplicate `src/storage/sqlite/build/vocab.js`.
- remaining: D3.4 LMDB utility consolidation.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg --line-number \"resolveQuantizationParams|levels\\s*\\?|scale\\s*=\\s*\\(\" src/retrieval src/storage`; `rg --line-number \"fetchVocabRows\\(\" src/storage src/retrieval`.

### Subphase D3.4 — LMDB utils consolidation
Tasks:
- [x] Task D3.4.a: Add shared LMDB presence checker and codec factory.
Details: Include `data.mdb` checks and decode behavior.
- [x] Task D3.4.b: Add shared LMDB meta/schema validation helpers.
Details: Centralize required-key checks.
- [x] Task D3.4.c: Migrate retrieval/validate/status callsites and delete local variants.
Details: No duplicate `new Unpackr` helpers remain outside shared module.

D3.4 status update (2026-02-09T23:50:33.7948359-05:00):
- resolved: added canonical LMDB utility module `src/storage/lmdb/utils.js` with shared presence check (`hasLmdbStore`), codec factory (`createLmdbCodec`), decode helper (`decodeLmdbValue`), schema/mode validation (`validateLmdbSchemaAndMode`), and required-artifact validation (`validateLmdbArtifactKeys`).
- resolved: migrated retrieval callsites (`src/retrieval/cli-lmdb.js`, `src/retrieval/lmdb-helpers.js`, `src/retrieval/cli/index-loader.js`) and validation/status callsites (`src/index/validate/lmdb.js`, `src/index/validate/lmdb-report.js`, `src/integrations/core/status.js`) to canonical LMDB utilities.
- resolved: removed local `Unpackr` decode and `data.mdb` presence helper variants from retrieval/validate/status paths in scope.
- remaining: phase D3 complete.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg --line-number \"new Unpackr|data\\.mdb|hasLmdb|isLmdb\" src/retrieval src/index/validate src/integrations/core src/storage/lmdb`.

### Exhaustive sweeps
- [x] `rg "resolveQuantizationParams|levels\s*\?|scale\s*=\s*\(" src/retrieval src/storage`
- [x] `rg "fetchVocabRows\(" src/storage src/retrieval`
- [x] `rg "new Unpackr|data\.mdb|hasLmdb|isLmdb" src`
- [x] `rg "output-paths\.js|index-state\.js|createNoopTask" src tools/build/sqlite tools/shared`

### Tests
- [x] `tests/storage/sqlite/build/sqlite-build-core-contract.test.js` (new)
- [x] `tests/storage/sqlite/quantization/quantization-parity.test.js` (new)
- [x] `tests/storage/sqlite/vocab/vocab-fetch-parity.test.js` (new)
- [x] `tests/storage/lmdb/lmdb-utils-contract.test.js` (new)
- [x] existing SQLite/LMDB suites updated for canonical paths

### Exit criteria
- [x] Build/retrieval storage paths share single quantization/vocab semantics.
- [x] LMDB presence/decode/validation logic is centralized.

---

## Phase D6 — Chunking, risk, import resolution, and map consolidation

### Objective
Consolidate remaining duplicated domain helpers and map subsystem duplicates.

### Scope
Clusters: 18, 19, 20, 25.

### Canonical targets
- `src/index/chunking/helpers.js` (new)
- `src/index/risk/shared.js` (new)
- `src/index/shared/import-candidates.js` (new)
- `src/map/shared/escape-html.js` (new)
- `src/map/build-map/filters.js` (single API)

### Subphase D6.1 — Chunking helper extraction
Tasks:
- [x] Task D6.1.a: Extract `buildChunksFromLineHeadings` into shared chunking helper module.
Details: Include identical heading/title transform behavior.
- [x] Task D6.1.b: Extract `buildChunksFromMatches` helper.
Details: Keep match regex definitions in format modules.
- [x] Task D6.1.c: Migrate ini-toml/yaml/rst-asciidoc/markdown modules and delete local copies.
Details: No duplicate helper bodies remain.

D6.1 status update (2026-02-09T23:56:14.0203598-05:00):
- resolved: added canonical chunking helper module `src/index/chunking/helpers.js` with shared `buildChunksFromLineHeadings` and `buildChunksFromMatches`.
- resolved: migrated `src/index/chunking/formats/ini-toml.js`, `src/index/chunking/formats/yaml.js`, `src/index/chunking/formats/rst-asciidoc.js`, and `src/index/chunking/formats/markdown.js` to canonical helpers and removed local helper bodies.
- resolved: migrated `src/index/chunking/dispatch.js` to import shared `buildChunksFromLineHeadings` to keep one helper source for chunking line-heading segmentation.
- remaining: D6.2 risk utility extraction and D6.3 import candidate/map cleanup.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg --line-number "buildChunksFromLineHeadings|buildChunksFromMatches" src/index/chunking`.

### Subphase D6.2 — Risk utility extraction
Tasks:
- [x] Task D6.2.a: Extract shared severity rank and identifier boundary logic.
Details: Single-file and interprocedural engines import from one module.
- [x] Task D6.2.b: Extract shared rule pattern match helper.
Details: Preserve existing match semantics.
- [x] Task D6.2.c: Remove duplicate constants/functions in risk modules.
Details: ban duplicate symbols via manifest.

D6.2 status update (2026-02-09T23:59:07.3289697-05:00):
- resolved: added canonical risk utility module `src/index/risk/shared.js` with shared `SEVERITY_RANK`, identifier boundary matching (`containsIdentifier`), and rule pattern matcher (`matchRulePatterns`).
- resolved: migrated `src/index/risk.js` to shared severity rank, identifier boundary checks, and pattern matching helper while preserving rule language/required-regex gating behavior.
- resolved: migrated `src/index/risk-interprocedural/engine.js` to shared severity rank, identifier matching, and rule pattern matcher for arg-aware taint checks.
- remaining: D6.3 import candidate and map helper consolidation.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg --line-number "SEVERITY_RANK|identifier.*boundary|rule.*match" src/index/risk.js src/index/risk-interprocedural/engine.js src/index/risk/shared.js`.

### Subphase D6.3 — Import candidate and map cleanup
Tasks:
- [x] Task D6.3.a: Extract shared import candidate generation function for build/crossfile paths.
Details: Parameterize extensions and existence checks.
- [x] Task D6.3.b: Remove duplicate map filter APIs (`applyScopeFilter`, `applyCollapse`) after consumer migration.
Details: retain only canonical create-transform APIs.
- [x] Task D6.3.c: Add shared HTML escape helper and migrate dot/html writers.
Details: one escape implementation.
- [x] Task D6.3.d: Standardize config merge usage in map client and shared config.
Details: Decide array merge semantics and document explicitly.

D6.3 status update (2026-02-10T00:04:55.9378494-05:00):
- resolved: added canonical import candidate module `src/index/shared/import-candidates.js` and migrated `src/index/type-inference-crossfile/resolve-relative-import.js` plus `src/index/build/import-resolution.js` to shared candidate resolution.
- resolved: removed duplicate map filter APIs `applyScopeFilter`/`applyCollapse` from `src/map/build-map/filters.js`, retaining canonical `createScopeFilters` and `createCollapseTransform` API usage.
- resolved: added shared HTML escape helper `src/map/shared/escape-html.js` and migrated `src/map/html-writer.js` and `src/map/dot-writer.js` to canonical escaping.
- resolved: standardized map client config merge on `src/shared/config.js::mergeConfig` by migrating `src/map/isometric/client/dom.js` and documenting array override semantics in shared config.
- remaining: phase D6 complete.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this dedupe-only subphase.
- exceptions: none.
- sweep results: `rg --line-number "resolve-relative-import|import-resolution" src/index`; `rg --line-number "applyScopeFilter|applyCollapse|escapeHtml|mergeConfig" src/map src/shared`.

### Exhaustive sweeps
- [x] `rg "buildChunksFromLineHeadings|buildChunksFromMatches" src/index/chunking`
- [x] `rg "SEVERITY_RANK|identifier.*boundary|rule.*match" src/index/risk.js src/index/risk-interprocedural/engine.js src/index/risk/shared.js`
- [x] `rg "resolve-relative-import|import-resolution" src/index`
- [x] `rg "applyScopeFilter|applyCollapse|escapeHtml|mergeConfig" src/map src/shared`

### Tests
- [x] `tests/indexing/chunking/chunking-helper-parity.test.js` (new)
- [x] `tests/indexing/risk/risk-shared-utils-parity.test.js` (new)
- [x] `tests/indexing/type-inference/import-candidates-parity.test.js` (new)
- [x] `tests/map/map-filter-api-contract.test.js` (new)
- [x] `tests/map/html-escape-contract.test.js` (new)
- [x] map config merge behavior test (new)

### Exit criteria
- [x] No duplicated chunking/risk/import/map helper stacks remain in scope.

---

## Phase D7 — Test and benchmark dedupe with scenario-preserving merges

### Objective
Reduce duplicated tests and bench wiring while preserving scenario coverage and readability.

### Subphase D7.1 — Retrieval ANN pipeline tests
Tasks:
- [x] Task D7.1.a: Extract shared ANN pipeline fixture/setup helper.
Details: Create `tests/retrieval/pipeline/helpers/ann-scenarios.js`.
- [x] Task D7.1.b: Keep separate scenario assertions.
Details: Missing-provider and provider-failure remain distinct tests.
- [x] Task D7.1.c: Update test names to reflect scenario matrix clearly.

D7.1 status update (2026-02-10T00:08:55.4192957-05:00):
- resolved: added shared ANN pipeline test fixture helper `tests/retrieval/pipeline/helpers/ann-scenarios.js` for common retrieval pipeline context/index setup.
- resolved: migrated `tests/retrieval/pipeline/ann-optional-skip.test.js` and `tests/retrieval/pipeline/ann-preflight.test.js` to shared helper with scenario-specific assertions preserved.
- resolved: standardized scenario naming in test output (`ann-missing-provider-fallback`, `ann-provider-preflight-failure-fallback`) while keeping missing-provider and provider-preflight-failure as separate tests.
- remaining: D7.2-D7.6 pending.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this test-dedupe subphase.
- exceptions: none.
- sweep results: `rg --line-number "ann-scenarios|ann-missing-provider-fallback|ann-provider-preflight-failure-fallback" tests/retrieval/pipeline`.

### Subphase D7.2 — Interprocedural flow cap tests
Tasks:
- [x] Task D7.2.a: Build parameterized flow-cap matrix helper.
Details: Inputs: conservative/max/overflow edge cases.
- [x] Task D7.2.b: Convert duplicated flow tests to matrix-driven assertions.
Details: Maintain current expected counts and failure messages.

D7.2 status update (2026-02-10T00:11:52.8315093-05:00):
- resolved: added shared flow-cap matrix helper `tests/indexing/risk/interprocedural/helpers/flow-cap-matrix.js` for reusable interprocedural risk chunks/runtime assembly and scenario execution.
- resolved: replaced duplicated standalone cap tests (`flows-conservative`, `flows-max-total-flows`, `flows-timeout`) with matrix-driven assertions in `tests/indexing/risk/interprocedural/flows-cap-matrix.test.js`.
- resolved: preserved scenario-specific assertions/messages for conservative flow emission, `maxTotalFlows=0` cap handling, and timeout overflow behavior.
- remaining: D7.3-D7.6 pending.
- severity snapshot: critical=0, high=0, medium=n/a, low=n/a for this test-dedupe subphase.
- exceptions: none.
- sweep results: `rg --line-number "flows-conservative|flows-max-total-flows|flows-timeout|runFlowCapScenario" tests/indexing/risk/interprocedural`.

### Subphase D7.3 — VFS and SQLite streaming tests
Tasks:
- [ ] Task D7.3.a: Create shared VFS streaming fixture/assert helper.
Details: Keep indexing and tooling entrypoint assertions separate.
- [ ] Task D7.3.b: Build compression matrix harness for chunk-meta/gzip/zstd streaming tests.
Details: Codec-specific assertions remain explicit.

### Subphase D7.4 — Graph/symbol/sqlite build test harness cleanup
Tasks:
- [ ] Task D7.4.a: Extract shared graph perf contract bench helper.
Details: Keep context-pack vs neighborhood assertions distinct.
- [ ] Task D7.4.b: Extract shared symbol artifact setup helper.
Details: Keep smoke vs by-file-index assertions distinct.
- [ ] Task D7.4.c: Extract shared sqlite build fixture setup helper.
Details: Keep rowcount and fast-path validator assertions distinct.

### Subphase D7.5 — Bench script dedupe
Tasks:
- [ ] Task D7.5.a: Extract shared static server/wiring helper for map viewer benches.
Details: Migrate `viewer-fps` and `viewer-lod-stress`.
- [ ] Task D7.5.b: Extract shared map bench build options helper.
Details: Migrate `build-map-memory` and `build-map-streaming`.

### Subphase D7.6 — Clone threshold guardrail for tests and benches
Tasks:
- [ ] Task D7.6.a: Add clone-threshold test for `tests/**` and `tools/bench/**`.
Details: Set threshold to catch large copy/paste blocks.
- [ ] Task D7.6.b: Wire threshold result into script-coverage/reporting.
Details: Fail CI on regression beyond allowlist.

### Tests
- [ ] merged suites run individually and preserve scenario assertions
- [ ] `tests/tooling/dupemap/dupemap-test-clone-threshold.test.js` (new)
- [ ] script-coverage suites updated for new helper locations

### Exit criteria
- [ ] Duplicate test/bench setup blocks moved into shared helpers.
- [ ] Scenario coverage matrix is unchanged or improved.

---

## Phase D8 — Final hardening and closeout

### Objective
Consolidate remaining validation/fetch duplicates, lock CI rules, and close the roadmap.

### Scope
Cluster 26 and remaining cluster 27 items.

### Canonical targets
- `src/shared/validation/ajv-factory.js` (new)
- `tools/download/shared-fetch.js` (new)

### Subphase D8.1 — Validation scaffolding consolidation
Tasks:
- [ ] Task D8.1.a: Implement shared Ajv factory for config/contracts/API validators.
Details: Support schema flavor/options required by each caller.
- [ ] Task D8.1.b: Migrate validators to factory.
Details: Keep existing error message contract unless intentionally revised.
- [ ] Task D8.1.c: Remove duplicated Ajv bootstrap logic.

### Subphase D8.2 — Download fetch helper consolidation
Tasks:
- [ ] Task D8.2.a: Implement shared redirect-aware fetch helper.
Details: Include redirect limit, timeout, and deterministic error formatting.
- [ ] Task D8.2.b: Migrate dict and extension download tooling.
Details: Preserve existing auth/env behavior.
- [ ] Task D8.2.c: Remove local duplicated fetch/redirect loops.

### Subphase D8.3 — Final migration lock and docs sync
Tasks:
- [ ] Task D8.3.a: Run final legacy-usage sweeps for all migrated symbols/modules.
Details: Record sweep commands and results in phase notes.
- [ ] Task D8.3.b: Run full docs/contracts/config command docs sync.
Details: `docs/guides/commands.md`, config schema/inventory, relevant contracts.
- [ ] Task D8.3.c: Ensure CI includes representative lanes for touched domains.
Details: include ci-lite and ci-long execution points.

### Subphase D8.4 — Class-level remediation closeout
Tasks:
- [ ] Task D8.4.a: Add cross-surface parity suites for stage progression/promotion timing contracts.
Details: Cover stage start/completion/error/promotion ordering and fail-closed behavior.
- [ ] Task D8.4.b: Enforce lifecycle drain/close tests for long-lived services/watchers/tooling providers.
Details: Assert no pending workers/timers/promises after shutdown hooks complete.
- [ ] Task D8.4.c: Produce class-remediation completion matrix in docs/tooling outputs.
Details: Map each remediation item to implemented helpers, migrated callsites, and test evidence.

### Tests
- [ ] `tests/shared/validation/ajv-factory-contract.test.js` (new)
- [ ] `tests/tooling/download/shared-fetch-contract.test.js` (new)
- [ ] `tests/indexing/build/stage-progression-contract.test.js` (new)
- [ ] `tests/indexing/build/promotion-timing-contract.test.js` (new)
- [ ] `tests/indexing/lifecycle/shutdown-drain-contract.test.js` (new)
- [ ] tooling docs tests updated and passing

### Exit criteria
- [ ] All roadmap clusters resolved or explicitly accepted with written rationale.
- [ ] CI blocks reintroduction of legacy duplicates.
- [ ] Phase is ready to move to `COMPLETED_PHASES.md` on completion commit.

---

## Per-phase validation cadence

For each phase D0–D8 and F0–F9:
- [ ] Run phase-targeted tests individually first.
- [ ] Run affected lane subset (`ci-lite` minimum).
- [ ] Run phase-specific sweep checks listed in the phase and record results in phase notes.
- [ ] Record findings status block (`resolved`, `remaining`, `severity snapshot`, `exceptions`) in phase notes.
- [ ] Complete phase documentation task from the documentation update matrix (`Phase.DOC`) and check it off.
- [ ] Capture perf baseline and post-change delta for mapped hot paths; record against `perf-budgets.json`.
- [ ] Update migration mapping tables and phase notes.
- [ ] Update phase checkboxes only when code+tests are committed.

---

## Final acceptance

- [ ] All duplication clusters from `duplication_consolidation_report.md` are resolved or formally accepted with rationale.
- [ ] No banned legacy duplicate usages remain.
- [ ] API/MCP/search normalization is parity-tested.
- [ ] Build/retrieval/storage parity tests pass for consolidated helpers.
- [ ] Test harness duplication is reduced without loss of coverage.
- [ ] Docs/contracts/config references reflect canonical implementations.
- [ ] All six class-level remediations from `All_Findings.md` Part 4 are implemented and verified with linked tests.
- [ ] All findings from `All_Findings.md` Parts 1-5 are resolved or explicitly accepted with risk records and expiry phases.
- [ ] No unresolved high/critical findings remain in phase status tables.
- [ ] `src/**` review coverage lock is green in CI.
- [ ] `perf-budgets.json` budgets are met or explicitly accepted with time-bound waivers.
- [ ] CI publishes top-offender/trend artifact for performance-sensitive suites.
- [ ] All phase documentation tasks (`D0.DOC`..`D8.DOC`, `F0.DOC`..`F9.DOC`) are completed or carry a timestamped `no-doc-change` rationale.

---

## Post-close follow-ups

- [ ] Add ownership metadata for shared helpers.
