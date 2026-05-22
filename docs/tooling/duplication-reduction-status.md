# Duplication Reduction Status

Status: Checkpoint clean
Last audited: 2026-05-21
Canonical command: `npm run audit:duplicates`

This file records the current `jscpd` baseline and the duplicate-code reductions that were safe to take in the roadmap consolidation pass. The latest exact-current saved-report refresh scanned all 212 saved fragments, recorded the prior 27-fragment interim count, and found 0 still-current fragments; future duplicate-code work should start from a new intentional full audit refresh or a fresh concrete duplicate signal, not from stale baseline line counts. Older completed-slice notes below may preserve then-current instructions to rerun `npm run audit:duplicates`; those are historical records, not the current checkpoint policy. Completed-slice `Acceptance tests` and `Future constraints` sections are retained as implementation evidence and safety guidance only; do not treat them as reopened work unless a future intentional audit or live regression supplies current proof.

## Audit Configuration

- Tool: `jscpd@4.2.3`
- Config: `.jscpd.json`
- Reports: `temp/jscpd/jscpd-report.json` and `temp/jscpd/jscpd-report.md`
- Scan roots: `src`, `bin`, `tools`, `tests`, `extensions`, `sublime`
- Exclusions: package lockfiles, JSON/generated artifacts, fixtures, temporary cache/build outputs, archived docs, and the intentionally vendored VS Code `windows-cmd-core.cjs` mirror

Validation command policy: new test validation should use `node tests/run.js ... --lane=all --timeout-ms 30000` so the runner applies the repository testing environment helper. Older evidence entries below may preserve the exact direct commands that were run at the time.

## Current Baseline

Latest full audit on 2026-05-21 after the prior duplicate-reduction batches and before the current post-refresh fix batches:

- Full audit log: `temp/jscpd/audit-duplicates-20260521-012600.log`
- Reports: `temp/jscpd/jscpd-report.json` and `temp/jscpd/jscpd-report.md`
- Total analyzed surface: 4,036 files, 551,681 lines, 5,682,730 tokens.
- Baseline moved from the prior 393 clones / 6,366 duplicated lines / 72,063 duplicated tokens checkpoint to 212 clones / 3,153 duplicated lines / 36,023 duplicated tokens.
- Post-refresh reductions completed without rerunning `jscpd`: tree-sitter language-id resolution now shares the canonical owner while preserving native C/C++/Objective-C extension overrides; context-expansion and graph-ranking now share `buildGraphNodeIndex()`; LanceDB ranking now shares candidate-set sizing/membership and row-hit filtering helpers; GraphQL/Jinja/R/Julia collectors now share collector import and budgeted regex iteration helpers; isometric viewer config merge now reuses the shared config merge helper; report-code-map and map benchmarks share neutral map build option helpers; risk JSON/SARIF output now shares flow-selection accounting; graph context-pack rendering now reuses the shared risk ref formatter; LSP focused test fixtures now share degraded-preflight, dedicated-provider, and Gopls workspace helpers; SQLite tests now share bundle, pragma, zero-state rebuild, and token-posting fixtures; language contract tests now share heuristic-adapter and fixture-metadata helpers; perf/bench tests now share run-loop, process, log, and runtime evidence fixtures; indexing type-inference and postings tests now share provider fallback, tracked-header, crossfile artifact, postings build, and vector-only cleanup fixtures. Evidence: `temp/validation/local-dup-helper-syntax-eslint-20260521.log`, `temp/validation/local-dup-helper-focused-tests-20260521.log`, `temp/validation/map-build-options-helper-20260521.log`, `temp/validation/risk-output-dup-helper-20260521.log`, `temp/validation/graph-context-pack-ref-helper-20260521.log`, `temp/validation/lsp-dup-helper-20260521.log`, `temp/validation/sqlite-dup-helper-20260521.log`, `temp/validation/lang-contract-dup-helper-20260521.log`, `temp/validation/perf-bench-dup-helper-20260521.log`, and `temp/validation/indexing-type-postings-dup-helper-20260521.log`. The original `perf/bench/run` timeout in that slice was remediated later without rerunning `jscpd`; the final full perf lane passed in `temp/validation/perf-lane-final-20260521.log`. Keep the numeric baseline below unchanged until the next intentional full audit pass.

Previous full audit on 2026-05-20 after the duplicate-reduction batches through import-resolution count/stage normalization, process-file watchdog numeric policy helpers, docs-search JSON fast-scan entry shaping, extracted-prose low-yield serializers, and the earlier production/tool/test helper reductions:

- Full audit log: `temp/jscpd/audit-duplicates-20260520-161907.log`
- Total analyzed surface: 3,985 files, 553,478 lines, 5,715,535 tokens.
- Baseline moved from the prior 496 clones / 8,868 duplicated lines / 98,913 duplicated tokens checkpoint to 393 clones / 6,366 duplicated lines / 72,063 duplicated tokens.
- Post-baseline focused reductions completed without rerunning `jscpd`: shared index build-stage normalization, collector-hint normalization, generated-counterpart/OpenAPI candidate sharing, shared logging configuration normalization, scan-profile empty mode construction, tree-sitter worker option/language gating, retrieval formatter display/cache/snippet helpers, config-format tree-sitter metadata normalization and tree-sitter entry construction, config schema defaults traversal, map/isometric default values, API router string-list normalization, API route path-segment decoding, LSP hover location-signature/requester sharing, tooling navigation row projection, map ISO static serving, safe-regex program-size policy simplification, safe-regex prefilter attachment sharing, SCM snapshot observation construction, diff registry lock sharing, shared merge run buffering, graph/context memory telemetry sharing, context-pack risk budget projection, dictionary max-token-length normalization, contract validator result shaping, stable-order tie-break sorting, map/isometric wireframe boost sharing, segment chunk-coordinate rebasing, benchmark trailing-JSON parsing, graph-relations benchmark fixture/artifact-writer sharing, contract-drift balanced-block parsing, release-check surface projection, index-stats prefixed piece aggregation, map benchmark CLI option sharing, workspace existing-ancestor suffix reattachment, safe JSON read error shaping, build-state benchmark run initialization, service build-state snapshot reading, worker-pool task error handling, retrieval hit-comparison metrics, language docmeta context matching, C-family docmeta projection sharing, language call/usage collector sharing, risk filter/model local helpers, risk CLI option-set sharing, compare-models option-set adoption, retrieval CLI invalid-request output formatting, report JSON stdout emission, map material glass/fog/opacity helpers, ANN legacy dense-vector payload materialization, retrieval report truncation/warning sections, graph output truncation/warning reuse, micro-bench sampled timing sharing, tool display/logger sharing, bench-language display logger routing, MCP analysis observability envelope sharing, saved-report exact-fragment helper cleanup, ANN candidate-set sizing/membership normalization, retrieval top-k sort-entry projection, benchmark language diagnostics/diff helpers, index benchmark percentile sharing, native index build-tool CLI display sharing, file-processor test fixture adoption, Nix/Starlark balanced scanner cursor sharing, summary report compare fixture sharing, Stage1 nested scheduler probe fixture sharing, Rust LSP workspace fixture sharing, tooling provider run fixture sharing, retrieval compatibility/search fixture reuse, API response-capture fixture sharing, LSP fake-process fixture sharing, smoke fixture setup sharing, cached-bundle fixture sharing, retrieval score/ANN fixture sharing, benchmark language repo fixture sharing, worker-pool fixture sharing, and saved-report test/scenario fixture cleanup. Keep the numeric baseline below unchanged until the next intentional full audit pass.
- 2026-05-21 saved-report follow-through filtered `temp/jscpd/jscpd-report.json` against current file contents without rerunning `jscpd`. The first exact-current pass found 27 fragments, all 19 lines or smaller, with the interim list logged in `temp/validation/saved-jscpd-exact-current-fragments-20260521.log`; after the follow-up reductions, the refreshed exact-current filter records source report path/mtime/detection date, the source audit log, all 212 scanned saved fragments, the prior 27-fragment interim count, and 0 exact-current fragments in `temp/validation/saved-jscpd-exact-current-fragments-refresh-20260521.log`. This checkpoint is not a new numeric baseline; keep the full-audit numbers unchanged until the next intentional report refresh.
- 2026-05-21 follow-up after that saved-report filter refactored several of those exact-current fragments without rerunning `jscpd`: TypeScript signature delimiter scanning, Rust declaration metadata shaping, SourceKit preflight diagnostic projection, MCP workspace select schema literals, model-bakeoff subprocess failure formatting, chunk-author existing-author detection, compact duration formatting, postings-packed synthetic fixture generation, and five local test fixture setup blocks. Evidence: `temp/validation/dup-refactor-batch2-syntax-rerun-20260521.log`, `temp/validation/dup-refactor-targeted-eslint-20260521.log`, `temp/validation/dup-refactor-focused-tests-20260521.log`, `temp/validation/dup-refactor-typescript-signature-tests-20260521.log`, and `temp/validation/dup-refactor-postings-packed-smoke-20260521.log`.
- 2026-05-21 P2 adoption follow-up also centralized service `build_state.json` snapshot reads in `tools/service/indexer-service-helpers.js` for progress monitoring and embedding replay, then moved report scripts with identical pretty-JSON stdout contracts to the existing `emitJson()` helper. Later slices moved Java/Kotlin/C# docmeta projection onto `buildDefaultDocMeta()` while preserving Kotlin/C# inheritance fields through a narrow `extraFields` hook, and moved shared definition/document-symbol row projection plus the map/filter/sort/slice pipeline in tooling navigation to file-local helpers while preserving scoring/filtering differences. Evidence: `temp/validation/service-build-state-helper-focused-tests-20260521.log`, `temp/validation/report-json-emit-helper-focused-tests-20260521.log`, `temp/validation/docmeta-shared-projection-validation-20260521.log`, `temp/validation/navigation-projection-helper-validation-20260521.log`, and `temp/validation/dup-navigation-projection-pipeline-helper-rerun-20260521.log`. `metrics-dashboard.js` and `indexer-service.js` intentionally remain local because their output contracts differ.
- 2026-05-21 small-fragment follow-up reduced more exact-current saved-report residuals without rerunning `jscpd`: context-expansion and graph-ranking contract matrices now share local graph fixture builders, ANN provider-runtime tests share one Date.now guard, triage tests share one spawn/failure helper, and MCP analysis handlers share cancellation and risk-filter guard helpers. Evidence: `temp/validation/small-fixture-mcp-helper-validation-rerun-20260521.log`, `temp/validation/small-fixture-mcp-helper-risk-rerun-20260521.log`, and `temp/validation/triage-helper-run-validation-20260521.log`; the first selector miss is preserved in `temp/validation/small-fixture-mcp-helper-validation-20260521.log`. The later focused proof disabled unrelated graph/import/usage assembly for filter-focused calls, and `context-pack/risk-filters-parity` plus `tooling/triage/context-pack` passed in `temp/validation/context-triage-proof-followup-clean-20260521.log`.
- 2026-05-21 language relation follow-up moved Kotlin relation assembly onto `buildBraceDelimitedMethodRelations()` with a narrow scan predicate that preserves Kotlin's relation-size guard. Syntax, targeted ESLint, and focused language/signature validation passed in `temp/validation/kotlin-relation-helper-validation-20260521.log`.
- 2026-05-21 saved-report follow-up continued from the same report without rerunning `jscpd`: SourceKit now shares runtime/block diagnostic and fidelity preflight detail shaping, MCP analysis handlers share progress/observability operation execution, Rust heuristic chunking shares candidate-line iteration and declaration entry creation, context-expansion tests share graph relation fixtures and expansion-case defaults, SQLite bundle-loader worker tests share load/close helpers, import-graph tests share incremental fixture state/entry creation, snapshot-core diff tests share build-pointer/snapshot seeding, incremental VFS tests share update/assert helpers, and index validation tests share issue assertion helpers. Evidence: `temp/validation/dup-sourcekit-diagnostics-helper-20260521.log`, `temp/validation/dup-mcp-analysis-observed-operation-20260521.log`, `temp/validation/dup-rust-candidate-scanner-helper-20260521.log`, `temp/validation/dup-graph-relation-fixture-helper-20260521.log`, `temp/validation/dup-context-expansion-case-helper-20260521.log`, `temp/validation/dup-sqlite-bundle-loader-worker-helper-20260521.log`, `temp/validation/dup-import-graph-fixture-helper-20260521.log`, `temp/validation/dup-snapshot-core-diff-fixture-helper-20260521.log`, `temp/validation/dup-incremental-vfs-helper-20260521.log`, and `temp/validation/dup-index-validation-issue-helper-20260521.log`. The MCP analysis log intentionally preserves one transient API-harness `ECONNRESET`; the isolated risk-explain rerun in the same log passed. Do not update the numeric baseline until the next intentional full audit refresh.
- 2026-05-21 additional saved-report follow-up continued without rerunning `jscpd`: index-stats contract tests now share repo/cache/index fixture setup, runner stability schema validation now shares the artifact envelope and retry category policy, `tools/index-snapshot.js` now shares dry-run-aware maintenance command execution for `gc` and `prune`, MCP workspace-aware tool definitions share workspace path/id/select property construction while preserving tool-specific descriptions and schema snapshots, tooling navigation definitions/document-symbols share the row projection pipeline, risk-delta surface parity fixtures share risk-summary envelope construction across single- and multi-sink cases, and Sublime map behavior tests share successful map-runner setup. A final exact-current provenance refresh briefly exposed one still-current ANN fallback contract-matrix test duplicate; `tests/retrieval/pipeline/ann-fallback-contract-matrix.test.js` now shares a local fallback-retry assertion helper, and the refreshed saved-report exact-current filter returns 0 fragments. Evidence: `temp/validation/dup-index-stats-fixture-helper-20260521.log`, `temp/validation/dup-stability-schema-payload-helper-20260521.log`, `temp/validation/dup-index-snapshot-maintenance-helper-20260521.log`, `temp/validation/dup-mcp-workspace-schema-helper-20260521.log`, `temp/validation/dup-navigation-projection-pipeline-helper-rerun-20260521.log`, `temp/validation/dup-risk-delta-summary-helper-20260521.log`, `temp/validation/dup-sublime-map-runner-helper-20260521.log`, `temp/validation/release-readiness-sbom-ci-timestamp-hardening-20260521.log`, and `temp/validation/saved-jscpd-exact-current-fragments-refresh-20260521.log`.

| Format | Files analyzed | Clones | Duplicated lines | Duplicated tokens |
| --- | ---: | ---: | ---: | ---: |
| Python | 41 | 4 | 44 (0.44%) | 520 (0.55%) |
| Markdown | 15 | 0 | 0 (0%) | 0 (0%) |
| JSON | 2 | 0 | 0 (0%) | 0 (0%) |
| JavaScript | 3,964 | 208 | 3,109 (0.58%) | 35,503 (0.64%) |
| Text | 9 | 0 | 0 (0%) | 0 (0%) |
| PowerShell | 4 | 0 | 0 (0%) | 0 (0%) |
| Bash | 1 | 0 | 0 (0%) | 0 (0%) |
| Total | 4,036 | 212 | 3,153 (0.57%) | 36,023 (0.63%) |

## Reduced In This Pass

- `tools/shared/dict-utils.js` now re-exports the canonical `src/shared/dict-utils.js` implementation, and the shared-module migration check reports no pending recipe rewrites.
- Starlark import collection now uses one shared scanner for comment/string/triple-quote skipping across balanced-call parsing and top-level call discovery.
- Merge benchmark scripts now share argument parsing, deterministic run generation, workspace setup, byte summing, and console comparison output in `tools/bench/merge/shared.js`.
- Shard splitting now uses one constraint-driven splitter for line-target and capacity-target splits.
- Snapshot and diff registries now share JSON object IO, absolute-path leak checks, manifest-relative path normalization, stable JSON writes, and registry-lock orchestration in `src/index/registry-support.js`.
- Snapshot freeze now uses the shared registry-lock orchestration while preserving its richer lock-conflict diagnostics.
- API search routes now share request preparation for GET query payloads and POST body payloads, plus one JSON search execution/error responder. Streaming SSE behavior remains route-local.
- Index postings benchmarks now share deterministic fixture construction, build invocation, heap/duration measurement, compare-mode parsing, and throughput formatting through `tools/bench/index/shared-postings-bench.js` and the generic `tools/bench/shared.js` CLI helpers.
- Core array artifact loading now shares JSON, columnar, and binary-columnar materialized source dispatch while preserving separate async/sync JSONL fallbacks.
- HNSW and LanceDB vector builders now share vector artifact source discovery in `tools/build/embeddings/vector-source.js` while preserving HNSW alias lookup and LanceDB's direct-meta behavior.
- LuaLS and PHPActor installers now share installer primitives in `tools/tooling/install-shared.js` while package selection, archive layout, PHAR behavior, and tool-specific messages stay local.
- SQLite chunk/stored-token fallback ingestion now shares local token batch/state/table-record helpers while keeping array batching and SQL stored-chunk paging separate.
- Retrieval run-config resolution now uses canonical `RUN_CONFIG_KEYS` projection while the plan runner keeps explicit destructuring for reviewability and hot-path clarity.
- Config inventory scanning now shares a tool-local JavaScript-like lexical state helper for brace matching and nested value skipping.
- Config schema traversal now shares the properties-only recursion used by inventory entry collection and contract-doc default extraction in `tools/config/inventory/schema.js`; `additionalProperties` and `items` handling remain entry-collection specific.
- Snapshot create/freeze now share snapshot-owned retention and lock-conflict helpers in `src/index/snapshots/support.js`.
- Bundle patch construction now lives in `src/shared/bundle-patch.js`; main-thread bundle IO wraps the core payload with `format`/`version`, and the worker keeps its protocol payload shape.
- Registry and build locks now share only the release/signal-cleanup lifecycle in `src/index/lock-release.js`; acquisition, stale-lock, and lock-held diagnostics remain owned by their domains.
- Token-ingest direct and sharded artifact paths now share local token-vocab and doc-length batch insert helpers while preserving statement shape, metrics, and row ordering.
- Bundle checksum normalization now reuses the worker-safe checksum helper instead of duplicating canonicalization in the transform worker.
- JSON write-stream constructors now share a local result wrapper while keeping gzip, zstd, and plain stream setup separate.
- Manifest source resolution now shares single-artifact path selection for binary and directory artifacts without changing strict ambiguity or fallback behavior.
- Graph and core artifact loaders now share narrow source-reading helpers; SQLite source ingestion now imports the canonical columnar row inflater from artifact IO.
- JSONL buffered read paths now share parse/push/cleanup telemetry for gzip, uncompressed small-file, and zstd small-payload flows while preserving streaming paths.
- Retrieval output filters now share docmeta merge helpers for standard and meta-v2 rendering.
- Federation coordination now shares response/meta/completeness assembly for empty and merged result paths while cache, error, and generation-context handling remain local.
- Report artifact and throughput summaries now share AST/kind aggregation in `tools/reports/show-throughput/ast-summary.js`; `tools/index/report-artifacts.js` reuses throughput aggregation helpers while preserving raw `languageLines` keys.
- Artifact loader residuals now share graph relation read-plan setup, columnar row context construction, and binary-columnar row-slice validation without materializing streaming paths or changing byte-budget behavior.
- JSON stream residuals now share JSON writer finalization/abort cleanup and sharded JSONL item writes while preserving stream backpressure, shard ordering, and close behavior.
- Subprocess tracking termination now uses subprocess-local helpers for termination option normalization, audit/event shaping, summary aggregation, and cleanup emission while preserving process-tree and timeout semantics.
- Report/throughput production residuals now share cache identity helpers, build-root sqlite artifact resolution, numeric distribution helpers, mode-total merging, and distribution table columns; dead global regression flattening was removed. The saved-baseline related hit was only the scan-profile production/test fixture overlap, and it is deferred unless a future audit shows it is still current and worth extracting.
- Schema contract fragments now share repeated risk watch-step, document extraction source-type count, test run entry, and test stability family summary shapes. The refreshed audit reports 0 current duplicate hits under `src/contracts/schemas/**`; the USR validator report-shaping family is tracked as its own completed row below, not as a separate open follow-up.
- USR report-shaping, row-diagnostics, and report-envelope helpers now share registry-failure result envelopes, report status selection, finding row construction, row diagnostic aggregation/freezing, report payload construction, row diagnostic cloning, scope normalization, and observed-result map normalization across matching readiness, governance, scenarios, observability/security, and benchmark validators. The refreshed audit reports 0 current duplicate hits under `src/contracts/validators/usr-matrix/**`, down from 29.
- Shared artifact compression candidate collection now uses one file-local variant collector for JSON and JSONL compressed fallback candidate discovery while preserving cleanup-before-backup ordering.
- Atomic writes now share file-local target validation and text/JSON payload builders while preserving temp-path selection, newline behavior, stable JSON serialization, checksums, fsync, rename, and cleanup behavior.
- Build-state lock-owner formatting now lives in a build-state-local helper shared by the store and patch queue while preserving persisted JSON shape and lock retry diagnostics.
- Replace-file now shares same-path and missing-temp error handling across async/sync replacement paths while preserving `ERR_TEMP_MISSING`, backup restore ordering, committed-final detection, and Windows path comparison behavior.
- Lifecycle registry shutdown now shares hook execution and pending-error collection while preserving drain vs close stage labeling, reverse close ordering, resource clearing, and pending promise settlement.
- `runWithQueue` pending-drain shutdown now shares stall timer setup and cleanup while preserving abort listener removal, timeout rejection behavior, and diagnostic stall snapshots.
- SQLite dense metadata expected-count resolution now lives in `src/storage/sqlite/utils.js` and is used by incremental update and runner planning without making core build code depend on runner probe modules.
- Incremental embedding-coverage manifest normalization now lives in `src/index/build/incremental/shared.js` and is reused by the main indexer incremental plan and records indexing path before records capability marking.
- Kill-tree platform termination now uses Windows fallback-state and POSIX kill-state helpers while keeping process discovery, process-group behavior, delayed `awaitGrace=false` escalation, and platform-specific signal/taskkill APIs local to their platform files.
- SQLite build telemetry and vector-encoding diagnostics now share table-stat recording and encoded-vector compatibility/warning helpers while preserving SQL statement order, incremental fallback behavior, and one-warning-per-path semantics.
- VS Code search argument and API payload construction now share a local option normalizer while keeping `extraArgs`, `maxResults`, CLI flags, and API-only `churnMin` mapping at their respective call sites.
- Pyright provider fallback assembly now uses a provider-local result builder, and Pyright planner/runtime health share Pyright-local path normalizers while preserving quarantine checks, fingerprints, capture diagnostics, and fallback fidelity state.
- Sublime production command plumbing now uses editor-local helpers for view selection, symbol extraction, search transport kwargs, index settings validation, and file/symbol lookup command shape. The refreshed audit reports 0 current duplicate hits in `sublime/PairOfCleats/commands/{analysis,index,map,search}.py`, `sublime/PairOfCleats/lib/views.py`, and `tests/helpers/sublime/search_behavior.py`; saved-baseline Python test-helper examples are conditional future-audit guidance only.
- Map call/usage edge construction now shares relation source/link-target/member-edge helpers in `src/map/build-map/edges.js` while preserving relation type, source/target selection, member deduping, and interning semantics. The refreshed audit reports 0 current duplicate hits in `src/map/build-map/edges.js`.
- Benchmark scripts now share `parseSimpleBenchArgs` in `tools/bench/shared.js` for the simple `--flag value` / `--flag=value` parser family across index, SQLite, cache, and embedding benches. The parser helper and `tools/bench/sqlite/jsonl-streaming.js` now have 0 current duplicate hits; saved-baseline benchmark residuals are measured-operation, scenario, USR, VFS, and graph-family lookalikes that remain deferred until a future audit proves current high-value overlap.
- Java, Kotlin, and C# now share C-like comment stripping plus dotted call/usage collection in `src/lang/shared.js`. C#, Java, and Kotlin share brace-delimited method relation assembly; C#/Java also share return-type extraction, and common dataflow/throw fact collection stays shared where grammar semantics match. Java/Kotlin/C# docmeta projection now shares `buildDefaultDocMeta()` while keeping Kotlin/C# inheritance fields local. Saved-baseline grammar lookalikes in `src/lang/{java,kotlin,csharp}.js` require a future intentional audit refresh before they can become current extraction candidates.
- Risk explanation narrative confidence and rule-reference normalization now use file-local helpers in `src/retrieval/output/risk-explain.js`. The broader renderer family still remains because CLI text, SARIF, context-pack JSON, and VS Code display rendering have different output contracts.
- VFS segment grouping now uses a local `createCoalescedSegmentGroup` factory in `src/index/tooling/vfs/segments.js` while preserving single-segment group shape, ordering, key generation, dedupe/collision behavior, and later merge mutation semantics. The refreshed audit reports 0 current duplicate hits in `src/index/tooling/vfs/segments.js`.
- USR matrix baseline generation now shares capability-profile construction plus framework segmentation, binding, route, and hydration helpers in `tools/usr/generate-usr-matrix-baselines/datasets.mjs` while keeping framework-specific edge cases, language lists, bridge rows, and hydration signals explicit. The refreshed audit reports 0 current duplicate hits in `tools/usr/generate-usr-matrix-baselines/{datasets,builders}.mjs`.
- Editor package entrypoints now share `tools/tooling/editor-package-cli.js` for `--flag value` / `--flag=value` parsing, source validation, toolchain checks, deterministic archive creation, smoke validation, and JSON result emission. `tools/package-sublime.js`, `tools/package-vscode.js`, and the package CLI helper now have 0 current duplicate hits.
- VS Code runtime tests now share command-registration and results-explorer harness helpers in `tests/tooling/vscode/runtime-test-helpers.js`. The refreshed audit reports 0 current duplicate hits in `tests/tooling/vscode/{operator-runtime,results-explorer-runtime,workflow-runtime}.test.js` and the helper.
- Risk explanation output now shares stable model/SARIF primitives for flow narrative selection, path formatting, call-site evidence shaping, rule references, confidence labels, and watch-window normalization. At the time of the refreshed audit, `src/retrieval/output/risk-explain.js` still had 3 hits; the later saved-report exact-current refresh found 0 still-current fragments, so renderer/model examples below are conditional future-audit categories rather than current implementation gaps.
- Context-pack federated risk annotation now shares path and call-site evidence annotation helpers for full and partial risk flows while keeping summary, source/sink, and frontier shaping explicit.
- Context-pack risk budget selection now shares file-local endpoint, score, and notes projection helpers for full and partial risk flows while preserving byte/token caps, truncation records, and emitted JSON field order.
- TypeScript AST and Babel chunkers now share chunk metadata construction, signature slicing, qualified-name joining, and final declaration ordering in `src/lang/typescript/chunk-metadata.js`; parser traversal, name extraction, params, and inheritance remain parser-specific.
- LSP hover metrics now share provider-local stage and skip counter constructors in `src/integrations/tooling/providers/lsp/hover-types/metric-counters.js`, while file latency summarization and payload policy defaults stay in their existing owners.
- USR benchmark and CI gate scripts now share narrow `tools/bench/usr/shared.js` and `tools/ci/usr/shared.js` helpers for repo-root resolution, JSON/text reads, input hashing, common option parsing, report writing, and strict exit handling while keeping per-item measured operations, metric keys, thresholds, console strings, and JSON shapes local. The refreshed audit reports 0 current duplicate hits in the item35-item40 USR bench and gate entrypoints.
- CI LSP SLO gate tests now share `tests/helpers/tooling-lsp-slo-gate.js` for provider fixture construction, temp JSON setup, gate spawning, payload reading, and cleanup. The refreshed audit reports 0 current duplicate hits in the `tests/ci/tooling-lsp-slo-gate*.test.js` family and helper.
- Graph benchmark scripts now share `tools/bench/graph/shared.js` for compare-mode normalization, timing summaries, index-dir CLI resolution, default chunk-seed selection, shared artifact loading, traversal-cache cleanup, and summary printing. The refreshed audit reports 0 current hits in `tools/bench/graph/{context-pack-latency,neighborhood-index-dir,shared}.js`; measured operations and result shapes stay script-local.
- Chunking dispatch now shares `collectHeadingRows` in `src/index/chunking/dispatch/shared.js` for bounded line scanning across heuristic and schema chunkers while keeping grammar-specific regex, candidate, title, kind, and fallback behavior local.
- The Stage1 tree-sitter scheduler contract test now uses local helpers for common `processFileCpu` options, fresh timing stubs, and missing-chunk scheduler stubs while preserving scenario assertions.
- Heuristic language-registry adapters now share a file-local regex usage candidate scanner while keeping template, GraphQL, proto, and build-DSL matchers and skip lists local.
- TypeScript heuristic chunking now shares function-like declaration and metadata assembly inside `src/lang/typescript/chunks-heuristic.js`; type declarations and class-member naming remain explicit.
- JavaScript and TypeScript relation builders now share AST member-name, call-argument, and call-detail primitives in `src/lang/js-ts/relations-shared.js` while keeping parser-specific traversal and caller resolution local.
- Risk context-pack tests now share risk fixture construction in `tests/helpers/risk-pack-eval.js`, including JSONL writing, repo/index setup, stats, summaries, flows, call sites, query offsets, and manifest payloads.
- Watch queue tests now share `tests/indexing/watch/helpers.js` for runtime/dependency/watch startup and polling while preserving scenario-specific failure/requeue assertions.
- VFS benchmark scripts now share VFS-family primitives in `tools/bench/vfs/shared.js` for integer/float clamping, deterministic RNG, lookup indices, sampled timing, alpha text generation, and simple bench output. Measured operations and JSON result shapes stay script-local.
- Retrieval pipeline tests now share `tests/retrieval/helpers/search-pipeline-fixture.js` for `alpha` token indexes, ANN placeholders, base search pipeline defaults, and small index fixtures while preserving each policy/error expectation locally.
- Java and Swift heavy-file processing tests now share `tests/indexing/file-processor/heavy-file-process-case-helper.js` for synthetic source/chunk generation, `processChunks` execution, and log capture while preserving language-specific expectations.
- Show-throughput scan tests now share `tests/tooling/reports/show-throughput-scan-test-helpers.js` for empty scan-profile fixtures and CLI fixture invocation while keeping each stdout scenario assertion explicit.
- VS Code analysis rendering now uses extension-local primitives for ref formatting, risk model normalization, primary/type/graph section rendering, provenance/filter/anchor output, and composite section assembly while preserving the CommonJS VSIX packaging boundary. `extensions/vscode/analysis-renderers.js` dropped from 18 hits to 1 residual model-normalization mirror.
- SQLite incremental partial bundle fallback tests now share `tests/storage/sqlite/incremental/bundle-partial-fallback-helper.js`; the two target tests and helper have 0 current duplicate hits.
- TUI observability tests now share `tests/tui/observability/supervisor-fixture.js`; run-id path safety, session correlation, replay determinism, and the helper have 0 current duplicate hits.
- Download-dicts installer tests now share `tests/tooling/install/download-dicts-test-helper.js`; both target tests and the helper have 0 current duplicate hits.
- Retrieval CLI and LMDB index loading now share `src/retrieval/index-hydration.js` for file-meta hydration, HNSW loading, vocabulary maps, and filter-index post-processing. The refreshed audit reports 0 current hits in `src/retrieval/{cli-index,lmdb-helpers,index-hydration}.js`.
- Filtered-minhash pipeline tests now share `tests/retrieval/pipeline/helpers/minhash-filtered-fixture.js`; the two target tests have 0 current duplicate hits. The helper has low-priority residual overlap with broader retrieval fixtures and should only be touched if it improves scenario readability.
- Retrieval explain/output tests now share `tests/retrieval/helpers/search-output-fixture.js` for stable `renderSearchOutput` defaults and hit-state setup. The refreshed audit reports 0 current hits in the target confidence, vector-only-warning, relation-boost, and helper files.
- Retrieval backend/contract pipeline tests now reuse `tests/retrieval/helpers/search-pipeline-fixture.js`; `fts-missing-table-fallback` and `search-routing-policy` have 0 current hits, and `score-breakdown-contract-parity` is reduced to a single low-priority residual.
- Retrieval SQLite FTS rank tests now share `tests/retrieval/backend/rank-sqlite-fts-fixture.js` for in-memory FTS setup and SQLite helper construction while preserving pushdown-arity and overfetch-budget assertions in the tests.
- SQLite shard fixture tests now share `tests/storage/sqlite/helpers/build-fixture.js` for sharded `chunk_meta`, token postings, and manifest piece setup. The refreshed audit reports 0 current hits in `chunk-meta-streaming`, `fts-contentless-schema`, and `jsonl-streaming-matrix`; helper residuals are lower-priority fixture overlap.
- PHP, Rust, Ruby, Shell, Lua, Perl, and Go language adapters now share declaration-list normalization and default docmeta shaping where the grammar contracts match. Lua, Ruby, and C-like call/usage collectors now also share the parameterized `collectDottedCallsAndUsages()` path while preserving grammar-specific token patterns, comment stripping, keyword skips, and macro suppression.
- ANN fallback contract tests now reuse filtered-minhash and in-memory pipeline fixtures instead of repeating policy/setup blocks in the matrix.
- Workspace manifest contract tests now share file-local repo/current-pointer/invalid-pointer helpers while preserving each manifest scenario assertion.
- SQLite shard fixture residuals now share custom token postings, doc-length, avg-doc-length, shard-size, and DB constructor setup for token materialization, memory guard, and transaction tests.
- Risk explanation and composite context-pack contract tests now share risk watch-step, full/minimal/capped risk model, and call-site fixture builders in `tests/helpers/risk-explanation-fixtures.js`.
- API analysis error-classification tests now share route validator wiring and response capture in `tests/services/api/analysis-error-classification-fixture.js` while preserving body-parse and repo-resolution error assertions in each test.
- Type-inference crossfile tests now share `tests/indexing/type-inference/crossfile/sink-call-fixture.js` for the sink/caller source and chunk graph while preserving lite-profile and parallel-determinism assertions in each test.
- SQLite token-postings streamed tests now share `tests/storage/sqlite/helpers/token-postings-streamed-fixture.js` for streamed chunk-meta setup, DB build invocation, and table count reads while preserving packed-fastpath and rebuild-fallback assertions locally.
- Retrieval output tests now use stream capture helpers plus the shared `renderSearchOutput` option and hit-state builders for diagnostics footer, raw-query, JSON routing, human layout, stats, and JSON streaming scenarios.
- LSP stale-process restart tests now share `tests/tooling/lsp/helpers/stale-process-restart-harness.js` for reader/writer restart harness setup while keeping close-direction assertions local.
- SQLite incremental fallback/profile tests now share `tests/storage/sqlite/helpers/incremental-bundle-db-fixture.js` for bundle DB setup and fallback input construction.
- Vector-only sparse cleanup tests now share `tests/indexing/postings/helpers/vector-only-cleanup-fixture.js`; the pass also fixed production cleanup sequencing so vector-only allowlisted sparse artifacts are removed before lingering-artifact validation.
- BM25 ranking now shares query-term frequency, vocabulary-index preparation, score accumulation, and weighted-score finalization inside `src/retrieval/rankers.js`; fielded and non-fielded ranking keep their existing total-doc and average-length semantics.
- SCM file-processor timeout/cache tests now share `tests/indexing/file-processor/scm-file-processor-test-helper.js` for repository setup, cached metadata assertions, fake run-process behavior, and snapshot fixtures while preserving per-test timeout/cache assertions.
- Watch tests now extend `tests/indexing/watch/helpers.js` for runtime/dependency/watch startup and polling across atomicity, shutdown, promotion, stability, and consistency scenarios.
- Graph tests now share `tests/graph/helpers/graph-fixtures.js` for graph-store fixtures, neighborhood setup, CSR/lazy artifact setup, and cache/count-warning inputs while keeping scenario assertions local.
- Ingest adapters now share `tools/ingest/shared.js` for repo-relative path guarding, stat bumping, CLI argument splitting, timeout normalization, write-stream completion, and streaming JSON/JSONL line handling; LSIF, SCIP, ctags, and gtags payload mapping remains adapter-owned.
- VFS manifest row-trimming tests now share the test-only `runVfsManifestWriter()` helper in `tests/helpers/vfs-streaming-fixture.js`, while scenario setup and assertions remain explicit in the indexing and tooling tests. Focused validation passed with 4 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/vfs-manifest-writer-fixture.log`; `jscpd` was not rerun for this post-baseline slice.
- VFS index lookup, path-map, fastpath telemetry, and lookup contract tests now reuse the same existing `runVfsManifestWriter()` helper instead of maintaining local writer harness copies. Focused validation passed with 4 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/vfs-writer-helper-existing-adoption-20260520-140120.log`; `jscpd` was not rerun for this post-baseline slice.
- Worker-pool crash logging now uses file-local helpers in `src/index/build/workers/pool.js` for unavailable-pool and task-error payload shaping across tokenize and quantize paths. Lifecycle decisions, payload construction, and task-specific labels stay local. Syntax, ESLint, and focused worker-pool tests passed with 13 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/worker-pool-crash-log-dedupe-20260520-073422.log`; `jscpd` was not rerun for this post-baseline slice.
- Fallback/analysis-gating file-processor tests now share `tests/indexing/file-processor/process-chunks-fixture.js` for `processChunks` execution setup and disabled-analysis policy defaults while preserving per-test assertions. Focused validation passed with 4 passed in `temp/validation/process-chunks-fixture-dedupe-20260520-075801.log`.
- Graph context and impact CLI helpers now share caps/filter option resolution through `src/integrations/tooling/cli-helpers.js`, while command-specific output and traversal behavior stay local. Focused validation passed with 6 passed in `temp/validation/graph-cli-helper-dedupe-20260520-080057.log`.
- Elixir and Solargraph providers now share non-ready preflight result construction in `src/index/tooling/lsp-provider/non-ready-preflight-result.js`, preserving provider-specific preflight ordering and diagnostics. Syntax, ESLint, and focused LSP provider tests passed in `temp/validation/node-check-provider-preflight.log`, `temp/validation/eslint-provider-preflight.log`, and `temp/validation/focused-lsp-provider-tests.log`.
- Git meta-batch timeout bookkeeping now uses a local helper in `src/index/scm/providers/git/meta-batch.js`; the broader validation surfaced and fixed SCM fallback source labeling in `src/index/scm/file-meta-snapshot.js`. Focused SCM validation passed with 6 passed in `temp/validation/scm-meta-fallback-source-fix-20260520-080351.log`.
- Superseded audit note: the earlier 2026-05-20 pre-refresh full audit passed with 496 clones, 8,868 duplicated lines, and 98,913 duplicated tokens in `temp/jscpd/audit-duplicates-20260520-080416.log`; the current baseline above replaces it.
- Heavy-file processChunks tests now reuse the expanded `tests/indexing/file-processor/process-chunks-fixture.js` disabled-analysis and manifest-concurrency defaults. Focused validation passed with 5 passed in `temp/validation/heavy-file-process-chunks-fixture-dedupe-20260520-080748.log`; `jscpd` was not rerun for this post-audit slice.
- VFS row-trim tests now share `createVfsRowTrimFixture()` in `tests/helpers/vfs-streaming-fixture.js`, keeping row-size assertions local. Focused validation passed with 4 passed in `temp/validation/vfs-row-trim-fixture-dedupe-20260520-080940.log`; `jscpd` was not rerun for this post-audit slice.
- Native rebuild npm execution now uses one `runNpmCommand()` helper around `spawnResolvedSubprocessSync('npm', ...)`, preserving build-from-source env policy while removing the duplicated rebuild/install-script spawn-result handling. Focused validation passed with 4 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/rebuild-native-resolved-npm-focused-tests-20260520-123837.log`; final syntax, ESLint, JSON, and diff checks passed in `temp/validation/rebuild-native-resolved-npm-final-checks-20260520-123946.log`; `jscpd` was not rerun for this post-audit slice.
- Native rebuild package validation now flows through one `normalizePackageNameResult()` helper before the rebuild and install-script paths diverge into package-specific npm commands. Focused validation passed in `temp/validation/rebuild-native-package-helper-focused-tests-20260520-125613.log`; final syntax, ESLint, JSON, and diff checks passed in `temp/validation/import-cache-stats-and-rebuild-helper-final-checks-20260520-125838.log`; `jscpd` was not rerun for this post-audit slice.
- Risk-delta surface parity now uses file-local helpers for risk artifact manifest entries and current-build pointer writes, keeping scenario-specific flow/chunk assertions explicit. Focused validation passed with 1 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/risk-delta-fixture-manifest-dedupe-focused-tests-20260520-124140.log`; final syntax, ESLint, JSON, and diff checks passed in `temp/validation/risk-delta-fixture-manifest-dedupe-final-checks-20260520-124450.log`; `jscpd` was not rerun for this post-audit slice.
- Import-resolution matrix tests now share `tests/helpers/import-resolution-fixture.js` for reset-and-create temp roots and cache-stat fixtures across cache, graph, policy, neighborhood-invalidation, and external-fallback contract tests while keeping each scenario's imports, relations, and assertions local. Focused validation passed with 3 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/import-resolution-temp-fixture-dedupe-focused-tests-20260520-124635.log`; the cache-stat follow-up passed in `temp/validation/import-cache-stats-helper-focused-tests-20260520-125603.log`; final syntax, ESLint, JSON, and diff checks passed in `temp/validation/import-resolution-temp-fixture-dedupe-final-checks-20260520-124858.log` and `temp/validation/import-cache-stats-and-rebuild-helper-final-checks-20260520-125838.log`; `jscpd` was not rerun for this post-audit slice.
- Index benchmark scripts now share deterministic RNG and list picking through `tools/bench/shared.js`; import graph, import resolution graph, symbol artifact, postings, ordering, minhash, and chunk-meta benchmarks keep their measured operations local. Syntax, ESLint, small script probes, the minhash bench contract test, and diff checks passed in `temp/validation/bench-rng-helper-focused-checks-20260520-130241.log`; `jscpd` was not rerun for this post-audit slice.
- Release bundle assembly and readiness gate now share `tools/release/file-walk.js` for deterministic sorted file enumeration while preserving bundle manifest shape, readiness blockers, relative-path formatting, and release failure wording at the call sites. Syntax, ESLint, the new release file-walk contract, release bundle assembly, readiness gate, and diff checks passed in `temp/validation/release-file-walk-helper-focused-checks-20260520-130651.log`; `jscpd` was not rerun for this post-audit slice.
- SQLite sparse-preflight fallback tests now share `tests/retrieval/backend/sparse-preflight-fallback-helper.js`, preserving filtered/unfiltered expectation differences at the call sites. Focused validation passed with 4 passed in `temp/validation/sparse-preflight-fallback-fixture-dedupe-20260520-081209.log`; `jscpd` was not rerun for this post-audit slice.
- Risk interprocedural tests now share `tests/indexing/risk/interprocedural/helpers/risk-flow-fixtures.js` for flow and record construction while keeping sanitizer and arg-aware scenario assertions explicit. Focused validation passed with 3 passed in `temp/validation/risk-flow-fixture-dedupe-20260520-081630.log`; `jscpd` was not rerun for this post-audit slice.
- Tree-sitter scheduler/file-processor tests now share `tests/indexing/file-processor/tree-sitter-process-file-cpu-fixture.js` for `processFileCpu` runtime setup. Focused validation passed with 2 passed in `temp/validation/tree-sitter-process-file-cpu-fixture-validation.log`; `jscpd` was not rerun for this post-audit slice.
- Subprocess cleanup tests now share `tests/shared/subprocess/tracked-cleanup-fixture.js` for tracked child setup and cleanup assertions while signal and custom-handler behavior remains test-local. Focused validation passed with 3 passed in `temp/validation/subprocess-cleanup-validation-20260520-081201.log`; `jscpd` was not rerun for this post-audit slice.
- VS Code operations/session runtime tests now share temp-repo setup and runtime assertions through `tests/helpers/vscode/runtime-harness.js` and `tests/helpers/vscode/runtime-assertions.js`, and both runtime tests restore patched globals in `finally` blocks. Syntax, ESLint, and focused runtime tests passed in `temp/validation/vscode-runtime-dedupe-node-check.log`, `temp/validation/vscode-runtime-dedupe-eslint.log`, `temp/validation/vscode-runtime-dedupe-focused-tests-rerun.log`, and `temp/validation/vscode-runtime-try-finally-clean-20260520-083000.log`; `jscpd` was not rerun for this post-audit slice.
- SQLite benchmark build/update scripts now share `tools/bench/sqlite/shared.js` for better-sqlite3 loading, deterministic bundle workspace setup, chunk fixture generation, bundle writing, and DB existence checks while keeping measured operations, adaptive update planning, output text, and result shapes local. Syntax checks, tiny deterministic benchmark smokes, and whitespace checks passed in `temp/validation/sqlite-bench-shared-fixture-rerun-20260520-132413.log`; `jscpd` was not rerun for this post-audit slice.
- Retrieval mixed-profile backend tests now share `tests/helpers/index-compatibility-fixture.js` for in-memory mixed default/vector-only index construction and load options while keeping unsafe-mix warnings and mismatch assertions local. Focused validation passed with 2 passed in `temp/validation/retrieval-mixed-profile-fixture-20260520-132449.log`; the later compatibility/search fixture consolidation is logged in `temp/validation/index-compat-search-fixture-dedupe-direct-rerun-20260520.log`; `jscpd` was not rerun for this post-audit slice.
- Retrieval pipeline candidate-buffer and stage-checkpoint tests now reuse `tests/retrieval/helpers/search-pipeline-fixture.js` for alpha-index and pipeline defaults while preserving pool stats and stage assertions at the call sites. Syntax checks, focused tests, and whitespace checks passed in `temp/validation/retrieval-pipeline-fixture-reuse-20260520-132546.log`; `jscpd` was not rerun for this post-audit slice.
- TUI cancel-propagation and mid-job termination tests now share `tests/tui/supervisor-fixture.js`, backed by the existing supervisor session helper, for protocol spawn/send/wait/kill mechanics while keeping job IDs, cancel/shutdown timing, and status assertions local. Focused validation passed with 2 passed in `temp/validation/tui-supervisor-fixture-20260520-132608.log`; `jscpd` was not rerun for this post-audit slice.
- Nix import collection now shares a file-local lexical-state skipper for comments, indented strings, and double-quoted strings across parenthesized expression parsing and top-level scan traversal. Focused import collector and non-JS import resolution validation passed in `temp/validation/nix-import-collector-lexical-helper-20260520-133128.log`; `jscpd` was not rerun for this post-audit slice.
- File-processor CPU and processChunks now share `src/index/build/file-processor/crash-stage.js` for crash-stage payload construction and trace emission while preserving the exact phase, mode, build stage, file index, rel key, substage, and extra metadata shape. The follow-up context-projection helper moved the remaining CPU/token-flow updater construction into the same module. Focused file-processor and tree-sitter-adjacent validation passed in `temp/validation/file-processor-crash-stage-helper-20260520-133534.log`; the follow-up syntax and focused CPU/token-flow validation passed in `temp/validation/file-processor-crash-stage-context-helper-syntax-20260520-145126.log` and `temp/validation/file-processor-crash-stage-context-helper-tests-20260520-145132.log`; `jscpd` was not rerun for these post-audit slices.
- Retrieval federation tests now share `tests/retrieval/federation/repo-fixture.js` for repo cache config, current build pointer, mode index directories, and minimal index artifacts while cache failure, redaction, query-cache, selection, and search assertions stay local. Focused validation passed with 5 passed in `temp/validation/retrieval-federation-fixture-dedupe-20260520-133417.log`; `jscpd` was not rerun for this post-audit slice.
- Retrieval federation args and selection now share federation-local list normalization in `src/retrieval/federation/normalize.js` while tag lowercasing, glob filtering, real-path selection, and CLI/request validation stay local. Syntax and focused federation validation passed in `temp/validation/retrieval-federation-list-normalizer-syntax-20260520-145406.log` and `temp/validation/retrieval-federation-list-normalizer-tests-20260520-145422.log`; `jscpd` was not rerun for this post-audit slice.
- File-processor skip, read-failure, partial-language, and framework docmeta tests now share `tests/indexing/file-processor/file-processor-fixture.js` for temp roots, fixture file writes, scanned file entries, and baseline `createFileProcessor` options while keeping scenario names, skip reasons, diagnostics, and read-failure assertions local. Focused validation passed with 5 passed in `temp/validation/file-processor-fixture-dedupe-20260520-133652.log`; `jscpd` was not rerun for this post-audit slice.
- The VS Code `windows-cmd-core.cjs` mirror is excluded from the audit as an intentional packaged copy, not an actionable shared-module target.
- SCM file metadata now flows through `src/index/scm/file-meta.js`, and git/jj candidate path enumeration uses the shared SCM path helpers in `src/index/scm/paths.js`; focused SCM validation passed after fixing a stale call site, with one >30s SCM runner timeout recorded in `temp/validation/scm-file-meta-focused-tests-rerun-20260520-150846.log`, direct import smoke in `temp/validation/scm-file-meta-import-smoke-20260520-151044.log`, and path helper validation in `temp/validation/scm-path-helper-tests-20260520-151745.log`.
- Search-debug capture now shares capture environment preparation in `tools/testing/search-debug-capture.js`; the direct env smoke passed in `temp/validation/search-debug-capture-env-smoke-20260520-150845.log`, while the full focused runner printed its pass marker but exceeded the 30s cutoff and is recorded in `temp/validation/search-debug-capture-focused-test-20260520-150642.log`.
- TypeScript AST and Babel chunkers now share the declaration sink in `src/lang/typescript/chunk-metadata.js`, preserving parser-specific traversal and symbol discovery. Syntax and focused TypeScript validation passed in `temp/validation/typescript-declaration-sink-syntax-20260520-151044.log` and `temp/validation/typescript-declaration-sink-tests-20260520-151310.log`.
- Import-resolution count and hotspot shaping now shares `src/index/build/import-resolution/counts.js` across the engine, replay harness, stage pipeline, and import scan stats while preserving caller-specific object prototypes. Focused validation passed in `temp/validation/import-resolution-count-helper-tests-20260520-151310.log`.
- Shared child-exit semantics now live in `src/shared/subprocess/exit-semantics.js` and are re-exported by the CLI, postinstall, and TUI wrappers without changing signal/code precedence. Syntax and focused validation passed in `temp/validation/child-exit-semantics-syntax-20260520-151407.log` and `temp/validation/child-exit-semantics-tests-20260520-151407.log`.
- Worker Node argv and heap parsing now shares `src/shared/workers/node-argv.js` across SQLite bundle loading, tree-sitter workers, and index build worker config; syntax, smoke, and focused worker validation passed in `temp/validation/worker-node-argv-helper-syntax-20260520-151603.log`, `temp/validation/worker-node-argv-helper-smoke-20260520-151603.log`, and `temp/validation/worker-node-argv-helper-tests-20260520-151603.log`.
- C-like and Swift chunk bounds now share `src/lang/brace-bounds.js`, and C-like/C#/Kotlin/PHP/Swift dataflow facts share await/yield/throw collection through `src/lang/shared.js` while grammar-specific skip rules stay local. Focused validation passed in `temp/validation/brace-bounds-helper-tests-20260520-151932.log`, `temp/validation/language-dataflow-helper-tests-20260520-152307.log`, and `temp/validation/language-dataflow-php-focused-20260520-152349.log`.
- Index throughput compare-mode scripts now share `tools/bench/index/throughput-compare.js` while measured operations and output fields stay in each benchmark entrypoint. Syntax and tiny compare-mode smokes passed in `temp/validation/bench-throughput-helper-syntax-20260520-152452.log` and `temp/validation/bench-throughput-helper-smokes-20260520-152452.log`.
- The `index build --workspace` alias and `workspace build` dispatch paths now share file-local workspace-build validation/routing in `bin/pairofcleats.js`, so index build flags, workspace-only flags, and value-flag enforcement stay identical. Syntax and focused CLI/navigation validation passed with 5 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/pairofcleats-workspace-build-dispatch-helper-20260520-153820.log`.
- Go/Rust workspace provider preflight now shares `src/index/tooling/preflight/workspace-partition-checks.js` for partition list formatting and scoped diagnostic check messages while provider-specific partition selection, command probing, cache keys, failure classification, and runtime behavior remain local. Syntax and focused Go/Rust LSP validation passed with 6 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/provider-workspace-partition-helper-20260520-154413.log`.
- Lua, YAML, Zig, and Rust preflight-language checks now share a provider id/language predicate in `src/index/tooling/lsp-provider/preflight-language.js` while each policy check keeps its own diagnostics and reason codes. Syntax and focused Lua/YAML/Zig/Rust LSP validation passed with 6 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/preflight-language-server-match-helper-20260520-154901.log`.
- C#, Kotlin, and PHP chunkers now share C-like type-body member iteration in `src/lang/shared.js` while keeping parse, naming, return/param extraction, visibility, attributes, and language-specific skip rules local. Syntax and focused C-family/PHP/Kotlin validation passed with 5 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/language-type-member-helper-20260520-155639.log`.
- Import-resolution stage/count normalization now centralizes non-negative coercion, counter bumping, count-map filtering, stage snapshot sorting, and hotspot shaping in `src/index/build/import-resolution/counts.js` / `path-utils.js` while preserving engine, stage-pipeline, replay-harness, and SLO report contracts. Process-file watchdog policy now reuses the exact numeric clamping helpers exported by `watchdog.js` while keeping effective slow-file duration policy local. Syntax, targeted ESLint, focused import-resolution validation, and focused watchdog validation passed with 8 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/build-runtime-import-watchdog-helper-tests-20260520-162650.log` and `temp/validation/build-runtime-import-watchdog-helper-eslint-20260520-162825.log`.
- Docs-search JSON fast-scan compaction now uses a file-local entry-line helper for the repeated name/title, parent, abstract/description/text/content extraction and normalized line append, while object-map route decoding and array route/path/url/id fallback stay at their call sites. Syntax, targeted ESLint, and focused fast-path validation passed with 1 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/docs-search-json-fast-scan-helper-20260520-164520.log`.
- Extracted-prose low-yield bailout state now uses file-local serializers for sampled decision summaries, sampled report summaries, and history summaries while preserving the different `yieldRatio` semantics for sampled live observations versus persisted history. Syntax, targeted ESLint, docs-search fast-path validation, and focused extracted-prose core/report/history validation passed with 5 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/extracted-prose-low-yield-syntax-eslint-parent-20260520-165020.log` and `temp/validation/docs-search-extracted-prose-helper-tests-20260520-165115.log`.
- Shared index build-stage normalization now lives in `src/shared/indexing/stages.js`, with `src/integrations/core/args.js`, `src/index/build/piece-assembly/helpers.js`, `src/index/build/runtime/stage.js`, and incremental planning reusing the same stage order and comparison contract. Syntax, targeted ESLint, and focused stage/runtime/incremental validation passed with 4 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/index-stage-shared-helper-tests-20260520-170900.log`.
- Collector-hint normalization now lives in `src/index/language-registry/import-collectors/utils.js` with the optional reason-code predicate needed by import resolution, removing the duplicate registry/import-resolution/imports normalizers while preserving existing call-site defaults. Syntax, targeted ESLint, and focused import collector/resolution validation passed with 5 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/collector-hint-normalizer-tests-20260520-171600.log`.
- Generated-counterpart and OpenAPI source candidate derivation now share `src/index/build/import-resolution/generated-counterpart-suffix.js` across the import-resolution cache and expected-artifacts index while preserving the cache's broader OpenAPI directory hints and the expected-artifacts index's source-gated directory behavior. Syntax, targeted ESLint, and focused import-resolution validation passed with 4 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/generated-counterpart-helper-tests-20260520-validate.log`.
- Runtime and service logging now share `src/shared/logging/config.js` for log format, level, ring count, and ring byte normalization while keeping destination, structured context, and service/runtime ownership local. Syntax, targeted ESLint, runtime/progress contracts, and service smoke validation passed with 3 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/logging-config-helper-20260520.log`.
- Scan-profile report tests now reuse the production `createEmptyModeProfile()` constructor instead of copying the scan-profile mode shape. Syntax, targeted ESLint, scan-profile artifact validation, and show-throughput scan-profile/outcome validation passed with 3 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/scan-profile-empty-mode-helper-20260520.log`.
- Tree-sitter worker language gating now delegates to `resolveTreeSitterLanguageForExt()` and `isTreeSitterEnabled()` instead of carrying a worker-local copy of extension resolution and enablement semantics. Syntax, worker import checks, and focused parse/chunk validation passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/tree-sitter-options-worker-syntax-20260520-163427.log` and `temp/validation/tree-sitter-worker-focused-tests-20260520-163524.log`; the initial `temp/validation/tree-sitter-worker-parse-determinism-20260520-163452.log` selector matched no tests and was rerun with the corrected selector.
- Retrieval full/short output formatters now share snippet normalization, keyword-ish detection, cache lookup/write, display metadata construction, and full-mode usage summary helpers in `src/retrieval/output/format/shared.js` while preserving exact output shape and renderer-specific sections. Syntax validation passed in `temp/validation/retrieval-format-syntax-20260520-163659.log`; targeted retrieval formatter/output/cache validation passed with 21 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/retrieval-format-tests-20260520-163758.log`. An initial overbroad runner selection was stopped before completion and replaced with the targeted run.
- Config-format chunkers now share `src/index/chunking/formats/config-tree-sitter.js` for tree-sitter metadata normalization across JSON, XML, YAML, INI, and TOML, and JSON's repeated frame-value branch is file-local. Syntax checks and direct config chunker validation passed with 5 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/config-format-duplicates-20260520-final.log`; `indexing/chunking/formats/format-fidelity` passed once at 26.8s and later timed out at 31.2s in the six-test batch recorded in `temp/validation/config-format-duplicates-20260520-validate.log`, so it was not rerun per the 30-second test rule.
- Map/isometric defaults now share browser-served default-value constants in `src/map/isometric/client/default-values.js`, with server map defaults and browser client defaults applying explicit call-site overrides for intentional lighting, pixel-ratio, and zoom differences. Syntax, targeted ESLint, map viewer/build contract tests, and map static-server path tests passed with 6 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/map-isometric-default-values-helper-20260520.log`.
- API diff and snapshot routes now share `parseStringList()` in `tools/api/router/request-helpers.js` while keeping diff query aliases, snapshot body parsing, and route-specific validation local. Syntax and targeted ESLint passed; focused API route validation passed 3 tests with 0 failures in `temp/validation/api-router-string-list-helper-20260520.log`. `services/advanced-surface-goldens` timed out at 30.3s and was not rerun per the repository 30-second test rule.
- API index snapshot/diff routes now share `decodeRoutePathSegment()` in `tools/api/router/request-helpers.js` for route ID decoding and malformed URI classification while preserving route-specific labels and `INVALID_REQUEST` messages. Syntax checks and focused API route validation passed in `temp/validation/api-route-segment-helper-focused-20260521.log`; the earlier selector mistake and aborted full-suite attempt is preserved in `temp/validation/api-route-segment-helper-20260521.log`.
- LSP hover definition, type-definition, and references now share same-document location-to-source/line-signature parsing plus the cache/budget/deadline/error requester flow in `src/integrations/tooling/providers/lsp/hover-types/index.js`, while request methods, limiters, cache keys, timeout labels, counters, references `includeDeclaration`, and metrics remain stage-owned at the call sites. Expanded syntax, targeted ESLint, and focused LSP validation passed with 7 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/lsp-hover-location-signature-helper-expanded-20260520.log`; the requester follow-up passed syntax, targeted ESLint, fallback runtime, multi-stage ordering, adaptive timeout, budget, cache-key, and semantic-token/inlay-hint checks in `temp/validation/lsp-hover-location-requester-helper-20260520.log`.
- Map ISO analysis and benchmark servers now share static content-type and stream/404 handling in `tools/analysis/map-iso-static.js`, removing the duplicate static-file response path while preserving each server's route messages and roots. The same slice simplified `src/shared/safe-regex.js` by applying identical program-size probe/error handling once for every backend. Syntax, targeted ESLint, map path/server-adjacent tests, and safe-regex contracts passed with 5 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/map-iso-static-safe-regex-helper-20260520.log`.
- SCM file-meta snapshot reuse now constructs the reuse observation once and feeds the same object to summary aggregation and the returned observations list, preserving generation fields and timing semantics. Syntax, targeted ESLint, and focused SCM snapshot validation passed with 5 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/scm-snapshot-observation-helper-20260520.log`.
- Shared merge run writers now use a file-local buffered JSONL writer for both direct run-file writes and sorted-run merge output while keeping stats accounting and writer close/destroy behavior local. Syntax, targeted ESLint, merge contract validation, merge benchmark contract validation, and postings spill merge-planner validation passed with 3 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/shared-merge-buffer-helper-20260520.log`.
- Dictionary tokenization now exports one max-token-length normalizer from `src/shared/tokenize-dictionary.js`, reused by index-build dictionary normalization so cached `__maxTokenLength`, `maxLen`, and `__sharedDict` handling stay consistent. Syntax, targeted ESLint, tokenization/minhash validation, and ranking validation passed with 4 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/token-dictionary-max-length-helper-20260520.log`.
- Contract validators now share `src/contracts/validators/result.js` for Ajv error formatting and `{ ok, errors }` result wrapping across workspace, test-artifacts, index-perf, build-state, artifacts, USR registry, analysis, and USR validators while preserving each validator's schema ownership and exported validation entrypoints. Syntax, targeted ESLint, and focused workspace/harness/indexing/analysis/USR contract validation passed with 15 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/contracts-validator-result-helper-20260520.log`.
- Stable ordering now uses one file-local stable sort primitive for selector-built comparators and explicit comparators in `src/shared/order.js`; map/isometric selection now uses one wire-material boost primitive for mesh and file-key highlighting in `src/map/isometric/client/selection.js`. Syntax, targeted ESLint, and focused order/map contract validation passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/order-selection-local-helper-20260520.log`.
- Benchmark mixed-output JSON parsing now lives in `tools/bench/output.js`, shared by `tools/bench/bench-runner.js` and `tools/bench/ab-sweep.js` while keeping CLI parsing, suite selection, scoring, and reporting local. Syntax, targeted ESLint, and focused benchmark contract validation passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/bench-output-json-helper-20260520.log`.
- Graph-relations benchmark fixture generation and artifact writing now live in `tools/bench/index/relations-fixture.js`, shared by the graph-relations benchmark and its determinism contract while preserving benchmark-specific chunk counts, file modulo, output validation, and determinism assertions. Syntax, targeted ESLint, focused determinism validation, and a small benchmark smoke passed in `temp/validation/relations-bench-fixture-helper-20260520.log` and `temp/validation/relations-bench-writer-helper-20260520.log`.
- Contract drift checking now uses one balanced-object extraction helper for CLI option and score-breakdown parsing, recognizes the live `SEARCH_OPTIONS` source name, and restricts artifact doc extraction to top-level artifact bullets. The artifact schema contract doc now lists dense-vector binary metadata and `scan_profile`, bringing the gate back to green. Syntax, targeted ESLint, `node tools/docs/contract-drift.js --fail`, release-check schema/filtering/exit-code tests, and artifact publication/doc contract tests passed in `temp/validation/tooling-local-helpers-20260520.log`.
- Release-check report and manifest surface shaping now share one file-local release-check field projection while preserving manifest-only runtime/build/install/smoke fields. Index stats now shares one file-local prefixed artifact aggregation helper for chunk and token stats while preserving row/null/part semantics. Both are covered by `temp/validation/tooling-local-helpers-20260520.log`.
- Map benchmark CLIs now share the common map build/input option block through `tools/bench/map/shared.js` while viewer/display/run-specific options stay local. Syntax, targeted ESLint, and focused map validation passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/map-bench-cli-options-helper-20260520.log`.
- Workspace identity now shares missing-suffix reattachment across sync and async existing-ancestor realpath resolution, and safe JSON reads share error-emitter and too-large error construction while keeping sync/async IO control flow separate. Syntax, targeted ESLint, and focused workspace/file-read/path/json validation passed with 8 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/workspace-file-read-local-helpers-20260520.log`.
- Build-state benchmark scripts now share run-root preparation and `initBuildState()` setup in `tools/bench/index/build-state-shared.js` while keeping timing/update behavior local. Syntax, targeted ESLint, and tiny sidecar/write benchmark smokes passed in `temp/validation/build-state-bench-run-helper-20260520.log`.
- Worker-pool tokenize and quantize tasks now share one local task-error handler for clone-error permanent disable, opaque worker failure disable, restart scheduling, and crash logging, while preserving tokenize's detail-first log message. Syntax, targeted ESLint, and focused worker-pool validation passed with 13 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/worker-pool-task-error-helper-20260520.log`.
- Config-format chunkers now share tree-sitter entry construction in `src/index/chunking/formats/config-tree-sitter.js` across JSON, XML, YAML, and TOML while preserving JSON's bypass precheck, YAML workflow handling, and TOML-only enablement. Syntax, targeted ESLint, and focused format-fidelity validation passed with 1 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/config-tree-sitter-entry-helper-20260520.log`.
- Config schema default extraction now reuses the inventory schema properties walker while keeping `additionalProperties` and array `items` traversal scoped to schema entry collection. Syntax, focused config tests, and a contract-doc smoke passed with 6 focused tests, 0 failures, 0 timeouts, and 0 skipped in `temp/validation/config-schema-defaults-helper-dedupe-20260520.log`.
- Retrieval hit-list parity now shares key/score/rank-overlap metrics in `src/retrieval/hit-comparison.js`; compare-model reporting and SQLite/memory parity keep their output envelopes and zero-hit behavior local. Syntax, targeted ESLint, a direct metric-contract probe, and `smoke/retrieval` passed in `temp/validation/retrieval-hit-comparison-helper-20260520.log`.
- Python and Swift docmeta extraction now share context-chunk matching in `src/lang/docmeta-context.js` while language-specific metadata fields stay local. Syntax, targeted ESLint, direct matching probes, and language metadata fixture checks passed in `temp/validation/language-docmeta-context-helper-20260520-rerun.log`; the earlier `temp/validation/language-docmeta-context-helper-20260520.log` only records a stale runner selector miss.
- Risk filtering and risk explanation modeling now share file-local filter-set, flow-list, evidence, and blocked-expansion helpers while preserving the full-vs-partial flow contract. Syntax, targeted ESLint, direct probes, runner-backed risk parity/adapter checks, and direct risk tests passed in `temp/validation/risk-filter-explain-local-helpers-20260520.log` and `temp/validation/risk-filter-explain-direct-tests-20260520.log`.
- Retrieval CLI missing-query and parse-error paths now share invalid-request output formatting while keeping message selection, JSON-output inference, metrics, exit behavior, and thrown error shape at the callers. Syntax, targeted ESLint, direct JSON/human probes, and `cli/search/non-result-surfaces` passed in `temp/validation/retrieval-cli-options-invalid-request-helper-20260520-rerun.log`; the first log only records an assertion typo in the probe.
- Map/isometric materials now share local glass-transmission, height-fog uniform, material-opacity, and shell-inner-opacity helpers while preserving slider curves, fog enablement guards, and instanced-material userData policy. Syntax, targeted ESLint, a fake Three.js behavior probe, and `map/build-contract-matrix` passed in `temp/validation/map-isometric-material-local-helpers-20260520.log`.
- ANN backend lazy dense-vector loading now shares legacy dense payload materialization for manifest-backed and fallback JSON paths while preserving binary-vector priority, strict-mode behavior, `arrays.vectors` precedence, empty-vector rejection, and model-default injection. Syntax, targeted ESLint, a temp fallback-loader probe, embedding identity gating, ANN availability contracts, and `retrieval/ann/lancedb` passed in `temp/validation/ann-backends-legacy-dense-helper-20260520.log`.
- Architecture and suggest-tests output now share retrieval report truncation/warning section rendering in `src/retrieval/output/report-sections.js`; sorting, headings, fidelity, witness, and violation formatting remain report-local. Syntax, targeted ESLint, direct render probes, and graph/suggest-tests golden-style contracts passed in `temp/validation/retrieval-output-report-sections-helper-20260520-rerun.log`; the first log only records a stale runner selector miss.
- Graph impact and graph context-pack renderers now reuse the shared truncation record/warning helpers while preserving their product-specific headings and Markdown section structure. Syntax and focused graph output validation passed with 6 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/graph-output-truncation-helper-dedupe-20260520.log`.
- Risk delta, risk explain, and context-pack option definitions now share narrow `RISK_FILTER_OPTIONS` and `REPORT_FORMAT_OPTIONS` blocks while preserving command-local aliases, required arguments, format resolution, and filter validation. Syntax and focused risk CLI/context-pack validation passed with 7 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/risk-cli-option-set-dedupe-20260520.log`.
- Regex, hash, and compression micro-benchmarks now share `runSampledBench()` for warmup, sampled timing, sync callback support, async callback support, and duration stats while keeping ops/sec, MB/sec, compression ratio, and JSON output shapes local to each script. Syntax and tiny JSON smoke validation passed in `temp/validation/micro-bench-sampled-helper-dedupe-rerun-20260520.log`; the earlier `temp/validation/micro-bench-sampled-helper-dedupe-20260520.log` caught the hash benchmark's pre-existing Buffer-vs-string direct-hash mismatch, which was fixed by using an ASCII string payload with the same byte count.
- Summary report compare/parity tests now share deterministic summary payload helpers in the existing summary report helper, using production hit-comparison/stat functions while keeping build-fixture coverage for the summary build/lock tests. Syntax, targeted ESLint, and focused runner validation for compare-memory, compare-sqlite, parity-sqlite, and parity-sqlite-fts passed in `temp/validation/summary-report-proof-followup-20260521.log`; the older timeout evidence in `temp/validation/summary-report-compare-helper-dedupe-20260520.log` is historical.
- Stage1 nested scheduler deadlock tests now share `runStage1NestedSchedulerProbe()` for fixture creation, timeout racing, and scheduler shutdown while preserving the queue-specific nested work and expected counter assertions in each test. Syntax and focused runner validation passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/stage1-nested-scheduler-probe-helper-dedupe-20260521.log`.
- Rust LSP workspace tests now share `runRustAnalyzerWorkspaceFixture()` for provider context construction, stub server wiring, metadata command arguments, cache policy, provider IDs, and server IDs while keeping scenario-specific workspace files, inputs, cache count checks, and diagnostics assertions local. Syntax and focused Rust LSP workspace validation passed with 6 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/rust-lsp-workspace-fixture-dedupe-20260521.log`.
- Historical/intermediate compact SQLite and CI artifact build tool display/logger slice: `createToolDisplayLogger()` was introduced for display-backed logger construction while preserving command-specific options, progress messages, artifact behavior, and failure handling. Syntax passed; direct help smokes for both commands passed in `temp/validation/tool-display-logger-helper-help-smokes-20260521.log`. The focused SQLite maintenance runner timeout in `temp/validation/tool-display-logger-helper-dedupe-20260521.log` and the artifact-export smoke failure in `temp/validation/tool-display-logger-helper-smokes-20260521.log` are retained only for auditability and are not current checkpoint proof. Current checkpoint proof is the later exact-current saved-report refresh with 0 still-current fragments. `jscpd` was not rerun for this post-baseline slice.
- Bench-language logging now reuses `createDisplayLoggerAdapter()` for display-backed `log`/`warn`/`error` routing and status `logLine` routing while keeping file writes, rotation, emergency sync closeout, disk-full detection, and history local to the benchmark logger. Syntax, targeted ESLint, focused bench logger validation, bench log closeout/emergency-close validation, and TUI display/progress validation passed in `temp/validation/p2-display-logger-adapter-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- MCP analysis handlers now share a handler-local observability envelope builder for risk explain, context pack, and risk delta while preserving tool-specific repo resolution, progress labels, error mapping, and payload context. Syntax, targeted ESLint, MCP schema/registry checks, risk explain/delta parity, context-pack parity, and API/MCP adapter validation passed in `temp/validation/mcp-analysis-observability-helper-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Compare-models and retrieval parity reporting now share `summarizeRetrievalHitComparison()` for top-N hit comparison summaries while preserving model-vs-model and memory-vs-SQLite report shapes, zero-hit parity semantics, and missing-list labels. Syntax, targeted ESLint, direct summary-helper validation, and diff checks passed in `temp/validation/retrieval-hit-comparison-summary-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Compare-models now consumes the shared `COMPARE_MODELS_OPTIONS` set while preserving command-local `-n`/`-q` aliases and all model, ANN, output, and cache-root behavior local. Syntax, targeted ESLint, capability/completion/helper validation, direct help smoke, and diff checks passed in `temp/validation/compare-models-options-adoption-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Tooling provider progress/preflight tests now share `provider-run-fixture.js` for virtual document/target setup and display-log capture while preserving provider registration, preflight behavior, metrics assertions, and progress-log assertions in each test. Syntax, targeted ESLint, focused provider validation, and diff checks passed in `temp/validation/tooling-provider-run-fixture-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Tooling install failure/missing-requirement exit-code tests now share `tooling-install-test-helper.js` for fixture root resolution, empty PATH simulation, test-environment preservation, JSON install invocation, and JSON payload parsing while preserving pyright failure and gopls missing-requirement assertions in each test. Syntax, targeted ESLint, focused install validation, and diff checks passed in `temp/validation/tooling-install-exitcode-helper-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- The extracted-prose persisted yield-profile test now reuses the existing fixture `findFileByName()` helper instead of carrying a local directory walker while preserving yield-profile artifact, fingerprint, skip, and reason-code assertions. Syntax, targeted ESLint, focused runner validation, and diff checks passed in `temp/validation/extracted-prose-find-file-helper-adoption-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- API context-pack route tests now share `context-pack-route-fixture.js` for minimal payload construction, response capture, validator construction, parse-body plumbing, and captured JSON parsing while preserving default-repo and workspace-without-repo assertions in each test. Syntax, targeted ESLint, focused API route validation, and diff checks passed in `temp/validation/api-context-pack-route-fixture-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- API index-route tests now share `invokeRouteWithMockResponse()` for route invocation boilerplate while preserving invalid-repo, forbidden-repo, oversized-body, and malformed-id assertions in each test. Syntax, targeted ESLint, focused index-route validation, and diff checks passed in `temp/validation/api-index-route-invocation-helper-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- LSIF, SCIP, and gtags ingest tests now share `assertMissingIngestInputFailsCleanly()` for missing-input CLI invocation, non-zero exit assertion, and unhandled stream-error hygiene while preserving format-specific fixture setup, escape-path assertions, and output assertions local. Syntax, targeted ESLint, focused ingest validation, and diff checks passed in `temp/validation/ingest-missing-input-helper-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Indexer-service CLI tests now share `createIndexerServiceCliFixture()` for temp-root, repo, queue, config, test-environment, CLI spawn, and JSON parse setup while preserving queue mutations, negative-exit assertions, repair state, and command-specific assertions local. Syntax, targeted ESLint, and diff checks passed in `temp/validation/indexer-service-cli-fixture-dedupe-20260521.log`; the historical queue-identity and repair CLI timeout caveats from that slice were later closed by split selector proof in `temp/validation/queue-identity-cli-split-validation-20260521.log`, repair runner proof in `temp/validation/repair-cli-split-validation-rerun-20260521.log`, and corrected repair ESLint proof in `temp/validation/repair-cli-split-eslint-rerun-20260521.log`. `jscpd` was not rerun for this post-baseline slice.
- Script-coverage harness and wiring tests now share `createScriptCoverageActionsFixture()` and `collectUnknownActionCovers()` for action fixture setup and unknown-cover detection while preserving report-state and stale executable-reference assertions local to the harness test. Syntax, targeted ESLint, focused script-coverage validation, and diff checks passed in `temp/validation/script-coverage-fixture-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Show-throughput compare and JSON contract tests now share `show-throughput-report-fixture.js` for benchmark payload construction, temp-root setup, payload writing, and command spawning while preserving compare-output and schema assertions local. Syntax, targeted ESLint, focused show-throughput validation, and diff checks passed in `temp/validation/show-throughput-report-fixture-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Git metadata fast-churn/no-history tests now share `git-meta-fixture.js` for README target setup, test-environment preservation, and SCM runner cleanup while preserving each fake command runner and metadata assertion local. Syntax, targeted ESLint, focused git metadata validation, and diff checks passed in `temp/validation/git-meta-fixture-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Bench-runner contract/utilization tests now share `bench-runner-fixture.js` for temp-root setup, test-environment application, fixture script writing, bench-runner spawning, nonzero output reporting, and JSON parsing while preserving metric and cap assertions local. Syntax, targeted ESLint, focused perf runner validation, and diff checks passed in `temp/validation/bench-runner-fixture-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Graph-relations atomicity/determinism tests now share `writeAndLoadRelationBenchGraphArtifacts()` for graph-relations artifact writes, piece collection, manifest construction, and strict JSON-array loading while preserving cache roots, fixture sizing, rollback checks, and determinism assertions local. Syntax, targeted ESLint, focused relations validation, and diff checks passed in `temp/validation/relation-artifact-fixture-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- The LSP VFS didOpen ordering test now reuses the existing stub-LSP collection fixture and JSONL parser while preserving the ordering assertions local. Syntax, targeted ESLint, focused LSP/VFS validation, and diff checks passed in `temp/validation/lsp-vfs-didopen-fixture-adoption-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- The VFS partial-LSP-open test now reuses the existing JSONL parser while preserving its two-document/one-target fixture and didOpen/documentSymbol count assertions local. Syntax, targeted ESLint, focused VFS/LSP validation, and diff checks passed in `temp/validation/partial-lsp-open-jsonl-parser-adoption-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Git blame/meta fast-nonzero backoff tests now share the git metadata fixture's README target setup, SCM runner restoration, and counting fatal-git runner while preserving blame-vs-log expected return values and backoff assertions local. Syntax, targeted ESLint, focused git validation, and diff checks passed in `temp/validation/git-fast-nonzero-fixture-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Architecture and suggest-tests renderers now share `appendReportFooterSections()` for truncation and warning footer emission while preserving renderer-specific sorting, body sections, and suggest-tests fidelity block position. Syntax, targeted ESLint, focused renderer/model validation, and diff checks passed in `temp/validation/retrieval-report-footer-helper-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- JSON fallback chunking now shares a file-local comma/end state transition helper for object and array frames while preserving the explicit stack parser, top-level key collection, primitive parsing, and malformed/trailing-comma behavior. Syntax, targeted ESLint, focused JSON/config-tree-sitter validation, and diff checks passed in `temp/validation/json-fallback-comma-helper-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Query-plan test helpers now derive config defaults and projected config-signature inputs from one key list while preserving query, argv, dict-size, cache-key, and build-plan behavior. Syntax, targeted ESLint, focused retrieval pipeline validation, and diff checks passed in `temp/validation/query-plan-helper-projection-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- Full and short retrieval formatters now share `alignTextColumns()` for ANSI-aware right-column wrapping while preserving each renderer's indent, wrap indent, trailing-newline, title, and timestamp behavior. Syntax, targeted ESLint, focused output/pipeline renderer validation, and diff checks passed in `temp/validation/retrieval-format-align-helper-dedupe-20260521.log`; `jscpd` was not rerun for this post-baseline slice.
- ANN candidate-set sizing, membership checks, array conversion, and numeric ID normalization now live in `src/retrieval/ann/candidate-set.js`, shared by LanceDB ranking and SQLite vector-extension query pushdown while preserving pushdown limits, fallback filtering, candidate-size buckets, and metric/fallback behavior. Syntax, targeted ESLint, direct helper probes, `retrieval/ann/lancedb`, `storage/sqlite/ann/sqlite-extension`, direct SQLite candidate-set coverage, and LanceDB runtime contracts passed in `temp/validation/ann-candidate-set-helper-20260520.log`.
- Retrieval top-k selection now shares the non-heap sort-entry projection in `src/retrieval/pipeline/topk.js` while preserving score/id/source-rank selector behavior, heap thresholds, stats reporting, and deterministic tie-breaking. Syntax, targeted ESLint, and the direct top-k contract matrix passed in `temp/validation/dedupe-candidate-batch-20260520.log`.
- Bench-language diagnostic count aggregation now lives in `tools/bench/language/diagnostics.js`, shared by canary metrics and verdict summaries for type and severity count maps. `tools/bench/language/diff.js` now shares the repeated aggregate-delta field construction for repo and language summaries. Syntax, targeted ESLint, bench diff, canary replay, live canary runner, and rollout-gate smoke validation passed in `temp/validation/dedupe-candidate-batch-20260520.log`.
- Index benchmark scripts now share `percentile()` through `tools/bench/shared.js`; the stale local copy in `scheduler-build` was removed and `scheduler-store-format`, `jsonl-offset-index`, and `scheduler-io-starvation` use the shared helper while measured operations and output fields stay local. Syntax, targeted ESLint, tiny scheduler I/O, JSONL offset, and scheduler-store-format smokes passed in `temp/validation/dedupe-candidate-batch-20260520.log`.
- LMDB and Tantivy index build tools now share CLI/display/log/warn/fail setup in `tools/build/index-tool-cli.js` while backend dependency checks, mode handling, artifact validation, task progress, and metadata writes remain local. The first combined log caught a missing `display` destructure in LMDB; the rerun passed syntax, targeted ESLint, help smokes, and `storage/lmdb/contract-matrix` in `temp/validation/native-index-tool-cli-display-rerun-20260520.log`.
- Shebang shell routing and segmented local relations tests now reuse the existing `tests/indexing/file-processor/file-processor-fixture.js` helpers for file-processor setup and scanned file entries while keeping each scenario's fixture files and relation assertions local. Syntax, targeted ESLint, and both direct tests passed in `temp/validation/file-processor-test-helper-adoption-20260520.log`.
- Nix and Starlark import collectors now share the balanced-delimiter cursor loop in `src/index/language-registry/import-collectors/balanced.js` while retaining separate comment/string/triple-quote lexical policies. Syntax, targeted ESLint, direct collector probes, language registry collectors, registry contracts, import cache contracts, and import-resolution language coverage passed in `temp/validation/nix-starlark-balanced-scanner-helper-20260520-rerun.log`; the first log includes a PowerShell quoting error in the inline probe before the same tests passed.

## Remaining Follow-Up Plan

Future duplicate-code work should proceed in small, reviewable slices after a new intentional audit refresh or a fresh concrete duplicate signal. Do not chase every clone in the saved report: the measured numeric baseline is now intentionally stale after follow-up reductions, and the exact-current saved-report refresh found 0 still-current fragments. Production and tooling candidates should be prioritized only when the extraction preserves ownership boundaries, improves a real maintenance path, and does not hide domain-specific behavior behind a weak shared abstraction.

The latest numeric report contains known-stale entries fixed after the audit: shared index build-stage normalization, collector-hint normalization, generated-counterpart/OpenAPI candidate sharing, runtime/service logging normalization, scan-profile empty mode construction, tree-sitter worker option/language gating, retrieval full/short formatter helpers, config-format tree-sitter metadata normalization and tree-sitter entry construction, config schema defaults traversal, map/isometric default sharing, LSP hover location-signature/requester sharing, map ISO static serving, safe-regex program-size policy simplification, SCM snapshot observation construction, shared merge run buffering, context-pack risk budget projection, dictionary max-token-length normalization, contract validator result shaping, stable-order tie-break sorting, map/isometric wireframe boost sharing, benchmark trailing-JSON parsing, graph-relations benchmark fixture/artifact-writer sharing, contract-drift balanced-block parsing, release-check surface projection, index-stats prefixed piece aggregation, map benchmark CLI option sharing, workspace existing-ancestor suffix reattachment, safe JSON read error shaping, build-state benchmark run initialization, worker-pool task error handling, retrieval hit-comparison metrics, language docmeta context matching, C-family docmeta projection sharing, language call/usage collector sharing, risk filter/model local helpers, risk CLI option-set sharing, compare-models option-set adoption, retrieval CLI invalid-request output formatting, map material glass/fog/opacity helpers, ANN legacy dense-vector payload materialization, retrieval report truncation/warning sections, graph output truncation/warning reuse, micro-bench sampled timing sharing, tool display/logger sharing, bench-language display logger routing, MCP analysis observability envelope sharing, ANN candidate-set sizing/membership normalization, retrieval top-k sort-entry projection, benchmark language diagnostics/diff helpers, index benchmark percentile sharing, native index build-tool CLI display sharing, file-processor test fixture adoption, Nix/Starlark balanced scanner cursor sharing, summary report compare fixture sharing, Stage1 nested scheduler probe fixture sharing, Rust LSP workspace fixture sharing, tooling provider run fixture sharing, and saved-report test/scenario fixture cleanup. Do not rework those families until a future intentional full audit refresh confirms whether any residual clone remains.

### Priority Order

| Priority | Candidate | Current signal | Default disposition |
| --- | --- | --- | --- |
| Done | `tools/api/router.js` `/search` and `/search/stream` request preparation/execution | 0 current jscpd hits in `tools/api/router.js` | Completed with route-local preparation and JSON execution helpers; keep SSE transport handling local. |
| Done | `tools/bench/index/chargram-postings.js` and `tools/bench/index/postings-guard.js` | 0 current jscpd hits in both scripts and their helper | Completed with benchmark-only fixture/setup utilities and shared bench CLI parsing. |
| Done | `src/shared/artifact-io/loaders/core-array-payload.js` sync/async source loading | 0 current jscpd hits in the loader | Completed with local materialized-source helpers and separate JSONL fallbacks. |
| Done | `tools/build/embeddings/hnsw.js` and `tools/build/embeddings/lancedb.js` | 0 current jscpd hits in both backends and `tools/build/embeddings/vector-source.js` | Completed with a narrow vector-source helper and backend-specific options. |
| Done | `tools/tooling/install-lua-language-server.js` and `tools/tooling/install-phpactor-phar.js` | 0 current jscpd hits in both installers and `tools/tooling/install-shared.js` | Completed with primitive installer helpers; package layout and platform rules remain local. |
| Done | `src/storage/sqlite/build/from-artifacts/token-ingest.js` chunk/stored-token ingest loops and artifact batch inserts | 0 current jscpd hits in `token-ingest.js` | Completed with local token batch/state/table-record helpers plus token-vocab and doc-length batch insert helpers. |
| Done | `src/retrieval/cli/resolve-run-config.js` and `src/retrieval/cli/run-search/plan-runner.js` | 0 current jscpd hits in both files | Completed with canonical key projection plus explicit plan-runner destructuring. |
| Done | `tools/config/inventory/scan.js` brace/value skipping scanners | 0 current jscpd hits in `tools/config/inventory/scan.js` | Completed with a local lexical state primitive and inventory sync validation. |
| Done | `src/index/snapshots/create.js` and `src/index/snapshots/freeze.js` | 0 current jscpd hits in create/freeze/support | Completed with snapshot-owned support helpers and existing registry-lock orchestration. |
| Done | `src/shared/bundle-io.js`, `src/shared/bundle-io-checksum.js`, and `src/shared/workers/bundle-transform-worker.js` patch/checksum construction | 0 current hits in the bundle IO/worker files | Completed with `src/shared/bundle-patch.js` and worker-safe checksum normalization; worker protocol shape stays local. |
| Done | `src/index/registry-lock.js` and `src/index/build/lock.js` release lifecycle | 0 current jscpd hits in the lock files | Completed with `src/index/lock-release.js`; acquisition, stale-lock, and lock-held diagnostics stay domain-owned. |
| Done | `src/shared/artifact-io/manifest-sources.js`, `src/shared/artifact-io/loaders/core.js`, and `src/storage/sqlite/build/from-artifacts/sources.js` source-dispatch clones | 0 current hits in these completed source/loader files | Completed with narrow source helpers and canonical columnar row inflation; residual artifact-loader internals are tracked separately below. |
| Done | Artifact-loader residuals in `graph.js`, `shared.js`, and `binary-columnar.js` | 0 current hits in all three target loader files | Completed with graph relation read-plan setup, shared columnar row context/building, and binary-columnar row-slice validation. |
| Done | `src/shared/subprocess/tracking-terminate.js` termination cleanup | 0 current hits in `tracking-terminate.js` | Completed with subprocess-local lifecycle helpers; timeout, signal, nested process, tree-kill, and diagnostic semantics stay owned by the subprocess module. |
| Done | `tools/index/report-artifacts.js`, `tools/reports/show-throughput/**`, and `tools/bench/language/metrics/regression.js` production residuals | 0 current hits in the production report/throughput target files and new helpers; one scan-profile production/test fixture overlap remains separately deferred | Completed with cache identity, build-root, numeric distribution, mode-total, and distribution-table helpers while preserving stdout/stderr and JSON contracts. |
| Done | `src/shared/json-stream/json-writers.js` and `src/shared/json-stream/jsonl-sharded.js` residual stream loops | 0 current hits in both residual JSON stream files | Completed with file-local finalization/abort and sharded-item helpers; backpressure, byte-budget, close/error, and shard-order behavior stay local. |
| Done | `src/shared/json-stream/streams.js`, `src/shared/artifact-io/json/read-jsonl-stream.js`, and `src/shared/artifact-io/manifest-sources.js` completed stream/source clones | 0 current hits in `streams.js`, `read-jsonl-stream.js`, and `manifest-sources.js` | Completed with local result/buffer/source helpers; residual JSON stream clones are separate files listed above. |
| Done | `src/retrieval/output/filters.js` and `src/retrieval/output/filters/meta.js` | 0 current hits in the output filter files | Completed with docmeta merge helpers while preserving standard and meta-v2 output contracts. |
| Done | `src/retrieval/federation/coordinator.js` internal response/cache handling | 0 current hits in `coordinator.js` | Completed with coordinator-local response assembly; cache key, redaction, and error handling remain local. |
| Done | Contract schema shape fragments | 0 current hits under `src/contracts/schemas/**` | Completed with named schema fragments only where the repeated object has one semantic meaning; USR validator report-shaping cleanup is tracked as its own completed row. |
| Done | USR matrix validator report and row-diagnostics families | 0 current hits under `src/contracts/validators/usr-matrix/**` | Completed with named report-shaping, row-diagnostics, and report-envelope helpers; operational/release readiness one-off blocked-status paths stay local. |
| Done | `src/shared/artifact-io/compression.js` and `src/shared/io/atomic-write.js` shared runtime/file-IO micro-slices | 0 current hits in both files | Completed with file-local compression candidate and atomic payload/target helpers; cleanup ordering, filesystem atomicity, checksum, and serialization behavior stay pinned. |
| Done | Build-state lock-owner formatter in `patch-queue.js` and `store.js` | 0 current hits in `patch-queue.js` and `store.js` | Completed with `src/index/build/build-state/store.js` exporting the shared formatter; persisted state shape and retry log formatting remain shared by build-state ownership only. |
| Done | `src/shared/io/replace-file.js`, `src/shared/lifecycle/registry.js`, and `src/shared/concurrency/run-with-queue.js` process-helper residuals | 0 current hits in all three files | Completed with file-local helpers only; error surfaces, cleanup ordering, signal behavior, and pending-drain diagnostics stay pinned. |
| Done | SQLite dense metadata expected-count resolution | 0 current hits in `src/storage/sqlite/utils.js` and `runner/sqlite-probes.js`; the old `incremental-update.js`/`sqlite-probes.js` clone is gone | Completed with a storage-local helper; count precedence, numeric coercion, and legacy vector array fallback stay unchanged. |
| Done | `src/shared/kill-tree/{windows,posix}.js` platform termination helpers | 0 current duplicate entries referencing `src/shared/kill-tree/**` | Completed with platform-local fallback/kill-state helpers; process discovery, delayed force-kill, signal, and taskkill semantics stay platform-owned. |
| Done | SQLite build telemetry and vector encoding diagnostics | 0 current hits in `src/storage/sqlite/build/{core,incremental-update,from-bundles}.js`, `src/storage/sqlite/build/incremental-update/update-phase.js`, and `src/storage/sqlite/vector.js` | Completed with shared table-stat recording and vector compatibility/warning helpers while preserving SQL/write ordering and warning behavior. |
| Done | Pyright provider fallback and path normalization | 0 current hits in `src/index/tooling/pyright-provider.js`, `src/index/tooling/pyright-planner.js`, `src/index/tooling/pyright-runtime-health.js`, and `src/index/tooling/workspace-model.js` | Completed with provider-local fallback result assembly and shared workspace-root normalization; quarantine and fidelity semantics stay provider-owned. |
| Done | VS Code search-contract option normalization | 0 current hits in `extensions/vscode/search-contract.js` | Completed with a VS Code-local option normalizer while keeping CLI-only and API-only mappings explicit. |
| Done | Sublime production command plumbing | 0 current hits in production Sublime command files and `tests/helpers/sublime/search_behavior.py`; Python residuals are test-helper only | Completed with Sublime-local view, symbol, search transport, index validation, and file/symbol lookup helpers; no cross-editor abstraction was introduced. |
| Done | Map call/usage edge construction | 0 current hits in `src/map/build-map/edges.js` | Completed with a map-local relation edge builder; edge type, source/target selection, member deduping, and interning remain explicit. |
| Done | Simple benchmark CLI parser family | 0 current hits in `tools/bench/shared.js` and `tools/bench/sqlite/jsonl-streaming.js` | Completed with `parseSimpleBenchArgs` for simple option parsing across index/SQLite/cache/embedding benches; measured operations remain local. |
| Done | Java/Kotlin/CSharp dotted call and usage collection plus C#/Java relation/dataflow/docmeta helpers | Shared helpers are in place; saved-baseline language lookalikes are conditional future-audit guidance | Completed with C-like comment stripping, dotted call/usage collection, return-type extraction, brace-delimited method relation assembly, common dataflow/throw fact helpers, and shared default docmeta projection in `src/lang/shared.js`; grammar and relation lookalikes require fresh live evidence before another extraction. |
| Done | VFS segment group construction | 0 current hits in `src/index/tooling/vfs/segments.js` | Completed with a VFS-local coalesced segment group factory; IDs, ordering, interning key, single-segment shape, and merge mutation behavior remain explicit. |
| Done | USR matrix baseline profile boilerplate | 0 current hits in `tools/usr/generate-usr-matrix-baselines/{datasets,builders}.mjs` | Completed with named capability-profile and framework profile helpers; framework-specific edge cases, languages, bridges, and hydration signals stay explicit. |
| Done | Editor package CLI flow and option parsing | 0 current hits in `tools/package-sublime.js`, `tools/package-vscode.js`, and `tools/tooling/editor-package-cli.js` | Completed with named package descriptors and a shared packaging runner; package-specific source/toolchain validation stays explicit in the descriptor. |
| Done | VS Code runtime test harness duplication | 0 current hits in `tests/tooling/vscode/{operator-runtime,results-explorer-runtime,workflow-runtime}.test.js` and `tests/tooling/vscode/runtime-test-helpers.js` | Completed with command-registration and results-explorer harness helpers while keeping assertions local. |
| Done | USR bench and gate item35-item40 helpers | 0 current hits in item35-item40 USR bench/gate entrypoints and their helpers | Completed with narrow script-family helpers; per-item measured operations, metric keys, thresholds, and output shapes remain local. |
| Done | CI LSP SLO gate test fixtures | 0 current hits in `tests/ci/tooling-lsp-slo-gate*.test.js` and `tests/helpers/tooling-lsp-slo-gate.js` | Completed with shared provider/temp-file/spawn helpers while keeping each assertion scenario explicit. |
| Done | Graph benchmark mechanics | 0 current hits in `tools/bench/graph/{context-pack-latency,neighborhood-index-dir,shared}.js` | Completed with timing, CLI, shared input loading, cache-reset, and summary helpers; measured operations and benchmark case structure remain local. |
| Done | Chunking dispatch line-scan skeleton | Focused validation complete; next full audit should verify the old heuristic/schema line-scan pair moved | Completed with `collectHeadingRows`; grammar-specific parser behavior stays local. |
| Done | Stage1 tree-sitter scheduler test helpers | Focused validation complete; next full audit should verify the self-duplicate Stage1 test family moved | Completed with local test helpers; scenario assertions stay explicit. |
| Done | Heuristic adapter usage scanners | 0 current hits in `src/index/language-registry/adapters/heuristic.js` | Completed with a file-local regex candidate scanner; language-family matchers and skip lists remain local. |
| Done | TypeScript heuristic function-like chunks | TypeScript self-duplicate reduced; remaining TypeScript hits are cross-language or AST/Babel chunker follow-ups | Completed with TypeScript-local function-like declaration helpers; type declaration behavior stays explicit. |
| Done | JavaScript/TypeScript relation call-detail helpers | JS/TS relation pair reduced to one residual call-site loop | Completed with `src/lang/js-ts/relations-shared.js` member-name, call-argument, and call-detail primitives; parser traversal stays local. |
| Done | Risk context-pack fixture helpers | `tests/context-pack/federated-risk-parity.test.js` no longer appears in the top pair list | Completed with shared risk fixture builders in `tests/helpers/risk-pack-eval.js`; scenario constants and assertions stay local. |
| Done | Watch queue test helpers | The old `retry-on-failed-cycle` / `update-queue-no-loss` pair is gone from the top pair list | Completed with `tests/indexing/watch/helpers.js`; failure/requeue assertions stay explicit. |
| Done | VFS benchmark primitives | VFS bench files are no longer in the top file list | Completed with `tools/bench/vfs/shared.js`; measured operations and result JSON stay script-local. |
| Done | Retrieval pipeline fixture helpers | Vector-only and score-breakdown tests no longer dominate the top file list | Completed with `tests/retrieval/helpers/search-pipeline-fixture.js`; per-test policy/error expectations stay local. |
| Done | Heavy-file Java/Swift test helper | Heavy-file Java/Swift pair no longer appears in the top pair list | Completed with `heavy-file-process-case-helper.js`; language-specific expectations stay local. |
| Done | Show-throughput scan test helper | Scan outcome/profile-preferred pair no longer appears in the top pair list | Completed with `show-throughput-scan-test-helpers.js`; stdout scenario assertions stay local. |
| Done | VS Code analysis-renderer compaction | `extensions/vscode/analysis-renderers.js` is down to 1 residual clone from 18 | Completed with extension-local primitives while preserving the self-contained CommonJS extension packaging boundary and display strings. |
| Done | SQLite partial bundle fallback tests | Target tests and `bundle-partial-fallback-helper.js` report 0 current duplicate hits | Completed with fixture/build/bundle mutation helpers; scenario-specific missing-chunk and missing-embedding assertions stay local. |
| Done | TUI observability supervisor fixture | Run-id path safety, session correlation, replay determinism, and `supervisor-fixture.js` report 0 current duplicate hits | Completed with a shared supervisor process/log fixture; each test keeps its own run-id, job, metadata, and replay assertions. |
| Done | Download-dicts test helper | Both download-dicts tests and `download-dicts-test-helper.js` report 0 current duplicate hits | Completed with shared HTTP fixture, subprocess runner, manifest read, and content assertions while keeping success and partial-failure expectations explicit. |
| Done | Retrieval CLI/LMDB index hydration | 0 current hits in `src/retrieval/{cli-index,lmdb-helpers,index-hydration}.js` | Completed with production `index-hydration` helpers for file-meta hydration, HNSW loading, vocabulary maps, and filter-index post-processing; filesystem and LMDB artifact resolution stay caller-owned. |
| Done | Filtered-minhash pipeline fixtures | 0 current hits in both filtered-minhash target tests | Completed with a retrieval pipeline helper while preserving candidate filtering and oversized fallback assertions. |
| Done | Retrieval explain/output render fixture | 0 current hits in the target confidence, vector-only-warning, relation-boost, and helper files | Completed with stable `renderSearchOutput` defaults and hit-state helpers; assertion payloads stay local. |
| Done | Retrieval backend/contract pipeline fixture reuse | Backend target tests have 0 current hits and `score-breakdown-contract-parity` is down to 1 residual | Completed by reusing the existing search pipeline fixture for alpha indexes and pipeline defaults while preserving routing/error assertions. |
| Done | Retrieval top-k sort projection | Production top-k non-heap sort paths share a file-local comparable-entry projector | Completed with `buildTopKSortEntry`/`createTopKItemComparator`; heap behavior, stats, score/id/rank selectors, and tie-break ordering stay unchanged. |
| Done | SQLite shard fixture setup | 0 current hits in `chunk-meta-streaming`, `fts-contentless-schema`, and `jsonl-streaming-matrix` | Completed with shared sharded `chunk_meta`, token postings, and manifest setup helpers; DB build assertions stay local. |
| Done | Language adapter residual helpers | `src/lang/{php,rust,ruby}.js` dropped out of the top file list; saved-baseline lower-volume Kotlin/C-like/Swift/tree-sitter lookalikes are conditional future-audit guidance | Completed with shared declaration normalization, default docmeta shaping, and matching helper reuse while grammar-specific behavior stays local. |
| Done | ANN fallback contract matrix fixture | `tests/retrieval/pipeline/ann-fallback-contract-matrix.test.js` no longer appears in the top file list | Completed with filtered-minhash and in-memory pipeline fixture reuse; policy assertions stay in the matrix. |
| Done | ANN candidate-set query helpers | LanceDB ranking and SQLite vector-extension query pushdown share candidate sizing, membership, array conversion, and numeric ID normalization through `src/retrieval/ann/candidate-set.js` | Completed with an ANN-local helper; pushdown limits, fallback filtering, size buckets, warnings, metric conversion, and SQLite temp-table behavior stay caller-owned. |
| Done | Workspace manifest contract matrix helper | `tests/workspace/manifest-contract-matrix.test.js` no longer appears in the top file list | Completed with file-local repo config/current-pointer/invalid-pointer helpers while preserving manifest scenario setup. |
| Done | Risk explanation contract fixture | Risk explanation self-clones and risk watch-step cross-file clones are removed from the top pair list | Completed with shared risk watch-step, minimal/full/capped model, provenance, summary, flow, and call-site fixture builders. |
| Done | Retrieval output stream/render fixture expansion | Diagnostics, raw query, JSON routing, human layout, stats, and JSON streaming output tests are out of the top pair list | Completed by extending the existing search-output fixture with stream capture and hit-state/render defaults. |
| Done | LSP stale-process restart harness | The reader/writer stale-process restart pair is gone from the top pair list | Completed with a tooling/LSP-local restart harness; reader-vs-writer close direction assertions stay explicit. |
| Done | SQLite incremental bundle DB fixture | The bundle mismatch/coverage and incremental profile/transaction setup clusters are reduced | Completed with a SQLite-local bundle DB fixture while preserving fallback and transaction-boundary assertions. |
| Done | Vector-only sparse cleanup fixture and sequencing fix | Vector-only cleanup tests share one write fixture and the product cleanup check now passes | Completed with a postings-local fixture plus immediate vector-only allowlist cleanup before lingering sparse-artifact validation. |
| Done | BM25 ranker self-duplicate helpers | The old `src/retrieval/rankers.js` self-duplicate pair is gone from the top pair list | Completed with ranker-local query-frequency, vocab-index, score-accumulation, and top-score finalization helpers; ranking semantics stay local to the ranker. |
| Done | SCM file-processor timeout/cache fixtures | `scm-runproc-queue-timeout.test.js` dropped out of the top file list | Completed with a file-processor-local SCM helper; timeout, cache, and snapshot assertions stay explicit in the target tests. |
| Done | Watch harness expansion | `tests/indexing/watch/shutdown.test.js` dropped out of the top file list | Completed by extending the existing watch helper for shutdown, atomicity, promotion, stability, and consistency scenarios while preserving failure/requeue assertions. |
| Done | Graph fixture helpers | The previous graph top files/pairs for witness paths, store/neighborhood, lazy load, CSR load, cache eviction, and count warnings are reduced | Completed with graph-local fixture helpers; graph-store, lazy artifact, and warning semantics stay explicit at the call sites. |
| Done | Ingest adapter JSONL/path/stats loops | LSIF/SCIP/ctags/gtags ingest path and stream loop hits are reduced | Completed with `tools/ingest/shared.js`; adapter payload interpretation, emitted record fields, and command invocation stay local. |
| Done | Saved-report test/scenario fixture cleanup | Top saved-report test-helper pairs through services plus relations/query-plan local duplicates are reduced; service golden validation timed out under the 30s rule | Completed with narrow helpers for tree-sitter `processFileCpu` setup, identity reconciliation drift fixtures, single-segment VFS manifests, vector-only postings write fixtures, stage1 nested scheduler queues, optional extracted-prose index bundles, document-extraction cache lookup/env setup, LSP stub collection, stage1 code-build subprocesses, service stage2/no-sqlite builds, relations artifact fixture setup, and query-plan input projection. Scenario assertions stay in test files; `services/advanced-surface-goldens` timed out at 30.3s and was not rerun. |
| Conditional | Index, storage, and build execution helpers | Current-process runtime-envelope setup, shard-census runtime cap normalization, worker-pool crash logging, import-resolution count/hotspot/stage shaping, shared build-stage normalization, generated-counterpart/OpenAPI candidate sharing, process-file watchdog numeric policy helpers, docs-search JSON fast-scan entry shaping, extracted-prose low-yield serializers, runtime/service logging normalization, scan-profile mode construction, and worker Node argv/heap parsing are complete; saved-baseline examples were smaller build execution/runtime overlaps outside those fixed families, but the exact-current refresh has 0 fragments | Revisit only if a future intentional full audit proves live overlap; refactor by execution contract, not by surface similarity. |
| Done | External tooling provider health and fallback assembly | Pyright provider/planner/runtime health, SourceKit marker/result shaping, LSP workspace environment-preflight result assembly, Go/Rust workspace partition check formatting, and preflight-language server/language matching are complete for the known current production residuals | Keep provider helpers narrow; if a future audit finds new provider residuals, preserve provider-specific quarantine, fingerprints, capture rules, and failure labels. |
| Conditional | CLI and navigation option parsing | Package entrypoint parsing, shared `--flag value` / `--flag=value` argv reading, shared child-exit semantics, `pairofcleats` workspace-build dispatch validation, risk CLI option-set sharing, compare-models option-set adoption, and tool display/logger sharing are complete; saved-baseline examples were command-specific setup outside the shared risk-filter/report option tail, compare-models option set, and display-backed logger primitive | Revisit only if a future intentional full audit proves live overlap; keep command-specific validation, help, dispatch, aliases, and machine-readable output local. |
| Conditional | Sublime and editor test-helper residuals | Production Sublime command files are clean; saved-baseline Python examples were in `tests/helpers/sublime/{analysis,index,map,operator}_behavior.py`, but they are not a current release blocker and require a future audit to prove live overlap | Extract only if a test helper makes behavior assertions clearer; keep command scenario setup readable. |
| Conditional | Native setup and release maintenance helpers | Native rebuild spawn-result/package-validation cleanup and release sorted-file walking are complete; saved-baseline examples were setup/release option or filesystem traversal residuals | Revisit only if a future intentional full audit proves live overlap; extract helpers only when cwd, env, stdio, ordering, and failure message text remain stable. |
| Done | Native index build-tool CLI display setup | LMDB and Tantivy build tools share CLI/display/log/warn/fail construction through `tools/build/index-tool-cli.js` | Completed with backend dependency checks and progress task behavior still local; LMDB contract coverage passed after the missing-display rerun. |
| Conditional | SCM/git metadata retry bookkeeping | Git meta-batch retry bookkeeping, shared file metadata normalization, and git/jj path enumeration are complete; saved-baseline SCM examples should be treated as lower-priority cache/prefetch/probe residuals until a future audit refresh proves live overlap | Share only identical retry/cache/path primitives; preserve timeout plans, diagnostics counters, command output handling, and cache keys. |
| Conditional | Retrieval operational helpers | CLI/LMDB hydration and federation list normalization are complete; saved-baseline operational examples were renderer-adjacent or artifact-resolution normalization | Revisit only if a future intentional full audit proves live overlap; keep filesystem artifact resolution separate from LMDB lookup and output rendering. |
| Conditional | Retrieval/integration output renderer families | VS Code renderer compaction, full/short formatter helper sharing, and hit-comparison report summary sharing are complete; saved-baseline examples included risk-explain model/output adapters, SARIF/context/suggest output adapters, architecture/suggest report overlap, and integration tooling context/impact helpers | Revisit only if a future intentional full audit proves live overlap; do not collapse product-specific human output surfaces or break VSIX packaging. |
| Conditional | Language and tree-sitter adapter lookalikes | Java/Kotlin/CSharp/PHP/Rust/Ruby/Shell helper sharing is in place; SQL scanner state handling, tree-sitter line/language-id setup, tree-sitter worker gating, TypeScript AST/Babel declaration sink sharing, C-like/Swift brace scanning, shared await/yield/throw dataflow fact collection, C-like type-body member iteration, C-family docmeta projection, and config-format tree-sitter metadata normalization are complete; saved-baseline examples were language-specific relation shaping and Nix/Starlark lexical scanner residuals with different grammar semantics | Revisit only if a future intentional full audit proves live overlap and a language-family helper preserves grammar-specific behavior with conformance proof. |
| Conditional | Benchmark and scenario script families | Simple parser, USR bench/gate, graph mechanics, VFS bench primitives, micro-bench sampled timing, index benchmark RNG/list-pick helpers, SQLite benchmark bundle fixtures, index streaming benchmark reporting, index throughput comparison helpers, benchmark language diagnostic/diff helpers, and index percentile sharing are complete; saved-baseline examples were benchmark scenario setup and scenario/test fixtures | Revisit only if a future intentional full audit proves live overlap; batch by benchmark family only when sharing does not change measured operations or log fields. |
| Conditional | Test harness families | VS Code runtime, CI LSP SLO fixture, Stage1 tree-sitter scheduler, risk context-pack fixture, watch queue, retrieval pipeline fixture, heavy-file Java/Swift, show-throughput scan, SQLite partial/incremental fallback, TUI observability, download-dicts, retrieval explain/output, filtered-minhash, ANN fallback, workspace manifest, LSP stale-process, vector-only postings, SQLite shard fixture, SCM file-processor, search-debug capture setup, watch expansion, graph fixture sharing, risk-delta manifest/pointer fixture cleanup, import-resolution matrix temp-root/cache-stat fixture cleanup, SourceKit/Rust preflight provider bootstrap fixtures, file-processor fixture adoption, summary report compare fixture sharing, Stage1 nested scheduler probe fixture sharing, Rust LSP workspace fixture sharing, tooling provider run fixture sharing, tooling install exit-code fixture sharing, and expanded VFS manifest writer fixture adoption are complete; saved-baseline residual examples such as provider workspace preflight, storage, and broad matrix scenario fixtures require a future audit to prove current high-value overlap | Extract test helpers only when scenario readability improves and assertion blocks stay explicit. |

### Latest Saved-Report Fixture Batch

Status:

- Completed focused cleanup on 2026-05-20 without rerunning `jscpd`.
- Passing logs: `temp/validation/tree-sitter-process-file-fixture-dedupe-20260520.log`, `temp/validation/20260520-182811-identity-reconciliation-direct-tests.log`, `temp/validation/vfs-fixture-dedup-direct-20260520-182854.log`, `temp/validation/vector-only-postings-fixture-adoption-20260520.log`, `temp/validation/stage1-nested-scheduler-fixture-dedupe-20260520.log`, `temp/validation/optional-extracted-prose-fixture-dedupe-20260520.log`, `temp/validation/extracted-prose-cache-fixture-dedupe-20260520.log`, `temp/validation/lsp-stub-collect-fixture-dedupe-rerun-20260520.log`, `temp/validation/stage1-code-build-fixture-dedupe-20260520.log`, `temp/validation/relations-fixture-atomicity-adoption-20260520.log`, and `temp/validation/query-plan-helper-projection-dedupe-20260520.log`.
- Historical service runner log: `temp/validation/service-stage2-build-fixture-dedupe-20260520.log`; `services/api-search-asof` passed at 29.6s, and `services/advanced-surface-goldens` timed out at 30.3s and was not rerun per test policy. This intermediate timeout is retained only as slice history, not current release proof; current release evidence uses the later passing as-of and production gates cited in `docs/roadmap-release-validation-evidence-20260521.md`.
- Failed/transient logs preserved for auditability: `temp/validation/lsp-stub-collect-fixture-dedupe-20260520.log`, `temp/validation/20260520-182744-identity-reconciliation-tests.log`, and `temp/validation/vfs-fixture-dedup-20260520-182815.log`.

### Done: 2026-05-20 Duplicate Batch 063611

Status:

- Completed on 2026-05-20.
- Full audit log: `temp/jscpd/audit-duplicates-20260520-063611.log`.
- Combined focused validation log: `temp/validation/dedupe-batch-combined-focused-20260520-063549.log`.
- Slice validation logs:
  - `temp/validation/rankers-bm25-helper-dedupe-20260520-063000.log`.
  - `temp/validation/ingest-adapter-dedupe-20260520-063459.log`.
  - `temp/validation/20260520-063422-scm-file-processor-jscpd-validation.log`.
  - `temp/validation/watch-duplicate-cluster-20260520-063214.log`.
  - `temp/validation/graph-duplicate-fixture-20260520-063208.log`.
- Combined focused validation passed with 32 tests, 0 failures, 0 timeouts, and 0 skipped tests.
- Full audit baseline moved from 544 clones / 9,810 duplicated lines / 109,375 duplicated tokens to 508 clones / 9,155 duplicated lines / 102,015 duplicated tokens.

Implementation files:

- BM25 ranker helpers: `src/retrieval/rankers.js`.
- Ingest adapter helpers: `tools/ingest/shared.js`, `tools/ingest/lsif.js`, `tools/ingest/scip.js`, `tools/ingest/ctags.js`, and `tools/ingest/gtags.js`.
- SCM file-processor fixtures: `tests/indexing/file-processor/scm-file-processor-test-helper.js`, `tests/indexing/file-processor/scm-runproc-queue-timeout.test.js`, `tests/indexing/file-processor/scm-annotate-fast-timeout.test.js`, `tests/indexing/file-processor/scm-meta-cache-shared-prose-lanes.test.js`, and `tests/indexing/file-processor/scm-file-meta-snapshot-fastpath.test.js`.
- Watch fixtures: `tests/indexing/watch/helpers.js`, `tests/indexing/watch/atomicity.test.js`, `tests/indexing/watch/shutdown.test.js`, `tests/indexing/watch/e2e-promotion.test.js`, `tests/indexing/watch/stability-requeue.test.js`, and `tests/indexing/watch/consistency-state.test.js`.
- Graph fixtures: `tests/graph/helpers/graph-fixtures.js`, `tests/graph/witness-path-lazy.test.js`, `tests/graph/edge-type-inclusion.test.js`, `tests/graph/filter-predicate-deterministic.test.js`, `tests/graph/store-and-neighborhood-contract-matrix.test.js`, `tests/graph/neighborhood-contract-matrix.test.js`, `tests/graph/store-csr-artifact-load.test.js`, `tests/graph/lazy-edge-load.test.js`, `tests/graph/store-cache-eviction.test.js`, and `tests/graph/count-mismatch-warning.test.js`.

Scope and constraints:

- Ranker extraction is file-local and preserves existing BM25 and fielded-BM25 scoring semantics.
- Ingest extraction owns only repo-relative path guarding, line-stream parsing, stat bumping, output backpressure, timeout normalization, and simple CLI argument splitting.
- Test fixture extraction keeps each scenario's assertions visible in the test file.
- The duplicate audit was run once after all batch edits, then the docs were updated from that single rebaseline.

Validation:

- `node --check` and ESLint passed over all changed production, tool, and test helper files in the combined focused validation.
- `node tests/run.js retrieval/ranking/keyword-downweighting retrieval/ranking/dense-ranking-contract-matrix indexing/fixtures/minhash-consistency indexing/tokenization/minhash-parity retrieval/pipeline/minhash-filtered-candidates-constrained retrieval/pipeline/minhash-filtered-oversized-fallback retrieval/pipeline/candidates-buffer-reuse retrieval/pipeline/retrieval-stage-checkpoints tooling/ingest/lsif/ingest tooling/ingest/scip/ingest tooling/ingest/ctags/ingest tooling/ingest/gtags/ingest indexing/file-processor/scm-runproc-queue-timeout indexing/file-processor/scm-annotate-fast-timeout indexing/file-processor/scm-meta-cache-shared-prose-lanes indexing/file-processor/scm-file-meta-snapshot-fastpath indexing/watch/atomicity indexing/watch/shutdown indexing/watch/e2e-promotion indexing/watch/stability-requeue indexing/watch/consistency-state indexing/watch/retry-on-failed-cycle indexing/watch/update-queue-no-loss graph/witness-path-lazy graph/edge-type-inclusion graph/filter-predicate-deterministic graph/store-and-neighborhood-contract-matrix graph/neighborhood-contract-matrix graph/store-csr-artifact-load graph/lazy-edge-load graph/store-cache-eviction graph/count-mismatch-warning --lane all --fail-fast --timeout-ms 30000` passed.
- `npm run audit:duplicates` passed once for the final batch audit and wrote `temp/jscpd/jscpd-report.json` plus `temp/jscpd/jscpd-report.md`.

### Done: 2026-05-20 Duplicate Batch 062142

Status:

- Completed on 2026-05-20.
- Full audit log: `temp/jscpd/audit-duplicates-20260520-062142.log`.
- Focused integration validation log: `temp/validation/dedupe-batch-focused-integration-20260520-062104.log`.
- Focused integration validation passed with 56 tests, 0 failures, 0 timeouts, and 0 skipped tests.
- Full audit baseline moved from 595 clones / 11,083 duplicated lines / 121,872 duplicated tokens to 544 clones / 9,810 duplicated lines / 109,375 duplicated tokens.

Implementation files:

- Language helpers: `src/lang/shared.js`, `src/lang/php.js`, `src/lang/rust.js`, `src/lang/ruby.js`, `src/lang/shell.js`, `src/lang/lua.js`, `src/lang/perl.js`, and `src/lang/go.js`.
- Retrieval pipeline fixtures: `tests/retrieval/pipeline/helpers/minhash-filtered-fixture.js`, `tests/retrieval/pipeline/helpers/in-memory-search-pipeline-fixture.js`, and `tests/retrieval/pipeline/ann-fallback-contract-matrix.test.js`.
- Workspace and risk/output fixtures: `tests/workspace/manifest-contract-matrix.test.js`, `tests/helpers/risk-explanation-fixtures.js`, `tests/retrieval/output/risk-explanation-contract-matrix.test.js`, `tests/retrieval/output/composite-context-pack-contract-matrix.test.js`, `tests/context-pack/risk-assembly.test.js`, and `tests/shared/contracts/analysis-schemas-validate.test.js`.
- Retrieval output stream/render helpers: `tests/retrieval/helpers/search-output-fixture.js`, `tests/retrieval/output/diagnostics-footer.test.js`, `tests/retrieval/output/stats-intent-miss-taxonomy.test.js`, `tests/retrieval/output/raw-query-header.test.js`, `tests/retrieval/output/json-diagnostics-routing.test.js`, `tests/retrieval/output/human-render-layout.test.js`, and `tests/retrieval/pipeline/json-streaming.test.js`.
- SQLite fixtures: `tests/storage/sqlite/helpers/build-fixture.js`, `tests/storage/sqlite/helpers/incremental-bundle-db-fixture.js`, storage shard target tests, and incremental fallback/profile target tests.
- LSP and postings fixtures: `tests/tooling/lsp/helpers/stale-process-restart-harness.js`, the stale-process restart tests, `tests/indexing/postings/helpers/vector-only-cleanup-fixture.js`, and the vector-only cleanup tests.
- Production cleanup fix: `src/index/build/artifacts/sparse-cleanup.js`.

Scope and constraints:

- Language extraction is limited to shared declaration/docmeta/helper contracts; grammar-specific scanners, relation semantics, and adapter fixtures stay language-owned.
- Test fixture extraction keeps assertions in the scenario files. Helpers own setup, defaults, stream capture, and reusable model inputs only.
- Vector-only sparse cleanup now removes allowlisted stale sparse artifacts immediately because the invariant check runs before final artifact cleanup commit.
- The duplicate audit was run once after all batch edits, then the docs were updated from that single rebaseline.

Validation:

- `node tests/run.js lang/php lang/rust lang/ruby lang/shell lang/contracts retrieval/pipeline/ann-fallback-contract-matrix retrieval/pipeline/minhash-filtered-candidates-constrained retrieval/pipeline/minhash-filtered-oversized-fallback workspace/manifest-contract-matrix storage/sqlite/token-text-materialization-skip storage/sqlite/build-memory-guard storage/sqlite/build-full-transaction storage/sqlite/chunk-meta-streaming storage/sqlite/fts-contentless-schema storage/sqlite/jsonl-streaming-gzip storage/sqlite/build-rowcount-contract storage/sqlite/build-bench-contract storage/sqlite/build-validate-auto-fast-path retrieval/output/risk-explanation-contract-matrix retrieval/output/composite-context-pack-contract-matrix context-pack/risk-assembly shared/contracts/analysis-schemas-validate retrieval/output/diagnostics-footer retrieval/output/stats-intent-miss-taxonomy retrieval/output/raw-query-header retrieval/output/json-diagnostics-routing retrieval/output/human-render-layout retrieval/pipeline/json-streaming tooling/lsp/reader-closed-restart-reaps-stale-process tooling/lsp/writer-closed-restart-reaps-stale-process storage/sqlite/incremental/bundle-count-mismatch-fallback storage/sqlite/incremental/bundle-coverage-metadata-fallback storage/sqlite/incremental-memory-profile storage/sqlite/incremental-transaction-boundary indexing/postings/vector-only-cleanup-allowlist-safety indexing/postings/vector-only-switching-cleans-stale-sparse --lane all --fail-fast --timeout-ms 30000` passed.
- `npm run audit:duplicates` passed once for the final batch audit and wrote `temp/jscpd/jscpd-report.json` plus `temp/jscpd/jscpd-report.md`.

### Done: 2026-05-20 Duplicate Batch 055715

Status:

- Completed on 2026-05-20.
- Full audit log: `temp/jscpd/audit-duplicates-20260520-055715.log`.
- Integration validation log: `temp/validation/batch-duplicate-reduction-integration-20260520-055629.log`.
- Integration validation passed with 37 tests, 0 failures, 0 timeouts, and 0 skipped tests.
- Full audit baseline moved from 635 clones / 12,083 duplicated lines / 133,266 duplicated tokens to 595 clones / 11,083 duplicated lines / 121,872 duplicated tokens.

Implementation files:

- Production retrieval hydration: `src/retrieval/index-hydration.js`, `src/retrieval/cli-index.js`, and `src/retrieval/lmdb-helpers.js`.
- Language helpers: `src/lang/shared.js`, `src/lang/csharp.js`, and `src/lang/java.js`.
- Graph benchmarks: `tools/bench/graph/shared.js`, `tools/bench/graph/context-pack-latency.js`, and `tools/bench/graph/neighborhood-index-dir.js`.
- Retrieval test fixtures: `tests/retrieval/pipeline/helpers/minhash-filtered-fixture.js`, `tests/retrieval/helpers/search-output-fixture.js`, `tests/retrieval/helpers/search-pipeline-fixture.js`, and their target tests.
- SQLite fixture helpers: `tests/storage/sqlite/helpers/build-fixture.js`, `tests/storage/sqlite/helpers/jsonl-streaming-matrix.js`, `tests/storage/sqlite/chunk-meta-streaming.test.js`, and `tests/storage/sqlite/fts-contentless-schema.test.js`.

Scope and constraints:

- Retrieval hydration shares only post-load artifact hydration behavior. Filesystem artifact lookup remains in `cli-index.js`; LMDB key lookup remains in `lmdb-helpers.js`.
- C# and Java share return-type extraction, brace-delimited relation assembly, and common dataflow/throw facts while grammar, docmeta, attributes, await/yield, and language-specific control-flow behavior stay local.
- Graph benchmark helpers share input loading, CLI parsing, timing summaries, and traversal cache cleanup while measured operations and JSON result shapes remain entrypoint-local.
- Test fixtures were extracted only where the helper name made the behavior clearer; assertion blocks and scenario-specific expectations remain in the tests.
- SQLite shard fixture helpers preserve sharded JSONL writing, token posting metadata, manifest shape, and DB build assertions without introducing whole-file materialization.

Validation:

- `node --check` over every touched production, tool, and test helper file passed.
- `npx eslint --fix` over the touched files passed.
- `node tests/run.js retrieval/index-hydration-contract retrieval/filters/filter-index-artifact storage/lmdb/contract-matrix lang/csharp lang/java lang/contracts retrieval/pipeline/minhash-filtered-candidates-constrained retrieval/pipeline/minhash-filtered-oversized-fallback retrieval/explain/confidence-surface-contract retrieval/output/explain-vector-only-warnings retrieval/explain-includes-relation-boost retrieval/backend/fts-missing-table-fallback retrieval/backend/search-routing-policy retrieval/contracts/score-breakdown-contract-parity storage/sqlite/chunk-meta-streaming storage/sqlite/fts-contentless-schema storage/sqlite/jsonl-streaming-gzip storage/sqlite/build-rowcount-contract storage/sqlite/build-bench-contract storage/sqlite/build-validate-auto-fast-path --lane all --fail-fast --timeout-ms 30000` passed.
- `npm run audit:duplicates` passed once for the final batch audit and wrote `temp/jscpd/jscpd-report.json` plus `temp/jscpd/jscpd-report.md`.

### Done: API Search Route Preparation And JSON Execution

Status:

- Completed on 2026-05-20.
- Implementation files: `tools/api/router.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in `tools/api/router.js`.
- Targeted validation passed:
  - `node --check tools/api/router.js`
  - `node tests/run.js services/api/repo-authorization --lane=all --timeout-ms 30000`
  - `node tests/run.js services/api/search-contract-matrix --lane=all --timeout-ms 30000`
  - `node tests/run.js services/api/server-stream --lane=all --timeout-ms 30000`

Scope:

- Candidate spans covered `tools/api/router.js` around the `/search` GET route, `/search/stream` POST route, and `/search` POST route.
- The shared portion is request observability headers, abort controller setup, GET query payload or POST JSON body parsing, payload validation, repo resolution, `buildSearchParams`, and JSON search execution/error response handling.
- The route-specific portion is still the SSE transport behavior: start/progress/result/done/error events and stream closed checks for `/search/stream`.

Extraction strategy:

- `prepareSearchRequest(...)` remains route-local in `tools/api/router.js`.
- It returns `{ ok: true, requestObservability, responseHeaders, controller, repoPath, searchParams }` or `{ ok: false }` after sending validation/repo/search-param errors.
- It accepts a `readPayload` callback for GET query payloads and otherwise uses `parseJsonBodyOrSendError` for POST body payloads.
- It registers `req.on('aborted')`, `res.on('close')`, and `res.on('error')` against the returned controller.
- `runPreparedSearch(...)` centralizes cache refresh, observability child construction, and the core `search(...)` call.
- `sendPreparedJsonSearch(...)` centralizes JSON success, no-index, and internal-error responses while preserving the prior POST abort-catch behavior through an explicit option.

Hazards:

- `/search/stream` still creates the SSE responder before parsing the body so the response headers include observability and CORS data consistently. Preserve that order.
- `/search/stream` still treats `controller.signal.aborted || sse.isClosed()` differently from JSON search routes. Do not merge the SSE catch block into the JSON responder.
- `isNoIndexError` maps to HTTP 409 for JSON but to an SSE `error` event for streaming. This is not a common response path.
- `payload?.repoPath || payload?.repo` must remain the repo selector; changing precedence would alter API behavior.

Acceptance tests:

- Keep the targeted API/service tests above green after future router edits.
- Re-run `npm run audit:duplicates` after future route changes and confirm `tools/api/router.js` remains at 0 duplicate hits.

Performance and quality constraints:

- The helper must not read the request body more than once.
- It must allocate only one `AbortController` per request and must not add timers.
- It must not introduce a dependency from `tools/api/router.js` to a broader shared route framework.
- The final route bodies should remain readable enough that streaming and non-streaming behavior can be audited independently.

### Done: Index Benchmark Setup

Status:

- Completed on 2026-05-20.
- Implementation files: `tools/bench/index/shared-postings-bench.js`, `tools/bench/shared.js`, `tools/bench/index/chargram-postings.js`, and `tools/bench/index/postings-guard.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in the two scripts and both helpers.
- Targeted validation passed:
  - `node --check tools/bench/shared.js`
  - `node --check tools/bench/index/shared-postings-bench.js`
  - `node tests/run.js indexing/postings/chargram-bench-contract --lane=all --timeout-ms 30000`
  - `node tools/bench/index/chargram-postings.js --vocab 100 --docs 25 --postings 2 --spill 50 --mode compare`
  - `node tools/bench/index/postings-guard.js --vocab 100 --docs 25 --postings 2 --spill 50 --mode compare`

Scope:

- Candidate spans: `tools/bench/index/chargram-postings.js` and `tools/bench/index/postings-guard.js`.
- The shared portion is CLI argument parsing, benchmark cache directory preparation, deterministic `triPost` fixture construction, chunk/doc-length fixture construction, `buildPostings` invocation, duration/heap measurement, throughput formatting, and compare-mode bookkeeping.
- The scenario-specific portion is token naming, rolling-hash support, default bench root name, result metadata, stats formatting, and any benchmark-specific pass/fail interpretation.

Extraction strategy:

- `tools/bench/index/shared-postings-bench.js` exports `prepareBenchRoot`, `buildTriPostFixture`, `buildChunkMetaFixture`, `runPostingsBenchOnce`, `calculateThroughput`, and `formatHeapDeltaMb`.
- `tools/bench/shared.js` owns generic benchmark `parseBenchArgs` and `resolveCompareMode` via the repo's existing shared CLI parser.
- `buildTriPostFixture` should accept a `tokenForIndex` callback so `chargram-postings.js` can keep rolling-hash token generation while `postings-guard.js` keeps `cg-${...}` tokens.
- `runPostingsBenchOnce` should accept `postingsConfigOverrides`, `benchRoot`, `label`, `vocabSize`, `docs`, `postingsPerToken`, and optional `resultExtra` callback.
- Keep each script's default values and console output stable unless there is a deliberate benchmark-output migration note.

Hazards:

- Bench scripts are often consumed by humans and CI log scraping; output field names and ordering should not drift casually.
- Shared fixture code must not accidentally reuse mutable `Map` instances between baseline/current runs.
- Rolling-hash mode in `chargram-postings.js` is not generic fixture behavior; it belongs behind a script-provided token callback.
- Cache cleanup must remain scoped to `.benchCache/<script-name>/<label>` and must not remove the parent `.benchCache` directory.

Acceptance tests:

- Keep both tiny deterministic compare commands green after future benchmark changes.
- Re-run baseline/current mode checks if output branching changes.
- Run `npm run audit:duplicates` and confirm the postings benchmark scripts/helpers remain at 0 duplicate hits.

Performance and quality constraints:

- The helper must preserve streaming memory behavior: do not materialize extra copies of postings beyond the existing `Map` fixture.
- Do not add randomness to fixture generation. Existing deterministic base `(i * 131) % docs` behavior should remain unless a benchmark owner explicitly changes it.
- Keep benchmark helpers under `tools/bench/index/`; these are not production indexing APIs.

### Done: Vector Artifact Source Discovery

Status:

- Completed on 2026-05-20.
- Implementation files: `tools/build/embeddings/vector-source.js`, `tools/build/embeddings/hnsw.js`, and `tools/build/embeddings/lancedb.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in all three scoped files.
- Targeted validation passed:
  - `node --check tools/build/embeddings/vector-source.js`
  - `node --check tools/build/embeddings/hnsw.js`
  - `node --check tools/build/embeddings/lancedb.js`
  - `node tests/run.js indexing/embeddings/vector-source --lane=all --timeout-ms 30000`
  - `node tests/run.js indexing/embeddings/manifest-pieces --lane=all --timeout-ms 30000`
  - `node tests/run.js retrieval/ann/hnsw-runtime-contract-matrix --lane=all --timeout-ms 30000`

Scope:

- Candidate spans: `tools/build/embeddings/hnsw.js` `resolveVectorsSource` support helpers and `tools/build/embeddings/lancedb.js` `resolveVectorsSource`.
- The shared behavior is sharded dense-vector metadata detection, shard-only manifest construction, shard count resolution, JSON/JSONL artifact row loading, and fallback to monolithic vector arrays.
- HNSW has additional alias/canonical-base handling for `_uint8`, `_f32`, `_float32`, `_fp32`, and manifest names; LanceDB currently checks only the provided base name.

Extraction strategy:

- Create a narrow helper under `tools/build/embeddings/vector-source.js` only if both backends can call it without changing supported input names.
- Export `buildShardOnlyManifest`, `resolveShardCount`, `resolveArtifactBaseCandidates`, and `resolveVectorsSource`.
- Let callers pass backend-specific options: `aliasNames`, `allowManifestLookup`, `materializeRows`, `traceLabel`, and `fallbackVectorKeys`.
- Preserve HNSW's manifest alias handling and LanceDB's current direct-meta behavior unless tests intentionally expand LanceDB support.
- Keep backend-specific vector normalization, isolate-child payloads, and table/index creation in the backend files.

Hazards:

- HNSW isolate workers may receive a base artifact hint that is absent from global `pieces/manifest.json`; a common helper must still synthesize a manifest from sharded metadata.
- LanceDB isolation and optional dependency loading have different failure behavior from HNSW; shared source discovery must not swallow errors that backend code currently reports.
- Dense vectors may be quantized `uint8` or float arrays; source discovery should not dequantize or normalize values.
- Loading with `materialize: true` can be memory-heavy. Do not change materialization semantics in a duplication-only refactor.

Acceptance tests:

- Add or run targeted embedding artifact tests covering sharded meta, monolithic JSON vectors, `_uint8` alias lookup, and missing/malformed meta fallback for both backends.
- Run existing embedding/build tests in the relevant lane. If no narrow lane exists, run `node tests/run.js --lane storage` or the closest embedding scripts and stop individual tests over 30 seconds.
- Run `npm run audit:duplicates` and confirm the HNSW/LanceDB clone is removed without new clones in the helper.

Performance and quality constraints:

- Do not add extra full-file reads. Manifest and meta should be read at most once per candidate base.
- Do not materialize rows earlier than current code does.
- Preserve `Number.POSITIVE_INFINITY` byte-budget behavior where the current backend intentionally uses it.
- Keep helper API explicit rather than accepting large backend config objects.

### Done: Tool Installer Primitives

Status:

- Completed on 2026-05-20.
- Implementation files: `tools/tooling/install-shared.js`, `tools/tooling/install-lua-language-server.js`, and `tools/tooling/install-phpactor-phar.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in all three scoped files.
- Targeted validation passed:
  - `node --check tools/tooling/install-shared.js`
  - `node --check tools/tooling/install-lua-language-server.js`
  - `node --check tools/tooling/install-phpactor-phar.js`
  - `node tests/run.js tooling/install/install-shared-primitives --lane=all --timeout-ms 30000`
  - `node tests/run.js tooling/install/lua-language-server-install --lane=all --timeout-ms 30000`
  - `node tests/run.js tooling/install/install-phpactor-phar-network-guards --lane=all --timeout-ms 30000`

Scope:

- Candidate spans: `tools/tooling/install-lua-language-server.js` and `tools/tooling/install-phpactor-phar.js`.
- The shared behavior is integer option normalization, retry sleep/jitter, timeout abort signal creation, install error shape, checksum normalization, SHA-256 calculation, retryable HTTP status classification, download buffer handling, and JSON report writing where applicable.
- The package-specific behavior is LuaLS release asset selection, archive extraction/layout validation, PHAR path/bin-dir behavior, checksum requirement policy, and tool-specific user messages.

Extraction strategy:

- Add the chosen helper owner, `tools/tooling/install-shared.js`.
- Export primitives, not a generic installer framework: `toInt`, `sleep`, `jitterForAttempt`, `withTimeoutSignal`, `createInstallError`, `normalizeChecksum`, `computeSha256`, `isRetryableHttpStatus`, `downloadToBuffer`, and `writeInstallReport`.
- Make `downloadToBuffer` accept `{ url, timeoutMs, label, createErrorMessage }` so package-specific error text remains local.
- Keep CLI option definitions in each installer. Shared CLI schemas would hide meaningful differences between LuaLS and PHPActor.

Hazards:

- LuaLS archive extraction and platform/arch resolution are package semantics, not shared installer semantics.
- PHPActor PHAR install may require different checksum/report behavior than LuaLS release assets.
- Retry jitter is deterministic today; replacing it with random jitter would make tests/logs less stable.
- Timeout cleanup must always clear the timer after fetch success or failure.

Acceptance tests:

- Run installer unit tests or targeted scripts that mock fetch/timeouts/checksums if present.
- Add tests for `withTimeoutSignal` cleanup, deterministic jitter, retryable status classification, and checksum mismatch error shape if no coverage exists.
- Run both installers in dry-run/mock mode if such mode exists; otherwise avoid live network as part of a duplication-only refactor.

Performance and quality constraints:

- Do not add dependencies or child processes.
- Do not change default timeout/retry values.
- Do not convert package-specific scripts into one generic command.
- Error `reason`, `retryable`, `statusCode`, and `cause` properties must remain stable for callers/tests.

### Done: Core Array Payload Loader

Status:

- Completed on 2026-05-20.
- Implementation file: `src/shared/artifact-io/loaders/core-array-payload.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in the loader.
- Targeted validation passed:
  - `node --check src/shared/artifact-io/loaders/core-array-payload.js`
  - `node tests/run.js shared/artifact-io/format-parity --lane=all --timeout-ms 30000`
  - `node tests/run.js shared/artifact-io/loader-fallbacks --lane=all --timeout-ms 30000`
  - `node tests/run.js shared/artifact-io/spec-contract --lane=all --timeout-ms 30000`

Scope:

- Candidate spans: `src/shared/artifact-io/loaders/core-array-payload.js` async and sync `loadArrayPayloadFromSources` implementations.
- The duplicate logic is format dispatch for `json`, `columnar`, and `binary-columnar` sources. The JSONL fallback differs because async uses `readJsonLinesArray` over all paths and sync loops each path with `readJsonLinesArraySync`.

Extraction strategy:

- The loader now uses small local helpers in the same file: `loadJsonArraySources`, `loadColumnarSources`, `loadBinaryColumnarSources`, and `loadMaterializedArrayPayloadFromSources`.
- Avoid a clever async/sync abstraction that passes function pointers through one generic loader if it makes stack traces or error messages harder to read.
- Keep `createLoaderError('ERR_ARTIFACT_INVALID', ...)` messages unchanged.
- Keep `appendRows` as the common append path so row order remains stable.

Hazards:

- Async and sync JSONL loading intentionally differ in call shape and concurrency support.
- Binary-columnar budget enforcement is security/performance relevant; `enforceBinaryDataBudget` must retain its default and propagation.
- `manifest`, `strict`, `requiredKeys`, and `validationMode` are contract inputs and must not be dropped from any path.

Acceptance tests:

- Keep artifact IO loader tests covering JSON, JSONL, columnar, binary-columnar, invalid payloads, required-key validation, and sync/async parity green after future loader edits.
- Re-run `npm run audit:duplicates` and confirm the loader remains at 0 duplicate hits.

Performance and quality constraints:

- Preserve streaming/concurrency behavior for JSONL.
- Do not add a second output array or extra row copy beyond existing `appendRows`.
- Do not read JSON sources twice for validation.

### Done: SQLite Chunk/Stored-Token Ingest

Status:

- Completed on 2026-05-20 for the `ingestTokenIndexFromChunks` / `ingestTokenIndexFromStoredChunks` clone.
- Implementation files: `src/storage/sqlite/build/from-artifacts/token-ingest.js` and `tests/storage/sqlite/token-ingest-stored-chunks-fallback.test.js`.
- `npm run audit:duplicates` confirms the original chunk/stored-token clone is gone.
- At the time of this slice, separate artifact direct/sharded batch insert loops were noted at spans `337-365 <-> 193-223` and `405-419 <-> 128-142`. The later exact-current saved-report refresh found 0 still-current fragments, so this note is historical context rather than open checkpoint work.
- Targeted validation passed:
  - `node --check src/storage/sqlite/build/from-artifacts/token-ingest.js`
  - `node --check tests/storage/sqlite/token-ingest-stored-chunks-fallback.test.js`
  - `node tests/run.js storage/sqlite/token-ingest-stored-chunks-fallback --lane=all --timeout-ms 30000`
  - `node tests/run.js storage/sqlite/token-ingest-stored-chunks-fallback --lane=all --timeout-ms 30000`

Scope:

- Candidate spans: `src/storage/sqlite/build/from-artifacts/token-ingest.js` `ingestTokenIndexFromChunks` and `ingestTokenIndexFromStoredChunks`.
- The shared behavior is token ID assignment, token lookup cache trimming, frequency calculation, postings accumulation by document, insert statement calls, row counters, and table/batch metrics.
- The source-specific behavior is how chunks are iterated, how document IDs are resolved, and how stored JSON token arrays are parsed.

Extraction strategy:

- Keep the helper local to `token-ingest.js`.
- Extract a function such as `ingestTokenBatch({ batch, targetMode, getDocId, getTokens })` that performs the common per-entry ingest inside the existing transaction.
- Keep outer batching separate: array chunks use index-based batching, stored chunks use SQL paging by `id`.
- Keep `parseTokens` local to the stored-chunks path or pass it through `getTokens`.

Hazards:

- Token IDs are assigned sequentially per target mode; moving state into a helper must not reset `nextTokenId` per batch.
- `postingsByDoc` is intentionally transaction-local; broadening its lifetime could increase memory.
- Stored chunks skip invalid IDs and return `false` if no rows are seen. Preserve that fallback contract.
- Cache trimming warning should emit once per ingest path, not once per batch.

Acceptance tests:

- Run sqlite build/from-artifacts tests that cover token vocab, token postings, doc lengths, fallback from artifacts to stored chunks, and incremental build behavior.
- Include a fixture with empty token arrays and invalid stored token JSON.
- Re-run `npm run audit:duplicates` and confirm this internal clone is reduced.

Performance and quality constraints:

- Do not increase transaction size beyond `resolvedBatchSize`.
- Do not retain all stored chunk rows in memory.
- Do not replace `Map` lookups with SQL lookups in this refactor.
- Keep batch metric names unchanged.

### Done: Retrieval Run Config Field Lists

Status:

- Completed on 2026-05-20.
- Implementation files: `src/retrieval/cli/resolve-run-config.js` and `tests/retrieval/cli/run-config-contract.test.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in `src/retrieval/cli/resolve-run-config.js` and `src/retrieval/cli/run-search/plan-runner.js`.
- Targeted validation passed:
  - `node --check src/retrieval/cli/resolve-run-config.js`
  - `node --check tests/retrieval/cli/run-config-contract.test.js`
  - `node tests/run.js retrieval/cli/run-config-contract --lane=all --timeout-ms 30000`
  - `node tests/run.js retrieval/cli/run-search-module-load --lane=all --timeout-ms 30000`

Scope:

- Candidate spans: `src/retrieval/cli/resolve-run-config.js` and `src/retrieval/cli/run-search/plan-runner.js`.
- The duplicate signal is mostly the long list of run-config fields returned by `resolveRunConfig` and destructured by the plan runner.

Extraction strategy:

- First decide whether this is worth changing. A duplicated explicit field list can be acceptable when it acts as a reviewable API contract.
- If changed, export a `RUN_CONFIG_KEYS` array from a retrieval CLI module and use it in focused places for validation, docs, or default projection.
- Do not replace the plan runner's destructuring with repeated `runConfig.foo` accesses unless readability improves.
- Consider grouping stable sub-objects in a future behavior change, but do not do it as a duplicate-code-only pass.

Hazards:

- This clone is contract-shaped rather than algorithm-shaped. Removing it can make future option additions harder to review.
- Score-mode overrides intentionally rewrite ANN/blend/RRF values in `resolveRunConfig`; the runner should consume resolved values only.
- CLI help, explain output, and search planning may rely on exact key names.

Acceptance tests:

- Run retrieval CLI tests for sparse/dense/hybrid score modes, ANN flags, cache options, relation/symbol boosts, field weights, explain tiers, and invalid score-mode errors.
- Add a test that every key in `RUN_CONFIG_KEYS` exists in the resolved config if a canonical key list is introduced.

Performance and quality constraints:

- The solution should be zero-cost at query runtime or limited to module initialization.
- Do not introduce dynamic proxies or reflective getters in the hot search path.
- Prefer explicit field access in the runner for values used in performance-sensitive search planning.

### Done: Config Inventory Scanner

Status:

- Completed on 2026-05-20.
- Implementation file: `tools/config/inventory/scan.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in `tools/config/inventory/scan.js`.
- Targeted validation passed:
  - `node --check tools/config/inventory/scan.js`
  - `node tests/run.js tooling/config-inventory/schema-scan tooling/config-inventory/report-format tooling/config-inventory/inventory-sync --jobs 1 --timeout-ms 30000`

Scope:

- Candidate spans: `tools/config/inventory/scan.js` `findMatchingBrace` and nested value skipping logic.
- The shared behavior is walking JavaScript-like text while respecting strings, escapes, line comments, block comments, and balanced braces/brackets/parens.

Extraction strategy:

- Add a local scanner helper in `tools/config/inventory/scan.js`, such as `walkCodeText(source, startIndex, handlers)`, or a tiny state object that advances to the next structural delimiter.
- Keep this helper tool-local unless another production parser needs it. This is generated inventory tooling, not a general JavaScript parser.
- Preserve current tolerance for malformed snippets; inventory scanning should keep best-effort behavior instead of throwing on every syntax issue.

Hazards:

- Template literals are treated as strings, not parsed JavaScript template expressions. A refactor must preserve current behavior unless a parser upgrade is explicitly scoped.
- Comment skipping and escape handling are easy to subtly regress, which can reorder generated command inventories.
- The tool likely values stability more than parser completeness.

Acceptance tests:

- Run inventory scan generation and compare `docs/tooling/script-inventory.json` plus `docs/guides/commands.md` against the pre-refactor output.
- Include examples with nested option objects, arrays, template literals, escaped quotes, line comments, and block comments.
- Re-run `npm run audit:duplicates` and confirm this internal clone is removed or reduced.

Performance and quality constraints:

- Keep scanner complexity linear in source length.
- Do not add a full parser dependency for this narrow duplicate.
- Avoid repeated substring allocation inside tight scanner loops.

### Done: Snapshot Retention And Lock Conflict Helpers

Status:

- Completed on 2026-05-20.
- Implementation files: `src/index/snapshots/support.js`, `src/index/snapshots/create.js`, and `src/index/snapshots/freeze.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in all three scoped files.
- Targeted validation passed:
  - `node --check src/index/snapshots/support.js`
  - `node --check src/index/snapshots/create.js`
  - `node --check src/index/snapshots/freeze.js`
  - `node tests/run.js services/snapshot-core-contract-matrix --lane=all --timeout-ms 30000`
  - `node tests/run.js services/snapshot-retention-governance --lane=all --timeout-ms 30000`
  - `node tests/run.js shared/snapshots-registry --lane=all --timeout-ms 30000`

Scope:

- Candidate spans: `src/index/snapshots/create.js` and `src/index/snapshots/freeze.js`.
- The shared behavior is retention-tier normalization, default retention reason inference, and snapshot lock-conflict payload construction.

Extraction strategy:

- Prefer extending `src/index/registry-support.js` or adding a snapshot-specific support module if one already owns snapshot registry semantics.
- Export `normalizeSnapshotRetentionTier`, `buildSnapshotRetention`, and `buildSnapshotLockConflict`.
- Keep `RETENTION_TIERS`, `invalidRequest`, `queueError`, `readRegistryLockInfo`, and lock path construction dependencies explicit.
- Verify that both create and freeze want identical defaults: tagged snapshots become `pinned`, frozen snapshots become `forensic`, otherwise `cache`.

Hazards:

- Error text and conflict payloads may be consumed by CLI tests or downstream tooling.
- Create and freeze may evolve differently; do not over-generalize lifecycle semantics into a generic registry helper.
- Lock conflict details include owner, scope fallback, operation, PID, and startedAt; dropping any field is a behavior change.

Acceptance tests:

- Run snapshot create/freeze tests covering retention tiers, invalid tier errors, tagged snapshots, frozen snapshots, lock conflicts, and stale lock metadata.
- Compare JSON/error output from create and freeze commands before and after if tests do not assert exact payloads.
- Re-run `npm run audit:duplicates`.

Performance and quality constraints:

- No additional filesystem reads beyond the existing lock-info read.
- No extra JSON serialization in the hot path.
- Helper should remain synchronous except where lock info is already async.

### Done: Lock Release Cleanup

Status:

- Completed on 2026-05-20.
- Implementation files: `src/index/lock-release.js`, `src/index/build/lock.js`, and `src/index/registry-lock.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in the lock files.
- The extraction is intentionally limited to release-state tracking, exit cleanup, signal cleanup marker, handler detachment, and release timeout wrapping.
- Acquisition path, stale-lock logging, lock-held behavior, cleanup labels, and metadata stay in their domain modules.
- Targeted validation passed:
  - `node --check src/index/lock-release.js`
  - `node --check src/index/build/lock.js`
  - `node --check src/index/registry-lock.js`
  - Focused index-lock, snapshots/diffs registry, and concurrent registry-writer tests.

Future constraints:

- Keep release idempotency, `_onSignalCleanup`, `signalCleaned`, and diagnostic labels stable.
- Do not share acquisition or lock-held error behavior unless both lock domains first expose the same public contract.
- Any future lock edit should rerun both registry-lock and build-lock tests because process signal cleanup is process-lifetime-sensitive.

### Done: Bundle Patch And Checksum Worker Clones

Status:

- Completed on 2026-05-20.
- Implementation files: `src/shared/bundle-patch.js`, `src/shared/bundle-io.js`, `src/shared/bundle-io-checksum.js`, `src/shared/workers/bundle-transform-worker.js`, and `tests/shared/io/bundle-transform-worker-checksum.test.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in the bundle IO/worker files.
- Patch construction now lives in `src/shared/bundle-patch.js`; the main thread still wraps the core payload with `format`/`version`, while the worker keeps its protocol payload shape.
- Checksum normalization now reuses the worker-safe checksum helper instead of duplicating canonicalization in the worker.
- Targeted validation passed:
  - `node --check src/shared/bundle-patch.js`
  - `node --check src/shared/bundle-io.js`
  - `node --check src/shared/workers/bundle-transform-worker.js`
  - `node --check tests/shared/io/bundle-transform-worker-checksum.test.js`
  - Bundle patch, worker transform, SQLite bundle-loader worker, checksum fail-closed, and worker checksum parity tests.

Future constraints:

- Shared worker imports must remain dependency-light and must not pull in filesystem, msgpack, or broad bundle IO code unnecessarily.
- Do not add worker message round trips or serialize bundles more than current code does.
- Keep checksum canonicalization, `MAX_BUNDLE_CHECKSUM_BYTES`, error/no-op behavior, and worker response shape stable.

### Done: Additional 2026-05-20 Duplicate Slices

Status:

- Token-ingest artifact batch helpers are done in `src/storage/sqlite/build/from-artifacts/token-ingest.js`; direct and sharded artifact paths share local token-vocab and doc-length insert helpers, and the file has 0 current duplicate hits.
- JSON stream result construction is done in `src/shared/json-stream/streams.js`; gzip, zstd, and plain setup stay separate, and the result wrapper is local.
- Manifest single-artifact path dispatch is done in `src/shared/artifact-io/manifest-sources.js`; strict ambiguity, missing-artifact, and fallback behavior stay unchanged.
- Graph/core artifact loader source helpers are done for the targeted source-reading and CSR payload paths; SQLite source ingestion imports the canonical columnar row inflater.
- JSONL buffered emission is done in `src/shared/artifact-io/json/read-jsonl-stream.js`; gzip, uncompressed small-file, and zstd small-payload paths share parse/push/cleanup telemetry while true streaming paths stay streaming.
- Retrieval output filters are done in `src/retrieval/output/filters.js` and `src/retrieval/output/filters/meta.js`; standard and meta-v2 rendering share docmeta merge helpers.
- Federation coordinator response assembly is done in `src/retrieval/federation/coordinator.js`; cache key, repo error classification, generation context, and redaction remain local.
- Report/throughput AST aggregation is partially done: `tools/reports/show-throughput/ast-summary.js` now owns AST/kind aggregation, and `tools/index/report-artifacts.js` reuses throughput aggregation helpers while preserving raw `languageLines` keys.

Validation evidence:

- Each production slice above passed `node --check` for touched files plus focused tests tied to the affected subsystem.
- The checkpoint after these slices and the subsequent SQLite build telemetry/vector diagnostics, VS Code search-contract normalization, and Pyright provider/path normalization passes was 823 clones / 16,290 duplicated lines / 181,500 duplicated tokens. The current full baseline is recorded at the top of this file.
- The report/throughput test sweep originally exposed two output-contract mismatches. The branch now pins overview text to stdout in `show-throughput-ignore-usr.test.js` and restores the `ledger regression` phrase in the throughput regression heading.

## Historical Saved-Baseline Candidate Details

The saved baseline below was broad at the time it was captured. These sections are retained as implementation history and as guidance for a future intentional full duplicate baseline refresh; they are not current open work for this checkpoint because the latest exact-current saved-report refresh found 0 still-current fragments.

### Done: Artifact Loader Residuals

Status:

- Completed on 2026-05-20.
- Implementation files: `src/shared/artifact-io/loaders/graph.js`, `src/shared/artifact-io/loaders/shared.js`, and `src/shared/artifact-io/loaders/binary-columnar.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in all three target files.
- `graph.js` now shares relation read-plan setup for sync and async graph relation loading while preserving JSON `null` handling, CSR loading, strict mode, missing/invalid artifact errors, and row ordering.
- `shared.js` now shares columnar row context and row construction for materialized and iterator paths without adding per-row object-spread allocation.
- `binary-columnar.js` now shares row-slice validation and offset/length/truncation handling while preserving materialized versus streaming byte-budget behavior.

Validation evidence:

- `node --check src/shared/artifact-io/loaders/graph.js`
- `node --check src/shared/artifact-io/loaders/shared.js`
- `node --check src/shared/artifact-io/loaders/binary-columnar.js`
- `node tests/run.js graph/store-csr-artifact-load shared/artifact-io/format-parity shared/artifact-io/loader-fallbacks shared/artifact-io/spec-contract storage/sqlite/chunk-meta-binary-columnar-budget-hardening indexing/contracts/loader-matrix-parity --lane=all --timeout-ms 30000`

Future constraints:

- Keep graph helpers local unless another loader uses the exact same graph relation contract.
- Do not merge materialized and streaming binary-columnar paths in a way that adds buffering or changes per-row budget enforcement.
- Keep row validation errors and null/undefined handling reviewable at the loader boundary.

### Done: Subprocess Tracking Termination Lifecycle

Status:

- Completed on 2026-05-20.
- Implementation file: `src/shared/subprocess/tracking-terminate.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in `tracking-terminate.js`.
- Termination option normalization, audit/event shaping, audit sorting, empty-summary creation, cleanup emission, and summary aggregation now live in subprocess-local helpers.
- Async and sync kill paths still own their force-grace behavior, tree-kill behavior, detached-process handling, state checks, untracking, and exit mapping.

Validation evidence:

- `node --check src/shared/subprocess/tracking-terminate.js`
- `node tests/run.js shared/subprocess/tracked-shutdown-cleanup --lane=all --timeout-ms 30000`
- `node tests/run.js shared/subprocess/tracked-event-ledger --lane=all --timeout-ms 30000`
- `node tests/run.js shared/subprocess/process-exit-cleanup --lane=all --timeout-ms 30000`
- `node tests/run.js shared/subprocess/tracked-shutdown-signal-cleanup --lane=all --timeout-ms 30000`
- `node tests/run.js shared/subprocess/timeout-kills-child --lane=all --timeout-ms 30000`
- `node tests/run.js indexing/stage1/process-files-cleanup-timeout --lane=all --timeout-ms 30000`
- `node tests/run.js shared/concurrency/scheduler-stage1-proc-nested-deadlock --lane=all --timeout-ms 30000`

Future constraints:

- Preserve timeout, signal, nested process, tree-kill, and diagnostic semantics before taking further subprocess or scheduler cleanup.
- Keep Windows and POSIX behavior separate where platform APIs differ.
- Do not introduce process-wide handlers, intervals, retries, or extra process-tree scans in a duplicate-only pass.

### Done: Report Artifact And Throughput Production Residuals

Status:

- Completed on 2026-05-20 for production/tooling report residuals.
- Implementation files: `tools/reports/show-throughput/cache-identity.js`, `tools/reports/show-throughput/build-root.js`, `tools/shared/numeric-distribution.js`, `tools/reports/show-throughput/load.js`, `tools/reports/show-throughput/analysis.js`, `tools/reports/show-throughput/aggregate.js`, `tools/reports/show-throughput.js`, `tools/index/report-artifacts.js`, and `tools/bench/language/metrics/regression.js`.
- `npm run audit:duplicates` reports 0 current hits in `tools/reports/show-throughput/**`, `tools/index/report-artifacts.js`, `tools/bench/language/metrics/regression.js`, and `tools/shared/numeric-distribution.js`.
- For this slice, the full audit baseline moved from 879 clones / 17,254 duplicated lines / 191,370 duplicated tokens to the then-current 873 clones / 17,168 duplicated lines / 190,166 duplicated tokens.
- The remaining related hit is `tools/index/report-artifacts/scan-profile.js:70 <-> tests/tooling/reports/show-throughput-scan-profile-preferred.test.js:89`, a production/test fixture overlap. It is intentionally deferred to the test-harness bucket unless a test helper makes the fixture clearer.

What changed:

- `cache-identity.js` now owns cache path keys and file stamps shared by analysis and feature-metrics loading.
- `build-root.js` now owns sqlite-artifact build-root resolution and the richer show-throughput artifact-report build-root resolver. `report-artifacts.js` keeps its existing cache-root fallback ordering.
- `tools/shared/numeric-distribution.js` now owns numeric sorting, quantiles, and distribution summaries used by report aggregation and throughput-ledger regression confidence.
- `aggregate.js` now shares mode-total merging across feature metrics and indexing summaries while keeping `count` versus `files` source fields explicit.
- `show-throughput.js` now shares distribution table column construction and drops unused global regression flattening.

Validation evidence:

- `node --check` passed for every implementation file listed above.
- Scoped jscpd over the report/throughput files returned no clone output.
- All 17 `tests/tooling/reports/show-throughput*.test.js` files passed with a 30-second cap per test; none were skipped.
- `node tests/run.js tooling/reports/bench-language-throughput-ledger-report --lane=all --timeout-ms 30000`
- `node tests/run.js tooling/reports/throughput-ledger-multi-metric-regression --lane=all --timeout-ms 30000`
- `node tests/run.js tooling/reports/bench-language-reuse-summary-prefers-scan-profile --lane=all --timeout-ms 30000`
- Full `npm run audit:duplicates` passed and wrote the then-current 873-clone baseline.

Future constraints:

- Keep stdout/stderr streams, JSON fields, threshold labels, and heading phrases pinned before any future report-output cleanup.
- Keep scan-profile fixtures in tests unless a helper improves readability without hiding expected fixture shape.
- Do not make bench metric code depend on report-only modules; use shared tooling primitives only for truly shared contracts.

### Done: JSON Stream Residual Files

Status:

- Completed on 2026-05-20.
- Implementation files: `src/shared/json-stream/json-writers.js` and `src/shared/json-stream/jsonl-sharded.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in both residual JSON stream files.
- `json-writers.js` now shares writer finalization/checksum result creation and abort cleanup for array and object writers.
- `jsonl-sharded.js` now shares item line resolution, rollover checks, writing, and oversized-entry error creation for async and sync sharded JSONL writers.
- The earlier completed stream constructor and JSONL buffered-reader slices still have 0 current hits in `src/shared/json-stream/streams.js` and `src/shared/artifact-io/json/read-jsonl-stream.js`.

Validation evidence:

- `node --check src/shared/json-stream/json-writers.js`
- `node --check src/shared/json-stream/jsonl-sharded.js`
- `node tests/run.js shared/json-stream/typedarray-sharded --lane=all --timeout-ms 30000`
- `node tests/run.js shared/json-stream/maxbytes-enforced --lane=all --timeout-ms 30000`
- `node tests/run.js shared/json-stream/large-array-stream --lane=all --timeout-ms 30000`
- `node tests/run.js shared/json-stream/abort-closes-stream --lane=all --timeout-ms 30000`
- `node tests/run.js storage/sqlite/chunk-meta-streaming --lane=all --timeout-ms 30000`

Future constraints:

- Keep helpers file-local unless another stream file needs the exact same finalization or sharded-item contract.
- Do not add buffering or materialize full JSONL payloads to reduce small stream-family clones.
- Preserve public stream return shapes, `done` promise behavior, byte counters, max-byte guards, and close/error propagation.

### Done: Contract Schema Shape Fragments

Status:

- Completed on 2026-05-20.
- Implementation files: `src/contracts/schemas/analysis/risk.js`, `src/contracts/schemas/build-state.js`, and `src/contracts/schemas/test-artifacts.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits under `src/contracts/schemas/**`.
- The full audit baseline moved from 873 clones / 17,168 duplicated lines / 190,166 duplicated tokens to 869 clones / 17,052 duplicated lines / 189,177 duplicated tokens.
- At the time of this slice, the remaining contract-adjacent duplicate work was the 29-hit USR validator family under `src/contracts/validators/usr-matrix/**`; the later USR helper slice reduced that family to 0 current hits.

What changed:

- `risk.js` now shares named watch-step schema fragments for full and partial risk flow summaries while preserving watch semantics, confidence fields, sanitizer fields, required keys, and `additionalProperties: false`.
- `build-state.js` now shares the document extraction source-type count shape for coverage and count summaries while preserving required `pdf`, `docx`, `total`, `ok`, and `skipped` fields.
- `test-artifacts.js` now shares test-run entry and stability family summary schema fragments while keeping each artifact schema's top-level shape explicit.

Validation evidence:

- `node --check src/contracts/schemas/analysis/risk.js`
- `node --check src/contracts/schemas/build-state.js`
- `node --check src/contracts/schemas/test-artifacts.js`
- Scoped `jscpd` over the three schema files returned no clone output.
- `node tests/run.js runner/harness/timings-schema-validation --lane=all --timeout-ms 30000`
- `node tests/run.js runner/harness/profile-schema-validation --lane=all --timeout-ms 30000`
- `node tests/run.js runner/harness/stability-schema-validation --lane=all --timeout-ms 30000`
- `node tests/run.js runner/harness/coverage-schema-validation --lane=all --timeout-ms 30000`
- `node tests/run.js runner/harness/coverage-policy-schema-validation --lane=all --timeout-ms 30000`
- `node tests/run.js indexing/risk/interprocedural/summaries-schema --lane=all --timeout-ms 30000`
- `node tests/run.js indexing/state/build-state-contract-matrix --lane=all --timeout-ms 30000`
- `node tests/run.js tooling/docs/contract-matrix --lane=all --timeout-ms 30000`
- `node tests/run.js indexing/extracted-prose/documents-included-when-available --lane=all --timeout-ms 30000`
- `node tests/run.js indexing/build-state/ledger-roundtrip --lane=all --timeout-ms 30000`
- `npm run format`
- Full `npm run audit:duplicates` passed and wrote the 869-clone baseline.

Future constraints:

- Keep schema fragments named after their contract meaning rather than generic object builders.
- Do not collapse USR validators into shared fragments until each repeated block has matching required fields, validator error paths, and guardrail semantics.
- Preserve explicit top-level schema definitions so contract review still shows required fields and `additionalProperties` boundaries.

### Done: USR Report-Shaping And Diagnostics Helpers

Status:

- Completed on 2026-05-20 for the safe report-shaping, row-diagnostics, and report-envelope subset of USR validator duplicates.
- Implementation files: `src/contracts/validators/usr-matrix/report-shaping.js`, `src/contracts/validators/usr-matrix/profile-helpers.js`, `src/contracts/validators/usr-matrix/readiness.js`, `src/contracts/validators/usr-matrix/governance.js`, `src/contracts/validators/usr-matrix/scenarios.js`, `src/contracts/validators/usr-matrix/observability-security.js`, and `src/contracts/validators/usr-matrix/benchmark.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits under `src/contracts/validators/usr-matrix/**`, down from 29.
- The full audit baseline moved from 869 clones / 17,052 duplicated lines / 189,177 duplicated tokens to 840 clones / 16,576 duplicated lines / 184,948 duplicated tokens.

What changed:

- `report-shaping.js` now owns registry-failure result envelopes, pass/warn/fail status selection, and finding row construction.
- `report-shaping.js` now also owns explicit row diagnostic aggregation/freezing helpers and the narrow report payload/row-clone helpers used by matching USR report builders.
- Existing `normalizeReportScope(...)` now covers the global/global report builders where the fallback values match the previous inline behavior.
- `benchmark.js` reuses the existing observed-result map normalizer instead of owning a duplicate id-map helper.
- The slice intentionally keeps one-off blocked-status and readiness return paths local where they have different `blocked`, warning preservation, or row-pass semantics.

Validation evidence:

- `node --check src/contracts/validators/usr-matrix/report-shaping.js`
- `node --check src/contracts/validators/usr-matrix/scenarios.js`
- `node --check src/contracts/validators/usr-matrix/governance.js`
- `node --check src/contracts/validators/usr-matrix/observability-security.js`
- `node --check src/contracts/validators/usr-matrix/benchmark.js`
- `node --check src/contracts/validators/usr-matrix/readiness.js`
- `node tests/run.js contracts/usr-matrix-helper-modules contracts/usr-matrix-modularization backcompat/matrix-validation conformance/language-shards/foundation/validation conformance/language-shards/javascript-typescript/validation conformance/language-shards/cross-language-integration/validation conformance/language-shards/managed-languages/validation conformance/language-shards/systems-languages/validation conformance/language-shards/dynamic-languages/validation conformance/language-shards/data-interface-dsl/validation conformance/language-shards/build-infra-dsl/validation conformance/language-shards/markup-style-template/validation --lane=all`
- Full `npm run audit:duplicates` passed and wrote the 840-clone baseline.

Future constraints:

- Keep report-shaping helpers limited to envelope/status/finding/diagnostic primitives; do not move row-level validation semantics into them.
- For any next USR validator slice, add or pin assertions for message prefixes before extracting additional row helpers.
- Do not merge benchmark pass semantics with other validators; benchmark regression treats row warnings as row failures in some paths.

### Done: Shared Runtime/File IO And Build-State Micro-Slices

Status:

- Completed on 2026-05-20 for the safe artifact-compression, atomic-write, and build-state lock-owner duplicate families.
- Implementation files: `src/shared/artifact-io/compression.js`, `src/shared/io/atomic-write.js`, `src/index/build/build-state/patch-queue.js`, `src/index/build/build-state/store.js`, and `tests/shared/artifact-io/compression-tier-resolution.test.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in `src/shared/artifact-io/compression.js`, `src/shared/io/atomic-write.js`, `src/index/build/build-state/patch-queue.js`, and `src/index/build/build-state/store.js`.
- The full audit baseline moved from 840 clones / 16,576 duplicated lines / 184,948 duplicated tokens to 835 clones / 16,491 duplicated lines / 183,738 duplicated tokens.

What changed:

- `compression.js` now shares compressed variant candidate collection for JSON and JSONL fallback paths while preserving live cleanup candidates before backup candidates and newest-first ordering inside each group.
- `atomic-write.js` now shares target resolution and text/JSON payload construction across async and sync writers while preserving stable JSON output, optional newline behavior, checksum calculation, temp file selection, fsync/rename order, and cleanup behavior.
- `store.js` now owns build-state lock-owner formatting for store and patch-queue logs while preserving field order, pid normalization, string trimming, and empty-owner handling.

Validation evidence:

- `node --check src/shared/artifact-io/compression.js`
- `node --check src/shared/io/atomic-write.js`
- `node --check tests/shared/artifact-io/compression-tier-resolution.test.js`
- `node --check src/index/build/build-state/patch-queue.js`
- `node --check src/index/build/build-state/store.js`
- `node tests/run.js shared/io/atomic-write-contract shared/io/atomic-persistence-contract shared/fs/atomic-replace-contract-matrix shared/artifact-io/compression-tier-resolution shared/artifact-io/json-fallback-integrity-policy shared/artifact-io/json-fallback-missing-primary-candidate-failure shared/artifact-io/jsonl-byte-range-compressed-fallback --lane=all --fail-fast`
- `node tests/run.js indexing/state/patch-queue-contract-matrix indexing/state/build-state-contract-matrix indexing/state/patch-queue-no-wait-telemetry indexing/state/patch-queue-retry-preserves-events indexing/state/patch-queue-wait-timeout-outcome --lane=all --fail-fast`
- Full `npm run audit:duplicates` passed and wrote the 835-clone baseline.

Future constraints:

- Keep artifact compression helpers file-local unless another artifact reader adopts the exact same candidate ordering and fallback semantics.
- Do not merge atomic-write and replace-file behavior unless the rename, fsync, checksum, newline, and cleanup contracts are proven identical under Windows.
- Keep build-state formatting helpers under build-state ownership; do not generalize them into a broad logging utility.

### Done: Shared Runtime Process-Helper Residuals

Status:

- Completed on 2026-05-20 for the safe replace-file, lifecycle registry, and runWithQueue pending-drain duplicate families.
- Implementation files: `src/shared/io/replace-file.js`, `src/shared/lifecycle/registry.js`, and `src/shared/concurrency/run-with-queue.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in all three target files.
- The full audit baseline moved from 835 clones / 16,491 duplicated lines / 183,738 duplicated tokens to 832 clones / 16,447 duplicated lines / 183,285 duplicated tokens for this slice.

What changed:

- `replace-file.js` now shares same-path resolution and missing-temp error construction across async and sync replacement paths while preserving `ERR_TEMP_MISSING`, committed-final detection, backup restore behavior, and Windows path comparison.
- `registry.js` now shares lifecycle hook execution and pending promise error collection while preserving `drain` vs `close` stage labels, reverse close ordering, `resources.clear()` timing, and `awaitWithKeepalive` usage.
- `run-with-queue.js` now shares pending-drain stall timer setup and timer cleanup while preserving abort listener removal, timeout rejection, stall diagnostic snapshots, and pending signal counting.

Validation evidence:

- `node --check src/shared/io/replace-file.js`
- `node --check src/shared/lifecycle/registry.js`
- `node --check src/shared/concurrency/run-with-queue.js`
- `node tests/run.js shared/fs/atomic-replace-contract-matrix shared/io/atomic-persistence-contract shared/json-stream/atomic-replace shared/lifecycle/contract-matrix indexing/lifecycle/shutdown-drain-contract shared/concurrency/run-with-queue-contract-matrix shared/concurrency/run-with-queue-pending-drain-timeout shared/concurrency/run-with-queue-abort-backpressure shared/concurrency/run-with-queue-abort-inflight-hang shared/concurrency/pending-limit-enforced shared/concurrency/pending-limit-zero-disabled shared/concurrency/pending-bytes-limit-enforced shared/concurrency/scheduler-adapter-zero-limits-disabled shared/concurrency/scheduler-adapter-bytes-gating --lane=all --fail-fast`
- Full `npm run audit:duplicates` passed and wrote the 832-clone intermediate baseline.

Future constraints:

- Keep replace-file helpers file-local unless another replacement path proves identical temp, backup, fsync, rename, and missing-temp semantics.
- Keep lifecycle helper contracts limited to hook execution and pending settlement; do not hide registration ownership or close ordering behind a broader registry abstraction.
- Keep queue pending-drain timer helpers inside `runWithQueue`; do not add timers, listeners, or process-wide cleanup behavior in duplicate-only work.

### Done: SQLite Dense Metadata Count Resolution

Status:

- Completed on 2026-05-20 for the exact dense metadata expected-count clone shared by incremental update and sqlite runner probes.
- Implementation files: `src/storage/sqlite/utils.js`, `src/storage/sqlite/build/incremental-update.js`, `src/storage/sqlite/build/runner/sqlite-probes.js`, `src/storage/sqlite/build/runner/execution-orchestration.js`, and `src/storage/sqlite/build/runner/selection-planning.js`.
- `npm run audit:duplicates` reports 0 current duplicate hits in `src/storage/sqlite/utils.js` and `src/storage/sqlite/build/runner/sqlite-probes.js`; the old `incremental-update.js:46 <-> runner/sqlite-probes.js:128` clone is gone.
- The full audit baseline moved from 832 clones / 16,447 duplicated lines / 183,285 duplicated tokens to 831 clones / 16,437 duplicated lines / 183,040 duplicated tokens.

What changed:

- `src/storage/sqlite/utils.js` now owns `resolveExpectedDenseCount` for current and legacy dense metadata shapes.
- Incremental update and runner planning import that helper directly from storage-build ownership, so core incremental build code does not depend on runner probe modules.
- Count precedence is unchanged: `count`/`fields.count`, then `totalRecords`/`fields.totalRecords`, then vector array length, then `0`.

Validation evidence:

- `node --check src/storage/sqlite/utils.js`
- `node --check src/storage/sqlite/build/incremental-update.js`
- `node --check src/storage/sqlite/build/runner/sqlite-probes.js`
- `node --check src/storage/sqlite/build/runner/execution-orchestration.js`
- `node --check src/storage/sqlite/build/runner/selection-planning.js`
- `node tests/run.js storage/sqlite/dense-meta-fallback storage/sqlite/quantization/sqlite-vector-ingest-encoding storage/sqlite/bundle-dims-mismatch storage/sqlite/incremental/ann-existing-table storage/sqlite/incremental-memory-profile storage/sqlite/incremental-transaction-boundary storage/sqlite/incremental/manifest-normalization storage/sqlite/incremental/bundle-partial-embeddings-fallback storage/sqlite/incremental/bundle-count-mismatch-fallback storage/sqlite/incremental-no-change storage/sqlite/incremental/bundle-partial-chunk-fallback storage/sqlite/incremental/file-manifest-updates storage/sqlite/incremental/doc-id-reuse --lane=all --fail-fast --timeout-ms 30000`
- Full `npm run audit:duplicates` passed and wrote the 831-clone baseline.

Future constraints:

- Keep dense metadata helpers under `src/storage/sqlite/build/**`; do not move this into runner-only probes or artifact loaders unless the full dense metadata ownership contract changes.
- Preserve numeric coercion, flooring, positive-count checks, and legacy `arrays.vectors` fallback before changing incremental fallback/rebuild decisions.
- Add focused tests before changing count precedence because this helper controls dense rebuild and row-ledger expectations.

### Done: Kill-Tree Platform Termination Residuals

Status:

- Completed on 2026-05-20 for the Windows fallback and POSIX force-kill duplicate families.
- Implementation files: `src/shared/kill-tree/windows.js`, `src/shared/kill-tree/posix.js`, and `tests/shared/subprocess/sync-timeout-kills-child-tree.test.js`.
- `npm run audit:duplicates` now reports 0 duplicate entries referencing `src/shared/kill-tree/**`.
- The full audit baseline moved from 831 clones / 16,437 duplicated lines / 183,040 duplicated tokens to 828 clones / 16,385 duplicated lines / 182,494 duplicated tokens.

What changed:

- `windows.js` now uses a file-local fallback-state helper for async and sync orphan-descendant cleanup while preserving taskkill ordering, `fallbackAttempted`, `fallbackTerminated`, and forced result semantics.
- `posix.js` now uses a file-local kill-state helper for initial signal dispatch and forced escalation while keeping descendant discovery, process-group probing, delayed `awaitGrace=false` escalation, and signal ordering platform-local.
- `sync-timeout-kills-child-tree.test.js` now gives the Windows parent fixture enough time to publish the spawned child PID before the intentional sync timeout, while still running under the repository runner's 30-second cap.

Validation evidence:

- `node --check src/shared/kill-tree/windows.js`
- `node --check src/shared/kill-tree/posix.js`
- `node --check src/shared/kill-tree.js`
- `node tests/run.js shared/kill-tree.windows shared/kill-tree.windows-orphan-descendant-fallback shared/kill-tree.posix shared/kill-tree-await-grace-false shared/subprocess/timeout-kills-child shared/subprocess/sync-timeout-kills-child-tree shared/subprocess/tracked-shutdown-cleanup shared/subprocess/tracked-event-ledger shared/subprocess/process-exit-cleanup shared/subprocess/tracked-shutdown-signal-cleanup --lane=all --fail-fast --timeout-ms 30000` passed with 9 passed, 1 platform skip (`shared/kill-tree.posix` on Windows), 0 timeouts.
- Full `npm run audit:duplicates` passed and wrote the 828-clone baseline.

Future constraints:

- Keep Windows and POSIX process discovery and termination APIs separate; do not move taskkill, process-group, or signal behavior into a cross-platform abstraction.
- Preserve delayed forced-kill behavior for `awaitGrace=false`, including the non-blocking scheduled escalation path.
- Keep sync timeout fixtures under the runner helper and the 30-second per-test cap; do not reintroduce direct `PAIROFCLEATS_TESTING=1` validation commands for this family.

### Done: SQLite Build Telemetry And Vector Encoding Residuals

Status:

- Completed on 2026-05-20 for table telemetry and vector encoding mismatch residuals in SQLite build paths.
- Implementation files: `src/storage/sqlite/utils.js`, `src/storage/sqlite/vector.js`, `src/storage/sqlite/build/core.js`, `src/storage/sqlite/build/incremental-update.js`, `src/storage/sqlite/build/from-bundles.js`, and `src/storage/sqlite/build/incremental-update/update-phase.js`.
- `npm run audit:duplicates` reports 0 current hits in the touched SQLite build/vector files.
- `createSqliteTableStatRecorder` now owns table row/duration/rows-per-second aggregation for full and incremental builds.
- `resolveVectorEncodingCompatibility` and `formatVectorEncodingMismatchWarning` now own encoded vector byte-count diagnostics while keeping actual insertion, ANN readiness, and one-warning-per-path behavior local.

Validation evidence:

- `node --check` passed for all implementation files listed above.
- `node tests/run.js storage/sqlite/build/sqlite-core-contract storage/sqlite/quantization/sqlite-vector-ingest-encoding storage/sqlite/bundle-dims-mismatch storage/sqlite/dense-meta-fallback tooling/vscode/search-contract-matrix tooling/vscode/search-payload-mapping tooling/vscode/search-runtime-contract-matrix tooling/lsp/pyright-provider-timeout-state tooling/lsp/pyright-provider-hover-timeout-state tooling/lsp/pyright-provider-recovery-fingerprint tooling/lsp/pyright-provider-planning tooling/lsp/pyright-request-planner tooling/lsp/pyright-preflight-workspace-config-invalid tooling/lsp/pyright-preflight-workspace-mono-root tooling/lsp/pyright-preflight-workspace-scan-outlier tooling/lsp/fallback-runtime-contract-matrix tooling/lsp/fallback-reason-codes tooling/lsp/runtime-envelope tooling/lsp/lifecycle-health --lane=all --fail-fast --timeout-ms 30000` passed with 19 passed, 0 failed, 0 skipped, 0 timeouts.
- `node tests/run.js storage/sqlite/bundle-missing storage/sqlite/incremental/manifest-normalization storage/sqlite/incremental/manifest-hash-fill storage/sqlite/migrations/schema-mismatch-rebuild --lane=all --fail-fast --timeout-ms 30000` passed with 4 passed, 0 failed, 0 skipped, 0 timeouts.
- `node tests/run.js storage/sqlite/build-indexes storage/sqlite/incremental/bundle-partial-embeddings-fallback storage/sqlite/incremental/bundle-count-mismatch-fallback storage/sqlite/incremental/bundle-partial-chunk-fallback storage/sqlite/incremental-no-change storage/sqlite/incremental/file-manifest-updates storage/sqlite/ann/sqlite-extension storage/sqlite/ann/sqlite-fallback --lane=all --fail-fast --timeout-ms 30000` produced 4 passed and 4 timeout-class skips under the repository 30-second rule: `storage/sqlite/ann/sqlite-extension`, `storage/sqlite/ann/sqlite-fallback`, `storage/sqlite/incremental-no-change`, and `storage/sqlite/incremental/bundle-partial-chunk-fallback`.
- Full `npm run audit:duplicates` passed and wrote the 823-clone baseline.

Future constraints:

- Do not move SQL statement construction, ANN table readiness, encoded vector insertion, or incremental fallback decisions into these helpers.
- Preserve table telemetry field names and `rowsPerSec` calculation because build reports and runtime telemetry consume them.
- Keep vector mismatch warnings byte-count based and mode-specific; do not downgrade incompatible payloads into silent skips.

### Done: Pyright Provider And VS Code Search Contract Micro-Slices

Status:

- Completed on 2026-05-20 for the safe provider/editor subset.
- Implementation files: `src/index/tooling/pyright-provider.js`, `src/index/tooling/pyright-planner.js`, `src/index/tooling/pyright-runtime-health.js`, `src/index/tooling/workspace-model.js`, and `extensions/vscode/search-contract.js`.
- `npm run audit:duplicates` reports 0 current hits in those files.
- Pyright fallback result assembly is now provider-local and shared by no-selected-target and quarantine paths while preserving fallback check inclusion differences.
- Pyright planner/runtime health now share workspace-root normalization without creating a broad tooling provider abstraction.
- VS Code search args and API payload mapping now share option normalization while keeping `extraArgs`, `maxResults`, `--churn`, and API `churnMin` behavior explicit.

Validation evidence:

- `node --check` passed for all implementation files listed above.
- The 19-test focused runner command listed in the SQLite section passed after lint/fix and covered the Pyright and VS Code selectors.
- Full `npm run audit:duplicates` passed and wrote the 823-clone baseline.

Future constraints:

- Keep provider result helpers Pyright-local unless another provider has matching fallback fidelity, check inclusion, capture diagnostics, and quarantine semantics.
- Keep planner decisions separate from runtime health observation; shared path normalization is acceptable, shared runtime state is not.
- Keep VS Code command-line and API payload differences visible at the call sites.

### Done: Sublime, Map, Benchmark, Language, And Risk Micro-Slices

Status:

- Completed on 2026-05-20 for the safe editor, map, benchmark parser, language-family, and risk-narrative subset.
- Implementation files: `sublime/PairOfCleats/lib/views.py`, `sublime/PairOfCleats/commands/{analysis,index,map,search}.py`, `tests/helpers/sublime/search_behavior.py`, `src/map/build-map/edges.js`, `tools/bench/shared.js`, the touched index/SQLite/cache/embedding bench scripts, `src/lang/{shared,java,kotlin,csharp}.js`, and `src/retrieval/output/risk-explain.js`.
- This checkpoint reduced the baseline to 789 total clones, down from the previous 823-clone checkpoint. The current full baseline is recorded at the top of this file.
- The refreshed audit reports 0 current duplicate hits in production Sublime command files, `tests/helpers/sublime/search_behavior.py`, `src/map/build-map/edges.js`, `tools/bench/shared.js`, and `tools/bench/sqlite/jsonl-streaming.js`.
- Historical hotspot counts from that slice included `extensions/vscode/analysis-renderers.js` at 17, `src/retrieval/output/risk-explain.js` at 13, `src/lang/csharp.js` at 7, and `src/lang/{java,kotlin}.js` at 6 each. The later exact-current saved-report refresh found 0 still-current fragments, so these examples are conditional future-audit guidance rather than open checkpoint work.

Validation evidence:

- `node --check`, `npx eslint --fix`, and focused runner validation passed for `src/map/build-map/edges.js`: `node tests/run.js map/build-contract-matrix indexing/map/code-map-contract-matrix --lane=all --fail-fast --timeout-ms 30000` passed with 2 passed.
- `node --check`, `npx eslint --fix`, a `parseSimpleBenchArgs` behavior probe, and `node tools/bench/sqlite/jsonl-streaming.js --count 3 --mode current` passed for the benchmark parser slice.
- `node --check`, `npx eslint --fix`, and `node tests/run.js indexing/chunking/formats/format-fidelity --lane=all --fail-fast --timeout-ms 30000` passed for the Java/Kotlin/CSharp language helper slice.
- `node --check`, `npx eslint --fix`, and `node tests/run.js retrieval/output/risk-explanation-contract-matrix retrieval/output/composite-context-pack-contract-matrix services/risk-explain-adapter-matrix context-pack/risk-filters-parity --lane=all --fail-fast --timeout-ms 30000` passed for the risk renderer helper slice with 4 passed.
- Sublime validation passed with `node --check` for the Sublime tooling test harness files, `git diff --check -- sublime tests\helpers\sublime\search_behavior.py`, `npx jscpd --config .jscpd.json --reporters console sublime` with 0 clones, and `node tests/run.js tooling/sublime/pycompile tooling/sublime/behavior-contract-matrix tooling/sublime/package-harness tooling/sublime/package-structure --lane=all --fail-fast --timeout-ms 30000` with 4 passed.
- Full `npm run audit:duplicates` passed and wrote the 789-clone checkpoint for this slice; later VFS and USR baseline-profile passes lowered the current baseline further.

Future constraints:

- Keep Sublime command helpers editor-local. Do not combine Python command behavior with VS Code extension modules.
- Keep map edge construction local to relation-edge assembly unless another graph builder needs the exact same source/link-target/member semantics.
- Keep benchmark parser sharing limited to argument parsing and deterministic setup helpers; measured operations and log fields stay in each benchmark family.
- Keep C-like language helpers limited to grammar rules with identical token, precedence, and failure behavior.
- For renderer cleanup, extract data-model primitives before text renderers, and pin CLI/SARIF/context-pack/VS Code output with golden or contract tests before removing more duplication.

### Done: VFS Segment And USR Baseline Profile Slices

Status:

- Completed on 2026-05-20 for the safe VFS segment and USR matrix baseline profile subset.
- Implementation files: `src/index/tooling/vfs/segments.js` and `tools/usr/generate-usr-matrix-baselines/datasets.mjs`.
- `src/index/tooling/vfs/segments.js` now has 0 current duplicate hits after introducing a VFS-local coalesced segment group factory.
- `tools/usr/generate-usr-matrix-baselines/{datasets,builders}.mjs` now have 0 current duplicate hits after replacing repeated capability profile and framework profile blocks with named local helpers.
- The latest logged `npm run audit:duplicates` pass confirms these target files still have 0 current hits in the 635-clone baseline.

Validation evidence:

- `node --check src/index/tooling/vfs/segments.js` passed.
- `node tests/run.js --lane=all --match tooling/vfs --fail-fast --timeout-ms 30000` passed with 26 passed, 0 failed, 0 timeouts, 0 skipped.
- `node --check tools/usr/generate-usr-matrix-baselines/datasets.mjs` passed.
- `node tools/usr/generate-usr-matrix-baselines.mjs --check` passed with no registry drift.
- `node tests/run.js contracts/usr-matrix-helper-modules ci/usr-guardrail-registry-coverage conformance/language-shards/foundation/validation --lane=all --fail-fast --timeout-ms 30000` passed with 3 passed, 0 failed, 0 timeouts, 0 skipped.
- Focused `jscpd` checks confirmed the VFS segment and USR baseline profile duplicate hits were removed; the remaining focused USR mirror was only the import/export boundary before the full audit confirmed 0 current hits for those files.

Future constraints:

- Keep VFS segment group construction local to `segments.js` unless another VFS module needs the exact same group shape and mutation semantics.
- Keep USR framework-specific edge cases, language applicability, bridge rows, and hydration signals explicit at each profile.
- Do not collapse the dataset export list into dynamic reflection; the generator contract needs reviewable named exports.

### Done: Editor Package CLI Flow And Option Parsing

Status:

- Completed on 2026-05-20 for the Sublime and VS Code package entrypoint duplicate slice.
- Implementation files: `tools/tooling/editor-package-cli.js`, `tools/package-sublime.js`, `tools/package-vscode.js`, and `tools/shared/cli-utils.js`.
- `tools/package-sublime.js`, `tools/package-vscode.js`, and `tools/tooling/editor-package-cli.js` now have 0 current duplicate hits after moving shared parsing, source validation, toolchain checks, deterministic archive creation, smoke checks, and JSON result emission into a named editor package runner.
- The latest logged `npm run audit:duplicates` pass confirms the package entrypoints and helper still have 0 current hits in the 635-clone baseline.

Validation evidence:

- `npx eslint tools/tooling/editor-package-cli.js tools/shared/cli-utils.js tools/package-sublime.js tools/package-vscode.js --fix` passed.
- `node --check tools/tooling/editor-package-cli.js`, `node --check tools/shared/cli-utils.js`, `node --check tools/package-sublime.js`, and `node --check tools/package-vscode.js` passed.
- `node tests/run.js tooling/sublime/package-structure tooling/sublime/package-archive-metadata tooling/vscode/package-archive-metadata tooling/vscode/package-contract-matrix tooling/vscode/toolchain-missing-policy --lane=all --fail-fast --timeout-ms 30000` passed with 5 passed, 0 failed, 0 timeouts, 0 skipped.
- `node tests/run.js tooling/sublime/package-determinism tooling/sublime/package-release-sanity tooling/vscode/package-determinism tooling/release/verify-surface-archives tooling/archive-determinism-entry-order tooling/archive-determinism-python-probe --lane=all --fail-fast --timeout-ms 30000` passed with 6 passed, 0 failed, 0 timeouts, 0 skipped.
- Focused `jscpd` against the package entrypoints and helper reported no clones; the full audit confirms 0 current hits for the package entrypoints and helper.

Future constraints:

- Keep package targets descriptor-driven but explicit. Sublime and VS Code may share the archive runner, but their package source validation, required commands, archive root prefix, and manifest toolchain metadata must remain reviewable.
- Do not move generic CLI dispatch into the packaging helper. Main CLI command parsing, navigation helpers, legacy entrypoint behavior, and TUI wrapper exit behavior remain separate ownership domains for any future explicit CLI refactor.
- Keep package scripts as thin entrypoints so `node tools/package-sublime.js` and `node tools/package-vscode.js` remain stable documented commands.

### Done: Test Harness, USR Script, Risk Model, And Graph Bench Slices

Status:

- Completed on 2026-05-20 for the safe helper slices added after the package CLI flow.
- Implementation files:
  - `tests/tooling/vscode/runtime-test-helpers.js` and `tests/tooling/vscode/{operator-runtime,results-explorer-runtime,workflow-runtime}.test.js`
  - `src/shared/risk-explain-model.js`, `src/shared/risk-explain-summary.js`, `src/retrieval/output/risk-explain.js`, and `src/retrieval/output/risk-sarif.js`
  - `tools/bench/usr/shared.js`, `tools/ci/usr/shared.js`, and item35-item40 USR bench/gate entrypoints
  - `tests/helpers/tooling-lsp-slo-gate.js` and `tests/ci/tooling-lsp-slo-gate*.test.js`
  - `tools/bench/graph/shared.js` and graph benchmark entrypoints
- Final full audit output was logged to `temp/jscpd/audit-duplicates-20260520-044232.log`.
- Final full audit baseline is 729 clones / 14,156 duplicated lines / 157,012 duplicated tokens.

Validation evidence:

- `npx eslint` and `node --check` passed across the touched JS/MJS files; `node --check` covered 44 files.
- `node tests/run.js ... --lane=all --fail-fast --timeout-ms 30000` passed with 39 passed, 0 failed, 0 timeouts, 0 skipped for the package, CI LSP SLO, VS Code runtime, risk output, graph bench, shared-adoption, and USR matrix validation set.
- USR script entrypoint validation passed for 6 bench scripts and 6 CI gate scripts.
- Final `npm run audit:duplicates` passed once with output logged under `temp/jscpd/`.

Future constraints:

- Keep test helpers assertion-focused. Shared setup is acceptable only when it makes the scenario easier to read.
- Keep USR bench/gate item semantics local: measured operation, metric key, threshold, console string, JSON shape, and strict exit behavior.
- Keep graph benchmark measured operations local; `tools/bench/graph/shared.js` should own only benchmark mechanics.
- Keep renderer work model-first. Do not collapse VS Code, CLI markdown/JSON, SARIF, and context-pack text surfaces without golden output proof.

### Conditional Future Audit: Index, Storage, And Build Execution Residuals

Recorded status:

- Completed after the latest full audit: `src/shared/runtime-envelope/resolve-current-process-envelope.js` now owns current-process envelope metadata for `src/integrations/core/build-index/index.js`, `src/storage/sqlite/build/runner/selection-planning.js`, and `src/index/build/runtime/runtime.js`, while tool-version lookup and build/sqlite/runtime decisions remain at the call sites. Syntax validation passed in `temp/validation/runtime-envelope-current-process-helper-syntax-20260520-143507.log`; focused runtime/build/sqlite validation passed 4 tests and timed out `indexing/runtime/two-stage-state` at 30.2s in `temp/validation/runtime-envelope-current-process-helper-focused-tests-20260520-143512.log`.
- Completed after the latest full audit: `src/index/build/workers/pool.js` now shares file-local unavailable-pool and task-error crash logging helpers across tokenize and quantize paths; focused validation passed in `temp/validation/worker-pool-crash-log-dedupe-20260520-073422.log`.
- Completed after the latest full audit: `src/index/build/incremental/shared.js` now owns incremental embedding-coverage manifest normalization for main indexing and records indexing; focused validation passed in `temp/validation/production-duplicate-helpers-focused-final-20260520-134716.log`.
- Completed after the latest full audit: `tools/index/shard-census.js` now imports the production runtime cap normalizers from `src/index/build/runtime/caps.js` for max-file, shard, extension, and language cap handling while keeping census discovery and shard reporting local. File-cap contract, script-coverage wiring, and `shard-census --help` validation passed in `temp/validation/shard-census-caps-helper-focused-tests-20260520-141215.log` and `temp/validation/shard-census-help-20260520-141258.log`.
- Completed after the latest full audit: import-resolution stage/count helpers now share non-negative coercion, counter bumping, count-map filtering, stage snapshot sorting, and hotspot shaping across the engine, stage-pipeline, replay-harness, stage metrics, and import scan stats. Syntax, targeted ESLint, import-resolution contract validation, and watchdog-adjacent focused validation passed in `temp/validation/build-runtime-import-watchdog-helper-tests-20260520-162650.log` and `temp/validation/build-runtime-import-watchdog-helper-eslint-20260520-162825.log`.
- Completed after the latest full audit: process-file watchdog policy now imports `coerceClampedFractionOrDefault()` and `clampDurationMs()` from `watchdog.js`, preserving `resolveEffectiveSlowFileDurationMs()` as policy-local. The same focused validation logs cover this slice.
- Completed in the build-state lock-owner micro-slice: `src/index/build/build-state/patch-queue.js` and `src/index/build/build-state/store.js` now have 0 current duplicate hits.
- Completed in the SQLite dense metadata count slice: `src/storage/sqlite/utils.js` and `src/storage/sqlite/build/runner/sqlite-probes.js` have 0 current duplicate hits, and incremental update/runner planning share the same expected-count helper.
- Completed in the SQLite build telemetry/vector encoding slice: the old build-core/incremental table telemetry and from-bundles/update-phase vector warning clones are gone.

Implementation instructions:

- Refactor by execution contract, not by jscpd surface. Selection planning, SQLite probes, worker-pool lifecycle, build-state persistence, runtime caps, and import-resolution replay each have different stability risks.
- Preserve batch ordering, SQL statement text and binding order, transaction boundaries, retry/idempotency behavior, progress logging, and diagnostic labels.
- Keep worker-pool state transitions and completion ordering explicit. Do not add shared scheduler code that hides cancellation, drain, or crash handling.
- For runtime capacity helpers, preserve CLI defaults, environment overrides, shard-count limits, and memory guard behavior before sharing code with report tools.
- For future build-state overlap, prefer named build-state-local helpers only if the persisted JSON shape, patch replay semantics, and retry diagnostics are identical.

Validation:

- Run the focused SQLite build/incremental update tests, worker-pool and scheduler tests, build-state persistence tests, import-resolution replay tests, and any integration build-index tests tied to touched files. The worker-pool crash-log helper slice already passed syntax, ESLint, and focused worker-pool tests in `temp/validation/worker-pool-crash-log-dedupe-20260520-073422.log`.
- Use tiny deterministic fixtures for heavy build paths and cancel/report any individual test command over 30 seconds.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves a live candidate in this family, compare hotter execution paths before extracting helpers.

### Conditional Future Audit: External Tooling Provider Health And Fallback Assembly

Recorded status:

- Pyright provider fallback assembly and planner/runtime path normalization are complete and have 0 current hits.
- Completed after the latest full audit: SourceKit package preflight marker/result shaping is now provider-local through `buildSourcekitPreflightMarkerRecord()` and `buildSourcekitPreflightResult()`, preserving marker schema fields, fingerprint/cache semantics, failure classification, timeout state, and diagnostic checks. Syntax validation passed in `temp/validation/sourcekit-preflight-marker-result-helper-syntax-20260520-143751.log`; focused failure/lock/classification tests passed in `temp/validation/sourcekit-preflight-marker-result-helper-tests-20260520-143806.log`, and the cache/invalidation tests passed serially in `temp/validation/sourcekit-preflight-marker-cache-serial-20260520-144140.log`.
- Completed after the latest full audit: LSP configured-provider workspace environment non-ready result assembly now uses `buildEnvironmentPreflightResult()` so command profile propagation, `blockProvider`, cached flags, blocked workspace keys/roots, and check ordering stay identical across workspace-model and no-workspace-model branches. Syntax and focused Go/Rust workspace validation passed in `temp/validation/lsp-workspace-env-preflight-helper-syntax-20260520-144356.log` and `temp/validation/lsp-workspace-env-preflight-helper-tests-20260520-144414.log`.
- Completed after the latest full audit: Go/Rust workspace preflight partition list/check formatting now uses `src/index/tooling/preflight/workspace-partition-checks.js`, preserving provider-specific partition discovery, cache keys, commands, and failure labels. Syntax and focused Go/Rust provider validation passed in `temp/validation/provider-workspace-partition-helper-20260520-154413.log`.
- Completed after the latest full audit: Lua, YAML, Zig, and Rust preflight-language checks now share provider server/language matching while preserving per-policy diagnostics. Syntax and focused validation passed in `temp/validation/preflight-language-server-match-helper-20260520-154901.log`.
- No provider preflight family remains in the top remaining queue before the next intentional full audit refresh.
- Related provider families may appear under LSP/sourcekit preflight when the report is filtered by `src/index/tooling`.

Implementation instructions:

- Start with provider-local helpers. A shared provider module is acceptable only if it owns a named result shape such as runtime-health status, fallback reason, or diagnostic capture summary.
- Preserve provider-specific quarantine behavior, fingerprinting, cache keys, capture paths, package-manager detection, failure classification, and user-facing warning text.
- Keep planner decisions separate from runtime health observation. A planner helper should not import runtime probe state unless that dependency already exists.
- Avoid broad "tooling provider common" abstractions that make language-specific fallback rules harder to review.

Validation:

- Run Pyright planner/provider/runtime-health tests and any LSP preflight tests tied to touched files.
- Add a focused fixture if the extraction changes fallback labels, quarantine state, or diagnostic capture shape.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves a live provider-family candidate, confirm the fix does not create a broader provider clone.

### Conditional Future Audit: CLI And Navigation Option Parsing

Recorded status:

- Completed after the latest full audit: `src/shared/cli/argv.js` now owns the shared `--flag value` / `--flag=value` reader used by `bin/pairofcleats.js`, `tools/tooling/navigation.js`, and `src/shared/cli/legacy-entrypoint.js`, while command validation, help, defaults, JSON output, dispatch, and warning policy stay local. Focused CLI/navigation/dispatch validation passed in `temp/validation/cli-argv-helper-focused-tests-20260520-141437.log`.
- Package entrypoint parsing is complete and has 0 current hits in package entrypoints/helper.
- Completed after the latest full audit: shared child-exit semantics now live in `src/shared/subprocess/exit-semantics.js` and are reused by CLI utilities, postinstall exit handling, and the TUI wrapper while preserving status/signal precedence. Syntax and focused validation passed in `temp/validation/child-exit-semantics-syntax-20260520-151407.log` and `temp/validation/child-exit-semantics-tests-20260520-151407.log`.
- Completed after the latest full audit: `bin/pairofcleats.js` now validates/routes `index build --workspace` and `workspace build` through one file-local helper, preserving build flag allowlists and value-flag enforcement. Syntax and focused validation passed in `temp/validation/pairofcleats-workspace-build-dispatch-helper-20260520-153820.log`.
- Risk delta, risk explain, and context-pack option definitions now share narrow risk-filter and report-format option sets while preserving command-local aliases and required arguments.
- Additional small hits include residual CLI/report scripts outside the risk option tail.

Implementation instructions:

- Extract only a narrow argv, exit, or validation primitive when the callers share identical behavior.
- Keep command-specific validation, help text, default values, JSON output, exit codes, command registry dispatch, and public command names local.
- Do not make `bin/pairofcleats.js` depend on packaging-only helpers or make packaging scripts depend on CLI dispatch internals.
- Preserve Windows path parsing and quoted argument handling. Do not normalize paths earlier than current callers do.

Validation:

- Run command registry, CLI help, wrapper-exit, navigation/tooling, and package Sublime/VS Code tests if those entrypoints are touched again.
- Verify at least one `--flag=value`, one `--flag value`, and one missing-value error case for every command family touched.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves live CLI/package candidates, check affected files rather than only the global count.
- The workspace-build dispatch helper slice passed syntax plus `cli/general/workspace-build-dispatch`, `cli/general/cli`, `cli/general/cli-completions-and-audit`, and `tooling/navigation-query` in `temp/validation/pairofcleats-workspace-build-dispatch-helper-20260520-153820.log`.

### Done: Editor And Search Command Plumbing

Recorded status:

- The previous `extensions/vscode/search-contract.js:92 <-> 44` option/payload normalization clone is complete and has 0 current hits.
- Sublime production command plumbing is complete and has 0 current hits in `sublime/PairOfCleats/commands/{analysis,index,map,search}.py` and `sublime/PairOfCleats/lib/views.py`.
- `tests/helpers/sublime/search_behavior.py` also has 0 current hits after matching the production helper shape.
- Saved-baseline Sublime test-helper examples in `tests/helpers/sublime/{analysis,index,map,operator}_behavior.py` should be revisited only after a future intentional full audit proves live overlap and a helper would improve readability.
- Related VS Code renderer hits are tracked separately under retrieval/integration output renderer families.

Implementation instructions:

- Keep Sublime-local helpers for editor selection, symbol extraction, status display, search transport kwargs, index settings validation, and command argument shaping; do not pull Python command behavior into JavaScript extension modules.
- Keep CLI query args, API request payloads, extension command payloads, and editor UI presentation as separate contracts.
- Preserve cancellation handling, editor status messages, quick-pick behavior, path redaction, and workspace-root selection.
- Do not extract the remaining Python test-helper clones unless a helper keeps individual command scenarios easier to read.

Validation:

- Sublime validation passed with `node --check` for the tooling test harness files, `git diff --check -- sublime tests\helpers\sublime\search_behavior.py`, `npx jscpd --config .jscpd.json --reporters console sublime` with 0 clones, and `node tests/run.js tooling/sublime/pycompile tooling/sublime/behavior-contract-matrix tooling/sublime/package-harness tooling/sublime/package-structure --lane=all --fail-fast --timeout-ms 30000` with 4 passed.
- Rerun Sublime command unit tests or Python checks after future editor-helper changes.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves live editor/search candidates, verify reductions do not move duplication into cross-editor abstractions.

### Conditional Future Audit: Ingest Adapter JSONL, Path, And Stats Loops

Recorded status:

- Saved-baseline examples included `tools/ingest/lsif.js`, `tools/ingest/scip.js`, `tools/ingest/ctags.js`, and `tools/ingest/gtags.js` JSONL/path/stat loop overlap.
- Treat those examples as stale until a future intentional full duplicate baseline refresh proves a live adapter candidate.
- These are tooling paths, but ingest correctness affects generated artifacts and downstream retrieval quality if future work reopens the family.

Implementation instructions:

- Keep shared ingest helpers in `tools/ingest/shared.js` only for repo-relative path normalization, safe stat increments, streaming JSONL write/error handling, and deterministic record sorting if the adapters share the exact behavior.
- Leave LSIF, SCIP, ctags, and gtags payload interpretation local. Do not normalize semantic record kinds through a generic adapter wrapper unless there is already a documented ingest contract.
- Preserve source path redaction, root-relative resolution, skipped-record counters, parse-error counters, output JSONL ordering, and malformed-input behavior.
- Keep helpers dependency-light so ingest tools remain runnable in minimal environments.

Validation:

- Run focused ingest adapter tests for each touched adapter and a tiny end-to-end ingest fixture if available.
- Verify malformed JSONL, missing path, duplicate symbol, and skipped-record counter behavior for the adapter being refactored.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves live ingest candidates, compare the ingest family specifically.

### Conditional Future Audit: Native Setup And Release Maintenance Helpers

Recorded status:

- Done after the latest full audit: `tools/setup/rebuild-native.js:171 <-> 131`, spawn-result/error handling overlap. The rebuild and package install-script paths now share `runNpmCommand()` and route npm through `spawnResolvedSubprocessSync('npm', ...)`; validation is logged at `temp/validation/rebuild-native-resolved-npm-focused-tests-20260520-123837.log` and `temp/validation/rebuild-native-resolved-npm-final-checks-20260520-123946.log`.
- Done after the latest full audit: `tools/release/assemble-bundle.js:32 <-> tools/release/readiness-gate.js:60`, sorted file walk or release artifact enumeration overlap. Both release scripts now call `tools/release/file-walk.js` for deterministic file collection; validation is logged at `temp/validation/release-file-walk-helper-focused-checks-20260520-130651.log`.
- Related setup/release scripts may have small option and filesystem traversal hits.

Implementation instructions:

- Extract a tiny spawn-result helper only if cwd, environment construction, stdio mode, shell usage, command echoing, and failure text are identical.
- Extract sorted file-walk helpers only when filtering, path normalization, symlink behavior, and traversal ordering are the same.
- Keep release gate semantics, bundle assembly layout, readiness failure wording, and native rebuild platform rules local.
- Avoid adding package-manager, network, or filesystem side effects to helper import time.

Validation:

- Run native setup/rebuild tests or dry-run commands and release readiness/bundle tests tied to touched files.
- Verify failure output text for missing native dependency and missing release artifact cases.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves live setup/release candidates, inspect setup/release hits directly.

### Done: USR Matrix Baseline Profile Boilerplate

Recorded status:

- The repeated framework profile blocks and family capability profile rows are complete.
- `tools/usr/generate-usr-matrix-baselines/{datasets,builders}.mjs` have 0 current duplicate hits in the full audit.
- Related USR gate/bench scripts remain in the broad benchmark/scenario family, but baseline generation no longer leads the USR duplicate list.

Implementation instructions:

- Keep named local constants/helpers for repeated binding semantics, route semantics, ordering arrays, and common capability profiles.
- Keep framework-specific edge cases, generated artifact paths, gate criteria, baseline IDs, and approval-lock meanings explicit at the call sites.
- Do not replace readable matrix rows with opaque builders if reviewers need to audit exact USR contract coverage.
- Preserve stable output ordering and generated JSON field order if the current governance tooling depends on it.

Validation:

- `node tools/usr/generate-usr-matrix-baselines.mjs --check` passed with no registry drift.
- `node tests/run.js contracts/usr-matrix-helper-modules ci/usr-guardrail-registry-coverage conformance/language-shards/foundation/validation --lane=all --fail-fast --timeout-ms 30000` passed with 3 passed.
- Full `npm run audit:duplicates` reports 0 current hits in the baseline generator files.

### Conditional Future Audit: SCM And Git Metadata Retry Bookkeeping

Recorded status:

- Git meta-batch retry/timeout heat-entry bookkeeping has been reduced with a local helper.
- File metadata shape normalization now lives in `src/index/scm/file-meta.js`, and git/jj path enumeration now reuses `src/index/scm/paths.js`.
- Saved-baseline SCM signal should be treated as lower-priority cache, prefetch, or probe guidance until the next intentional full audit refresh proves a live clone remains.

Implementation instructions:

- Extract any remaining retry bookkeeping only when timeout plan keys, heat-entry shape, diagnostics counters, cache keys, and retry labels are identical.
- Extract any remaining file/path handling only if ignore handling, path normalization, sort order, symlink behavior, and command output handling match exactly.
- Keep git command invocation, stdout/stderr parsing, error classification, and fallback behavior local to the provider modules.
- Avoid extra process spawns, filesystem stats, or unbounded arrays in metadata hot paths.

Validation:

- Run SCM/git metadata, prefetch, timeout, path normalization, and file-meta snapshot tests tied to touched files.
- Add a fixture for retry exhaustion or timeout heat accounting if the helper changes bookkeeping shape.
- The file metadata/path helper slices passed direct import smoke and focused path tests in `temp/validation/scm-file-meta-import-smoke-20260520-151044.log` and `temp/validation/scm-path-helper-tests-20260520-151745.log`; one broader SCM runner exceeded 30 seconds after the stale call-site bug was fixed and is logged in `temp/validation/scm-file-meta-focused-tests-rerun-20260520-150846.log`.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves live SCM candidates, compare SCM hits specifically.

### Conditional Future Audit: Retrieval Operational Helper Residuals

Recorded status:

- Saved-baseline examples included `src/retrieval/cli-index.js` and `src/retrieval/lmdb-helpers.js` HNSW/vocab hydration and artifact lookup overlap.
- Federation args/select list normalization is complete through `src/retrieval/federation/normalize.js`.
- This is separate from renderer overlap in `src/retrieval/output/**`.

Implementation instructions:

- Share HNSW/vocab hydration primitives only if filesystem artifact resolution, LMDB metadata lookup, error behavior, and cache invalidation semantics are identical.
- Keep CLI-facing artifact discovery separate from LMDB-internal lookup when either path has different missing-artifact diagnostics.
- For federation arguments, share list normalization only when wildcard, empty list, default selection, and invalid provider behavior match.
- Do not change retrieval ranking, candidate filtering, vector loading, or output rendering as part of operational helper cleanup.

Validation:

- Run retrieval CLI index, LMDB helper, federation args/select, and artifact-loading tests tied to touched files.
- Include a missing-artifact and invalid-provider fixture if helper extraction touches error paths.
- The federation list normalizer slice passed syntax and focused federation validation in `temp/validation/retrieval-federation-list-normalizer-syntax-20260520-145406.log` and `temp/validation/retrieval-federation-list-normalizer-tests-20260520-145422.log`.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves live retrieval-operational candidates, verify cleanup does not create renderer or ranking regressions.

### Done: VFS Graph Assembly Helpers

Recorded status:

- Map call/usage edge construction is complete. `src/map/build-map/edges.js` now has 0 current duplicate hits after the map-local relation edge helper extraction.
- VFS segment coalesce/group construction is complete. `src/index/tooling/vfs/segments.js` now has 0 current duplicate hits after the local coalesced segment group factory extraction.
- Saved-baseline VFS signal is benchmark/scenario-oriented, led by `tools/bench/vfs/vfsidx-lookup.js`, and belongs under benchmark family cleanup only if a future intentional audit proves live overlap or a production VFS helper reappears.

Implementation instructions:

- Do not revisit map edge construction unless a future graph builder shares the exact same source/link-target/member semantics.
- Keep the VFS coalesce-group factory local to `segments.js`; it must continue to preserve interning, range ordering, segment identity, collision behavior, and merge mutation semantics.
- Do not introduce graph-wide abstractions that couple map building to VFS internals.

Validation:

- Map validation passed with `node --check`, `npx eslint --fix`, and `node tests/run.js map/build-contract-matrix indexing/map/code-map-contract-matrix --lane=all --fail-fast --timeout-ms 30000`.
- VFS validation passed with `node --check src/index/tooling/vfs/segments.js` and `node tests/run.js --lane=all --match tooling/vfs --fail-fast --timeout-ms 30000`.
- Add before/after artifact snapshot comparison if group identity or ordering is touched.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves live VFS candidates, compare VFS hits by file pair.

### Done: USR Validator Shape Helpers

Recorded status:

- `src/contracts/schemas/**` has 0 current duplicate hits after the schema contract fragment pass.
- `src/contracts/validators/usr-matrix/**` has 0 current duplicate hits after the USR report-shaping, row-diagnostics, and report-envelope helper pass.

Implementation instructions:

- Contracts in `src/contracts/**` remain authoritative. Do not hide required fields behind a builder if that makes the validator less reviewable.
- Extract validator fragments only when the repeated object has one semantic meaning across all consumers.
- Preserve `$id`, `required`, `additionalProperties`, enum values, descriptions, validator error paths, and generated contract artifacts.
- Prefer named validator fragments over generic shape combinators.
- Treat readiness, governance, observability/security, scenarios, and benchmark validators as separate contracts unless a shared helper preserves their gate-specific semantics.
- Keep operational/release readiness blocked-status paths and benchmark row warning-as-failure paths local unless a future helper can preserve their exact status, warning, and row `pass` behavior.

Validation:

- Run contract-matrix, schema validator, USR matrix, and generated artifact tests after any future contract-adjacent edit.
- Run `node tools/testing/refresh-governance.js` if generated governance or docs change.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves live schema or USR validator candidates, document any nonzero scoped count explicitly.

### Conditional Future Audit: Retrieval And Integration Output Renderer Families

Recorded status:

- Risk explanation narrative confidence, rule-reference normalization, flow/partial-flow selection, path formatting, call-site evidence shaping, confidence labels, and SARIF watch-window normalization now share model primitives.
- Saved-baseline production examples included `src/shared/risk-explain-model.js`, `src/retrieval/output/risk-explain.js`, `extensions/vscode/analysis-renderers.js`, `src/retrieval/output/risk-sarif.js`, `src/retrieval/output/graph-context-pack.js`, `src/retrieval/output/composite-context-pack.js`, `src/retrieval/output/suggest-tests.js`, and integration tooling context/impact helpers.
- Treat those examples as stale until a future intentional full duplicate baseline refresh proves live overlap; they are not automatically safe to share because CLI text, SARIF, context-pack JSON, and VS Code rendering are different user-facing surfaces.

Implementation instructions:

- First split model construction from rendering. A shared model helper is safer than a shared renderer.
- Preserve human text, SARIF fields, context-pack JSON keys, VS Code display sections, ordering, omitted-field behavior, path redaction, and severity formatting.
- Do not import extension rendering code into production retrieval output modules or vice versa unless an existing shared model module already owns the contract.
- Be especially careful with VS Code CJS extension packaging versus ESM production retrieval modules.
- Add golden output fixtures before extraction if the current tests do not pin text and JSON output.

Validation:

- Run retrieval output golden/contract tests, SARIF contract tests, context-pack tests, VS Code renderer tests, and path-redaction tests.
- Compare before/after output for at least one risk, graph context, composite context, and suggest-tests sample.
- The risk model/SARIF primitive slice passed `node --check`, `npx eslint --fix`, and `node tests/run.js retrieval/output/risk-explanation-contract-matrix analysis/risk-explain-surface-parity tooling/vscode/context-risk-renderers --lane=all --fail-fast --timeout-ms 30000`.
- The context-pack federated risk annotation helper slice passed syntax checks, `context-pack/risk-filters-parity`, direct federated risk parity, and SQLite manifest-normalization validation in `temp/validation/production-duplicate-helpers-focused-final-20260520-134716.log`.
- The context-pack risk budget projection slice passed `node --check` for `src/context-pack/assemble/budgets.js` plus 7 focused context-pack, retrieval-output, and risk-explain tests with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/context-pack-risk-budget-helper-dedupe-20260520.log`.
- The TypeScript chunk metadata helper slice passed syntax checks and `lang/typescript/typescript-contract-matrix` in `temp/validation/typescript-chunk-metadata-helper-20260520-135419.log`.
- The LSP hover metric counter helper slice passed syntax checks plus hover runtime/payload modularization and semantic-token/inlay-hint coverage in `temp/validation/hover-metric-counters-helper-20260520-135712.log`.

### Conditional Future Audit: Language And Tree-Sitter Adapter Lookalikes

Recorded status:

- Java/Kotlin/CSharp dotted call and usage collection is complete through `src/lang/shared.js`; Lua, Ruby, and C-like adapters also share the same parameterized collector while preserving their custom token patterns and skip rules. C#/Java relation/dataflow helpers, SQL scanner state helpers, tree-sitter line/language-id utilities, TypeScript declaration sink sharing, C-like/Swift brace bounds, and shared await/yield/throw dataflow fact collection are also complete.
- Heuristic adapter usage scanning, TypeScript function-like heuristic chunk assembly, and JS/TS relation call-detail primitives are complete.
- Completed after the latest full audit: SQL scanner quote/comment/dollar-quote state handling now uses scanner-local state helpers shared by statement splitting and comment stripping; focused SQL syntax/chunking validation passed in `temp/validation/sql-scanner-state-helper-syntax-20260520-142827.log` and `temp/validation/sql-scanner-state-helper-focused-tests-20260520-142831.log`.
- Completed after the latest full audit: `src/shared/lines.js` now owns newline counting and indexed line access for CSS and tree-sitter chunking, and `src/lang/tree-sitter/language-id.js` now owns extension-to-language routing shared by main-thread and worker tree-sitter paths. Syntax validation passed in `temp/validation/language-tree-sitter-shared-utils-syntax-20260520-143158.log`; focused validation passed tree-sitter chunks, parse determinism, and config tree-sitter meta parity. The 31.2s `indexing/chunking/formats/format-fidelity` timeout preserved in `temp/validation/language-tree-sitter-shared-utils-focused-tests-20260520-143242.log` is historical/intermediate; later focused format-fidelity proof passed in `temp/validation/config-tree-sitter-entry-helper-20260520.log`.
- Saved-baseline production examples included PHP/Rust/Shell/docmeta scanners and language-specific relation assembly outside the shared call/usage collectors; TypeScript AST/Babel declaration emission, C-like/Swift brace scanning, C-like type-body member loops, and the Lua/Ruby/C-like collector lookalikes are stale in the saved report until a future intentional audit refresh proves any live overlap remains.
- Many of these clones express language grammar behavior rather than shared business logic.

Implementation instructions:

- Defer by default unless two adapters use the same grammar rule with the same tokens, precedence, and failure behavior.
- Prefer language-family helpers, for example JavaScript/TypeScript-only or C-like-only, over repo-wide parsing abstractions.
- Preserve chunk boundaries, symbol kinds, relation kinds, import resolution behavior, parser fallback behavior, and worker payload shape.
- If tree-sitter worker setup is shared, keep worker packaging/import constraints explicit.

Validation:

- Run language-specific import/relation/chunking tests for every touched language.
- Run tree-sitter worker tests and cross-language conformance shards if worker/chunking setup changes.
- Add fixtures for the grammar constructs that motivated the helper; do not rely only on `jscpd` count movement.
- The Java/Kotlin/CSharp helper slice passed `node --check`, `npx eslint --fix`, and `node tests/run.js indexing/chunking/formats/format-fidelity --lane=all --fail-fast --timeout-ms 30000`.
- The heuristic adapter slice passed `npx eslint --fix` and `node tests/run.js lang/contracts/managed-heuristic-adapters lang/contracts/template-heuristic-adapters lang/contracts/dynamic-heuristic-adapters lang/contracts/data-interface-heuristic-adapters lang/contracts/build-dsl-heuristic-adapters lang/registry/registry-contract-matrix --lane=all --fail-fast --timeout-ms 30000`.
- The TypeScript heuristic chunker slice passed `npx eslint --fix` and `node tests/run.js lang/typescript/typescript-contract-matrix lang/contracts/heuristic-chunkers-contract lang/contracts/end-offset-normalization indexing/relations/keyword-skip-heuristics --lane=all --fail-fast --timeout-ms 30000`.
- The JS/TS relations slice passed `npx eslint --fix` and `node tests/run.js lang/contracts/javascript-relations-contract lang/contracts/typescript-relations-contract indexing/relations/call-graph-contract-matrix lang/javascript/javascript-contract-matrix lang/typescript/typescript-contract-matrix indexing/relations/keyword-skip-heuristics --lane=all --fail-fast --timeout-ms 30000`.
- The Nix lexical-state helper slice passed `node --check`, focused Nix collector coverage, non-JS import scan, and import-resolution language coverage in `temp/validation/nix-import-collector-lexical-helper-20260520-133128.log`.
- The Lua/Ruby/C-like call/usage collector slice passed `node --check` for the touched language files plus 15 focused language/relation/conformance tests with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/language-call-usage-helper-dedupe-rerun-20260520.log`.
- The TypeScript declaration sink slice passed syntax and focused TypeScript validation in `temp/validation/typescript-declaration-sink-syntax-20260520-151044.log` and `temp/validation/typescript-declaration-sink-tests-20260520-151310.log`.
- The brace-bounds and dataflow helper slices passed focused C-family/Swift/Kotlin/PHP validation in `temp/validation/brace-bounds-helper-tests-20260520-151932.log`, `temp/validation/language-dataflow-helper-tests-20260520-152307.log`, and `temp/validation/language-dataflow-php-focused-20260520-152349.log`.
- The type-body member helper slice passed syntax and focused C-family/Kotlin/PHP validation in `temp/validation/language-type-member-helper-20260520-155639.log`.

### Conditional Future Audit: Benchmark And Scenario Script Families

Recorded status:

- Simple benchmark CLI parsing is complete for many index, SQLite, cache, and embedding benches through `parseSimpleBenchArgs` in `tools/bench/shared.js`; `tools/bench/shared.js` and `tools/bench/sqlite/jsonl-streaming.js` now have 0 current hits.
- Regex, hash, and compression micro-benchmarks now share sampled timing and warmup mechanics through `runSampledBench()` in `tools/bench/micro/utils.js`; benchmark-specific rates, ratios, output fields, and measured operations stay local.
- Simple benchmark CLI parsing, USR gate/bench item35-item40 helpers, graph benchmark mechanics, VFS bench primitives, micro-bench sampled timing, index streaming reporting, and index throughput comparison helpers are complete. Graph measured-operation residuals, measured-operation setup in benchmark families, and test fixtures dominated the saved numeric baseline, but no exact-current saved-report fragments remained after the 2026-05-21 refresh.
- Saved-baseline examples included `tools/bench/index/*`, `tools/bench/sqlite/*`, `tools/bench/graph/*`, and scenario-heavy test fixtures; revisit them only when a future audit proves current high-value overlap.

Implementation instructions:

- Defer test and scenario clones by default. Extract only when a family-specific runner would make scenario intent clearer.
- For benches, group by benchmark family and keep log fields, default arguments, cache roots, and result JSON stable.
- For USR items, keep item-specific names, criteria, generated artifact paths, measured operations, metric keys, thresholds, console strings, JSON shapes, and exit behavior local.
- For index/SQLite/VFS benches, create tiny family helpers only for workspace setup, deterministic fixture generation, and common CLI parsing; leave measured operations local.

Validation:

- Run each affected script with tiny deterministic fixtures.
- Run docs/contract-matrix checks when generated command or governance docs change.
- Only a future intentional full duplicate baseline refresh should rerun `npm run audit:duplicates`; if it proves live benchmark/scenario candidates, compare family slices rather than trusting global movement.
- The simple parser slice passed `node --check`, `npx eslint --fix`, a direct `parseSimpleBenchArgs` behavior probe, and `node tools/bench/sqlite/jsonl-streaming.js --count 3 --mode current`.
- The VFS bench helper slice passed `npx eslint --fix` and tiny deterministic `--json` smoke commands for `vfsidx-lookup`, `token-uri-encode`, `hash-routing-lookup`, `bloom-negative-lookup`, `cdc-segmentation`, `coalesce-docs`, and `segment-hash-cache`.
- The SQLite benchmark bundle-fixture slice passed syntax checks, tiny `build-from-bundles` and `incremental-update` smoke commands, and whitespace checks in `temp/validation/sqlite-bench-shared-fixture-rerun-20260520-132413.log`.
- The index streaming benchmark reporting slice now shares peak-heap tracking, baseline/current output, hash-compare printing, and delta formatting through `tools/bench/index/streaming-bench-reporting.js`, while chunk metadata and symbol artifact row generation and measured operations remain local. Tiny compare-mode smokes passed in `temp/validation/bench-index-streaming-reporting-smoke-grouped-20260520-141606.log`.
- The index throughput compare helper slice shares current/baseline throughput printing across index artifact writer and build-state sidecar benches while measured operations stay local. Syntax and tiny compare-mode smokes passed in `temp/validation/bench-throughput-helper-syntax-20260520-152452.log` and `temp/validation/bench-throughput-helper-smokes-20260520-152452.log`.
- The micro-bench sampled timing slice passed syntax checks and tiny JSON smoke commands for regex, hash, and compression in `temp/validation/micro-bench-sampled-helper-dedupe-rerun-20260520.log`; the first smoke log preserved a hash direct-backend payload mismatch that was fixed in the same slice.

### Conditional Future Audit: Test Harness Families

Recorded status:

- Test clones remain the largest part of the saved numeric baseline. Completed helper families now include VS Code runtime, CI LSP SLO, Stage1 tree-sitter scheduler, risk context-pack fixtures, watch queue tests, worker-pool fixtures, file-processor scanned-entry/test-processor fixtures, cached-bundle fixtures, smoke test fixtures, retrieval pipeline fixtures, retrieval mixed-profile backend fixtures, retrieval compatibility-load fixtures, retrieval score-breakdown fixtures, retrieval federation repo fixtures, retrieval SQLite FTS rank fixtures, retrieval explain/output fixtures, filtered-minhash fixtures, heavy-file Java/Swift fixtures, show-throughput scan tests, SQLite partial bundle fallback tests, SQLite shard fixtures, SQLite token-postings streamed fixtures, API analysis error-classification fixtures, API response-capture fixtures, LSP fake-process fixtures, LSP VFS didOpen/partial-open fixture reuse, benchmark language repo fixtures, bench-runner fixtures, graph-relations artifact fixtures, type-inference crossfile sink-call fixtures, TUI observability tests, TUI supervisor protocol tests, download-dicts tests, SourceKit preflight provider bootstrap fixtures, and expanded VFS manifest writer fixtures. Earlier examples such as provider workspace preflight fixtures, storage/graph fixtures, and broad matrix scenario tests should be revisited only when a future audit proves current high-value overlap.
- The 2026-05-21 saved-report exact-current refresh leaves 0 fragments in `temp/validation/saved-jscpd-exact-current-fragments-refresh-20260521.log`. Earlier interim notes about the 27-fragment list are historical only; revisit duplicate-code work only when a future intentional full audit refresh shows current high-value duplicates.

Implementation instructions:

- Leave duplicated setup in place when it makes the scenario readable.
- Extract test helpers only when the helper name makes the tested behavior clearer than the duplicated setup.
- Keep assertion blocks explicit. Do not hide the expected failure mode, output keys, or fixture deltas inside a generic harness.
- Prefer test-family helpers under the existing `tests/**/helpers` directory rather than production modules.

Validation:

- Run changed tests through `node tests/run.js ... --lane=all` so the runner applies the repository test environment helper. Use direct `node` only for syntax checks such as `node --check`.
- If a test runs longer than 30 seconds, cancel it and report it as skipped per repository guidance.
- Run the relevant lane only after focused tests pass.
- The retrieval mixed-profile fixture, retrieval pipeline fixture reuse, and TUI supervisor protocol slices passed their focused `node tests/run.js ... --lane all --timeout-ms 30000` commands in `temp/validation/retrieval-mixed-profile-fixture-20260520-132449.log`, `temp/validation/retrieval-pipeline-fixture-reuse-20260520-132546.log`, and `temp/validation/tui-supervisor-fixture-20260520-132608.log`.
- The retrieval federation repo-fixture slice passed syntax checks and focused federation cache/redaction/search/cache-key/selection tests in `temp/validation/retrieval-federation-fixture-dedupe-20260520-133417.log`.
- The file-processor fixture slice passed syntax checks and focused framework docmeta, partial-language diagnostics, read-failure, unsupported-language, and skip tests in `temp/validation/file-processor-fixture-dedupe-20260520-133652.log`.
- The retrieval SQLite FTS rank fixture slice passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/rank-sqlite-fts-backend-refactor-20260520-003.log`.
- The API analysis error-classification fixture slice passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/analysis-error-classification-20260520-match.log`.
- The type-inference crossfile sink-call fixture slice passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/crossfile-fixture-dedup-20260520-001.log`.
- The SQLite token-postings streamed fixture slice passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/token-postings-fixture-dedupe-20260520-135439.log`.
- The existing VFS manifest writer helper adoption passed with 4 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/vfs-writer-helper-existing-adoption-20260520-140120.log`.
- The expanded VFS manifest writer helper adoption now covers manifest roundtrip and merge-heap deterministic tests; focused runner validation passed with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/vfs-manifest-writer-more-adoption-tests-20260520-141706.log`.
- The SourceKit preflight provider bootstrap fixture slice passed focused SourceKit preflight/provider validations with 9 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/sourcekit-preflight-helper-expanded-tests-20260520-141114.log`.
- The summary report compare/parity slice now uses deterministic summary payload helpers backed by production hit-comparison/stat functions while keeping build-fixture coverage for summary build/lock tests. Syntax, targeted ESLint, and focused runner validation passed for `tooling/reports/summary/report-compare-memory`, `tooling/reports/summary/report-compare-sqlite`, `tooling/reports/summary/report-parity-sqlite`, and `tooling/reports/summary/report-parity-sqlite-fts` in `temp/validation/summary-report-proof-followup-20260521.log`; the earlier timeout in `temp/validation/summary-report-compare-helper-dedupe-20260520.log` is historical.
- The Stage1 nested scheduler probe helper slice passed syntax checks and focused runner validation for the stage1.io/stage1.postings and stage1.proc nested-deadlock tests with 2 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/stage1-nested-scheduler-probe-helper-dedupe-20260521.log`.
- The Rust LSP workspace fixture slice passed syntax checks and focused runner validation for nested preflight, root partitioning, partial coverage, negative cache, metadata cache, and timeout-local-cache tests with 6 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/rust-lsp-workspace-fixture-dedupe-20260521.log`.
- The compact SQLite and CI artifact build tool display/logger slice passed syntax checks and direct help smokes in `temp/validation/tool-display-logger-helper-help-smokes-20260521.log`. The focused SQLite maintenance runner timeout in `temp/validation/tool-display-logger-helper-dedupe-20260521.log` and the artifact-export smoke failure in `temp/validation/tool-display-logger-helper-smokes-20260521.log` are historical/intermediate slice records only; the current duplicate checkpoint is the later exact-current saved-report refresh with 0 still-current fragments.
- The bench-language display logger adapter slice passed syntax checks, targeted ESLint, focused bench logger validation, bench log closeout/emergency-close validation, and TUI display/progress validation in `temp/validation/p2-display-logger-adapter-20260521.log`.
- The hit-comparison summary slice passed syntax checks, targeted ESLint, the direct `retrieval/hit-comparison-summary` runner test, and diff checks in `temp/validation/retrieval-hit-comparison-summary-dedupe-20260521.log`.
- The compare-models option-set adoption slice passed syntax checks, targeted ESLint, `tooling/reports/capabilities-report`, `shared/runtime-capability-manifest-contract`, `cli/general/cli-completions-and-audit`, `retrieval/hit-comparison-summary`, direct help smoke, and diff checks in `temp/validation/compare-models-options-adoption-20260521.log`.
- The tooling provider run fixture slice passed syntax checks, targeted ESLint, focused provider progress/preflight validation, and diff checks in `temp/validation/tooling-provider-run-fixture-dedupe-20260521.log`.
- The tooling install exit-code helper slice passed syntax checks, targeted ESLint, focused tooling install failure/missing-requirement validation, and diff checks in `temp/validation/tooling-install-exitcode-helper-dedupe-20260521.log`.
- The extracted-prose find-file helper adoption slice passed syntax checks, targeted ESLint, the focused `indexing/extracted-prose/yield-profile-persisted-skip` runner test at 19.8s, and diff checks in `temp/validation/extracted-prose-find-file-helper-adoption-20260521.log`.
- The API context-pack route fixture slice passed syntax checks, targeted ESLint, focused default-repo/workspace-without-repo route validation, and diff checks in `temp/validation/api-context-pack-route-fixture-dedupe-20260521.log`.
- The API index-route invocation helper slice passed syntax checks, targeted ESLint, focused client-error/decode-validation route tests, and diff checks in `temp/validation/api-index-route-invocation-helper-dedupe-20260521.log`.
- The API route path-segment helper slice passed syntax checks and focused request-helper, index-route decode, and index-route client-error validation in `temp/validation/api-route-segment-helper-focused-20260521.log`; the earlier selector mistake and aborted full-suite attempt is preserved in `temp/validation/api-route-segment-helper-20260521.log`.
- The ingest missing-input helper slice passed syntax checks, targeted ESLint, focused LSIF/SCIP/gtags ingest validation, and diff checks in `temp/validation/ingest-missing-input-helper-dedupe-20260521.log`.
- The indexer-service CLI fixture slice passed syntax checks, targeted ESLint, and diff checks in `temp/validation/indexer-service-cli-fixture-dedupe-20260521.log`; the later timeout-proof follow-up split `services/indexer/queue-identity-cli` into status, enqueue, and shutdown/stop-accepting tests that passed 3/3 with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/queue-identity-cli-split-validation-20260521.log`, split `services/indexer/repair-cli` into focused quarantine, retry, purge, inspect, unlock, and cleanup-orphans tests, and passed 6/6 with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/repair-cli-split-validation-rerun-20260521.log`; that runner log preserves an initial malformed ESLint invocation. Corrected targeted ESLint proof for the split repair CLI files passed in `temp/validation/repair-cli-split-eslint-rerun-20260521.log`.
- The script-coverage fixture slice passed syntax checks, targeted ESLint, focused harness/wiring validation, and diff checks in `temp/validation/script-coverage-fixture-dedupe-20260521.log`.
- The show-throughput report fixture slice passed syntax checks, targeted ESLint, focused compare-profile/JSON-contract validation, and diff checks in `temp/validation/show-throughput-report-fixture-dedupe-20260521.log`.
- The git metadata fixture slice passed syntax checks, targeted ESLint, focused fast-churn/no-history validation, and diff checks in `temp/validation/git-meta-fixture-dedupe-20260521.log`.
- The bench-runner fixture slice passed syntax checks, targeted ESLint, focused contract/utilization validation, and diff checks in `temp/validation/bench-runner-fixture-dedupe-20260521.log`.
- The graph-relations artifact fixture slice passed syntax checks, targeted ESLint, focused atomicity/determinism validation, and diff checks in `temp/validation/relation-artifact-fixture-dedupe-20260521.log`.
- The LSP VFS didOpen fixture adoption slice passed syntax checks, targeted ESLint, focused LSP/VFS validation, and diff checks in `temp/validation/lsp-vfs-didopen-fixture-adoption-20260521.log`.
- The VFS partial-LSP-open JSONL parser adoption slice passed syntax checks, targeted ESLint, focused VFS/LSP validation, and diff checks in `temp/validation/partial-lsp-open-jsonl-parser-adoption-20260521.log`.
- The git fast-nonzero fixture slice passed syntax checks, targeted ESLint, focused blame/meta validation, and diff checks in `temp/validation/git-fast-nonzero-fixture-dedupe-20260521.log`.
- The retrieval report footer helper slice passed syntax checks, targeted ESLint, focused renderer/model validation, and diff checks in `temp/validation/retrieval-report-footer-helper-dedupe-20260521.log`.
- The JSON fallback comma/end helper slice passed syntax checks, targeted ESLint, focused JSON/config-tree-sitter validation, and diff checks in `temp/validation/json-fallback-comma-helper-dedupe-20260521.log`.
- The query-plan helper projection slice passed syntax checks, targeted ESLint, focused retrieval pipeline validation, and diff checks in `temp/validation/query-plan-helper-projection-dedupe-20260521.log`.
- The retrieval format alignment helper slice passed syntax checks, targeted ESLint, focused output/pipeline renderer validation, and diff checks in `temp/validation/retrieval-format-align-helper-dedupe-20260521.log`.
- Optional extracted-prose pipeline tests now share code/extracted-prose index-pair setup, warning capture, and disabled-state assertions in `tests/retrieval/pipeline/helpers/optional-extracted-prose-index-fixture.js` while keeping SQLite fallback, compatibility mismatch, and legacy-manifest assertions local. Syntax, targeted ESLint, and focused runner validation passed in `temp/validation/optional-extracted-prose-helper-dedupe-20260521.log`.
- Retrieval SQLite FTS ranking tests now share configurable row seeding, per-row weight selection, and no-FTS-table setup in `tests/retrieval/backend/rank-sqlite-fts-fixture.js` while preserving allowed-id, weighting, missing-table, cache-arity, and overfetch assertions local. Syntax, targeted ESLint, and focused runner validation passed in `temp/validation/rank-sqlite-fts-fixture-dedupe-20260521.log`.
- The test runner now shares failure/log-output rendering and retry-run option construction across timeout/failure and first-pass/redo paths while preserving output formatting, logs, child tracking, and redo semantics. Syntax, targeted ESLint, and focused runner validation passed in `temp/validation/runner-dedupe-20260521.log`.
- Filter-bitmap and scheduler lookup-reader tests now share file-local fixture/meta normalization, allowed-id sorting, and delayed-close injection helpers while keeping contract assertions local. Syntax, targeted ESLint, and focused runner validation passed in `temp/validation/filter-bitmap-scheduler-reader-dedupe-20260521.log`.
- Risk interprocedural flow generation and risk explain output now share source endpoint construction, call-site trim primitives, path/evidence payload construction, and Markdown step-loop rendering while preserving full-flow, partial-flow, CLI, and renderer-specific shapes. Syntax, targeted ESLint, focused risk artifact validation, and focused risk explain validation passed in `temp/validation/risk-flow-explain-dedupe-20260521.log`.
- Risk validator, SQLite replace fallback, and lexicon relation-filter tests now share fresh risk-path fixture construction, rename-fault execution/capture, and Python relation-filter config/log capture while keeping failure-mode assertions explicit. Syntax, targeted ESLint, and focused runner validation passed in `temp/validation/risk-validator-storage-lexicon-dedupe-20260521.log`.
- VS Code inline-signal and extracted-prose prefilter tests now share context-pack payload queuing and profile pre-read skip fixture construction while keeping hover/diagnostic and enabled-vs-disabled profile assertions local. Syntax, targeted ESLint, and focused runner validation passed in `temp/validation/inline-signals-prefilter-dedupe-20260521.log`.
- The latest test-helper batches passed runner validations for download-dicts, SQLite partial bundle fallback, TUI observability helpers, and VFS manifest writer fixtures. The VFS fixture validation passed with 4 passed, 0 failed, 0 timeouts, and 0 skipped in `temp/validation/vfs-manifest-writer-fixture.log`. Older combined focused validation returned exit 0 with one SQLite `timed_out_after_pass` at 30.6s under parallel load; the individual worker validation for that SQLite slice passed.
- The retrieval compatibility/search fixture slice moved compatibility index construction and memory load options into `tests/helpers/index-compatibility-fixture.js`, removed the old retrieval-local mixed-profile fixture, and made the SQLite FTS preflight test reuse the existing search-pipeline fixture. Direct per-file validation passed for 5 changed tests in `temp/validation/index-compat-search-fixture-dedupe-direct-rerun-20260520.log`; the preceding runner-selector and direct-harness setup failures are preserved in `temp/validation/index-compat-search-fixture-dedupe-20260520.log` and `temp/validation/index-compat-search-fixture-dedupe-direct-20260520.log`.
- The API response-capture slice moved repeated mock response capture into `tests/services/api/response-capture.js`; the rerun passed 7 API tests with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/api-response-helper-dedupe-20260520-rerun1.log`. The initial no-match selector attempt is preserved in `temp/validation/api-response-helper-dedupe-20260520.log`.
- The LSP fake-process slice moved repeated fake child-process and tracked spawner setup into `tests/tooling/lsp/helpers/fake-child-process.js`; direct 30-second guarded validation passed 5 LSP tests with 0 failures and 0 timeouts in `temp/validation/lsp-fake-process-helper-dedupe-20260520.log`.
- The smoke and cached-bundle fixture slice moved repeated smoke repo/cache/env setup into `tests/smoke/smoke-utils.js` and cached-bundle reuse setup into `tests/indexing/file-processor/file-processor-fixture.js`. Runner validation passed `smoke/embeddings`, `smoke/sqlite`, `indexing/file-processor/cached-bundle`, and `indexing/file-processor/cached-bundle-does-not-emit-stale-metav2` with 4 passed, 0 failures, 0 timeouts, and 0 skipped in `temp/validation/smoke-cached-bundle-fixture-dedupe-20260520.log`.
- The retrieval score/ANN fixture slice moved score-breakdown hit setup into `tests/retrieval/contracts/score-breakdown-fixture.js` and made the vector-only ANN query-failure test reuse the shared search-pipeline fixture. Runner validation passed the score-breakdown parity/snapshot tests, vector-only ANN failure test, and SQLite FTS preflight test with 4 passed, 0 failures, 0 timeouts, and 0 skipped in `temp/validation/retrieval-score-ann-fixture-dedupe-20260520.log`.
- The benchmark language repo fixture slice moved synthetic repo/config/process setup into `tests/perf/bench/language-repos-fixture.js`; runner validation passed `perf/bench/language-closeout-exit` and `perf/bench/language-repos` with 2 passed, 0 failures, 0 timeouts, and 0 skipped in `temp/validation/bench-language-repos-fixture-dedupe-20260520.log`.
- The worker-pool fixture slice moved shared postings/dictionary/config/tokenization setup into `tests/indexing/workers/worker-pool-fixture.js`; the runner expanded the selectors to the worker-pool family and passed 13 tests with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/worker-pool-fixture-dedupe-20260520.log`.
- The safe-regex/segment production helper slice moved repeated risk prefilter attachment into `src/shared/safe-regex.js` and segment chunk-coordinate rebasing into `src/index/segments/chunk-meta.js`. Syntax checks and focused safe-regex, risk, segment, planned-segment, and tree-sitter scheduler validation passed with 9 passed, 0 failures, 0 timeouts, and 0 skipped in `temp/validation/risk-segment-production-helper-dedupe-rerun-20260520.log`; the first run in `temp/validation/risk-segment-production-helper-dedupe-20260520.log` caught a segment metadata regression before the helper preserved normal chunking metadata without changing scheduled tree-sitter UID behavior.
- The diff registry lock slice removed the local diff lock orchestration in favor of `withRegistryLock()` while preserving the diff-specific queue contention message. Syntax and focused diff/snapshot registry validation passed with 2 passed, 0 failures, 0 timeouts, and 0 skipped in `temp/validation/diff-registry-lock-helper-focused-rerun-20260520.log`; the broader first validation log at `temp/validation/diff-registry-lock-helper-dedupe-20260520.log` also records `services/api-search-asof` timing out at 30.3s and was not rerun per repository test policy.
- The graph/context memory telemetry slice moved process-memory snapshot and peak calculation into `src/shared/ops/resource-visibility.js`, shared by graph neighborhood and composite context-pack assembly while preserving the diagnostics object shape. Syntax and focused graph/context validation passed with 7 passed, 0 failures, 0 timeouts, and 0 skipped in `temp/validation/graph-context-memory-helper-dedupe-20260520.log`.

## Deferral Rules

Use these rules when deciding whether a duplicate from `temp/jscpd/jscpd-report.json` should remain in the baseline:

- Defer test clones when the duplicate setup makes scenario intent clearer than a shared test helper would. Refactor tests only when a helper removes confusing boilerplate and does not hide the assertion being tested.
- Defer generated artifacts, lockfiles, report snapshots, fixture payloads, and generated command inventories. Exclude them from `.jscpd.json` if they are noisy and intentionally machine-produced.
- Defer vendored mirrors and packaged third-party runtime files. Document the exclusion and keep the mirror update process clear instead of abstracting copied third-party code.
- Defer domain-specific lookalikes when the duplicate code expresses separate contracts. Examples include JSON vs SSE response handling, HNSW vs LanceDB backend behavior, or index-lock vs registry-lock diagnostics.
- Defer clones under roughly 30 lines unless they sit in a volatile production path or have already caused a maintenance bug.
- Defer when the extraction would introduce a broader dependency direction than the duplicate itself, such as production code importing test helpers or low-level shared modules importing CLI/tooling code.
- Defer when acceptance tests cannot pin behavior before the refactor. Add tests first, then extract.

## Audit Workflow For Each Slice

1. Start from a clean understanding of current ownership: inspect `git status --short` and do not overwrite unrelated edits.
2. Re-read `temp/jscpd/jscpd-report.json` and confirm the candidate still appears with the same file pair and approximate line span.
3. Inspect both candidate implementations before editing; do not assume the clone is semantically identical just because `jscpd` matched it.
4. Write or identify targeted tests that lock the domain behavior and edge cases.
5. Extract the smallest helper that removes the real duplication while keeping domain-specific decisions at the call sites.
6. Run targeted tests first. Run `npm run audit:duplicates` only once for a completed future family batch when the result should become the new measured baseline; do not rerun it for ordinary saved-report follow-up, micro-fixes, or documentation edits.
7. Update this file with the new baseline, the removed clone, and any deliberate deferrals.

## Performance And Quality Guardrails

- Do not turn report-only duplicate cleanup into a mandatory CI gate until the baseline is intentionally ratcheted and noisy categories are excluded.
- Prefer helpers that are allocation-neutral on hot paths. If a refactor adds arrays, object spreads, JSON serialization, filesystem reads, or process handlers, justify it with tests or measurements.
- Preserve streaming and batching behavior in index, artifact, SQLite, and bundle paths. Duplicate reduction is not a reason to materialize full datasets earlier.
- Keep CLI and API error codes, messages, and machine-readable payload fields stable unless the change is explicitly a behavior fix.
- Keep benchmark outputs stable enough for before/after comparison; when output changes are necessary, document them in the benchmark script or associated docs.
- New shared modules should have a narrow name tied to the actual domain. Avoid catch-all utilities such as `common.js`, `helpers.js`, or broad framework abstractions.
- After each slice, compare the duplicate report by candidate, not just total percentage. A lower total can still be worse if it hides a new production clone behind generated/test noise.

## Maintenance Rules

- Keep `npm run audit:duplicates` report-only; do not make the main test lane fail on the current baseline.
- Exclude generated or vendored mirrors rather than abstracting them into weak shared modules.
- Prefer narrow helpers that preserve existing module ownership.
- Update this file after meaningful duplicate-code reductions or audit-scope changes.
- Keep roadmap status in `docs/roadmap.md`; this file should remain the technical follow-up ledger for duplicate-code cleanup only.
