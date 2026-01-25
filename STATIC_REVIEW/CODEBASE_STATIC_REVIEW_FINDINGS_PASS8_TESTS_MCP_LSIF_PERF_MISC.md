# Codebase Static Review Findings — Tests: MCP / LSIF / Perf Bench / Assembly / Parity (Pass 8C)

This report is a focused static review of the **test scripts** listed in the request. The emphasis is on:

- **Correctness** (asserting the right contracts and catching real regressions)
- **Flake risk** (timing assumptions, environment leakage, log-string coupling)
- **Portability** (platform signal handling, filesystem semantics)
- **Performance realism** (bench/perf tests that should be gated and budgeted)
- **Suite scalability** (instrumentation for test timings and tiering into smoke vs. integration vs. perf)

All file references are relative to the repo root.

## Scope

Files reviewed (as requested):

### Protocol / integrations tests
- `tests/mcp-robustness.js`
- `tests/mcp-schema.js`
- `tests/lsp-shutdown.js`
- `tests/lsif-ingest.js`

### Bench + perf tests
- `tests/perf/bench/run.test.js`
- `tests/perf/bench/scenarios/ann-on-off.js`
- `tests/perf/bench/scenarios/bm25-params.js`
- `tests/perf/bench/scenarios/memory-vs-sqlite.js`
- `tests/perf/bench/scenarios/sqlite-fts.js`
- `tests/perf/sqlite-p95-latency.test.js`

### Artifact / postings / piece assembly tests
- `tests/piece-assembly.js`
- `tests/pieces-manifest-strict.js`
- `tests/postings-quantize.js`

### Core correctness / regression tests
- `tests/metadata-v2.js`
- `tests/minhash-parity.js`
- `tests/onnx-session-queue.js`
- `tests/php-methods-unique.js`
- `tests/preprocess-files.js`
- `tests/profile-config.js`
- `tests/prose-rust-exclusion.js`
- `tests/prose-skip-imports.js`
- `tests/python-ast-worker.js`
- `tests/python-fallback.js`
- `tests/parity.js`

## Severity Key

- **Critical**: very likely to produce false failures, hide real regressions, or destabilize CI.
- **High**: meaningful flake risk, brittle coupling to non-contractual behavior, or significant CI cost.
- **Medium**: correctness edge cases, maintainability gaps, or weak diagnostics.
- **Low**: polish, ergonomics, and small robustness improvements.

---

## Executive Summary

- **[High] Multiple tests are “heavy integration/perf” but are not explicitly tiered/gated**, which risks destabilizing CI as index build time grows (more languages, richer graph artifacts, sharding/streaming). Candidates that should be tiered/gated:
  - `tests/perf/sqlite-p95-latency.test.js` (always builds indexes and enforces a hard p95 budget)
  - `tests/piece-assembly.js` (multiple full index builds and multiple assemble runs)
  - `tests/parity.js` (depends on existing indexes, runs multiple backends)

- **[High] The MCP tests implement a custom JSON-RPC stream parser that can hang indefinitely on stream end**, and they do not reliably await child process exit after sending `shutdown`/`exit`. This can create latent hangs or leak subprocesses under failure modes:
  - `tests/mcp-robustness.js` (reader has no `end`/`close` resolution; no `await` on server exit)
  - `tests/mcp-schema.js` (same)

- **[Medium] `tests/lsif-ingest.js` deletes the output directory but does not recreate it** before invoking the tool. This works only if `tools/lsif-ingest.js` always creates parent directories; otherwise the test is dependent on tool behavior rather than validating it.

- **[Medium] `tests/perf/bench/run.test.js` appears to pass `--json` twice** when spawning `search.js`, which is likely accidental and could impact parsing or output shaping if CLI argument handling changes.

- **[Medium] Several tests assert behavior via log-message substring checks** (rather than structured output), which is brittle and discourages improving log text:
  - `tests/prose-skip-imports.js` checks for `"Scanning for imports"` in `stderr`.

- **[Cross-cutting] The suite needs a first-class process for timing instrumentation and test tiering** so CI can run “smoke” deterministically while integration/perf can run on demand or nightly, with explicit budgets.

---

## 1) MCP Robustness + Schema Snapshot Tests

### 1.1 **[High] Stream parser can hang forever on EOF / server crash**
**Where**
- `tests/mcp-robustness.js:21–64`
- `tests/mcp-schema.js:26–70`

**What’s wrong**
- `createReader()` waits for `data` events only.
- If the MCP server exits early, closes stdout, or crashes before emitting a complete message, `readRaw()` never resolves (no `end` / `close` / `error` handling).

**Why it matters**
- These tests are specifically meant to validate robustness. A robustness test that itself can hang indefinitely under real failure modes creates the worst-case debugging loop.

**Suggestions**
- Update the reader logic to handle stream termination:
  - Attach `stream.once('end', ...)` and `stream.once('close', ...)` and reject/resolve with an explicit error.
  - Attach `stream.once('error', ...)` similarly.
  - Consider a per-read timeout (shorter than the global 30s watchdog) so failures localize.

---

### 1.2 **[High] No explicit wait for MCP server process exit after `shutdown`/`exit`**
**Where**
- `tests/mcp-robustness.js:126–135` and `178–187`
- `tests/mcp-schema.js:150–167`

**What’s wrong**
- The tests send `shutdown` and `exit`, then `server.stdin.end()` in a `finally`, but do not `await` process termination (e.g., `await once(server, 'exit')`).
- If `tools/mcp-server.js` ignores `exit` under some error state, the test may leave a running subprocess or keep streams open.

**Suggestions**
- Add an explicit “wait for exit” step:
  - `await new Promise((resolve, reject) => { server.once('exit', resolve); server.once('error', reject); })`
  - Use a short deadline (e.g., 2–5s) and then kill.

---

### 1.2b **[Medium] Timeout/cleanup uses `SIGKILL`, which is not portable and can hide cleanup regressions**
**Where**
- `tests/mcp-robustness.js:78–82`, `149–153`, `130–134`, `182–187`
- `tests/mcp-schema.js:82–86`, `176–180`

**What’s wrong**
- The tests use `server.kill('SIGKILL')` on timeout and in some error paths.
- On some platforms (notably Windows) signal handling semantics differ, and “hard kill” can:
  - fail or behave inconsistently,
  - bypass graceful shutdown paths that you actually want to validate.

**Suggestions**
- Prefer a staged shutdown in tests:
  1) attempt graceful stop (`shutdown`/`exit` or `SIGTERM`), wait briefly,
  2) then escalate to `SIGKILL` only if still running.
- If Windows support is a goal, implement a helper that selects the best available termination strategy per platform and always waits for `exit` with a deadline.

---

### 1.3 **[Medium] JSON parsing assumes tool output is always JSON text in `content[0].text`**
**Where**
- `tests/mcp-robustness.js:172–175`
- `tests/mcp-schema.js:134–149`

**What’s wrong**
- The tests parse `JSON.parse(status.result?.content?.[0]?.text || '')`.
- If the MCP tool returns:
  - multiple content blocks,
  - non-JSON human text,
  - JSON with leading logs,
  - or an error payload with a different shape,
  the test fails in a way that can be hard to interpret.

**Suggestions**
- Harden the parsing expectations:
  - Assert `content.length === 1` and `content[0].type === 'text'` (if that is contractual).
  - Add a diagnostic dump of `response` when parsing fails.
  - Consider tooling responses that return JSON as a dedicated structured field (longer term).

---

### 1.4 **[Low] Snapshot mismatch provides no diff and doesn’t materialize “actual”**
**Where**
- `tests/mcp-schema.js:169–172`

**What’s wrong**
- On mismatch it prints `"MCP schema snapshot mismatch."` only.

**Suggestions**
- Print:
  - where the snapshot lives,
  - and (optionally) write `actual` to a temp file (or print the first differing path).

---

## 2) LSP Shutdown + LSIF Ingest Tests

### 2.1 **[Medium] LSP shutdown uses fixed sleep + force kill**
**Where**
- `tests/lsp-shutdown.js:15–18`

**What’s wrong**
- The test waits `200ms` then calls `client.kill()`.
- If the server or client is slower (CI contention, Windows process scheduling), this can either:
  - kill a process that was about to exit cleanly, or
  - mask a real deadlock by killing it.

**Suggestions**
- Replace fixed delay with explicit lifecycle waiting:
  - Wait for `shutdownAndExit()` to guarantee transport close, or
  - ensure `createLspClient()` exposes a `waitForExit()` that resolves on child exit.

---

### 2.2 **[Medium] LSIF ingest test removes the output directory but does not recreate it**
**Where**
- `tests/lsif-ingest.js:14–20`

**What’s wrong**
- The test does `rm(tempRoot, ...)` (line 14) and then immediately invokes the tool with `--out <tempRoot>/lsif.jsonl`.
- The test does not `mkdir(tempRoot)`.

**Why it matters**
- If the tool *happens* to create parent directories, the test passes. If that behavior changes (or differs across platforms), the test fails for reasons unrelated to LSIF ingestion correctness.

**Suggestions**
- Explicitly create `tempRoot` in the test (so the contract under test is “ingest works,” not “ingest creates directories”).
- Or, if directory creation is meant to be a contract, add an explicit assertion about it (and test it intentionally).

---

### 2.3 **[Low] Missing existence check for `.meta.json`**
**Where**
- `tests/lsif-ingest.js:41–46`

**What’s wrong**
- It reads `${outPath}.meta.json` directly without checking existence. If the tool fails to write meta (or writes it elsewhere), the test throws a generic read error.

**Suggestions**
- Add an existence check with a clearer failure message.

---

## 3) Perf Bench Suite

### 3.1 **[Medium] Duplicate `--json` flag when spawning `search.js`**
**Where**
- `tests/perf/bench/run.test.js:176–182`

**What’s wrong**
- The search args include `--json` twice:
  - `--json` (line 180)
  - `--json` (line 181)

**Why it matters**
- Today this may be harmless, but it creates ambiguity in CLI parsing and invites subtle drift if flags become count-sensitive (e.g., `--json --json` might one day imply extra verbosity or a different mode).

**Suggestions**
- Remove the duplicate flag.

---

### 3.2 **[Medium] `concurrencyStats` only records results for concurrency == 4**
**Where**
- `tests/perf/bench/run.test.js:553–566`

**What’s wrong**
- Even though the script supports `--query-concurrency` as a list, it only stores `concurrencyStats` for concurrency `4`.

**Suggestions**
- Either:
  - Store stats for *all* requested concurrencies, or
  - document explicitly that concurrency stats are only summarized for 4 and why.

---

### 3.3 **[Low] Bench scripts should be explicitly excluded from CI by default**
**Where**
- `tests/perf/bench/scenarios/*.js`

**What’s good**
- All scenario scripts are gated behind `PAIROFCLEATS_BENCH_RUN` and exit with a clear skip message.

**Potential improvement**
- Mirror this gating pattern for other “perf-budget” tests (see §4).

---

## 4) Perf Budget Test: SQLite p95 Latency

### 4.1 **[High] Fixed p95 latency budget is environment-sensitive and will flake**
**Where**
- `tests/perf/sqlite-p95-latency.test.js:85–88`

**What’s wrong**
- It enforces `maxP95Ms = 1500` with a hard failure.

**Why it matters**
- Latency is highly dependent on:
  - CPU class and current contention,
  - filesystem speed,
  - platform differences,
  - CI throttling.

**Suggestions**
- Tier/gate this test:
  - Run only under `PAIROFCLEATS_PERF_RUN=1` (or similar).
  - Or degrade it to a “warn-only” artifact that is measured and tracked, not hard-failed.
- If you want a hard gate, make it adaptive:
  - Use a baseline file per environment (or per CI runner class).
  - Or compare to “previous main branch” in CI (harder).

---

### 4.2 **[Medium] Diagnostics are suppressed for searches (`stdio: 'ignore'`)**
**Where**
- `tests/perf/sqlite-p95-latency.test.js:66–71`

**What’s wrong**
- On failure, you lose child output that could explain why the search failed.

**Suggestions**
- Capture stderr and print it on failure, while still keeping steady-state runs quiet.

---

## 5) Piece Assembly + Manifest Strictness

### 5.1 **[High] `tests/piece-assembly.js` is heavy and not gated**
**Where**
- `tests/piece-assembly.js` (multiple full index builds + multiple assembly runs)

**What’s wrong**
- The test runs:
  - two full `build_index` runs on the same fixture (A/B),
  - an assemble-single run,
  - an assemble-merge run,
  - a repeat merge run (determinism),
  - then a second equivalence suite building 3 repos and assembling again.

**Why it matters**
- As indexing gets more expensive (more language passes, richer relations, streaming), this test can become a disproportionate CI cost and a top contributor to timeouts.

**Suggestions**
- Tier it explicitly as **integration/e2e**:
  - run only under `PAIROFCLEATS_E2E_RUN=1` or `PAIROFCLEATS_CI_TIER=integration`.
  - keep a smaller smoke variant that validates minimal invariants quickly.

---

### 5.2 **[Medium] Fixed “30s” assembly runtime limit is a flake vector**
**Where**
- `tests/piece-assembly.js:95–99` and `272–276`

**What’s wrong**
- Hard-coded `> 30000ms` failures assume a particular machine class.

**Suggestions**
- If the goal is to prevent accidental quadratic behavior:
  - measure and log durations,
  - enforce a less brittle upper bound (or only enforce in perf tier).

---

### 5.3 **[Medium] Global `process.env.PAIROFCLEATS_CACHE_ROOT` mutation inside the test**
**Where**
- `tests/piece-assembly.js:55–59` and later `~330+`

**What’s wrong**
- The test modifies `process.env` to compute index dirs.
- It is likely safe because these tests run in their own node process, but it increases confusion and makes the script less robust if it is ever imported/embedded.

**Suggestions**
- Keep cache roots inside explicit env objects passed to children.
- If you need to compute `getIndexDir()`, pass cache root as an explicit parameter (or expose a pure helper that does not depend on global env).

---

### 5.4 **[Low] Equality checks rely on `JSON.stringify` without diagnostics**
**Where**
- Many locations, e.g. `tests/piece-assembly.js:117–128`, `182–191`, `268–276`, `~300+`

**What’s wrong**
- When a mismatch occurs, you get a generic message and no clue where the first difference is.

**Suggestions**
- Add a small “first mismatch path” helper for large JSON structures.

---

### 5.5 **[Low] `tests/pieces-manifest-strict.js` is good but narrow**
**Where**
- `tests/pieces-manifest-strict.js:12–33`

**What’s good**
- It asserts that the manifest writer hard-fails when a referenced piece file is missing.

**Suggested expansion**
- Add a second case validating the error message includes the missing path/type/name (debuggability contract).

---

## 6) Parity Test

### 6.1 **[High] `tests/parity.js` is a tool-like script and should be tiered**
**Where**
- `tests/parity.js` (overall)

**What’s wrong**
- The script expects indexes to exist (or uses cached defaults), runs multiple backends, and produces a report.
- This looks like a **diagnostic tool**, not a deterministic unit test.

**Suggestions**
- Either:
  - Move it under `tools/` or `tests/perf/` and gate it by env var, or
  - Integrate it into a dedicated “parity CI job” that builds the needed artifacts and runs it.

---

### 6.2 **[Medium] Fragile JSON parsing assumes stdout is *only* JSON**
**Where**
- `tests/parity.js:129–151`

**What’s wrong**
- It does `JSON.parse(result.stdout)` (line 150).
- Any logging to stdout from `search.js` will break it.

**Suggestions**
- Make the parsing more robust:
  - enforce `--quiet` (if supported),
  - or parse the last non-empty line as JSON,
  - or have `search.js --json` hard-redirect all logs to stderr.

---

## 7) Smaller Correctness Tests

These are generally in good shape, but there are a few small robustness / future-proofing points.

### 7.1 `tests/postings-quantize.js`
**Notes**
- Good targeted coverage for mixed `embedding`/`embed_doc`/`embed_code` and dimension mismatch.

**[Low] Suggestion**
- When JSON mismatches, print label + the first differing vector index.

---

### 7.2 `tests/preprocess-files.js`
**Notes**
- Good coverage of minified + binary exclusion and mode routing.

**[Medium] Risk**
- It asserts skip reasons by string (`'minified'`, `'binary'`) and relies on specific routing rules for extracted-prose (`['docs/readme.md', 'src/app.js']`). If these reasons or policies get centralized/renamed, the test can fail despite correct behavior.

**Suggestions**
- Prefer assertions on:
  - the presence/absence of files in modes,
  - and (if needed) a stable skip code enum rather than raw strings.

---

### 7.3 `tests/prose-skip-imports.js`
**[Medium] Brittleness: log substring contract**
- It fails if `stderr.includes('Scanning for imports')`.
- This is sensitive to log wording changes.

**Suggestions**
- Prefer a structured signal:
  - e.g., a metrics flag “importsScanned=false” in index_state,
  - or a debug JSON `--explain` output that explicitly lists major pipeline steps executed.

---

### 7.4 `tests/python-ast-worker.js`
**[Medium] Pool shutdown may be async but is not awaited**
- The test calls `shutdownPythonAstPool()` without awaiting.

**Why it matters**
- If shutdown is async (or involves worker termination), the process may exit early or may hang due to open handles.

**Suggestions**
- If `shutdownPythonAstPool()` returns a promise, await it.
- If it is sync, consider renaming to make that clear.

---

### 7.5 `tests/prose-rust-exclusion.js` and other env-heavy scripts
**[Low] Env duplication**
- Several tests set both `env = { ...process.env, ... }` and also mutate `process.env` directly.

**Suggestions**
- Prefer only the explicit `env` object passed to children to avoid accidental coupling.

---

## 8) Process: Test Timing Instrumentation + Tiered Suites (Critical for CI Scaling)

The repo already has a large and growing set of tests that range from pure unit checks to “build an entire index and validate artifacts.” To keep CI fast and reliable while still testing meaningful invariants, you want an explicit system that:

1) measures test durations,
2) enforces budgets per tier,
3) makes it obvious when a test should move tiers.

### 8.1 Add a timing recorder in the test harness
**Goal**: produce `tests/.cache/test-timings.json` (or `artifacts/test-timings.json`) containing per-test wall time.

**Recommended shape**
- For each executed test file:
  - `name`: test filename
  - `tier`: `smoke | unit | integration | perf`
  - `wallMs`: elapsed time
  - `status`: `pass | fail | skip`
  - `exitCode`
  - `stdoutBytes` / `stderrBytes` (optional, useful for runaway logging)

**Implementation approach**
- Wherever tests are orchestrated (a script like `tests/all.js` or equivalent), wrap each spawn in:
  - `const start = performance.now()`
  - run the test
  - `wallMs = performance.now() - start`
  - append an entry to a JSON file.

### 8.2 Define explicit tiers and defaults
**Suggested tier policy**
- **smoke** (default in CI): fast, deterministic, no full index builds; target budget e.g. `< 2–5 minutes total`.
- **unit**: deterministic per-module tests; minimal IO.
- **integration**: builds fixture indexes / sqlite; runs tool install/detect stubs; budgeted separately.
- **perf**: latency/throughput budgets; only on demand or nightly.

**Mechanism**
- Add `PAIROFCLEATS_TEST_TIER=smoke|integration|perf`.
- Each test can declare its tier at the top (e.g., via a small helper), or the harness can use a mapping file (recommended so tests stay clean).

### 8.3 Gate the heavy tests in this batch
**Immediate candidates**
- `tests/perf/sqlite-p95-latency.test.js` → `perf`
- `tests/piece-assembly.js` → `integration`
- `tests/parity.js` → `integration` or `perf` (depending on whether you make it build its own inputs)

**Requirement**
- The scripts should print a one-line skip message and exit 0 when tier is not enabled.

### 8.4 Budget enforcement and CI ergonomics
- Add a CI job that runs:
  - `smoke` on every PR,
  - `integration` on merge to main (or nightly),
  - `perf` nightly only.
- Use the timing report to:
  - detect regressions (a test got 3× slower),
  - decide which tests belong in smoke.

### 8.5 Make failures debuggable
For any test that spawns subprocesses and parses JSON:
- on parse failure:
  - print the first ~2KB of stdout/stderr
  - print the invoked command args

This dramatically reduces "works on my machine" debugging time.

---

## Appendix: Quick File-by-File Notes

- `tests/metadata-v2.js`: good unit coverage for metaV2 shape; consider also testing return type normalization drift if that’s a known area.
- `tests/minhash-parity.js`: good parity check; ensure any hashing randomness is seeded/deterministic.
- `tests/onnx-session-queue.js`: good concurrency invariant check; if the queue is meant to allow >1 concurrency in some modes, add a second test that validates the configured concurrency.
- `tests/php-methods-unique.js`: good targeted regression test.
- `tests/profile-config.js`: good policy guardrail test.
- `tests/python-fallback.js`: good sanity check that heuristic chunking produces expected named chunks.

