# COSMIC_DOCS_LEDGER

Comprehensive documentation audit compiled from subsystem audits. This ledger is intended to be exhaustive and traceable; each section preserves the original audit output and findings.

## Scope
- docs/contracts
- docs/guides
- docs/testing
- docs/tooling
- docs/api
- docs/config
- docs/sqlite
- docs/perf
- docs/benchmarks
- docs/language
- docs/dependency_references
- docs/new_docs
- docs/archived
- docs/specs

## Source audits

### Contracts

```text
DOC_AUDIT_CONTRACTS.md:
# DOC_AUDIT_CONTRACTS

## docs/contracts/analysis-schemas.md
Claims:
- Analysis schemas live in `src/contracts/schemas/analysis.js` and are validated by `src/contracts/validators/analysis.js`.
- Metadata v2 allows modifiers array or legacy object map; types buckets with params map (legacy array allowed).
- Phase 11 outputs (graph context, impact, composite context, api-contracts, architecture, suggest-tests) have required fields and provenance.

Refs:
- `src/contracts/schemas/analysis.js` (rg: `GRAPH_CONTEXT_PACK_SCHEMA`, `API_CONTRACTS_SCHEMA`)
- `src/contracts/validators/analysis.js` (rg: `validateGraphContextPack`)
- `src/integrations/tooling/graph-context.js`, `src/integrations/tooling/impact.js`, `src/integrations/tooling/context-pack.js`, `src/integrations/tooling/api-contracts.js`, `src/integrations/tooling/architecture-check.js`, `src/integrations/tooling/suggest-tests.js`

Findings:
- API contracts report: doc says minimum fields are `version`, `provenance`, `symbols[]` (plus optional truncation/warnings), but schema requires an `options` object with `onlyExports`, `failOnWarn`, and `caps`. Doc likely wrong/outdated.

## docs/contracts/artifact-contract.md
Claims:
- Legacy but describes on-disk artifact layout and loader precedence (shards/jsonl/json), plus compression sidecar preference.
- Sharded meta examples use `{ format, shardSize, totalChunks, parts }`.

Refs:
- `src/shared/artifact-io/loaders.js` (rg: `resolveJsonlArtifactSources`, `loadJsonArrayArtifact`)
- `src/shared/artifact-io/json.js` (rg: `readJsonFile`)
- `src/contracts/schemas/artifacts.js` (rg: `baseShardedJsonlMeta`)
- `src/index/build/runtime/runtime.js` (rg: `buildId`)

Findings:
- Sharded meta schema is outdated: code expects the newer `jsonl-sharded` meta (schemaVersion, compression, totalRecords/bytes, maxPart*, targetMaxBytes, parts with records/bytes). Doc still lists the older `{ format, shardSize, totalChunks, parts }`. Doc likely wrong/outdated.
- Loader precedence for compressed sidecars: doc says prefer `.json.zst`/`.json.gz` when present. `readJsonFile` reads the raw `.json` first if it exists, and only falls back to compressed sidecars when the raw file is missing. Doc likely wrong/outdated.

## docs/contracts/artifact-schemas.md
Claims:
- Canonical schema for on-disk artifacts; manifest-first discovery; sharded JSONL meta schema.
- Artifact registry list describes required fields per artifact.

Refs:
- `src/contracts/schemas/artifacts.js` (rg: `ARTIFACT_SCHEMA_DEFS`, `buildShardedJsonlMeta`)
- `src/index/validate/manifest.js`, `src/index/validate/presence.js`

Findings:
- Missing artifacts in doc: schema includes `chunk_uid_map`, `vfs_manifest`, `risk_summaries`, `risk_flows`, and `risk_interprocedural_stats` (plus their `*_meta` entries). Doc does not list these. Doc likely wrong/outdated.
- Doc lists `api_contracts_meta` as a sharded meta artifact, but `ARTIFACT_SCHEMA_DEFS` does not define `api_contracts_meta`. Doc likely wrong/outdated (or schema missing if feature is intended).
- `import_resolution_graph` edges in schema require a `kind` field; doc does not mention `kind` as required. Doc likely wrong/outdated.
- `index_state` schema contains a `riskInterprocedural` object (with required `enabled`, `summaryOnly`, `emitArtifacts`), which the doc does not mention. Doc likely wrong/outdated.

## docs/contracts/chunking.md
Claims:
- `chunk.metaV2.chunkId` is deterministic (file + segmentId + start/end, disambiguated by spanIndex), not stable across line shifts.
- `chunk.id` is build-local numeric id.
- `start`/`end` offsets are UTF-16 code unit indices; `startLine`/`endLine` are 1-based.

Refs:
- `src/index/chunk-id.js` (rg: `buildChunkId`)
- `src/index/build/state.js` (rg: `chunk.id =`)

Findings:
- No mismatches found in code references for chunkId derivation or chunk.id assignment. (UTF-16 offset claim not directly asserted in code; no conflict observed.)

## docs/contracts/compatibility-key.md
Claims:
- Compatibility key computed in `src/contracts/compatibility.js`, called from `src/integrations/core/index.js`.
- Payload includes artifact surface major, schema hash, tokenization keys, embeddings key, language policy key, chunk id algo version, sqlite schema version, modes.

Refs:
- `src/contracts/compatibility.js` (rg: `buildCompatibilityKey`)
- `src/integrations/core/build-index/compatibility.js` (rg: `buildCompatibilityKey`)
- `src/shared/artifact-io/manifest.js` (rg: `readCompatibilityKey`)

Findings:
- Call site path is wrong: compatibility key is set in `src/integrations/core/build-index/compatibility.js`, not `src/integrations/core/index.js`. Doc likely wrong/outdated.

## docs/contracts/coverage-ledger.md
Claims:
- Maps entrypoints to contract docs and tests.

Refs:
- `build_index.js`, `tools/build-embeddings.js`, `tools/build-sqlite-index.js`, `search.js`, `bin/pairofcleats.js`, `tools/api-server.js`, `tools/mcp-server.js`, `tools/indexer-service.js`, `tools/index-validate.js`, `tools/assemble-pieces.js`, `tools/compact-pieces.js`, `tools/ci-restore-artifacts.js`

Findings:
- No mismatches found (paths referenced exist; test coverage not revalidated here).

## docs/contracts/graph-tools-cli.md
Claims:
- CLI contracts for graph-context, impact, context-pack, api-contracts, architecture-check, suggest-tests with shared caps/format rules.
- Impact requires seed or changed list; seed inference possible if prefix omitted (recommended to require prefix).

Refs:
- `bin/pairofcleats.js` (rg: `graph-context`, `impact`, `context-pack`, `api-contracts`, `architecture-check`, `suggest-tests`)
- `src/integrations/tooling/graph-context.js`, `src/integrations/tooling/impact.js`, `src/integrations/tooling/context-pack.js`, `src/integrations/tooling/api-contracts.js`, `src/integrations/tooling/architecture-check.js`, `src/integrations/tooling/suggest-tests.js`
- `src/graph/impact.js`

Findings:
- Impact input requirement: doc says at least one of `seed` or `changed/changedFile` must be provided. CLI allows empty seed and empty changed list; `buildImpactAnalysis` returns a warning and empty results instead of hard error. Doc likely wrong/outdated (or CLI should enforce). 

## docs/contracts/indexing.md
Claims:
- Stages 1-4 and mode semantics.
- Artifact minimum set, format precedence, and sharded meta schema (format/shardSize/totalChunks).
- Compressed artifacts can be loaded via sidecars; raw precedence only when keepRaw enabled.

Refs:
- `src/index/build/runtime/stage.js` (rg: `stage1`, `stage2`, `stage3`, `stage4`)
- `src/shared/artifact-io/loaders.js` (rg: `resolveJsonlArtifactSources`)
- `src/shared/artifact-io/json.js` (rg: `readJsonFile`)
- `src/contracts/schemas/artifacts.js` (rg: `baseShardedJsonlMeta`)

Findings:
- Sharded meta schema described here is the old format; code/schema use the newer `jsonl-sharded` meta schema with schemaVersion + compression + totalRecords/bytes + maxPart* + targetMaxBytes. Doc likely wrong/outdated.
- Compression precedence: `readJsonFile` always prefers raw `.json` if it exists; there is no `keepRaw` toggle. Doc’s precedence/keepRaw behavior is outdated. Doc likely wrong/outdated.

## docs/contracts/mcp-api.md
Claims:
- API server endpoints (`/health`, `/status`, `/status/stream`, `/metrics`, `/search`, `/search/stream`) and error semantics.
- MCP server transport modes and tool schema versioning; initialize response validated by `mcp-initialize.schema.json`.

Refs:
- `tools/api-server.js`, `tools/api/router.js` (rg: `/search`, `/status`, `/health`)
- `tools/mcp-server.js`, `tools/mcp/transport.js`
- `src/integrations/mcp/defs.js`, `src/integrations/mcp/validate.js`

Findings:
- No mismatches found for the listed current endpoints and MCP transport behavior. Phase 11 endpoints are described as recommended; they are not present in `tools/api/router.js` (doc is aspirational, not contradictory).

## docs/contracts/mcp-error-codes.md
Claims:
- Canonical MCP error codes and payload shape.

Refs:
- `src/shared/error-codes.js`
- `src/integrations/mcp/protocol.js` (rg: `formatToolError`)

Findings:
- No mismatches found.

## docs/contracts/mcp-initialize.schema.json
Claims:
- Initialize response must include `protocolVersion`, `serverInfo`, `capabilities`, `schemaVersion`, `toolVersion`.

Refs:
- `src/integrations/mcp/protocol.js` (rg: `buildInitializeResult`)
- `tools/mcp/server-config.js` (rg: `schemaVersion`, `toolVersion`)

Findings:
- No mismatches found (server config provides schema/tool versions; initialize result includes them when provided).

## docs/contracts/mcp-tools.schema.json
Claims:
- Snapshot of MCP tool definitions (schemaVersion 1.0.0) used for validation.

Refs:
- `src/integrations/mcp/defs.js`
- `src/integrations/mcp/validate.js` (rg: `MCP_TOOL_SCHEMA_SNAPSHOT_PATH`)
- `tools/mcp/tools.js` (rg: `TOOL_HANDLERS`)

Findings:
- No mismatches found (snapshot aligns with tool defs/handlers).

## docs/contracts/public-artifact-surface.md
Claims:
- `artifactSurfaceVersion` 0.0.1; readers must support N-1 major.
- Additional fields allowed only under `extensions`; unknown top-level fields are errors.
- Sharded JSONL meta schema required.

Refs:
- `src/contracts/versioning.js` (rg: `ARTIFACT_SURFACE_VERSION`, `resolveSupportedMajors`)
- `src/contracts/schemas/artifacts.js` (rg: `additionalProperties: true`)

Findings:
- N-1 major support: `resolveSupportedMajors` only returns the current major when major is 0, so N-1 is not supported for 0.x versions. Doc likely wrong/outdated for 0.x behavior (or code should change).
- Extension policy conflict: many artifact schemas set `additionalProperties: true`, which allows extra top-level fields outside `extensions`. Doc’s “extensions only” rule is stricter than current schema. Doc likely wrong/outdated (or schema should be tightened).

## docs/contracts/retrieval-ranking.md
Claims:
- Explain `scoreBreakdown` includes sparse/ann/rrf/blend/symbol/phrase; graph ranking adds `scoreBreakdown.graph` with `enabled`, `delta`, `features`, optional truncation.
- Graph-aware ranking is opt-in and must not change membership.

Refs:
- `src/retrieval/pipeline.js` (rg: `scoreBreakdown`)
- `src/retrieval/pipeline/graph-ranking.js`
- `src/retrieval/output/explain.js`

Findings:
- Graph explain shape mismatch: code emits `scoreBreakdown.graph` with `score`, `degree`, `proximity`, `weights`, `seedSelection`, `seedK`. Doc expects `enabled`, `delta`, `features`, and truncation. Doc likely wrong/outdated (or explain output should be updated).

## docs/contracts/search-cli.md
Claims:
- Search CLI flags include `--graph-ranking`, `--graph-ranking-weights`, and context expansion flags (opt-in).
- `--filter` is described as a path substring filter.

Refs:
- `src/retrieval/cli-args.js` (rg: `graph-ranking-*`, `filter`)
- `src/retrieval/cli/normalize-options.js` (rg: `graphRankingConfig`, `parseFilterExpression`)

Findings:
- Graph ranking flags mismatch: CLI does not implement `--graph-ranking` or `--graph-ranking-weights`; graph ranking is enabled via config only, and only `--graph-ranking-max-*`/`--graph-ranking-seeds` flags exist. Doc likely wrong/outdated.
- Context expansion flags described in doc are not present in CLI args; feature is config-driven. Doc likely wrong/outdated.
- `--filter` is parsed as a filter expression (see `parseFilterExpression`), not solely a path substring filter. Doc likely wrong/outdated.

## docs/contracts/search-contract.md
Claims:
- Filters include `--kind`, `--signature`, etc; filters ANDed; graph ranking membership invariant.

Refs:
- `src/retrieval/cli-args.js` (rg: `type`, `signature`)
- `src/retrieval/cli/normalize-options.js` (rg: `parseFilterExpression`)

Findings:
- Flag name mismatch: CLI uses `--type` (chunk kind) rather than `--kind`. Doc likely wrong/outdated.

## docs/contracts/sqlite.md
Claims:
- Required tables include `chunks`, `token_vocab`, `token_postings`, `minhash_signatures`, `dense_vectors`, `dense_meta` (+ FTS tables when configured).
- `chunks.metaV2_json` must be present and parsed strictly.

Refs:
- `src/storage/sqlite/schema.js` (rg: `REQUIRED_TABLES`)
- `src/index/validate/sqlite-report.js` (rg: `sqliteRequiredTables`)
- `src/retrieval/sqlite-helpers.js` (rg: `metaV2_json`)

Findings:
- Required tables list is incomplete for the default BM25 schema: code requires `doc_lengths`, `token_stats`, `phrase_vocab`, `phrase_postings`, `chargram_vocab`, `chargram_postings` (and `file_manifest` in schema) in addition to those listed. Doc likely wrong/outdated.
```

### Guides

```text
DOC_AUDIT_GUIDES.md:
# Docs Guides Audit

## docs/guides/architecture.md
References:
- README.md
- docs/tooling/repo-inventory.json
- COMPLETED_PHASES.md
Status: OK
Notes:
- No CLI flags or behaviors to reconcile.

## docs/guides/code-maps.md
References:
- docs/tooling/repo-inventory.json
- COMPLETED_PHASES.md
Status: OK
Notes:
- CLI examples align with `pairofcleats report map` and `tools/report-code-map.js` formats.

## docs/guides/commands.md
References:
- AGENTS.md
- docs/tooling/repo-inventory.json
- COMPLETED_PHASES.md
- FUTUREROADMAP.md
- docs/config/execution-plan.md
- docs/config/hard-cut.md
- docs/archived/PHASE_0.md
- docs/archived/PHASE_8.md
Status: OK
Notes:
- SCM flags listed (`--scm-provider`, `--scm-annotate`, `--no-scm-annotate`) match `INDEX_BUILD_OPTIONS`.

## docs/guides/editor-integration.md
References:
- docs/tooling/repo-inventory.json
- FUTUREROADMAP.md
Status: Needs update
Notes:
- JSON output always includes `extractedProse`; the guide lists only `backend`, `code`, `prose`, `records`, `stats`.
- The “Compact hit fields (subset, for `--json`)” section should be tied to `--compact` (or `--json --compact`), not plain `--json`.

## docs/guides/embeddings.md
References:
- docs/tooling/repo-inventory.json
- docs/guides/architecture.md
- COMPLETED_PHASES.md
Status: OK
Notes:
- Dense vector mode and sqlite-vec behavior match current search pipeline enforcement.

## docs/guides/external-backends.md
References:
- docs/tooling/repo-inventory.json
- docs/guides/architecture.md
- docs/config/execution-plan.md
Status: Needs update
Notes:
- `pairofcleats search` rejects `--backend memory` (wrapper only allows auto|sqlite|sqlite-fts|lmdb); only `node search.js` accepts it.
- `--backend sqlite` / `--backend sqlite-fts` / `--backend lmdb` are forced flags; if the requested indexes are missing, the CLI errors instead of falling back to file-backed artifacts.

## docs/guides/mcp.md
References:
- docs/guides/commands.md
Status: Needs update
Notes:
- `pairofcleats service mcp` is not a supported CLI route; the server is run via `node tools/mcp-server.js`.

## docs/guides/query-cache.md
References:
- docs/tooling/repo-inventory.json
- docs/guides/architecture.md
- docs/config/execution-plan.md
Status: OK
Notes:
- Storage location and JSON output (`stats.cache`) match current implementation.

## docs/guides/release-discipline.md
References:
- docs/tooling/repo-inventory.json
- COMPLETED_PHASES.md
- FUTUREROADMAP.md
Status: OK
Notes:
- No CLI behaviors to reconcile.

## docs/guides/metrics-dashboard.md
References:
- docs/tooling/repo-inventory.json
- COMPLETED_PHASES.md
Status: Needs update
Notes:
- The dashboard output does not report cache hit rate, BM25 params, or timings; it only surfaces chunk/token counts plus search history aggregates.
- The `--top` flag (used to control top-N lists) is missing from the usage section.

## docs/guides/risk-rules.md
References:
- docs/tooling/repo-inventory.json
- docs/archived/PHASE_3.md
Status: OK
Notes:
- No CLI flags referenced.

## docs/guides/rule-packs.md
References:
- docs/tooling/repo-inventory.json
- docs/guides/structural-search.md
Status: Needs update
Notes:
- The CLI examples use `pairofcleats structural search`, but there is no `structural` command in `bin/pairofcleats.js`. The supported entrypoint is `node tools/structural-search.js`.

## docs/guides/search.md
References:
- README.md
- docs/tooling/repo-inventory.json
- docs/guides/architecture.md
- docs/config/execution-plan.md
- COMPLETED_PHASES.md
Status: OK
Notes:
- Search flags and behavior described match current `src/retrieval` and `search.js` logic.

## docs/guides/service-mode.md
References:
- docs/tooling/repo-inventory.json
- COMPLETED_PHASES.md
- FUTUREROADMAP.md
Status: OK
Notes:
- `pairofcleats service indexer <sync|enqueue|work|status|serve>` maps to `tools/indexer-service.js` commands.

## docs/guides/setup.md
References:
- README.md
- docs/tooling/repo-inventory.json
Status: OK
Notes:
- Setup flags match `tools/setup.js`.

## docs/guides/structural-search.md
References:
- README.md
- docs/tooling/repo-inventory.json
- docs/guides/search.md
- COMPLETED_PHASES.md
Status: Needs update
Notes:
- The CLI examples use `pairofcleats structural search`, but there is no `structural` command in `bin/pairofcleats.js`. The supported entrypoint is `node tools/structural-search.js`.

## docs/guides/triage-records.md
References:
- README.md
- docs/tooling/repo-inventory.json
- docs/guides/architecture.md
Status: Needs update
Notes:
- The guide references `pairofcleats triage ingest|decision|context-pack`, but there is no `triage` command in `bin/pairofcleats.js`. The supported entrypoints are `node tools/triage/ingest.js`, `node tools/triage/decision.js`, and `node tools/triage/context-pack.js`.
```

### Testing + Tooling

```text
DOC_AUDIT_TESTING_TOOLING.md:
# Testing + Tooling Doc Audit

## docs/testing/ci-capability-policy.md
- PR suite default is `ci-lite` (and `services/api/` is excluded) in `tools/ci/run-suite.js`, not `tests/run.js --lane ci` as documented.
- `tools/ci/capability-gate.js` only probes Tantivy in non-PR mode, so PR reports will not include Tantivy availability.

## docs/testing/failing-tests.md
- Log paths reference `tests/.logs/...`, but current runners write under `.testLogs` at repo root (`tests/run.js`, `tests/tooling/script-coverage/paths.js`).
- sqlite-build-indexes log path references `tests/.cache/...`, but the test uses `.testCache/sqlite-build-indexes/...` (`tests/storage/sqlite/sqlite-build-indexes.test.js`).

## docs/testing/fixture-corpus.md
- No drift found.

## docs/testing/fixture-tracking.md
- No drift found.

## docs/testing/index-state-nondeterministic-fields.md
- No drift found.

## docs/testing/test-decomposition-regrouping.md
- Lane list in the doc does not include `ci-lite`, `ci-long`, `api`, or `mcp`, which are present in `tests/run.rules.jsonc`.
- The doc implies lanes for `indexing`, `retrieval`, `tooling`, and `runner`, but the runner currently treats those as tags/paths with default `integration`/`unit` lanes (no lanes by those names in `tests/run.rules.jsonc`).

## docs/testing/test-runner-interface.md
- Default timeout is documented as 120000ms, but `tests/run.js` defaults to 30000ms (general), 15000ms (`ci-lite`), 90000ms (`ci`), and 240000ms (`ci-long`).
- Default jobs are documented as 1, but `tests/run.js` uses physical cores (`resolvePhysicalCores`).
- Doc says the runner must not force cache roots, but `tests/run.js` sets `PAIROFCLEATS_CACHE_ROOT` to `.testCache` when unset.
- Test id example includes a `.test` suffix; actual ids strip `.test.js` (e.g., `storage/sqlite/incremental/file-manifest-updates`).
- Lane list omits `ci-lite`, `ci-long`, `api`, and `mcp` lanes present in `tests/run.rules.jsonc`.

## docs/testing/truth-table.md
- No drift found.

## docs/tooling/ctags.md
- Examples use `pairofcleats ingest ctags`, but the CLI has no `ingest` command. Current entrypoint is `node tools/ctags-ingest.js` or `npm run ctags-ingest`.

## docs/tooling/gtags.md
- Examples use `pairofcleats ingest gtags`, but the CLI has no `ingest` command. Current entrypoint is `node tools/gtags-ingest.js` or `npm run gtags-ingest`.

## docs/tooling/lsif.md
- Examples use `pairofcleats ingest lsif`, but the CLI has no `ingest` command. Current entrypoint is `node tools/lsif-ingest.js` or `npm run lsif-ingest`.

## docs/tooling/scip.md
- Examples use `pairofcleats ingest scip`, but the CLI has no `ingest` command. Current entrypoint is `node tools/scip-ingest.js` or `npm run scip-ingest`.

## docs/tooling/script-inventory.json
- No drift found (matches `package.json` scripts).

## docs/tooling/repo-inventory.json
- `tools/mcp-server-sdk.js` has a node shebang but is missing from `tools.entrypoints`, so the inventory is stale.
```

### Misc (API/Config/Perf/Benchmarks/Language/Archived)

```text
DOC_AUDIT_MISC.md:
# Docs Audit (Misc)

Scope: docs/api, docs/config, docs/sqlite, docs/perf, docs/benchmarks, docs/language, docs/dependency_references, docs/new_docs, docs/archived.

## docs/api/core-api.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- Option list is stale: buildIndex supports stage/quality/modes/rawArgv/log plus other CLI flags beyond the doc.
- search params use --compact (not jsonCompact) and accept ann-backend/context/filter params not listed; status uses includeAll (not all).
## docs/api/mcp-server.md
References:
- .\COMPLETED_PHASES.md
- .\docs\tooling\repo-inventory.json
- .\docs\contracts\mcp-api.md

Status:
- (none noted)

Notes:
- Default MCP mode in code is legacy; auto selection only occurs when auto is explicitly requested.
- Tool list and queue/buffer defaults match current server config.
## docs/api/server.md
References:
- .\docs\tooling\repo-inventory.json
- .\README.md
- .\docs\contracts\mcp-api.md

Status:
- (none noted)

Notes:
- Auth is not required on localhost unless a token is provided; code only enforces auth for non-localhost or when token is set.
- Endpoints and payload shapes align with current router implementation.
## docs/config/budgets.md
References:
- .\docs\tooling\repo-inventory.json
- .\docs\config\execution-plan.md

Status:
- (none noted)

Notes:
- Budgets are far below current reality: inventory reports 180 config keys and 58 env vars.
- Treat as policy target rather than a description of current behavior.
## docs/config/contract.md
References:
- .\COMPLETED_PHASES.md
- .\docs\config\budgets.md
- .\docs\config\execution-plan.md
- .\docs\tooling\repo-inventory.json
- .\docs\guides\architecture.md
- .\LEXI.md
- .\docs\specs\workspace-config.md
- .\GIGAROADMAP_2.md
- .\FUTUREROADMAP.md

Status:
- (none noted)

Notes:
- Public config key list does not match schema (many more namespaces exist).
- CLI flag list is outdated (mode includes extracted-prose/records/all; API server flags include auth/output/cors; search supports many filters).
## docs/config/deprecations.md
References:
- .\docs\tooling\repo-inventory.json
- .\docs\guides\release-discipline.md
- .\docs\config\hard-cut.md
- .\docs\config\execution-plan.md

Status:
- (none noted)

Notes:
- Schema no longer includes sqlite.* or cache.runtime.* keys; deprecation list is stale for the validated config surface.
- If these keys still matter for internal configs, move the list closer to the owning modules.
## docs/config/env-overrides.md
References:
- .\docs\config\execution-plan.md
- .\docs\config\hard-cut.md
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- Env list is outdated; many PAIROFCLEATS_* vars are read in src/shared/env.js and tracked in inventory.
- Doc claims secrets-only, but code still uses env for behavior toggles.
## docs/config/execution-plan.md
References:
- .\docs\tooling\repo-inventory.json
- .\docs\config\contract.md
- .\docs\config\hard-cut.md
- .\docs\config\env-overrides.md

Status:
- (none noted)

Notes:
- staged-mode example mentions "metadata-only"; code uses "records" and "extracted-prose".
- policy notes mention "vscode" and "sublime" in provider policy, but code uses tool providers.
## docs/config/hard-cut.md
References:
- .\docs\tooling\repo-inventory.json
- .\docs\config\execution-plan.md
- .\docs\config\contract.md

Status:
- (none noted)

Notes:
- lists `output.logPath` but config schema does not include it.
- `indexing.skipImportResolution` in doc does not exist in schema.
## docs/config/schema.json
References:
- .\docs\config\contract.md

Status:
- (none noted)

Notes:
- The schema is the authoritative config surface; several docs above are out of sync.

## docs/perf/indexing-performance.md
References:
- .\docs\tooling\repo-inventory.json
- .\docs\guides\architecture.md

Status:
- (none noted)

Notes:
- Current thread defaults are 16/16/32/16 for 8c/16t CPU, document still references older defaults.
## docs/perf/indexing-thread-limits.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- Describes thread limit precedence/behavior; no drift found.
## docs/benchmarks/bench-hnsw.md
References:
- .\docs\tooling\repo-inventory.json
- .\benchmarks\hnsw-bench.md

Status:
- (none noted)

Notes:
- CLI examples refer to `node tools/bench-hnsw.js`; actual file is `tools/bench/hnsw-bench.js` and entrypoint is `npm run bench:hnsw`.
## docs/benchmarks/bench-language-repos.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- CLI examples refer to `node tools/bench-language-repos.js`, actual entrypoint is `node tools/bench/bench-language-repos.js` and `npm run bench:language-repos`.
## docs/benchmarks/bench-language-stream.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- Entry point referenced as `node tools/bench-language-stream.js`; actual path is `tools/bench/bench-language-stream.js`.
## docs/benchmarks/bench-retrieval-pipeline.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- `node tools/bench-retrieval-pipeline.js` should be `node tools/bench/bench-retrieval-pipeline.js`.
## docs/benchmarks/bench-summary.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- `node tools/bench-summary.js` should be `node tools/bench/bench-summary.js`.
## docs/language/lang-rust.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- No obvious drift found; chunking defaults match.

## docs/language/lang-sql.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- Mentions `--mode code` as the default; current CLI default is `--mode all`.

## docs/language/lang-typescript.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- Mentions `--mode code` as default; current CLI default is `--mode all`.

## docs/dependency_references/consolidated-dependency-references.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- No drift found.

## docs/new_docs/graph-caps.md
References:
- .\FUTUREROADMAP.md

Status:
- (none noted)

Notes:
- Marked as placeholder; needs integration into docs/specs/graph-caps.md or similar.

## docs/new_docs/symbol-artifacts-and-pipeline.md
References:
- .\docs\tooling\repo-inventory.json

Status:
- (none noted)

Notes:
- Tagged as draft; should be folded into docs/specs/symbol-artifacts-and-pipeline.md or removed if outdated.

## docs/archived/PHASE_0.md
References:
- docs/guides/commands.md

Status:
- (none noted)

Notes:
- Contains historical plan items only.

## docs/archived/PHASE_1.md
References:
- none

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_2.md
References:
- none

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_3.md
References:
- docs/guides/risk-rules.md

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_4.md
References:
- docs/specs/safe-regex-hardening.md
- docs/specs/subprocess-helper.md

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_5.md
References:
- docs/specs/tooling-vfs-and-segment-routing.md
- docs/specs/vfs-manifest-artifact.md

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_6.md
References:
- docs/specs/risk-flows-and-call-sites.md

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_7.md
References:
- none

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_8.md
References:
- docs/specs/tooling-provider-registry.md
- docs/specs/tooling-doctor-and-reporting.md
- docs/specs/tooling-vfs-and-segment-routing.md
- docs/specs/typescript-provider-js-parity.md
- docs/specs/vfs-manifest-artifact.md

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_9.md
References:
- none

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_10.md
References:
- none

Status:
- (none noted)

Notes:
- Historical plan doc.

## docs/archived/PHASE_11.md
References:
- none

Status:
- (none noted)

Notes:
- Historical plan doc.
```

### Specs

```text
DOC_AUDIT_SPECS.md:
# Doc Audit Specs

## docs/specs/analysis-schemas.md
References:
- docs/contracts/analysis-schemas.md
- docs/contracts/artifact-schemas.md
- docs/specs/symbol-identity.md
Status: Needs update
Notes:
- Analysis schema is in src/contracts/schemas/analysis.js; doc is still at version 0.7.0 and missing graph context pack, impact analysis, api contracts, architecture, and suggest-tests sections that are now required.

## docs/specs/artifact-schemas.md
References:
- docs/contracts/artifact-schemas.md
Status: Needs update
Notes:
- Artifact schema doc is missing vfs_manifest, chunk_uid_map, risk summaries/flows/interprocedural stats, and optional artifacts like index_state.json.
- Sharded JSONL meta schema is still at v1 legacy shape; should be updated to jsonl-sharded schema (schemaVersion, compression, totalRecords/bytes).
- api_contracts_meta appears in doc but not in schema; either add schema or remove doc.

## docs/specs/graph-caps.md
References:
- FUTUREROADMAP.md
Status: Needs update
Notes:
- Spec is a placeholder that does not define the schema or default caps; the integration code uses graph caps in src/retrieval/pipeline/graph-ranking.js.

## docs/specs/graph-product-surfaces.md
References:
- docs/contracts/search-contract.md
Status: Needs update
Notes:
- This doc is a Phase 11 spec but no longer referenced anywhere except search-contract; should be either made authoritative or moved to archived if superseded.

## docs/specs/risk-callsite-id-and-stats.md
References:
- docs/specs/risk-interprocedural-stats.md
Status: Needs update
Notes:
- Stats shape described here conflicts with src/contracts/schemas/artifacts.js; missing mode/callSiteSampling fields and uses different status semantics.

## docs/specs/risk-flows-and-call-sites.md
References:
- docs/contracts/artifact-schemas.md
Status: Needs update
Notes:
- The spec says call_sites rows are dropped when oversized; implementation trims extensions/graphs first; schema expects extensions object not nullable.
- The doc does not mention vfs_manifest or chunk_uid_map artifacts that are now required.

## docs/specs/risk-interprocedural-config.md
References:
- docs/contracts/artifact-schemas.md
Status: Needs update
Notes:
- Config names in spec do not match schema (emitArtifacts, summaryOnly, caps live under indexing.riskInterprocedural in src/config/schema.json).

## docs/specs/risk-interprocedural-stats.md
References:
- docs/contracts/artifact-schemas.md
Status: Needs update
Notes:
- Required fields do not match schema; missing timingMs.io and new required fields (mode, callSiteSampling), status semantics differ from code.

## docs/specs/risk-summaries.md
References:
- docs/contracts/artifact-schemas.md
Status: Needs update
Notes:
- Risk summary ordering and trimming rules are under-specified compared to implementation (max 32KB, deterministic trim order). Schema requires reason codes and evidence types.

## docs/specs/runtime-envelope.md
References:
- docs/guides/architecture.md
Status: Needs update
Notes:
- The env patching behavior is out of date (config precedence, new env keys, runtime envelope includes more fields).

## docs/specs/safe-regex-hardening.md
References:
- docs/archived/PHASE_4.md
Status: Needs update
Notes:
- Implementation now supports RE2JS fallback; spec only mentions RE2; should include compileSafeRegex and input length/program size caps.

## docs/specs/scm-provider-config-and-state-schema.md
References:
- docs/contracts/indexing.md
Status: Needs update
Notes:
- The schema in spec does not include jj operationId and does not state head/dirty semantics or path normalization; updated provider contract is needed.

## docs/specs/scm-provider-contract.md
References:
- docs/specs/scm-provider-config-and-state-schema.md
Status: Needs update
Notes:
- The doc is skeletal and should define provider return shapes, precedence, fallback behavior, and error signaling.

## docs/specs/segmentation-perf.md
References:
- docs/guides/commands.md
Status: Needs update
Notes:
- Performance caps/targets are outdated and do not match current maxBytes caps or tree-sitter fallback logic.

## docs/specs/signature.md
References:
- docs/guides/commands.md
Status: Needs update
Notes:
- signatureVersion and canonicalization rules do not mention new build_state inputs (repo provenance, provider head), and omit index compat key.

## docs/specs/subprocess-helper.md
References:
- docs/archived/PHASE_4.md
Status: OK
Notes:
- No drift found.

## docs/specs/symbol-artifacts-and-pipeline.md
References:
- docs/new_docs/symbol-artifacts-and-pipeline.md
Status: Needs update
Notes:
- doc still a draft; not aligned with current symbol artifact schema and code paths in src/index/build/artifacts/writers.

## docs/specs/test-strategy-and-conformance-matrix.md
References:
- docs/testing/test-decomposition-regrouping.md
Status: Needs update
Notes:
- Lane list and descriptions are outdated; does not mention ci-lite/ci-long/mcp/api lanes.

## docs/specs/tooling-and-api-contract.md
References:
- docs/specs/test-strategy-and-conformance-matrix.md
Status: Needs update
Notes:
- Tooling/API contract does not match current MCP tools list and transport defaults; lacks schemaVersion in responses.

## docs/specs/tooling-doctor-and-reporting.md
References:
- docs/archived/PHASE_8.md
Status: Needs update
Notes:
- Report schema differs: doc expects provider categories; code emits provider array with different keys.

## docs/specs/tooling-io.md
References:
- docs/guides/commands.md
Status: Needs update
Notes:
- Spec expects fileTextByFile caching contract; tooling providers use VFS and do not accept the field.

## docs/specs/tooling-provider-registry.md
References:
- docs/archived/PHASE_8.md
Status: Needs update
Notes:
- Spec names differ from code (registry.js vs provider-registry.js) and field names differ (symbolHint vs symbol).

## docs/specs/tooling-vfs-and-segment-routing.md
References:
- docs/specs/vfs-manifest-artifact.md
Status: OK
Notes:
- Implementation matches in src/index/tooling/vfs.js, minor naming drift only.

## docs/specs/typescript-provider-js-parity.md
References:
- docs/archived/PHASE_8.md
Status: Needs update
Notes:
- Implementation uses SymbolRef heuristic IDs; spec expects no ad-hoc IDs.

## docs/specs/vfs-manifest-artifact.md
References:
- docs/specs/tooling-vfs-and-segment-routing.md
Status: Needs update
Notes:
- Spec requires deterministic trimming order before dropping rows; implementation drops oversized rows without trimming.

## docs/specs/watch-atomicity.md
References:
- docs/guides/architecture.md
Status: Needs update
Notes:
- Attempt root / promotion barrier naming and defaults differ from current watch implementation.

## docs/specs/workspace-config.md
References:
- FUTUREROADMAP.md
Status: Needs update
Notes:
- Spec does not include indexing.scm.* or newer config keys; needs alignment with docs/config/schema.json.

## docs/specs/workspace-manifest.md
References:
- FUTUREROADMAP.md
Status: Needs update
Notes:
- Spec may be correct but tooling not implemented; ensure manifestHash and build pointer fields match current plan.
```
