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
[x] Stabilize JS param names and cross-file extraction (`src/lang/javascript/relations.js`, `src/index/type-inference-crossfile/extract.js`) and add `tests/lang/javascript-paramnames.test.js` (ran `node tests/lang/javascript-paramnames.test.js`).
[x] Build risk summaries and compact docmeta (`src/index/risk-interprocedural/summaries.js`, `src/index/build/indexer/steps/relations.js`, `src/index/build/state.js`), using EvidenceRef `endLine/endCol` to mirror `startLine/startCol` for a deterministic point range (ran `node tests/risk-interprocedural/summaries-schema.test.js`, `node tests/risk-interprocedural/summaries-determinism.test.js`, `node tests/risk-interprocedural/summaries-truncation.test.js`).
[x] Add shared callsite helpers and local pointer hash (`src/index/callsite-id.js`, `src/index/risk-interprocedural/edges.js`, `src/index/build/shared/graph/graph-store.js`) with sampling and hash tests (ran `node tests/risk-interprocedural/callsite-id.test.js`, `node tests/risk-interprocedural/callsite-sampling.test.js`, `node tests/risk-interprocedural/local-pointer-hash.test.js`).
[ ] Implement propagation engine with deterministic BFS, caps, and confidence (`src/index/risk-interprocedural/engine.js`) plus fixtures and flow tests (conservative, argAware, sanitizer, timeout).
[ ] Add artifact contracts and writers (`src/contracts/schemas/artifacts.js`, `src/contracts/registry.js`, `src/index/build/artifacts/writers/risk-interprocedural.js`), plus JSONL required keys and compression (`src/shared/artifact-io/jsonl.js`, `src/index/build/artifacts/compression.js`) and piece assembly (`src/index/build/piece-assembly.js`).
[ ] Extend validation and referential checks (`src/index/validate.js`, `src/index/validate/artifacts.js`, `src/index/validate/presence.js`, `src/index/validate/risk-interprocedural.js`) and add `tests/validator/risk-interprocedural.test.js` with rebuild-required errors for old indexes.
[ ] Implement CLI `risk explain` (`bin/pairofcleats.js`, `tools/explain-risk.js`) with refined output (confidence then flowId; clean path display; sampled callsites) and update `docs/guides/commands.md` plus `tests/cli/risk-explain.test.js`.
[ ] Apply robustness changes and perf audit (`src/index/build/graphs.js` edge union, determinism checks, memory caps) and record results in the plan.
[ ] Run tests per area; cancel any test exceeding 1 minute and ask the user to run long tests at the next stop.

## Open questions
- None. Decisions locked: EvidenceRef endLine/endCol mirror start values; CLI output sorted by confidence then flowId; long tests canceled and delegated.
