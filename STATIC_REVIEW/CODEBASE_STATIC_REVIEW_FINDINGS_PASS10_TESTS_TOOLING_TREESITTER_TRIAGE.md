# Codebase Static Review Findings — Pass 10 (Tooling + Tree-sitter + Type Inference + Triage + Stage-State Tests)

> Scope: **tests/** scripts listed in the request.  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness/portability risks, missing coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

- `tests/tooling-detect.js`
- `tests/tooling-install.js`
- `tests/tooling-lsp.js`
- `tests/tooling/triage/context-pack.test.js`
- `tests/tooling/triage/decision.test.js`
- `tests/tooling/triage/ingest-generic.exposure.test.js`
- `tests/tooling/triage/ingest-sources.smoke.test.js`
- `tests/tooling/triage/records-index-and-search.test.js`
- `tests/tooling/type-inference/crossfile-stats.unit.test.js`
- `tests/tree-sitter-chunks.js`
- `tests/truth-table.js`
- `tests/ts-jsx-fixtures.js`
- `tests/two-stage-state.js`

---

## Executive Summary

This slice of the test suite is valuable because it exercises real contract surfaces: CLI tooling discovery/install flows, JSON-RPC framing helpers used by LSP integration, tree-sitter chunk extraction across many languages, TypeScript/JSX/Flow parsing fixtures, cross-file inference stats, triage ingestion/index/search workflows, and the multi-stage index state machine.

The most important correctness risks are not in the “happy-path assertions” themselves—they are in **how these tests behave when prerequisites are missing, when the repo is executed from a non-root working directory, and when results are sensitive to ranking/fixture drift**.

Top issues to address:

1. **“Skip as pass” exists in the tree-sitter fixture test.** If tree-sitter/WASM availability is a baseline invariant (and the roadmap suggests it should be), this test currently allows CI to go green while silently not validating chunking at all.
2. **Most scripts assume `process.cwd()` is the repository root.** This is fragile across different runners, monorepo workspaces, and “run a single file” workflows.
3. **Spawn-based tests often omit diagnostic output on failure.** When CI fails, it will be unnecessarily hard to see *why*.
4. **Several tests are integration-heavy (index builds, records index builds, searches).** They should be explicitly tiered (smoke vs integration vs nightly) and have timing budgets, or they will eventually dominate CI time and create pressure to disable them.
5. **A couple of unit tests model inputs in ways that can mask regressions** (notably cross-file inference “chunks” that overlap unrealistically, and TypeScript parsing tests that do not pass extensions/options that the real pipeline likely uses).

The remainder of this document enumerates concrete issues per file and proposes targeted remedies, followed by a practical **test-duration ledger + CI tiering** process.

---

## High-Priority Findings

### P0 — `tree-sitter-chunks.js` treats “tree-sitter not available” as a passing skip

**Where**
- `tests/tree-sitter-chunks.js` lines 59–62

**What’s wrong**
- The test attempts to build chunks for the first fixture, and if `buildTreeSitterChunks()` returns `null` or an empty array, it prints:
  - `tree-sitter not available; skipping tree-sitter chunk tests.`
  - then returns (exit code 0).
- This makes CI results **optimistically green** even if tree-sitter/WASM is unavailable, misconfigured, or broken.

**Why it matters**
- Your roadmap and recent discussion explicitly call out **WASM grouping, shard planning, and avoiding “WASM not available” surprises**. If tree-sitter is foundational to chunking and relations, the test suite should *not* silently accept its absence.
- When a regression breaks tree-sitter loading, this test will not catch it; the first time you’ll notice is likely in product behavior.

**Suggested fix**
- Decide and enforce a policy:
  - **If tree-sitter/WASM is required in CI**: change this test to **fail hard** when chunking is unavailable (or gated by an env var such as `PAIROFCLEATS_REQUIRE_WASM=1` that CI sets).
  - **If tree-sitter/WASM is optional**: implement a standardized skip mechanism (dedicated exit code) so the runner reports **SKIPPED**, not PASS, and aggregates skip reasons.
- Add a dedicated invariant test aligned with the roadmap requirement:
  - “When tree-sitter is enabled and a supported language fixture is present, the runtime must not emit `WASM not available` and must successfully chunk at least one fixture.”

---

### P1 — Widespread reliance on `process.cwd()` as “repo root” makes tests fragile

**Where**
- `tests/tooling-detect.js` line 5
- `tests/tooling-install.js` line 5
- `tests/tooling/type-inference/crossfile-stats.unit.test.js` line 6
- `tests/truth-table.js` line 5
- `tests/ts-jsx-fixtures.js` line 7
- `tests/two-stage-state.js` line 8

**What’s wrong**
- These tests assume they are always executed with the project root as the current working directory.
- Many runners do this, but it is not guaranteed (e.g., IDE “run test”, workspace tools, or when tests are invoked from a parent directory).

**Why it matters**
- Breaks developer experience (“why does this test fail only when run alone?”).
- Breaks some CI/workspace setups and makes it harder to move tests into packages/subpackages.

**Suggested fix**
- Derive project root relative to the current file, not the working directory:
  - Use `import.meta.url` + `fileURLToPath()` + `path.dirname()` to locate the repo root consistently.
  - If the repo root is “two levels up” from the test file, compute it explicitly once and reuse.
- Where a test intentionally needs to validate “cwd behavior,” make that explicit and set `cwd` in `spawnSync()` accordingly.

---

### P1 — Spawn-based CLI tests hide failure details (stderr/stdout) and can waste debugging time

**Where**
- `tests/tooling-detect.js` lines 13–16
- `tests/tooling-install.js` lines 15–18

**What’s wrong**
- On failure, these tests print a single line (`tooling-detect failed`, `tooling-install failed`) and exit with the subprocess status.
- They do not surface `result.stderr`, `result.stdout`, or `result.error`.

**Why it matters**
- When failures happen (especially on a specific platform), the most valuable information is in stderr.
- Without printing it, CI logs will be unhelpful.

**Suggested fix**
- On failure, print a compact diagnostic block:
  - exit status / signal
  - `result.error?.message` (spawn errors)
  - last N lines of `stderr` and `stdout` (avoid log explosions)
- Prefer `stdio: 'pipe'` (current behavior) so output is capturable; then print it on failure only.

---

### P1 — Integration-heavy triage tests need explicit suite tiering and runtime budgets

**Where**
- `tests/tooling/triage/context-pack.test.js` (builds code index + records index + context pack)
- `tests/tooling/triage/records-index-and-search.test.js` (builds code index + records index + searches)
- `tests/two-stage-state.js` (runs stage1/2/3 index builds)

**What’s wrong**
- These tests are valuable, but they are fundamentally “mini end-to-end pipelines.”
- Without explicit tiering, they will:
  - slow down every CI run,
  - increase flake rate (filesystem, concurrency, local machine variance),
  - create pressure to disable them.

**Suggested fix**
- Assign them to an **integration/e2e lane** with:
  - strict timeouts,
  - concurrency caps,
  - and a separate CI job (nightly or “merge-to-main”).
- Keep unit-ish tests (LSP framing, truth-table parsing, TS/JSX fixtures, cross-file stats) in the **smoke** lane.

---

### P2 — Cross-file inference stats test uses unrealistic chunk spans and inconsistent docmeta

**Where**
- `tests/tooling/type-inference/crossfile-stats.unit.test.js` lines 103–126

**What’s wrong**
- Multiple chunks in `src/creator.js` share identical `start/end` offsets (both the function chunk and the class chunk span `0..creatorContent.length`).
- `makeWidget` is declared as `return {};` in the file content, but its chunk’s `docmeta` sets `returnsValue: false` while also providing a `returnType: 'Widget'`.

**Why it matters**
- If the cross-file inference pipeline relies on chunk boundaries (even indirectly for IDs), this test may not represent real-world inputs and can mask regressions.
- The inconsistent `returnsValue` signal can also lock in buggy behavior: the test may pass only because the pipeline ignores (or mishandles) `returnsValue`.

**Suggested fix**
- Adjust the fixture chunks to be structurally plausible:
  - Give `makeWidget` and `Widget` distinct non-overlapping ranges.
  - Use docmeta consistent with the file content (e.g., `returnsValue: true` for `makeWidget`).
- Add one more scenario that intentionally models “void return” so the stats reflect expected behavior when `returnsValue` is false for legitimate reasons.

---

### P2 — `ts-jsx-fixtures.js` does not pass extensions/options that the real pipeline likely uses

**Where**
- `tests/ts-jsx-fixtures.js` lines 19–41

**What’s wrong**
- `buildTypeScriptChunks(tsxText)` is called without specifying that the fixture is `.tsx`.
- `collectTypeScriptImports(mtsText)` / `collectTypeScriptImports(ctsText)` are called without indicating `.mts` / `.cts`.

**Why it matters**
- If the TypeScript implementation branches based on extension (TS vs TSX, ESM vs CJS), this test may not be exercising the correct code paths.
- It can create a false sense of coverage while `.tsx/.mts/.cts` regressions slip by.

**Suggested fix**
- Pass the extension explicitly, matching how indexing calls these functions:
  - `.tsx` for the TSX fixture,
  - `.mts` for ESM TS,
  - `.cts` for CJS TS.
- If these functions do not currently accept an extension, that’s a design smell: extension-sensitive parsing should have a consistent way to receive the context.

---

### P2 — Triage context-pack test has brittle, rank-sensitive assertions

**Where**
- `tests/tooling/triage/context-pack.test.js` lines 67–84

**What’s wrong**
- The test requires:
  - `pack.history.length > 0`
  - evidence queries exist
  - a specific query string `add-helper` exists
  - and total evidence hits > 0
- Depending on how evidence is generated and how retrieval behaves under `--stub-embeddings` / `--no-ann`, this can become brittle:
  - a harmless change in evidence query naming or ranking can break the test without a product regression.

**Suggested fix**
- Validate **structure and provenance** more than exact strings:
  - Assert evidence contains at least one query derived from record content (e.g., from imports or identifiers), but avoid hard-coding the exact token unless it is contractually stable.
- If hard-coding is intentional (fixture contract), then document it as part of fixture invariants and keep it localized to one fixture-focused test.

---

## Per-File Findings and Suggestions

### `tests/tooling-detect.js`

**What it does**
- Spawns `tools/tooling-detect.js` against the `tests/fixtures/languages` tree and validates that:
  - key languages are detected (`python`, `rust`, `go`, `java`, `cpp`, `objc`, `swift`)
  - key tool IDs are present (`clangd`, `gopls`, `rust-analyzer`, `jdtls`, `sourcekit-lsp`)

**Issues / risks**
- **CWD-root assumption** (`process.cwd()` at line 5).
- **Poor failure diagnostics** (no stdout/stderr logging on failure).
- The test ensures IDs are present but does not validate **shape contracts** beyond that (e.g., does each tool include fields like `available`, `reason`, `paths` if those are part of the public contract).

**Suggested improvements**
- Print stderr/stdout on failure.
- Consider asserting minimal schema invariants for each tool entry (at least `id` and `kind/status` fields) so output format drift is caught early.

---

### `tests/tooling-install.js`

**What it does**
- Runs `tools/tooling-install.js --dry-run --tools clangd --json` and expects a result entry:
  - `id === 'clangd'`
  - `status === 'manual'`

**Issues / risks**
- Same **CWD-root assumption** (line 5) and **minimal failure diagnostics** (line 15–18).
- The assertion couples to a specific policy: “clangd installs are manual.” If policy changes (e.g., bundling clangd), this test becomes an intentional failure and should be updated in lockstep.

**Suggested improvements**
- Print stderr/stdout on failure.
- If the policy is “manual unless bundled,” encode that explicitly (e.g., allow `manual | bundled` but require one of them).

---

### `tests/tooling-lsp.js`

**What it does**
- Unit-tests JSON-RPC framing parsing/writing and LSP symbol/range helpers.

**Issues / risks**
- `waitFor()` is a polling loop (line 16–22). This is fine, but it is unnecessary if the parser is synchronous; polling can introduce rare timing flakes under heavy load.
- Large payload test uses a fixed 512 KiB message (line 61–76). If there is a max frame limit, this doesn’t prove behavior near the boundary.

**Suggested improvements**
- If parser callbacks are synchronous, remove polling and assert immediately after `push()`. If not synchronous, consider using `setImmediate()` rather than `setTimeout(0)` to reduce variability.
- Add a negative test: malformed headers / incorrect content-length / truncated frames should increment `errors` predictably.
- Add a unicode position test for `rangeToOffsets` (multi-byte characters) if offsets are intended to be byte offsets rather than JS string code unit offsets.

---

### `tests/tooling/triage/ingest-generic.exposure.test.js`

**What it does**
- Ingests a generic triage JSON fixture, then asserts the stored record JSON and markdown include exposure metadata.

**Issues / risks**
- Hard-coded markdown strings (`## Exposure`, `Internet exposed`) can be brittle if rendering copy changes.
- Depends on ingest output fields (`recordsDir`, `records?.[0]?.jsonPath`) being stable.

**Suggested improvements**
- If markdown phrasing is not a public contract, assert on more stable markers (e.g., presence of an “Exposure” section header is probably stable; the exact phrase “Internet exposed” may not be).
- If the ingest tool promises to return explicit paths, prefer those; if not, the fallback `recordsDir + id` convention should be formalized.

---

### `tests/tooling/triage/ingest-sources.smoke.test.js`

**What it does**
- Smoke-ingests Dependabot and AWS Inspector fixtures and asserts non-empty record IDs.

**Issues / risks**
- This is a very light assertion; it validates “something was written” but not that normalization is correct.

**Suggested improvements**
- Add one or two “shape contract” checks per source:
  - required normalized fields exist (e.g., package name / vulnerability id / severity).
- Keep it light to avoid turning a smoke test into an integration monster.

---

### `tests/tooling/triage/decision.test.js`

**What it does**
- Ingests generic records, then writes an “accept” decision and asserts:
  - returned status is `accept`
  - returned JSON path exists on disk

**Issues / risks**
- Minimal contract coverage; it doesn’t prove the decision is attached to the record or that subsequent tooling reads it.

**Suggested improvements**
- Add a follow-up read (or re-run a command that consumes decisions) to ensure the decision is discoverable (if decision consumption exists and is part of product behavior).

---

### `tests/tooling/triage/records-index-and-search.test.js`

**What it does**
- Builds code index and records index, then runs record search (`--mode records`) and verifies record docmeta includes `service=api`.

**Issues / risks**
- Integration-heavy; should be tiered.
- The search query is hard-coded (`CVE-2024-0001`), which is fine as a fixture contract, but it also implies:
  - fixture content must remain stable,
  - ranking/filters must keep returning at least one record.

**Suggested improvements**
- Validate that the returned record actually corresponds to the ingested record IDs (if the search output includes record IDs).
- Ensure the test uses deterministic “no ANN” / stub embeddings paths (it already passes `--no-ann` and `--stub-embeddings`).

---

### `tests/tooling/triage/context-pack.test.js`

**What it does**
- Builds code + records indexes, then generates a context pack for a record and asserts:
  - required fields exist,
  - exposure metadata present,
  - history exists,
  - evidence queries exist and contain a specific query,
  - evidence hits are non-empty.

**Issues / risks**
- Integration-heavy; should be tiered.
- Brittle assertions around query string and evidence hits (rank-sensitive).

**Suggested improvements**
- Prefer asserting evidence **is derived from record content** rather than hard-coding a token—unless the token is explicitly part of fixture invariants.
- If the goal is to guarantee evidence is produced, add a minimal “evidence generation contract” in code and test that contract.

---

### `tests/tree-sitter-chunks.js`

**What it does**
- Loads a set of tree-sitter fixtures across many languages and asserts specific chunk names are extracted.
- Also tests `maxBytes` and `maxLines` skip behavior.

**Issues / risks**
- **Skip-as-pass** when tree-sitter is not available (P0).
- Does not validate the `maxLoadedLanguages` eviction behavior, even though it constrains it to 2 and then loads many languages.

**Suggested improvements**
- Make tree-sitter availability a first-class invariant (fail or SKIP explicitly).
- Add a small assertion around eviction behavior, if there is an observable API for loaded language count.
- Consider splitting this test into:
  - a short “WASM availability + one language smoke” test (fast, must-run),
  - and the full multi-language fixture pass (slower, can be nightly).

---

### `tests/truth-table.js`

**What it does**
- Parses `docs/truth-table.md` and enforces that each “Claim” block includes:
  - Implementation, Config, Tests, Limitations lines
  - and that the Tests line references `tests/`

**Issues / risks**
- Parsing is formatting-sensitive (`- Claim:` must match exactly).
- Label detection is substring-based (line includes `Implementation:`). If the doc uses code blocks or alternative formatting, it may false-positive/negative.

**Suggested improvements**
- Treat this as a documentation contract test (which is good), but:
  - consider allowing both `- Claim:` and `* Claim:` (or document strict formatting rules),
  - and consider requiring the Tests line to include one or more concrete file paths rather than just any `tests/` substring.

---

### `tests/ts-jsx-fixtures.js`

**What it does**
- Verifies TSX chunking, `.mts/.cts` import detection, JSX chunking, and Flow parsing/imports.

**Issues / risks**
- Not passing extensions/options for TSX and module type can under-test the real behavior (P2).
- Uses CWD-based fixture path (line 7–8).

**Suggested improvements**
- Provide ext context explicitly for TypeScript fixtures.
- If language chunkers accept an `options` object, pass the same shape indexing uses (even if minimal), so tests exercise the “real call surface.”

---

### `tests/two-stage-state.js`

**What it does**
- Creates a temp repo, runs `build_index.js` in `stage1`, `stage2`, `stage3` and asserts:
  - `index_state.json` stage markers and enrichment pending/cleared
  - stage1 does not create `file_relations.json`
  - stage2 creates `file_relations.json` and marks enrichment done
  - stage3 marks embeddings ready and writes `dense_vectors_uint8.json`

**Issues / risks**
- CWD-root assumption (line 8) for `build_index.js` path.
- The test is strongly coupled to pipeline semantics (“stage1 must not write file_relations.json”). If the pipeline is refactored while preserving correctness, this test can become an artificial blocker.
- Minimal debugging on failure: it inherits child stdio (good), but it does not capture/print structured artifacts when assertions fail (e.g., dumping index_state.json content on mismatch).

**Suggested improvements**
- When assertions fail, print the parsed state JSON so CI logs show what was actually written.
- If the stage contract is intended to be stable, document it as a formal contract; otherwise, adjust the test to assert only the invariants that truly matter (e.g., “relations are unavailable until stage2”, rather than “file_relations.json must not exist in stage1”).

---

## Process: Test Duration Tracking and CI Tiering

Even with excellent tests, the suite will degrade if you can’t measure and control runtime. A practical, low-maintenance approach:

### 1) Establish a canonical timing ledger produced by the test runner
- For each test execution, record:
  - `testPath`
  - `status` (`pass|fail|skip|timeout`)
  - `durationMs` (wall-clock)
  - `attempt` (for retries)
  - `lane`/`tier` (smoke/integration/nightly)
  - `timestamp`, `gitSha` (optional but helpful in CI)
- Emit this as:
  - `tests/.cache/test-timings.jsonl` (append-only JSON lines), and/or
  - a compact rollup `tests/.cache/test-timings.summary.json`.

> Implementing this requires changes to the runner (not reviewed in this pass), but all the tests in this pass would benefit immediately.

### 2) Define explicit tiers with budgets
A reasonable default tiering for the files in this pass:

**Smoke (must run on every PR; budget: ~60–120s total)**
- `tests/tooling-lsp.js`
- `tests/truth-table.js`
- `tests/ts-jsx-fixtures.js`
- `tests/tooling/type-inference/crossfile-stats.unit.test.js`
- a *short* tree-sitter smoke (if WASM required) — ideally separate from the full fixture pass

**Integration (runs on merge-to-main or scheduled; budget: configurable, e.g. 10–20 minutes)**
- `tests/tooling/triage/*.test.js` (these build indexes and run searches)
- `tests/two-stage-state.js`
- full `tests/tree-sitter-chunks.js` multi-language fixture pass

### 3) Use timing data to keep the suite healthy
- Add a CI check that fails if:
  - a smoke test exceeds an individual threshold (e.g., >10s), or
  - smoke suite total exceeds budget.
- Track p50/p95 per test across recent runs (last N timing ledger entries) to detect regressions.
- When a test becomes slow:
  - either optimize it,
  - or move it to a slower tier (but don’t silently accept the slowdown).

### 4) Standardize “skip” semantics (so timing data is meaningful)
- Introduce a reserved skip exit code (or a structured protocol) so:
  - “missing WASM” becomes **SKIP** (or FAIL if policy says required),
  - “missing git” becomes SKIP, not PASS,
  - and timing ledgers reflect what truly ran.

### 5) Add a minimal “timing tag” to each test
- Each test file can optionally export/print metadata (or use filename conventions) to label itself:
  - `@tier smoke|integration`
  - `@needs wasm|git|network`
- The runner uses these to:
  - schedule intelligently,
  - and explain why a test was skipped or moved.

---

## Recommended Next Steps (Based on This Pass)

1. **Fix tree-sitter skip-as-pass behavior** and define a clear WASM availability policy in CI.
2. **Remove `process.cwd()` root assumptions** across these tests by computing paths relative to the file.
3. **Improve spawn failure diagnostics** for tooling detect/install tests.
4. **Tier the triage + two-stage-state tests** explicitly and enforce runtime budgets via a timing ledger.
5. **Tighten unit test realism** for cross-file inference chunks and TypeScript extension-sensitive fixtures.

