# Codebase Static Review Findings — Pass 9 (Service Tests: API + MCP + Setup Index Detection)

> Scope: **Service-layer test scripts** under `tests/services/` plus `tests/setup-index-detection.js` (only the files listed in the request).  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness risks, portability problems, missing test coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

### API service tests
- `tests/services/api/cors-allow.test.js`
- `tests/services/api/health-and-status.test.js`
- `tests/services/api/no-index.test.js`
- `tests/services/api/repo-authorization.test.js`
- `tests/services/api/search-happy-path.test.js`
- `tests/services/api/search-stream-abort.test.js`
- `tests/services/api/search-validation.test.js`
- `tests/services/api/sse-backpressure.test.js`

### MCP service tests
- `tests/services/mcp/errors.test.js`
- `tests/services/mcp/protocol-initialize.test.js`
- `tests/services/mcp/tool-build-index-progress.test.js`
- `tests/services/mcp/tool-config-status.test.js`
- `tests/services/mcp/tool-index-status.test.js`
- `tests/services/mcp/tool-search-defaults-and-filters.test.js`
- `tests/services/mcp/tools-list.test.js`

### Setup detection test
- `tests/setup-index-detection.js`

---

## Executive Summary

These service tests are directionally strong: they validate authentication, CORS blocking/allow rules, repo authorization boundaries, missing-index behavior, compact result shaping, request validation, SSE backpressure behavior, MCP protocol initialization, MCP tool surface stability, error handling, and tool progress notifications.

However, there are several issues that will materially affect reliability and signal quality over time:

1. **Hanging risk in API service tests**: the HTTP request helpers used by these scripts do not enforce request timeouts, and `search-stream-abort.test.js` uses a raw `http.request` promise without any deadline. If the server stops responding (deadlock, infinite loop, stuck I/O), the test run can hang indefinitely.
2. **False positives / under-asserting “stream abort” behavior**: `search-stream-abort.test.js` can pass even if `/search/stream` returns an immediate error or never streams meaningful data. It validates “server didn’t crash” but not that “streaming actually started and was aborted mid-stream.”
3. **Brittle assertions against human-readable error messages** in MCP tests: `errors.test.js` asserts on substring matches like “Repo path not found” and “index” rather than stable machine codes. This is likely to churn or localize.
4. **Filter tests for MCP search are logically weak and may fail spuriously**: comparing only `riskHits.length` / `typeHits.length` against baseline can fail even when filtering works (e.g., same `top` count but different members), or pass when it doesn’t (some kinds of ranking regressions).
5. **Portability issues in setup detection test**: `tests/setup-index-detection.js` writes `chunk_meta.meta.json` using `path.join()` for paths inside the JSON payload, which may emit platform-specific separators (`\` on Windows). If the loader expects POSIX separators or normalizes differently, the test can become OS-dependent.
6. **Cost profile / CI tiering**: most API service tests rebuild fixture indexes by using a fresh `cacheName` and deleting cache roots. That is good for isolation but expensive and will become a pressure point for CI runtime; you will want explicit tiering and timing-ledger-driven decisions.

The rest of this document lists concrete issues and recommended remediations.

---

## High-Priority Findings

### P0 — API service tests can hang indefinitely due to missing request timeouts

**Where**
- `tests/services/api/search-stream-abort.test.js` (no timeout around `abortStream()` and no client socket timeouts)
- `tests/services/api/*` (all rely on `requestJson()`/`requestRaw()` helpers that do not impose timeouts)

**What’s wrong**
- In `search-stream-abort.test.js`, `abortStream()` resolves only when `res.once('data', ...)` fires (lines 39–44). If the server stalls before writing any bytes, the promise never resolves or rejects.
- None of the API tests impose an upper bound on how long an HTTP request may take. If the API server enters a non-crashing hung state, the test runner may stall indefinitely.

**Why it matters**
- A hung integration test is worse than a failing test: it consumes CI time, blocks merges, and often yields low-quality diagnostics.

**Suggested fix**
- Enforce request timeouts at the test layer:
  - Wrap each API call in a `withTimeout(promise, ms, label)` helper (similar to what `sse-backpressure.test.js` already does).
  - In `search-stream-abort.test.js`, add a timeout to `abortStream()` and set a socket timeout (`req.setTimeout(...)`) that triggers a rejection.
- If the project intends to keep `requestJson()` / `requestRaw()` centralized (recommended), implement a default request timeout in the shared helper (and make it configurable per test).

**Additional coverage to add**
- A test that simulates “server never responds” (e.g., a route that intentionally sleeps) and asserts the client timeout behavior is deterministic.

---

### P0 — Stream abort test can pass even if the streaming endpoint is broken

**Where**
- `tests/services/api/search-stream-abort.test.js`

**What’s wrong**
- The test resolves as soon as **any** data is received (`res.once('data', ...)`), then immediately destroys the response (lines 39–44).
- It does not assert:
  - the response status code (200 vs 401/4xx/5xx),
  - the content type / SSE framing,
  - that the data resembles a stream event,
  - that streaming started (progress/results events) rather than an immediate error payload.

**Why it matters**
- This test is intended to validate a failure mode (client abort) that commonly triggers resource leaks or unhandled stream errors.
- Without a minimal positive assertion of “streaming is working,” the test can become a **false comfort**: regressions that turn `/search/stream` into “always errors” would still pass as long as the server stays alive.

**Suggested fix**
- Strengthen the test’s positive assertions before abort:
  - assert `res.statusCode === 200` (or the expected success code),
  - assert the expected `content-type` (likely `text/event-stream`),
  - parse the first SSE frame and assert it has an expected `event:` value (e.g., `progress` or `result`).
- Abort **after** validating that a legitimate SSE frame was received.
- Add a short timeout to avoid hanging if the first frame never arrives.

**Additional coverage to add**
- Abort at multiple points:
  - immediately after headers,
  - after first progress event,
  - mid-results (after N results).
- Validate that the server cancels/halts work (if cancellation is implemented) by checking that the server-side worker doesn’t continue emitting progress after the client disconnect.

---

### P0 — MCP search filter tests can fail spuriously because they compare only result counts

**Where**
- `tests/services/mcp/tool-search-defaults-and-filters.test.js` (lines 45–87)

**What’s wrong**
- The test checks:
  - `if (riskHits.length === baselineHits.length) throw ...` (lines 63–65)
  - `if (typeHits.length === baselineHits.length) throw ...` (lines 85–87)
- This assumes filters change the *count* of returned hits.
- In a ranked system, it is completely valid for filtered queries to return the same `top` count (e.g., `top: 5`) while changing *which* hits are included. In that case, this test will fail even if filtering is correct.

**Why it matters**
- These are core contract tests for the MCP integration. If they are brittle, you will either weaken them over time or see frequent spurious failures that reduce confidence.

**Suggested fix**
- Assert *predicate correctness* rather than count differences:
  - For `riskTag: 'sql'`, assert every hit contains the `sql` risk tag (or risk category) in whatever field is preserved in compact payloads.
  - For `type: 'class'`, assert each hit is classified as `class`.
- If the compact payload omits those fields, introduce one of:
  - a test-only option to request richer metadata for verification,
  - or a `--include=...` contract (for MCP tool output) that includes minimal fields necessary for filter verification.
- Optionally also assert that the identity set differs: compare `{chunkId,filePath,rangeStart}` tuples between baseline and filtered runs.

---

### P0 — `tests/setup-index-detection.js` can become OS-dependent due to path separators embedded in JSON

**Where**
- `tests/setup-index-detection.js` (lines 83–96, specifically line 89)

**What’s wrong**
- The test writes `chunk_meta.meta.json` containing:
  - `parts: [path.join('chunk_meta.parts', partName)]`
- `path.join()` emits OS-specific separators (e.g., `chunk_meta.parts\\chunk_meta.part-00000.jsonl` on Windows).
- If the artifact loader expects POSIX separators (`/`) or performs comparisons that assume `/`, this test will be platform-flaky.

**Why it matters**
- Artifacts are one of the primary interchange formats in the system.
- Even if you do not claim cross-platform artifact portability, tests should avoid accidentally encoding OS-specific assumptions unless that is explicitly part of the contract.

**Suggested fix**
- Prefer storing manifest paths in a stable normalized form:
  - Use POSIX separators inside the JSON (`'chunk_meta.parts/' + partName`) *or*
  - Explicitly normalize to `/` when writing parts manifest values.
- Add a second scenario that writes the manifest using `\` separators (if Windows portability is intended) and ensure the loader handles it.

**Additional coverage to add**
- A scenario with a part path that includes nested directories.
- A scenario where the meta file exists but the referenced part file is missing (should be `ready: false`).

---

## Medium-Priority Findings

### P1 — API service tests repeatedly rebuild fixture indexes; isolation is good, but runtime cost will balloon

**Where**
- Most `tests/services/api/*.test.js` scripts:
  - create unique `cacheName`
  - delete `tests/.cache/<cacheName>` before indexing
  - call `ensureFixtureIndex({ fixtureName: 'sample', cacheName })`

**What’s wrong**
- These tests likely rebuild the same fixture index multiple times.
- That is expensive and directly impacts CI runtime.

**Why it matters**
- As the indexer grows (more languages, more enrichment passes, more graphs), index build cost will rise.
- If integration tests are not explicitly tiered, developers will be incentivized to skip them locally.

**Suggested fix**
- Introduce tiering (smoke vs integration vs e2e) and let CI choose what runs.
- Consider sharing a single read-only fixture index build across the API test suite:
  - e.g., one build per fixture per run (or per job) and then multiple server tests reuse it.
  - Keep isolation for tests that mutate indexes; these API tests are largely read-only.

**Suggested additional assertion**
- If you do share index builds, add one guard test to confirm the fixture index is deterministic (checksum manifest stable) so reuse is safe.

---

### P1 — MCP error tests assert brittle message strings rather than stable error codes

**Where**
- `tests/services/mcp/errors.test.js` (lines 36–40 and 55–61)

**What’s wrong**
- It expects the “missing repo” message to include the literal substring:
  - `Repo path not found` (line 37)
- It expects the “missing index” error payload to:
  - have `message` containing `index` (line 55)
  - include a `hint` mentioning `build-index` / `build-sqlite-index` (lines 58–61)

**Why it matters**
- Human-readable error messages change frequently:
  - wording changes,
  - localization, formatting, punctuation,
  - inclusion of additional context.
- Tests should anchor on stable **machine codes** and schema fields.

**Suggested fix**
- Require MCP tool error payloads to include a stable `code` (e.g., `REPO_NOT_FOUND`, `NO_INDEX`) and assert on that.
- Keep the substring assertions optional (only if you explicitly want to enforce the user-facing copy).

---

### P1 — MCP build-index progress test checks only that progress notifications exist

**Where**
- `tests/services/mcp/tool-build-index-progress.test.js` (lines 21–44)

**What’s wrong**
- The test asserts only that at least one `notifications/progress` event occurred.
- It does not validate:
  - the tool call succeeded,
  - the progress schema is correct (e.g., percent ranges, stage names),
  - progress includes a terminal state.

**Why it matters**
- Progress streaming is exactly the type of feature that regresses subtly (events emitted but meaningless or out-of-order), especially under concurrency/streaming changes.

**Suggested fix**
- Add minimal schema assertions on progress notifications:
  - presence of `tool`, `stage`/`message`, and monotonic progress where applicable.
- Assert the `tools/call` response indicates success (and not an error that coincidentally emitted progress first).

---

### P1 — API health/status test encodes subtle ordering assumptions (CORS vs auth)

**Where**
- `tests/services/api/health-and-status.test.js`

**What’s wrong**
- The test expects a disallowed `Origin` to return `403 FORBIDDEN` (lines 28–33) even though auth is present.
- It also expects CORS preflight (`OPTIONS`) to return `403 FORBIDDEN` (lines 35–43).
- This effectively encodes an ordering: **CORS checks must run before auth**, and must have a stable error shape.

**Why it matters**
- Ordering between auth, CORS, and route dispatch can change for good reasons (e.g., allowing OPTIONS unauthenticated, or returning a different code for preflight).

**Suggested fix**
- Decide whether this ordering is part of the contract:
  - If yes, document it and keep the test strict.
  - If no, loosen the test to accept either `401` or `403` while still asserting that disallowed origins are not allowed to succeed.
- If preflight behavior should be “block disallowed origins but always respond without requiring auth,” add an explicit test that preflight requests without auth behave as intended.

---

## Lower-Priority Findings and Improvements

### P2 — Setup index detection uses `spawnSync` without a timeout and provides limited diagnostics on failure

**Where**
- `tests/setup-index-detection.js` (lines 28–65)

**What’s wrong**
- `spawnSync(...)` is used without a `timeout` option.
- On failure, only `stderr` is printed (lines 52–55), and invalid JSON output prints a generic message (lines 60–62) without echoing the offending stdout.

**Suggested fix**
- Add a `timeout` in `spawnSync` options to prevent indefinite hangs.
- If JSON parsing fails, print a short snippet of stdout/stderr for debugging.

---

### P2 — Many tests rely on `process.cwd()` being the repository root

**Where**
- All scripts in this sweep use `process.cwd()` as the base path.

**What’s wrong**
- If the tests are invoked from another working directory, paths like `tests/.cache/...` and `tools/setup.js` will not resolve.

**Suggested fix**
- Prefer computing the repo root relative to the test file location via `import.meta.url` (or centralize it in a helper).
- If you explicitly require tests to be run from repo root, enforce it with a small invariant check at test startup.

---

### P2 — `sse-backpressure.test.js` exercises the “close before drain” path but does not test “drain resolves backpressure”

**Where**
- `tests/services/api/sse-backpressure.test.js`

**What’s wrong**
- `res.write()` always returns `false` and the test closes immediately.
- This verifies that the responder handles “closed while backpressured,” but not that it correctly waits for and resumes on `drain`.

**Suggested fix**
- Add a second backpressure scenario:
  - first `write()` returns `false`,
  - then emit `drain`,
  - assert the send completes successfully.

---

## Coverage Gaps Worth Adding

This sweep is intentionally limited to the listed files, but based on what these tests currently do and do not assert, there are a few high-value additions:

1. **API `/search` contract tests**:
   - assert `status === 200` and validate `body.ok === true` consistently across all “happy path” tests.
   - validate presence of expected schema fields (e.g., `result.code` array, score fields if included, stable `repoId`).
2. **API streaming tests**:
   - parse actual SSE events, assert correct framing (`\n\n` or `\r\n\r\n`), and validate event ordering.
   - add a test for client disconnect mid-stream that verifies server cancellation behavior (or at least that it stops emitting and closes resources).
3. **MCP tool schema compliance**:
   - add schema assertions on `tools/list` tool definitions (inputs/outputs) and validate that `tools/call` responses conform to JSON schema (not just parseable JSON).
4. **MCP search filtering correctness**:
   - assert filter predicates, not “result count differs.”
   - test at least one filter from each major filter family: type, riskTag, repoPath/allowed roots, time-based if supported.

---

## Test Timing and Tiering Framework (Process Proposal)

The service tests are a prime example of why you want **timing instrumentation** and **explicit tiering**. Below is a concrete process that fits this repo’s style (Node scripts as tests) while keeping overhead low.

### 1) Introduce a test manifest with tier + budgets

Create a single manifest (e.g., `tests/manifest.json` or `tests/manifest.mjs`) that maps each test script to:

- `tier`: one of `unit | integration | e2e | perf`
- `budgetMs`: expected max runtime under CI conditions
- `tags`: optional (`api`, `mcp`, `indexing`, `sqlite`, `slow`, `network`)

Example entry:

```json
{
  "tests/services/api/search-happy-path.test.js": { "tier": "integration", "budgetMs": 15000, "tags": ["api", "index"] },
  "tests/services/mcp/tool-build-index-progress.test.js": { "tier": "e2e", "budgetMs": 60000, "tags": ["mcp", "index", "slow"] }
}
```

### 2) Record durations for every test invocation into a ledger

In the test runner (likely `tests/run.js` or `tests/all.js`), for each child process:

- record `start = performance.now()`
- capture `exitCode`
- record `durationMs`
- append a JSON line into `tests/.cache/test-times.jsonl`:

```jsonl
{"ts":"2026-01-21T00:00:00Z","test":"tests/services/api/search-happy-path.test.js","tier":"integration","durationMs":8231,"exitCode":0}
```

This creates an auditable time series that can be summarized into:

- last-run times
- rolling median / p95 by test
- total time by tier

### 3) Use the ledger to enforce tier budgets and prevent slow creep

Add a `tools/test-report.js` (or similar) that:

- loads the manifest
- reads the timing ledger
- computes per-test and per-tier stats

Then define CI policies:

- PR CI runs `tier <= integration` with an overall cap (e.g., 5–8 minutes).
- Nightly runs `tier <= e2e`.
- Perf suite runs on demand.

Add guardrails:

- If a `unit` or `integration` test exceeds `budgetMs` by > X%, fail CI with a clear message.
- Keep a “known slow” allowlist that must be explicitly acknowledged in the manifest.

### 4) Reduce redundant index builds in integration tests (without sacrificing correctness)

For `tests/services/api/*` specifically:

- Prefer a shared “fixture index build” per run:
  - one process builds the fixture index once
  - tests start servers against that index in read-only mode
- Keep at least one end-to-end test that validates the build itself (separately tiered).

This approach keeps correctness while dramatically reducing runtime.

### 5) Make tier selection explicit and developer-friendly

Add scripts:

- `npm test` → smoke/unit only
- `npm run test:integration` → unit + integration
- `npm run test:e2e` → full

And add environment controls:

- `PAIROFCLEATS_TEST_TIER=integration`
- `PAIROFCLEATS_TEST_MATCH=services/api` (substring match)

This makes it easy for contributors to run just service tests locally.

---

## Quick Action Checklist

If you want a minimal set of changes that will improve reliability without changing core behavior:

1. Add request timeouts to API service tests (or to the shared request helper) to prevent hangs.
2. Strengthen `search-stream-abort.test.js` to assert it actually received a real SSE frame (status/content-type + minimal parse).
3. Fix MCP filter tests to assert predicate correctness (not `hits.length` differences).
4. Normalize `chunk_meta.meta.json` part paths in `setup-index-detection.js` to avoid OS-dependent separators.
5. Add a test timing ledger + tiering manifest to keep CI fast and prevent slow drift.

