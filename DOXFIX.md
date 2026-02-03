# DOXFIX Roadmap (Subsystem Checklists)

Purpose: reconcile documentation vs code behavior across `docs/**` using `COSMIC_DOCS_LEDGER.md`. This roadmap is organized by subsystem with granular checklists, decisions, and touchpoints (line numbers where known).

Legend:
- [DOC] update documentation only
- [CODE] change implementation to match canonical docs/specs
- [DECISION] pick the canonical behavior first, then update doc/code
- Touchpoints include file paths, symbols, and line numbers when helpful

---

## Decision register (choose canonical behavior up front)

Defaults below are recommendations to keep scope controlled. If you prefer different choices, call them out and I’ll update the register.

1) **`api_contracts_meta` existence**  
   - Options: add schema + writer vs remove from docs  
   - **Chosen:** remove from docs (no schema in `ARTIFACT_SCHEMA_DEFS`).

2) **N‑1 major support for 0.x artifact surfaces**  
   - Options: change code to support N‑1 vs document current behavior  
   - **Chosen:** document current behavior (0.x supports current major only).

3) **`extensions`-only vs extra top‑level fields**  
   - Options: tighten schemas vs relax docs  
   - **Chosen:** relax docs to allow additionalProperties (current schema behavior).

4) **Graph explain shape** (`scoreBreakdown.graph`)  
   - Options: change output to match docs vs update docs  
   - **Chosen:** update docs to match current output (`score`, `degree`, `proximity`, `weights`, `seedSelection`, `seedK`).

5) **Impact input requirement** (seed/changed)  
   - Options: enforce non‑empty requirement vs document warning+empty result  
   - **Chosen:** document warning+empty result unless you want stricter enforcement.

6) **Graph product surfaces doc** (`docs/specs/graph-product-surfaces.md`)  
   - Options: keep authoritative and update vs archive  
   - **Chosen:** keep authoritative and update (still referenced by search-contract).

7) **Risk specs trimming/ordering vs implementation**  
   - Options: enforce spec in code vs update spec to current behavior  
   - **Chosen:** update specs to current behavior unless you want to tighten runtime behavior.

8) **Tooling IO `fileTextByFile` cache**  
   - Options: implement cache in providers vs update spec to VFS approach  
   - **Chosen:** update spec to VFS approach.

9) **TypeScript provider JS parity** (heuristic SymbolRef IDs)  
   - Options: remove heuristic IDs in code vs update spec to allow them  
   - **Chosen:** update spec to allow heuristics (document rationale).

10) **VFS manifest trimming vs row drop**  
   - Options: enforce deterministic trimming before drop vs update spec  
   - **Chosen:** update spec to current drop behavior unless you want stricter output.

11) **`docs/new_docs/*` promotion**  
   - Options: promote into `docs/specs/*` vs archive/remove  
   - **Chosen:** promote into `docs/specs/*` if still relevant to current plans.

---

## Priority tiers (batch execution order)

**P0 – Contract correctness (affects validation / tooling expectations)**  
- Contracts: `analysis-schemas`, `artifact-schemas`, `public-artifact-surface`, `sqlite`, `search-contract`  
- Specs: risk specs, artifact schemas, analysis schemas  
- Decision items: #1, #2, #3, #7

**P1 – CLI & API parity (user‑visible behavior)**  
- Guides + API docs: search/graph flags, backend selection, mcp server usage  
- Decision items: #4, #5, #6

**P2 – Performance + ops docs**  
- perf/benchmarks, thread defaults, bench entrypoints

**P3 – Long‑term specs (federation/workspace/tooling)**  
- workspace specs, tooling IO, provider registry, VFS details  
- Decision items: #8, #9, #10, #11

---

## Parallelization bundles (for sub‑agents)

Goal: keep bundles small and similar in effort so no single worker becomes the tail. Each bundle should be independently executable and reviewable.

**Bundle A — Contracts core**  
- Files: `docs/contracts/analysis-schemas.md`, `docs/contracts/artifact-contract.md`, `docs/contracts/artifact-schemas.md`, `docs/contracts/public-artifact-surface.md`, `docs/contracts/sqlite.md`  
- Canonical: `src/contracts/schemas/*.js`, `src/contracts/validators/*.js`, `src/shared/artifact-io/*`, `src/storage/sqlite/schema.js`

**Bundle B — Contracts search/graph**  
- Files: `docs/contracts/graph-tools-cli.md`, `docs/contracts/retrieval-ranking.md`, `docs/contracts/search-cli.md`, `docs/contracts/search-contract.md`, `docs/contracts/indexing.md`  
- Canonical: `src/retrieval/*`, `src/graph/*`, `src/shared/artifact-io/*`

**Bundle C — Guides (search + core CLI)**  
- Files: `docs/guides/search.md`, `docs/guides/commands.md`, `docs/guides/external-backends.md`, `docs/guides/editor-integration.md`, `docs/guides/query-cache.md`  
- Canonical: `bin/pairofcleats.js`, `src/retrieval/*`, `tools/metrics-dashboard.js`

**Bundle D — Guides (tooling + services)**  
- Files: `docs/guides/mcp.md`, `docs/guides/structural-search.md`, `docs/guides/rule-packs.md`, `docs/guides/triage-records.md`, `docs/guides/service-mode.md`, `docs/guides/metrics-dashboard.md`  
- Canonical: `tools/*` entrypoints, `tools/mcp-server.js`, `tools/triage/*`, `tools/structural-search.js`, `tools/indexer-service.js`

**Bundle E — API docs**  
- Files: `docs/api/core-api.md`, `docs/api/server.md`, `docs/api/mcp-server.md`  
- Canonical: `tools/api/*`, `src/integrations/core/*`, `tools/api-server.js`

**Bundle F — Config docs**  
- Files: `docs/config/contract.md`, `docs/config/env-overrides.md`, `docs/config/budgets.md`, `docs/config/surface-directives.md`, `docs/config/deprecations.md`, `docs/config/execution-plan.md`, `docs/config/hard-cut.md`  
- Canonical: `docs/config/schema.json`, `src/shared/env.js`, `tools/config-inventory/*`

**Bundle G — Testing docs**  
- Files: `docs/testing/ci-capability-policy.md`, `docs/testing/failing-tests.md`, `docs/testing/test-decomposition-regrouping.md`, `docs/testing/test-runner-interface.md`  
- Canonical: `tests/run.js`, `tests/run.rules.jsonc`, `tests/tooling/script-coverage/*`, `tools/ci/*`

**Bundle H — Tooling ingest + inventory**  
- Files: `docs/tooling/ctags.md`, `docs/tooling/gtags.md`, `docs/tooling/lsif.md`, `docs/tooling/scip.md`, `docs/tooling/repo-inventory.json` (+ new `repo-inventory.md`)  
- Canonical: `tools/*-ingest.js`, `tools/repo-inventory.js`

**Bundle I — Benchmarks + language benchmarks**  
- Files: `docs/benchmarks/overview.md`, `docs/benchmarks/evaluation.md`, `docs/benchmarks/model-comparison.md`, `docs/language/benchmarks.md`  
- Canonical: `tools/bench/*`, `tools/bench-language-repos.js`, `tools/bench/language/cli.js`, `tools/bench-language-matrix.js`, `src/shared/cli-options.js`

**Bundle J — Perf (graph caps)**  
- Files: `docs/perf/graph-caps.md`, `docs/perf/graph-caps-defaults.json`  
- Canonical: `tools/bench/graph-caps-harness.js`

**Bundle K — Specs (artifacts + risk)**  
- Files: `docs/specs/analysis-schemas.md`, `docs/specs/artifact-schemas.md`, `docs/specs/risk-*.md`  
- Canonical: `src/contracts/schemas/artifacts.js`, `src/contracts/schemas/analysis.js`, `src/index/build/artifacts/writers/*`

**Bundle L — Specs (tooling + SCM + workspace)**  
- Files: `docs/specs/runtime-envelope.md`, `docs/specs/safe-regex-hardening.md`, `docs/specs/tooling-*.md`, `docs/specs/typescript-provider-js-parity.md`, `docs/specs/vfs-manifest-artifact.md`, `docs/specs/scm-provider-*.md`, `docs/specs/workspace-*.md`  
- Canonical: `src/index/tooling/*`, `src/index/scm/providers/*`, `src/shared/runtime-envelope.js`, `src/shared/safe-regex.js`, `docs/config/schema.json`

**Bundle M — Archived + deliverables**  
- Files: `docs/archived/*`, `COSMIC_DOCS_LEDGER.md`  
- Canonical: updated docs/specs after Bundles A–L complete

---

## 0) Canonical source decisions (must do first)

[x] [DECISION] Confirm canonical source per domain:
    - Contracts: `docs/contracts/*` + `src/contracts/**`
    - Specs: `docs/specs/*` only where referenced as canonical
    - Guides: `docs/guides/*` should match `bin/pairofcleats.js` and tool entrypoints
    - Testing: `docs/testing/*` should match `tests/run.js` + `tests/run.rules.jsonc`

[x] [DECISION] For each mismatch below, choose "doc fix" vs "code fix" and log it inline (default to doc fixes unless explicitly marked [CODE]).

---

## 1) Contracts subsystem (docs/contracts)

### 1.1 docs/contracts/analysis-schemas.md
- Issue: API contracts doc omits required `options` object.

[x] [DOC] Add `options` to API contracts section (onlyExports, failOnWarn, caps).
    - Touchpoints:
      - `src/contracts/schemas/analysis.js` ~L684 (`API_CONTRACTS_SCHEMA`)
      - `src/contracts/validators/analysis.js` ~L77 (`validateApiContracts`)
    - Fields to list explicitly:
      - `options.onlyExports`, `options.failOnWarn`, `options.caps.maxSymbols`, `options.caps.maxCallsPerSymbol`, `options.caps.maxWarnings`
[x] [DOC] Add `diagnostics` to risk rule bundles (`warnings`, `errors`) to match schema.
    - Touchpoints:
      - `src/contracts/schemas/analysis.js` ~L220 (risk rules diagnostics)

### 1.2 docs/contracts/artifact-contract.md
- Issues: legacy sharded meta format; compressed sidecar precedence described incorrectly.

[x] [DOC] Replace sharded JSONL meta description with jsonl-sharded schema.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L317 (`baseShardedJsonlMeta`)
    - Required fields to document:
      - `schemaVersion`, `format=jsonl-sharded`, `compression`, `totalRecords`, `totalBytes`, `maxPartBytes`, `targetMaxBytes`, `parts[]`
[x] [DOC] Fix loader precedence: raw `.json` first, compressed sidecars only when raw missing.
    - Touchpoints:
      - `src/shared/artifact-io/json.js` ~L16 (`readJsonFile`)
      - `src/shared/artifact-io/loaders.js` ~L20 (`resolveJsonlArtifactSources`)
    - Note:
      - `readJsonFile` does **not** prefer `.json.zst` when `.json` exists.

### 1.3 docs/contracts/artifact-schemas.md
- Issues: missing artifacts; `api_contracts_meta` mismatch; missing required fields.

[x] [DOC] Add missing artifacts: `chunk_uid_map`, `vfs_manifest`, `risk_summaries`, `risk_flows`, `risk_interprocedural_stats`, and their `*_meta` if present.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L810 (`ARTIFACT_SCHEMA_DEFS`)
[x] [DECISION] `api_contracts_meta`: add schema or remove from doc.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L810
[x] [DOC] Document required `kind` field for `import_resolution_graph` edges.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L1151 (`import_resolution_graph`)
[x] [DOC] Document `index_state.riskInterprocedural` object and required fields.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L1085 (`updatedAt`)
      - `src/contracts/schemas/artifacts.js` ~L1101 (`riskInterprocedural`)
[x] [CODE] Export `docs/contracts/artifact-schema-index.json` (schema registry → required fields + version).
    - Touchpoints:
      - `tools/export-artifact-schema-index.js` (new)
      - `src/contracts/schemas/artifacts.js`
    - Tests:
      - `tests/tooling/docs/artifact-schema-index.test.js` (new)
    - Suggested output schema:
      - `{ artifact, schemaVersion, requiredFields[], optionalFields[] }` for each entry.

### 1.4 docs/contracts/compatibility-key.md
- Issue: wrong callsite path.

[x] [DOC] Fix reference to `src/integrations/core/build-index/compatibility.js`.
    - Touchpoints:
      - `src/integrations/core/build-index/compatibility.js` (search `buildCompatibilityKey`)

### 1.5 docs/contracts/graph-tools-cli.md
- Issue: doc requires seed/changed; CLI allows empty with warning.

[x] [DECISION] Enforce seed/changed in CLI or update doc to match warning behavior.
    - Touchpoints:
      - `src/graph/impact.js` (`buildImpactAnalysis` warning)
      - `src/integrations/tooling/impact.js`

### 1.6 docs/contracts/indexing.md
- Issues: sharded meta format + compression precedence outdated.

[x] [DOC] Update sharded JSONL meta section (jsonl-sharded schema).
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L317
[x] [DOC] Update compression precedence (raw-first).
    - Touchpoints:
      - `src/shared/artifact-io/json.js` ~L16

### 1.7 docs/contracts/public-artifact-surface.md
- Issues: N-1 major support for 0.x; extensions-only rule mismatch.

[x] [DECISION] Choose: support N-1 majors for 0.x in code or update doc to state 0.x is current-only.
    - Touchpoints:
      - `src/contracts/versioning.js` ~L19 (`resolveSupportedMajors`)
[x] [DECISION] Choose: tighten schema to require `extensions` only or update doc to allow additional top-level fields.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` (additionalProperties in schema defs)

### 1.8 docs/contracts/retrieval-ranking.md
- Issue: graph explain shape mismatch.

[x] [DECISION] Align doc with current `scoreBreakdown.graph` (score, degree, proximity, weights, seedSelection, seedK) or change output to match doc.
    - Touchpoints:
      - `src/retrieval/output/explain.js` ~L57
      - `src/retrieval/pipeline/graph-ranking.js` ~L125

### 1.9 docs/contracts/search-cli.md
- Issues: missing flags; context expansion flags not present; `--filter` described as substring.

[x] [DOC] Update flags list to current CLI.
    - Touchpoints:
      - `src/retrieval/cli-args.js` ~L98-149
[x] [DOC] Clarify `--filter` as filter expression.
    - Touchpoints:
      - `src/retrieval/cli/normalize-options.js` ~L82 (`parseFilterExpression`)

### 1.10 docs/contracts/search-contract.md
- Issue: `--kind` vs `--type`.

[x] [DOC] Update flag name to `--type`.
    - Touchpoints:
      - `src/retrieval/cli-args.js`

### 1.11 docs/contracts/sqlite.md
- Issue: required tables list incomplete.

[x] [DOC] Update required tables list to include `doc_lengths`, `token_stats`, `phrase_vocab`, `phrase_postings`, `chargram_vocab`, `chargram_postings`, `file_manifest`.
    - Touchpoints:
      - `src/storage/sqlite/schema.js` ~L3 (`REQUIRED_TABLES`)

---

## 2) Guides subsystem (docs/guides)

### 2.1 docs/guides/editor-integration.md
[x] [DOC] Update JSON output fields list (add `extractedProse`).
    - Touchpoints:
      - `src/retrieval/cli/render.js` L51‑75 (extractedProse output)
      - `src/retrieval/cli/render.js` L100‑125 (availability flags)
[x] [DOC] Tie "Compact hit fields" to `--compact` (or `--json --compact`), not plain `--json`.
    - Touchpoints:
      - `src/retrieval/cli-args.js` L32 (compact flag)
      - `src/retrieval/cli/render.js` L73‑75 (compact mapping)

### 2.2 docs/guides/external-backends.md
[x] [DOC] Note `pairofcleats search` accepts `--backend memory` (wrapper passes flags through).
[x] [DOC] Document forced backend behavior (no fallback if required indexes missing).
    - Touchpoints:
      - `bin/pairofcleats.js` L64‑70 (search wrapper)
      - `src/storage/backend-policy.js` L8‑138 (forced backend selection + errors)
      - `src/retrieval/cli-args.js` L22‑60 (full CLI supports memory)
[x] [DOC] Correct default backend (sqlite, not sqlite-fts).
    - Touchpoints:
      - `src/storage/backend-policy.js` L8‑138

### 2.3 docs/guides/mcp.md
[x] [DOC] Replace `pairofcleats service mcp` with `node tools/mcp-server.js`.
    - Touchpoints:
      - `bin/pairofcleats.js` L266‑285 (service subcommands exclude mcp)
      - `tools/mcp-server.js` L10‑41 (actual entrypoint + mode selection)

### 2.4 docs/guides/metrics-dashboard.md
[x] [DOC] Remove unsupported fields or implement them (cache hit rate, BM25 params, timings).
[x] [DOC] Add `--top` flag to usage.
    - Touchpoints:
      - `tools/metrics-dashboard.js` L9‑118 (current output fields)
      - `tools/dict-utils/paths/cache.js` L178‑184 (metrics dir)

### 2.5 docs/guides/rule-packs.md
[x] [DOC] Replace `pairofcleats structural search` with `node tools/structural-search.js`.
    - Touchpoints:
      - `tools/structural-search.js` L6‑13
      - `bin/pairofcleats.js` L684 (no structural command)

### 2.6 docs/guides/structural-search.md
[x] [DOC] Replace `pairofcleats structural search` with `node tools/structural-search.js`.
    - Touchpoints:
      - `tools/structural-search.js` L6‑13
      - `bin/pairofcleats.js` L684 (no structural command)

### 2.7 docs/guides/triage-records.md
[x] [DOC] Replace `pairofcleats triage ...` with tool scripts:
    - `node tools/triage/ingest.js`
    - `node tools/triage/decision.js`
    - `node tools/triage/context-pack.js`
    - Touchpoints:
      - `tools/triage/ingest.js` L13 (scriptName)
      - `tools/triage/decision.js` L11 (scriptName)
      - `tools/triage/context-pack.js` L9 (scriptName)
      - `bin/pairofcleats.js` L684 (no triage command)

### 2.8 docs/guides/search.md
[x] [DOC] Document new output modes (compact/symbol-first/context-only) when implemented.
[x] [DOC] Document JSON output exclusions by default vs `--explain` inclusion.
    - Touchpoints:
      - `src/retrieval/output/format.js` (render pipeline)
      - `src/retrieval/output/context.js` (context/pre/post handling)
      - `src/retrieval/output/summary.js` (summary layout)

### 2.9 docs/guides/commands.md
[x] [DOC] Add missing CLI commands to the command list (graph-context, context-pack, impact, suggest-tests, api-contracts, architecture-check, report eval/compare-models, tooling doctor, risk explain, lmdb build, sqlite build).
    - Touchpoints:
      - `bin/pairofcleats.js` L289‑551 (command routing)
      - `bin/pairofcleats.js` L704‑727 (help list)
[x] [DOC] Add short “how to run” sections or per-command mini guides for the same tools (or add new guide pages and link from commands).
    - Touchpoints:
      - `tools/graph-context.js` L1‑4
      - `tools/context-pack.js` L1‑4
      - `tools/impact.js` L1‑4
      - `tools/suggest-tests.js` L1‑4
      - `tools/api-contracts.js` L1‑4
      - `tools/architecture-check.js` L1‑4
      - `tools/explain-risk.js` L1‑4
      - `tools/tooling-doctor.js` L14
      - `tools/compare-models.js` L28
      - `tools/eval/run.js` L11

### 2.10 docs/guides/service-mode.md
[x] [DOC] Remove or correct `indexModes` example; indexer service ignores repo-level indexModes.
    - Touchpoints:
      - `tools/indexer-service.js` L19‑44 (argv → mode)
      - `tools/indexer-service.js` L297‑381 (job mode handling)

---

## 3) Testing subsystem (docs/testing)

### 3.1 docs/testing/ci-capability-policy.md
[x] [DOC] Update PR suite default to `ci-lite`; note `services/api` exclusion.
[x] [DOC] Note Tantivy probing happens only in non-PR runs.
    - Touchpoints:
      - `tools/ci/run-suite.js`
      - `tools/ci/capability-gate.js`

### 3.2 docs/testing/failing-tests.md
[x] [DOC] Update log path to `.testLogs/**` and cache path to `.testCache/**`.
    - Touchpoints:
      - `tests/run.js`
      - `tests/tooling/script-coverage/paths.js`

### 3.3 docs/testing/test-decomposition-regrouping.md
[x] [DOC] Add lanes `ci-lite`, `ci-long`, `api`, `mcp`.
[x] [DOC] Clarify indexing/retrieval/tooling/runner are tags/paths, not lanes.
    - Touchpoints:
      - `tests/run.rules.jsonc`
[x] [DOC] Update services lane description to exclude api/mcp (they are separate lanes).
    - Touchpoints:
      - `tests/run.rules.jsonc` L19‑21
[x] [DOC] Replace proposed tag set with actual tag catalog (avoid tags not present in rules).
    - Touchpoints:
      - `tests/run.rules.jsonc` L31‑116 (tagRules)

### 3.4 docs/testing/test-runner-interface.md
[x] [DOC] Update defaults: timeouts, jobs, cache root behavior, test id format.
    - Touchpoints:
      - `tests/run.js` (defaults)
      - `tests/run.rules.jsonc` (lane list)
    - Explicit defaults to document:
      - Timeouts: `ci-lite=15000`, `ci=90000`, `ci-long=240000`, default `30000`
      - Jobs: physical core count (see `resolvePhysicalCores`)
      - Cache root: defaults to `.testCache` unless overridden
[x] [DOC] Document `--list-lanes` and `--list-tags`.
    - Touchpoints:
      - `tests/run.js` L97‑100
[x] [DOC] Document lane order files (`tests/<lane>/<lane>.order.txt`) and failure semantics.
    - Touchpoints:
      - `tests/run.js` L62, L173‑210
[x] [DOC] Document runner env overrides (`PAIROFCLEATS_TEST_*`, npm_config fallbacks).
    - Touchpoints:
      - `tests/run.js` L274‑288
[x] [DOC] Document tag catalog + meanings (bench, harness, watch, embeddings, sqlite, lmdb, jj, api/mcp, etc.).
    - Touchpoints:
      - `tests/run.rules.jsonc` L31‑116
Note: timing ledger/watchdog and coverage-merge documentation is tracked in `NIKE_SB_CHUNK_ROADMAP.md` (Phase 5).

---

## 4) Tooling docs (docs/tooling)

### 4.1 docs/tooling/ctags.md
[x] [DOC] Update CLI examples to `node tools/ctags-ingest.js` or npm script.
    - Source of truth: `tools/ctags-ingest.js`, `package.json` scripts
[x] [DOC] Document options and defaults: `--out`, `--json`, `--ctags`, `--args`, stdin behavior, and default `--run` when no input.
    - Touchpoints:
      - `tools/ctags-ingest.js` L12‑22 (options)
      - `tools/ctags-ingest.js` L150‑163 (stdin/run behavior)

### 4.2 docs/tooling/gtags.md
[x] [DOC] Update CLI examples to `node tools/gtags-ingest.js` or npm script.
    - Source of truth: `tools/gtags-ingest.js`, `package.json` scripts
[x] [DOC] Document options and defaults: `--out`, `--json`, `--global`, `--args`, stdin behavior, and default stdin when no input.
    - Touchpoints:
      - `tools/gtags-ingest.js` L13‑20 (options)
      - `tools/gtags-ingest.js` L110‑115 (stdin/run behavior)

### 4.3 docs/tooling/lsif.md
[x] [DOC] Update CLI examples to `node tools/lsif-ingest.js` or npm script.
    - Source of truth: `tools/lsif-ingest.js`, `package.json` scripts
[x] [DOC] Document options and defaults: `--out`, `--json`, stdin behavior when `--input -`.
    - Touchpoints:
      - `tools/lsif-ingest.js` L12‑16 (options)
      - `tools/lsif-ingest.js` L165‑168 (stdin behavior)

### 4.4 docs/tooling/scip.md
[x] [DOC] Update CLI examples to `node tools/scip-ingest.js` or npm script.
    - Source of truth: `tools/scip-ingest.js`, `package.json` scripts
[x] [DOC] Document options and defaults: `--out`, `--json`, `--scip`, `--args`, stdin behavior, and JSON (non‑JSONL) file parsing path.
    - Touchpoints:
      - `tools/scip-ingest.js` L13‑20 (options)
      - `tools/scip-ingest.js` L214‑218 (JSON file handling)

### 4.5 docs/tooling/repo-inventory.json
[x] [DOC] Ensure `tools/mcp-server-sdk.js` appears in `tools.entrypoints`.
    - Touchpoints:
      - `tools/mcp-server-sdk.js` (shebang)
      - `tools/repo-inventory.js` (generator)
Note: ingest CLI wrapper documentation is tracked in `NIKE_SB_CHUNK_ROADMAP.md` (Phase 5).

### 4.6 docs/tooling/repo-inventory.md (new)
[x] [DOC] Add a short guide for `pairofcleats repo-inventory` and the JSON output format.
    - Touchpoints:
      - `tools/repo-inventory.js` L9‑232

---

## 5) API docs (docs/api)

### 5.1 docs/api/core-api.md
[x] [DOC] Update buildIndex options list (stage/quality/modes/rawArgv/log/etc).
[x] [DOC] Update search params (`--compact` vs jsonCompact; ann-backend/context/filter params).
[x] [DOC] Update status params (`includeAll` vs `all`).
    - Touchpoints:
      - `src/integrations/core/build-index/index.js` L39 (buildIndex options)
      - `src/integrations/core/args.js` L12‑64 (buildRawArgs/buildSearchArgs)
      - `src/integrations/core/build-index/sqlite.js` L10‑20 (buildSqliteIndex options)
      - `src/integrations/core/search.js` L11 (search handler)
      - `src/integrations/core/status.js` L258 (status handler)

### 5.2 docs/api/mcp-server.md
[x] [DOC] Note default MCP mode is legacy unless `auto` explicitly requested.
    - Source of truth:
      - `tools/mcp/server-config.js` (default mode)
      - `tools/mcp-server.js` (arg handling)

### 5.3 docs/api/server.md
[x] [DOC] Confirm auth behavior note (localhost auth optional unless token set).
    - Touchpoints:
      - `tools/api-server.js` L47‑59 (authRequired logic)
[x] [DOC] Document that API server runs in-process (no CLI shell-out).
    - Touchpoints:
      - `tools/api/router.js` L1 (imports core search/status)
[x] [DOC] Tighten `/search` payload description to match Ajv schema (strict keys, meta/metaJson formats).
    - Touchpoints:
      - `tools/api/validation.js` L29 (search schema)
      - `tools/api/router/search.js` L85‑140 (payload mapping)
[x] [DOC] Publish canonical `/search` schema (embed in docs or link to Ajv source).
    - Touchpoints:
      - `tools/api/validation.js` L29‑136
    - Note:
      - Treat `tools/api/validation.js` as the canonical field list for `/search`.
[x] [DOC] Fix `/status` reference to nonexistent CLI (use core status output instead).
    - Touchpoints:
      - `src/integrations/core/status.js` L258
[x] [DOC] Document error codes + troubleshooting hints shared across API/MCP/CLI.
    - Touchpoints:
      - `docs/contracts/mcp-error-codes.md`
      - `docs/api/server.md`
      - `docs/api/mcp-server.md`

---

## 6) Config docs (docs/config)

### 6.1 docs/config/contract.md
[x] [DOC] Sync public config key list with `docs/config/schema.json`.
[x] [DOC] Update CLI flags list to current CLI options.
[x] [CODE] Generate `docs/config/contract.md` from `docs/config/schema.json` + `src/shared/env.js` (deterministic output).
    - Touchpoints:
      - `tools/config-contract-doc.js` (new)
      - `docs/config/contract.md`
    - Tests:
      - `tests/tooling/docs/config-contract-doc.test.js` (new)
    - Implementation details:
      - Parse schema at `docs/config/schema.json` (include descriptions, defaults, enums).
      - Pull env var metadata from `src/shared/env.js` (source of truth).
      - Emit sections: Overview, Schema keys, Defaults, Env overrides, CLI flags (if applicable).
      - Preserve line endings/BOM on regeneration (match `tools/config-inventory.js` behavior).
    - Source line anchors:
      - `docs/config/schema.json` L18‑396 (namespace keys)
      - `src/shared/env.js` L32‑58 (env surface)

### 6.2 docs/config/deprecations.md
[x] [DOC] Align deprecations with `docs/config/schema.json`.

### 6.3 docs/config/env-overrides.md
[x] [DOC] Update env var list to match `src/shared/env.js` and inventory.
[x] [DOC] Clarify non-secret env behavior vs secrets-only claim.
    - Touchpoints:
      - `src/shared/env.js` L32‑58 (`getEnvConfig`)
      - `src/shared/env.js` L79‑98 (`getTestEnvConfig`)

### 6.4 docs/config/execution-plan.md
[x] [DOC] Replace `metadata-only` with `records` / `extracted-prose` modes.
[x] [DOC] Update provider policy examples (tooling providers vs vscode/sublime).

### 6.5 docs/config/hard-cut.md
[x] [DOC] Remove `output.logPath` if not in schema.
[x] [DOC] Remove `indexing.skipImportResolution` if not in schema.

### 6.6 docs/config/budgets.md
[x] [DOC] Expand allowlist to match schema namespaces (threads/runtime/tooling/mcp/indexing/retrieval/search).
    - Touchpoints:
      - `docs/config/schema.json` L18‑396 (namespace list)
      - `docs/config/budgets.md` (current allowlist)

### 6.7 docs/config/surface-directives.md
[x] [DOC] Update unknown-key policy to reflect schema `additionalProperties` in indexing/embeddings.
    - Touchpoints:
      - `docs/config/schema.json` L172‑303 (indexing + embeddings)

---

## 7) Perf docs (docs/perf)

### 7.1 docs/perf/graph-caps.md
[x] [DOC] Document graph caps harness CLI usage (required `--outDir`, `--graphFixture` or `--index`, optional `--depth`).
    - Touchpoints:
      - `tools/bench/graph-caps-harness.js` L80‑107 (CLI args + validation)
      - `tools/bench/graph-caps-harness.js` L34‑70 (output file)
[x] [DOC] Document how `graph-caps-defaults.json` is produced and what each field means.
    - Touchpoints:
      - `docs/perf/graph-caps-defaults.json` (output structure)

### 7.2 docs/perf/graph-caps-defaults.json
[x] [DOC] Add provenance note (generator + inputs), and link back to `graph-caps.md`.

---

## 8) Benchmark docs (docs/benchmarks)

### 8.1 docs/benchmarks/overview.md
[x] [DOC] Fix microbench backend list (memory/sqlite/sqlite-fts only; no lmdb).
    - Touchpoints:
      - `tools/bench/micro/run.js` L39‑45 (backend list)
[x] [DOC] Document microbench CLI flags: `--repo-current`, `--query`, `--threads`, `--sqlite`, `--components`, `--ann-backends`, `--json`.
    - Touchpoints:
      - `tools/bench/micro/run.js` L22‑95
[x] [DOC] Document thread default/override behavior used by microbench (`--threads` and env).
    - Touchpoints:
      - `src/shared/threads.js` L8‑97
[x] [DOC] Document tinybench CLI flags: `--iterations`, `--warmup-iterations`, `--time`, `--warmup-time`, `--components`, and standard repo/query/backend flags.
    - Touchpoints:
      - `tools/bench/micro/tinybench.js` L18‑60
[x] [DOC] Document query generator flags: `--repo`, `--out`, `--json`, `--index-root`, and default JSON output path.
    - Touchpoints:
      - `tools/bench-query-generator.js` L13‑19, L90‑99
[x] [DOC] Document bench harness `--query-concurrency` (and where it applies).
    - Touchpoints:
      - `src/shared/cli-options.js` L50
[x] [DOC] Add bench matrix runner flags (`--ann-modes`, `--backends`, `--out-dir`, `--log-dir`, `--fail-fast`) or link to language benchmarks doc.
    - Touchpoints:
      - `tools/bench-language-matrix.js` L20‑38, L54‑96

### 8.2 docs/benchmarks/evaluation.md
[x] [DOC] Confirm evaluation options + output formats match `tools/eval/run.js` (update if drift is found).
    - Touchpoints:
      - `tools/eval/run.js` L11‑180 (metrics schema + output)

### 8.3 docs/benchmarks/model-comparison.md
[x] [DOC] Confirm model comparison CLI flags and outputs match `tools/compare-models.js`.
    - Touchpoints:
      - `tools/compare-models.js` L28‑120 (CLI args + output)

---

## 9) Language docs (docs/language)

### 9.1 docs/language/benchmarks.md
[x] [DOC] Document that `--stub-embeddings/--real-embeddings` are forwarded to the runner (not ignored).
    - Touchpoints:
      - `tools/bench-language-repos.js` L653‑657
[x] [DOC] Update tier definitions to include `small`/`tiny` (positional filters allowed).
    - Touchpoints:
      - `tools/bench-language-repos.js` L290‑296
[x] [DOC] Document language bench CLI flags (`--dry-run`, `--results`, `--repos`, `--only`, `--languages`, `--queries`, `--heap-mb`, `--cache-run`).
    - Touchpoints:
      - `tools/bench/language/cli.js` L53‑96
      - `tools/bench-language-repos.js` L302‑305, L533‑568, L647‑680

### 9.2 docs/language/lang-sql.md
[x] [DOC] Update default mode to `--mode all` (no lang-sql doc present; no update needed).

### 9.3 docs/language/lang-typescript.md
[x] [DOC] Update default mode to `--mode all` (no lang-typescript doc present; no update needed).

---

## 10) New docs (docs/new_docs)

### 10.1 docs/new_docs/graph-caps.md
[x] [DECISION] Promote to `docs/specs/graph-caps.md` (align with current plans).

### 10.2 docs/new_docs/symbol-artifacts-and-pipeline.md
[x] [DECISION] Merge into `docs/specs/symbol-artifacts-and-pipeline.md`.

---

## 11) Specs subsystem (docs/specs)

### 11.1 docs/specs/analysis-schemas.md
[x] [DOC] Create or update to current schema (graph context, impact, api contracts, architecture, suggest-tests).
    - Touchpoints:
      - `src/contracts/schemas/analysis.js` ~L505 (`GRAPH_CONTEXT_PACK_SCHEMA`)
      - `src/contracts/schemas/analysis.js` ~L684 (`API_CONTRACTS_SCHEMA`)
      - `src/contracts/schemas/analysis.js` ~L774 (`SUGGEST_TESTS_SCHEMA`)

### 11.2 docs/specs/artifact-schemas.md
[x] [DOC] Create or update to current schema; add missing artifacts and jsonl-sharded schema.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L317, ~L810
[x] [DECISION] `api_contracts_meta`: add schema or remove from docs.

### 11.3 docs/specs/graph-caps.md
  [x] [DOC] Replace placeholder with actual schema + defaults.
    - Touchpoints:
      - `src/retrieval/pipeline/graph-ranking.js`

### 11.4 docs/specs/graph-product-surfaces.md
[x] [DECISION] Keep as authoritative and update (still referenced).

### 11.5 Risk specs (all five files)
[x] [DOC] Align required fields with schema (`mode`, `callSiteSampling`, `timingMs.io`, etc).
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js`
    - Schema entries to cross-check:
      - `risk_summaries`, `risk_flows`, `risk_interprocedural_stats`, `call_sites`
[x] [DOC] Fix `call_sites` spec subset:
    - Required fields: include `languageId`, `start`, `end` (byte offsets).
    - Optionality: `snippetHash` is optional in schema.
    - Sampling: document that writer currently emits all call details (no per-edge sampling).
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L502 (callSiteEntry required fields)
      - `src/index/build/artifacts/writers/call-sites.js` ~L146 (writer emits all call details)
[x] [DECISION] Enforce deterministic trimming/ordering in code or update spec to current behavior.
    - Touchpoints:
      - `src/index/build/artifacts/writers/*`
[x] [DOC] Document row-size trimming + dropped-row accounting for risk artifacts (or add missing stats in code).
    - Touchpoints:
      - `src/index/build/artifacts/writers/call-sites.js` ~L68 (trim/drop)
      - `src/index/build/artifacts/writers/risk-interprocedural.js` ~L33 (no trimming)

### 11.6 docs/specs/runtime-envelope.md
[x] [DOC] Update env precedence + envelope fields.
    - Touchpoints:
      - `src/shared/runtime-envelope.js`
      - `src/shared/env.js`

### 11.7 docs/specs/safe-regex-hardening.md
[x] [DOC] Add RE2JS fallback + input/program caps; reference `compileSafeRegex`.
    - Touchpoints:
      - `src/shared/safe-regex.js`
      - `src/shared/safe-regex/backends/*`

### 11.8 SCM specs
[x] [DOC] Expand provider contract (head/dirty semantics, path normalization, precedence, error signaling).
[x] [DOC] Add JJ operationId to schema.
    - Touchpoints:
      - `src/index/scm/providers/git.js`
      - `src/index/scm/providers/jj.js`
    - Concrete behaviors to document:
      - `listTrackedFiles` return shape (paths POSIX + repo‑relative)
      - provenance `head` (hash + operationId for jj) + `dirty` semantics
      - error handling: fall back to `provider=none` vs hard error

### 11.9 docs/specs/segmentation-perf.md
  [x] [DOC] Update caps/targets to current maxBytes and fallback logic.

### 11.10 docs/specs/signature.md
  [x] [DOC] Update signature inputs (include repo provenance/provider head, index compat key).
    - Touchpoints:
      - `src/index/build/indexer/signatures.js`

### 11.11 docs/specs/symbol-artifacts-and-pipeline.md
  [x] [DOC] Align with current symbol artifact schema or mark as draft.
    - Touchpoints:
      - `src/index/build/artifacts/writers/*`

### 11.12 docs/specs/test-strategy-and-conformance-matrix.md
  [x] [DOC] Update lane list and descriptions (ci-lite, ci-long, api, mcp).

### 11.13 docs/specs/tooling-and-api-contract.md
  [x] [DOC] Update MCP tool list and defaults; include schemaVersion in responses.
    - Touchpoints:
      - `src/integrations/mcp/defs.js`
      - `tools/mcp/server-config.js`

### 11.14 docs/specs/tooling-doctor-and-reporting.md
[x] [DOC] Align report schema with `src/index/tooling/doctor.js` output.

### 11.15 docs/specs/tooling-io.md
[x] [DECISION] Implement `fileTextByFile` caching in tooling or update spec to VFS approach.
    - Touchpoints:
      - `src/index/tooling/*`
      - `src/index/tooling/vfs.js`

### 11.16 docs/specs/tooling-provider-registry.md
[x] [DOC] Update names/fields to match `src/index/tooling/provider-registry.js` + `orchestrator.js`.

### 11.17 docs/specs/typescript-provider-js-parity.md
[x] [DECISION] Remove no-ad-hoc-ID rule or change implementation to avoid heuristic SymbolRef IDs.
    - Touchpoints:
      - `src/index/tooling/typescript-provider.js`

### 11.18 docs/specs/vfs-manifest-artifact.md
[x] [DECISION] Enforce deterministic trimming before dropping oversized rows or update spec.
    - Touchpoints:
      - `src/index/tooling/vfs.js`

### 11.19 docs/specs/watch-atomicity.md
  [x] [DOC] Update attempt root / promotion barrier names and defaults.
    - Touchpoints:
      - `src/index/build/watch/*`

### 11.20 Workspace specs
[x] [DOC] Sync workspace config keys with `docs/config/schema.json` (include `indexing.scm.*`).
[x] [DOC] Revalidate workspace manifest fields and manifestHash rules vs current federation plan.

---

## 12) Archived docs (docs/archived)

[x] [DOC] Confirm archived docs are not referenced as canonical anywhere.
[x] [DOC] Where referenced for historical context, ensure they are labeled DEPRECATED and point to replacements.

---

## 13) Deliverables and validation

[x] [DOC] Update `COSMIC_DOCS_LEDGER.md` with resolution status tags (doc fix vs code fix) per task above.
[x] [DOC] Ensure all references in guides/contracts/specs point to correct paths.
[x] [DOC] Run any existing doc validation (if present) or add a minimal consistency check.

---

## 14) Optional automation (quality-of-life)

[x] [CODE] Add a doc drift checker that compares:
    - CLI flags vs docs
    - Schema lists vs docs
    - Test lanes vs docs
    - Output fields vs docs (initially `scoreBreakdown` keys)
    - Touchpoints:
      - `tools/doc-contract-drift.js`
      - `docs/testing/` for policy
    - Note:
      - Entry point vs docs remains covered by `tests/indexing/policy/script-surface-policy.test.js`.
[x] [CODE] Define comparison inputs/outputs:
    - Inputs:
      - CLI flags from `src/retrieval/cli-args.js`
      - Artifact list from `src/contracts/schemas/artifacts.js` (`ARTIFACT_SCHEMA_DEFS`)
      - Lanes from `tests/run.rules.jsonc` (`knownLanes`)
      - Score breakdown keys from `src/retrieval/pipeline.js`
    - Docs to verify:
      - `docs/contracts/search-cli.md`, `docs/contracts/search-contract.md`
      - `docs/contracts/artifact-schemas.md`
      - `docs/testing/test-runner-interface.md`, `docs/testing/test-decomposition-regrouping.md`
    - Outputs:
      - `docs/tooling/doc-contract-drift.json` (machine readable)
      - `docs/tooling/doc-contract-drift.md` (short summary for CI)
[x] [CODE] Wire doc drift checker into CI (fail on drift, print diff summary).
    - Touchpoints:
      - `tools/ci/run-suite.js`

---

## Notes for triage (missing functionality vs outdated docs)

- If a doc is a contract/spec referenced by validation or build code, treat it as authoritative and fix code unless the contract is obsolete.
- If a guide/bench doc is inconsistent with current CLI/tools, fix the doc unless you intend to support the documented behavior.
- If both doc and code are ambiguous, record a decision first and then update both.
---

## Appendix A: Doc line ranges (current baseline)

Line ranges are provided for every markdown file under docs/** to give line-level anchors for updates. When a task references a doc file, use the range below for precise edits.

```text
docs\api\core-api.md | lines 1-28
docs\api\mcp-server.md | lines 1-56
docs\api\server.md | lines 1-124
docs\archived\interprocedural-state-and-pipeline_DRAFT.md | lines 1-161
docs\archived\PHASE_0.md | lines 1-121
docs\archived\PHASE_1.md | lines 1-40
docs\archived\PHASE_2.md | lines 1-51
docs\archived\PHASE_3.md | lines 1-471
docs\archived\PHASE_4.md | lines 1-430
docs\archived\PHASE_5.md | lines 1-542
docs\archived\PHASE_6.md | lines 1-553
docs\archived\PHASE_8.md | lines 1-1007
docs\archived\README.md | lines 1-17
docs\archived\risk-callsite-id-and-stats_IMPROVED.md | lines 1-125
docs\archived\spec_risk-flows-and-call-sites_RECONCILED.md | lines 1-146
docs\archived\spec_risk-interprocedural-config_IMPROVED.md | lines 1-104
docs\archived\spec_risk-summaries_IMPROVED.md | lines 1-174
docs\benchmarks\evaluation.md | lines 1-46
docs\benchmarks\model-comparison.md | lines 1-31
docs\benchmarks\overview.md | lines 1-76
docs\config\budgets.md | lines 1-30
docs\config\contract.md | lines 1-83
docs\config\deprecations.md | lines 1-15
docs\config\env-overrides.md | lines 1-10
docs\config\execution-plan.md | lines 1-471
docs\config\hard-cut.md | lines 1-318
docs\config\inventory-notes.md | lines 1-29
docs\config\inventory.md | lines 1-737
docs\config\surface-directives.md | lines 1-234
docs\contracts\analysis-schemas.md | lines 1-167
docs\contracts\artifact-contract.md | lines 1-221
docs\contracts\artifact-schemas.md | lines 1-97
docs\contracts\chunking.md | lines 1-24
docs\contracts\compatibility-key.md | lines 1-47
docs\contracts\coverage-ledger.md | lines 1-25
docs\contracts\graph-tools-cli.md | lines 1-267
docs\contracts\indexing.md | lines 1-75
docs\contracts\mcp-api.md | lines 1-128
docs\contracts\mcp-error-codes.md | lines 1-34
docs\contracts\public-artifact-surface.md | lines 1-113
docs\contracts\retrieval-ranking.md | lines 1-101
docs\contracts\search-cli.md | lines 1-109
docs\contracts\search-contract.md | lines 1-86
docs\contracts\sqlite.md | lines 1-24
docs\dependency_references\aider-repomap-blog.md | lines 1-12
docs\dependency_references\aider-repomap-docs.md | lines 1-12
docs\dependency_references\ast-grep.md | lines 1-12
docs\dependency_references\comby.md | lines 1-12
docs\dependency_references\continue-embeddings.md | lines 1-12
docs\dependency_references\continue-retrieval-accuracy.md | lines 1-12
docs\dependency_references\ctags-interactive-mode.md | lines 1-12
docs\dependency_references\ctags-json-output.md | lines 1-12
docs\dependency_references\dependency-bundle\deps\aho-corasick.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\ajv.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\ast-grep-napi.md | lines 1-25
docs\dependency_references\dependency-bundle\deps\astrojs-compiler.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\babel-traverse.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\better-sqlite3.md | lines 1-25
docs\dependency_references\dependency-bundle\deps\chardet.md | lines 1-21
docs\dependency_references\dependency-bundle\deps\chokidar.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\dockerfile-ast.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\es-joy-jsdoccomment.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\esquery.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\execa.md | lines 1-21
docs\dependency_references\dependency-bundle\deps\fast-xml-parser.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\fdir.md | lines 1-21
docs\dependency_references\dependency-bundle\deps\fflate.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\file-type.md | lines 1-21
docs\dependency_references\dependency-bundle\deps\graphology.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\graphql.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\greedy-number-partitioning.md | lines 1-21
docs\dependency_references\dependency-bundle\deps\handlebars-parser.md | lines 1-22
docs\dependency_references\dependency-bundle\deps\hdr-histogram-js.md | lines 1-22
docs\dependency_references\dependency-bundle\deps\hnswlib-node.md | lines 1-22
docs\dependency_references\dependency-bundle\deps\iconv-lite.md | lines 1-22
docs\dependency_references\dependency-bundle\deps\ignore.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\istextorbinary.md | lines 1-21
docs\dependency_references\dependency-bundle\deps\jsdoc-type-pratt-parser.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\jsonc-parser.md | lines 1-22
docs\dependency_references\dependency-bundle\deps\lancedb.md | lines 1-20
docs\dependency_references\dependency-bundle\deps\linguist-languages.md | lines 1-25
docs\dependency_references\dependency-bundle\deps\lmdb.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\lru-cache.md | lines 1-22
docs\dependency_references\dependency-bundle\deps\mammoth.md | lines 1-20
docs\dependency_references\dependency-bundle\deps\mdx-js-mdx.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\micromark.md | lines 1-27
docs\dependency_references\dependency-bundle\deps\modelcontextprotocol-sdk.md | lines 1-20
docs\dependency_references\dependency-bundle\deps\mongodb-js-zstd.md | lines 1-20
docs\dependency_references\dependency-bundle\deps\msgpackr.md | lines 1-25
docs\dependency_references\dependency-bundle\deps\node-rs-xxhash.md | lines 1-20
docs\dependency_references\dependency-bundle\deps\nunjucks.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\onnxruntime-node.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\parcel-watcher.md | lines 1-20
docs\dependency_references\dependency-bundle\deps\parse5.md | lines 1-25
docs\dependency_references\dependency-bundle\deps\pdfjs-dist.md | lines 1-20
docs\dependency_references\dependency-bundle\deps\picomatch.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\pino-pretty.md | lines 1-22
docs\dependency_references\dependency-bundle\deps\pino.md | lines 1-26
docs\dependency_references\dependency-bundle\deps\piscina.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\prom-client.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\protobufjs.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\pyright.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\re2.md | lines 1-20
docs\dependency_references\dependency-bundle\deps\re2js.md | lines 1-22
docs\dependency_references\dependency-bundle\deps\roaring-wasm.md | lines 1-25
docs\dependency_references\dependency-bundle\deps\seedrandom.md | lines 1-21
docs\dependency_references\dependency-bundle\deps\semver.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\smol-toml.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\svelte.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\swc-core.md | lines 1-23
docs\dependency_references\dependency-bundle\deps\tantivy.md | lines 1-20
docs\dependency_references\dependency-bundle\deps\tinybench.md | lines 1-22
docs\dependency_references\dependency-bundle\deps\typescript-eslint-typescript-estree.md | lines 1-27
docs\dependency_references\dependency-bundle\deps\typescript.md | lines 1-27
docs\dependency_references\dependency-bundle\deps\vscode-ripgrep.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\vue-compiler-sfc.md | lines 1-26
docs\dependency_references\dependency-bundle\deps\xenova-transformers.md | lines 1-25
docs\dependency_references\dependency-bundle\deps\xxhash-wasm.md | lines 1-24
docs\dependency_references\dependency-bundle\deps\yaml.md | lines 1-26
docs\dependency_references\dependency-bundle\link-inventory.md | lines 1-63
docs\dependency_references\dependency-bundle\readme.md | lines 1-199
docs\dependency_references\dependency-bundle\topic-guide.md | lines 1-106
docs\dependency_references\dependency-coverage.md | lines 1-45
docs\dependency_references\github-code-search-tech.md | lines 1-13
docs\dependency_references\gitlab-exact-code-search.md | lines 1-13
docs\dependency_references\glean-meta-blog.md | lines 1-12
docs\dependency_references\glean.md | lines 1-12
docs\dependency_references\gnu-global.md | lines 1-12
docs\dependency_references\haystack-rag-eval.md | lines 1-12
docs\dependency_references\hound.md | lines 1-12
docs\dependency_references\kythe.md | lines 1-12
docs\dependency_references\lancedb-docs.md | lines 1-12
docs\dependency_references\lancedb.md | lines 1-12
docs\dependency_references\langchain-github-loader-api.md | lines 1-12
docs\dependency_references\langchain-github-loader-docs.md | lines 1-12
docs\dependency_references\livegrep.md | lines 1-12
docs\dependency_references\llamaindex-embeddings.md | lines 1-12
docs\dependency_references\llamaindex-ts.md | lines 1-12
docs\dependency_references\lsif.md | lines 1-12
docs\dependency_references\meilisearch.md | lines 1-12
docs\dependency_references\opengrok.md | lines 1-12
docs\dependency_references\readme.md | lines 1-45
docs\dependency_references\regrams.md | lines 1-12
docs\dependency_references\ripgrep.md | lines 1-12
docs\dependency_references\scip.md | lines 1-12
docs\dependency_references\semgrep.md | lines 1-12
docs\dependency_references\sourcebot-docs.md | lines 1-12
docs\dependency_references\sourcebot-v3-discussion.md | lines 1-12
docs\dependency_references\sourcebot.md | lines 1-12
docs\dependency_references\stack-graphs-blog.md | lines 1-12
docs\dependency_references\stack-graphs.md | lines 1-12
docs\dependency_references\tantivy.md | lines 1-12
docs\dependency_references\typesense.md | lines 1-12
docs\dependency_references\zoekt-go-docs.md | lines 1-12
docs\dependency_references\zoekt-query-syntax.md | lines 1-13
docs\dependency_references\zoekt.md | lines 1-14
docs\guides\architecture.md | lines 1-203
docs\guides\code-maps.md | lines 1-61
docs\guides\commands.md | lines 1-77
docs\guides\editor-integration.md | lines 1-46
docs\guides\embeddings.md | lines 1-114
docs\guides\external-backends.md | lines 1-38
docs\guides\mcp.md | lines 1-51
docs\guides\metrics-dashboard.md | lines 1-21
docs\guides\query-cache.md | lines 1-28
docs\guides\release-discipline.md | lines 1-24
docs\guides\risk-rules.md | lines 1-87
docs\guides\rule-packs.md | lines 1-38
docs\guides\search.md | lines 1-87
docs\guides\service-mode.md | lines 1-71
docs\guides\setup.md | lines 1-57
docs\guides\structural-search.md | lines 1-49
docs\guides\triage-records.md | lines 1-109
docs\language\ast-feature-list.md | lines 1-91
docs\language\benchmarks.md | lines 1-65
docs\language\fidelity.md | lines 1-138
docs\language\import-links.md | lines 1-19
docs\language\onboarding-playbook.md | lines 1-35
docs\language\parser-backbone.md | lines 1-80
docs\language\symbol-sources.md | lines 1-53
docs\new_docs\cross-file-symbol-resolution.md | lines 1-258
docs\new_docs\fts_query_compilation_spec_draft.md | lines 1-218
docs\new_docs\identity-contracts.md | lines 1-46
docs\new_docs\jj_provider_spec_draft.md | lines 1-288
docs\new_docs\mcp-tool-schema-and-proc-kill-spec-draft.md | lines 1-315
docs\new_docs\metaV2_provenance_and_anchor_spec_draft.md | lines 1-245
docs\new_docs\migration-and-backcompat.md | lines 1-97
docs\new_docs\phase13_scm_provider_interface_spec.md | lines 1-290
docs\new_docs\symbol-artifacts-and-pipeline.md | lines 1-94
docs\new_docs\symbol-artifacts.md | lines 1-314
docs\new_docs\symbol-identity-and-symbolref.md | lines 1-360
docs\perf\graph-caps.md | lines 1-22
docs\specs\analysis-policy.md | lines 1-32
docs\specs\as-of-retrieval-integration.md | lines 1-218
docs\specs\build-state-integrity.md | lines 1-40
docs\specs\concurrency-abort-runwithqueue.md | lines 1-300
docs\specs\context-packs.md | lines 1-353
docs\specs\federated-search.md | lines 1-537
docs\specs\graph-explainability.md | lines 1-225
docs\specs\graph-product-surfaces.md | lines 1-827
docs\specs\graph-ranking.md | lines 1-216
docs\specs\identity-and-symbol-contracts.md | lines 1-410
docs\specs\identity-contract.md | lines 1-324
docs\specs\identity-contracts.md | lines 1-132
docs\specs\impact-analysis.md | lines 1-283
docs\specs\implementation-checklist.md | lines 1-168
docs\specs\implementation-plan.md | lines 1-246
docs\specs\import-resolution.md | lines 1-62
docs\specs\index-diffs.md | lines 1-413
docs\specs\index-refs-and-snapshots.md | lines 1-563
docs\specs\jj-provider-commands-and-parsing.md | lines 1-218
docs\specs\json-stream-atomic-replace.md | lines 1-232
docs\specs\large-file-caps-strategy.md | lines 1-226
docs\specs\lsp-provider-hardening.md | lines 1-187
docs\specs\metadata-schema-v2.md | lines 1-159
docs\specs\migration-and-backcompat.md | lines 1-45
docs\specs\risk-callsite-id-and-stats.md | lines 1-40
docs\specs\risk-flows-and-call-sites.md | lines 1-176
docs\specs\risk-interprocedural-config.md | lines 1-195
docs\specs\risk-interprocedural-stats.md | lines 1-147
docs\specs\risk-summaries.md | lines 1-252
docs\specs\runtime-envelope.md | lines 1-299
docs\specs\safe-regex-hardening.md | lines 1-203
docs\specs\scm-provider-config-and-state-schema.md | lines 1-175
docs\specs\scm-provider-contract.md | lines 1-152
docs\specs\segmentation-perf.md | lines 1-40
docs\specs\signature.md | lines 1-38
docs\specs\subprocess-helper.md | lines 1-228
docs\specs\symbol-artifacts-and-pipeline.md | lines 1-122
docs\specs\test-strategy-and-conformance-matrix.md | lines 1-375
docs\specs\tooling-and-api-contract.md | lines 1-436
docs\specs\tooling-doctor-and-reporting.md | lines 1-179
docs\specs\tooling-io.md | lines 1-40
docs\specs\tooling-provider-registry.md | lines 1-311
docs\specs\tooling-vfs-and-segment-routing.md | lines 1-287
docs\specs\typescript-provider-js-parity.md | lines 1-292
docs\specs\vfs-manifest-artifact.md | lines 1-178
docs\specs\watch-atomicity.md | lines 1-38
docs\specs\workspace-config.md | lines 1-412
docs\specs\workspace-manifest.md | lines 1-432
docs\sqlite\ann-extension.md | lines 1-91
docs\sqlite\compaction.md | lines 1-24
docs\sqlite\incremental-updates.md | lines 1-74
docs\sqlite\index-schema.md | lines 1-108
docs\testing\ci-capability-policy.md | lines 1-16
docs\testing\failing-tests.md | lines 1-27
docs\testing\fixture-corpus.md | lines 1-22
docs\testing\fixture-tracking.md | lines 1-28
docs\testing\index-state-nondeterministic-fields.md | lines 1-67
docs\testing\test-decomposition-regrouping.md | lines 1-379
docs\testing\test-runner-interface.md | lines 1-225
docs\testing\truth-table.md | lines 1-167
docs\tooling\ctags.md | lines 1-36
docs\tooling\gtags.md | lines 1-22
docs\tooling\lsif.md | lines 1-19
docs\tooling\scip.md | lines 1-25
```

---

## Appendix B: Code touchpoint index (line‑level anchors)

Use this index as the canonical list of **code files to review**, with line‑level anchors for each subsystem. These are the exact locations that should be inspected/updated when reconciling docs vs behavior.

### Contracts + schemas (authoritative)
- `src/contracts/schemas/analysis.js`
  - `GRAPH_CONTEXT_PACK_SCHEMA` — L505
  - `API_CONTRACTS_SCHEMA` — L684
  - `SUGGEST_TESTS_SCHEMA` — L774
- `src/contracts/validators/analysis.js`
  - `validateGraphContextPack` — L62
  - `validateApiContracts` — L77
  - `validateSuggestTests` — L87
- `src/contracts/schemas/artifacts.js`
  - `baseShardedJsonlMeta` — L317
  - `ARTIFACT_SCHEMA_DEFS` — L810
  - `call_sites` — L879
  - `risk_summaries` — L930
  - `risk_flows` — L934
  - `risk_interprocedural_stats` — L938
  - `*_meta` sharded meta entries — L1159‑1161
- `src/contracts/versioning.js`
  - `ARTIFACT_SURFACE_VERSION` — L1
  - `resolveSupportedMajors` — L19

### Artifact loading + manifests
- `src/shared/artifact-io/json.js`
  - `readJsonFile` — L16
- `src/shared/artifact-io/loaders.js`
  - `resolveJsonlArtifactSources` — L20
  - manifest fallback use sites — L103, L287, L533

### Retrieval CLI + output formatting
- `src/retrieval/cli-args.js`
  - graph ranking flags — L98‑101
  - CLI help list — L132‑149
- `src/retrieval/cli/normalize-options.js`
  - `parseFilterExpression` use — L82
  - `graphRankingConfig` assembly — L186‑206
- `src/retrieval/cli/render.js`
  - JSON output fields (`extractedProse`) — L51‑75
- `src/retrieval/output/explain.js`
  - `formatScoreBreakdown` + graph fields — L16‑62
- `src/retrieval/pipeline/graph-ranking.js`
  - graph index + scoring — L19‑126

### Storage (SQLite)
- `src/storage/sqlite/schema.js`
  - `REQUIRED_TABLES` — L3
- `src/storage/backend-policy.js`
  - backend selection + defaults — L8‑188

### CLI entrypoints + tools
- `bin/pairofcleats.js`
  - `search` entrypoint mapping — L64‑70
  - command list display — L697
- `bin/pairofcleats.js`
  - graph/impact/context-pack/api-contracts/architecture-check routes — L289‑551
- `tools/mcp-server.js`
  - CLI args + mode selection — L10‑41
- `tools/mcp/server-config.js`
  - mcp config/env merge — L37‑44
- `tools/mcp-server-sdk.js`
  - SDK entrypoint + module resolution — L1‑40
- `tools/structural-search.js`
  - CLI entrypoint — L6‑13
- `tools/triage/ingest.js`
  - CLI entrypoint — L13
- `tools/triage/decision.js`
  - CLI entrypoint — L11
- `tools/triage/context-pack.js`
  - CLI entrypoint — L9
- `tools/metrics-dashboard.js`
  - metrics dashboard output + fields — L9‑118
- `tools/indexer-service.js`
  - mode handling for jobs — L19‑44, L297‑381
- `tools/graph-context.js`
  - CLI entrypoint — L1‑4
- `tools/context-pack.js`
  - CLI entrypoint — L1‑4
- `tools/impact.js`
  - CLI entrypoint — L1‑4
- `tools/suggest-tests.js`
  - CLI entrypoint — L1‑4
- `tools/api-contracts.js`
  - CLI entrypoint — L1‑4
- `tools/architecture-check.js`
  - CLI entrypoint — L1‑4
- `tools/explain-risk.js`
  - CLI entrypoint — L1‑4
- `tools/tooling-doctor.js`
  - CLI entrypoint — L14
- `tools/compare-models.js`
  - CLI entrypoint — L28
- `tools/eval/run.js`
  - CLI entrypoint — L11
- `tools/build-sqlite-index.js`
  - CLI entrypoint — L1‑10
- `tools/build-lmdb-index.js`
  - CLI entrypoint — L1‑10
- `tools/ctags-ingest.js`
  - script name + defaults — L12‑36
  - spawn + error handling — L138‑145
- `tools/gtags-ingest.js`
  - script name + output — L12‑29
- `tools/lsif-ingest.js`
  - script name + output — L11‑26
- `tools/scip-ingest.js`
  - script name + output — L12‑33
  - spawn + error handling — L199‑206
- `tools/bench/micro/run.js`
  - microbench CLI options — L22‑95
- `tools/bench/micro/tinybench.js`
  - tinybench CLI options — L18‑60
- `tools/bench-query-generator.js`
  - query generator options + outputs — L13‑19, L90‑99
- `tools/bench/language/cli.js`
  - language bench CLI options — L53‑96
- `tools/bench-language-repos.js`
  - tiers + stub embeddings forwarding — L290‑296, L653‑657
- `tools/bench-language-matrix.js`
  - matrix CLI options — L20‑38, L54‑96
- `tools/bench/graph-caps-harness.js`
  - graph caps harness CLI options — L80‑107
- `src/shared/cli-options.js`
  - `query-concurrency` option — L50
- `tools/repo-inventory.js`
  - CLI + output location — L9‑11
  - generator metadata — L206

### API server/router
- `tools/api-server.js`
  - auth gating + allow-unauthenticated — L47‑59
- `tools/api/validation.js`
  - search request schema — L29
- `tools/api/router.js`
  - core imports + search/status handling — L1, L105‑223
- `tools/api/router/search.js`
  - CLI arg mapping — L41‑141
- `src/integrations/core/search.js`
  - `search` handler — L11
- `src/integrations/core/status.js`
  - `status` handler — L257
- `src/integrations/core/build-index/index.js`
  - `buildIndex` entrypoint — L39
- `src/integrations/core/args.js`
  - `buildRawArgs`/`buildSearchArgs` — L12‑44
- `src/integrations/core/build-index/sqlite.js`
  - `buildSqliteIndex` options — L10‑20

### CI + test runner
- `tools/ci/run-suite.js`
  - capability gate wiring — L93, L137
- `tools/ci/capability-gate.js`
  - CLI + failure reporting — L18, L145‑190
- `tests/run.js`
  - lane timeout resolution — L297
  - `--list-lanes/--list-tags` — L97‑100
  - lane order files — L62, L173‑210
  - env overrides (`PAIROFCLEATS_TEST_*`) — L274‑288
  - `--log-times` / timings output — L306‑319, L464‑468
- `tests/run.rules.jsonc`
  - `laneRules` — L15‑24
  - `tagRules` — L31‑116
- `tests/run.config.jsonc`
  - `lanes` definition — L10
- `tests/tooling/script-coverage/paths.js`
  - `.testLogs` + `.testCache` roots — L13‑17

### Config + env
- `src/shared/env.js`
  - `getEnvConfig` — ~L23‑60
  - `getTestEnvConfig` — ~L64‑120
- `src/shared/runtime-envelope.js`
  - `resolveRuntimeEnvelope` — L115
- `src/shared/threads.js`
  - thread/concurrency defaults — L8‑97

### Safety + regex
- `src/shared/safe-regex.js`
  - `compileSafeRegex` — L144
- `src/shared/safe-regex/backends/re2js.js`
  - RE2JS translate/compile — L14‑28

### SCM providers
- `src/index/scm/providers/git.js`
  - `listTrackedFiles` — L33
  - `getRepoProvenance` head/dirty — L59‑63
- `src/index/scm/providers/jj.js`
  - `listTrackedFiles` — L206
  - `getRepoProvenance` head/dirty — L247‑287

### Index signatures + tooling
- `src/index/build/indexer/signatures.js`
  - `SIGNATURE_VERSION` usage — L63, L130
- `src/index/tooling/doctor.js`
  - `annotateEnabled` — L235
- `src/index/tooling/provider-contract.js`
  - `validateToolingProvider` — L50‑58
- `src/index/tooling/provider-registry.js`
  - provider ordering/filters — L18‑138
- `src/index/tooling/orchestrator.js`
  - provider run + cache key — L158‑257
- `src/index/tooling/vfs.js`
  - VFS constants + trim logging — L8, L100, L245
- `src/index/tooling/typescript-provider.js`
  - compiler defaults — L19‑25
  - config discovery — L78‑95
  - parse config — L109‑122
  - provider entrypoint `run` — L287‑437

### Risk artifacts + call sites
- `src/index/build/artifacts/writers/risk-interprocedural.js`
  - stats assembly + artifact writes — L156‑211
- `src/index/build/artifacts/writers/call-sites.js`
  - JSONL write + sharding — L189‑280

### Watch/promotion
- `src/index/build/watch/resolve-backend.js`
  - backend selection + warnings — L8‑21
- `src/index/build/watch/lock.js`
  - lock retry logging — L32‑34
- `src/index/build/watch/attempts.js`
  - attempts root + ids — L19‑61
