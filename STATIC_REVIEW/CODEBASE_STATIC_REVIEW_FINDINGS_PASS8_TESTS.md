# Codebase Static Review Findings — Pass 8 (Tests Suite)

> Scope: **tests/** scripts listed in the request (unit + integration/e2e scripts).  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness risks, portability problems, missing test coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

- `tests/all.js`
- `tests/api-server-stream.js`
- `tests/artifact-bak-recovery.js`
- `tests/artifact-formats.js`
- `tests/artifact-size-guardrails.js`
- `tests/artifacts/file-meta.test.js`
- `tests/artifacts/token-mode.test.js`
- `tests/backend-policy.js`
- `tests/bench-language-lock-semantics.js`
- `tests/bench-language-lock.js`
- `tests/bench-language-process-import.js`
- `tests/bench-language-progress-parse.js`
- `tests/bench-language-repos.js`
- `tests/bench-micro-baseline.js`
- `tests/bench-progress-format.js`
- `tests/build-embeddings-cache.js`
- `tests/build-index-all.js`
- `tests/build-runtime/content-hash.test.js`
- `tests/build-runtime/stage-overrides.test.js`
- `tests/cache-gc.js`
- `tests/cache-lru.js`
- `tests/capabilities-report.js`
- `tests/chargram-guardrails.js`
- `tests/chunk-id-backend-parity.js`
- `tests/chunk-meta-jsonl-cleanup.js`
- `tests/chunking-guardrails.js`
- `tests/chunking-limits.js`
- `tests/chunking-sql-lua.js`
- `tests/chunking-yaml.js`
- `tests/chunking/json.test.js`
- `tests/chunking/limits.test.js`
- `tests/chunking/yaml.test.js`
- `tests/churn-filter.js`
- `tests/clean-artifacts.js`

---

## Executive Summary

The test suite is valuable (it covers artifact recovery, format preference logic, shard/size guardrails, backend policy selection, chunking edge cases, and several end-to-end flows), but it is currently held back by:

1. **No central test manifest or tiering**, so *slow/e2e* tests live alongside *unit* tests with no systematic “what runs where” contract.
2. **Timing/throughput blind spots**: there is no built-in, continuously-updated “test duration ledger,” which makes it hard to keep CI fast and reliable.
3. **A few tests encode questionable semantics** (most notably lock staleness) or don’t actually validate the behavior the failure message claims to validate (chargram guardrails).
4. **Flakiness vectors** (mtime comparisons, future mtimes, extremely short TTL sleeps, JSON parsing from stdout where tools may still log).
5. **Portability assumptions** (POSIX signals, CRLF vs LF SSE framing, optional dependencies like `better-sqlite3` and `git` used without consistent capability gating).
6. **Determinism assumptions** that are not enforced in the tests (e.g., selecting the “first” cache file from `readdirSync` without sorting).

The remainder of this document enumerates concrete issues and targeted fixes, plus a detailed proposal for **test timing measurement and suite partitioning**.

---

## High-Priority Findings

### P0 — Lock “staleness” semantics are unsafe, and the test currently reinforces the risky behavior

**Where**
- `tests/bench-language-lock-semantics.js` (lines ~14–28)

**What’s wrong**
- The test constructs a “stale” lock that includes `pid: process.pid` (a live process) but an old `startedAt`, and expects the lock to be cleared:
  - `JSON.stringify({ pid: process.pid, startedAt: staleStartedAt })`
  - then asserts `staleResult.ok === true` and `staleResult.cleared === true`
- This implicitly endorses a staleness rule that treats **age alone** as sufficient to clear a lock, even if the lock owner is still alive.
- In real runs, any indexing run longer than `lockStaleMs` could have its lock cleared while still active, enabling **concurrent indexers** and causing corruption/races.

**Why it matters**
- Lock semantics are one of the few guards preventing concurrent mutation of on-disk artifacts/indexes. A stale policy that ignores liveness can become a data-corruption generator under load, large repos, slow disks, or heavily contended CI.

**Suggested fix**
- Change test semantics (and likely the lock implementation) so “stale” means:
  - *either* lock age > stale threshold **AND** pid is not alive (or unknown),
  - *or* lock file is malformed / unreadable and older than threshold,
  - *or* “heartbeat/mtime” is old (if you implement heartbeats).
- Update the test to represent a truly dead lock by:
  - using a pid that is known-dead (e.g., very large, or pid from a child process you start then immediately exit), or
  - omitting pid entirely and relying on `mtime`/`startedAt`.

**Additional coverage to add**
- “Long-running lock remains valid”: create lock with live pid and startedAt older than stale threshold and assert it **is not cleared**.
- “Heartbeat refresh”: if a heartbeat is implemented, verify that heartbeat prevents stale clearing.

---

### P0 — SSE parsing in the API server streaming test is brittle and may fail under CRLF framing or multiline data

**Where**
- `tests/api-server-stream.js` (lines ~59–117)

**What’s wrong**
- The stream parser searches for event boundaries using `buffer.indexOf('\n\n')` (line ~97). SSE boundaries may arrive as `\r\n\r\n`. If so, `'\n\n'` is not guaranteed to appear contiguously, and the parser may never flush blocks.
- The `parseSse()` method concatenates multiline `data:` fields *without inserting newlines* (line ~69). The SSE spec concatenates with `\n`. While you likely emit JSON in one line today, this is a correctness trap for future changes (pretty-printed JSON or chunked JSON lines).
- Uses `host: serverInfo.host` (line ~87). If the server reports `{ host: undefined }` or omits host, Node will default in ways that vary by version. This is avoidable.

**Why it matters**
- This is a “canary” test for streaming APIs. If it is flaky, it will either be skipped or ignored—undermining confidence in the API surface.

**Suggested fix**
- Use a robust boundary finder that accepts both `\n\n` and `\r\n\r\n`, e.g. scan for `\n\n` *or* normalize `\r\n` to `\n` first.
- In `parseSse()`, join multiple `data:` lines using `\n` per SSE rules.
- Default the request host to `127.0.0.1` if `serverInfo.host` is absent.

**Additional coverage**
- Add one fixture where server emits CRLF boundaries (if your server supports toggling), or emulate by inserting `\r` in a synthetic stream parse test.

---

### P0 — A number of integration tests are “heavy” but not explicitly tiered or time-budgeted

**Where (examples)**
- `tests/artifact-size-guardrails.js` (multiple full index builds)
- `tests/build-index-all.js` (full index build of mode `all`)
- `tests/chunk-id-backend-parity.js` (full sqlite build + sqlite DB readback)
- `tests/churn-filter.js` (git init + commits + build_index + multiple searches)
- `tests/api-server-stream.js` (build_index + start server + SSE interactions)

**What’s wrong**
- These are effectively end-to-end validation tests. Without an explicit tiering mechanism, they can:
  - lengthen PR CI unpredictably,
  - become “the reason tests are slow,”
  - get disabled, or
  - run inconsistently.

**Why it matters**
- The project’s credibility depends on tests that run reliably and quickly in the default path (PRs), while still having deeper coverage available (nightly or manually).

**Suggested fix**
- Introduce an explicit test tiering + timing system (see **Test Timing & Tiering Framework** section below).

---

## Medium-Priority Findings

### P1 — Artifact format preference test uses **future mtimes**, which can be unreliable on some filesystems and environments

**Where**
- `tests/artifact-formats.js` (line ~40: `freshTime = new Date(Date.now() + 5000)`)

**What’s wrong**
- Writing a file and then setting mtime into the future (`now + 5s`) can be:
  - blocked,
  - clamped to “now,” or
  - behave inconsistently on certain FS/CI setups.
- This risks a flaky test that fails depending on host settings and filesystem semantics.

**Suggested fix**
- Avoid future mtimes. Instead:
  - set “stale” older by a meaningful margin (e.g., `now - 60s`),
  - leave “fresh” at current mtime, or set it to `now - 1s` while stale is `now - 60s`.

**Additional coverage**
- If the loader chooses by “prefer format A over B” rather than “prefer newest,” encode that explicitly rather than relying on mtime (which is a leaky proxy).

---

### P1 — Embedding cache reuse test uses fragile file selection and an overly strict rewrite detector

**Where**
- `tests/build-embeddings-cache.js`

**What’s wrong**
1. The test selects `cacheFiles[0]` from `fs.readdirSync(cacheDir)` without sorting (line ~53). Directory iteration order is not guaranteed to be stable across filesystems and platforms.
2. It asserts **mtime equality** to detect “no rewrite” (lines ~58–62). This is strict:
   - A cache writer could rewrite identical content (still a waste) and the test would correctly fail—but…
   - Atomic writing often changes mtime even when content is unchanged; you might want to detect “content unchanged” rather than “mtime unchanged.”
   - Some systems have coarse mtime resolution; repeated operations might show the same mtime and hide rewrites.

**Suggested fix**
- Sort `cacheFiles` or pick a file by pattern (e.g., contains a known key prefix if one exists).
- Prefer content-hash equality or a “writer reported cache hit” signal rather than raw mtime equality.
  - If you keep mtime-based detection, use a two-file approach: check that **no new file** is created and that size/hash remains identical.

**Additional coverage**
- Assert a stable cache key across runs by checking that the same filename exists after the second run.

---

### P1 — `chargram-guardrails.js` does not truly validate “field tokens only” behavior

**Where**
- `tests/chargram-guardrails.js` (lines ~31–46)

**What’s wrong**
- The second half of the test builds chargrams from the literal token array `['field']` and then asserts it does not contain chargrams for `'short'`.
- This can never fail (unless tri() behaves unexpectedly), because `'short'` was never passed into `buildChargramsFromTokens()` for that check.
- `fieldPayload` is computed (lines ~31–36) but never used, suggesting the test intention drifted.

**Suggested fix**
- Decide which behavior is intended:
  - If you want to verify that when building postings, field chargrams are derived from **field tokens only**, the test needs to invoke the pipeline that chooses between chunk tokens and field tokens (not just `buildChargramsFromTokens()` directly).
  - Alternatively, rename the test to reflect what it *does* check (basic chargram generation + long-token guardrail).

**Additional coverage**
- Add a regression fixture for `chargramSource` modes if those exist (`full`, `fields`, etc.), verifying end-to-end token selection.

---

### P1 — Several tests parse JSON from stdout of spawned tools; any stdout logging will break them

**Where (examples)**
- `tests/bench-language-repos.js` (`spawnSync(... '--json')` then `JSON.parse(result.stdout)`)
- `tests/bench-language-lock.js` parses JSON from `bench-language-repos.js`
- `tests/cache-gc.js` parses JSON output from `tools/cache-gc.js`
- `tests/churn-filter.js` parses JSON from `search.js --json`

**What’s wrong**
- These tests assume that `--json` implies **strict JSON-only stdout**. If any command logs to stdout (instead of stderr), JSON parsing fails and the test collapses.
- This is a good contract to enforce, but it should be **explicitly tested** and supported consistently by all commands.

**Suggested fix**
- Treat “JSON output mode” as a hard interface contract:
  - All logs go to stderr.
  - Stdout is reserved for JSON payload only.
- Add a small contract test:
  - run each tool with `--json` and assert stdout is valid JSON and stderr contains logs if any.

---

### P1 — Optional dependency gating is inconsistent across tests

**Where**
- `tests/chunk-id-backend-parity.js` imports `better-sqlite3` unconditionally.
- `tests/churn-filter.js` gates on `git --version` before proceeding (good pattern).
- Some integration tests depend on sqlite/lmdb backends, wasm availability, etc., but do not consistently detect capability.

**What’s wrong**
- On environments where `better-sqlite3` is not installed (or cannot be built), tests fail at import time rather than cleanly skipping with a reason.

**Suggested fix**
- Standardize capability gating:
  - Use a shared helper that checks `getCapabilities()` (or equivalent) and returns `{ok, reason}`.
  - For optional deps, use dynamic import with try/catch and print `[skip]` messages consistently.

---

## Lower-Priority / Hygiene Findings

### P2 — `tests/all.js` appears to run only a subset of the test suite

**Where**
- `tests/all.js`

**What’s wrong**
- It runs `tests/script-coverage.js` (unless skipped) and a single perf bench script (unless skipped). It does not enumerate/execute most of the individual scripts in `tests/`.
- That may be intentional (if `script-coverage.js` orchestrates all scripts), but as written, it is not obvious. This is “test harness ambiguity.”

**Suggested fix**
- Make the contract explicit:
  - `tests/all.js` should clearly state that `script-coverage.js` runs the suite (if true), or
  - it should maintain an explicit manifest of test entrypoints.

---

### P2 — Time-based tests use very small sleeps; may be slow/variable in CI

**Where**
- `tests/cache-lru.js` uses `ttlMs: 10` and `setTimeout(..., 25)`

**Why it matters**
- CI noise and timer resolution can cause occasional flakes. While 25ms is probably fine, consider widening the margin (e.g., TTL 50ms and wait 150ms) if flakiness appears.

---

### P2 — Some tests rely on directory mtimes, but the underlying tools might use file mtimes

**Where**
- `tests/cache-gc.js` uses `fsPromises.utimes(repoPath, ...)` on the directory, not on the file.

**Why it matters**
- If the GC tool uses file mtimes or a composite “last used” heuristic, the test may become inaccurate.

**Suggested fix**
- Set mtimes on both the directory and its contained file(s), or align with the tool’s actual “age” definition.

---

## Test Timing & Tiering Framework (Process Spec)

The goal is to make test execution **auditable, fast by default, and scalable** as the project grows—especially given many tests are effectively “indexer e2e”.

### 1) Introduce a test manifest with explicit tiers and capability gates

Add `tests/manifest.json` (or `tests/manifest.js`) containing entries like:

```json
[
  {
    "id": "unit-cache-lru",
    "path": "tests/cache-lru.js",
    "tier": "unit",
    "tags": ["cache"],
    "needs": [],
    "timeoutMs": 2000
  },
  {
    "id": "e2e-api-server-stream",
    "path": "tests/api-server-stream.js",
    "tier": "e2e",
    "tags": ["api", "streaming"],
    "needs": ["sqlite", "stub-embeddings"],
    "timeoutMs": 120000
  },
  {
    "id": "e2e-churn-filter",
    "path": "tests/churn-filter.js",
    "tier": "e2e",
    "tags": ["git", "search"],
    "needs": ["git"],
    "timeoutMs": 180000
  }
]
```

**Tier definitions (recommended)**
- `unit`: pure functions, no child processes, no disk-heavy work; target < 2s each.
- `integration`: touches filesystem, spawns helpers, but no full index builds; target < 15s each.
- `e2e`: builds indexes, runs servers, multi-step workflows; target < 2–3 minutes each.
- `bench`: performance harnesses; **not part of CI by default**.

**Needs/capability gates**
- `git`, `better-sqlite3`, `sqlite`, `lmdb`, `wasm-tree-sitter`, `network`, etc.
- Runner should evaluate gates using shared detection (e.g., `src/shared/capabilities.js`) and either:
  - skip with a structured record, or
  - fail fast when the tier requires it (e.g., in nightly e2e you may require sqlite).

---

### 2) Add a single test runner that records per-test duration and outputs a timing ledger

Create `tests/run.js` (or `tools/test-runner.js`) that:

- Loads the manifest.
- Filters by tier(s):
  - PR CI: `unit + integration` by default.
  - Nightly: `unit + integration + e2e`.
  - Optional: `--tier e2e --id e2e-api-server-stream`
- Runs each test in a **separate Node process** (consistent with current style), capturing:
  - start/end timestamps,
  - exit code,
  - stdout/stderr sizes (optional),
  - skip reasons.
- Writes `tests/.cache/test-timings.jsonl` (append-only) where each line is:

```json
{
  "ts":"2026-01-20T00:00:00.000Z",
  "id":"e2e-api-server-stream",
  "path":"tests/api-server-stream.js",
  "tier":"e2e",
  "status":"pass",
  "durationMs": 73412,
  "exitCode": 0,
  "needs": ["sqlite","stub-embeddings"]
}
```

**Why JSONL**
- Streaming-friendly, easy to append, easy to ingest into dashboards, easy to diff.

---

### 3) Use timing data to enforce budgets and prevent CI regressions

Once timing data exists, use it:

- **Per-tier total budget**
  - unit: <= 60s
  - integration: <= 5–7 minutes
  - e2e: <= 20–30 minutes (nightly)
- **Per-test budget**
  - unit: <= 2s
  - integration: <= 30s
  - e2e: <= 3–5 minutes

Enforcement strategy:
- PR CI:
  - hard fail if a unit test exceeds a strict threshold (indicates runaway).
  - warn (not fail) for integration tests creeping up, but report top 10 slowest.
- Nightly:
  - record durations and trend them. Fail if there is a “massive regression” threshold (e.g., +50% total or +100% for a single test).

---

### 4) Report slow tests and “why” they are slow (resource attribution)

Add optional instrumentation around spawned commands:
- For e2e tests that run `build_index.js` multiple times, record:
  - index stage(s) run,
  - number of files indexed,
  - artifact mode,
  - whether wasm parsers loaded,
  - whether sqlite/lmdb used,
  - cache hit/miss (if detectable).

This can be done without changing the indexer by:
- passing `--json` / `--telemetry` flags if available, or
- capturing stdout/stderr and extracting structured “progress events” (you already have progress event schemas).

---

### 5) CI suite composition recommendations (practical)

**PR “smoke” suite**
- unit + integration only
- no full index builds unless absolutely necessary
- run on every PR

**PR “extended” suite**
- includes a small number of e2e tests with tiny fixtures
- run on demand (label) or for release branches

**Nightly / scheduled**
- full e2e suite (including churn-filter, api-server-stream)
- optionally run on a curated set of medium repos

**Bench**
- never in CI by default
- run manually or scheduled on dedicated runners

---

## Per-File Notes & Targeted Suggestions

### `tests/bench-language-lock-semantics.js`
- Fix test to represent “stale lock” using a dead pid or no pid; add coverage that live pid is not cleared by age alone.

### `tests/api-server-stream.js`
- Make SSE parsing robust to CRLF and multiline data; default host; make shutdown cross-platform (avoid hard SIGKILL dependence).

### `tests/build-embeddings-cache.js`
- Sort `readdirSync` results; prefer content hash or “cache hit” signal over raw `mtimeMs` equality.

### `tests/chargram-guardrails.js`
- Remove unused `fieldPayload` or use it to assert integrated behavior; rewrite the “field tokens only” section to test actual selection logic.

### `tests/artifact-formats.js`
- Avoid future mtimes; make “preference” logic explicit rather than proxying through mtimes if possible.

### `tests/chunk-id-backend-parity.js`
- Gate `better-sqlite3` import and sqlite availability; ensure deterministic ordering assumptions are validated (or sort chunkIds before compare if ordering is not guaranteed).

### `tests/churn-filter.js`
- Consider gating on git capabilities (already done) plus ensure churn computation expectation is stable across platforms; classify as e2e.

### Heavy tests (`artifact-size-guardrails.js`, `build-index-all.js`, `clean-artifacts.js`, etc.)
- Mark explicitly as e2e/integration in a manifest; include time budgets; ensure they can reuse caches or fixtures to reduce cost.

---

## Suggested “Next Step” Actions (Roadmap-Style Checklist)

### Phase T1 — Establish a test manifest + runner
- [ ] Add `tests/manifest.json` with **id/path/tier/needs/timeout** for each test script in this repo.
- [ ] Implement `tests/run.js` to run manifest entries in separate processes.
- [ ] Add `--tier`, `--id`, `--tag`, and `--json` runner options.
- [ ] Add standardized skip handling: print `[skip] <reason>` and emit JSONL timing entry.

### Phase T2 — Timing ledger + budgets
- [ ] Write per-run timing entries to `tests/.cache/test-timings.jsonl`.
- [ ] Add a summarizer script: `tools/report-test-timings.js`:
  - top-N slow tests,
  - total per tier,
  - trend vs previous run (optional).
- [ ] Add CI budget rules (warning thresholds first, then hard thresholds once stable).

### Phase T3 — Harden flaky tests
- [ ] Replace future mtime usage in `tests/artifact-formats.js`.
- [ ] Robust SSE framing in `tests/api-server-stream.js`.
- [ ] Stabilize file selection + rewrite detection in `tests/build-embeddings-cache.js`.
- [ ] Rewrite `tests/chargram-guardrails.js` to test the actual behavior implied by its assertions.
- [ ] Fix lock semantics test to reflect safe lock behavior.

### Phase T4 — Capability-gated e2e suite
- [ ] Central helper `tests/helpers/capabilities.js`:
  - `needsGit()`, `needsSqlite()`, `needsBetterSqlite3()`, etc.
- [ ] Update e2e tests to skip with consistent messages when capabilities are absent.
- [ ] Ensure `--json` tools keep stdout clean; enforce via contract tests.

---

## Closing Notes

The core issue across these tests is not “lack of coverage”—it is **lack of structure**: without tiering, gating, and a timing ledger, you can’t reliably keep CI fast while still running deep correctness checks. Implementing the timing + manifest framework will pay immediate dividends: fewer flakes, faster iteration, and a clear contract about what runs when and why.
