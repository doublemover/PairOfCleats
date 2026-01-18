 ALWAYS SKIP `tests/api-server-stream.js`:
- [ ] While working on Phases 30, 41, 42, 44, create a document called "TEST_TIMES.md"
  - [ ] Write a little helper .ps1 (powershell 7) script that allows you to run a single test in your worktree without messing anything up
    - [ ] This helper script will add a line to TEST_TIMES.md containing the path/filename of the test if it does not exist already, and then log how long it took to run that test
    - [ ] Use this helper every time we have to run a test for this work, if a test takes longer than 10 seconds while you are doing this, cancel that specific test or end that specific process if you're absolutely sure you have to, and then add that test's path/filename to a "SLOW_TESTS.md" list
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

### 30.2 Benchmark + release gates (moved from Phase 15/26)

* [ ] Benchmarks show measurable improvement (and are reproducible)
* [ ] CI remains green on Node 18 + Windows lane
* [ ] New features are discoverable via config docs + `config_status`
* [ ] For large repos, sparse retrieval latency is materially improved (benchmarks added in Phase 15)

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

