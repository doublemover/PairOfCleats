# Phase 13 Plan (Detailed)

Complete Phase 13 by fixing retrieval correctness/performance gaps, hardening API/MCP services, and making benchmark/eval tooling reliable. Update this plan as items are completed.

## Scope
- In: Retrieval pipeline, filters/query parsing/explain, ranking, context expansion, API/MCP services, benchmark/eval tooling, and related docs/tests.
- Out: Non-retrieval phases or unrelated indexing/storage changes.

## Phase 13 Exit Criteria (track explicitly)
[ ] Query parsing supports full boolean operators/precedence/parentheses (no simplified grammar).
[ ] Filters are correctly detected as active and do not disable backend fast paths.
[ ] Explain output matches scoring math and is emitted only when requested (or docs updated if always on).
[ ] SQLite FTS fast-path is not disabled by default for large indexes.
[x] Benchmarks can write baselines reliably (budgets deferred per request).
[ ] API streaming handles backpressure + close without hanging.
[ ] API/MCP cancellation and timeout propagation stops work early.
[ ] CORS/security posture is intentional and documented.
[x] Tests cover regressions and edge cases (FTS eligibility, extracted-prose query caching, MCP id=0, etc.).
[x] Bench/eval docs match actual behavior and commands.

## 13.A Retrieval Semantics, Explain, Context Expansion
[ ] A1: Fix `hasActiveFilters()` to ignore internal-only keys (ex: `filePrefilter`). Files: `src/retrieval/filters.js`, `src/retrieval/cli.js`, `src/retrieval/pipeline.js`.
[ ] A1: Add unit tests for `hasActiveFilters()` default filter object and typical combinations.
[ ] A1: Add integration test to ensure sqlite-fts eligibility remains when no user filters are set (validate path selection in stats/debug output).
[ ] A2: Document context expansion semantics (same-file vs cross-file, name match rules, ignore rules). Files: `docs/contracts/retrieval-ranking.md` or new section in retrieval docs.
[ ] A2: Verify cache boundaries for context expansion (index signature + filters) with tests; ensure no cross-branch bleed.
[ ] A3: Decide explain-output contract (compute-only-on-explain vs always present). Implement in `src/retrieval/pipeline.js` and `src/retrieval/output/explain.js`.
[ ] A3: Add snapshot tests for explain presence/absence by output mode (compact/full/json).
[x] A3: Verify explain boost attribution matches actual scoring (phrase/symbol boosts) and document if already-boosted score is used.

## 13.B Query Parsing & Filtering
[ ] B1: Implement full boolean parsing with AND/OR/NOT, precedence, and parentheses in `src/retrieval/query.js` + `src/retrieval/query-parse.js`.
[ ] B1: Add actionable errors for malformed queries (unbalanced quotes, stray operators).
[ ] B1: Add tests for negated phrases, nested quotes, malformed input, and operator tokens.
[ ] B2: Ensure case-sensitive file filters remain strict after prefilter normalization. Files: `src/retrieval/output/filters.js`, `src/retrieval/filter-index.js`.
[x] B2: Document filter index memory footprint and add soft limits/metrics if needed.

## 13.C Ranking Determinism & Tie-Breaking
[ ] C1: Validate embedding dims before dense ranking; skip dense scoring with warning or safe truncation. Files: `src/retrieval/rankers.js`, `src/retrieval/embedding.js`, `src/retrieval/sqlite-helpers.js`.
[ ] C1: Add tests for dims mismatch using stub embeddings and configured dims.
[ ] C2: Fix sqlite dense vector scale fallback to `2/255` and minVal `-1` when meta missing. File: `src/retrieval/sqlite-helpers.js`.
[ ] C2: Add regression test to ensure dense scoring remains bounded when meta missing/corrupt.

## 13.D Services: API Server & MCP
[ ] D1: Replace SSE drain wait with `Promise.race([drain, close, error])`. File: `tools/api/sse.js`.
[ ] D1: Add tests simulating backpressure + early disconnect.
[ ] D2: Align `/search/stream` behavior with docs. Decide: add progress events or update docs/contracts. Files: `tools/api/router.js`, `docs/api-server.md`, `docs/contracts/api-mcp.md`.
[ ] D3: Add `AbortController` per request/tool call and propagate cancellation into retrieval pipeline. Files: `tools/api/router.js`, `tools/mcp/transport.js`, `tools/mcp/tools.js`, `src/retrieval/cli.js`.
[ ] D3: Add tests to prove cancel stops work (API stream disconnect + MCP timeout).
[ ] D4: Default CORS to disabled/restricted, require explicit opt-in, and document. Files: `tools/api/router.js`, `docs/api-server.md`.
[ ] D4: Add tests for CORS preflight and allowed origins.
[ ] G4: Fix MCP JSON-RPC id=0 handling by treating only null/undefined as missing. File: `tools/mcp/transport.js`, add tests.

## 13.E Benchmarks & Latency (Budgets deferred for now)
[ ] E1: Implement explicit dense/hybrid/sparse scoring selection; add sanity asserts in output. Files: `tools/bench/micro/run.js`, `tools/bench/micro/search.js`, `tools/bench/micro/tinybench.js`, update `docs/benchmarks.md`.
[ ] E2: Ensure baseline directory exists for `--write-baseline` and add test. File: `tools/bench/micro/tinybench.js`.
[ ] E3: Reuse sqlite cache across runs for warm scenarios; record cache reuse status in output. Files: `tools/bench/micro/run.js`, `tools/bench/micro/tinybench.js`.
[ ] E4 (defer per request): Define/enforce latency budgets once we decide thresholds; document in `docs/benchmarks.md`.
[ ] G3: Fix bench language progress renderer import paths and add a smoke test to catch load failures. File: `tools/bench/language/progress/render.js`.
[ ] G5: Fix bench query generator output quoting and `--signature` emission. File: `tools/bench-query-generator.js`.

## 13.F Eval Harness
[ ] F1: Decide match strictness (exact vs substring). Add `matchMode` option and tests. Files: `tools/eval/run.js`, `docs/eval.md`.

## Additional Concrete Bugs (Phase 13)
[ ] G1: Fix retrieval output summary word count (use word count, avoid double summary calculation). File: `src/retrieval/output/format.js`.
[ ] G2: Fix parity test query file path or move file; add guard assertion. File: `tests/parity.js`.

## Tests to add/extend (Phase 13 checklist)
[ ] `hasActiveFilters()` default object false; internal config keys ignored.
[ ] sqlite-fts eligibility for large indexes with no filters.
[x] Extracted-prose query caching behavior (include payload fields) if applicable.
[ ] SSE backpressure + disconnect test.
[ ] API abort cancels search work.
[ ] MCP id=0 support.
[x] `--write-baseline` creates directories and succeeds on clean checkout.

## Documentation updates
[ ] `docs/api-server.md` for stream behavior, CORS/security defaults, auth posture.
[ ] `docs/contracts/api-mcp.md` for stream events and cancellation semantics.
[x] `docs/benchmarks.md` for dense/hybrid behavior and baseline creation.
[x] `docs/mcp-server.md` alignment with transport implementation.
[ ] `docs/contracts/retrieval-ranking.md` (or equivalent) for context expansion semantics and explain contract.

## Validation
[ ] Run `npm run test:integration`.
[ ] Run `npm run test:services`.
[ ] Run targeted retrieval/bench tests touched by changes.
[ ] If a failure persists after a few attempts, log it in this file and stop.
