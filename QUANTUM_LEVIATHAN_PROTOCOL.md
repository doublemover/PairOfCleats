# Plan

We will execute Phase 10 in a dependency-first order: freeze canonical specs and config keys, then wire runtime gating and data flow, then build summaries and propagation, then integrate artifacts and validation, then ship CLI and robustness checks. This keeps implementation aligned to a single schema surface and minimizes rework.

## Scope
- In: Phase 10 tasks in `GIGAROADMAP_2.md` (docs merge + archival, config surface + gating, param name stabilization, summaries, callsite helpers, propagation engine, artifacts/contracts/manifest, validation, CLI explain, robustness + tests).
- Out: Back-compat shims (old indexes should error and instruct rebuild).

## Action items
[x] Create branch `quantum-leviathan-protocol` and this plan file `QUANTUM_LEVIATHAN_PROTOCOL.md`.
[x] Re-scan Phase 10 tasks in `GIGAROADMAP_2.md` and align step ordering with dependencies (update this plan as work progresses).
[x] Merge canonical specs into `docs/specs/` (risk-interprocedural-config, risk-summaries, risk-flows-and-call-sites, risk-callsite-id-and-stats, risk-interprocedural-stats) and remove stale statements.
[x] Archive deprecated docs to `docs/archived/phase-10/` with DEPRECATED headers and update `AGENTS.md` archival policy.
[x] Establish authoritative config keys in 10.1 and reflect in `docs/specs/risk-interprocedural-config.md`, `docs/config/schema.json`, and `tools/dict-utils/config.js`.
[x] Implement `normalizeRiskInterproceduralConfig` and runtime gating in `src/index/risk-interprocedural/config.js` and `src/index/build/runtime/runtime.js`, plus cross-file inference gating in `src/index/build/indexer/steps/relations.js`.
[x] Extend incremental signature and `index_state.json` to include risk interprocedural config and runtime state (`src/index/build/indexer/signatures.js`, `src/index/build/indexer/steps/write.js`).
[x] Stabilize JS param names and cross-file extraction (`src/lang/javascript/relations.js`, `src/index/type-inference-crossfile/extract.js`) and add `tests/lang/javascript/javascript-paramnames.test.js` (ran `node tests/lang/javascript/javascript-paramnames.test.js`).
[x] Build risk summaries and compact docmeta (`src/index/risk-interprocedural/summaries.js`, `src/index/build/indexer/steps/relations.js`, `src/index/build/state.js`), using EvidenceRef `endLine/endCol` to mirror `startLine/startCol` for a deterministic point range (ran `node tests/indexing/risk/interprocedural/summaries-schema.test.js`, `node tests/indexing/risk/interprocedural/summaries-determinism.test.js`, `node tests/indexing/risk/interprocedural/summaries-truncation.test.js`).
[x] Add shared callsite helpers and local pointer hash (`src/index/callsite-id.js`, `src/index/risk-interprocedural/edges.js`, `src/index/build/shared/graph/graph-store.js`) with sampling and hash tests (ran `node tests/indexing/risk/interprocedural/callsite-id.test.js`, `node tests/indexing/risk/interprocedural/callsite-sampling.test.js`, `node tests/indexing/risk/interprocedural/local-pointer-hash.test.js`).
[x] Implement propagation engine with deterministic BFS, caps, and confidence (`src/index/risk-interprocedural/engine.js`) plus fixtures and flow tests (conservative, argAware, sanitizer, timeout).
[x] Add artifact contracts and writers (`src/contracts/schemas/artifacts.js`, `src/contracts/registry.js`, `src/index/build/artifacts/writers/risk-interprocedural.js`), plus JSONL required keys and compression (`src/shared/artifact-io/jsonl.js`, `src/index/build/artifacts/compression.js`) and piece assembly (`src/index/build/piece-assembly.js`).
[x] Extend validation and referential checks (`src/index/validate.js`, `src/index/validate/artifacts.js`, `src/index/validate/presence.js`, `src/index/validate/risk-interprocedural.js`) and add `tests/indexing/validate/validator/risk-interprocedural.test.js` with rebuild-required errors for old indexes.
[x] Implement CLI `risk explain` (`bin/pairofcleats.js`, `tools/explain-risk.js`) with refined output (confidence then flowId; clean path display; sampled callsites) and update `docs/guides/commands.md` plus `tests/cli/general/risk-explain.test.js`.
[x] Apply robustness changes and perf audit (`src/index/build/graphs.js` edge union, determinism checks, memory caps) and record results in the plan. (Reviewed summaries/engine/edges/writer for caps + determinism; no blockers.)
[x] Run tests per area; cancel any test exceeding 1 minute and ask the user to run long tests at the next stop. (Ran: config-normalization, runtime-gating, flows-conservative, flows-argaware-negative, flows-sanitizer-policy, flows-timeout, artifacts-written, graph-call-sites-preferred, validator/risk-interprocedural, cli/risk-explain.)

## Open questions
- None. Decisions locked: EvidenceRef endLine/endCol mirror start values; CLI output sorted by confidence then flowId; long tests canceled and delegated.

## Test fix log
- Shard-merge: failure "chunk metadata differs" from `.testLogs/run-1769885064337-0ldai3/shard-merge.attempt-1.log`.
- Compared `index-code/chunk_meta.json` for cache-a vs cache-b builds; counts match (2 vs 2).
- Diffed first chunk payloads; only difference was `docmeta.tooling.sources[].collectedAt` timestamp.
- Confirmed no other structural diff after removing tool timestamps.
- Updated `tests/indexing/shards/shard-merge.test.js` to normalize tooling timestamps and compare with `stableStringify` so shard/non-shard builds match on deterministic content.
- MCP search defaults/filters: failure "baseline risk MCP search returned no results" from `.testLogs/run-1769885064337-0ldai3/services_mcp_tool-search-defaults-and-filters_test.attempt-1.log`.
- Noted logs did not show active cache root; added init logging in `src/index/build/runtime/runtime.js` to print cache root source + resolved repo cache root for easier debugging of fixture indexes.
- Shard-merge: failure "checksum differs for chunk_meta.json" from `.testLogs/run-1769888425383-uil313/shard-merge.attempt-1.log`.
- Diffed `index-code/chunk_meta.json` between cache-a and cache-b build roots from the log; only difference was `docmeta.tooling.sources[].collectedAt` timestamps.
- Traced timestamps to `src/index/tooling/orchestrator.js` provenance merge -> `src/index/type-inference-crossfile/tooling.js` -> chunk docmeta -> chunk_meta writer.
- Sanitized `docmeta.tooling.sources` in `src/index/build/artifacts/writers/chunk-meta.js` to drop `collectedAt` for deterministic chunk_meta output (rest of docmeta preserved).
- Shard-merge: added JSON diff logging in `tests/indexing/shards/shard-merge.test.js` to print the first differing path/value when a manifest checksum mismatch occurs (loads the referenced artifact and reports the exact field difference).
- Shard-merge: diff showed `filter_index.json.configHash` differed between shard/non-shard because shards config affects `getEffectiveConfigHash`.
- Switched filter_index configHash to `buildContentConfigHash` (ignores sharding/concurrency) and updated `tests/retrieval/filters/filter-index-artifact.test.js` to assert against the content hash.
- Shard-merge: diff logging showed `graph_relations.generatedAt` timestamp mismatch; updated `tests/indexing/shards/shard-merge.test.js` to treat graph_relations artifacts as equivalent when only generatedAt differs.
- Shard-merge: diff logging showed `index_state.json` differences from buildId/shards/timestamps; normalized those fields in `tests/indexing/shards/shard-merge.test.js` to compare deterministic content only.
- Documented non-deterministic `index_state.json` fields in `docs/testing/index-state-nondeterministic-fields.md` for future comparisons/tests.
- Shard-merge: further diff showed `index_state.json.sqlite.elapsedMs` mismatch; expanded normalization in `tests/indexing/shards/shard-merge.test.js` to drop sqlite timing/status/paths, lmdb runtime fields, repoId, and embeddings backend availability fields.
- Shard-merge: added generic `generatedAt`/`updatedAt` normalization for JSON artifacts so meta files and `risk_interprocedural_stats.json` compare equal when only timestamps differ.
- Shard-merge: skip checksum enforcement for `format: dir` artifacts (e.g., `dense_vectors.lancedb`) since directory entries do not include checksums.
- Re-ran `node tests/indexing/shards/shard-merge.test.js` (pass).
- Piece-assembly: traced graph_relations mismatch to missing call/import edges when assembling partial piece sets.
- Updated `src/index/build/piece-assembly.js` to only pass resolved callsites (caller+target) and fall back to `callDetails` when none exist.
- Updated `src/index/build/graphs.js` to resolve `importLinks` from `relations.imports` via `resolveRelativeImport` when assembling edges.
- Re-ran `node tests/indexing/piece-assembly/piece-assembly.test.js` (pass).
- MCP search defaults/filters: aligned MCP cache root in `tests/services/mcp/tool-search-defaults-and-filters.test.js` with `.testCache` so MCP uses the fixture index outputs.
- Attempted to re-run `node tests/services/mcp/tool-search-defaults-and-filters.test.js`; canceled after exceeding 30s (needs user rerun).
- Triage context pack: added `tools/triage/decision.js` call before records indexing to seed history.
- Attempted to re-run `node tests/tooling/triage/context-pack.test.js`; canceled after exceeding 30s (needs user rerun).
- MCP search defaults/filters: riskTag filter did not change results because `exec` query only returned command-exec hits.
- Switched riskTag baseline query to `req` to ensure baseline includes non-command-exec hits before filtering.
- Test rerun deferred (exceeds 30s); needs user rerun.
- MCP search defaults/filters: riskTag filter still unchanged because hitKey collapsed multiple hits to the same file.
- Updated hitKey to include file + range + kind + name so set comparison detects changed results.
- Re-ran `node tests/tooling/triage/context-pack.test.js`; canceled after exceeding 30s (needs user rerun).
- User reran `node tests/tooling/triage/context-pack.test.js` (pass).
