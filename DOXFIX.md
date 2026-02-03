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
   - **Default:** remove from docs (no schema in `ARTIFACT_SCHEMA_DEFS`).

2) **N‑1 major support for 0.x artifact surfaces**  
   - Options: change code to support N‑1 vs document current behavior  
   - **Default:** document current behavior (0.x supports current major only).

3) **`extensions`-only vs extra top‑level fields**  
   - Options: tighten schemas vs relax docs  
   - **Default:** relax docs to allow additionalProperties (current schema behavior).

4) **Graph explain shape** (`scoreBreakdown.graph`)  
   - Options: change output to match docs vs update docs  
   - **Default:** update docs to match current output (`score`, `degree`, `proximity`, `weights`, `seedSelection`, `seedK`).

5) **Impact input requirement** (seed/changed)  
   - Options: enforce non‑empty requirement vs document warning+empty result  
   - **Default:** document warning+empty result unless you want stricter enforcement.

6) **Graph product surfaces doc** (`docs/specs/graph-product-surfaces.md`)  
   - Options: keep authoritative and update vs archive  
   - **Default:** keep authoritative and update (still referenced by search-contract).

7) **Risk specs trimming/ordering vs implementation**  
   - Options: enforce spec in code vs update spec to current behavior  
   - **Default:** update specs to current behavior unless you want to tighten runtime behavior.

8) **Tooling IO `fileTextByFile` cache**  
   - Options: implement cache in providers vs update spec to VFS approach  
   - **Default:** update spec to VFS approach.

9) **TypeScript provider JS parity** (heuristic SymbolRef IDs)  
   - Options: remove heuristic IDs in code vs update spec to allow them  
   - **Default:** update spec to allow heuristics (document rationale).

10) **VFS manifest trimming vs row drop**  
   - Options: enforce deterministic trimming before drop vs update spec  
   - **Default:** update spec to current drop behavior unless you want stricter output.

11) **`docs/new_docs/*` promotion**  
   - Options: promote into `docs/specs/*` vs archive/remove  
   - **Default:** promote into `docs/specs/*` if still relevant to current plans.

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

## 0) Canonical source decisions (must do first)

[ ] [DECISION] Confirm canonical source per domain:
    - Contracts: `docs/contracts/*` + `src/contracts/**`
    - Specs: `docs/specs/*` only where referenced as canonical
    - Guides: `docs/guides/*` should match `bin/pairofcleats.js` and tool entrypoints
    - Testing: `docs/testing/*` should match `tests/run.js` + `tests/run.rules.jsonc`

[ ] [DECISION] For each mismatch below, choose "doc fix" vs "code fix" and log it inline.

---

## 1) Contracts subsystem (docs/contracts)

### 1.1 docs/contracts/analysis-schemas.md
- Issue: API contracts doc omits required `options` object.

[ ] [DOC] Add `options` to API contracts section (onlyExports, failOnWarn, caps).
    - Touchpoints:
      - `src/contracts/schemas/analysis.js` ~L684 (`API_CONTRACTS_SCHEMA`)
      - `src/contracts/validators/analysis.js` ~L77 (`validateApiContracts`)

### 1.2 docs/contracts/artifact-contract.md
- Issues: legacy sharded meta format; compressed sidecar precedence described incorrectly.

[ ] [DOC] Replace sharded JSONL meta description with jsonl-sharded schema.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L317 (`baseShardedJsonlMeta`)
[ ] [DOC] Fix loader precedence: raw `.json` first, compressed sidecars only when raw missing.
    - Touchpoints:
      - `src/shared/artifact-io/json.js` ~L16 (`readJsonFile`)
      - `src/shared/artifact-io/loaders.js` ~L20 (`resolveJsonlArtifactSources`)

### 1.3 docs/contracts/artifact-schemas.md
- Issues: missing artifacts; `api_contracts_meta` mismatch; missing required fields.

[ ] [DOC] Add missing artifacts: `chunk_uid_map`, `vfs_manifest`, `risk_summaries`, `risk_flows`, `risk_interprocedural_stats`, and their `*_meta` if present.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L810 (`ARTIFACT_SCHEMA_DEFS`)
[ ] [DECISION] `api_contracts_meta`: add schema or remove from doc.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L810
[ ] [DOC] Document required `kind` field for `import_resolution_graph` edges.
[ ] [DOC] Document `index_state.riskInterprocedural` object and required fields.

### 1.4 docs/contracts/compatibility-key.md
- Issue: wrong callsite path.

[ ] [DOC] Fix reference to `src/integrations/core/build-index/compatibility.js`.
    - Touchpoints:
      - `src/integrations/core/build-index/compatibility.js` (search `buildCompatibilityKey`)

### 1.5 docs/contracts/graph-tools-cli.md
- Issue: doc requires seed/changed; CLI allows empty with warning.

[ ] [DECISION] Enforce seed/changed in CLI or update doc to match warning behavior.
    - Touchpoints:
      - `src/graph/impact.js` (`buildImpactAnalysis` warning)
      - `src/integrations/tooling/impact.js`

### 1.6 docs/contracts/indexing.md
- Issues: sharded meta format + compression precedence outdated.

[ ] [DOC] Update sharded JSONL meta section (jsonl-sharded schema).
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L317
[ ] [DOC] Update compression precedence (raw-first).
    - Touchpoints:
      - `src/shared/artifact-io/json.js` ~L16

### 1.7 docs/contracts/public-artifact-surface.md
- Issues: N-1 major support for 0.x; extensions-only rule mismatch.

[ ] [DECISION] Choose: support N-1 majors for 0.x in code or update doc to state 0.x is current-only.
    - Touchpoints:
      - `src/contracts/versioning.js` ~L19 (`resolveSupportedMajors`)
[ ] [DECISION] Choose: tighten schema to require `extensions` only or update doc to allow additional top-level fields.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` (additionalProperties in schema defs)

### 1.8 docs/contracts/retrieval-ranking.md
- Issue: graph explain shape mismatch.

[ ] [DECISION] Align doc with current `scoreBreakdown.graph` (score, degree, proximity, weights, seedSelection, seedK) or change output to match doc.
    - Touchpoints:
      - `src/retrieval/output/explain.js` ~L57
      - `src/retrieval/pipeline/graph-ranking.js` ~L125

### 1.9 docs/contracts/search-cli.md
- Issues: missing flags; context expansion flags not present; `--filter` described as substring.

[ ] [DOC] Update flags list to current CLI.
    - Touchpoints:
      - `src/retrieval/cli-args.js` ~L98-149
[ ] [DOC] Clarify `--filter` as filter expression.
    - Touchpoints:
      - `src/retrieval/cli/normalize-options.js` ~L82 (`parseFilterExpression`)

### 1.10 docs/contracts/search-contract.md
- Issue: `--kind` vs `--type`.

[ ] [DOC] Update flag name to `--type`.
    - Touchpoints:
      - `src/retrieval/cli-args.js`

### 1.11 docs/contracts/sqlite.md
- Issue: required tables list incomplete.

[ ] [DOC] Update required tables list to include `doc_lengths`, `token_stats`, `phrase_vocab`, `phrase_postings`, `chargram_vocab`, `chargram_postings`, `file_manifest`.
    - Touchpoints:
      - `src/storage/sqlite/schema.js` ~L3 (`REQUIRED_TABLES`)

---

## 2) Guides subsystem (docs/guides)

### 2.1 docs/guides/editor-integration.md
[ ] [DOC] Update JSON output fields list (add `extractedProse`).
[ ] [DOC] Tie "Compact hit fields" to `--compact` (or `--json --compact`), not plain `--json`.

### 2.2 docs/guides/external-backends.md
[ ] [DOC] Note `pairofcleats search` rejects `--backend memory` (wrapper only supports auto|sqlite|sqlite-fts|lmdb).
[ ] [DOC] Document forced backend behavior (no fallback if required indexes missing).

### 2.3 docs/guides/mcp.md
[ ] [DOC] Replace `pairofcleats service mcp` with `node tools/mcp-server.js`.
    - Touchpoints:
      - `bin/pairofcleats.js` (no mcp service route)

### 2.4 docs/guides/repometrics-dashboard.md
[ ] [DOC] Remove unsupported fields or implement them (cache hit rate, BM25 params, timings).
[ ] [DOC] Add `--top` flag to usage.

### 2.5 docs/guides/rule-packs.md
[ ] [DOC] Replace `pairofcleats structural search` with `node tools/structural-search.js`.

### 2.6 docs/guides/structural-search.md
[ ] [DOC] Replace `pairofcleats structural search` with `node tools/structural-search.js`.

### 2.7 docs/guides/triage-records.md
[ ] [DOC] Replace `pairofcleats triage ...` with tool scripts:
    - `node tools/triage/ingest.js`
    - `node tools/triage/decision.js`
    - `node tools/triage/context-pack.js`

---

## 3) Testing subsystem (docs/testing)

### 3.1 docs/testing/ci-capability-policy.md
[ ] [DOC] Update PR suite default to `ci-lite`; note `services/api` exclusion.
[ ] [DOC] Note Tantivy probing happens only in non-PR runs.
    - Touchpoints:
      - `tools/ci/run-suite.js`
      - `tools/ci/capability-gate.js`

### 3.2 docs/testing/failing-tests.md
[ ] [DOC] Update log path to `.testLogs/**` and cache path to `.testCache/**`.
    - Touchpoints:
      - `tests/run.js`
      - `tests/tooling/script-coverage/paths.js`

### 3.3 docs/testing/test-decomposition-regrouping.md
[ ] [DOC] Add lanes `ci-lite`, `ci-long`, `api`, `mcp`.
[ ] [DOC] Clarify indexing/retrieval/tooling/runner are tags/paths, not lanes.
    - Touchpoints:
      - `tests/run.rules.jsonc`

### 3.4 docs/testing/test-runner-interface.md
[ ] [DOC] Update defaults: timeouts, jobs, cache root behavior, test id format.
    - Touchpoints:
      - `tests/run.js` (defaults)
      - `tests/run.rules.jsonc` (lane list)

---

## 4) Tooling docs (docs/tooling)

### 4.1 docs/tooling/ctags.md
[ ] [DOC] Update CLI examples to `node tools/ctags-ingest.js` or npm script.

### 4.2 docs/tooling/gtags.md
[ ] [DOC] Update CLI examples to `node tools/gtags-ingest.js` or npm script.

### 4.3 docs/tooling/lsif.md
[ ] [DOC] Update CLI examples to `node tools/lsif-ingest.js` or npm script.

### 4.4 docs/tooling/scip.md
[ ] [DOC] Update CLI examples to `node tools/scip-ingest.js` or npm script.

### 4.5 docs/tooling/repo-inventory.json
[ ] [DOC] Ensure `tools/mcp-server-sdk.js` appears in `tools.entrypoints`.
    - Touchpoints:
      - `tools/mcp-server-sdk.js` (shebang)
      - `tools/repo-inventory.js` (generator)

---

## 5) API docs (docs/api)

### 5.1 docs/api/core-api.md
[ ] [DOC] Update buildIndex options list (stage/quality/modes/rawArgv/log/etc).
[ ] [DOC] Update search params (`--compact` vs jsonCompact; ann-backend/context/filter params).
[ ] [DOC] Update status params (`includeAll` vs `all`).

### 5.2 docs/api/mcp-server.md
[ ] [DOC] Note default MCP mode is legacy unless `auto` explicitly requested.

### 5.3 docs/api/server.md
[ ] [DOC] Confirm auth behavior note (localhost auth optional unless token set).
    - If correct, leave unchanged; if not, update.

---

## 6) Config docs (docs/config)

### 6.1 docs/config/contract.md
[ ] [DOC] Sync public config key list with `docs/config/schema.json`.
[ ] [DOC] Update CLI flags list to current CLI options.

### 6.2 docs/config/deprecations.md
[ ] [DOC] Align deprecations with `docs/config/schema.json`.

### 6.3 docs/config/env-overrides.md
[ ] [DOC] Update env var list to match `src/shared/env.js` and inventory.
[ ] [DOC] Clarify non-secret env behavior vs secrets-only claim.

### 6.4 docs/config/execution-plan.md
[ ] [DOC] Replace `metadata-only` with `records` / `extracted-prose` modes.
[ ] [DOC] Update provider policy examples (tooling providers vs vscode/sublime).

### 6.5 docs/config/hard-cut.md
[ ] [DOC] Remove `output.logPath` if not in schema.
[ ] [DOC] Remove `indexing.skipImportResolution` if not in schema.

---

## 7) Perf docs (docs/perf)

### 7.1 docs/perf/indexing-performance.md
[ ] [DOC] Update thread defaults to current values (16/16/32/16 on 8c/16t).

### 7.2 docs/perf/indexing-thread-limits.md
[ ] [DOC] Verify no drift; update only if thread precedence changed.

---

## 8) Benchmark docs (docs/benchmarks)

[ ] [DOC] Fix CLI entrypoints for each benchmark doc:
    - `bench-hnsw.md` -> `tools/bench/hnsw-bench.js` or `npm run bench:hnsw`
    - `bench-language-repos.md` -> `tools/bench/bench-language-repos.js`
    - `bench-language-stream.md` -> `tools/bench/bench-language-stream.js`
    - `bench-retrieval-pipeline.md` -> `tools/bench/bench-retrieval-pipeline.js`
    - `bench-summary.md` -> `tools/bench/bench-summary.js`

---

## 9) Language docs (docs/language)

### 9.1 docs/language/lang-sql.md
[ ] [DOC] Update default mode to `--mode all`.

### 9.2 docs/language/lang-typescript.md
[ ] [DOC] Update default mode to `--mode all`.

---

## 10) New docs (docs/new_docs)

### 10.1 docs/new_docs/graph-caps.md
[ ] [DECISION] Promote to `docs/specs/graph-caps.md` or archive/remove.

### 10.2 docs/new_docs/symbol-artifacts-and-pipeline.md
[ ] [DECISION] Merge into `docs/specs/symbol-artifacts-and-pipeline.md` or archive/remove.

---

## 11) Specs subsystem (docs/specs)

### 11.1 docs/specs/analysis-schemas.md
[ ] [DOC] Update to current schema (graph context, impact, api contracts, architecture, suggest-tests).
    - Touchpoints:
      - `src/contracts/schemas/analysis.js` ~L505 (`GRAPH_CONTEXT_PACK_SCHEMA`)
      - `src/contracts/schemas/analysis.js` ~L684 (`API_CONTRACTS_SCHEMA`)
      - `src/contracts/schemas/analysis.js` ~L774 (`SUGGEST_TESTS_SCHEMA`)

### 11.2 docs/specs/artifact-schemas.md
[ ] [DOC] Add missing artifacts and update jsonl-sharded schema.
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js` ~L317, ~L810
[ ] [DECISION] `api_contracts_meta`: add schema or remove from docs.

### 11.3 docs/specs/graph-caps.md
[ ] [DOC] Replace placeholder with actual schema + defaults.
    - Touchpoints:
      - `src/retrieval/pipeline/graph-ranking.js`

### 11.4 docs/specs/graph-product-surfaces.md
[ ] [DECISION] Keep as authoritative (update) or archive if superseded.

### 11.5 Risk specs (all five files)
[ ] [DOC] Align required fields with schema (`mode`, `callSiteSampling`, `timingMs.io`, etc).
    - Touchpoints:
      - `src/contracts/schemas/artifacts.js`
[ ] [DECISION] Enforce deterministic trimming/ordering in code or update spec to current behavior.
    - Touchpoints:
      - `src/index/build/artifacts/writers/*`

### 11.6 docs/specs/runtime-envelope.md
[ ] [DOC] Update env precedence + envelope fields.
    - Touchpoints:
      - `src/shared/runtime-envelope.js`
      - `src/shared/env.js`

### 11.7 docs/specs/safe-regex-hardening.md
[ ] [DOC] Add RE2JS fallback + input/program caps; reference `compileSafeRegex`.
    - Touchpoints:
      - `src/shared/safe-regex.js`
      - `src/shared/safe-regex/backends/*`

### 11.8 SCM specs
[ ] [DOC] Expand provider contract (head/dirty semantics, path normalization, precedence, error signaling).
[ ] [DOC] Add JJ operationId to schema.
    - Touchpoints:
      - `src/index/scm/providers/git.js`
      - `src/index/scm/providers/jj.js`

### 11.9 docs/specs/segmentation-perf.md
[ ] [DOC] Update caps/targets to current maxBytes and fallback logic.

### 11.10 docs/specs/signature.md
[ ] [DOC] Update signature inputs (include repo provenance/provider head, index compat key).
    - Touchpoints:
      - `src/index/build/indexer/signatures.js`

### 11.11 docs/specs/symbol-artifacts-and-pipeline.md
[ ] [DOC] Align with current symbol artifact schema or mark as draft.
    - Touchpoints:
      - `src/index/build/artifacts/writers/*`

### 11.12 docs/specs/test-strategy-and-conformance-matrix.md
[ ] [DOC] Update lane list and descriptions (ci-lite, ci-long, api, mcp).

### 11.13 docs/specs/tooling-and-api-contract.md
[ ] [DOC] Update MCP tool list and defaults; include schemaVersion in responses.
    - Touchpoints:
      - `src/integrations/mcp/defs.js`
      - `tools/mcp/server-config.js`

### 11.14 docs/specs/tooling-doctor-and-reporting.md
[ ] [DOC] Align report schema with `src/index/tooling/doctor.js` output.

### 11.15 docs/specs/tooling-io.md
[ ] [DECISION] Implement `fileTextByFile` caching in tooling or update spec to VFS approach.
    - Touchpoints:
      - `src/index/tooling/*`
      - `src/index/tooling/vfs.js`

### 11.16 docs/specs/tooling-provider-registry.md
[ ] [DOC] Update names/fields to match `src/index/tooling/provider-registry.js` + `orchestrator.js`.

### 11.17 docs/specs/typescript-provider-js-parity.md
[ ] [DECISION] Remove no-ad-hoc-ID rule or change implementation to avoid heuristic SymbolRef IDs.
    - Touchpoints:
      - `src/index/tooling/typescript-provider.js`

### 11.18 docs/specs/vfs-manifest-artifact.md
[ ] [DECISION] Enforce deterministic trimming before dropping oversized rows or update spec.
    - Touchpoints:
      - `src/index/tooling/vfs.js`

### 11.19 docs/specs/watch-atomicity.md
[ ] [DOC] Update attempt root / promotion barrier names and defaults.
    - Touchpoints:
      - `src/index/build/watch/*`

### 11.20 Workspace specs
[ ] [DOC] Sync workspace config keys with `docs/config/schema.json` (include `indexing.scm.*`).
[ ] [DOC] Revalidate workspace manifest fields and manifestHash rules vs current federation plan.

---

## 12) Archived docs (docs/archived)

[ ] [DOC] Confirm archived docs are not referenced as canonical anywhere.
[ ] [DOC] Where referenced for historical context, ensure they are labeled DEPRECATED and point to replacements.

---

## 13) Deliverables and validation

[ ] [DOC] Update `COSMIC_DOCS_LEDGER.md` with resolution status tags (doc fix vs code fix) per task above.
[ ] [DOC] Ensure all references in guides/contracts/specs point to correct paths.
[ ] [DOC] Run any existing doc validation (if present) or add a minimal consistency check.

---

## 14) Optional automation (quality-of-life)

[ ] [CODE] Add a doc drift checker that compares:
    - CLI flags vs docs
    - Schema lists vs docs
    - Test lanes vs docs
    - Entry points vs docs
    - Output fields vs docs
    - Touchpoints:
      - `tools/` (new script)
      - `docs/testing/` for policy

---

## Notes for triage (missing functionality vs outdated docs)

- If a doc is a contract/spec referenced by validation or build code, treat it as authoritative and fix code unless the contract is obsolete.
- If a guide/bench doc is inconsistent with current CLI/tools, fix the doc unless you intend to support the documented behavior.
- If both doc and code are ambiguous, record a decision first and then update both.
