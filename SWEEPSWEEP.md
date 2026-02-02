# SWEEPSWEEP


---

## From CRITICAL_SWEEP.md (confirmed)

- [x] **Fix tree-sitter deferral crash path**: `process-files.js` calls `normalizeTreeSitterLanguages(...)` without import/export. Export it from `src/index/build/indexer/steps/process-files/tree-sitter.js` (or replace with an already-exported helper) and import in `src/index/build/indexer/steps/process-files.js` so deferral merges don’t throw `ReferenceError`.
- [x] **Resolve env override gating**: `getEnvConfig()` still returns only `{ apiToken, mcpMode }` unless `PAIROFCLEATS_TESTING` is set. Decide and implement the intended contract:
  - Preferred: allow production overrides by removing the testing gate and keep test-only fields in `getTestEnvConfig()`.
  - If test-only is intended, remove production reads of `envConfig.*` or document them as test-only.
- [x] **Add missing envConfig fields that consumers already read**: `regexEngine`, `compression`, `docExtract`, `mcpTransport`, `modelsDir`, `dictDir` (tools and MCP code read these today). Add them to `getEnvConfig()` with documented env var names and validation.
- [x] **Unconsumed env vars in inventory**: `PAIROFCLEATS_HOME`, `PAIROFCLEATS_MODELS_DIR`, `PAIROFCLEATS_DICT_DIR`, `PAIROFCLEATS_EXTENSIONS_DIR` are still listed but unused in runtime paths. Either wire them into path resolution (preferred if docs promise them) or remove from `docs/config/inventory.*` and related docs.
- [x] **Search wrapper backend restriction**: `bin/pairofcleats.js` still blocks `sqlite-fts` (`--backend` only allows auto/sqlite/lmdb). Either allow `sqlite-fts` or delegate backend validation to the retrieval CLI.
- [x] **Document extraction mismatch**: README/docs still claim PDF/DOCX support, but no extraction pipeline exists and `docExtract` is not wired into env config. Either implement end-to-end extraction or downgrade the docs to “planned” and remove the env var until implemented.
- [x] **Docs reference npm test scripts that don’t exist**: `package.json` has no `test`, `test:pr`, `test:nightly`, `test:ci-lite`, `test:ci-long` scripts. Update docs/AGENTS to use the actual entrypoints (`node tests/run.js`, `node tools/ci/run-suite.js`) or reintroduce thin npm aliases.
- [x] **Metrics backend labels**: `src/shared/metrics.js` still omits `lmdb` from allowed backend labels; add it to prevent “unknown” metrics for LMDB searches.

---

## From OLDER_PHASES_ISSUES.md (confirmed)

- [x] **Phase 6 VFS spec drift vs completed-phase text**: the implemented VFS spec (`docs/specs/vfs-manifest-artifact.md`) uses percent-escaping and `.poc-vfs/` prefix. Confirm `COMPLETED_PHASES.md` still claims base64url + `.poc-vfs` and reconcile to the canonical spec (prefer the current spec + implementation).
- [x] **Phase 6/Phase R script references**: AGENTS/README still refer to npm scripts that do not exist. Align docs to current entrypoints or restore the scripts.
- [x] **Windows CI marked non-blocking**: `.github/workflows/ci.yml` still sets `continue-on-error: true` for Windows. Decide whether this should be blocking and update accordingly.

---

## From PHASE10_PATCHLIST.md (confirmed)

### 10.1 Config + runtime gating
- [x] **Mode-aware interprocedural gating**: `runtime.riskInterproceduralEnabled` is still global. Implement mode-scoped gating (code-only) in the indexer pipeline and ensure downstream steps use the mode-effective config.
- [x] **Incremental signatures use mode-effective risk interprocedural config**: update `src/index/build/indexer/signatures.js` to use mode-scoped config.
- [x] **index_state.json mode-effective values**: ensure `riskInterprocedural.{enabled,summaryOnly,emitArtifacts}` reflect mode-effective values in `src/index/build/indexer/steps/write.js`.
- [x] **Tests**: extend runtime gating tests to assert code vs non-code behavior.

### 10.3 Risk summaries + compact chunk meta
- [x] **Update `buildRiskSummaries` signature + gating**: still `({ chunks, interprocedural, log })` and only runs when `riskInterproceduralEnabled` is true. Align signature to `({ chunks, runtime, mode, log })` and allow summaries when `emitArtifacts === "jsonl"` even if interprocedural is off (per roadmap).
- [x] **Deterministic sink ordering**: include severity → ruleId → evidence location ordering and update tests.
- [x] **Taint hints**: add `taintHints.taintedIdentifiers` to local risk output and cap/sort deterministically.

### 10.5 Propagation confidence scoring
- [x] **Implement exact confidence formula** in `flowConfidence()` (currently average + 0.85**hopCount + 0.9**barriers and floor 0.05). Update to roadmap formula and add tests.

### 10.6 Artifacts + contracts + required keys
- [x] **risk_interprocedural_stats schema + payload**: add canonical fields (`callSiteSampling`, `mode`, `timingMs.io`, `counts.risksWithFlows` = riskId count). Update `src/index/risk-interprocedural/engine.js`, `src/contracts/schemas/artifacts.js`, and docs spec.
- [x] **JSONL required keys**: `risk_summaries` required keys still include `totals`/`truncated`. Reduce to minimal set in `src/shared/artifact-io/jsonl.js`.
- [x] **enqueueRiskInterproceduralArtifacts signature + gating**: align writer signature and gating to roadmap; ensure mode/code-only + enabled logic matches, and document the single invocation location.

---

## From TRICKY_BUGS_SWEEP.md (confirmed)

- [x] **API search flag mapping is wrong**: `tools/api/router/search.js` emits `--*-filter` flags and `--output`, but CLI expects `--type`, `--author`, `--risk-tag`, `--full/--json/--compact`, etc. Replace with an explicit field→flag map and include `meta`/`metaJson` support.
- [x] **Duplicate `--repo`**: API builds `--repo`, and core search injects repo via `runSearchCli` root. Remove `--repo` from API args (preferred) or dedupe before invocation.
- [x] **Option injection via query**: `src/integrations/core/search.js` appends query without `--`. Insert `--` before the query (or at least when it starts with `-`) so yargs doesn’t treat it as flags. Consider also setting `.exitProcess(false)` in the CLI parser for server usage.
- [x] **Default output not applied**: `createApiRouter()` doesn’t pass `defaultOutput` to `buildSearchParams()`. Thread the value through so server defaults work.
- [x] **VSCode query parsing**: `extensions/vscode/extension.js` passes `query` directly as argv without `--`. Insert `--` before the query to avoid `--help`/flag interpretation.
- [x] **MCP transport shadowing**: `tools/mcp/transport.js` shadows `inFlight` inside `enqueueMessage()`. Rename the inner variable to avoid confusion.

---

## Notes on items found to be resolved / not applicable

- Phase 9 and Phase 7 checks in `OLDER_PHASES_ISSUES.md` still report no additional issues (no tasks added here).
- `bin/pairofcleats.js` no longer has the old search allowlist; only backend validation remains to fix.
