# PairOfCleats GigaRoadmap

## Status legend

Checkboxes represent “meets the intent of the requirement, end-to-end, without known correctness gaps”:

- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [ ] Not complete **or** there is a correctness gap **or** there is a missing/insufficient test proving behavior

Completed Phases: `COMPLETED_PHASES.md`

## Roadmap order (stability/performance frontloaded)

1.  Phase 13 — Retrieval, Services & Benchmarking/Eval (Latency End-to-End)
2.  Phase 14 — Documentation and Configuration Hardening
3.  Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)
4.  Phase 20 — Threadpool-aware I/O scheduling guardrails
5.  Phase 21 — (Conditional) Native LibUV work: only if profiling proves a real gap
6.  Phase 22 — Embeddings & ANN (onnx/HNSW/batching/candidate sets)
7.  Phase 23 — Index analysis features (metadata/risk/git/type-inference) — Review findings & remediation checklist
8.  Phase 24 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)
9.  Phase 25 — Massive functionality boost: PDF + DOCX ingestion (prose mode)
10.  Phase 28 — Distribution Readiness (Package Control + Cross-Platform)
11.  Phase 29 — Optional: Service-Mode Integration for Sublime (API-backed Workflows)
12.  Phase 30 — Verification Gates (Regression + Parity + UX Acceptance)
13.  Phase 31 — Isometric Visual Fidelity (Yoink-derived polish)
14.  Phase 41 — Test runner reframe (split lanes + per-lane gating)
15.  Phase 42 — Storage regression splits (sqlite/lmdb/vector extension)
16.  Phase 44 — Merge Phase 32-40 test followups (streaming, extracted-prose, code map)

## Phase 13 — Retrieval, Services & Benchmarking/Eval (Latency End-to-End)

### Objective

Validate and improve the **retrieval pipeline**, **services surfaces (API + MCP)**, and **benchmark/eval tooling** so that:

* Search semantics are correct and contract-aligned (query parsing, filters, ranking, explain output, context expansion).
* Backends behave consistently (memory / sqlite / sqlite-fts / lmdb) and performance paths are not accidentally disabled.
* Services are robust (streaming behavior, cancellation, backpressure, security posture).
* Benchmarks and eval harnesses are actionable, reproducible, and can enforce latency/quality budgets.

### Scope

Reviewed the complete Section 8 list from the attached markdown checklist document, including:

* Retrieval CLI + pipeline + filters + output formatting
* SQLite/LMDB helpers and cache layers
* Core integrations used by tools/services
* API server (router + SSE) and MCP transport/tools
* Benchmark harnesses (micro + language) and query tooling
* Eval harness
* Related docs + tests + fixtures

(Where files referenced other modules not in the Section 8 list, I noted mismatches and dependency risks, but the primary focus remains the Section 8 scope.)

---

### Exit Criteria (What “Done” Looks Like)

#### Correctness & Contracts

* [ ] Query parsing supports required constructs (operators/quoting/negation/precedence) or docs/contracts explicitly define the simplified grammar.
* [ ] Filters are correctly detected as “active” and do not disable backend fast-paths accidentally.
* [ ] Explain output matches actual scoring math and is emitted only when requested (or contracts updated to reflect always-present fields).

#### Performance & Latency

* [ ] SQLite FTS fast-path is not disabled by default (especially for large indexes).
* [x] Context expansion avoids repeated O(N) scans per query (or is cached/optimized).
* [ ] Benchmarks can write baselines reliably and optionally enforce budgets.

#### Services Robustness

* [ ] API streaming handles backpressure and connection close without hanging.
* [ ] API/MCP support cancellation/timeout propagation to stop expensive work.
* [ ] CORS/security posture is explicitly intentional and documented.

#### Tests & Tooling

* [ ] Tests cover discovered regressions and add missing edge cases (FTS eligibility, extracted-prose query caching, MCP id=0, etc.).
* [ ] Bench/eval docs match actual behavior and command usage.

---

## Findings & Required Work

### 13.A — Retrieval Semantics, Explain, Context Expansion (Review Section 8.A)

#### A1 — **Critical: Filter “active” detection is wrong (breaks performance paths)**

**Files:**

* `src/retrieval/filters.js`
* `src/retrieval/cli.js`
* `src/retrieval/pipeline.js`
* `src/retrieval/sqlite-helpers.js` (indirect impact via CLI choices)

**What I found:**
`hasActiveFilters()` treats *any non-empty object* as “active,” which causes `filtersActive` to be true even when no user filters are set, because the CLI always includes internal objects like `filePrefilter`.

**Impact:**

* Forces filter pass on every query.
* Can disable SQLite FTS eligibility for large indexes because allowed-id pushdown cannot be used when the “allowed set” becomes huge.
* Prevents “lazy chunk loading” decisions that should apply when there are no real filters.
* Creates major, silent performance regressions at scale.

**Action items:**

* [ ] Fix `hasActiveFilters()` to ignore internal/config-only keys (e.g., `filePrefilter`) and only count user-constraining filters.
* [ ] Add unit tests for `hasActiveFilters()` default filter object and typical combinations.
* [ ] Add an integration test ensuring sqlite-fts remains eligible on a large index when no filters are set (or at least verify the path selection in stats/debug output).

---

#### A2 — **Context expansion does repeated O(N) indexing work per query**

**Files:**

* `src/retrieval/context-expansion.js`
* `src/retrieval/cli.js` (enables context expansion)
* `src/retrieval/pipeline.js`

**What I found:**
`buildContextIndex()` rebuilds `byName` and `byFile` maps every query.

**Impact:**

* For large repos, this adds noticeable latency per query.
* Violates checklist intent: “avoids repeated file reads / expensive rebuilds.”

**Action items:**

* [x] Cache context index per loaded index signature (store on the loaded index object or in `index-cache.js`).
* [x] Add tests to ensure expansions are stable and do not cross branch/filters (if applicable).
* [ ] Document the intended semantic boundaries of context expansion (same file vs cross-file, name matching rules, etc.).

---

#### A3 — Explain output / scoring contract alignment is ambiguous

**Files:**

* `src/retrieval/pipeline.js`
* `src/retrieval/output/explain.js`
* `src/retrieval/cli/render-output.js`
* Docs: `docs/contracts/retrieval-ranking.md` (very high-level)

**What I found:**
The pipeline always builds `scoreBreakdown` objects, even if explain is not requested; compact JSON hides it, but full JSON may expose it unintentionally.

**Action items:**

* [ ] Decide contract behavior:

  * Option 1: Only compute/attach `scoreBreakdown` when explain requested.
  * Option 2: Always include but document it (and remove `--explain` implication of optionality).
* [ ] Add snapshot tests asserting the presence/absence of explain fields by mode/output format.
* [ ] Ensure explain’s boost attribution matches scoring math (phrase + symbol boosts currently depend on the already-boosted score; document or adjust).

---

### 13.B — Query Parsing & Filtering (Review Section 8.B)

#### B1 — Query parsing does not satisfy checklist requirements

**Files:**

* `src/retrieval/query.js`
* `src/retrieval/query-parse.js`
* Tests/docs indirectly

**What I found:**
Parsing supports:

* quoted phrases (`"..."`)
* negation via `-token` and `-"phrase"`

It does **not** support:

* boolean operators (AND/OR/NOT) semantics
* precedence / parentheses
* actionable errors for malformed queries (unbalanced quotes become literal tokens)

**Action items:**

* [ ] Either implement full operator parsing & precedence or explicitly constrain and document the query grammar.
* [ ] Add detection + actionable error messages for unbalanced quotes and invalid constructs.
* [ ] Add tests for negated phrases, nested quotes, malformed input, and operator tokens.

---

#### B2 — Filtering: performance and correctness concerns

**Files:**

* `src/retrieval/output/filters.js`
* `src/retrieval/filter-index.js`

**Key improvements:**

* [ ] Ensure case-sensitive file filters don’t lose correctness through normalization shortcuts (currently used for prefiltering; confirm final checks are strict).
* [ ] Consider memory growth of filter index structures; document expected footprint and add soft limits/metrics.

---

### 13.C — Ranking Determinism & Tie-Breaking (Review Section 8.C)

#### C1 — Dense ranking should defensively validate embedding dimensionality

**Files:**

* `src/retrieval/rankers.js`
* `src/retrieval/embedding.js`
* `src/retrieval/sqlite-helpers.js`

**What I found:**
`rankDenseVectors()` assumes query embedding length matches index vector dimension. If not, dot-products can become NaN and ranking becomes unstable.

**Action items:**

* [ ] Validate query embedding length vs index dims; if mismatch, either truncate safely or skip dense scoring with a clear warning.
* [ ] Add tests for dims mismatch (stub embeddings + configured dims is a good harness).

---

#### C2 — SQLite dense vector scale fallback looks unsafe

**Files:**

* `src/retrieval/sqlite-helpers.js`
* Related: `src/storage/sqlite/vector.js` (quantization uses 2/255)

**What I found:**
If `dense_meta.scale` is missing for any reason, sqlite helper defaults scale to **1.0**, which would break score normalization badly for uint8 quantized vectors.

**Action items:**

* [ ] Change fallback scale default to `2/255` (and minVal to `-1` consistent with vector quantization).
* [ ] Add a regression test ensuring dense scoring remains bounded even when meta is missing/corrupt (or fail loudly).

---

### 13.D — Services: API Server & MCP (Review Section 8.D)

#### D1 — SSE backpressure “drain wait” can hang indefinitely on closed connections

**Files:**

* `tools/api/sse.js`

**What I found:**
If `res.write()` returns false, the code awaits `'drain'` only. If the client disconnects before drain fires, that promise may never resolve.

**Action items:**

* [ ] Replace `await once('drain')` with `Promise.race([drain, close, error])`.
* [ ] Add tests simulating backpressure + early disconnect (larger payload / forced write buffering).

---

#### D2 — Streaming contracts/docs do not match actual /search/stream behavior

**Files:**

* `tools/api/router.js`
* Docs: `docs/api-server.md`, `docs/contracts/api-mcp.md`

**What I found:**
`/search/stream` only emits:

* `start`
* `result` OR `error`
* `done`

Docs/contracts claim progress streaming and/or richer semantics.

**Action items:**

* [ ] Decide: implement progress events (pipeline milestones) OR revise docs/contracts to match current behavior.
* [ ] If implementing progress: add hooks from retrieval CLI/pipeline → core API → router SSE.

---

#### D3 — Cancellation/timeout propagation is missing end-to-end

**Files:**

* `tools/api/router.js`
* `tools/mcp/transport.js`
* `tools/mcp/tools.js`
* `src/integrations/core/index.js`
* `src/retrieval/cli.js` (currently no signal handling)

**What I found:**
Timeouts exist in MCP wrapper, but they do not abort underlying work. API does not abort search on client disconnect. Retrieval does not consume `AbortSignal`.

**Action items:**

* [ ] Introduce `AbortController` per request/tool call.
* [ ] Wire close events (`req.on('close')`) and timeout timers to `abort()`.
* [ ] Teach retrieval pipeline / embedding fetch to check `signal.aborted` and throw a consistent cancellation error.
* [ ] Add tests:

  * API stream abort stops work early (not just stops writing).
  * MCP tool timeout aborts the underlying work, not just returns an error.

---

#### D4 — Security posture: permissive CORS is risky

**Files:**

* `tools/api/router.js`
* Docs: `docs/api-server.md`

**What I found:**
CORS is `*` by default. Even though server defaults to localhost, permissive CORS enables untrusted sites to read responses from a local service in a browser context.

**Action items:**

* [ ] Default CORS to disabled or restricted (require explicit `--cors` enablement).
* [ ] Document threat model: local-only, trusted environment, or add token-based auth.
* [ ] Add tests for CORS behavior (preflight, allowed origins).

---

### 13.E — Benchmarks & Latency Budgets (Review Section 8.E)

#### E1 — Microbench “dense” vs “hybrid” distinction is not actually implemented

**Files:**

* `tools/bench/micro/run.js`
* `tools/bench/micro/search.js`
* `tools/bench/micro/tinybench.js`
* Docs: `docs/benchmarks.md`

**What I found:**
Bench tasks labeled “dense” and “hybrid” do not reliably enforce different scoring regimes. Some of the logic implies profiles/env-driven behavior that isn’t applied.

**Action items:**

* [ ] Implement explicit scoring strategy selection (via args/env/profile) for sparse vs dense vs hybrid.
* [ ] Confirm the benchmark measures what it claims (esp. hybrid weighting).
* [ ] Add “sanity asserts” in benchmark output to record which strategy actually ran.

---

#### E2 — Baseline writing can fail because directories don’t exist

**Files:**

* `tools/bench/micro/tinybench.js`
* Docs: `docs/benchmarks.md`

**What I found:**
`--write-baseline` writes to `benchmarks/baselines/...` but does not create the directory first.

**Action items:**

* [ ] Ensure baseline directory exists via `fs.mkdirSync(..., { recursive:true })`.
* [ ] Add a test for `--write-baseline` success on a clean repo checkout.
* [ ] Update docs to clarify how baselines are created and stored.

---

#### E3 — SQLite cache reuse is missing in benchmark harnesses

**Files:**

* `tools/bench/micro/run.js`
* `tools/bench/micro/tinybench.js`

**What I found:**
Bench harnesses often pass `sqliteCache = null`, which may force repeated DB opens and distort warm-run measurements.

**Action items:**

* [ ] Instantiate and reuse `createSqliteDbCache()` across runs for warm scenarios.
* [ ] Record cache reuse status in benchmark output for transparency.

---

#### E4 — Latency “budgets” are described but not enforceable

**Files:**

* `docs/benchmarks.md`
* Tests: existing bench tests do not enforce budgets

**Action items:**

* [ ] Define target budgets (p50/p95) for representative queries and backends.
* [ ] Add CI-friendly “perf smoke” tests that fail if budgets regress beyond thresholds (with generous margins and stable fixtures).
* [ ] Document environment assumptions for benchmarks (CPU, disk, warmup, etc.).

---

### 13.F — Eval Harness (Review Section 8.F)

#### F1 — Matching logic is permissive and may inflate scores

**Files:**

* `tools/eval/run.js`
* Docs: `docs/eval.md`

**What I found:**
Expected match uses `hit.name.includes(expected.name)`; that may treat `foo` as matching `foobar`.

**Action items:**

* [ ] Decide strictness: exact name match vs substring vs regex.
* [ ] Add dataset option `matchMode` or per-expected matcher configuration.
* [ ] Add tests for false-positive matching cases.

---

## Additional Concrete Bugs Found (Non-Checklist)

### G1 — Retrieval output summary “word count” logic uses character length

**Files:**

* `src/retrieval/output/format.js`

**What I found:**
The summary logic compares `.length` of the string (characters) to a “maxWords” variable and uses it to adjust `maxWords`. This is unit-inconsistent and likely incorrect behavior.

**Action items:**

* [ ] Fix to track word count, not character length.
* [ ] Avoid calling `getBodySummary()` twice.
* [ ] Add tests for summary length behavior.

---

### G2 — Parity test references missing benchmark query file path

**Files:**

* `tests/parity.js`
* Existing file: `tests/parity-queries.txt`

**What I found:**
`tests/parity.js` reads from `benchmarks/queries/parity-queries.txt`, but the queries file exists under `tests/parity-queries.txt`.

**Action items:**

* [ ] Update parity test to load from `tests/parity-queries.txt` (or move file to benchmarks).
* [ ] Add a guard assertion that query file exists with a clear message.

---

### G3 — Language benchmark progress renderer imports wrong relative paths

**Files:**

* `tools/bench/language/progress/render.js`

**What I found:**
Imports reference `../../../src/shared/...` but need one more `../` to reach repo root. As written, this resolves to `tools/src/shared/...` which doesn’t exist.

**Action items:**

* [ ] Fix import paths to `../../../../src/shared/...`.
* [ ] Add a smoke test that loads the module (ensures no runtime import failures).

---

### G4 — MCP transport drops valid JSON-RPC ids when id = 0

**Files:**

* `tools/mcp/transport.js`

**What I found:**
`if (!id) return;` treats `0` as falsy and drops responses/notifications. JSON-RPC allows `id: 0`.

**Action items:**

* [ ] Change checks to `(id === null || id === undefined)`.
* [ ] Add MCP tests sending `id: 0`.

---

### G5 — Bench query generator emits invalid CLI fragments (and lacks quoting)

**Files:**

* `tools/bench-query-generator.js`

**What I found:**
At least one strategy emits `--signature` without a value. Additionally, values with spaces (authors, types) are not quoted, which will break shell parsing.

**Action items:**

* [ ] Fix signature strategy to emit `--signature "<value>"`.
* [ ] Quote/escape all flag values safely.
* [ ] Clarify intended consumer (CLI vs internal harness) and ensure output format matches it.

---

## Test Coverage Additions (Highly Recommended)

### New/Expanded Tests

* [ ] `hasActiveFilters()` default object returns false; internal config-only objects don’t activate filters.
* [ ] sqlite-fts eligibility remains enabled for unfiltered queries on large (>900 chunks) indexes.
* [ ] Query cache includes extracted-prose payloads and validates required fields when mode enabled.
* [ ] SSE backpressure + client disconnect doesn’t hang.
* [ ] API abort cancels search work (requires AbortSignal support).
* [ ] MCP id=0 support.
* [ ] `--write-baseline` creates directories and succeeds.

---

## Documentation Corrections Required

* [ ] `docs/api-server.md`: align stream behavior (progress vs start/result/done), update security/CORS discussion.
* [ ] `docs/contracts/api-mcp.md`: align `/search/stream` contract to actual behavior or update implementation.
* [ ] `docs/benchmarks.md`: document baseline creation and ensure code supports it (mkdir); clarify dense/hybrid distinctions.
* [ ] `docs/mcp-server.md`: appears outdated vs actual transport implementation; update to match current code.

---

## Phase 14 — Documentation and Configuration Hardening

**Objective:** Ensure the fixed behavior is discoverable, configurable, and hard to misconfigure into an unsafe state.

1. **Document security posture and safe defaults**

   * [ ] Document:
     * API server host binding risks (`--host 0.0.0.0`)
     * CORS policy and how to configure allowed origins
     * Auth token configuration (if implemented)
     * RepoPath allowlist behavior
   * [ ] Add a prominent note: indexing untrusted repos and symlinks policy.

2. **Add configuration schema coverage for new settings**

   * [ ] If adding config keys (CORS/auth/cache TTL), ensure they are:
     * Reflected in whatever config docs you maintain
     * Validated consistently (even if validation is lightweight)

**Exit criteria**

* [ ] README/docs reflect new defaults and how to safely expose services.
* [ ] New options are documented and validated enough to prevent silent misconfiguration.

---


## Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)

**Objective:** Make libuv threadpool sizing an explicit, validated, and observable runtime control so PairOfCleats I/O concurrency scales predictably across platforms and workloads.

### 19.1 Audit: identify libuv-threadpool-bound hot paths and mismatch points

* [ ] Audit all high-volume async filesystem call sites (these ultimately depend on libuv threadpool behavior):
  * [ ] `src/index/build/file-processor.js` (notably `runIo(() => fs.stat(...))`, `runIo(() => fs.readFile(...))`)
  * [ ] `src/index/build/file-scan.js` (`fs.open`, `handle.read`)
  * [ ] `src/index/build/preprocess.js` (file sampling + `countLinesForEntries`)
  * [ ] `src/shared/file-stats.js` (stream-based reads for line counting)
* [ ] Audit concurrency derivation points where PairOfCleats may exceed practical libuv parallelism:
  * [ ] `src/shared/threads.js` (`ioConcurrency = ioBase * 4`, cap 32/64)
  * [ ] `src/index/build/runtime/workers.js` (`createRuntimeQueues` pending limits)
* [ ] Decide and record the intended precedence rules for threadpool sizing:
  * [ ] Whether PairOfCleats should **respect an already-set `UV_THREADPOOL_SIZE`** (recommended, matching existing `NODE_OPTIONS` behavior where flags aren’t overridden if already present).

### 19.2 Add a first-class runtime setting + env override

* [ ] Add config key (new):
  * [ ] `runtime.uvThreadpoolSize` (number; if unset/invalid => no override)
* [ ] Add env override (new):
  * [ ] `PAIROFCLEATS_UV_THREADPOOL_SIZE` (number; same parsing rules as other numeric env overrides)
* [ ] Implement parsing + precedence:
  * [ ] Update `src/shared/env.js`
    * [ ] Add `uvThreadpoolSize: parseNumber(env.PAIROFCLEATS_UV_THREADPOOL_SIZE)`
  * [ ] Update `tools/dict-utils.js`
    * [ ] Extend `getRuntimeConfig(repoRoot, userConfig)` to resolve `uvThreadpoolSize` with precedence:
      * `userConfig.runtime.uvThreadpoolSize` → else `envConfig.uvThreadpoolSize` → else `null`
    * [ ] Clamp/normalize: floor to integer; require `> 0`; else `null`
    * [ ] Update the function’s return shape and JSDoc:

      * from `{ maxOldSpaceMb, nodeOptions }`
      * to `{ maxOldSpaceMb, nodeOptions, uvThreadpoolSize }`

### 19.3 Propagate `UV_THREADPOOL_SIZE` early enough (launcher + spawned scripts)

* [ ] Update `bin/pairofcleats.js` (critical path)
  * [ ] In `runScript()`:
    * [ ] Resolve `runtimeConfig` as today.
    * [ ] Build child env as an object (don’t pass `process.env` by reference when you need to conditionally add keys).
    * [ ] If `runtimeConfig.uvThreadpoolSize` is set and `process.env.UV_THREADPOOL_SIZE` is not set, add:
      * [ ] `UV_THREADPOOL_SIZE = String(runtimeConfig.uvThreadpoolSize)`
    * [ ] (Optional) If `--verbose` or `PAIROFCLEATS_VERBOSE`, log a one-liner showing the chosen `UV_THREADPOOL_SIZE` for the child process.
* [ ] Update other scripts that spawn Node subcommands and already apply runtime Node options, so they also carry the threadpool sizing consistently:
  * [ ] `tools/setup.js` (`buildRuntimeEnv()`)
  * [ ] `tools/bootstrap.js` (`baseEnv`)
  * [ ] `tools/ci-build-artifacts.js` (`baseEnv`)
  * [ ] `tools/bench-language-repos.js` (repo child env)
  * [ ] `tests/bench.js` (bench child env when spawning search/build steps)
  * [ ] `tools/triage/context-pack.js`, `tools/triage/ingest.js` (where `resolveNodeOptions` is used)
  * Implementation pattern: wherever you currently do `{ ...process.env, NODE_OPTIONS: resolvedNodeOptions }`, also conditionally set `UV_THREADPOOL_SIZE` from `runtimeConfig.uvThreadpoolSize` if not already present.

> (Optional refactor, if you want to reduce repetition): add a helper in `tools/dict-utils.js` like `resolveRuntimeEnv(runtimeConfig, baseEnv)` and migrate the call sites above to use it.

### 19.4 Observability: surface “configured vs effective” values

* [ ] Update `tools/config-dump.js`
  * [ ] Include in `payload.derived.runtime`:
    * [ ] `uvThreadpoolSize` (configured value from `getRuntimeConfig`)
    * [ ] `effectiveUvThreadpoolSize` (from `process.env.UV_THREADPOOL_SIZE` or null/undefined if absent)
* [ ] Add runtime warnings in indexing startup when mismatch is likely:
  * [ ] Update `src/index/build/runtime/workers.js` (in `resolveThreadLimitsConfig`, verbose mode is already supported)
    * [ ] Compute `effectiveUv = Number(process.env.UV_THREADPOOL_SIZE) || null`
    * [ ] If `effectiveUv` is set and `ioConcurrency` is materially larger, emit a single warning suggesting alignment.
    * [ ] If `effectiveUv` is not set, consider a *non-fatal* hint when `ioConcurrency` is high (e.g., `>= 16`) and `--verbose` is enabled.
* [ ] (Services) Emit one-time startup info in long-running modes:
  * [ ] `tools/api-server.js`
  * [ ] `tools/indexer-service.js`
  * [ ] `tools/mcp-server.js`
  * Log: effective `UV_THREADPOOL_SIZE`, and whether it was set by PairOfCleats runtime config or inherited from the environment.

### 19.5 Documentation updates

* [ ] Update env overrides doc:

  * [ ] `docs/env-overrides.md`

    * [ ] Add `PAIROFCLEATS_UV_THREADPOOL_SIZE`
    * [ ] Explicitly note: libuv threadpool size must be set **before the Node process starts**; PairOfCleats applies it by setting `UV_THREADPOOL_SIZE` in spawned child processes (via `bin/pairofcleats.js` and other tool launchers).
* [ ] Update config docs:

  * [ ] `docs/config-schema.json` add `runtime.uvThreadpoolSize`
  * [ ] `docs/config-inventory.md` add `runtime.uvThreadpoolSize (number)`
  * [ ] `docs/config-inventory.json` add entry for `runtime.uvThreadpoolSize`
* [ ] Update setup documentation:

  * [ ] `docs/setup.md` add a short “Performance tuning” note:

    * [ ] When indexing large repos or using higher `--threads`, consider setting `runtime.uvThreadpoolSize` (or `PAIROFCLEATS_UV_THREADPOOL_SIZE`) to avoid libuv threadpool becoming the limiting factor.
* [ ] (Optional) Add a benchmark note:

  * [ ] `docs/benchmarks.md` mention that benchmarking runs should control `UV_THREADPOOL_SIZE` for reproducibility.

### 19.6 Tests: schema validation + env propagation

* [ ] Update config validation tests:

  * [ ] `tests/config-validate.js` ensure `runtime.uvThreadpoolSize` is accepted by schema validation.
* [ ] Add a focused propagation test:

  * [ ] New: `tests/uv-threadpool-env.js`

    * [ ] Create a temp repo dir with a `.pairofcleats.json` that sets `runtime.uvThreadpoolSize`.
    * [ ] Run: `node bin/pairofcleats.js config dump --json --repo <temp>`
    * [ ] Assert:

      * `payload.derived.runtime.uvThreadpoolSize` matches the config
      * `payload.derived.runtime.effectiveUvThreadpoolSize` matches the propagated env (or check `process.env.UV_THREADPOOL_SIZE` if you expose it directly in the dump)
* [ ] Add a non-override semantics test (if that’s the decided rule):

  * [ ] New: `tests/uv-threadpool-no-override.js`

    * [ ] Set parent env `UV_THREADPOOL_SIZE=…`
    * [ ] Also set config `runtime.uvThreadpoolSize` to a different value
    * [ ] Assert child sees the parent value (i.e., wrapper respects existing env)

**Exit criteria**

* [ ] `runtime.uvThreadpoolSize` is in schema + inventory and validated by `tools/validate-config.js`.
* [ ] `pairofcleats …` launches propagate `UV_THREADPOOL_SIZE` to child processes when configured.
* [ ] Users can confirm configured/effective behavior via `pairofcleats config dump --json`.
* [ ] Docs clearly explain when and how the setting applies.

---

## Phase 20 — Threadpool-aware I/O scheduling guardrails

**Objective:** Reduce misconfiguration risk by aligning PairOfCleats internal I/O scheduling with the effective libuv threadpool size and preventing runaway pending I/O buildup.

### 20.1 Add a “threadpool-aware” cap option for I/O queue sizing

* [ ] Add config (optional, but recommended if you want safer defaults):

  * [ ] `indexing.ioConcurrencyCap` (number) **or** `runtime.ioConcurrencyCap` (number)
  * Choose the namespace based on your ownership map (`docs/config-inventory-notes.md` suggests runtime is `tools/dict-utils.js`, indexing is build runtime).
* [ ] Implement in:

  * [ ] `src/shared/threads.js` (preferred, because it’s the canonical concurrency resolver)

    * [ ] After computing `ioConcurrency`, apply:

      * `ioConcurrency = min(ioConcurrency, ioConcurrencyCap)` when configured
      * (Optional) `ioConcurrency = min(ioConcurrency, effectiveUvThreadpoolSize)` when a new boolean is enabled, e.g. `runtime.threadpoolAwareIo === true`
  * [ ] `src/index/build/runtime/workers.js`

    * [ ] Adjust `maxIoPending` to scale from the *final* `ioConcurrency`, not the pre-cap value.

### 20.2 Split “filesystem I/O” from “process I/O” (optional, higher impact)

If profiling shows git/tool subprocess work is being unnecessarily throttled by a threadpool-aware cap:

* [ ] Update `src/shared/concurrency.js` to support two queues:

  * [ ] `fs` queue (bounded by threadpool sizing)
  * [ ] `proc` queue (bounded separately)
* [ ] Update call sites:

  * [ ] `src/index/build/file-processor.js`

    * [ ] Use `fsQueue` for `fs.stat`, `fs.readFile`, `fs.open`
    * [ ] Use `procQueue` for `getGitMetaForFile` (and any other spawn-heavy steps)
  * [ ] `src/index/build/runtime/workers.js` and `src/index/build/indexer/steps/process-files.js`

    * [ ] Wire new queues into runtime and shard runtime creation.

### 20.3 Tests + benchmarks

* [ ] Add tests that validate:

  * [ ] Caps are applied deterministically
  * [ ] Pending limits remain bounded
  * [ ] No deadlocks when both queues exist
* [ ] Update or add a micro-benchmark to show:

  * [ ] Throughput difference when `UV_THREADPOOL_SIZE` and internal `ioConcurrency` are aligned vs misaligned.

**Exit criteria**

* [ ] Internal I/O concurrency cannot silently exceed intended caps.
* [ ] No regression in incremental/watch mode stability.
* [ ] Benchmarks show either improved throughput or reduced memory/queue pressure (ideally both).

---

## Phase 21 — (Conditional) Native LibUV work: only if profiling proves a real gap

**Objective:** Only pursue *direct* libuv usage (via a native addon) if profiling demonstrates a material bottleneck that cannot be addressed through configuration and queue hygiene.

### 21.1 Profiling gate and decision record

* [ ] Add a short profiling harness / guidance doc:

  * [ ] `docs/perf-profiling.md` (new) describing how to profile indexing (CPU + I/O wait) and what thresholds justify native work.
* [ ] Establish decision criteria (example):

  * [ ] If ≥20–30% wall time is spent in JS-level file scanning/reading overhead beyond disk throughput limits, consider native.
  * [ ] Otherwise, stay in JS + threadpool tuning.

### 21.2 Prototype native module (N-API) using libuv for a specific hot path

* [ ] Only target one narrow, measurable function (examples):

  * [ ] Fast “sample read + binary/minified detection” replacing parts of `src/index/build/file-scan.js`
  * [ ] Batched `stat + read` pipeline for small files
* [ ] Provide a clean fallback path to existing JS implementation.
* [ ] Add CI coverage for:

  * [ ] Linux/macOS/Windows builds (or prebuilds)
  * [ ] ABI compatibility across supported Node versions

### 21.3 Packaging and docs

* [ ] Update:

  * [ ] `package.json` optionalDependencies/build tooling (node-gyp/prebuildify/etc.)
  * [ ] `docs/setup.md` to explain native build requirements/fallback behavior

**Exit criteria**

* [ ] Prototype demonstrates measurable improvement on representative repos.
* [ ] Install friction and cross-platform maintenance cost are explicitly accepted (or the work is abandoned).

#### 18 Bottom line

* **Do not add libuv directly** to this Node codebase.
* **Do add explicit support for libuv threadpool sizing** (via `UV_THREADPOOL_SIZE`) because the current concurrency model (notably `ioConcurrency` up to 64) strongly suggests you will otherwise hit an invisible throughput ceiling.

---

## Phase 22 — Embeddings & ANN (onnx/HNSW/batching/candidate sets)

**Objective:** harden the embeddings + ANN stack for correctness, determinism (where required), performance, and resilient fallbacks across **index build**, **build-embeddings tooling**, and **retrieval-time ANN execution**.

### 22.1 Correctness

#### 22.1.1 Model identity (cache keys, preprocessing, normalization, dims)

##### Current state (verified)
- [x] Tooling cache keys include **file hash** + **chunk signature** + **embedding identity** (`tools/build-embeddings/cache.js`, `tools/build-embeddings/run.js`).
- [x] Tooling includes **dims mismatch guardrails** with explicit hard-fail paths and tests (`tools/build-embeddings/embed.js`, `tests/embeddings-dims-mismatch.js`, `tests/embeddings-dims-validation.js`).

##### Remaining gaps / action items
- [x] **Expand embedding identity to include preprocessing + provider-specific knobs**, not just `{modelId, provider, mode, stub, dims, scale}`:
  - Why: changing `onnx` tokenizer/model path or execution provider can change embeddings without changing `modelId`/`provider`, allowing silent cache reuse.
  - Files:
    - `tools/build-embeddings/cache.js` (identity schema)
    - `tools/build-embeddings/run.js` (identity inputs)
  - Add fields (at minimum):
    - ONNX: `onnx.modelPath` (resolved), `onnx.tokenizerId`, `onnx.executionProviders`, `onnx.threads`, `onnx.graphOptimizationLevel`
    - Common: pooling strategy (mean), `normalize=true`, truncation/max_length policy
    - Quantization: `minVal/maxVal` (currently fixed -1..1), quantization “version”
- [x] **Include a tooling/version fingerprint in cache identity** (or bumpable `identity.version`) so cache invalidates when embedding algorithm changes:
  - Why: changes to doc extraction, pooling logic, quantization, or merging should invalidate caches even if file hashes are unchanged.
  - Files: `tools/build-embeddings/cache.js`, optionally `tools/build-embeddings/chunks.js`
- [x] **Add strict provider validation**: unknown `indexing.embeddings.provider` should not silently map to `xenova`.
  - Why: silent fallback can produce “correct-looking” but unintended embeddings and cache identity mismatch.
  - Files: `src/shared/onnx-embeddings.js` (normalizeEmbeddingProvider), `src/index/embedding.js`, `tools/build-embeddings/cli.js`, `src/retrieval/embedding.js`
- [x] **Unify default stub embedding dimensions across build + retrieval + tooling** (currently inconsistent defaults: 384 vs 512).
  - Why: any code path that calls stub embeddings without an explicit `dims` risks producing query embeddings that cannot match the index dims.
  - Files: `src/shared/embedding.js` (defaults to 512), `src/index/embedding.js` (defaults to 384), `tools/build-embeddings/run.js` (defaults to 384), `src/retrieval/embedding.js` (passes `dims`, but can pass null in some ANN-only paths).
  - Recommendation: pick **384** as the single default everywhere OR require dims explicitly in stub mode and fail loudly if missing.
- [x] **Index-build (inline) path lacks explicit dims mismatch failure** comparable to build-embeddings tool:
  - `src/index/build/file-processor/embeddings.js` currently coerces unexpected shapes to empty arrays and proceeds.
  - Add an explicit “dims contract” check and fail fast (or disable embeddings) if:
    - vectors are not arrays/typed arrays,
    - dims are inconsistent across chunks,
    - batch output length mismatches input length.
- [x] **Make per-file embedding cache writes atomic** (cache files are written with `fs.writeFile`):
  - Why: partial/corrupt cache JSON can cause repeated recompute; while not “poisoning,” it degrades throughput and can mask real failures.
  - Files: `tools/build-embeddings/run.js` (cache writes), optionally reuse `tools/build-embeddings/atomic.js` or shared atomic writer.

**Exit criteria**
- [x] Changing any embedding-relevant knob (model path/tokenizer/provider/normalization/pooling/quantization) forces cache miss.
- [x] Dims mismatch fails loudly (or deterministically disables embeddings) in **both** build-embeddings and inline index-build paths.
- [x] Stub-mode dims are consistent across indexing + retrieval.

---

#### 22.1.2 Determinism (float handling, batching order)

##### Current state (verified)
- [x] Quantization uses deterministic rounding (`src/index/embedding.js`).
- [x] Batched embedding retains input ordering in both tooling and index build (`tools/build-embeddings/embed.js`, `src/index/build/file-processor/embeddings.js`).

##### Remaining gaps / action items
- [x] **Document and/or enforce determinism requirements for HNSW build**:
  - HNSW graph structure can vary with insertion order; current insertion order is “file processing order,” which depends on `Map` insertion order derived from chunk meta traversal.
  - Files: `tools/build-embeddings/run.js`, `tools/build-embeddings/hnsw.js`
  - Recommendation: ensure vectors are added to HNSW in a stable order (e.g., ascending `chunkIndex`).
- [x] **Avoid nondeterministic file sampling in context window estimation**:
  - `src/index/build/context-window.js` uses the first N files in `files[]`; if upstream file enumeration order is OS-dependent, context window results can change.
  - Recommendation: sort file paths before sampling (or explicitly document nondeterminism).
- [x] **Normalize float types across providers**:
  - Many paths convert typed arrays into JS arrays; this is deterministic but increases the surface for subtle differences and performance regressions.
  - Recommendation: standardize on `Float32Array` where feasible and only convert at serialization boundaries.

**Exit criteria**
- [x] HNSW build is reproducible across runs given identical artifacts/config (or nondeterminism is clearly documented and accepted).
- [x] Context window selection is stable given identical repo state.

---

#### 22.1.3 Robust fallback behavior (missing models/extensions/unsupported configs)

##### Current state (verified)
- [x] Retrieval embedding errors are caught and return `null` (`src/retrieval/embedding.js`), which allows the search pipeline to continue in sparse-only mode.
- [x] SQLite vector extension usage is guarded and can be disabled via sanitization (`tests/vector-extension-sanitize.js`).

##### Remaining gaps / action items
- [x] **ONNX embedder config validation is partially ineffective**:
  - `src/shared/onnx-embeddings.js:createOnnxEmbedder()` checks `normalizeEmbeddingProvider('onnx') !== 'onnx'` which is a no-op (constant input).
  - Replace with validation of the *actual* requested provider (or remove the dead check).
- [x] **Improve “missing model” errors with clear remediation** (especially for offline envs):
  - Recommend: explicitly mention `tools/download-models.js` and where the model path is expected.
  - Files: `src/shared/onnx-embeddings.js`, `src/index/embedding.js`
- [x] **HNSW load path should fall back to `.bak` on corrupt primary**, not only when primary is missing:
  - Today: `src/shared/hnsw.js` only chooses `.bak` if primary missing; it does not retry `.bak` if `readIndexSync()` throws.
- [x] **Use HNSW meta for safety checks**:
  - Retrieval load does not read `dense_vectors_hnsw.meta.json`, so it cannot validate `dims`, `space`, or `model` before querying.
  - Files: `src/shared/hnsw.js`
- [x] **Add explicit tests for “extension missing” fallback**:
  - Currently there is sanitization coverage, but not “load failure / missing shared library” behavior.
  - Files/tests: `tools/build-embeddings/sqlite-dense.js` + new test.

**Exit criteria**
- [x] Missing/corrupt HNSW artifacts do not crash retrieval; the system degrades gracefully to another ANN backend or sparse-only.
- [x] Missing ONNX model artifacts fail with actionable errors (or clean fallback in non-strict modes).

---

### 22.2 Batching & scheduling

#### 22.2.1 Batch auto-tuning (memory/CPU/repo size)

##### Current state (verified)
- [x] Both index-build and build-embeddings tooling implement “auto batch” based on `os.totalmem()` (`src/index/build/runtime/embeddings.js`, `tools/build-embeddings/cli.js`).
- [x] Language-specific multipliers exist and are tested (`src/index/build/embedding-batch.js`, `tests/embedding-batch-multipliers.js`).

##### Remaining gaps / action items
- [x] **Unify and justify auto-batch heuristics**:
  - Index-build uses `totalGb * 16` with min 16.
  - build-embeddings tool uses `totalGb * 32` with min 32.
  - Decide a single policy OR clearly document why they intentionally differ.
- [x] **Incorporate CPU oversubscription controls**:
  - ONNX runtime can be multi-threaded (`threads` option), while the embedding queue can also be concurrent.
  - Add a policy: e.g., `embeddingConcurrency * onnxThreads <= cpuCount` (or document exceptions).
  - Files: `src/index/build/runtime/embeddings.js`, `src/shared/onnx-embeddings.js`
- [x] **Adapt batch sizing to repo characteristics**:
  - For tiny repos/files, large batch sizes increase latency without improving throughput.
  - For huge repos, file-by-file batching underutilizes the accelerator (many small batches).
  - Recommendation: introduce a global “embedding batcher” that batches across files with:
    - max batch size,
    - max tokens/estimated memory per batch,
    - stable ordering.
  - Files impacted: `src/index/build/file-processor/embeddings.js`, `tools/build-embeddings/run.js`

**Exit criteria**
- [x] Batch sizing + concurrency are predictable and safe across low-memory hosts, multi-core hosts, and both small and large repos.
- [x] Default settings do not oversubscribe CPU when ONNX threads are enabled.

---

#### 22.2.2 Embedding queues (backpressure, bounded memory)

##### Current state (verified)
- [x] Service-mode job enqueue provides a `maxQueued` hook (`src/index/build/indexer/embedding-queue.js`).

##### Remaining gaps / action items
- [x] **Define and enforce backpressure defaults**:
  - If `maxQueued` is unset/null, behavior depends on `enqueueJob()` (not in scope here); ensure a safe default exists.
  - Add explicit documentation + a test that verifies queue growth is bounded.
- [x] **Ensure service jobs include enough identity to be safe**:
  - Job payload includes `{repo, mode}`, but not an embedding identity fingerprint.
  - Include `embeddingProvider`, model id, and/or a hash of embedding config to prevent mismatched worker configuration from producing incompatible embeddings.

**Exit criteria**
- [x] Queue growth is bounded by default; overload produces clear errors and does not OOM the process.

---

#### 22.2.3 Session/model reuse

##### Current state (verified)
- [x] ONNX sessions are cached per normalized config (`src/shared/onnx-embeddings.js`).
- [x] Retrieval embedder instances are cached in-process (`src/retrieval/embedding.js`).

##### Remaining gaps / action items
- [ ] **Guard concurrent use of shared ONNX sessions if required**:
  - If `onnxruntime-node` sessions are not safe for concurrent `run()` calls, add a per-session mutex/queue.
  - At minimum: document thread-safety assumptions and add a stress test.
- [x] **Avoid duplicate pipeline/session loads in index-build**:
  - `src/index/embedding.js` does not maintain a global cache similar to retrieval; if multiple embedder instances are constructed in one process, models may be loaded multiple times.

**Exit criteria**
- [x] A single model/session is loaded once per process per config, and safely shared across all embedding calls.

---

### 22.3 ANN correctness

#### 22.3.1 Distance metric correctness (HNSW scoring)

##### Current state (verified)
- [x] HNSW ranker applies a stable tie-break (`idx`) after converting distances to similarity (`src/shared/hnsw.js`).

##### Remaining gaps / action items
- [x] **Confirm and test distance-to-similarity conversion for each HNSW space** (`l2`, `cosine`, `ip`):
  - Current code treats `ip` the same as `cosine` (`sim = 1 - distance`).
  - This may be correct or incorrect depending on hnswlib’s distance definition for `ip`.
  - Required: add unit tests with known vectors and expected distances/similarities and adjust conversion if needed.
  - Files: `src/shared/hnsw.js`, new test (e.g., `tests/hnsw-distance-metrics.js`).

**Exit criteria**
- [x] For each supported space, returned `sim` is monotonic with the true similarity notion used elsewhere in scoring.

---

#### 22.3.2 Atomic safety (no torn reads/writes)

##### Current state (verified)
- [x] Build writes HNSW `.bin` and `.meta.json` via atomic replace with `.bak` retention (`tools/build-embeddings/atomic.js`, `tools/build-embeddings/hnsw.js`).
- [x] There is a test that asserts `.bak` is created on replace (`tests/hnsw-atomic.js`).

##### Remaining gaps / action items
- [x] **HNSW reader should support “corrupt primary” fallback**:
  - Implement: try primary, and if read fails, try `.bak` before giving up.
  - Files: `src/shared/hnsw.js`
- [x] **Validate `.bin` / `.meta.json` pairing**:
  - Ensure meta file exists, parseable, and matches expected dims/space/model before using the index.
  - If mismatch, treat index as unavailable and fall back.

**Exit criteria**
- [x] Retrieval never crashes due to a torn/corrupt HNSW file; fallback paths are exercised by tests.

---

#### 22.3.3 Candidate set semantics (HNSW + sqlite-vec)

##### Current state (verified)
- [x] SQLite candidate pushdown behavior is tested for small vs large candidate sets (`tests/sqlite-vec-candidate-set.js`).

##### Remaining gaps / action items
- [x] **Handle empty candidate sets explicitly in HNSW path**:
  - `rankHnswIndex()` currently treats an empty set as “no filter” (because `candidateSet.size` is falsy), which can return results when none are desired.
  - Files: `src/shared/hnsw.js`
- [x] **Document and test candidate-set cap behavior**:
  - HNSW uses a `candidateSetCap` default of 1000; ensure callers understand whether this can truncate results.
  - Add tests for:
    - empty set → empty hits,
    - small set → only those labels,
    - very large set → filter still applied and returned hits are subset, with stable ordering.
- [x] **Align candidate-set tie-break behavior across backends**:
  - SQLite ANN tests require deterministic tie-break by `rowid`.
  - HNSW already tie-breaks by `idx`. Ensure both are consistent with retrieval expectations.

**Exit criteria**
- [x] Candidate sets behave identically (semantically) across ANN backends: never return items outside the set, deterministic ordering for ties, predictable truncation rules.

---

### 22.4 Performance improvements to prioritize

#### 22.4.1 Float32Array end-to-end (avoid JS arrays of floats)
- [x] **Standardize the embedding contract to return `Float32Array`**:
  - Files: `src/index/embedding.js`, `src/retrieval/embedding.js`, `src/shared/onnx-embeddings.js`, `src/shared/embedding.js`
- [x] **Update downstream code to accept typed arrays** (don’t gate on `Array.isArray`):
  - Files: `src/index/build/file-processor/embeddings.js`, `tools/build-embeddings/embed.js`, `tools/build-embeddings/run.js`, `tools/build-embeddings/hnsw.js`
- [x] **Defer conversion to JS arrays only at serialization boundaries** (JSON writing).

#### 22.4.2 Minimize serialization between threads/processes (transferable buffers)
- [ ] Where embeddings are computed in worker threads/processes (service mode), prefer:
  - transferring `ArrayBuffer`/`SharedArrayBuffer` instead of JSON arrays,
  - or using binary packed formats for vectors.
- [ ] Add an explicit “embedding payload format” version in job payloads so workers and callers stay compatible.
  - File touchpoints: `src/index/build/indexer/embedding-queue.js` (job payload)

#### 22.4.3 Pre-allocate and reuse buffers
- [ ] **ONNX embedding path**:
  - Avoid per-call allocations:
    - re-use `BigInt64Array` buffers for token ids/masks where shapes are stable,
    - avoid `Array.from()` conversions for slices.
  - Files: `src/shared/onnx-embeddings.js`
- [x] **Index-build merge path**:
  - Avoid allocating a new zero vector per chunk in `attachEmbeddings()`.
  - File: `src/index/build/file-processor/embeddings.js`

#### 22.4.4 Candidate generation tuning
- [ ] Push sparse filters earlier and reduce dense scoring work:
  - prefer ANN-restricted candidate sets before dense dot products,
  - prefer pushing candidate constraints into sqlite-vec queries when small enough (already partially implemented).
  - (Some of this lives outside the reviewed file list; track as cross-cutting work.)

**Exit criteria**
- [ ] Embedding pipelines avoid unnecessary conversions/allocations; measurable CPU and memory reductions on large repos.
- [ ] ANN candidate generation demonstrably reduces dense scoring load for common queries.

---

### 22.5 Refactoring goals

#### 22.5.1 Single embedding interface shared by build + retrieval
- [ ] Create a single shared adapter interface, e.g.:
  - `embed(texts: string[], opts) => Float32Array[]`
  - `embedOne(text: string, opts) => Float32Array`
- [ ] Move provider selection + error handling behind adapters:
  - `xenova`, `onnx`, `stub`.
- [ ] Ensure both index-build and retrieval use the same adapter and the same preprocessing defaults.

#### 22.5.2 Centralize normalization & preprocessing
- [ ] Eliminate duplicated `normalizeVec()` implementations:
  - `src/index/embedding.js`
  - `src/shared/onnx-embeddings.js`
  - `tools/build-embeddings/embed.js` (indirectly uses index/embedding normalization)
- [ ] Centralize:
  - pooling strategy,
  - normalization strategy,
  - truncation/max_length policy,
  - doc/code merge policy.

#### 22.5.3 Clear ANN backend adapters
- [ ] Wrap sqlite-vec and HNSW behind a single “ANN adapter” contract with:
  - candidate set semantics,
  - deterministic tie-break contract,
  - consistent error handling and stats reporting.
  - (Some of this lives outside the reviewed file list.)

**Exit criteria**
- [ ] Build + retrieval cannot diverge in embedding shape/normalization/pooling without a deliberate, versioned change.
- [ ] ANN behavior is consistent regardless of backend.

---

### 22.6 Tests

#### 22.6.1 Coverage checklist

##### Already covered (verified)
- [x] Cache identity/invalidation (baseline) — `tests/embeddings-cache-identity.js`, `tests/embeddings-cache-invalidation.js`
- [x] Dims mismatch (tooling) — `tests/embeddings-dims-mismatch.js`, `tests/embeddings-dims-validation.js`
- [x] ANN candidate set correctness (sqlite-vec) — `tests/sqlite-vec-candidate-set.js`
- [x] HNSW artifacts existence + atomic replace — `tests/hnsw-ann.js`, `tests/hnsw-atomic.js`

##### Missing / needs additions
- [x] **Cache identity tests must cover provider-specific knobs**, especially ONNX config:
  - Add tests proving that changing `onnx.tokenizerId` or `onnx.modelPath` changes identityKey and forces cache miss.
- [x] **Add extension missing/fallback tests**:
  - Simulate vector extension load failure and ensure build/search does not crash and disables vector ANN.
- [x] **Add HNSW candidate set tests**:
  - empty set returns empty hits,
  - filter does not leak labels,
  - tie-break stability.
- [x] **Add HNSW `.bak` fallback tests**:
  - corrupt primary index/meta triggers `.bak` load and does not crash.
- [x] **Add performance regression test for embedding batching throughput** (required by checklist):
  - Recommended approach (stable in CI):
    - Use a synthetic embedder function with a fixed per-call overhead + per-item cost.
    - Assert that `runBatched()` with batchSize>1 achieves >= X% speedup vs batchSize=1 on a fixed input size.
    - Use generous thresholds to avoid flakiness; focus on catching *major* regressions (e.g., accidental O(n²) behavior or disabling batching).
  - Candidate target: `tools/build-embeddings/embed.js:runBatched()` and/or `src/index/build/file-processor/embeddings.js` batching path.

**Exit criteria**
- [x] Tests fail if embedding identity changes are not reflected in cache keys.
- [x] Tests cover ANN candidate set semantics for both sqlite-vec and HNSW.
- [x] At least one performance regression test exists for batching throughput.

---

### Appendix A — File-by-file review notes (actionable items)

> The checklist items above are the canonical “what to fix.” This appendix maps concrete file-level changes back to those items.

#### Appendix A - Artifacts, indexing, and build pipeline (remaining)

- [ ] `src/index/build/artifacts.js` (P2) Consider sorting `pieceEntries` by `path` before writing the manifest to reduce diff noise.
- [ ] `src/index/build/artifacts/compression.js` (P2) Consider extending compression to sharded artifacts (optional future work).
- [ ] `src/index/build/artifacts/file-meta.js` (P2) Remove or rename `chunk_authors` in file meta (currently derived from the first chunk and not file-level).
- [ ] `src/index/build/artifacts/filter-index.js` (P2) Consider persisting schema version/config hash in the filter index artifact for easier debugging.
- [ ] `src/index/build/artifacts/metrics.js` (P2) Do not swallow metrics write errors silently (log or propagate based on severity).
- [ ] `src/index/build/artifacts/token-mode.js` (P2) Make parsing more robust (case-insensitive modes; integer parsing + clamping).
- [ ] `src/index/build/artifacts/writers/chunk-meta.js` (P2) Consider normalizing field naming conventions (`chunk_authors` vs `startLine/endLine`).
- [ ] `src/index/build/artifacts/writers/file-relations.js` (P2) Consider JSONL/sharding for very large `file_relations` outputs; add versioning metadata.
- [ ] `src/index/build/artifacts/writers/repo-map.js` (P2) Consider sorting output by `{file, name}` for stability.
- [ ] `src/index/build/file-processor.js` (P2) Move complexity/lint to per-file scope; avoid repeated per-chunk cache checks.
  - [ ] (P2) Fix possible timing double-counting across parse/relation durations.
- [ ] `src/index/build/file-processor/cached-bundle.js` (P2) Validate cached bundle shapes more strictly; ensure importLinks shape is consistent.
- [ ] `src/index/build/file-processor/chunk.js` (P2) Adjust comment-to-chunk assignment at boundary (`chunk.end === comment.start`) and consider overlap-based assignment.
- [ ] `src/index/build/file-processor/incremental.js` (P2) Ensure cache invalidation includes schema/version changes for any artifact-impacting changes.
- [ ] `src/index/build/file-processor/meta.js` (P2) Deduplicate `externalDocs` outputs; consider ordering for determinism.
- [ ] `src/index/build/file-processor/read.js` (P2) Consider UTF-8 safe truncation (avoid splitting multi-byte sequences mid-codepoint).
- [ ] `src/index/build/file-processor/relations.js` (P2) Consider sorting/deduping relation arrays (imports/exports/usages) for determinism.
- [ ] `src/index/build/file-processor/skip.js` (P2) Add coverage for `unreadable` and `read-failure` skip paths.
- [ ] `src/index/build/file-processor/timings.js` (P2) Validate that parse/token/embed durations are not double-counted; document semantics.
- [ ] `src/index/build/graphs.js` (P2) Prefer canonical `chunkId` keys where possible instead of `file::name` to avoid collisions.
  - [ ] (P2) Sort serialized node lists for full determinism (neighbors are already sorted).
- [ ] `src/index/build/piece-assembly.js` (P2) Remove redundant filterIndex construction (avoid double work; rely on writeIndexArtifacts).
- [ ] `src/index/build/postings.js` (P2) Validate docLengths are finite and consistent; avoid NaN avgDocLen.
  - [ ] (P2) Sort Object.entries() iteration for field postings and weights for deterministic output.
- [ ] `src/index/build/shards.js` (P2) Document heuristic thresholds (minFilesForSubdir, hugeThreshold, tenth-largest targets).
- [ ] `src/index/build/tokenization.js` (P2) Review buffer reuse effectiveness (arrays are still cloned); consider pre-sizing and reducing transient allocations further.
- [ ] `tools/assemble-pieces.js` (P2) When `--force` is used, consider cleaning the output dir first to avoid stale artifacts.
- [ ] `tools/ci-restore-artifacts.js` (P2) Optionally validate `pieces/manifest.json` checksums after restore (fast fail on corrupt artifacts).
- [ ] `tools/compact-pieces.js` (P2) Add perf regression harness and validate output equivalence post-compaction.
- [ ] `tests/artifact-bak-recovery.js` (P2) Expand coverage to include: both primary and backup corrupt; json.gz sidecars; and cleanup expectations.
- [ ] `tests/artifact-size-guardrails.js` (P2) Extend to cover: chunkMetaFormat=jsonl with switching shard/no-shard, and cleanup behavior.
- [ ] `tests/artifacts/token-mode.test.js` (P2) Add coverage for invalid modes, case-insensitive parsing, and maxTokens/maxFiles parsing edge cases.
- [ ] `tests/clean-artifacts.js` (P2) Consider adding a check that `.bak` files are handled correctly (optional).
- [ ] `tests/file-processor/skip.test.js` (P2) Add coverage for `unreadable` and `read-failure` paths (permissions, ENOENT races).
- [ ] `tests/filter-index-artifact.js` (P2) Add a schema assertion for filter_index fields/versioning to prevent drift.
- [ ] `tests/filter-index.js` (P2) Consider adding a determinism check for serialized filter index (same inputs => same output).
- [ ] `tests/graph-chunk-id.js` (P2) Add a collision regression test for graph keys, or migrate to chunkId-based keys.
- [ ] `tests/incremental-tokenization-cache.js` (P2) Add a second invalidation scenario (e.g., tokenization config changes that affect stemming/synonyms).
- [ ] `tests/postings-quantize.js` (P2) Extend to test scale and dims, and doc/code embedding behavior.
- [ ] `tests/shard-merge.js` (P2) Consider adding checksum and manifest equivalence checks as well.
- [ ] `tests/shard-plan.js` (P2) Add stress case coverage (many files, equal weights, perfProfile enabled).
- [ ] `tests/tokenization-buffering.js` (P2) Consider adding a non-ASCII tokenization regression case.
- [ ] `docs/contracts/coverage-ledger.md` (P2) Add entries for new/critical tooling: `tools/assemble-pieces.js`, `tools/compact-pieces.js`, and CI artifact scripts.

#### src

##### `src/index/build/context-window.js`
- [x] Sort/sanitize file list before sampling to reduce OS-dependent nondeterminism.
- [ ] Consider documenting that context-window estimation is heuristic and may vary with sampling strategy.

##### `src/index/build/embedding-batch.js`
- [ ] Consider parsing `baseSize` if it may come from config as a numeric string.
- [ ] Add explicit documentation for multiplier precedence (fallback vs user config).

##### `src/index/build/file-processor/embeddings.js`
- [x] Add dims contract validation (non-empty vectors must share dims; fail fast otherwise).
- [x] Support `Float32Array` outputs (don’t rely on `Array.isArray`).
- [x] Avoid allocating `new Array(dims).fill(0)` per chunk; reuse a single `zeroVec`.
- [x] Validate that `getChunkEmbeddings(texts).length === texts.length`; if not, log + fail or retry with a clear warning.
- [x] Ensure doc embedding results are length-aligned with `docPayloads` (currently assumes perfect alignment).

##### `src/index/build/indexer/embedding-queue.js`
- [x] Include embedding identity/config hash in job payload to prevent mismatched worker behavior.
- [ ] Consider switching job IDs to `crypto.randomUUID()` for collision resistance.
- [x] Ensure `maxQueued` has a safe default; document backpressure behavior.

##### `src/index/build/runtime/embeddings.js`
- [x] Reconcile auto-batch policy with tooling (`tools/build-embeddings/cli.js`).
- [x] Consider incorporating ONNX thread settings into concurrency auto-tune to avoid oversubscription.

##### `src/index/embedding.js`
- [ ] Centralize `normalizeVec`/`quantizeVec` into shared utilities; remove duplication.
- [x] Add strict provider validation (unknown provider should error/warn).
- [ ] Harden `normalizeBatchOutput()` to:
  - guarantee output length equals input count,
  - handle unexpected tensor dims more defensively,
  - avoid returning a single huge vector when output is 3D.
- [x] Prefer returning `Float32Array` (or at least accept typed arrays downstream).

##### `src/retrieval/embedding.js`
- [ ] Use a normalized/fingerprinted ONNX config in the embedder cache key (avoid JSON-order sensitivity).
- [ ] If retrieval can request embeddings without known dims (ANN-only paths), require dims or ensure consistent default dims.
- [ ] Consider logging embedder load failures once (rate-limited) to aid debugging.

##### `src/shared/embedding.js`
- [x] Unify stub default dims with the rest of the system (recommend 384).
- [x] Optionally return `Float32Array` to match the desired end-to-end contract.

##### `src/shared/hnsw.js`
- [x] Implement `.bak` fallback when the primary index exists but is corrupt/unreadable.
- [ ] Read/validate `dense_vectors_hnsw.meta.json` to confirm `dims/space/model` before using the index.
- [x] Handle empty candidate sets explicitly by returning `[]`.
- [x] Add unit tests for distance conversion across spaces (l2/cosine/ip) and adjust similarity conversion if required.

##### `src/shared/onnx-embeddings.js`
- [x] Remove/fix dead provider check (`normalizeEmbeddingProvider('onnx')`).
- [x] Add clearer error messaging for missing model artifacts + remediation steps.
- [ ] Improve performance by avoiding heavy array conversions and by reusing buffers/tensors.
- [ ] Consider concurrency guards around `session.run()` if onnxruntime sessions are not safe concurrently.

---

#### tools

##### `tools/build-embeddings.js`
- No issues observed beyond those in underlying implementation modules.

##### `tools/build-embeddings/atomic.js`
- [ ] Consider consolidating atomic replace logic with `src/shared/json-stream.js` to avoid divergence (optional refactor).

##### `tools/build-embeddings/cache.js`
- [x] Expand identity schema to include preprocessing and provider-specific config (especially ONNX knobs).
- [x] Add a bumpable “identity version” or build-tool version fingerprint.

##### `tools/build-embeddings/chunks.js`
- [ ] Consider incorporating doc-related signals into the chunk signature (or into identity versioning) so doc embedding caches invalidate when doc extraction logic changes.
- [ ] Consider normalizing `start/end` to finite numbers before signature generation (avoid stringifying `undefined`).

##### `tools/build-embeddings/cli.js`
- [ ] Document (or change) the behavior where `mode=service` is coerced to `inline` for this tool.
- [x] Unify auto-batch defaults with index-build runtime (or document why they differ).

##### `tools/build-embeddings/embed.js`
- [x] Update to accept and return typed arrays (`Float32Array`) instead of insisting on JS arrays.
- [ ] Consider failing fast on non-vector outputs instead of silently returning `[]` entries (to avoid quietly producing all-zero embeddings).

##### `tools/build-embeddings/hnsw.js`
- [ ] Ensure stable vector insertion order into HNSW (ascending chunkIndex).
- [ ] When adding vectors reconstructed from cache (dequantized), consider re-normalizing for cosine space to reduce drift.

##### `tools/build-embeddings/manifest.js`
- [ ] Consider reading HNSW meta to report accurate `count`/`dims` for ANN piece files, rather than relying on `totalChunks` (defensive correctness).

##### `tools/build-embeddings/run.js`
- [x] Make cache writes atomic (optional but recommended).
- [ ] Use `Number.isFinite()` for chunk start/end to avoid 0/NaN edge cases from `||` coercion.
- [x] Apply `ensureVectorArrays()` to embedded doc batches just like code batches.
- [ ] Make HNSW build deterministic (stable insertion order).
- [ ] Consider adding a global cross-file batcher for throughput.

##### `tools/build-embeddings/sqlite-dense.js`
- [x] Add tests for “vector extension missing/failed to load” fallback behavior.
- [ ] Consider batching inserts in larger chunks or using prepared statements more aggressively for performance on large vector sets.

##### `tools/compare-models.js`
- [ ] If comparing ONNX vs xenova providers, ensure the script can capture and report provider config differences (identity) to interpret deltas correctly (minor enhancement).

##### `tools/download-models.js`
- [ ] Consider supporting explicit download of ONNX model artifacts when users rely on `indexing.embeddings.provider=onnx` and custom `onnx.modelPath`.
- [ ] Improve output to show where models were cached and what to set in config if needed.

---

#### tests

##### `tests/build-embeddings-cache.js`
- [ ] Extend to assert cache identity changes for ONNX config changes (once identity schema is expanded).

##### `tests/embedding-batch-autotune.js`
- [ ] Consider loosening or documenting assumptions about minimum batch size on low-memory systems (or adjust runtime min to match test expectations).

##### `tests/embeddings-cache-identity.js`
- [ ] Extend to cover ONNX-specific identity fields (tokenizerId/modelPath/etc).

##### `tests/embeddings-cache-invalidation.js`
- [ ] Add invalidation scenarios tied to preprocessing knobs (pooling/normalize/max_length) once surfaced in identity.

##### `tests/embeddings-sqlite-dense.js`
- [x] Add coverage for vector extension load failure paths (extension missing), not only baseline dense sqlite insertions.

##### `tests/hnsw-ann.js`
- [ ] Add correctness assertions beyond “backend selected”:
  - candidate set filtering (once exposed),
  - tie-break determinism,
  - sanity check of returned ordering for a known query on fixture corpus.

##### `tests/hnsw-atomic.js`
- [x] Add test for `.bak` fallback on corrupt primary index/meta (reader-side).

##### `tests/smoke-embeddings.js`
- [ ] new tests to this suite after implementing performance regression and fallback tests.

##### `tests/sqlite-vec-candidate-set.js`
- [ ] Add a column-name sanitization test (table is covered; column is not).

---

## Phase 23 — Index analysis features (metadata/risk/git/type-inference) — Review findings & remediation checklist

**Objective:** Review the Section 4 file set (56 files) and produce a concrete, exhaustive remediation checklist that (1) satisfies the provided Phase 4 checklist (A–G) and (2) captures additional defects, inconsistencies, and improvements found during review.

**Scope:** All files enumerated in `pairofcleats_review_section_4_files_and_checklist.md` (src/tests/docs).  
**Out of scope:** Implementing fixes in-code (this document is a work plan / punch list).

---

### Summary (priority ordered)

#### P0 — Must fix (correctness / crash / schema integrity)

- [ ] **Risk rules regex compilation is currently mis-wired.** `src/index/risk-rules.js` calls `createSafeRegex()` with an incorrect argument signature, so rule regex configuration (flags, limits) is not applied, and invalid patterns can throw and abort normalization.  
  - Fix in: `src/index/risk-rules.js` (see §B.1).
- [ ] **Risk analysis can crash indexing on long lines.** `src/index/risk.js` calls SafeRegex `test()` / `exec()` without guarding against SafeRegex input-length exceptions. One long line can throw and fail the whole analysis pass.  
  - Fix in: `src/index/risk.js` (see §B.2).
- [ ] **Metadata v2 drops inferred/tooling parameter types (schema data loss).** `src/index/metadata-v2.js` normalizes type maps assuming values are arrays; nested maps (e.g., `inferredTypes.params.<name>[]`) are silently discarded.  
  - Fix in: `src/index/metadata-v2.js` + tests + schema/docs (see §A.1–A.4).

#### P1 — Should fix (determinism, performance, docs, validation gaps)

- [ ] **`metaV2` validation is far too shallow and does not reflect the actual schema shape.** `src/index/validate.js` only validates a tiny subset of fields and does not traverse nested type maps.  
- [ ] **Docs drift:** `docs/metadata-schema-v2.md` and `docs/risk-rules.md` do not fully match current code (field names, structures, and configuration).  
- [ ] **Performance risks:** risk scanning does redundant passes and does not short-circuit meaningfully when capped; markdown parsing is duplicated (inline + fenced); tooling providers re-read files rather than reusing already-loaded text.

#### P2 — Nice to have (quality, maintainability, test depth)

- [ ] Improve signature parsing robustness for complex types (C-like, Python, Swift).
- [ ] Clarify and standardize naming conventions (chunk naming vs provider symbol naming, “generatedBy”, “embedded” semantics).
- [ ] Expand tests to cover surrogate pairs (emoji), CRLF offsets, and risk rules/config edge cases.

---

### A) Metadata v2: correctness, determinism, and validation

#### Dependency guidance (best choices)
- `ajv` — encode **metadata-schema-v2** as JSON Schema and validate `metaV2` as a hard gate in `tools/index-validate` (or equivalent).  
- `semver` — version `metaV2.schemaVersion` independently and gate readers/writers.

#### A.1 `metaV2.types` loses nested inferred/tooling param types (P0)

##### Affected files
- `src/index/metadata-v2.js`
- `docs/metadata-schema-v2.md`
- `src/index/validate.js`
- `tests/metadata-v2.js`

##### Findings
- [ ] **Data loss bug:** `normalizeTypeMap()` assumes `raw[key]` is an array of entries. If `raw[key]` is an object map (e.g., `raw.params` where `raw.params.<paramName>` is an array), it is treated as non-array and dropped.  
  - Evidence: `normalizeTypeMap()` (lines ~78–91) only normalizes `Array.isArray(entries)` shapes.
- [ ] **Downstream effect:** `splitToolingTypes()` is applied to `docmeta.inferredTypes`; because nested shapes are not handled, **tooling-derived param types will not appear in `metaV2.types.tooling.params`**, and inferred param types will be absent from `metaV2.types.inferred.params`.

##### Required remediation
- [ ] Update `normalizeTypeMap()` to support nested “param maps” (and any similar nested structures) rather than dropping them. A pragmatic approach:
  - [ ] If `entries` is an array → normalize as today.
  - [ ] If `entries` is an object → treat it as a nested map and normalize each subkey:
    - preserve the nested object shape in output (preferred), or
    - flatten with a predictable prefix strategy (only if schema explicitly adopts that).
- [ ] Update `splitToolingTypes()` so it correctly separates tooling vs non-tooling entries **inside nested maps** (e.g., `params.<name>[]`, `locals.<name>[]`).
- [ ] Update `tests/metadata-v2.js` to assert:
  - [ ] inferred param types survive into `metaV2.types.inferred.params.<paramName>[]`
  - [ ] tooling param types survive into `metaV2.types.tooling.params.<paramName>[]`
  - [ ] non-tooling inferred types do not leak into tooling bucket (and vice versa)

#### A.2 Declared types coverage is incomplete (P1)

##### Findings
- [ ] `buildDeclaredTypes()` currently only materializes:
  - param annotations via `docmeta.paramTypes`
  - return annotation via `docmeta.returnType`  
  It does **not** cover:
  - [ ] parameter defaults (`docmeta.paramDefaults`)
  - [ ] local types (`docmeta.localTypes`)
  - [ ] any other declared type sources the codebase may already emit

##### Required remediation
- [ ] Decide which “declared” facets are part of Metadata v2 contract and implement them consistently (and document them):
  - [ ] `declared.defaults` (if desired)
  - [ ] `declared.locals` (if desired)
- [ ] Update `docs/metadata-schema-v2.md` accordingly.
- [ ] Add tests in `tests/metadata-v2.js` for any newly included declared facets.

#### A.3 Determinism and stable ordering in `metaV2` (P1)

##### Findings
- [ ] Several arrays are produced via Set insertion order (e.g., `annotations`, `params`, `risk.tags`, `risk.categories`). While *often* stable, they can drift if upstream traversal order changes.
- [ ] `metaV2` mixes optional `null` vs empty collections inconsistently across fields (some fields null, others empty arrays). This matters for artifact diffs and schema validation.

##### Required remediation
- [ ] Standardize ordering rules for arrays that are semantically sets:
  - [ ] Sort `annotations` (lexicographic) before emitting.
  - [ ] Sort `params` (lexicographic) before emitting.
  - [ ] Sort risk `tags`/`categories` (lexicographic) before emitting.
- [ ] Establish a consistent “empty means null” vs “empty means []” policy for v2 and enforce it in `buildMetaV2()` and schema/docs.

#### A.4 `generatedBy` and `embedded` semantics are unclear (P2)

##### Findings
- [ ] `generatedBy` currently uses `toolInfo?.version` only; if `tooling` already contains `tool` and `version`, this can be redundant and underspecified.
- [ ] `embedded` is emitted whenever `chunk.segment` exists, even when the segment is not embedded (parentSegmentId may be null). This makes the field name misleading.

##### Required remediation
- [ ] Decide and document the intended meaning:
  - [ ] Option A: `generatedBy = "<tool>@<version>"` and keep `tooling` for structured detail.
  - [ ] Option B: remove `generatedBy` and rely solely on `tooling`.
- [ ] Restrict `embedded` field to truly-embedded segments only **or** rename the field to something like `segmentContext` / `embedding`.

#### A.5 Validation gaps for Metadata v2 (P1)

##### Findings (in `src/index/validate.js`)
- [ ] `validateMetaV2()` (lines ~162–206) validates only:
  - `chunkId` presence
  - `file` presence
  - `risk.flows` has `source` and `sink`
  - type entries have `.type` for a shallow, array-only traversal  
  It does **not** validate:
  - [ ] `segment` object shape
  - [ ] range/start/end types and ordering invariants
  - [ ] `lang`, `ext`, `kind`, `name` constraints
  - [ ] nested types map shapes (params/locals)
  - [ ] `generatedBy`/`tooling` shape and required fields
  - [ ] cross-field invariants (e.g., range within segment, embedded context consistency)

##### Required remediation
- [ ] Establish **one canonical validator** for `metaV2` (preferably schema-based):
  - [ ] Add an explicit JSON Schema for v2 (in docs or tooling directory).
  - [ ] Validate `metaV2` against the schema in `validateIndexArtifacts()`.
- [ ] If schema-based validation is not yet possible, expand `validateMetaV2()` to:
  - [ ] traverse nested `params`/`locals` maps for type entries
  - [ ] validate `range` numbers, monotonicity, and non-negativity
  - [ ] validate the presence/type of stable core fields as defined in `docs/metadata-schema-v2.md`
- [ ] Add tests (or fixtures) that exercise validation failures for each major failure class.

#### A.6 Docs drift: `docs/metadata-schema-v2.md` vs implementation (P1)

##### Findings
- [ ] The schema doc should be reviewed line-by-line against current `buildMetaV2()` output:
  - field names
  - optionality
  - nesting of `types.*`
  - risk shapes and analysisStatus shape
  - relations link formats

##### Required remediation
- [ ] Update `docs/metadata-schema-v2.md` to reflect the actual emitted shape **or** update `buildMetaV2()` to match the doc (pick one, do not leave them divergent).
- [ ] Add a “schema change log” section so future modifications don’t silently drift.

---

### B) Risk rules and risk analysis

#### Dependency guidance (best choices)
- `re2`/RE2-based engine (already present via `re2js`) — keep for ReDoS safety, but ensure wrapper behavior cannot crash indexing.
- `ajv` — validate rule bundle format (ids, patterns, severities, categories, etc.) before compiling.

#### B.1 Risk regex compilation is broken (P0)

##### Affected file
- `src/index/risk-rules.js`

##### Findings
- [ ] **Incorrect call signature:** `compilePattern()` calls `createSafeRegex(pattern, flags, regexConfig)` but `createSafeRegex()` accepts `(pattern, config)` (per `src/shared/safe-regex.js`).  
  Consequences:
  - `regexConfig` is ignored entirely
  - the intended default flags (`i`) are not applied
  - any user-configured safe-regex limits are not applied
- [ ] **No error shielding:** `compilePattern()` does not catch regex compilation errors. An invalid pattern can throw and abort normalization.

##### Required remediation
- [ ] Fix `compilePattern()` to call `createSafeRegex(pattern, safeRegexConfig)` (or a merged config object).
- [ ] Wrap compilation in `try/catch` and return `null` on failure (or record a validation error) so rule bundles cannot crash indexing.
- [ ] Add tests that verify:
  - [ ] configured flags (e.g., `i`) actually take effect
  - [ ] invalid patterns do not crash normalization and are surfaced as actionable diagnostics
  - [ ] configured `maxInputLength` and other safety controls are honored

#### B.2 Risk analysis can crash on long inputs (P0)

##### Affected file
- `src/index/risk.js`

##### Findings
- [ ] `matchRuleOnLine()` calls SafeRegex `test()` and `exec()` without guarding against exceptions thrown by SafeRegex input validation (e.g., when line length exceeds `maxInputLength`).  
  - This is a hard failure mode: one long line can abort analysis for the entire file (or build, depending on call site error handling).

##### Required remediation
- [ ] Ensure **risk analysis never throws** due to regex evaluation. Options:
  - [ ] Add `try/catch` around `rule.requires.test(...)`, `rule.excludes.test(...)`, and `pattern.exec(...)` to treat failures as “no match”.
  - [ ] Alternatively (or additionally), change the SafeRegex wrapper to return `false/null` instead of throwing for overlong input.
  - [ ] Add a deterministic “line too long” cap behavior:
    - skip risk evaluation for that line
    - optionally record `analysisStatus.exceeded` includes `maxLineLength` (or similar)

#### B.3 `scope` and cap semantics need tightening (P1)

##### Findings
- [ ] `scope === 'file'` currently evaluates only `lineIdx === 0` (first line). This is likely not the intended meaning of “file scope”.
- [ ] `maxMatchesPerFile` currently caps **number of matching lines**, not number of matches (variable name implies match-count cap).

##### Required remediation
- [ ] Define (in docs + code) what `scope: "file"` means:
  - [ ] “pattern evaluated against entire file text” (recommended), or
  - [ ] “pattern evaluated once per file via a representative subset”
- [ ] Implement `maxMatchesPerFile` as an actual match-count cap (or rename it to `maxMatchingLines`).
- [ ] Add tests for both behaviors.

#### B.4 Performance: redundant scanning and weak short-circuiting (P1)

##### Findings
- [ ] Risk analysis scans the same text repeatedly (sources, sinks, sanitizers are scanned in separate loops).
- [ ] When caps are exceeded (bytes/lines), flows are skipped, but line scanning for matches still proceeds across the entire file, which defeats the purpose of caps for large/minified files.

##### Required remediation
- [ ] Add an early-exit path when `maxBytes`/`maxLines` caps are exceeded:
  - either skip all analysis and return `analysisStatus: capped`
  - or scan only a bounded prefix/suffix and clearly mark that results are partial
- [ ] Consider a single-pass scanner per line that evaluates all rule categories in one traversal.
- [ ] Add a prefilter stage for candidate files/lines (cheap substring checks) before SafeRegex evaluation.

#### B.5 Actionability and determinism of outputs (P1)

##### Findings
- [ ] `dedupeMatches()` collapses evidence to one match per rule id (may not be sufficient for remediation).
- [ ] Time-based caps (`maxMs`) can introduce nondeterminism across machines/runs (what gets included depends on wall clock).

##### Required remediation
- [ ] Preserve up to N distinct match locations per rule (configurable) rather than only first hit.
- [ ] Prefer deterministic caps (maxBytes/maxLines/maxNodes/maxEdges) over time caps; if `maxMs` remains, ensure it cannot cause nondeterministic partial outputs without clearly indicating partiality.
- [ ] Sort emitted matches/flows deterministically (by line/col, rule id) before output.

#### B.6 Docs drift: `docs/risk-rules.md` vs implementation (P1)

##### Findings
- [ ] `docs/risk-rules.md` should be updated to reflect:
  - actual rule bundle fields supported (`requires`, `excludes`, `scope`, `maxMatchesPerLine`, `maxMatchesPerFile`, etc.)
  - actual emitted `risk.analysisStatus` shape (object vs string)
  - actual matching semantics (line-based vs file-based)

##### Required remediation
- [ ] Update the doc to match current behavior (or update code to match doc), then add tests that lock it in.

---

### C) Git signals (metadata + blame-derived authorship)

#### Dependency guidance (best choices)
- `simple-git` (already used) — ensure it’s called in a way that scales: batching where feasible, caching aggressively, and defaulting expensive paths off unless explicitly enabled.

#### C.1 Default blame behavior and cost control (P1)

##### Affected file
- `src/index/git.js`

##### Findings
- [ ] `blameEnabled` defaults to **true** (`options.blame !== false`). If a caller forgets to pass `blame:false`, indexing will run `git blame` per file (very expensive).
- [ ] `git log` + `git log --numstat` are executed per file; caching helps within a run but does not avoid the O(files) subprocess cost.

##### Required remediation
- [ ] Make blame opt-in by default:
  - [ ] change default to `options.blame === true`, **or**
  - [ ] ensure all call sites pass `blame:false` unless explicitly requested via config
- [ ] Consider adding a global “gitSignalsPolicy” (or reuse existing policy object) that centrally controls:
  - blame on/off
  - churn computation on/off
  - commit log depth
- [ ] Performance optimization options (choose based on ROI):
  - [ ] batch `git log` queries when indexing many files (e.g., per repo, not per file)
  - [ ] compute churn only when needed for ranking/filtering
  - [ ] support “recent churn only” explicitly in docs (currently it’s “last 10 commits”)

#### C.2 Minor correctness and maintainability issues (P2)

##### Findings
- [ ] Misleading JSDoc: `parseLineAuthors()` is documented as “Compute churn from git numstat output” (it parses blame authors, not churn). This can mislead future maintenance.

##### Required remediation
- [ ] Fix the JSDoc to match the function purpose and parameter type.

#### C.3 Tests improvements (P1)

##### Affected tests
- `tests/git-blame-range.js`
- `tests/git-meta.js`
- `tests/churn-filter.js`
- `tests/git-hooks.js`

##### Findings
- [ ] No tests assert “blame is off by default” (or the intended default policy).
- [ ] No tests cover rename-following semantics (`--follow`) or untracked files.
- [ ] Caching behavior is not validated (e.g., “git blame called once per file even if many chunks”).

##### Required remediation
- [ ] Add tests that explicitly validate the intended default blame policy.
- [ ] Add a caching-focused test that ensures repeated `getGitMeta()` calls for the same file do not spawn repeated git commands (can be validated via mocking or by instrumenting wrapper counts).
- [ ] Decide whether rename-following is required and add tests if so.

---

### D) Type inference (local + cross-file + tooling providers)

#### Dependency guidance (best choices)
- LSP-based providers (clangd/sourcekit/pyright) — keep optional and guarded; correctness should degrade gracefully.
- TypeScript compiler API — keep optional and isolated; add caching/incremental compilation for large repos.

#### D.1 Provider lifecycle and resilience (P1)

##### Affected files
- `src/index/type-inference-crossfile/tooling.js`
- `src/index/tooling/*.js`
- `src/integrations/tooling/lsp/client.js`
- `src/integrations/tooling/providers/lsp.js`
- `src/integrations/tooling/providers/shared.js`

##### Findings
- [ ] `createLspClient().request()` can leave pending requests forever if a caller forgets to supply `timeoutMs` (pending map leak). Current provider code *usually* supplies a timeout, but this is not enforced.
- [ ] Diagnostics timing: providers request symbols immediately after `didOpen` and then `didClose` quickly; some servers publish diagnostics asynchronously and may not emit before close, leading to inconsistent diagnostic capture.

##### Required remediation
- [ ] Enforce a default request timeout in `createLspClient.request()` if none is provided.
- [ ] For diagnostics collection, consider:
  - [ ] waiting a bounded time for initial diagnostics after `didOpen`, or
  - [ ] explicitly requesting diagnostics if server supports it (varies), or
  - [ ] documenting that diagnostics are “best effort” and may be incomplete

#### D.2 Unicode/offset correctness: add stronger guarantees (P1)

##### Affected files
- `src/integrations/tooling/lsp/positions.js`
- `src/shared/lines.js` (supporting)
- `tests/type-inference-lsp-enrichment.js`
- `tests/segment-pipeline.js` + fixtures

##### Findings
- [ ] `positions.js` JSDoc claims “1-based line/column”; column is actually treated as 0-based (correct for LSP), but the doc comment is misleading.
- [ ] Test coverage does not explicitly include surrogate pairs (emoji), which are the common failure mode when mixing code-point vs UTF-16 offsets.

##### Required remediation
- [ ] Fix the JSDoc to reflect actual behavior (LSP: 0-based character offsets; line converted to 1-based for internal helpers).
- [ ] Add tests with:
  - [ ] emoji in identifiers and/or strings before symbol definitions
  - [ ] CRLF line endings fixtures (if Windows compatibility is required)

#### D.3 Generic LSP provider chunk matching is weaker than clangd provider (P2)

##### Affected file
- `src/integrations/tooling/providers/lsp.js`

##### Findings
- [ ] `findChunkForOffsets()` requires strict containment (symbol range must be within chunk range). clangd-provider uses overlap scoring, which is more robust.

##### Required remediation
- [ ] Update generic provider to use overlap scoring like clangd-provider to reduce missed matches.

#### D.4 TypeScript provider issues (P2/P1 depending on usage)

##### Affected file
- `src/index/tooling/typescript-provider.js`

##### Findings
- [ ] `loadTypeScript()` resolve order includes keys that are not implemented (`global`) and duplicates (`cache` vs `tooling`).
- [ ] Parameter name extraction uses `getText()` which can produce non-identifiers for destructuring params (bad keys for `params` map).
- [ ] Naming convention risk: provider writes keys like `Class.method` which may not match chunk naming conventions; if mismatched, types will not attach.

##### Required remediation
- [ ] Fix the resolution order logic and document each lookup path purpose.
- [ ] Only record parameter names for identifiers; skip or normalize destructuring params.
- [ ] Validate chunk naming alignment (structural chunk naming vs provider symbol naming) and add a test for a class method mapping end-to-end.

#### D.5 Cross-file inference merge determinism and evidence (P2)

##### Affected files
- `src/index/type-inference-crossfile/apply.js`
- `src/index/type-inference-crossfile/pipeline.js`

##### Findings
- [ ] `mergeTypeList()` dedupes by `type|source` but drops evidence differences; confidence merging strategy is simplistic.
- [ ] Output ordering is not explicitly sorted after merges.

##### Required remediation
- [ ] Decide how to treat evidence in merges (keep first, merge arrays, keep highest confidence).
- [ ] Sort merged type lists deterministically (confidence desc, type asc, source asc).

#### D.6 Signature parsing robustness (P2)

##### Affected files
- `src/index/tooling/signature-parse/clike.js`
- `src/index/tooling/signature-parse/python.js`
- `src/index/tooling/signature-parse/swift.js`

##### Findings
- [ ] Parsers are intentionally lightweight, but they will fail on common real-world signatures:
  - C++ templates, function pointers, references
  - Python `*args/**kwargs`, keyword-only params, nested generics
  - Swift closures and attributes

##### Required remediation
- [ ] Add test fixtures covering at least one “hard” signature per language.
- [ ] Consider using tooling hover text more consistently (already used as fallback in clangd-provider) or integrate a minimal parser that handles nested generics and defaults.

---

### E) Performance improvements to prioritize (cross-cutting)

#### E.1 Risk analysis hot path (P1)
- [ ] Single-pass line scan for sources/sinks/sanitizers.
- [ ] Early return on caps (maxBytes/maxLines) rather than scanning the whole file anyway.
- [ ] Cheap prefilter before SafeRegex evaluation.
- [ ] Avoid per-line SafeRegex exceptions (see §B.2).

#### E.2 Markdown segmentation duplication (P2)
- [ ] `segments.js` parses markdown twice (inline code spans + fenced blocks). Consider extracting both from one micromark event stream.

#### E.3 Tooling providers I/O duplication (P2)
- [ ] Providers re-read file text from disk; if indexing already has the content in memory, pass it through (where feasible) to reduce I/O.

---

### F) Refactoring goals (maintainability / policy centralization)

- [ ] Consolidate analysis feature toggles into a single `analysisPolicy` object that is passed to:
  - metadata v2 builder
  - risk analysis
  - git analysis
  - type inference (local + cross-file + tooling)
- [ ] Centralize schema versioning and validation:
  - one metadata v2 schema
  - one risk rule bundle schema
  - one place that validates both as part of artifact validation

---

### G) Tests: required additions and upgrades

#### Existing tests reviewed (from the provided list)
- `tests/metadata-v2.js`
- `tests/churn-filter.js`
- `tests/git-blame-range.js`
- `tests/git-hooks.js`
- `tests/git-meta.js`
- `tests/minhash-parity.js`
- `tests/segment-pipeline.js` (+ fixtures)
- `tests/type-inference-crossfile*.js`
- `tests/type-inference-lsp-enrichment.js`
- `tests/type-inference-*-provider-no-*.js` (clangd/sourcekit)

#### Required test upgrades (P1/P0 where noted)
- [ ] **P0:** Add tests for metadata v2 nested inferred/tooling param types (see §A.1).
- [ ] **P0:** Add tests for risk rule compilation config correctness (flags honored, invalid patterns handled) (see §B.1).
- [ ] **P0:** Add risk analysis “long line” test to ensure no crashes (see §B.2).
- [ ] **P1:** Add unicode offset tests that include surrogate pairs (emoji) for:
  - LSP position mapping
  - chunk start offsets around unicode
- [ ] **P1:** Add git caching/policy tests (default blame policy + no repeated subprocess calls where caching is intended).

---

**Deliverables**
- This remediation checklist (this document)
- Updated `docs/metadata-schema-v2.md` and `docs/risk-rules.md` that match implementation
- Expanded test suite that locks in:
  - metaV2 types correctness (including nested)
  - risk rule compilation correctness and non-crashing evaluation
  - unicode offset correctness (including surrogate pairs)
  - intended git blame policy and caching

**Exit criteria**
- All P0 items are fixed and covered by tests.
- Metadata v2 output matches the schema doc, and `validateIndexArtifacts()` validates it meaningfully.
- Risk analysis and tooling passes are “best-effort”: they may skip/partial, but they never crash indexing.

---

## Phase 24 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)

### 24.1 Add MCP SDK and plan transport layering

* [ ] Add `@modelcontextprotocol/sdk` dependency
* [ ] Decide migration strategy:

  * [ ] **Option A (recommended):** keep `tools/mcp-server.js` as the entrypoint, but implement server via SDK and keep legacy behind a flag
  * [ ] Option B: replace legacy entirely (higher risk)

### 24.2 Implement SDK-based server

* [ ] Add `src/integrations/mcp/sdk-server.js` (or similar):

  * [ ] Register tools from `src/integrations/mcp/defs.js`
  * [ ] Dispatch calls to existing handlers in `tools/mcp/tools.js` (or migrate handlers into `src/` cleanly)
  * [ ] Preserve progress notifications semantics expected by `tests/mcp-server.js`:

    * [ ] `notifications/progress`
    * [ ] Include `{ tool: 'build_index', phase, message }` fields (match current tests)
* [ ] Update `tools/mcp-server.js`:

  * [ ] If `mcp.transport=legacy` or env forces legacy → use current transport
  * [ ] Else → use SDK transport

### 24.3 Remove or isolate legacy transport surface area

* [ ] Keep `tools/mcp/transport.js` for now, but:

  * [ ] Move to `tools/mcp/legacy/transport.js`
  * [ ] Update imports accordingly
  * [ ] Reduce churn risk while you validate parity

### 24.4 Tests

* [ ] Ensure these existing tests continue to pass without rewriting expectations unless protocol mandates it:

  * [ ] `tests/mcp-server.js`
  * [ ] `tests/mcp-robustness.js`
  * [ ] `tests/mcp-schema.js`
* [ ] Add `tests/mcp-transport-selector.js`:

  * [ ] Force `PAIROFCLEATS_MCP_TRANSPORT=legacy` and assert legacy path still works
  * [ ] Force `...=sdk` and assert SDK path works
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] MCP server behavior is unchanged from the client perspective (tool list, outputs, progress events)
* [ ] Maintenance burden reduced: eliminate custom framing/parsing where SDK provides it

---

## Phase 25 — Massive functionality boost: PDF + DOCX ingestion (prose mode)

### 25.1 Add document extraction dependencies

* [ ] Add `pdfjs-dist` (PDF text extraction)
* [ ] Add `mammoth` (DOCX → text/HTML extraction)

### 25.2 Introduce “extractor” layer in indexing pipeline

* [ ] Create `src/index/build/extractors/`:

  * [ ] `text.js` (wrap existing `readTextFileWithHash` path)
  * [ ] `pdf.js` (buffer → extracted text; include page separators if possible)
  * [ ] `docx.js` (buffer → extracted text; preserve headings if possible)
  * [ ] `index.js` (select extractor by extension + config)
* [ ] Add a new constant set in `src/index/constants.js`:

  * [ ] `EXTS_EXTRACTABLE_BINARY = new Set(['.pdf', '.docx'])`
* [ ] Add `.pdf` and `.docx` to `EXTS_PROSE` **only if** extraction is enabled (or add them unconditionally but ensure they don’t get skipped)

### 25.3 Fix binary-skip logic to allow extractable docs

You must handle both “pre-read” scanning and “post-read” binary checks:

* [ ] Update `src/index/build/file-scan.js` / `createFileScanner()`:

  * [ ] If `ext` ∈ `EXTS_EXTRACTABLE_BINARY` and extraction enabled:

    * [ ] Do **not** mark as `{ reason: 'binary' }`
    * [ ] Still allow minified checks to run when relevant (likely irrelevant for pdf/docx)
* [ ] Update `src/index/build/file-processor/skip.js`:

  * [ ] If `ext` extractable and extraction enabled, do not return `binarySkip`
* [ ] Update `src/index/build/file-processor.js`:

  * [ ] Branch early on `ext`:

    * [ ] For `.pdf`/`.docx`: read buffer → extractor → `text`
    * [ ] For all else: existing text decoding path
  * [ ] Ensure `hash` still derives from raw bytes (current `sha1(buffer)` behavior is good)
  * [ ] Ensure `stats.bytes` is still the raw size for guardrails

### 25.4 Chunking strategy for extracted docs

* [ ] Decide on an initial, deterministic chunking approach:

  * [ ] Minimal viable: treat extracted output as prose and let default prose chunking apply
  * [ ] Better: add dedicated chunkers:

    * [ ] Add `src/index/chunking/prose/pdf.js` to split by page markers
    * [ ] Add `src/index/chunking/prose/docx.js` to split by headings / paragraph blocks
* [ ] Update `src/index/chunking/dispatch.js`:

  * [ ] Map `.pdf` and `.docx` to their chunkers (or prose fallback)

### 25.5 Search + metadata integration

* [ ] Ensure extracted docs appear in:

  * [ ] `file_meta.json` (file path + ext)
  * [ ] `chunk_meta.*` (chunks with correct file associations)
* [ ] Consider adding a metadata flag for UI filters:

  * [ ] `fileMeta[i].isExtractedDoc = true` (or reuse existing `externalDocs` pattern if appropriate)
* [ ] Verify retrieval filters treat these files correctly (extension/path filters)

### 25.6 Tests (must include “end-to-end search finds doc content”)

* [ ] Add fixture files under `tests/fixtures/docs/`:

  * [ ] `sample.pdf` with a known unique phrase
  * [ ] `sample.docx` with a known unique phrase
* [ ] Add `tests/pdf-docx-extraction.js`:

  * [ ] Unit-level extraction returns expected text
* [ ] Add `tests/pdf-docx-index-search.js`:

  * [ ] Build prose index for a temp repo that includes the docs
  * [ ] Run `search.js --mode prose` and assert the phrases match chunks
* [ ] Add script-coverage action(s)

**Exit criteria**

* [ ] PDF/DOCX are no longer silently dropped as “binary” (when enabled)
* [ ] Prose search can retrieve content from these formats reliably
* [ ] No regression to binary detection for non-extractable files

---

## Phase 28 — Distribution Readiness (Package Control + Cross-Platform)

* [x] Packaging rules for ST3 (no compiled Python deps)
* [ ] Windows/macOS/Linux path + quoting correctness
  * [x] Sublime runner uses argv arrays (`subprocess.Popen([command] + args)`) to avoid shell quoting issues
  * [ ] Add/enable a CI gate that actually exercises “path with spaces” end-to-end (current Node test depends on map API endpoints; see Phase 29.1)
* [x] Document Graphviz optional dependency (for SVG/HTML rendering)
* [x] Provide minimal “DOT-only mode” documentation

Tests:

* [x] `python -m py_compile` over plugin package
  - Where: `tests/sublime-pycompile.js`
* [ ] Cross-platform subprocess quoting tests (Node)
  - Existing: `tests/subprocess-quoting.js` (currently depends on `/map` API endpoints; see Phase 29.1)

---

## Phase 29 — Optional: Service-Mode Integration for Sublime (API-backed Workflows)

### 29.1 Map endpoints (if service mode is adopted)

* [ ] Extend `api-server` to support:
  * [ ] `GET /map?scope=...&format=...`
  * [ ] `GET /map/nodes?filter=...` for quick panels

* [ ] Sublime plugin optionally consumes the API for faster iteration
  * [x] API client helper exists: `sublime/PairOfCleats/lib/api_client.py` (currently unused by commands)
  * [ ] Wire map generation to use API when `api_server_url` is configured (fallback to local CLI when unset)

### 29.2 Tests

* [ ] API contract tests for map endpoints
* [ ] Sublime plugin integration tests (mock HTTP server)

---

## Phase 30 — Verification Gates (Regression + Parity + UX Acceptance)

- [ ] While working on Phases 30, 41, 42, 44, create a document called "TEST_TIMES.md"
  - [ ] Write a little helper .ps1 (powershell 7) script that allows you to run a single test in your worktree without messing anything up
    - [ ] This helper script will add a line to TEST_TIMES.md containing the path/filename of the test if it does not exist already, and then log how long it took to run that test
    - [ ] Use this helper every time we have to run a test for this work, if a test takes longer than 10 seconds while you are doing this, cancel that specific test or end that specific process if you're absolutely sure you have to, and then add that test's path/filename to a "SLOW_TESTS.md" list
* [x] Parity checklist vs existing extension behaviors (where applicable)
  - Implemented: `tests/parity.js` (also wired into `tests/script-coverage/actions.js`)
* [ ] Deterministic outputs for map/search commands
  * [x] Search determinism is gated: `tests/search-determinism.js`
  * [ ] Map determinism test exists but is not wired into coverage/CI:
    - `tests/code-map-determinism.js`
* [ ] Performance acceptance criteria (map generation with guardrails)
  * [ ] Guardrails correctness test exists but is not wired into coverage/CI:
    - `tests/code-map-guardrails.js`
  * [ ] Add an explicit wall-clock performance budget gate for map generation on a fixture repo
* [ ] End-to-end smoke suite including:
  * [ ] index build
  * [ ] search
  * [ ] map generation (json + dot)
  * [ ] optional svg rendering when Graphviz available
  - Notes:
    - Map-related building blocks already exist as standalone tests:
      - `tests/code-map-basic.js`
      - `tests/code-map-dot.js`
      - `tests/code-map-graphviz-fallback.js`
    - Add an explicit `tests/e2e-smoke.js` or wire these into `tests/script-coverage/actions.js`.

### 30.1 Regression gate sweep backlog 

**Objective:** Clear the remaining regression gate failures that were moved out of Phase 4.

#### Current npm test failures

* [ ] `tests/git-blame-range.js` — expected alpha author in chunk authors
* [ ] `tests/lang/fixtures-sample/python-metadata.test.js` — missing signature metadata
* [ ] `tests/piece-assembly.js` — pieces manifest mismatch (equivalence)
* [ ] `tests/retrieval/filters/git-metadata/chunk-author.test.js` — chunk author filter failed (Alice)
* [ ] `tests/retrieval/filters/git-metadata/modified-time.test.js` — modified-after filter failed
* [ ] `tests/retrieval/filters/query-syntax/negative-terms.test.js` — negative phrase filter failed
* [ ] `tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js` — expected phrase score breakdown missing
* [ ] `tests/services/api/no-index.test.js` — expected NO_INDEX status
* [ ] `tests/services/api/search-happy-path.test.js` — /search returned no results
* [ ] `tests/services/api/search-validation.test.js` — socket hang up
* [ ] `tests/services/mcp/tool-search-defaults-and-filters.test.js` — riskTag filter did not change results
* [ ] `tests/subprocess-quoting.js` — /map did not return a map model

Note: merge-followup failures for api-server streaming, code-map basics, MCP schema, and api health/auth are tracked in Phase 44.

#### CLI flag removal and missing-value errors

* [ ] `tests/search-removed-flags.js`
  * [ ] Failure: expected actionable error for `--human`
  * [ ] Log: `logs/phase-22/search-removed-flags.log:1`
* [ ] `tests/search-missing-flag-values.js`
  * [ ] Failure: expected missing value message for `--type`
  * [ ] Log: `logs/phase-22/search-missing-flag-values.log:1`

#### Help output parity

* [ ] `tests/search-help.js`
  * [ ] Failure: help output missing flag `--calls`
  * [ ] Log: `logs/phase-22/search-help.log:1`

#### Download / extraction safety (tar)

* [ ] `tests/script-coverage.js`
  * [ ] Failure: unsafe tar entry detected (e.g., `vec0.dll`)
  * [ ] Log: `tests/.logs/2026-01-12T08-02-14-028Z/download-extensions-test.attempt-3.log:15`
  * [ ] Requirement: extraction must fail-closed on unsafe entries (path traversal, absolute paths, invalid drive prefixes, etc.).

#### File processor skip behavior

* [ ] `tests/file-processor/skip.test.js`
  * [ ] Failure: expected binary buffer to skip with `reason=binary`
  * [ ] Log: `logs/phase-22/file-processor-skip.log:1`

#### JavaScript chunking + relations

* [ ] `tests/lang/js-chunking.test.js`
  * [ ] Failure: missing exported function chunk (alpha)
  * [ ] Log: `logs/phase-22/lang-js-chunking.log:1`
* [ ] `tests/lang/js-relations.test.js`
  * [ ] Failure: missing exports for `run/default: []`
  * [ ] Log: `logs/phase-22/lang-js-relations.log:1`

#### Language registry collectors

* [ ] `tests/language-registry/collectors.test.js`
  * [ ] Failure: dockerfile mismatch (e.g., `["node:18"] !== ["base","node:18"]`)
  * [ ] Log: `logs/phase-22/language-registry-collectors.log:1`

**Exit criteria**

* [ ] All targeted failing tests above pass deterministically (at least 3 repeated local runs).

### 30.2 Benchmark + release gates (moved from Phase 15/26)

* [ ] Benchmarks show measurable improvement (and are reproducible)
* [ ] CI remains green on Node 18 + Windows lane
* [ ] New features are discoverable via config docs + `config_status`
* [ ] For large repos, sparse retrieval latency is materially improved (benchmarks added in Phase 15)

---

## Phase 31 — Isometric Visual Fidelity (Yoink-derived polish)

**Objective:** fold in proven glass/postprocessing practices from the yoink prototype for higher visual quality without regressing performance.

### 31.1 Glass + environment fidelity

* [ ] Add HDR env map tone calibration controls (env intensity, exposure) to match yoink reference settings.
  * [x] Env intensity control exists (`visuals.glass.envMapIntensity`) and is applied to glass materials
  * [ ] Exposure control is still hard-coded (`renderer.toneMappingExposure = 1.9`); add a UI slider + persist to panel state
* [x] Support normal map repeat/scale on glass with clearcoat normal influence.
  - Implemented via: `visuals.glass.normalRepeat`, `visuals.glass.normalScale`, `visuals.glass.clearcoatNormalScale`
* [ ] Add optional clearcoat normal map toggle for glass shells.
  - Note: setting `clearcoatNormalScale = 0` approximates a toggle, but an explicit boolean that removes `clearcoatNormalMap` would be clearer.

### 31.2 Post-processing polish

* [ ] Add optional UnrealBloomPass with user-controllable threshold/strength/radius.
* [ ] Provide a toggle to enable/disable post-processing for performance.

### 31.3 Rendering calibration

* [x] Expose metalness/roughness/transmission/ior/reflectivity/thickness controls as a grouped preset panel.
  - Implemented as UI sliders in `src/map/isometric/client/ui.js` + applied in `src/map/isometric/client/materials.js`
* [ ] Add a “studio” preset that mirrors yoink defaults for fast tuning.

### Dependency leverage and reuse (map viewer)

This map phase is intentionally designed to **maximize reuse** of what the repo already has:

- Existing semantics extraction already provides the key fields you listed:
  - `imports/exports/usages/importLinks` via relations
  - `calls/callDetails` + cross-file `callLinks/usageLinks/callSummaries`
  - `signature/modifiers/returns` via docmeta/functionMeta
  - `reads/writes/mutations/aliases` via AST dataflow (when enabled)
  - `controlFlow` counts already present in docmeta/functionMeta

- Existing graph tooling:
  - `graphology`-backed `graph_relations.json` provides a strong base graph layer

- The missing piece is the **visual model + rendering/export** and **Sublime UX** around it, which the map viewer phases supply.
---

## Phase 41 - Deep validation failures (integration run 2026-01-18)

**Objective:** Log failing tests from the deep validation run so they can be fixed once, then re-run.

### 41.1 Config schema fallout, CLI surface mismatch, Backend policy expectation

* [ ] `tests/build-embeddings-cache.js`: build_index fails because the test writes `.pairofcleats.json` with `indexing` keys (now disallowed).
* [ ] `tests/build-index-all.js`: build_index fails because the test writes `.pairofcleats.json` with `indexing` + `triage` keys (now disallowed).
* [ ] `tests/code-map-determinism.js`: build_index fails because the test writes `.pairofcleats.json` with `indexing` keys (now disallowed).
* [ ] `tests/embedding-batch-autotune.js`: build_index fails because the test writes `.pairofcleats.json` with `indexing` keys (now disallowed).
* [ ] `tests/cli.js`: fails on `pairofcleats config validate` (command removed from public CLI). Update the test to call `node tools/validate-config.js` or adjust CLI expectations.
* [ ] `tests/backend-policy.js`: assertion at line 25 expects auto backend to disable sqlite when `sqliteAutoChunkThreshold` is set; auto thresholds were removed, so update expectations or remove the threshold-specific cases.
* [ ] `tests/services/api/no-index.test.js`: `api-server should return NO_INDEX when indexes are missing` failure (status/response contract drift).

---

## Phase 42 - Storage test failures

**Objective:** Log `npm run test:storage` failures once; fix each test at most 1–2 tries, then move on.

### 42.1 Config schema fallout, Behavioral drift

* [ ] `tests/lmdb-backend.js`: writes `.pairofcleats.json` with `indexing.treeSitter` (disallowed). Update test to avoid config keys or move control to allowed env/CLI.
* [ ] `tests/lmdb-corruption.js`: writes `.pairofcleats.json` with `sqlite.use` (disallowed). Update test to rely on defaults or internal test env overrides.
* [ ] `tests/lmdb-report-artifacts.js`: writes `.pairofcleats.json` with `sqlite.use` (disallowed). Update test to rely on defaults or internal test env overrides.
* [ ] `tests/sqlite-ann-extension.js`: writes `.pairofcleats.json` with `cache`, `search`, `sqlite`, `dictionary` keys (disallowed). Remove config file and rely on defaults; replace vector extension settings with auto-only behavior.
* [ ] `tests/sqlite-ann-fallback.js`: writes `.pairofcleats.json` with `cache`, `dictionary`, `search`, `sqlite` (disallowed). Update to defaults and rework expectations to match auto-only extension handling.
* [ ] `tests/sqlite-auto-backend.js`: writes `.pairofcleats.json` with `sqlite` + `search.sqliteAutoChunkThreshold` (disallowed) and expects threshold-based backend flips. Update or remove threshold-based expectations.
* [ ] `tests/sqlite-build-indexes.js`: writes `.pairofcleats.json` with `indexing.*` (disallowed) and uses removed `--stage` flags. Update to new pipeline outputs and defaults.
* [ ] `tests/sqlite-missing-dep.js`: writes `.pairofcleats.json` with `sqlite` + `search` (disallowed) and uses `PAIROFCLEATS_SQLITE_DISABLED` (removed). Update test to new backend selection policy and missing dependency handling.
* [ ] `tests/sqlite-incremental-no-change.js`: fails with `Expected no full rebuild for no-change run` (output indicates rebuild or updated messaging). Align expectation with new incremental logic or adjust output assertions.

---

## Phase 44 - Merge Phase 32-40 test followups

**Objective:** Track failures/hangs from `npm run test` after merging phase32-40, and re-enable skipped tests once fixed.

### 44.1 Services (streaming + MCP + auth), Map lane, Artifacts, Prose

* [X] ALWAYS SKIP `tests/api-server-stream.js`: hangs during `npm run test`; temporarily excluded from `tests/run.js`. Investigate stream lifecycle and re-enable the test in the suite.
* [ ] `tests/mcp-robustness.js`: `Expected queue overload error response.` Repro: `node tests/mcp-robustness.js`. Verify overload handling and response schema.
* [ ] `tests/mcp-schema.js`: `MCP schema snapshot mismatch.` Repro: `node tests/mcp-schema.js`. Update schema output or snapshot expectation after policy changes.
* [ ] `tests/services/api/health-and-status.test.js`: `api-server should reject missing auth.` Repro: `node tests/services/api/health-and-status.test.js`. Check auth defaults for API server in new config contract.
* [ ] `tests/code-map-basic.js`: `Failed: expected dataflow/controlFlow metadata`. Repro: `node tests/code-map-basic.js`. Likely tied to auto policy disabling AST dataflow/control flow; adjust expectations or policy overrides for tests.
* [ ] `tests/code-map-dot.js`: `Failed: dot output missing import style`. Repro: `node tests/code-map-dot.js`. Confirm dot output formatting changes after hard cut and update expectations.
* [ ] `tests/artifact-size-guardrails.js`: `Expected chunk_meta sharding when max JSON bytes is small.` Build reported `Found 0 files.` Repro: `node tests/artifact-size-guardrails.js`. Investigate why discovery returns zero files and why sharding is not triggered under `PAIROFCLEATS_TEST_MAX_JSON_BYTES=4096`.
* [ ] `tests/compact-pieces.js`: build fails with `chunk_meta entry exceeds max JSON size (2187 bytes)` under small JSON cap. Repro: `node tests/compact-pieces.js`. Evaluate sharding thresholds/estimates vs hard error.
* [ ] `tests/comment-join.js`: `comment join test failed: extracted-prose search error.` Repro: `node tests/comment-join.js`. Investigate extracted-prose search path/policy defaults.
* [ ] `tests/extracted-prose.js`: `Extracted-prose test failed: search error.` Repro: `node tests/extracted-prose.js`. Check extracted-prose index availability and policy defaults.

---

