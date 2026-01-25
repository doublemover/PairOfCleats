# Codebase Static Review Findings — Pass 10 (Tests: Setup + Shards + Smoke Runners)

> Scope: **test scripts** listed in the request (setup, shard planning/merging, minified/binary skipping, and the smoke orchestrators).  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness risks, portability problems, missing coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

- `tests/setup.js`
- `tests/shard-merge.js`
- `tests/shard-plan.js`
- `tests/shard-progress-determinism.js`
- `tests/skip-minified-binary.js`
- `tests/smoke-embeddings.js`
- `tests/smoke-retrieval.js`
- `tests/smoke-section1.js`
- `tests/smoke-services.js`
- `tests/smoke-sqlite.js`
- `tests/smoke-utils.js`
- `tests/smoke-workers.js`
- `tests/smoke.js`

---

## Executive Summary

These tests provide important end-to-end guardrails for several risk-prone areas: **setup idempotency**, **sharded indexing equivalence**, **shard planning determinism**, **progress event determinism**, **binary/minified skipping correctness**, and a set of **smoke suites** that stitch together higher-value integration tests (retrieval, embeddings, workers, services, SQLite).

The main gaps are not about intent, but about **operational reliability and drift resistance**:

1. **Hang risk (P0):** Most scripts use `spawnSync(...)` with no timeouts. If `build_index.js`, `search.js`, or a service test deadlocks, CI can hang indefinitely.
2. **Format/profile drift risk (P0):** `tests/smoke.js` hardcodes artifact filenames and SQLite table expectations that will not remain correct as artifact formats evolve (JSONL/pieces) and as index profiles like **vector-only** become first-class.
3. **Progress determinism assertions are potentially over‑strict (P1):** `tests/shard-progress-determinism.js` assumes `fileIndex` is strictly increasing and 1‑based; that will fail if `fileIndex` is 0‑based or if the logger emits multiple events per file.
4. **“Skipped sample” assertions may be flaky (P1):** `tests/skip-minified-binary.js` asserts on `skipped.sample` entries; if sampling is ever randomized or truncated, this becomes non-deterministic.
5. **Smoke orchestration is useful but under-instrumented (P1):** wrappers clean only a subset of caches and do not capture per-test timing or structured outputs, making it harder to enforce suite budgets or debug failures.

This document enumerates specific issues and concrete refactoring suggestions, including a **durations ledger + CI tiering process** to keep the suite fast and dependable.

---

## High-Priority Findings

### P0 — Smoke and shard integration scripts can hang indefinitely (no timeouts on subprocesses)

**Where**
- `tests/shard-merge.js` (`spawnSync` for `build_index.js` with no timeout)
- `tests/shard-progress-determinism.js` (`spawnSync` for `build_index.js` with no timeout)
- `tests/skip-minified-binary.js` (`spawnSync` for `build_index.js` with no timeout)
- `tests/smoke-retrieval.js` (`spawnSync` for `build_index.js` and `search.js` with no timeout)
- `tests/smoke-utils.js` (`runNode` uses `spawnSync` with no timeout)
- All smoke orchestrators: `tests/smoke-embeddings.js`, `tests/smoke-section1.js`, `tests/smoke-services.js`, `tests/smoke-sqlite.js`, `tests/smoke-workers.js` (they delegate to `smoke-utils.runNode`)

**What’s wrong**
- If a subprocess enters a deadlock (worker pool stall, SQLite lock, I/O starvation, infinite loop), `spawnSync` will block forever.
- Because these are often “smoke / integration” tests, they are *exactly* the ones most likely to encounter hung processes under CI resource contention.

**Why it matters**
- Hung CI is higher cost than a failing test: it blocks merges, consumes runner time, and typically yields poor diagnostics.

**Suggested fix**
- Introduce a **default per-test timeout** in `tests/smoke-utils.js#runNode(...)`:
  - Use `spawnSync(..., { timeout: <ms>, killSignal: 'SIGKILL' })`.
  - Allow per-test overrides for genuinely long runs (`options.timeout`), but enforce a sane default (e.g., 2–5 minutes for smoke, 10–20 minutes for e2e indexing).
- For scripts that call `spawnSync` directly (`shard-merge`, `shard-progress-determinism`, `skip-minified-binary`, `smoke-retrieval`), either:
  1) refactor them to call `smoke-utils.runNode` so they inherit timeouts and common behavior, or  
  2) add explicit `timeout` in those `spawnSync` calls.

**Additional improvement**
- When a timeout triggers, capture and print a short “last N lines” of stdout/stderr if possible (see “Diagnostics” recommendations below).

---

### P0 — `tests/smoke.js` hardcodes artifact expectations and will drift as formats/profiles evolve

**Where**
- `tests/smoke.js`

**What’s wrong**
1. **Hard-coded artifact filenames**
   - The script checks for `chunk_meta.json`, `token_postings.json`, `phrase_ngrams.json`, `chargram_postings.json`, `minhash_signatures.json`.
   - The codebase already supports multiple artifact formats (e.g., JSONL and piece manifests); this script does not account for those alternatives.
2. **Index profile blindness (vector-only / sparse-disabled)**
   - A vector-only index (or any profile that intentionally omits sparse postings) will appear “broken” to this script.
3. **SQLite table expectations ignore config/profile**
   - Even when phrase ngrams or chargrams are disabled by config, `tests/smoke.js` still expects `phrase_*` and `chargram_*` tables.
   - Any future “sparse disabled” mode will trip these checks.

**Why it matters**
- This file is positioned as a “verify the environment/index” script. If it produces false failures/warnings, it trains users to ignore it and undermines trust.

**Suggested fix**
- Make `tests/smoke.js` **artifact-loader aware**:
  - Prefer asking the system “what exists / what’s required” rather than hardcoding.
  - Concretely:
    - Detect artifact presence via loaders (the same way the retrieval pipeline does), or
    - Read an `index_state.json` profile marker and enforce the profile’s expected artifact contract (sparse vs vector-only vs sqlite-only).
- Make SQLite table checks conditional on the same config values used to decide whether to build those tables/artifacts.

**Practical acceptance criteria**
- `tests/smoke.js --require-index` should pass for:
  - classic sparse+minhash+chargram builds,
  - chargram/phrase disabled builds,
  - vector-only builds (once implemented), and
  - sqlite-only builds (if supported),
  without requiring manual edits.

---

## Medium-Priority Findings

### P1 — `tests/shard-progress-determinism.js` likely assumes a specific indexing convention (1-based, single event per file)

**Where**
- `tests/shard-progress-determinism.js`

**What’s wrong**
- `lastIndex` is initialized to `0`, and the test requires `fileIndex > lastIndex` (strictly increasing).
  - If `fileIndex` is 0-based (a common convention), the first event would be `0` and would fail immediately.
- The test also disallows repeated `fileIndex` values:
  - If the logging layer emits multiple progress events per file (e.g., start/end, multiple stages), strict monotonicity will fail even if mapping is correct.

**Suggested fix**
- Make the test assert the **real invariant** you care about:
  - “`fileIndex → file` mapping is stable” and “fileIndex values are non-decreasing” (allow equality) **or**
  - “there is exactly one `file-progress` event per file and fileIndex is 1-based” (but then document this as part of the progress-event contract).
- If the contract is intended to be 1-based and single-shot, encode that explicitly in the build/progress docs and ensure the emitter enforces it.

**Also consider**
- Parse progress events from **both** `stdout` and `stderr`, or require that `--progress jsonl` always routes to one stream consistently.

---

### P1 — `tests/skip-minified-binary.js` relies on `skipped.sample`, which can become non-deterministic if sampling changes

**Where**
- `tests/skip-minified-binary.js`

**What’s wrong**
- The test asserts that `.filelists.json` contains:
  - `fileLists.skipped.sample` as an array, and
  - sample entries include the minified and binary files with reasons `minified` and `binary`.
- If the `.filelists.json` implementation ever:
  - randomizes sampling,
  - caps sample size (even for small repos),
  - or changes the sample format,
  this test can start failing intermittently or for “correct” behavior.

**Suggested fix**
- Prefer asserting on a **non-sampled** source of truth:
  - `metrics.files.skippedByReason` is already checked and is a better “stable aggregate invariant”.
- If you still want an example payload:
  - force sampling determinism (sort by path and take first N), or
  - set sample size to “all” when total skipped count is small.

**Minor correctness issue**

---

### P1 — Smoke wrappers don’t fully isolate cache roots and may leave residue across runs

**Where**
- `tests/smoke-embeddings.js`
- `tests/smoke-section1.js`
- `tests/smoke-services.js`
- `tests/smoke-sqlite.js`
- `tests/smoke-workers.js`

**What’s wrong**
- These orchestrators delete a small list of cache directories, but they do not enforce that child tests:
  - use only those cache roots, or
  - are configured to write into those directories.
- If a child test changes its cache naming, or writes to a default cache location, these wrappers stop cleaning up properly and can cross-contaminate other runs.

**Suggested fix**
- Standardize smoke execution around a **single “smoke run cache root”**:
  - Set `PAIROFCLEATS_CACHE_ROOT` to a temp root for the duration of the smoke suite and ensure all child processes inherit it.
  - Then cleanup becomes: `rm -rf <suiteRoot>` once.
- Extend `smoke-utils.runNode(...)` to accept `env` and enforce it consistently (so orchestrators can pass the same env to all children).

---

## Lower-Priority Findings / Quality Improvements

### P2 — `tests/setup.js` is brittle to logging changes; `--json` must be “JSON only”

**Where**
- `tests/setup.js`

**What’s wrong**
- The test checks for the substring `'Setup complete.'` which is a human-facing string and likely to churn.
- The `--json` parse assumes `stdout` is valid JSON; any incidental logs to stdout would break this (and it’s common for tools to drift toward printing both).

**Suggested fix**
- Treat `--json` as a “machine output mode” contract:
  - stdout must be pure JSON,
  - all logs must go to stderr, or be suppressed.
- Validate the `steps` payload more strongly:
  - assert expected step keys exist,
  - assert skipped steps appear when `--skip-*` flags are passed.

---

### P2 — `tests/shard-merge.js` comparisons are extremely strict and may fail for “benign re-ordering”

**Where**
- `tests/shard-merge.js`

**What’s wrong**
- It asserts `JSON.stringify(baseline.chunks) === JSON.stringify(sharded.chunks)` and similarly for postings/vocab.
- If the system ever changes to:
  - sort chunks differently (but equivalently),
  - reorder vocab deterministically but with a different policy,
  the test fails even if the merge is still correct.

**Suggested fix**
- Decide what invariants actually matter:
  - If you truly require byte-for-byte determinism, keep this test (it’s valuable).
  - If you only require semantic equivalence:
    - normalize chunk lists (sort by `chunkId`),
    - normalize vocab/postings ordering,
    - then deep-compare normalized forms.

---

### P2 — `tests/shard-plan.js` “Windows path simulation” is imprecise on non-Windows platforms

**Where**
- `tests/shard-plan.js`

**What’s wrong**
- It constructs `abs: path.join('C:\\repo', rel)`. On POSIX, this yields mixed separators and does not behave like a true Windows path.
- If shard planning logic ever uses `abs` in path parsing, this test may not reflect either platform’s reality.

**Suggested fix**
- Use `path.win32.join('C:\\repo', rel)` if the goal is explicitly “simulate Windows behavior deterministically”, or
- use `path.posix.join('/repo', rel)` if you only need a stable placeholder.

---

## Diagnostics Improvements for Smoke/Shard Tests

These scripts are often the ones that fail first when performance or correctness regresses. Improving diagnostics pays off quickly.

**Recommended enhancements (without changing semantics)**
- In `smoke-utils.runNode(...)`:
  - Add an option to capture `stdout/stderr` (instead of always `inherit`) and include a snippet in thrown errors.
  - Preserve current default behavior for interactive debugging, but allow CI to run with capture.
- Standardize failure messages to include:
  - script path,
  - exit code,
  - cache root used,
  - repo root (if applicable),
  - and a pointer to any emitted debug artifacts.

---

## Test Duration Ledger + CI Tiering Process (Requested)

This is the “system-level” process to keep testing scalable as the suite grows.

### 1) Add a per-test timing wrapper (lowest-friction)

**Where to implement**
- Start in `tests/smoke-utils.js#runNode(...)` (because smoke orchestrators already go through it).
- Optionally, also add it to other direct `spawnSync` calls in:
  - `tests/shard-merge.js`
  - `tests/shard-progress-determinism.js`
  - `tests/skip-minified-binary.js`
  - `tests/smoke-retrieval.js`

**How it works**
- Before running a subprocess:
  - record `t0 = process.hrtime.bigint()`
- After it exits:
  - record `t1`
  - compute `durationMs = Number(t1 - t0) / 1e6`
- Append a record to a JSONL file (per run), e.g.:
  - `tests/.cache/test-timings.jsonl`
  - with `{ name, script, durationMs, exitCode, startedAt, nodeVersion, platform }`

**Why JSONL**
- Robust to partial writes; easy to append; simple to aggregate.

### 2) Aggregate and gate on p50/p95 and suite budgets

Add a small aggregator tool (could live under `tools/` or `tests/`) that:
- reads all timing records,
- produces:
  - per-test p50/p95,
  - total runtime per tier,
  - top N slowest tests.

Store a baseline snapshot in-repo (or in CI artifacts) and compare:
- Fail PRs only on egregious regressions (e.g., +30% p95 for smoke-tier tests, or +60s total smoke tier), otherwise warn.

### 3) Define explicit tiers (smoke vs integration vs e2e vs perf)

Create an explicit manifest describing tiers, for example:
- `tests/tiers.json` or `tests/manifest.json`

Example tiers:
- **Tier 0: unit-fast** — no repo builds, no services, no downloads (goal: < 60s)
- **Tier 1: smoke** — small fixture repo builds, no network, no large embeddings (goal: < 5–8 min)
- **Tier 2: integration** — SQLite, service endpoints, multi-step pipelines (goal: < 15–25 min)
- **Tier 3: e2e** — full indexing of medium repos, federation scenarios (nightly)
- **Tier 4: perf** — throughput benchmarks (never in PR CI; scheduled)

Wire CI jobs to tiers:
- PRs: Tier 0 + Tier 1
- Main branch: Tier 0 + Tier 1 + Tier 2
- Nightly: Tier 3 + Tier 4

### 4) Use timings to select “reasonable” e2e coverage

Once durations exist, you can decide:
- How many repos to include in e2e runs,
- Which modes (code/prose) to include,
- Which optional dependencies to enable in CI (SQLite extension, onnx).

A common approach:
- Maintain a target runtime budget (e.g., 20 minutes for “integration CI”).
- Select the largest set of tests that fit in budget, prioritized by regression detection value.

---

## Suggested Follow-up Test Coverage

These are new tests that are directly motivated by the issues in this sweep:

1. **Timeout enforcement test (smoke-utils)**
   - A tiny script that intentionally sleeps forever; ensure `runNode` times out and the suite fails fast with a clear message.
2. **Smoke verification for alternative artifact formats**
   - Once JSONL/pieces becomes default (or is already possible), add a test mode where indexing emits JSONL and confirm `tests/smoke.js` still recognizes success.
3. **Vector-only profile verification**
   - Once vector-only indexing is supported, add a smoke test that validates “sparse artifacts intentionally missing” does not fail verification scripts.

---

## Summary of Recommended Actions

**Immediate (P0/P1)**
- Add subprocess timeouts (centralized in `tests/smoke-utils.js`).
- Update `tests/smoke.js` to be format/profile aware (avoid hardcoded artifact and table lists).
- Relax or document invariants in `tests/shard-progress-determinism.js` (0-based vs 1-based; repeated events).
- Make `skip-minified-binary` assert on stable aggregates rather than `sample` lists.

**Next (P1/P2)**
- Standardize cache-root isolation for smoke suites.
- Improve smoke runner diagnostics (capture mode + better error context).
- Implement the test duration ledger + tiered CI policy.

---
