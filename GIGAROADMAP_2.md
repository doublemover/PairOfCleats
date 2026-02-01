# PairOfCleats GigaRoadmap

    ## Status legend
    
    Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
    - [x] Implemented and appears complete/correct based on code inspection and existing test coverage
    - [@] In Progress, this work has been started
    - [.] Work has been completed but has Not been tested
    - [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
    - [x] Not complete
    
    Completed Phases: `COMPLETED_PHASES.md`

### Source-of-truth hierarchy (when specs disagree)
When a document/spec conflicts with the running code, follow this order:

1) **`src/contracts/**` and validators** are authoritative for artifact shapes and required keys.
2) **Current implementation** is authoritative for runtime behavior *when it is already validated by contracts/tests*.
3) **Docs** (`docs/contracts/**`, `docs/specs/**`, `docs/phases/**`) must be updated to match (never the other way around) unless we have a deliberate migration plan.

If you discover a conflict:
- **Prefer "fix docs to match code"** when the code is already contract-validated and has tests.
- **Prefer "fix code to match docs/contracts"** only when the contract/validator is explicit and the code violates it.

### Touchpoints + line ranges (important: line ranges are approximate)
This document includes file touchpoints with **approximate** line ranges like:

- `src/foo/bar.js` **(~L120-L240)**  -  anchor: `someFunctionName`

Line numbers drift as the repo changes. Treat them as a **starting hint**, not a hard reference.
Always use the **anchor string** (function name / constant / error message) as the primary locator.

### Tests: lanes + name filters (use them aggressively)
The repo has a first-class test runner with lanes + filters:

- Runner: `npm test` (alias for `node tests/run.js`)
- List lanes/tags: `npm test -- --list-lanes` / `npm test -- --list-tags`
- Run a lane: `npm run test:unit`, `npm run test:integration`, `npm run test:services`, etc.
- Filter by name/path (selectors):  
  - `npm test -- --match risk_interprocedural`  
  - `npm run test:unit -- --match chunk-uid`  
  - `npm run test:integration -- --match crossfile`

**Lane rules are defined in:** `tests/run.rules.jsonc` (keep new tests named/placed so they land in the intended lane).

### Deprecating spec documents: archive policy (MANDATORY)
When a spec/doc is replaced (e.g., a reconciled spec supersedes an older one):

- **Move the deprecated doc to:** `docs/archived/` (create this folder if missing).
- Keep a short header in the moved file indicating:
  - what replaced it,
  - why it was deprecated,
  - the date/PR.
- Add/update the repository process in **`AGENTS.md`** so future agents follow the same archival convention.

This roadmap includes explicit tasks to enforce this process (see Phase 10 doc merge).

---

## Roadmap Table of Contents
### Features
- Phase 11 -- Graph-Powered Product Features (context packs, impact, explainability, ranking)
    - 11.1 - Graph Context Packs (bounded neighborhood extraction) + retrieval context-expansion hardening
    - 11.2 - Impact Analysis (callers/callees + k-hop impact radius) with witness paths
    - 11.3 - Context Pack Assembly for Tooling/LLM (chunk text + graph + types + risk) + explainability rendering
    - 11.4 - Graph-Aware Ranking Hooks (opt-in) + Explainability
    - 11.5 - Graph Expansion Caps as a Config Surface + Calibration Harness (language × size tier)
    - 11.6 - Cross-file API Contracts (report + optional artifact)
    - 11.7 - Architecture Slicing & Boundary Enforcement 
    - 11.8 - Test Selection Heuristics 

---

## Phase 11 — Graph-powered product features (context packs, impact, explainability, ranking)

### Objective
Turn graph and identity primitives into **safe, bounded, deterministic** product surfaces: graph context packs, impact analysis, explainable graph-aware ranking (opt-in), and structured outputs suitable for both CLI use and future API/MCP consumers.

- Assumes canonical identities exist (e.g., chunkUid/SymbolId and a canonical reference envelope for unresolved/ambiguous links).
- Any graph expansion MUST be bounded and MUST return truncation metadata when caps trigger (depth/fanout/paths/nodes/edges/time).
- The default search contract must remain stable: graph features can change ordering when enabled, but must not change membership/correctness.

---

### 11.1 Graph context packs (bounded neighborhood extraction) + retrieval context-expansion hardening

- [ ] Define a graph context pack contract (JSON-first; Markdown render optional).
  - Output shape (minimum):
    - `seed` (canonical id + type)
    - `nodes[]` (bounded; stable ordering)
    - `edges[]` (bounded; stable ordering; include direction and edge type)
    - `paths[]` (optional; bounded witness paths when requested)
    - `truncation[]` (one or more truncation records; absent only when no caps trigger)
    - `warnings[]` (e.g., missing artifacts, partial/unresolved edges)
  - Link safety:
    - Any edge endpoint that fails to resolve MUST use a reference envelope (resolved/ambiguous/unresolved + candidates + reason + confidence).
  - Cap surface (configurable):
    - `maxDepth`, `maxFanoutPerNode`, `maxNodes`, `maxEdges`, `maxPaths`, `maxWallClockMs`.

- [ ] Implement deterministic neighborhood extraction for a seed id (k-hop).
  - Prefer graph source artifacts when present:
    - `graph_relations` for call/usage/import graphs (baseline).
    - `symbol_edges` / callsite artifacts (when available) for evidence and SymbolId identity.
  - Deterministic traversal:
    - Stable adjacency ordering (lexicographic by canonical id, then edge type).
    - Deterministic tie-breaking when budgets are hit (e.g., keep lowest id first, or keep highest confidence first, but make it explicit and stable).
  - Strict bounding:
    - Enforce caps during traversal (no “collect everything then slice”).
    - Record truncation metadata with which cap triggered and how much was omitted.

- [ ] Refactor `src/retrieval/context-expansion.js` so it is safe to reuse as the neighborhood engine (or provide a thin wrapper).
  - Touchpoints:
    - `src/retrieval/context-expansion.js`
    - `src/shared/artifact-io.js` (artifact presence checks via manifest)
  - [ ] Eliminate eager `{id, reason}` candidate explosion.
    - Convert candidate generation to a streaming/short-circuit loop that stops as soon as `maxPerHit` / `maxTotal` is satisfied.
    - Add per-source caps (e.g., max call edges examined, max import links examined) so worst-case repos cannot allocate unbounded candidate sets.
  - [ ] Remove duplicate scanning and make reason selection intentional.
    - Track candidates in a `Map<id, { bestReason, bestPriority, reasons? }>` rather than pushing duplicates into arrays.
    - Define a fixed reason priority order (example: call > usage > export > import > nameFallback) and document it.
    - When `--explain` is enabled, optionally retain the top-N reasons per id (bounded).
  - [ ] Stop assuming `chunkMeta[id]` is a valid dereference forever.
    - Build a `byDocId` (and/or `byChunkUid`) lookup once and use it for dereferencing.
    - If a dense array invariant is still desired for performance, validate it explicitly and fall back to map deref when violated.
  - [ ] Prefer identity-first joins.
    - When graph artifacts exist, resolve neighbors via canonical ids rather than `byName` joins.
    - Keep name-based joins only as an explicit fallback mode with low-confidence markers.

#### Tests
- [ ] `tests/graph/context-pack-basic.test.js`
  - Build a small fixture graph; request a context pack for a known seed; assert expected caller/callee/import/usage neighbors are present.
- [ ] `tests/graph/context-pack-caps.test.js`
  - Use a large synthetic graph fixture; assert truncation metadata is present and stable when caps trigger.
- [ ] `tests/retrieval/context-expansion-no-candidate-explosion.test.js`
  - Stress fixture with many relations; assert expansion completes within a time/memory budget and does not allocate unbounded candidate arrays.
- [ ] `tests/retrieval/context-expansion-reason-precedence.test.js`
  - A chunk reachable via multiple relation types records the highest-priority reason deterministically.
- [ ] `tests/retrieval/context-expansion-shuffled-chunkmeta.test.js`
  - Provide a shuffled `chunkMeta` where array index != docId; assert expansion still resolves correct chunks via a map-based dereference.

Touchpoints (consolidated):
- `src/retrieval/context-expansion.js` (refactor to become the bounded neighborhood engine)
- `src/shared/artifact-io.js` (manifest/presence checks)
- `src/graph/neighborhood.js` (new; deterministic bounded traversal)
- `src/graph/context-pack.js` (new; pack construction + truncation metadata)
- `src/retrieval/pipeline.js` (wire expansion hooks)
- `src/retrieval/output/context.js` (render context packs; harden sanitization)
- `src/retrieval/cli/options.js` + `src/retrieval/cli/normalize-options.js` (CLI flags)
- `bin/pairofcleats.js` (CLI wiring: `search --graph-context/--context-pack`)
- `docs/contracts/search-cli.md` (document CLI + JSON output contract)



---

### 11.2 Impact analysis (callers/callees + k-hop impact radius) with witness paths

- [ ] Implement bounded impact analysis on top of the same neighborhood extraction primitives.
  - Provide `impactAnalysis(seed, { direction, depth, caps, edgeFilters })` returning:
    - impacted nodes (bounded; stable ordering)
    - at least one witness path per impacted node when available (bounded; do not enumerate all paths)
    - explicit unresolved/partial path markers when edges cannot be resolved.
  - Deterministic ordering:
    - stable sort by `(distance, confidence desc, name/id asc)` (or equivalent stable rule), and document it.

- [ ] CLI surface (API-ready internal design).
  - Add `pairofcleats impact --repo … --seed <id> --direction upstream|downstream --depth 2 --format json|md`.
  - Ensure the implementation is factored so an API/MCP handler can call the same core function with the same caps and output schema.

- [ ] Optional “changed-set” impact mode (non-blocking in this phase).
  - Accept `--changed <file>` repeated (or a file containing paths) and compute:
    - impacted symbols in and around changed files, then traverse upstream/downstream bounded.
  - If SCM integration is unavailable, degrade gracefully (explicit warning; still supports explicit `--changed` lists).

#### Tests
- [ ] `tests/graph/impact-analysis-downstream.test.js`
  - Seed a function; assert downstream impacted nodes include an expected callee and a witness path is returned.
- [ ] `tests/graph/impact-analysis-upstream.test.js`
  - Seed a function; assert upstream impacted nodes include an expected caller and a witness path is returned.
- [ ] `tests/graph/impact-analysis-caps-and-truncation.test.js`
  - Trigger caps deterministically; assert truncation metadata identifies which cap fired and results remain stable.

Touchpoints (consolidated):
- `src/graph/impact.js` (new; bounded impact analysis)
- `src/graph/witness-paths.js` (new; witness path reconstruction)
- `src/graph/neighborhood.js` (shared traversal primitives)
- `src/retrieval/cli/impact.js` (new; CLI command implementation)
- `src/retrieval/output/impact.js` (new; stable human + JSON renderers)
- `bin/pairofcleats.js` (CLI wiring: `impact`, `impact:explain`)
- `docs/contracts/search-cli.md` (document new surfaces + JSON schema)



---

### 11.3 Context pack assembly for tooling/LLM (chunk text + graph + types + risk) + explainability rendering

- [ ] Implement a “context pack assembler” that composes multiple bounded slices into a single package.
  - Inputs:
    - `seed` (chunkUid/SymbolId)
    - budgets (`maxTokens` and/or `maxBytes`, plus graph caps)
    - toggles (includeTypes, includeRisk, includeImports, includeUsages, includeCallersCallees)
  - Output (recommended minimum):
    - `primary` (chunk excerpt + stable identifiers + file/segment provenance)
    - `graph` (from 11.1; bounded neighborhood)
    - `types` (bounded: referenced/declared/inferred/tooling-backed summaries when available)
    - `risk` (bounded: top-N flows/summaries crossing the seed, with callsite evidence when present)
    - `truncation[]` (aggregate truncation across slices)
    - `warnings[]` (missing artifacts, partial resolution, disabled features)
  - Notes:
    - Do not embed large raw code blobs; prefer bounded excerpts and (when needed) snippet hashes + location coordinates.
    - Use stable ordering inside each slice so context packs are deterministic across runs.

- [ ] Add CLI surface:
  - `pairofcleats context-pack --repo … --seed <id> --hops 2 --maxTokens 4000 --format json|md`
  - For Markdown output, use consistent sections and a deterministic ordering (primary first, then callers/callees, then imports/usages, then risk).

- [ ] Add explain-risk rendering for flows when risk artifacts exist.
  - Provide an output mode (flag or subcommand) that prints:
    - the path of symbols/chunks
    - file/line evidence (callsites) when present
    - rule ids/categories and confidence
    - bounded snippets or snippet hashes (never unbounded)
  - Ensure output is stable, capped, and does not assume optional color helpers exist.

- [ ] Harden retrieval output helpers used by these features (integrate known bugs in touched files).
  - Touchpoints:
    - `src/retrieval/output/context.js`
    - `src/retrieval/output/explain.js`
  - [ ] `cleanContext()` must remove fence lines that include language tags.
    - Treat any line whose trimmed form starts with ``` as a fence line.
  - [ ] `cleanContext()` must not throw on non-string items.
    - Guard/coerce before calling `.trim()`.
  - [ ] Explain formatting must not assume `color.gray()` exists.
    - Provide a no-color fallback when `color?.gray` is not a function.

#### Tests
- [ ] `tests/graph-features/context-pack-assembly.test.js`
  - Build fixture; assemble a context pack; assert it contains primary + at least one neighbor + deterministic truncation structure.
- [ ] `tests/graph-features/risk-explain-render.test.js`
  - Use a risk-flow fixture; assert output includes a call path and evidence coordinates and remains bounded.
- [ ] `tests/output/clean-context-fences.test.js`
  - Ensure ```ts / ```json fences are removed (not just bare ```).
- [ ] `tests/output/clean-context-nonstring-guard.test.js`
  - Feed non-string items; assert no crash and only string lines survive.
- [ ] `tests/output/explain-color-fallback.test.js`
  - Provide a partial color impl; assert explain rendering does not throw.

Touchpoints (consolidated):
- `src/retrieval/output/context.js` (hardening: fence stripping, type guards, truncation reporting)
- `src/retrieval/output/explain.js` (null-safe + color fallback; stable explain schema)
- `src/retrieval/output/format.js` (structured output plumbing; context-pack JSON integration)
- `src/retrieval/cli/render-output.js` + `src/retrieval/cli/render.js` (output modes + JSON formatting)
- `src/retrieval/cli/options.js` (flags: `--context-pack`, `--explain-json`, etc.)
- `bin/pairofcleats.js` (CLI wiring for new output modes)
- `docs/contracts/search-cli.md` (update contract + examples)



---

### 11.4 Graph-aware ranking hooks (opt-in) + explainability

- [ ] Introduce optional graph-aware ranking features that can be enabled without changing result membership.
  - Candidate feature families (bounded, deterministic):
    - node degree / in-degree / out-degree (prefer precomputed analytics artifacts when available)
    - proximity to the query-hit seed within the graph neighborhood (bounded k-hop)
    - proximity to risk hotspots (if risk summaries/flows exist)
    - same-cluster bonus (if clustering artifacts exist; deterministic cluster id remapping is assumed)
  - Guardrails:
    - Never compute expensive global graph metrics per query unless explicitly cached and bounded.
    - Default behavior remains unchanged unless explicitly enabled.

- [ ] Integrate into retrieval ranking with an explicit feature-hook layer.
  - Touchpoints (expected):
    - `src/retrieval/pipeline.js` (scoring assembly + explain output)
    - `src/retrieval/cli/run-search-session.js` / options normalization (flag plumbing)
  - Configuration:
    - `retrieval.graphRanking.enabled` (default false)
    - `retrieval.graphRanking.weights` (explicit; versioned defaults)
    - `retrieval.graphRanking.maxGraphWorkMs` (time budget)
  - Explainability:
    - When `--explain` (or a dedicated `--explain-ranking`) is enabled, include a `graph` section in the score breakdown:
      - feature contributions and the final blended delta.

#### Tests
- [ ] `tests/retrieval/graph-ranking-toggle.test.js`
  - Run the same query with graph ranking off/on; assert result sets are identical but ordering may differ.
- [ ] `tests/retrieval/graph-ranking-explain.test.js`
  - With explain enabled, assert output includes named graph feature contributions.
- [ ] `tests/retrieval/graph-ranking-determinism.test.js`
  - Re-run the same query twice with graph ranking enabled; assert ordering and explain payload are stable.

---

### 11.5 Graph expansion caps as a config surface + calibration harness (language × size tier)

- [ ] Make graph expansion caps first-class, shared configuration rather than hard-coded constants.
  - Touchpoints (expected):
    - `src/index/build/graphs.js` (replace `GRAPH_MAX_NODES/EDGES` constants with config-driven caps; record which cap triggered)
      - Also enforce identity-first graph node IDs for new writes (no `file::name` fallbacks); legacy keys, if still needed, are read-compat only and must not overwrite collisions.
    - `src/retrieval/context-expansion.js` (use the same cap vocabulary; always emit truncation metadata when caps trigger)
    - `docs/perf/graph-caps.md` (document defaults and tuning)
  - Required behavior:
    - Every expansion returns truncation metadata when it truncates.
    - Truncation metadata must indicate which cap fired and provide counts (omitted nodes/edges/paths) when measurable.

- [ ] Implement a metrics-harvesting harness to justify default caps.
  - Inputs:
    - Use/extend `benchmarks/repos.json` to define repos.
    - Normalize into tiers: small / typical / large / huge / problematic(massive).
  - For each repo/tier (outside CI for huge/problematic):
    - run indexing with graphs enabled
    - compute graph distributions (node/edge counts, degree stats, SCC size)
    - run bounded neighborhood expansions for representative seeds (random, top-degree, entrypoints)
    - record timing and output sizes
  - Outputs:
    - versioned bundle under `benchmarks/results/<date>/graph-caps/`
    - machine-readable defaults: `defaults/graph-caps.json` keyed by language (and optionally tier)
    - documentation: `docs/perf/graph-caps.md` (p95 behavior for typical tier + presets for huge/problematic)

#### Tests
- [ ] `tests/graphs/caps-enforced-and-reported.test.js`
  - Build a small fixture; request deep expansion; assert caps trigger deterministically and truncation metadata is present.
- [ ] `tests/bench/graph-caps-harness-smoke.test.js`
  - Run the harness on a tiny in-tree fixture; assert it writes a results JSON file with required fields and deterministic ordering.

---

### 11.6 Cross-file API contracts (report + optional artifact)

- [ ] Provide an API-contract extraction/report surface based on existing artifacts (do not require new parsing).
  - For each exported symbol (as available via symbol artifacts):
    - canonical signature (declared + tooling-backed when available)
    - observed call signatures (from bounded callsite evidence / callDetails summaries)
    - compatibility warnings (arity mismatches, incompatible argument kinds, unresolved targets)
  - Output formats:
    - JSON (machine; versioned schema)
    - Markdown (human; deterministic ordering)
  - Strict caps:
    - max symbols analyzed per run
    - max calls sampled per symbol
    - max warnings emitted (with truncation metadata)

- [ ] CLI surface:
  - `pairofcleats api-contracts --repo … [--only-exports] [--fail-on-warn] --format json|md`

- [ ] Optional: enable an artifact emitter for downstream automation.
  - `api_contracts.jsonl` (one record per symbol) with strict schema validation and caps.

#### Tests
- [ ] `tests/contracts/api-contracts-basic.test.js`
  - Fixture with an exported function called with multiple shapes; assert contract report includes observed calls and a mismatch warning.
- [ ] `tests/contracts/api-contracts-caps.test.js`
  - Trigger caps; assert truncation metadata is present and stable.

---

### 11.7 Architecture slicing and boundary enforcement (rules + CI-friendly output)

- [ ] Add a rules format for architectural constraints over graphs.
  - Rule types (minimum viable):
    - forbidden edges by path glob/module group (importGraph)
    - forbidden call edges by symbol tags or file globs (callGraph)
    - layering rules (optional; best-effort) that detect edges going “up-layer”
  - Outputs:
    - bounded report with counts, top offending edges, and a deterministic ordering
    - CI-friendly JSON (versioned schema)

- [ ] CLI surface:
  - `pairofcleats architecture-check --repo … --rules <path> --format json|md [--fail-on-violation]`

#### Tests
- [ ] `tests/architecture/forbidden-import-edge.test.js`
  - Fixture with a forbidden import; assert violation is reported deterministically.
- [ ] `tests/architecture/report-is-bounded.test.js`
  - Large fixture triggers caps; assert truncation metadata exists and report remains parseable.

---

### 11.8 Test selection heuristics (suggest tests impacted by a change set)

- [ ] Implement a bounded, deterministic test suggestion tool that uses graphs when available.
  - Identify tests using path conventions and language-aware patterns:
    - `*.test.*`, `*_test.*`, `/tests/`, `__tests__/`, etc.
  - Given a changed set (`--changed <file>` repeated or a file list):
    - map changed files/symbols to seed nodes
    - traverse upstream/downstream within caps
    - rank candidate tests based on witness paths, proximity, and (optional) centrality
  - Output:
    - top-K suggested tests + brief rationale (witness path summary), bounded and deterministic

- [ ] CLI surface:
  - `pairofcleats suggest-tests --repo … --changed <...> --max 50 --format json|md`

#### Tests
- [ ] `tests/tests-selection/suggest-tests-basic.test.js`
  - Fixture where a changed function is called by a test; assert the test is suggested.
- [ ] `tests/tests-selection/suggest-tests-bounded.test.js`
  - Trigger caps; assert truncation metadata is present and ordering is stable.

Touchpoints (consolidated):
- `src/retrieval/rankers.js` (add graph-aware ranker; keep it opt-in)
- `src/retrieval/pipeline.js` (ranker selection + scoring integration)
- `src/retrieval/query-intent.js` (intent signals used by ranker)
- `src/graph/*` (re-use context pack + neighborhood metadata for ranking features)
- `src/retrieval/cli/options.js` + `bin/pairofcleats.js` (flags: `--rank graph`, `--rank-default <...>`)
- `src/retrieval/output/explain.js` (surface ranker contributions in explain)
- `docs/contracts/search-cli.md` (document ranker options + explain additions)

---

