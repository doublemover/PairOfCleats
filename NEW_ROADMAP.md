# PairOfCleats Roadmap

Large architectural changes are explicitly permitted when they reduce defect surface area and/or materially improve throughput and durability.

## Status legend

Checkboxes represent “meets the intent of the requirement, end-to-end, without known correctness gaps”:

- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [ ] Not complete **or** there is a correctness gap **or** there is a missing/insufficient test proving behavior

---

# Phase 0 — Roadmap hygiene, baseline gates, and “tests must be truthful”

**Objective:** establish a reliable baseline so subsequent changes are validated quickly and deterministically.

## 0.1 Remove/retire docs-consistency-test (locked decision)
- [x] Remove `docs-consistency-test` entry from `package.json` (or repoint to an existing test if you prefer to keep the script name as a no-op wrapper).
- [x] Update `tests/script-coverage.js` so it does not expect `docs-consistency-test` to run.
- [x] Update any docs referencing the script (if present).

**Exit criteria**
- [x] `npm run script-coverage-test` passes without missing-script references.

## 0.2 Establish “fast smoke lanes” per major surface
Create deterministic, cache-isolated smoke entrypoints:
- [x] **Indexing smoke** (Section 1): core API + minimal index build + API server basic route test
- [x] **Retrieval smoke** (Section 2): search help + search filters + search explain + RRF/blend sanity
- [x] **Services smoke** (Section 3): MCP server basic tool call + JSON-RPC framing sanity
- [x] **Worker/meta smoke** (Section 4): worker pool split teardown + language fidelity baseline
- [x] **Embeddings smoke** (Section 5): cache reuse + dims mismatch failure case
- [x] **SQLite smoke** (Section 6): build + incremental + sqlite ANN extension missing fallback

**Deliverables**
- [x] `npm run smoke:section1`
- [x] `npm run smoke:retrieval`
- [x] `npm run smoke:services`
- [x] `npm run smoke:workers`
- [x] `npm run smoke:embeddings`
- [x] `npm run smoke:sqlite`

**Exit criteria**
- [x] Each smoke lane runs deterministically with an isolated `PAIROFCLEATS_CACHE_ROOT` and cleans up after itself.

## 0.3 Contract capture + coverage ledger (repo-wide)
- [x] Create/update `docs/contracts/` so each major surface has a short contract:
  - indexing stages/modes and artifacts
  - chunk identity and sizing
  - search flags and outputs
  - retrieval ranking/explain semantics
  - sqlite schema/incremental/ANN semantics
  - API server and MCP server request/response/error contracts
- [x] Create a “entrypoint → tests” coverage ledger (what is asserted vs assumed).

**Exit criteria**
- [x] Every public entrypoint has at least one content-asserting test (not just “exits 0”) or a documented gap.

---

# Phase 1 — Stop-the-bleeding P0 fixes (hangs, crashers, leaks)

**Objective:** eliminate known hangs, orphan processes, and common crash paths before feature/semantics work.

## 1.1 Runtime lifecycle teardown (watch mode, worker pools, long-lived resources)
- [x] Persist combined worker pools on runtime creation (e.g., `runtime.workerPools = { tokenizePool, quantizePool, destroy }`).
- [x] Ensure teardown destroys both tokenize and quantize pools (and any other long-lived resources).
- [x] Wrap watch mode in `try/finally` so teardown runs on shutdown/signals.

**Exit criteria**
- [x] `build_index.js --watch ...` exits cleanly on SIGINT/SIGTERM with split pools enabled.
- [x] No lingering worker threads keep the Node event loop alive.

## 1.2 Search CLI crashers / hard failures
- [x] Guard `--stats` so it cannot dereference null indexes when a mode is disabled.
- [x] Make telemetry writes best-effort so read-only cache roots do not fail searches.
- [x] Make human-output highlighting safe (escape tokens; avoid unsafe regex compilation).

**Exit criteria**
- [x] Punctuation-heavy queries do not crash human output mode.
- [x] `search --stats` works across modes.

## 1.3 Bench and test harness correctness hazards
- [x] Fix bench runner acceptance so missing timing stats cannot be recorded as `0ms`.
- [x] Fix `tests/language-fidelity.js` `failures` scoping error and make token postings validation resilient to sharded formats.
- [x] Fix bench harness line normalization to avoid `
 → \n\n` artifacts.

**Exit criteria**
- [x] Bench fails loudly when it cannot measure.
- [x] Language fidelity fails only on real fidelity problems (not reference errors).
- [x] Bench output parsing remains stable on Windows and non-TTY.

## 1.4 File processor observability
- [x] Record skip reason on read failure (do not silently drop files from indexing).

**Exit criteria**
- [x] Read failures are surfaced in metrics/skipped lists and covered by a test.

## 1.5 Python AST pool: prevent orphans
- [x] On timeout/write error, explicitly kill the Python worker process.
- [x] Add crash-loop guard/backoff; fall back to heuristic chunking.
- [x] Add optional queue backpressure.

**Exit criteria**
- [x] A timeout cannot leave orphan Python processes running.

---

# Phase 2 — Retrieval CLI contract alignment (flags, UX, and help truthfulness)

**Objective:** ensure CLI behavior matches help/docs and eliminate dead/ambiguous flags.

## 2.1 Remove dead/ambiguous flags (locked decision)
- [x] Remove `--human` and `--headline` from:
  - `src/retrieval/cli-args.js` (parser)
  - help/usage text
  - README/docs that mention them
- [x] Add/adjust tests to ensure the flags are not accepted and that the error is actionable.

**Exit criteria**
- [x] Help output no longer advertises removed flags.
- [x] Passing removed flags returns a clean error (non-zero exit) with remediation.

## 2.2 Flag typing and “missing value is an error” (locked decision)
- [x] Declare `--type`, `--author`, `--import` as **string** options in yargs.
- [x] If any of these flags are passed without a value, fail with:
  - a non-zero exit code
  - a clear message: which flag is missing a value and an example of correct usage

**Exit criteria**
- [x] Regression tests prove correct parsing and error behavior.

## 2.3 Windows path normalization for file/path filters
- [x] Normalize candidate file paths and filter substrings to a shared representation (recommended: POSIX `/` separators + lowercasing).

**Exit criteria**
- [x] Windows-style `--file src\nested\util.ts` matches expected results.

## 2.4 Explain output fidelity
- [x] Ensure explain output includes all applied boosts and scoring components (including symbol boost data).
- [x] Ensure `--why` and `--explain` are identical in content.

**Exit criteria**
- [x] Explain output is “reconcilable” with actual scoring logic and is test-backed.

---

# Phase 3 — Chunking correctness, deterministic sizing, and stable chunk identity

**Objective:** stabilize chunk identity across builds and prevent pathological chunk sizes.

## 3.1 Chunk identity contract (locked decision)
- [x] Treat `chunk.metaV2.chunkId` as the **stable external identifier** across:
  - JSON outputs
  - SQLite records (where applicable)
  - incremental mapping/reuse logic
- [x] Document the distinction:
  - `chunk.id` = index-local numeric id (unstable across builds)
  - `metaV2.chunkId` = stable id (content/structure-derived)

**Exit criteria**
- [x] External outputs clearly expose `metaV2.chunkId` and tests assert stability expectations.

## 3.2 Deterministic chunk splitting (locked decision)
- [x] Add config for deterministic size limits at the chunking layer:
  - max bytes and/or max lines per chunk (choose one primary; support both if needed)
- [x] Ensure the split logic is deterministic (no dependence on iteration order/concurrency).
- [x] Add regression tests for oversize inputs.

**Exit criteria**
- [x] With a fixed config, repeated runs produce identical chunk boundaries and IDs.
- [x] No chunk exceeds configured limits.

---

# Phase 4 — Retrieval pipeline semantics (early filtering, top-N fulfillment, determinism)

**Objective:** ensure `--top N` means what it says, and results are predictable.

## 4.1 Apply filters earlier (locked decision; architecture supports it)
The current pipeline computes `allowedIdx` early but applies it late (after ranking). This causes under-filled results when filters are restrictive.

Implement pre-filtering without rewriting the rankers:
- [x] Introduce `allowedIdx` into sparse ranking:
  - Option A: modify `rankBM25` / `rankBM25Fields` to accept `allowedIdx` and skip scoring docs not in the allowed set.
  - Option B: apply an early intersection step to postings iteration (equivalent effect, lower overhead).
- [x] For sqlite FTS mode, push down allowed sets where feasible:
  - for small allowed sets: `rowid IN (...)`
  - for large allowed sets: best-effort (documented) or use a temp table strategy if warranted
- [x] Intersect ANN candidate sets with `allowedIdx` so ANN work is not wasted.

**Exit criteria**
- [x] `--top N` returns N results whenever at least N chunks satisfy the filter constraints.
- [x] Regression tests cover restrictive filters and prove top-N fulfillment.

## 4.2 Determinism guarantees
Completed; moved to `COMPLETED_PHASES.md`.

---

# Phase 5 — Artifact durability and atomicity (with `.bak` retention)

**Objective:** eliminate partial/corrupt writes and ensure crash recovery is possible.

## 5.1 Safer atomic replace with `.bak` retention (locked decision)
- [x] Implement safer `replaceFile()`:
  - write `*.tmp-*` in same directory
  - rename existing destination to `*.bak` (best-effort)
  - rename temp to destination
  - keep `.bak` until the next successful read/validate cycle, then best-effort delete
- [x] Update critical readers (where practical) to fall back to `.bak` if the primary is missing/corrupt.

**Exit criteria**
- [x] A crash during write never removes both old and new files.
- [x] Recovery behavior is documented and tested.

## 5.2 Setup idempotency across all artifact formats
- [x] Replace “index exists” detection to recognize:
  - `chunk_meta.json`
  - `chunk_meta.jsonl`
  - `chunk_meta.meta.json` + `chunk_meta.parts/`
- [x] Add tests covering partial installs and re-run behavior.

**Exit criteria**
- [x] Re-running setup is a no-op when artifacts are already present and valid.

## 5.3 HNSW build output atomicity
- [x] Write HNSW `.bin` to a temp path and atomically replace the final.
- [x] Store actual inserted vector count and validate it matches expectations.

**Exit criteria**
- [x] HNSW artifacts are never half-written and failures preserve prior working indexes.

---

# Phase 6 — Embeddings tooling correctness (cache integrity, decoding alignment, dims validation)

**Objective:** ensure embeddings are correct, deterministic, and not reused across incompatible configs.

## 6.1 Cache key correctness
- [x] Include in embeddings cache keys:
  - model identity (`modelId`)
  - effective dims
  - quantization scale
  - stub vs real mode (and provider)
- [x] Store cache metadata for diagnostics.

**Exit criteria**
- [x] Changing model/dims/scale changes cache key and triggers recompute.

## 6.2 Hashing and decoding consistency
- [x] Compute file hash from raw bytes (buffer), not decoded text.
- [x] Decode text for slicing using the same decode logic as indexing (shared helper).
- [x] Add shared helper `readTextFileWithHash()` used by both indexer and embeddings tool.

**Exit criteria**
- [x] Embeddings slicing is consistent with chunk offsets produced by indexing for non-UTF8 inputs.

## 6.3 Dims mismatch policy (locked decision)
- [x] Detect actual embedding dims from computed vectors.
- [x] If configured dims mismatch actual dims: **fail hard** with an actionable error message.

**Exit criteria**
- [x] Dims mismatch cannot silently truncate vectors.

---

# Phase 7 — SQLite builder integrity, ANN semantics, and hardening

**Objective:** make SQLite build/update safe, deterministic, and injection-resistant.

## 7.1 Transaction boundaries and fail-closed state
- [x] Wrap incremental update in transaction boundaries that prevent partial state from being promoted.
- [x] Ensure `index_state.json` is fail-closed:
  - set pending before work
  - only mark ready after successful replacement/validation

**Exit criteria**
- [x] Failure mid-update does not leave the DB promoted as “ready”.

## 7.2 Bundle-backed rebuild completeness (locked decision)
- [x] Treat missing/invalid bundles as **fatal** for bundle-backed rebuild:
  - either fail closed, or
  - fall back to artifact-backed rebuild (but never produce a silently partial DB)
- [x] Add tests with missing bundle references.

**Exit criteria**
- [x] Bundle-backed rebuild cannot silently drop files.

## 7.3 SQLite replacement hygiene (WAL/-shm)
- [x] Implement `replaceSqliteDatabase(tempDbPath, finalDbPath)` that also manages `-wal`/`-shm` sidecars.
- [x] Use this helper in build and compact tools.
- [x] Add regression test for stale WAL sidecars.

**Exit criteria**
- [x] Stale WAL/shm sidecars do not break rebuilt/compacted DBs.

## 7.4 Injection-safe dynamic SQL
- [x] Validate identifiers (table/column/module names) via allowlist regex.
- [x] Replace raw `options` concatenation with structured config or strict allowlist parsing.
- [x] If validation fails: disable extension mode and warn (do not execute unsafe SQL).

**Exit criteria**
- [x] No config-driven SQL injection primitives remain.

## 7.5 sqlite-vec candidate-set semantics (locked decision)
- [x] Implement candidate pushdown for small candidate sets (exact within candidate set).
- [x] For large candidate sets: best-effort fallback is allowed but must be documented and observable.
- [x] Ensure deterministic ANN ordering (`ORDER BY distance, rowid`).

**Exit criteria**
- [x] Candidate-set correctness is guaranteed for small candidate sets and test-backed.

## 7.6 Extension download/extraction hardening
- [x] Prevent zip-slip/tar traversal and symlink tricks.
- [x] Add malicious archive fixtures and assert extraction never writes outside destination.

**Exit criteria**
- [x] Extension extraction is path-safe and test-backed.

---

# Phase 8 — Service surfaces (API server + MCP server) hardening

**Objective:** make service mode reliable under concurrency, cancellation, and malformed inputs.

## 8.1 API server request validation + error contract (locked decisions)
- [x] Add request schema validation for `/search` and `/search/stream`:
  - reject unknown fields (`additionalProperties: false`)
  - validate types/ranges/enums
- [x] Implement stable error payloads:
  - `NO_INDEX` returns **409**
  - invalid request returns 400
  - internal errors return 500 with `{ ok:false, code:'INTERNAL', ... }`

**Exit criteria**
- [x] API error responses are predictable and machine-parseable.

## 8.2 API server streaming robustness
- [x] Handle client disconnects and propagate cancellation where feasible.
- [x] Respect backpressure (`drain`) and avoid writes-after-close.
- [x] Add tests for aborted streaming requests.

**Exit criteria**
- [x] Streaming endpoints do not leak work or crash on slow/aborting clients.

## 8.3 JSON-RPC framing safety (MCP + LSP)
- [x] Replace per-message writer creation with per-stream writer + serialization queue.
- [x] Provide close semantics to prevent writes-after-close.
- [x] Fix LSP shutdown ordering issues (`ERR_STREAM_DESTROYED`) and add regression tests.

**Exit criteria**
- [x] No frame corruption under concurrent sends.
- [x] Shutdown is deterministic and does not emit stream-destroyed errors.

## 8.4 MCP server backpressure and timeouts (locked decision)
- [x] Implement queue cap with clear error code on overload.
- [x] Implement per-tool timeouts with conservative defaults (overrideable via config).
- [x] Add schema snapshot tests for MCP tool definitions and representative responses.

**Exit criteria**
- [x] MCP cannot hang indefinitely without an explicit long timeout.
- [x] Tool schema changes are intentional and test-detectable.

---

# Phase 9 — Un-gate flaky tests and strengthen CI signals

**Objective:** reduce “safety tape” (skips/gates) and ensure CI failures indicate real regressions.

## 9.1 Un-gate currently skipped/unstable tests
- [x] Fix Windows `fixture-parity` crash (exit 3221226505) with diagnostics and regression.
- [x] Fix `type-inference-crossfile-test` hang with timeouts + deterministic cleanup.
- [x] Fix `type-inference-lsp-enrichment-test` stream shutdown ordering.

**Exit criteria**
- [x] Previously gated tests run deterministically (or are explicitly retired with rationale and cleanup).

## 9.2 Script coverage ≠ correctness
- [x] Split test coverage into:
  - Tier A: surface coverage (command runs/usage/exit codes)
  - Tier B: behavioral correctness (artifact invariants, output invariants, negative tests)
- [x] Require Tier B for artifact-producing scripts.

**Exit criteria**
- [x] Script coverage failures point to missing *meaningful* tests, not only missing invocations.

## 9.3 Add minimal platform matrix
- [x] Add a Windows CI lane running a reduced but meaningful suite:
  - worker pool teardown regression
  - path normalization tests
  - fixture parity (reduced fixture)
- [x] Keep Linux lane as the primary full suite.

**Exit criteria**
- [x] Windows regressions are caught continuously.

---

# Phase 10 — Modularization (refactor-only; behavior frozen by tests)

**Objective:** reduce defect surface area by splitting mega-files only after correctness is stabilized.

## 10.1 Retrieval
- [x] Split `src/retrieval/cli.js` into cohesive modules (normalize options, load indexes, run search, render output, telemetry, highlight).
- [x] Split `src/retrieval/output.js` (filters, explain formatting, context cleaning, caching).

## 10.2 Indexing + language
- [x] Split `src/index/build/file-processor.js` into read/chunk/relations/meta/embeddings/incremental modules.
- [x] Split TypeScript and Tree-sitter integration modules as planned in the Section roadmaps.

## 10.3 Services
- [x] Split `tools/mcp-server.js` into transport/repo/runner/tools modules.     
- [x] Split `tools/api-server.js` into router/validation/sse/response modules.  

**Exit criteria**
- [x] Refactors introduce no behavior change without tests updated accordingly. 
- [x] Modules are cohesive and significantly smaller (soft target: ≤ ~300 LOC). 

---

# Phase 11 — Documentation parity and migration notes

**Objective:** ensure docs/help match actual behavior; document breaking changes introduced by locked decisions.

## 11.1 Retrieval docs and help
- [x] Remove references to removed flags (`--human`, `--headline`) and update examples.
- [x] Document:
  - stable chunk id (`metaV2.chunkId`)
  - filter ordering semantics and `--top` fulfillment expectations
  - explain output components

## 11.2 API server docs
- [x] Align docs with actual SSE event types and routes.
- [x] Document `/metrics`.
- [x] Document the `409 NO_INDEX` behavior and error schema.

## 11.3 SQLite + embeddings docs
- [x] Document bundle-backed rebuild failure behavior.
- [x] Document candidate-set ANN semantics (exact small / best-effort large).
- [x] Document dims mismatch hard-failure behavior and remediation steps.

**Exit criteria**
- [x] Docs and CLI help no longer contradict implementation.

---

# Phase 12 — Additional phases (gaps not fully covered by the source roadmaps)

These phases are recommended additions based on codebase risk profile.

## 12.1 Security posture and supply-chain hardening
- [x] Add archive extraction hardening beyond traversal:
  - size limits (zip bombs)
  - safe symlink handling
  - permission normalization
- [x] Add download verification policy for external artifacts (hash allowlists or signed manifests where feasible).
- [x] Add “untrusted repo indexing” guardrails (file size caps, recursion limits, degenerate input protection).

## 12.2 Cross-surface error taxonomy + observability consistency
- [x] Define a shared error code taxonomy used by:
  - CLI
  - API server
  - MCP server
- [x] Standardize structured logging (especially for service modes).
- [x] Align metrics labels and ensure key counters exist (timeouts, fallbacks, cache hits/misses).

## 12.3 Release readiness discipline
- [x] Define versioning rules for:
  - output schema changes
  - artifact schema changes
  - CLI flag removals/renames
- [x] Add a concise changelog process that is enforced for breaking changes.

---

## Appendix — Dependency-optimized execution order (recommended)

1) Phase 0 (baseline truth + remove broken docs-consistency script)  
2) Phase 1 (stop-the-bleeding P0 fixes)  
3) Phase 2–4 (retrieval CLI + chunking + early filtering semantics)  
4) Phase 5–7 (artifact durability + embeddings + SQLite integrity)  
5) Phase 8–9 (services hardening + un-gating tests + CI matrix)  
6) Phase 10–12 (modularization, docs parity, security/observability/release discipline)


# Phase 21 — Storage, Compression, and Determinism (Fflate, Msgpackr, Roaring, XXHash, LMDB)

**Objective:** Implement durable, efficient artifact storage with deterministic formats and checksums.

## 21.1 Compression and serialization
- [x] Use `fflate` streaming compression for large artifacts; update `docs/artifact-contract.md`.
- [x] Add `msgpackr` envelope format for bundles with deterministic encoding and checksums.

## 21.2 Postings storage and hashing
- [x] Use `roaring-wasm` for bitmap-accelerated filter evaluation now that it is implemented.
- [x] Use `xxhash-wasm` for checksums; keep sha1 for legacy identifiers where required.

## 21.3 Alternative storage backend
- [x] Implement optional LMDB backend (`lmdb`) with keyspace schema + migration rules.
- [x] Add throughput and corruption checks in `tools/report-artifacts.js` and bench runs.

**Deliverables**
- Compressed, deterministic artifact formats with checksum validation.
- Optional LMDB backend with benchmarks.

**Exit criteria**
- Artifacts validate deterministically and storage backends pass integrity checks.

---


## 4.2 Advanced **risk analysis**: sources / sinks / sanitizers / flows

### Dependency guidance (best choices)
- `@ast-grep/napi` — implement rule packs for sources/sinks/sanitizers using structural patterns (AST-level matching).
  - Use the JS API for integration; keep rule packs versioned and testable.
- `re2js` — use for user-supplied or configurable regex rules to avoid ReDoS in large repos.
- `aho-corasick` — accelerate “dictionary style” scanning (many fixed tokens like sink names, env var keys, SQL APIs) before expensive AST passes.
- `graphology` — represent flows as graphs (nodes = symbols/expressions/files; edges = dataflow/callflow/import).
  - Use traversal + shortest-path utilities for explainable flow paths.
- `roaring-wasm` — represent taint sets and reachability sets efficiently; union/intersection are hot-path ops for flows.

The current regex-based “sources × sinks” cartesian product is a useful baseline, but not advanced.

## 4.3 Advanced **type inference** (local + cross-file + tooling)

Completed; moved to `COMPLETED_PHASES.md`.

## Phase 1: Make the roadmap executable and falsifiable

### 1.1 Truth table: behavioral ledger of user-visible invariants

**Audit (code evidence)**

- A truth-table document exists: `docs/truth-table.md`.
- Additional “contract” style docs exist and help (even if not named “truth table”):
  - `docs/artifact-contract.md`
  - `docs/search-contract.md`

**Gaps / issues**

- None noted; truth table now maps behavior to implementation, config, and tests.

**Remaining work**

- [x] Expand `docs/truth-table.md` into a complete “behavioral ledger” for:
  - build modes/stages (stage1–stage4),
  - all public `--mode` values (including any supported “extracted-prose” semantics),
  - backend selection rules (file-backed vs sqlite; auto/fallback vs forced),
  - key indexing invariants (chunk IDs, artifact names, sharding formats),
  - search semantics (filters, ranking, explain output),
  - service/API/MCP behavior (job queueing, timeouts/retries).
- [x] For each truth-table claim, add:
  - “Implementation pointers” (file paths + function names),
  - “Config knobs” (profile/env keys),
  - “Proving tests” (tests that would fail if the claim breaks).

### 1.2 Acceptance fixtures + golden expectations

**Audit**

- Multiple fixture repos exist:
  - `tests/fixtures/sample`
  - `tests/fixtures/mixed`
  - `tests/fixtures/medium` generator (`generate-medium-fixture.cjs`)
- There are strong integration tests around fixtures and parity:
  - `tests/fixture-smoke.js`
  - `tests/fixture-parity.js` / `tests/parity.js`

**Gaps / issues**

- There is no “golden must-hit” query pack that asserts specific retrieval expectations for:
  - comment-derived matches vs code matches,
  - risk/type filters,
  - extracted-prose behavior (if supported).

**Remaining work**

- [ ] Add a small “golden query suite” for `tests/fixtures/mixed` with assertions like:
  - query → expected file(s)/chunk(s) appear in top-N
  - filters change results in predictable ways
- [x] Add a dedicated extracted-prose fixture/query (`tests/extracted-prose.js`).
- [x] Add deletion coverage to incremental reuse tests (manifest extra entry now forces reuse rejection).

### 1.3 Tool invocation correctness: install-root vs repo-root
Completed; moved to `COMPLETED_PHASES.md`.

### 1.4 Determinism + reproducibility baseline
Completed; moved to `COMPLETED_PHASES.md`.

---

## Phase 2: Artifact contract, metadata contract, and durability

### 2.1 Artifact contract + index-validate tool
Completed; moved to `COMPLETED_PHASES.md`.

### 2.2 Metadata schema v2
Completed; moved to `COMPLETED_PHASES.md`.

---

## Phase 3: Segment-aware chunking, mixed-file support, and prose
Completed sections 3.1-3.4; moved to `COMPLETED_PHASES.md`.

### 3.5 Correctness tests for segmentation + prose

**Remaining work**

- [x] Add extracted-prose build/search integration tests (`tests/extracted-prose.js`).
- [ ] Add a golden-query test proving comment-field vs code-field behavior (e.g., query that matches only a comment should still retrieve the owning code chunk).

---

## Phase 5: Retrieval correctness, parity, and benchmark harness
Completed; moved to `COMPLETED_PHASES.md`.

## Phase 7: Operational hardening, observability, and service surfaces
Completed; moved to `COMPLETED_PHASES.md`.

---

# Appendix A: COMPLETED_PHASES.md cross-check (dedupe + drift notes)

This repository contains a historical “completed phases” ledger in `COMPLETED_PHASES.md`. The ledger includes multiple phase-number series and several references that appear to be from older layouts. Where the completed phases describe an older approach that has been superseded by a newer design, this audit treats the older approach as **(DEPRECATED/REPLACED)** and focuses on verifying the best/latest implementation.

## A.1 Doc/reference drift (files/dirs referenced but not present)

The following references are still missing from the current repository layout:

- `scripts/config`
- `scripts/styles`
- `scripts/tools`
- `docs/config` (directory)
- `docs/tests` (directory)
- `tests/fixtures/docs`
- `tests/fixtures/external-docs`

Previously noted drift entries now have clear replacements or are present:

- `tools/index-bench-suite.js` -> `tools/bench-query-generator.js` + `tests/bench.js`
- `docs/phase3-parity-report.json` exists in `docs/`
- `tools/bench-compare-models.js` -> `tools/compare-models.js`
- `tools/mergeNoResultQueries.js` -> `tools/merge-no-results.sh`
- `tools/mergeSearchHistory.js` -> `tools/merge-history.sh`
- `tools/search-sqlite.js` -> `search.js --backend sqlite`

## A.2 High-confidence verification of major “completed” subsystems

The following completed-phase feature clusters are clearly implemented in code and generally covered by tests:

- Cache layout and repo/build root resolution:
  - `tools/dict-utils.js`, tests `tests/tool-root.js`, `tests/repo-root.js`
- Tooling detect/install + language servers:
  - `tools/tooling-detect.js`, `tools/tooling-install.js`, and providers under `src/index/tooling/`
- Structural search surface:
  - `bin/pairofcleats.js` structural commands, structural matching under `src/retrieval/structural-*.js`, tests `tests/structural-search.js`
- Ingest tools (ctags/gtags/lsif/scip):
  - `tools/ctags-ingest.js`, `tools/gtags-ingest.js`, `tools/lsif-ingest.js`, `tools/scip-ingest.js`
- Service-mode indexing:
  - `tools/indexer-service.js`, `tools/service/queue.js`, tests `tests/indexer-service.js`, `tests/two-stage-state.js`
- API and MCP:
  - `tools/api-server.js`, `tools/mcp-server.js`, tests `tests/api-server.js`, `tests/mcp-smoke.js`

### Previously noted cross-cutting issues (now resolved)

Even where the phase is “complete,” the following issues were addressed (they affected completed functionality too):

- Incremental reuse deletion correctness (fixed in `src/index/build/incremental.js` + `tests/incremental-reuse.js`)
- Library-unsafe process exit in sqlite backend creation (fixed in `src/retrieval/cli-sqlite.js`)
- Stage3 durability/atomicity inconsistencies (fixed in `tools/build-embeddings.js` + index_state gating)

---

## Appendix B: Suggested new tests (concrete proposals)

These are intentionally specific and can be added quickly.

1. **Incremental deletion reuse test**
   - Build code index for a small fixture
   - Assert file `X` produces at least one chunk
   - Delete file `X`
   - Re-run build with reuse enabled
   - Assert `chunk_meta` contains no entries for `X` and searching a unique token from `X` yields no hits
   - Status: manifest-level deletion coverage added in `tests/incremental-reuse.js`; full fixture/search variant still optional.

2. **Extracted-prose integration test (if supported)**
   - Build `--mode extracted-prose` for a fixture containing doc-comments and config blocks
   - Search for a phrase that appears only in comments and verify results appear from extracted-prose index
   - Status: implemented in `tests/extracted-prose.js`.

3. **SQLite backend non-fatal missing dependency test**
   - Simulate `better-sqlite3` import failure (dependency injection or env guard)
   - In backend “auto,” verify search falls back to file-backed
   - In backend “forced sqlite,” verify a structured error is returned/thrown (no process exit)
   - Status: implemented in `tests/sqlite-missing-dep.js` (env guard via `PAIROFCLEATS_SQLITE_DISABLED`).

4. **Stage3 embeddings validation test**
   - Run stage2 build with embedding service disabled (or stubbed)
   - Run `tools/build-embeddings.js`
   - Run `tools/index-validate.js` and assert pass
   - Verify `index_state.json` updated atomically (e.g., checksum of file valid, schema valid)
   - Status: implemented in `tests/embeddings-validate.js` (build + embeddings + validate, index_state flags checked).

---

# Phase 22 — Phase 2/3/4/5/6 verification gates

**Objective:** run and gate the regression tests that confirm Phase 2 contract alignment, Phase 3 chunking invariants, Phase 4 retrieval semantics, Phase 5 durability, and Phase 6 embeddings correctness.

## 22.1 CLI flag removal and error handling
- [ ] `tests/search-removed-flags.js`
- [ ] `tests/search-missing-flag-values.js`

## 22.2 Windows path filter normalization
- [ ] `tests/search-windows-path-filter.js`

## 22.3 Explain output completeness
- [ ] `tests/search-explain-symbol.js`

## 22.4 Chunk identity and deterministic chunking
- [ ] `tests/chunking-limits.js`
- [ ] `tests/graph-chunk-id.js`
- [ ] `tests/sqlite-chunk-id.js`

## 22.5 Retrieval filtering + determinism
- [ ] `tests/search-topn-filters.js`
- [ ] `tests/search-determinism.js`

## 22.6 Artifact durability + setup idempotency
- [ ] `tests/artifact-bak-recovery.js`
- [ ] `tests/setup-index-detection.js`
- [ ] `tests/hnsw-atomic.js`

## 22.7 Embeddings cache + decoding + dims
- [ ] `tests/encoding-hash.js`
- [ ] `tests/embeddings-cache-identity.js`
- [ ] `tests/embeddings-dims-mismatch.js`

## 22.8 SQLite integrity + extension hardening
- [ ] `tests/sqlite-index-state-fail-closed.js`
- [ ] `tests/sqlite-bundle-missing.js`
- [ ] `tests/sqlite-sidecar-cleanup.js`
- [ ] `tests/vector-extension-sanitize.js`
- [ ] `tests/sqlite-vec-candidate-set.js`
- [ ] `tests/download-extensions.js`

## 22.9 Service hardening + JSON-RPC safety
- [ ] `tests/api-server.js`
- [ ] `tests/api-server-stream.js`
- [ ] `tests/mcp-schema.js`
- [ ] `tests/mcp-robustness.js`
- [ ] `tests/lsp-shutdown.js`

## 22.10 Phase 9 CI gating + flaky test recovery
- [ ] `tests/fixture-parity.js`
- [ ] `tests/type-inference-crossfile.js`
- [ ] `tests/type-inference-lsp-enrichment.js`
- [ ] `tests/script-coverage.js`
- [ ] `tests/worker-pool-windows.js`
- [ ] `tests/search-windows-path-filter.js`

## 22.11 Phase 10 modularization regression sweep
- [ ] `tests/cli.js`
- [ ] `tests/search-help.js`
- [ ] `tests/format-fidelity.js`
- [ ] `tests/summary-report.js`
- [ ] `tests/segment-pipeline.js`
- [ ] `tests/ts-jsx-fixtures.js`
- [ ] `tests/typescript-parser-selection.js`
- [ ] `tests/tree-sitter-chunks.js`
- [ ] `tests/mcp-server.js`
- [ ] `tests/smoke-services.js`

## 22.12 Phase 11 docs/help parity checks
- [ ] `tests/search-help.js`
- [ ] `tests/search-removed-flags.js`
- [ ] `tests/api-server.js`
- [ ] `tests/api-server-stream.js`

## 22.13 Phase 12 security + observability checks
- [ ] `tests/download-extensions.js`
- [ ] `tests/download-dicts.js`
- [ ] `tests/discover.js`

## 22.14 Phase 21.3 LMDB integrity + throughput checks
- [ ] `tests/lmdb-report-artifacts.js`
- [ ] `tests/lmdb-corruption.js`

## 22.15 Phase 1.1 truth table coverage
- [ ] `tests/truth-table.js`

**Exit criteria**
- [ ] All Phase 2/3/4/5/6 verification tests pass.



