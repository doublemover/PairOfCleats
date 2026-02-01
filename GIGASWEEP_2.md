# PairOfCleats Static Sweep Roadmap (Repository Audit)

    ## Status legend

    Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
    - [x] Implemented and appears complete/correct based on code inspection and existing test coverage
    - [@] In Progress, this work has been started
    - [.] Work has been completed but has Not been tested
    - [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
    - [ ] Not complete

    Completed Phases: `COMPLETED_PHASES.md`

## Scope + method (static only)
This document consolidates **all findings** from multiple static-analysis sweeps (no execution).
It is written in “roadmap style” so it can be used as a worklist for repairs, drift-guards, and hardening.

---

## Phase 0 — Hard failures (repo/CI/scripts break *today*)

### Objective
Make sure the repo’s declared entrypoints (npm scripts + CI workflows) actually exist and run.

- [x] Fix missing tooling file referenced by script-coverage/tests.
  - Symptom: script-coverage references `tools/mergeAppendOnly.js` which does not exist.
  - Touchpoints:
    - `tests/tooling/script-coverage/actions.js` — expects `tools/mergeAppendOnly.js`
    - `docs/tooling/repo-inventory.json` — still lists `merge-append`
  - Action:
    - [ ] Add `tools/mergeAppendOnly.js` **or** remove/replace the script-coverage action + scrub inventory docs.

- [x] Fix CI workflow referencing a non-existent npm script.
  - Symptom: `.github/workflows/ci-long.yml` runs `npm run test:ci-long`, but `package.json` has no `test:ci-long`.
  - Touchpoints:
    - `.github/workflows/ci-long.yml`
    - `package.json`
  - Action:
    - [ ] Add `test:ci-long` script **or** update workflow to use `node tools/ci/run-suite.js ...`.

- [x] Fix release-check script failing in clean checkout.
  - Symptom: `tools/release-check.js` requires `CHANGELOG.md` which is not present.
  - Touchpoints:
    - `tools/release-check.js`
    - `docs/guides/release-discipline.md`
  - Action:
    - [ ] Add `CHANGELOG.md` **or** relax/check conditionally.

- [x] Fix critical-deps validator pointing at the wrong docs directory.
  - Symptom: `tools/validate-critical-deps.js` expects `docs/references/dependency-bundle/*` but repo uses `docs/dependency_references/dependency-bundle/*`.
  - Touchpoints:
    - `tools/validate-critical-deps.js`
    - `docs/dependency_references/dependency-coverage.md`
  - Action:
    - [ ] Update expected paths or move docs folder (prefer updating script).

---

## Phase 1 — CLI surface vs docs (major drift)

### Objective
Stop shipping docs that describe commands, endpoints, and flags that don’t exist.

- [x] Implement or de-document the `pairofcleats report ...` command family.
  - Docs reference:
    - `docs/guides/code-maps.md` (`pairofcleats report map`)
    - `docs/benchmarks/evaluation.md` (`pairofcleats report eval`)
    - `docs/benchmarks/model-comparison.md` (`pairofcleats report compare-models`)
    - `docs/guides/repometrics-dashboard.md` (`pairofcleats report repometrics`)
  - Reality:
    - `bin/pairofcleats.js` does **not** implement `report`.
    - Some underlying tools exist (e.g., `tools/report-code-map.js`) but are not routed.
  - Action:
    - [ ] Either wire these into `bin/pairofcleats.js` (`report` dispatch) **or**
    - [ ] Update docs to use `node tools/...` or `npm run ...`.

- [x] Implement or de-document `pairofcleats sqlite ...`.
  - Docs reference: `docs/sqlite/incremental-updates.md` (`pairofcleats sqlite build --incremental`)
  - Reality: `bin/pairofcleats.js` has no `sqlite` group.
  - Action: wire a `sqlite` command group or change docs to `npm run build-sqlite-index ...`.

- [x] Implement or de-document `pairofcleats service indexer ...`.
  - Docs reference: `docs/guides/service-mode.md` (`service indexer start/status/stop`)
  - Reality: CLI only supports `pairofcleats service api`. `tools/indexer-service.js` exists but is not routed.
  - Action: route `service indexer` or change docs to `npm run indexer-service`.

- [x] Fix broken doc links and API surface claims.
  - `docs/guides/code-maps.md` links to `./api-server.md` which does not exist.
  - Map endpoints described in docs don’t appear in the API router.
  - Action: fix link + reconcile endpoints vs router.

- [x] README drift and missing references.
  - Missing/incorrect references:
    - README references `GIGAROADMAP.md` but file is `GIGAROADMAP_2.md`.
    - README implies a license file exists; none found at repo root.
    - README references scripts not present (e.g., `test:pr`).
  - CLI behavior drift:
    - README lists `--mode code|prose|both`; code supports `code|prose|extracted-prose|records|all`.
    - README references env var `PAIROFCLEATS_DOC_EXTRACT` not implemented (behavior appears config-driven).
    - README mentions backends/flags not supported by `bin/pairofcleats.js` (e.g., `sqlite-fts`, `memory`, `--why` vs `--explain`).
  - Action: reconcile README with current CLI and config reality.

---

## Phase 2 — Config correctness (schema, validation, normalization)

### Objective
Ensure the config file (`.pairofcleats.json`) is:
1) validated correctly, and
2) actually applied by runtime.

#### 2.1 Normalization drops supported keys (user config silently ignored)
- [?] Fix `quality` and `threads` being validated/documented but then silently dropped.
  - Symptoms:
    - `docs/config/schema.json` defines top-level `quality` and `threads`.
    - default config template emits `quality: "auto"`.
    - `tools/dict-utils/config.js` normalization does **not** carry `quality` or `threads` through.
    - Runtime reads `config.quality` (`src/shared/auto-policy.js`) and `userConfig.threads` (`src/shared/runtime-envelope.js`) → user settings never take effect.
  - Action:
    - [ ] Pass-through `quality` and `threads` in normalization.
    - [ ] Add tests proving config changes behavior (not just schema validation).

#### 2.2 Validator vs schema mismatch (schema features ignored / mis-evaluated)
- [?] Align `docs/config/schema.json` with the actual validator (`src/config/validate.js`) *or* adopt a real JSON Schema validator.
  - Issues observed:
    - Schema uses `anyOf` and union types (e.g., `"type": ["number","null"]`) but validator ignores `anyOf` and mishandles array-`type`.
    - Root `additionalProperties:false` rejects many keys the code expects/normalizes (`sqlite`, `lmdb`, etc.) unless schema is expanded.
    - `tools/generate-demo-config.js` assumes `anyOf/oneOf` exists, reinforcing that the schema is “real JSON Schema”.
  - Action (recommended):
    - [ ] Switch to Ajv (or equivalent) and treat `docs/config/schema.json` as authoritative.
    - [ ] Add tests for `anyOf` + union types + unknown top-level keys.
  - Alternative:
    - [ ] Restrict schema to the validator’s supported subset and adjust doc tooling accordingly.

#### 2.3 Additional normalization/validation defects
- [?] Fix conditional drop: `search.sqliteAutoArtifactBytes` is ignored unless `sqliteAutoChunkThreshold` is set.
  - Touchpoint: `tools/dict-utils/config.js` (`sqliteAutoArtifactBytes` parsing is gated on threshold existence).
- [?] Fix `validateConfig()` “required bypass” under `additionalProperties:false`.
  - Touchpoint: `src/config/validate.js` (unknown property is skipped if the key is also in `required`).

#### 2.4 Generated “inventory” docs drift / contract not enforced
- [?] Keep generated docs in sync:
  - `docs/config/inventory.json` vs `docs/config/inventory.md` public flags list mismatch.
  - `docs/guides/commands.md` appears out of sync with its generator.
  - Action:
    - [ ] Add CI test: regenerate artifacts and assert no diff.
    - [ ] Document the generator command(s) as the single source of truth.

---

## Phase 3 — Path safety / filesystem hardening (high priority)

### Objective
Manifest-driven and output-driven filesystem reads must be safe **regardless of “strict” mode**.

- [?] Always enforce manifest path containment, even in non-strict mode.
  - Findings:
    - `src/index/validate/manifest.js` only validates entry paths when `strict===true`, but still `existsSync()` / hashes resolved paths when non-strict.
    - `src/shared/artifact-io/manifest.js` similarly only enforces safety when strict.
    - `tools/ci-restore-artifacts.js` joins `piece.path` under indexDir without containment checks.
  - Risk: path traversal (`../`) can read outside indexDir if manifest is corrupted/untrusted.
  - Action:
    - [ ] Always enforce: no absolute paths, no `..` segments, and resolved path must remain under root.
    - [ ] In non-strict mode: downgrade to warnings + skip unsafe entries (but do not read them).

- [?] Fix path safety predicate false-positives.
  - Current logic uses substring `normalized.includes('..')`, which rejects benign strings like `foo..bar`.
  - Action: check path segments for equality to `'..'`.

- [?] Fix output summarization path traversal.
  - `src/retrieval/output/summary.js` uses `path.join(rootDir, chunk.file)` without containment validation.
  - Action: resolve and ensure resulting path remains under `rootDir` before reading.

---

## Phase 4 — Retrieval/search: backend selection, ranking knobs, and flag surface

### Objective
Make search behavior deterministic, debuggable, and aligned with its public CLI surface.

#### 4.1 SQLite FTS auto-enable inconsistency (backend initialization vs downstream usage)
- [?] Fix divergent booleans for FTS enablement.
  - In `src/retrieval/cli.js`, FTS is derived as:
    - `sqliteFtsEnabled = sqliteFtsRequested || (autoBackendRequested && useSqliteSelection)`
  - But `createBackendContext(...)` receives the **original** `sqliteFtsRequested`, while index-loading receives `sqliteFtsEnabled`.
  - Consequences:
    - backend label and required-table checks can behave as “non-FTS” even while pipeline behaves as “FTS enabled”.
    - can cause unnecessary fallback away from SQLite.
  - Action: compute one canonical “FTS enabled” boolean and pass it everywhere.

#### 4.2 Flag surface is far larger than yargs declarations (types/missing-value hazards)
- [?] Declare every consumed `argv.*` option in yargs (or intentionally mark them as “advanced” but still declare them).
  - Current state:
    - ~70+ `argv.*` keys are read in the search path; ~40+ are not declared in yargs.
    - `.strict(false)` means unknown flags are accepted but are not typed/coerced and are absent from `--help`.
  - High-risk cases (missing value → `true`):
    - `--repo` can cause hard throw (`path.resolve(true)`).
    - string filters can silently become `"true"`.
    - numeric knobs can silently become `1` (`Number(true) === 1`) (e.g., `--bm25-k1`, `--modified-since`).
  - Action:
    - [ ] Add yargs declarations for all read flags with correct types and `.requiresArg()` where applicable.
    - [ ] Expand `getMissingFlagMessages()` beyond `type/author/import` to include “must-have-value” flags.
    - [ ] Add tests for missing-value behavior (`--repo`, `--modified-since`, `--bm25-k1`, `--path`, etc.).

- [?] Fix `--context` dead flag.
  - `contextLines` is computed from `argv.context` but not used downstream.
  - Action: wire it to output context, or remove the flag.

- [?] Fix Windows drive-letter token parsing in `--filter`.
  - `parseFilterExpression()` splits on `:`; `C:\...` becomes key `c`.
  - Action: special-case `/^[A-Za-z]:[\\/]/` as a file path token.

- [?] Fix LMDB chunk hydration overwriting valid zeros.
  - `src/retrieval/lmdb-helpers.js` uses falsy checks (`if (!chunk.churn)`) causing `0` to be overwritten.
  - Action: use nullish checks (`== null`).

#### 4.3 Retrieval pipeline safety and determinism
- [?] Propagate abort/cancellation signals into provider calls.
  - Current pattern checks `signal` at boundaries but providers don’t accept/obey it.
- [?] Validate unknown ANN backend strings rather than silently defaulting.
- [?] Add candidate set caps to prevent “candidate explosion” on pathological tokens.
- [?] Document and/or wire search config knobs.
  - Current normalization hard-codes several behaviors (`contextExpansionEnabled=false`, `scoreBlendEnabled=false`, etc.) while docs imply configurability.
  - Many backend config normalizers are called with `{}` (ignoring `userConfig`), limiting real-world configurability.

---

## Phase 5 — SQLite/Tantivy/index build tooling correctness

### Objective
Remove dead code paths, misleading cleanup, and brittle precondition assumptions.

- [?] Clean up SQLite build runner resource handling.
  - `tools/build-sqlite-index/runner.js` treats returned stats as a DB handle and calls `.close()` (swallowed).
  - Unused variables like `hasVectorTableBefore` and wording mismatches in warnings.
  - Action: make return types explicit, remove dead cleanup, fix warnings.

- [?] Improve Tantivy build error messaging and prerequisite checks.
  - `tools/build-tantivy-index.js` assumes artifacts exist and can fail with low-signal errors.
  - Action: explicitly detect required artifacts and print remediation steps.

- [?] Optional doc extraction deps are capability-probed but not declared.
  - `src/shared/capabilities.js` checks `pdfjs-dist`/`mammoth`, but `package.json` doesn’t declare them.
  - Action: either document “install to enable” or move them to `optionalDependencies`.

- [?] Fix unused/leftover build-state variable.
  - `build_index.js` defines `buildStatePath` but doesn’t use it.

---

## Phase 6 — MCP robustness

### Objective
No request should hang without a response; cancellation/timeout semantics should be deterministic.

- [?] Fix tool-call cancellation: ensure a response is emitted even if handler resolves after cancellation.
  - Current behavior: if cancelled flag is set, success path returns without sending a reply.
  - Touchpoints:
    - `tools/mcp/transport.js`
    - tool handlers (e.g., `tools/mcp/tools/handlers/search.js`)
  - Action:
    - [ ] On cancellation: send a deterministic “cancelled” response for the original request id.
    - [ ] Add a `$ /cancelRequest` test asserting a response always arrives.

---

## Phase 7 — Risk analysis & type inference correctness + tests

### Objective
Fix correctness bugs in local risk detection and close test gaps in type inference.

#### 7.1 Local risk detector correctness gaps
- [?] Fix “taint confidence” bug (reads the wrong field).
  - `src/index/risk.js` uses `entry.confidence` where entries are `{ rule, evidence }`.
  - Action: use `entry.rule.confidence` (or remove if unused).
- [?] Fix rule-id aggregation mismatch in `combineSourceEvidence()`.
- [?] Document/expand assignment heuristics:
  - current parsing skips `=>` and misses destructuring/multi-line patterns.
- [?] Sanitizer matching is overly broad (clears taint if variable name appears on any matching line).

#### 7.2 Risk rules diagnostics shape
- [?] `src/index/risk-rules.js` has an `errors` array that is never used.
  - Action: either classify fatal issues into `errors` or remove it for clarity.

#### 7.3 Interprocedural risk behavior clarity
- [?] Document and surface “timeout ⇒ zero flows” behavior (it’s deterministic and tested but surprising).
- [?] Clarify/verify `taintHints` production wiring (appears optional/dormant in some paths).
- [?] Consider artifact metadata clarity for sharded JSONL (entrypoint is `.meta.json` but format labeled `jsonl`).

#### 7.4 Type inference coverage and unused outputs
- [?] Local type inference exports `aliases` but caller ignores it.
  - Action: remove dead output or wire alias propagation.
- [?] Add unit tests for `src/index/type-inference.js` (cross-file tests exist; local inference is largely untested).

#### 7.5 Cross-file pipeline implementation smells
- [?] Avoid attaching private `_keys` Sets to arrays for dedupe.
  - Action: use local Sets/Maps or a `WeakMap`.
- [?] Layering concern: `src/index/*` importing from `tools/*` may complicate packaging boundaries.

---

## Phase 8 — Test & drift-guard improvements (prevent recurrence)

### Objective
Turn current failures/drifts into permanent guardrails.

- [?] Add workflow contract coverage for **all** workflows.
  - Current workflow-contract tests cover `ci.yml` but not `ci-long.yml` (which is broken).
- [?] Add “npm scripts target exists” test in PR lane.
  - Catch missing `tools/*.js` targets early (e.g., `mergeAppendOnly.js`).
- [?] Add Markdown link checker test.
  - Catch broken doc links (e.g., `docs/guides/code-maps.md -> api-server.md`).
- [?] Add generator sync tests for doc inventories (`commands.md`, `inventory.md/json`).
- [?] Remove brittle cross-test ordering via marker files in summary-report tests.
  - Replace polling loop with a shared helper or a single orchestrated integration test.

---

## Phase 9 — Tooling and docs hygiene (quality-of-life)

### Objective
Reduce “mystery behavior” and make internal tooling more robust.

- [?] Improve `tools/check-env-usage.js` detection patterns.
  - Currently misses bracket access, destructuring, and other env read patterns.
  - Consider AST-based linting.

- [?] Fix `tools/download-extensions.js` chmod contradiction and improve download safety.
  - `chmod 0755` is immediately overwritten by `chmod 0644`.
  - Archive downloads are buffered in memory without size caps.
  - Consider forcing HTTPS or requiring hashes for HTTP.

- [?] Fix `tools/download-models.js` ONNX copy logic.
  - Current logic checks `!existsSync(onnxTarget)` then calls `statSync(onnxTarget)`, making directory handling dead.
  - Also doesn’t copy when target dir already exists.

- [?] Fix `tools/compare-models.js` index existence probe.
  - Checks only for `chunk_meta.json` and may miss valid indexes in other shapes.

- [?] Tool detection should verify executability, not just filename presence.
  - `tools/tooling-detect.js` should run `--version` before claiming “found”.

- [?] Fix `src/integrations/core/status.js` payload naming ambiguity.
  - `repo.root` appears to report cache root, not repository root.

- [?] Compact/shard tooling scalability:
  - `tools/compact-pieces.js` likely loads compressed shards fully into memory (gz/zst).
  - `tools/ctags-ingest.js` ignores stream backpressure and can balloon memory.

---

# Appendix A — Sweep coverage (what was reviewed)

This repo was reviewed in multiple sweeps. Below is a high-level list of the file clusters covered (full per-turn lists were provided in the chat):

1) **Project wiring:** `package.json`, root scripts, bin entrypoints, GitHub workflows, core CLI plumbing.
2) **Docs surface:** README, docs guides/contracts/specs, generated inventories, link integrity.
3) **Config system:** schema docs, validator, normalization, demo/template generators.
4) **Install/build tooling:** extensions/models/dicts downloads, indexing builders, CI artifact restore/build scripts.
5) **MCP integration:** protocol/transport, tool handlers, robustness tests.
6) **Index internals:** manifest/path validation, incremental state, locking, map building.
7) **Risk analysis & type inference:** local detector, interprocedural engine, cross-file inference pipeline.
8) **Retrieval/ranking:** sqlite/lmdb/tantivy providers, rankers/scoring knobs, filters, caching, flag surface.

---

# Appendix B — “Highest ROI” patch set (suggested ordering)

If you want a focused sequence that quickly stabilizes the repo:

1) Fix immediate hard failures: missing `tools/mergeAppendOnly.js`, missing `test:ci-long`, `validate-critical-deps` path, `CHANGELOG.md` gate.
2) Fix config normalization dropping `quality` + `threads`.
3) Fix manifest/output path traversal hazards (always enforce containment).
4) Fix SQLite FTS enablement mismatch (auto path).
5) Declare the full search flag surface in yargs and add missing-value tests.
6) Add drift-guards: workflow/script/link/inventory sync tests.
7) MCP cancellation always responds.
8) Clean up SQLite build runner + downloads tooling (chmod + streaming + onnx copy).

---

# Appendix C — Incorrect Findings

- Phase 0: The symptom “npm run merge-append targets a missing file” is stale. The `merge-append` script no longer exists in `package.json`; the missing file issue now stems from script-coverage/tests still referencing `tools/mergeAppendOnly.js` (and repo-inventory docs listing `merge-append`).
