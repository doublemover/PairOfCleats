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
    - 11.0 - Shared Foundations (contracts, determinism, config)
    - 11.1 - Graph Context Packs (bounded neighborhood extraction) + retrieval context-expansion hardening
    - 11.2 - Impact Analysis (callers/callees + k-hop impact radius) with witness paths
    - 11.3 - Context Pack Assembly for Tooling/LLM (chunk text + graph + types + risk) + explainability rendering
    - 11.4 - Graph-Aware Ranking Hooks (opt-in) + Explainability
    - 11.5 - Graph Expansion Caps as a Config Surface + Calibration Harness (language × size tier)
    - 11.6 - Cross-file API Contracts (report + optional artifact)
    - 11.7 - Architecture Slicing & Boundary Enforcement 
    - 11.8 - Test Selection Heuristics 
    - 11.9 - Docs + CLI Wiring

---

## Phase 11 — Graph-powered product features (context packs, impact, explainability, ranking)

### Objective
Turn graph and identity primitives into **safe, bounded, deterministic** product surfaces: graph context packs, impact analysis, explainable graph-aware ranking (opt-in), and structured outputs suitable for both CLI use and future API/MCP consumers.

- Assumes canonical identities exist (e.g., chunkUid/SymbolId and a canonical reference envelope for unresolved/ambiguous links).
- Any graph expansion MUST be bounded and MUST return truncation metadata when caps trigger (depth/fanout/paths/nodes/edges/candidates/work-units/wall-clock).
- The default search contract must remain stable: graph features can change ordering when enabled, but must not change membership/correctness.
- Outputs are JSON-first (schema-validated); Markdown render is optional and deterministic.

---

### 11.0 Shared foundations (contracts, determinism, config)

- [ ] Define Phase 11 shared contract types (authoritative spec: `docs/phases/phase-11/spec.md`):
  - `NodeRef` (chunk/symbol/file)
  - `ReferenceEnvelope` (resolved/ambiguous/unresolved + bounded candidates)
  - `WarningRecord`
  - `TruncationRecord`
  - stable ordering rules (nodeKey/edgeKey)
- [ ] Add provenance metadata requirements for all Phase 11 JSON outputs:
  - `generatedAt`
  - `indexCompatKey` or `indexSignature`
  - `capsUsed`
  - optional `repo` / `indexDir`
- [ ] Add schemas in `src/contracts/schemas/analysis.js`:
  - `GRAPH_CONTEXT_PACK_SCHEMA`
  - `GRAPH_IMPACT_SCHEMA`
  - `COMPOSITE_CONTEXT_PACK_SCHEMA`
  - `API_CONTRACTS_SCHEMA`
  - `ARCHITECTURE_REPORT_SCHEMA`
  - `SUGGEST_TESTS_SCHEMA`
- [ ] Add validators in `src/contracts/validators/analysis.js`.

- [ ] Determinism helpers + work-budget caps.
  - Add stable comparator utilities for NodeRef/edges/paths.
  - Add deterministic `maxWorkUnits` tracking (recommended for all traversals).
  - Treat `maxWallClockMs` as optional fuse; always record truncation when it triggers.
- [ ] Define deterministic `maxWallClockMs` semantics:
  - check cadence (e.g., every N work units)
  - stop only at step boundaries
  - emit truncation metadata with observed/omitted counts

- [ ] Config surface.
  - `indexing.graph.caps`
  - `retrieval.graph.caps`
  - `retrieval.graphRanking.*`
  - `retrieval.contextExpansion.*`
  - Touchpoints:
    - `docs/config/schema.json`
    - `tools/dict-utils/config.js`
    - `tools/validate-config.js`
    - `src/config/validate.js`

- [ ] Standardize module home for new graph tooling commands.
  - Use `src/integrations/tooling/` for new command handlers and renderers.
  - Keep graph primitives under `src/graph/` and pack assembly under `src/context-pack/`.

- [ ] Centralize artifact presence + loading for graph-powered features.
  - Add a single GraphStore + loader path used by all Phase 11 commands.
  - Touchpoints:
    - `src/shared/artifact-io/manifest.js`
    - `src/shared/artifact-io/loaders.js`
    - `src/graph/store.js`
    - `src/index/validate/presence.js` (optional artifacts)

- [ ] Move graph build caps + identity-first node IDs earlier (dependency for all consumers).
  - Update `src/index/build/graphs.js` to use config-driven caps and record which cap triggered.
  - Enforce identity-first graph node IDs for new writes (legacy read-compat only).
  - Touchpoints:
    - `src/index/build/graphs.js`
    - `src/index/build/indexer/steps/relations.js`
    - `src/index/build/artifacts/graph-relations.js` (if present) or the current writer location

- [ ] Define harness determinism controls:
  - `--outDir`, `--runId`
  - injectable date/time for CI to avoid `<date>` path drift

#### Tests
- [ ] `tests/contracts/analysis/phase11-schemas-validate.test.js`
  - Validate representative payload fixtures against each Phase 11 schema.

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
  - Graph filters (optional):
    - `graphs` (callGraph/importGraph/usageGraph/symbolEdges)
    - `edgeTypes` (call/usage/import/export/dataflow; `symbol_edges.type` when graph = symbolEdges)
    - `minConfidence` (0..1)
    - `includePaths` (emit witness paths)
  - Cap surface (configurable):
    - `maxDepth`, `maxFanoutPerNode`, `maxNodes`, `maxEdges`, `maxPaths`, `maxCandidates`, `maxWorkUnits`, `maxWallClockMs`.

- [ ] Add deterministic Markdown renderer for graph context packs.
  - `src/retrieval/output/graph-context-pack.js` (new; stable section ordering and formatting)

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

- [ ] Refactor `src/retrieval/context-expansion.js` to use the shared graph neighborhood utilities (do not make it the engine).
  - Touchpoints:
    - `src/retrieval/context-expansion.js`
    - `src/shared/artifact-io/manifest.js` (artifact presence checks via manifest)
  - [ ] Eliminate eager `{id, reason}` candidate explosion.
    - Convert candidate generation to a streaming/short-circuit loop that stops as soon as `maxPerHit` / `maxTotal` / `maxWorkUnits` is satisfied.
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

#### Tests (path-corrected for current test layout)
- [ ] `tests/retrieval/graph/context-pack-basic.test.js`
  - Build a small fixture graph; request a context pack for a known seed; assert expected caller/callee/import/usage neighbors are present.
- [ ] `tests/retrieval/graph/context-pack-caps.test.js`
  - Use a large synthetic graph fixture; assert truncation metadata is present and stable when caps trigger.
- [ ] `tests/retrieval/graph/context-pack-determinism.test.js`
  - Run the same request twice; assert stable ordering and identical payloads.
- [ ] `tests/retrieval/context-expansion/context-expansion-no-candidate-explosion.test.js`
  - Stress fixture with many relations; assert expansion completes within a time/memory budget and does not allocate unbounded candidate arrays.
- [ ] `tests/retrieval/context-expansion/context-expansion-reason-precedence.test.js`
  - A chunk reachable via multiple relation types records the highest-priority reason deterministically.
- [ ] `tests/retrieval/context-expansion/context-expansion-shuffled-chunkmeta.test.js`
  - Provide a shuffled `chunkMeta` where array index != docId; assert expansion still resolves correct chunks via a map-based dereference.
- [ ] `tests/retrieval/context-expansion/context-expansion-determinism.test.js`
  - Run expansion twice on the same fixture; assert stable ordering and identical results.

Fixture sources:
- `tests/fixtures/graph/context-pack/`
- `tests/fixtures/retrieval/context-expansion/`

Touchpoints (consolidated; anchors are approximate):
- `src/retrieval/context-expansion.js` (~L1 `pushIds`, ~L8 `buildContextIndex`, ~L77 `expandContext`)
- `src/shared/artifact-io/manifest.js` (~L254 `resolveArtifactPresence`)
- `src/shared/artifact-io/loaders.js` (~L312 `loadGraphRelations`)
- `src/graph/store.js` (new; manifest-aware graph loader + adjacency access)
- `src/graph/neighborhood.js` (new; deterministic bounded traversal)
- `src/graph/context-pack.js` (new; pack construction + truncation metadata)
- `src/retrieval/output/graph-context-pack.js` (new; deterministic Markdown renderer)
- `src/integrations/tooling/graph-context.js` (new; CLI command implementation)
- `src/retrieval/cli/index-loader.js` (~L73 `loadFileRelations`, ~L89 `loadRepoMap`; add `loadGraphRelations`)
- `src/retrieval/cli/run-search-session.js` (~L86 `contextExpansionEnabled`, ~L486 expansion block)
- `src/retrieval/cli/normalize-options.js` (~L173 `contextExpansionEnabled`)
- `src/retrieval/cli/options.js` + `src/retrieval/cli-args.js` (CLI flags/help)
- `src/retrieval/cli/render.js` (~L4 `renderSearchOutput`)
- `src/retrieval/output/context.js` (~L1 `cleanContext` for context-pack rendering)
- `bin/pairofcleats.js` (CLI wiring: `graph-context`)
- `src/contracts/schemas/analysis.js` (add `GRAPH_CONTEXT_PACK_SCHEMA`)
- `src/contracts/validators/analysis.js` (add `validateGraphContextPack`)
- `docs/contracts/analysis-schemas.md` + `docs/contracts/search-cli.md` (schema + CLI JSON)



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
  - Add graph filters: `--graphs`, `--edgeTypes`, `--minConfidence`.
  - Ensure the implementation is factored so an API/MCP handler can call the same core function with the same caps and output schema.

- [ ] Optional “changed-set” impact mode (non-blocking in this phase).
  - Accept `--changed <file>` repeated and `--changed-file <path>` (newline-separated paths) and compute:
    - impacted symbols in and around changed files, then traverse upstream/downstream bounded.
  - If `seed` is omitted, derive candidate seeds deterministically and emit a `ReferenceEnvelope` with bounded candidates.
  - If SCM integration is unavailable, degrade gracefully (explicit warning; still supports explicit `--changed` lists).
  - Specify deterministic changed-set → seed derivation:
    - ordering of derived seeds
    - max seeds cap + truncation behavior

#### Tests (path-corrected for current test layout)
- [ ] `tests/retrieval/graph/impact-analysis-downstream.test.js`
  - Seed a function; assert downstream impacted nodes include an expected callee and a witness path is returned.
- [ ] `tests/retrieval/graph/impact-analysis-upstream.test.js`
  - Seed a function; assert upstream impacted nodes include an expected caller and a witness path is returned.
- [ ] `tests/retrieval/graph/impact-analysis-caps-and-truncation.test.js`
  - Trigger caps deterministically; assert truncation metadata identifies which cap fired and results remain stable.
- [ ] `tests/retrieval/graph/impact-analysis-determinism.test.js`
  - Run the same request twice; assert stable ordering and identical payloads.
- [ ] `tests/retrieval/graph/impact-analysis-changed-set.test.js`
  - Provide `--changed` inputs; assert deterministic seed derivation and bounded output.

Fixture sources:
- `tests/fixtures/graph/impact/`

Touchpoints (consolidated; anchors are approximate):
- `src/graph/impact.js` (new; bounded impact analysis)
- `src/graph/witness-paths.js` (new; witness path reconstruction)
- `src/graph/neighborhood.js` (shared traversal primitives)
- `src/integrations/tooling/impact.js` (new; CLI command implementation)
- `src/integrations/tooling/render-impact.js` (new; stable human + JSON renderers)
- `bin/pairofcleats.js` (CLI wiring: `impact`)
- `src/contracts/schemas/analysis.js` (add `GRAPH_IMPACT_SCHEMA`)
- `src/contracts/validators/analysis.js` (add `validateGraphImpact`)
- `docs/contracts/analysis-schemas.md` + `docs/contracts/graph-tools-cli.md` (schema + CLI JSON)



---

### 11.3 Context pack assembly for tooling/LLM (chunk text + graph + types + risk) + explainability rendering

- [ ] Implement a “context pack assembler” that composes multiple bounded slices into a single package.
  - Inputs:
    - `seed` (chunkUid/SymbolId)
    - budgets (`maxTokens` and/or `maxBytes`, plus graph caps)
    - toggles (includeGraph, includeTypes, includeRisk, includeImports, includeUsages, includeCallersCallees)
    - per-slice caps (`maxTypeEntries`, `maxRiskFlows`, `maxRiskEvidencePerFlow`)
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
  - Add toggles: `--includeGraph`, `--includeTypes`, `--includeRisk`, `--includeImports`, `--includeUsages`, `--includeCallersCallees`
  - Add per-slice caps: `--maxTypeEntries`, `--riskMaxFlows`, `--riskMaxEvidencePerFlow`
  - For Markdown output, use consistent sections and a deterministic ordering (primary first, then callers/callees, then imports/usages, then risk).

- [ ] Add explain-risk rendering for flows when risk artifacts exist.
  - Provide an output mode (flag or subcommand) that prints:
    - the path of symbols/chunks
    - file/line evidence (callsites) when present
    - rule ids/categories and confidence
    - bounded snippets or snippet hashes (never unbounded)
  - Ensure output is stable, capped, and does not assume optional color helpers exist.

- [ ] Define excerpt whitespace policy:
  - clarify when indentation is preserved (code excerpts) vs normalized (summary/output cleaning)
  - document how `cleanContext()` interacts with excerpt rendering

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

#### Tests (path-corrected for current test layout)
- [ ] `tests/retrieval/context-pack/context-pack-assembly.test.js`
  - Build fixture; assemble a context pack; assert it contains primary + at least one neighbor + deterministic truncation structure.
- [ ] `tests/retrieval/output/risk-explain-render.test.js`
  - Use a risk-flow fixture; assert output includes a call path and evidence coordinates and remains bounded.
- [ ] `tests/retrieval/output/clean-context-fences.test.js`
  - Ensure ```ts / ```json fences are removed (not just bare ```).
- [ ] `tests/retrieval/output/clean-context-nonstring-guard.test.js`
  - Feed non-string items; assert no crash and only string lines survive.
- [ ] `tests/retrieval/output/explain-color-fallback.test.js`
  - Provide a partial color impl; assert explain rendering does not throw.

Fixture sources:
- `tests/fixtures/context-pack/`
- `tests/fixtures/risk/`

Touchpoints (consolidated):
- `src/context-pack/assemble.js` (new; bounded pack assembly)
- `src/graph/context-pack.js` + `src/graph/neighborhood.js` (graph slice + traversal)
- `src/retrieval/output/context.js` (~L1 `cleanContext`; hardening: fence stripping, type guards)
- `src/retrieval/output/explain.js` (~L1 `formatExplainLine`; null-safe + color fallback)
- `src/retrieval/output/graph-context-pack.js` (new; deterministic Markdown renderer)
- `src/integrations/tooling/context-pack.js` (new; CLI command implementation)
- `bin/pairofcleats.js` (CLI wiring: `context-pack`)
- `docs/contracts/analysis-schemas.md` + `docs/contracts/graph-tools-cli.md` (schema + CLI JSON)



---

### 11.4 Graph-aware ranking hooks (opt-in) + explainability

- [ ] Introduce optional graph-aware ranking features that can be enabled without changing result membership.
  - Candidate feature families (bounded, deterministic):
    - node degree / in-degree / out-degree (prefer precomputed analytics artifacts when available)
    - proximity to the query-hit seed within the graph neighborhood (bounded k-hop)
    - proximity to risk hotspots (if risk summaries/flows exist)
    - same-cluster bonus (only if clustering artifacts exist; otherwise skip and emit a warning)
  - Guardrails:
    - Never compute expensive global graph metrics per query unless explicitly cached and bounded.
    - Default behavior remains unchanged unless explicitly enabled.
  - Define caching/analytics plan:
    - precomputed artifact vs session cache decision
    - schema and loader if artifact-based
  - Define tie-breaker rules for equal graph deltas/features.

- [ ] Integrate into retrieval ranking with an explicit feature-hook layer.
  - Touchpoints (expected; anchors are approximate):
    - `src/retrieval/pipeline.js` (~L25 `createSearchPipeline`; scoring assembly + explain output)
    - `src/retrieval/cli/run-search-session.js` (~L86 context options + ~L486 expansion block)
    - `src/retrieval/cli/normalize-options.js` (~L173 context defaults; add graph ranking config)
    - `src/retrieval/cli/options.js` + `src/retrieval/cli-args.js` (flag plumbing + help text)
    - `src/retrieval/output/explain.js` (~L12 `formatScoreBreakdown` for graph section)
  - Configuration:
    - `retrieval.graphRanking.enabled` (default false)
    - `retrieval.graphRanking.weights` (explicit; versioned defaults)
    - `retrieval.graphRanking.maxGraphWorkUnits` (deterministic cap)
    - optional `retrieval.graphRanking.maxWallClockMs` (fuse)
    - optional `retrieval.graphRanking.seedSelection`
    - optional `retrieval.graphRanking.seedK`
    - CLI mapping (must remain in sync with docs):
      - `--graph-ranking-max-work` -> `retrieval.graphRanking.maxGraphWorkUnits`
      - `--graph-ranking-max-ms` -> `retrieval.graphRanking.maxWallClockMs`
      - `--graph-ranking-seeds` -> `retrieval.graphRanking.seedSelection`
      - `--graph-ranking-seed-k` -> `retrieval.graphRanking.seedK`
  - Explainability:
    - When `--explain` (or a dedicated `--explain-ranking`) is enabled, include a `graph` section in the score breakdown:
      - feature contributions and the final blended delta.

#### Tests (path-corrected for current test layout)
- [ ] `tests/retrieval/ranking/graph-ranking-toggle.test.js`
  - Run the same query with graph ranking off/on; assert result sets are identical but ordering may differ.
- [ ] `tests/retrieval/ranking/graph-ranking-explain.test.js`
  - With explain enabled, assert output includes named graph feature contributions.
- [ ] `tests/retrieval/ranking/graph-ranking-determinism.test.js`
  - Re-run the same query twice with graph ranking enabled; assert ordering and explain payload are stable.
- [ ] `tests/retrieval/ranking/graph-ranking-membership-invariant.test.js`
  - Run the same query with graph ranking on/off; assert result membership is identical.

---

### 11.5 Graph expansion caps as a config surface + calibration harness (language × size tier)

- [ ] Align cap vocabulary across indexing + retrieval (depends on 11.0 graph caps update).
  - Ensure all expansions use the same cap names and truncation metadata semantics.
  - Touchpoints:
    - `src/retrieval/context-expansion.js` (cap naming + truncation records)
    - `src/graph/neighborhood.js`
    - `docs/perf/graph-caps.md`
  - Required behavior:
    - Every expansion returns truncation metadata when it truncates.
    - Truncation metadata indicates which cap fired and provides counts (omitted nodes/edges/paths) when measurable.

- [ ] Implement a metrics-harvesting harness to justify default caps.
  - Inputs:
    - Use/extend `benchmarks/repos.json` to define repos.
    - Normalize into tiers: small / typical / large / huge / problematic(massive).
    - Define numeric tier thresholds for `small/typical/large/huge/problematic`.
  - For each repo/tier (outside CI for huge/problematic):
    - run indexing with graphs enabled
    - compute graph distributions (node/edge counts, degree stats, SCC size)
    - run bounded neighborhood expansions for representative seeds (random, top-degree, entrypoints)
    - record timing and output sizes
  - Outputs:
    - versioned bundle under `benchmarks/results/<date>/graph-caps/`
    - machine-readable defaults: `docs/perf/graph-caps-defaults.json` (new; keyed by language and optional tier)
    - documentation: `docs/perf/graph-caps.md` (p95 behavior for typical tier + presets for huge/problematic)
  - Define default-selection logic:
    - explicit rule for converting harness measurements into `graph-caps-defaults.json`

#### Tests (path-corrected for current test layout)
- [ ] `tests/indexing/graphs/caps-enforced-and-reported.test.js`
  - Build a small fixture; request deep expansion; assert caps trigger deterministically and truncation metadata is present.
- [ ] `tests/perf/bench/graph-caps-harness-smoke.test.js`
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
  - Define API contract source precedence + sampling rules:
    - exported symbol identification precedence
    - canonical signature source precedence
    - deterministic call sampling rules
    - warning/mismatch criteria (language-aware + confidence)

- [ ] CLI surface:
  - `pairofcleats api-contracts --repo … [--only-exports] [--fail-on-warn] --format json|md`

- [ ] Optional: enable an artifact emitter for downstream automation.
  - `api_contracts.jsonl` (one record per symbol) with strict schema validation and caps.

#### Tests (path-corrected for current test layout)
- [ ] `tests/tooling/api-contracts/api-contracts-basic.test.js`
  - Fixture with an exported function called with multiple shapes; assert contract report includes observed calls and a mismatch warning.
- [ ] `tests/tooling/api-contracts/api-contracts-caps.test.js`
  - Trigger caps; assert truncation metadata is present and stable.
- [ ] `tests/tooling/api-contracts/api-contracts-fail-on-warn.test.js`
  - Ensure `--fail-on-warn` yields non-zero exit when warnings are present.
- [ ] `tests/tooling/api-contracts/api-contracts-schema-validate.test.js`
  - Validate output against `API_CONTRACTS_SCHEMA` (including truncation + warnings).

Fixture sources:
- `tests/fixtures/tooling/api-contracts/`

Touchpoints (consolidated; anchors are approximate):
- `src/integrations/tooling/api-contracts.js` (new; report builder)
- `src/shared/artifact-io/loaders.js` (~L312 `loadGraphRelations`; add loaders for call_sites/symbols as needed)
- `src/contracts/schemas/analysis.js` (add `API_CONTRACTS_SCHEMA`)
- `src/contracts/validators/analysis.js` (add `validateApiContracts`)
- `src/contracts/schemas/artifacts.js` (add `api_contracts` artifact schema if emitted)
- `src/index/validate.js` (strict validation for new artifact)
- `bin/pairofcleats.js` (CLI wiring: `api-contracts`)
- `docs/contracts/analysis-schemas.md` + `docs/contracts/graph-tools-cli.md` (schema + CLI JSON)

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
  - Add reusable module groups:
    - named selector sets referenced by rules

- [ ] CLI surface:
  - `pairofcleats architecture-check --repo … --rules <path> --format json|md [--fail-on-violation]`

#### Tests (path-corrected for current test layout)
- [ ] `tests/tooling/architecture/forbidden-import-edge.test.js`
  - Fixture with a forbidden import; assert violation is reported deterministically.
- [ ] `tests/tooling/architecture/forbidden-call-edge.test.js`
  - Fixture with a forbidden call edge; assert violation is reported deterministically.
- [ ] `tests/tooling/architecture/report-is-bounded.test.js`
  - Large fixture triggers caps; assert truncation metadata exists and report remains parseable.
- [ ] `tests/tooling/architecture/report-determinism.test.js`
  - Run the same rules twice; assert ordering and output are identical.

Fixture sources:
- `tests/fixtures/tooling/architecture/`

Touchpoints (consolidated; anchors are approximate):
- `src/graph/architecture.js` (new; rule evaluation)
- `src/graph/neighborhood.js` (shared traversal primitives)
- `src/integrations/tooling/architecture-check.js` (new; CLI command implementation)
- `src/contracts/schemas/analysis.js` (add `ARCHITECTURE_REPORT_SCHEMA`)
- `src/contracts/validators/analysis.js` (add `validateArchitectureReport`)
- `bin/pairofcleats.js` (CLI wiring: `architecture-check`)
- `docs/contracts/analysis-schemas.md` + `docs/contracts/graph-tools-cli.md` (schema + CLI JSON)

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
  - Specify deterministic changed-set → seed derivation:
    - ordering of derived seeds
    - max seeds cap + truncation behavior
  - Define fallback behavior when graph artifacts are missing:
    - heuristic fallback (e.g., path-based test discovery)
    - required warning codes

- [ ] CLI surface:
  - `pairofcleats suggest-tests --repo … --changed <...> --max 50 --format json|md`

#### Tests (path-corrected for current test layout)
- [ ] `tests/tooling/test-selection/suggest-tests-basic.test.js`
  - Fixture where a changed function is called by a test; assert the test is suggested.
- [ ] `tests/tooling/test-selection/suggest-tests-bounded.test.js`
  - Trigger caps; assert truncation metadata is present and ordering is stable.
- [ ] `tests/tooling/test-selection/suggest-tests-determinism.test.js`
  - Run the same input twice; assert stable ordering and identical output.
- [ ] `tests/tooling/test-selection/suggest-tests-witness-path.test.js`
  - Ensure witness path summary is present and bounded when available.

Fixture sources:
- `tests/fixtures/tooling/suggest-tests/`

Touchpoints (test selection):
- `src/integrations/tooling/suggest-tests.js` (new; core suggestion engine)
- `src/graph/store.js` + `src/graph/neighborhood.js` (shared traversal + loading)
- `bin/pairofcleats.js` (CLI wiring: `suggest-tests`)
- `docs/contracts/analysis-schemas.md` + `docs/contracts/graph-tools-cli.md` (schema + CLI JSON)

---

### 11.9 Docs + CLI wiring

#### 11.9.1 CLI wiring
- [ ] Update `bin/pairofcleats.js`:
  - add new commands (graph-context, impact, context-pack, api-contracts, architecture-check, suggest-tests)
  - remove/repair stale `search` flag allowlist validation so wrapper accepts all supported search flags
- [ ] Implement per-command handlers under `src/integrations/tooling/`:
  - `graph-context.js`, `impact.js`, `context-pack.js`, `api-contracts.js`, `architecture-check.js`, `suggest-tests.js`

#### 11.9.2 Documentation updates
- [ ] Update:
  - `docs/contracts/analysis-schemas.md`
  - `docs/contracts/search-cli.md`
  - `docs/contracts/mcp-api.md`
- [ ] Add:
  - `docs/contracts/graph-tools-cli.md`
  - `docs/perf/graph-caps.md`
  - `docs/phases/phase-11/spec.md`

---

### Phase 11 schema summary (authoritative spec: `docs/phases/phase-11/spec.md`)

- Shared types:
  - `NodeRef` (chunk/symbol/file)
  - `ReferenceEnvelope` (resolved/ambiguous/unresolved + bounded candidates)
  - `TruncationRecord` + `WarningRecord` (bounded)
- Graph context pack:
  - `{ version, seed, nodes[], edges[], paths?, truncation?, warnings?, stats? }`
- Impact analysis:
  - `{ version, seed, direction, depth, impacted[], truncation?, warnings? }`
- Composite context pack:
  - `{ version, seed, primary, graph?, types?, risk?, truncation?, warnings? }`
- API contracts report:
  - `{ version, generatedAt, options, symbols[], truncation?, warnings? }`
- Architecture report:
  - `{ version, rules[], violations[], truncation?, warnings? }`
- Suggest-tests:
  - `{ version, changed[], suggestions[], truncation?, warnings? }`


