# Codebase Static Review Findings — Pass 10 (Type Inference Tests)

> Scope: **type inference test scripts** listed in the request (provider fallbacks, LSP enrichment, cross-file inference helpers).  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness risks, portability issues, missing coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

- `tests/type-inference-clangd-provider-no-clangd.js`
- `tests/type-inference-crossfile-go.js`
- `tests/type-inference-crossfile/apply.test.js`
- `tests/type-inference-crossfile/extract.test.js`
- `tests/type-inference-crossfile/symbols.test.js`
- `tests/type-inference-lsp-enrichment.js`
- `tests/type-inference-sourcekit-provider-no-sourcekit.js`
- `tests/type-inference-typescript-provider-no-ts.js`

---

## Executive Summary

These tests cover three distinct concerns:

1. **Tooling provider “missing dependency” behavior** (clangd, sourcekit-lsp, TypeScript tooling) — ensuring the project degrades safely when external tools or optional deps are absent.
2. **Tooling-backed enrichment correctness** (clangd/sourcekit/pyright via LSP) — ensuring type inference metadata is injected into `chunk_meta` with the expected `source: "tooling"` markers and that diagnostics are retained.
3. **Cross-file inference primitives** (symbol indexing, signature extraction helpers, docmeta application/merge logic) — providing unit-level guardrails for de-dupe, confidence aggregation, and call/arg heuristics.

The intent is sound and the coverage is valuable, but there are several **high-impact reliability risks**:

- The two integration tests hardcode `chunk_meta.json` and do not robustly locate `chunk_meta` artifacts, making them fragile against format changes (jsonl, sharded pieces, etc.) and potentially incompatible with “streaming/sharded” roadmap work.
- The LSP enrichment test can accidentally run **system-installed LSP servers** (instead of the intended fixtures) because it ignores missing fixture binaries and does not prove fixture selection.
- Both integration tests may read index output paths using a config view that can differ from the one used during index build (env overrides applied only to the child process).
- Provider fallback tests assert against **log message substrings**, which is brittle and does not scale well as provider messaging evolves.

The remainder of this document lists concrete findings and suggested remediations, and ends with a practical process for **test-duration tracking + CI tiering** (smoke vs integration vs perf).

---

## High-Priority Findings

### P0 — Integration tests hardcode `chunk_meta.json` (artifact format brittleness)

**Where**
- `tests/type-inference-crossfile-go.js` (lines **151–155**, `chunk_meta.json`)
- `tests/type-inference-lsp-enrichment.js` (lines **64–68**, `chunk_meta.json`)

**What’s wrong**
- Both tests assume the chunk metadata artifact will be written as a single JSON file at `<indexDir>/chunk_meta.json`.
- The codebase already supports multiple artifact encodings elsewhere (jsonl, sharded `parts/`, etc.). Hardcoding one representation makes these tests:
  - fail when artifact formats/config defaults change, and
  - unable to validate the “streaming/sharded” pipeline direction (where `chunk_meta.json` may no longer be the canonical output).

**Why it matters**
- You will be intentionally changing artifact sharding/streaming characteristics; these tests should not become chronic red/green churn simply due to artifact layout.
- Worse: if the build writes `chunk_meta.jsonl` and **also** writes an empty/legacy `chunk_meta.json` in some fallback path, these tests could accidentally read the wrong artifact and produce **false confidence**.

**Suggested fix**
- Change these tests to locate `chunk_meta` via the index’s canonical artifact discovery mechanism (or by inspecting the piece manifest) rather than assuming a filename.
- If you want these tests to explicitly validate `chunk_meta.json` output, then make that explicit by **forcing the output format in test config** (and asserting that other formats are not present). Right now, they do not force it.

**Suggested additional coverage**
- Add one integration test variant that builds in the “sharded pieces” mode and proves the reader path can still load chunk metadata and locate inferred types.

---

### P0 — LSP enrichment test can silently fall back to system-installed tools (fixture selection not proven)

**Where**
- `tests/type-inference-lsp-enrichment.js`:
  - chmod step ignores failures (lines **32–36**)
  - PATH injection (line **44**)

**What’s wrong**
- The test intends to use the repo’s LSP fixtures in `tests/fixtures/lsp/bin` by prepending them to `PATH`.
- However:
  - the chmod loop ignores errors, so missing fixture binaries are not detected early,
  - there is no explicit assertion that the fixture binaries actually exist, and
  - there is no assertion that the indexing run used the fixture binaries (vs a system `clangd`, `sourcekit-lsp`, `pyright-langserver`).
- If fixture binaries are missing or not executable, the test may run real system tools and become **non-deterministic**, or fail for reasons unrelated to your code (missing compile DB, missing Swift toolchain, etc.).

**Why it matters**
- Tooling-backed inference tests are inherently vulnerable to environment variance; the fixture approach is the right strategy, but it must be enforced as an invariant.
- Without “fixture selection proof,” this test can be flaky across CI images and contributor machines.

**Suggested fix**
- Before launching `build_index.js`, explicitly:
  - verify each expected fixture binary exists (`fs.existsSync`) and is executable,
  - if missing, either **fail with a clear message** (“fixture missing; repo checkout incomplete”) or emit a proper **skip** (see “skip protocol” in other sweep docs).
- Add a validation step that proves the chosen executable path is the fixture path. Options:
  - check build logs for a stable “using clangd at …/tests/fixtures/…” message (better: a structured provider report),
  - or add an environment guard in the fixture binaries that prints an unmistakable marker which the test can assert.

---

### P0 — Inconsistent working directory and config view between the build step and the post-check step

**Where**
- `tests/type-inference-crossfile-go.js`:
  - build spawns with `cwd: repoRoot` (line **140**)
  - reads config via `loadUserConfig(repoRoot)` (line **149**), but does **not** mirror `PAIROFCLEATS_TEST_CONFIG` into the parent process
- `tests/type-inference-lsp-enrichment.js`:
  - build spawns without `cwd` override (lines **50–54**)
  - reads config via `loadUserConfig(repoRoot)` (line **62**), again without mirroring `PAIROFCLEATS_TEST_CONFIG`

**What’s wrong**
- The child process (build) receives `PAIROFCLEATS_TEST_CONFIG` in `env`, which may change:
  - index output directory policy,
  - artifact formats,
  - which modes are built,
  - which enrichments run.
- The parent process (test script) then calls `loadUserConfig(repoRoot)` without guaranteeing it is seeing the same effective config used by the build.
- Additionally, the LSP test does not set `cwd: repoRoot` for the build process, which can matter for tool discovery, repo-relative config, or LSP project rooting.

**Why it matters**
- This can produce **false negatives** (test looks for artifacts in a dir derived from a different config than the build used) and **false positives** (test reads an index produced with different knobs than intended).
- It also increases divergence between integration tests and “real usage,” where working-directory effects are common.

**Suggested fix**
- Make the build environment and the verification environment consistent:
  - set `process.env.PAIROFCLEATS_TEST_CONFIG` to match the child’s config before calling `loadUserConfig(...)`, or
  - avoid `loadUserConfig` entirely in these tests by determining the index directory from the build output path (preferred long-term: have the builder emit a machine-readable “index output location” record).
- Standardize integration tests to spawn `build_index.js` with `cwd: repoRoot` unless there is a deliberate reason not to.

---

## Additional Findings and Improvements

### P1 — Provider fallback tests assert log message substrings (brittle contract)

**Where**
- `tests/type-inference-clangd-provider-no-clangd.js` (line **42**)
- `tests/type-inference-sourcekit-provider-no-sourcekit.js` (line **42**)
- `tests/type-inference-typescript-provider-no-ts.js` (line **50**)

**What’s wrong**
- These tests assert fallback behavior by searching for specific substrings like:
  - `"clangd not detected"`
  - `"sourcekit-lsp not detected"`
  - `"TypeScript tooling not detected"`
- Log phrasing is not a stable API contract; small copy changes can break tests while behavior is unchanged.

**Why it matters**
- Tooling detection is one of the most frequently touched areas when adding install flows, doctor commands, or centralized policy logic. These tests should remain stable even if messaging is refined.

**Suggested fix**
- Have provider functions return a structured “availability report” in addition to `typesByChunk`, e.g.:
  - `{ available: false, reason: "not_detected" | "disabled" | "failed_to_spawn", detail: "...", typesByChunk: new Map() }`
- Tests should assert on `available === false` and `reason`, and only optionally assert that a log was emitted.

---

### P1 — Cross-file inference integration test does not strongly prove “cross-file” contribution

**Where**
- `tests/type-inference-crossfile-go.js` (assertions at lines **176–225**)

**What’s wrong**
- The test asserts the presence of `docmeta.inferredTypes.returns` entries with `source === "flow"`.
- However, this does not definitively prove *cross-file* inference executed (as opposed to:
  - declared return type extraction being copied into `inferredTypes`, or
  - a local-only flow inference pass).
- For Go/Java/Rust, return types exist in signatures, so the most useful proof is whether the system can infer *something it otherwise would not have*.

**Why it matters**
- This test could remain green even if cross-file propagation regresses (depending on how base extraction behaves for those languages).
- It also does not validate argument-aware propagation, which is the most valuable (and most fragile) cross-file primitive.

**Suggested fix**
- Turn this into an “A/B” test:
  1. Build with `typeInferenceCrossFile: false`, capture the relevant chunks’ `docmeta.inferredTypes`.
  2. Build with `typeInferenceCrossFile: true`, capture again.
  3. Assert the delta is present and attributable to cross-file inference (e.g., new inferred return type entries, or increased confidence).
- Add at least one scenario that requires cross-file reasoning, e.g.:
  - a language where the base extractor does not produce return/param types reliably,
  - or a JS/TS example where return type is `any`/unknown but callee returns a concrete type.

---

### P1 — Partial skip logic (Python availability) is invisible to CI reporting

**Where**
- `tests/type-inference-crossfile-go.js` (lines **11–23**, and **212–228**)

**What’s wrong**
- Python checks are skipped if python is missing, but this is only printed to stdout; it is not recorded as a “skip” in any structured result.

**Why it matters**
- CI can appear green while silently losing Python inference coverage, making regressions harder to catch.

**Suggested fix**
- Split the Python portion into a separate test script that:
  - exits with a dedicated “SKIP” exit code if python is unavailable, and
  - is then reported as “SKIP” by the test runner.
- Alternatively, have the test runner support “subchecks” and report partial skip counts.

---

### P2 — LSP enrichment test captures child output in-memory (could be noisy/large)

**Where**
- `tests/type-inference-lsp-enrichment.js` (spawnSync options at line **53**)

**What’s wrong**
- `spawnSync` defaults to `stdio: 'pipe'`, so stdout/stderr are buffered in-memory.
- If `build_index.js` emits large progress logs, this can increase memory usage or truncate buffers.

**Why it matters**
- Not usually catastrophic for this small fixture, but it is a known pitfall as logging grows or additional modes are enabled.

**Suggested fix**
- Prefer `stdio: 'inherit'` for integration builds, or selectively pipe only stderr when you need structured failure output.

---

## Test Duration Tracking + CI Tiering Process (Recommended)

The type inference suite has a mix of unit tests (sub-second) and integration tests (index builds). To keep the suite fast and trustworthy, introduce a durable timing ledger and use it to drive where/when tests run.

### 1) Capture per-test runtime in the runner

**Mechanism**
- In the test runner, record:
  - start timestamp,
  - end timestamp,
  - wall-clock duration,
  - timeout status,
  - retry count (if any),
  - lane/tag (unit/integration/perf).
- Emit a JSONL or JSON artifact (recommended: JSONL) such as:
  - `tests/.cache/test-durations.jsonl`

**Data shape (example)**
```json
{ "test": "tests/type-inference-lsp-enrichment.js", "durationMs": 8421, "status": "pass", "ts": "2026-01-21T01:00:00Z", "tags": ["integration","tooling"] }
```

### 2) Maintain a rolling timing baseline

**Policy**
- For each test file, compute rolling p50/p95 durations across recent CI runs and store them in a committed or cached baseline file, e.g.:
  - `tests/.cache/test-durations-baseline.json`

**Use**
- Detect regressions (“this test got 2× slower”).
- Enforce classification rules (“tests over N seconds must not be in smoke lane”).

### 3) Define suite tiers based on timing + dependency footprint

A practical default:

- **Tier 0 — Unit / fast**  
  Criteria: `< 1s`, no external tools, no index builds  
  Runs: every PR, every local run  
  Examples (from this pass):
  - `tests/type-inference-crossfile/apply.test.js`
  - `tests/type-inference-crossfile/extract.test.js`
  - `tests/type-inference-crossfile/symbols.test.js`

- **Tier 1 — Small integration**  
  Criteria: `1s–15s`, may spawn one subprocess, may touch filesystem cache  
  Runs: every PR (or “extended PR” lane)  
  Examples:
  - `tests/type-inference-clangd-provider-no-clangd.js`
  - `tests/type-inference-sourcekit-provider-no-sourcekit.js`
  - `tests/type-inference-typescript-provider-no-ts.js`

- **Tier 2 — Full integration (index build)**  
  Criteria: `> 15s` or builds an index / runs LSP stubs  
  Runs: nightly, or required before release, or on-demand CI job  
  Examples:
  - `tests/type-inference-crossfile-go.js`
  - `tests/type-inference-lsp-enrichment.js`

- **Tier 3 — Perf / benchmark harness**  
  Criteria: variable runtime, heavy I/O or multiple repos  
  Runs: scheduled only; never in PR gating.

### 4) Enforce tier constraints mechanically

**Implementation concept**
- Add a small header convention to each test file:
  - `// tags: unit, tooling`
  - `// tags: integration, index-build`
- The runner reads tags and supports:
  - `--tags unit` (smoke)
  - `--tags integration` (extended)
  - `--max-ms 15000` (time budget gate)
- Fail CI if a test is tagged `unit` but exceeds a configured runtime threshold (after warmup).

### 5) Make test prerequisites explicit

For tests that rely on fixtures or external dependencies:
- either embed a deterministic fixture (preferred, as with LSP stubs), and **prove it is selected**, or
- implement explicit skip semantics (dedicated exit code + runner support).

---

## Summary of Recommended Refactors (No Code Changes Performed)

1. Make integration tests artifact-format agnostic (stop hardcoding `chunk_meta.json`).
2. Enforce fixture selection in `type-inference-lsp-enrichment.js` (existence checks + proof of usage).
3. Align build-time config and verification-time config (avoid config drift between child build process and parent verifier).
4. Replace log-substring assertions with structured provider availability reports.
5. Add durable per-test timing capture and tiered CI execution.

