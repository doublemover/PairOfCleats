# Findings

## Scope
Branch-wide bug sweep across retrieval/CLI/cache, indexing runtime/build, language routing/import collectors, and tooling/docs contract surfaces.

## Findings
1. **[P3] Query-plan cache silently disables when both cache directories are unset**  
   Evidence: `src/retrieval/cli/cache-paths.js`, `src/retrieval/cli/run-search.js:191`  
   Impact: plan cache reuse is skipped with no explicit warning in this edge configuration, increasing query startup cost.  
   Fix: enforce/derive a fallback cache path (or emit a hard warning/error when cache is enabled but no path exists).[x] 

2. **[P3] Query-result disk cache silently disables when both cache directories are unset**  
   Evidence: `src/retrieval/cli/run-search-session.js:281`  
   Impact: query cache persistence/lookup can be disabled unintentionally, degrading repeated-query performance.  
   Fix: require a resolved cache path when query caching is enabled, or define an explicit fallback path.[x] 

3. **[P3] Memory-first hot-cache path can be effectively disabled when cachePath is falsy**  
   Evidence: `src/retrieval/query-cache.js:75`, `src/retrieval/cli/run-search-session.js:376`  
   Impact: memory-first mode can degrade into uncached behavior if path keying is unavailable.  
   Fix: use a stable synthetic key when no disk cache path exists.[x] 

4. **[P3] Empty-string cache dir behaves like "no cache"**  
   Evidence: `src/retrieval/cli/cache-paths.js`  
   Impact: an empty-string configuration value can accidentally disable both plan/result caches.  
   Fix: normalize empty-string cache dirs to a concrete fallback path or reject explicitly.[x] 

5. **[P3] Compatibility-key checks are serialized across modes**  
   Evidence: `src/retrieval/cli/load-indexes.js:314-321`  
   Impact: unnecessary startup latency from sequential `hasIndexMetaAsync` checks.  
   Fix: run compatibility target probes in parallel with `Promise.all`.[x] 

6. **[P3] Tantivy attach/build path runs serially by mode**  
   Evidence: `src/retrieval/cli/load-indexes.js:868-883`  
   Impact: avoidable latency in mixed-mode loads where attaches are independent.  
   Fix: parallelize independent attach operations.[x] 

7. **[P3] File-relations/repo-map mode loads are serialized**  
   Evidence: `src/retrieval/cli/load-indexes.js:520-556`  
   Impact: added startup latency for multi-mode searches.  
   Fix: overlap independent artifact loads with bounded parallelism.[x] 

8. **[P3] Optional extracted-prose disablement can be silent when output is suppressed**  
   Evidence: `src/retrieval/cli/load-indexes.js:244-253`  
   Impact: feature drop (comment joins disabled) may be invisible in non-emitting flows.  
   Fix: always emit telemetry/status metadata even when `emitOutput=false`.[x] 

9. **[P3] Cache persistence flag can remain active even when no path is writable**  
   Evidence: `src/retrieval/cli/run-search-session.js:733-761`  
   Impact: repeated prune/persist path checks with no possible write target.  
   Fix: tie persist flag to a validated writable cache path.
[x] 
10. **[P2] Prewarm does not clear stale hot-cache entries before upsert**  
    Evidence: `src/retrieval/query-cache.js:140-158`  
    Impact: removed disk entries can remain in process-hot cache and be served unexpectedly in memory-first paths.  
   Fix: clear/replace hot-cache map on prewarm before inserting fresh entries.
[x] 
11. **[P2] Disk cache miss/invalid file path does not evict hot cache state**  
    Evidence: `src/retrieval/query-cache.js:167-197`  
    Impact: stale in-memory entries may survive disk invalidation/removal events.  
   Fix: evict hot-cache state for that path on invalid signature/read failure.
[x] 
12. **[P2] Scheduler memory tokens are tied to CPU tokens by default**  
    Evidence: `src/index/build/runtime/scheduler.js:121-123`  
    Impact: memory-heavy phases can be underutilized on hosts with ample RAM but lower CPU token settings.  
    Fix: derive memory tokens from memory headroom policy, not CPU concurrency.
[x] 
13. **[P2] Effective embedding concurrency clamp is bypassed in non-scheduler fallback path**  
    Evidence: `src/index/build/runtime/workers.js:58-135`  
    Impact: embeddings can overcommit concurrency when scheduler is disabled.  
    Fix: pass clamped `effectiveEmbeddingConcurrency` into fallback queue creation.
[x] 
14. **[P2] Quantize worker payload path skips payload sanitization/DataCloneError hardening**  
    Evidence: `src/index/build/workers/pool.js:223-300`  
    Impact: clone failures can repeat and degrade quantization reliability without robust fallback behavior.  
    Fix: sanitize quantize payloads and reuse clone-failure disable/restart handling.
[x] 
15. **[P3] Planner I/O concurrency hard cap can underutilize high-core hosts**  
    Evidence: `src/index/build/tree-sitter-scheduler/plan.js:180-210`  
    Impact: plan phase leaves throughput on the table for very large repos.  
    Fix: scale cap from host capacity and workload size.
[x] 
16. **[P3] Tree-sitter lookup meta/page caches risk stale reuse across rebuilds in reused process contexts**  
    Evidence: `src/index/build/tree-sitter-scheduler/lookup.js:46-165`  
    Impact: stale manifest/page metadata can leak between iterations if cache lifetime outlives artifact refreshes.  
    Fix: bind cache entries to artifact version/mtime or clear between runs.
[x] 
17. **[P2] Filter-index reuse path can leave manifest bookkeeping inconsistent**  
    Evidence: `src/index/build/artifacts-write.js:250-330`  
    Impact: consumers may follow stale manifest references after fallback reuse.  
    Fix: ensure reused artifact path is written back into manifest/piece entries.
[x] 
18. **[P2] Presence validation fallback coverage is incomplete for variant artifact forms**  
    Evidence: `src/index/validate/presence.js:40-76`  
    Impact: false missing-artifact reports possible when only non-JSON primary variants exist.  
    Fix: normalize checks across JSON/JSONL/columnar/compressed variants consistently.
[x] 
19. **[P3] Embedding runtime keeps non-zero concurrency semantics even when embeddings are disabled**  
    Evidence: `src/index/build/runtime/embeddings.js:20-70`, `src/index/build/runtime/workers.js:60-125`  
    Impact: unnecessary queue/resource footprint under disabled embedding modes.  
    Fix: propagate zero-concurrency semantics when embedding is disabled.
[x] 
20. **[P2] Worker restart state can stick in pending-restart failure edge cases**  
    Evidence: `src/index/build/workers/pool.js:90-170`  
    Impact: pool can remain disabled after transient restart errors.  
    Fix: harden restart state transitions and ensure pending flags reset on all outcomes.
[x] 
21. **[P2] `proto/buf.yaml` and `proto/buf.gen.yaml` are not routed to proto adapter**  
    Evidence: `src/index/language-registry/descriptors.js:241-245`, `tests/indexing/language-registry/registry-wiring.test.js`  
    Impact: proto config files miss adapter/import logic.  
    Fix: add explicit special filename routing for Buf configs.
[x] 
22. **[P2] `.jsonc` files remain unclassified in language routing**  
    Evidence: `src/index/language-registry/descriptors.js:280-283`  
    Impact: common config files (e.g. `deno.jsonc`) skip JSON import extraction/chunk handling.  
    Fix: include `.jsonc` in JSON descriptor extensions.
[x] 
23. **[P2] `.resolved` package lock files remain unclassified**  
    Evidence: `src/index/language-registry/descriptors.js:280-283`  
    Impact: JSON-structured lock metadata is skipped by JSON tooling.  
    Fix: include `.resolved` where JSON parsing is intended.
[x] 
24. **[P2] `Pipfile` manifest is listed in special files but not TOML-routed**  
    Evidence: `src/index/language-registry/special-files.js:22`, `src/index/language-registry/descriptors.js:287-290`  
    Impact: TOML import extraction/parsing misses a key ecosystem file.  
    Fix: add TOML `specialFilenames` routing for `Pipfile`.
[x] 
25. **[P2] XML descriptor misses `.props`/`.targets` (MSBuild)**  
    Evidence: `src/index/language-registry/descriptors.js:294-297`  
    Impact: build graph dependencies in these files are not indexed via XML collector.  
    Fix: add XML extensions/special files for MSBuild formats.
[x] 
26. **[P2] XML descriptor misses `.config` (e.g. `packages.config`)**  
    Evidence: `src/index/language-registry/descriptors.js:294-297`  
    Impact: NuGet-style dependency files bypass XML collector logic.  
    Fix: include `.config` when filename pattern matches XML-config artifacts.
[x] 
27. **[P2] XML descriptor misses `.csproj`**  
    Evidence: `src/index/language-registry/descriptors.js:294-297`  
    Impact: C# project dependency metadata is skipped from import graphing.  
    Fix: include `.csproj` in XML routing.
[x] 
28. **[P2] `go.mod` is not routed through Go adapter**  
    Evidence: `src/index/language-registry/descriptors.js:48-51`  
    Impact: module-level dependencies are absent from relations/imports.  
    Fix: add `.mod`/`go.mod` route support.
[x] 
29. **[P3] Dockerfile FROM parser can mis-handle spaced option value forms**  
    Evidence: `src/shared/dockerfile.js:41-49`  
    Impact: image extraction can be wrong for FROM option forms using separate option/value tokens.  
    Fix: parse known FROM flags with explicit arity handling.
[x] 
30. **[P3] JSON import collector can over-report non-dependency metadata as imports (`url` keys)**  
    Evidence: `src/index/language-registry/import-collectors/json.js:1-16`, `:54-63`  
    Impact: external URL metadata can pollute dependency graph/import links.  
    Fix: narrow key heuristics (or classify URL tokens separately from file imports).
[x] 
31. **[P2] Public flag inventory currently omits `watch` from public CLI allowlist view**  
    Evidence: `docs/config/inventory.md:12-24`  
    Impact: documentation-driven policy/gating can misclassify supported public flags.  
    Fix: regenerate inventory after restoring allowlist classification for `watch`.
[x] 
32. **[P2] Search CLI doc contract drift: missing flag coverage vs implementation**  
    Evidence: `docs/tooling/doc-contract-drift.md:5-16`, `src/retrieval/cli-args.js`  
    Impact: docs-driven automation and users rely on stale contract surface.  
    Fix: sync `docs/contracts/search-cli.md` and `docs/contracts/search-contract.md` to current CLI options.
[x] 
33. **[P2] Artifact schema docs missing schema entries present in code contracts**  
    Evidence: `docs/tooling/doc-contract-drift.md:18-22`, `src/contracts/schemas/artifacts.js`  
    Impact: artifact consumers may miss real emitted schema families.  
    Fix: update `docs/contracts/artifact-schemas.md` with missing schemas.
[x] 
34. **[P3] `scoreBreakdown` documented contract no longer matches pipeline outputs**  
    Evidence: `docs/tooling/doc-contract-drift.md:24-28`, `src/retrieval/pipeline.js`  
    Impact: downstream parsers may expect fields no longer emitted.  
    Fix: remove stale contract section or restore output and tests.
[x] 
35. **[P2] Test-runner interface docs missing active lanes**  
    Evidence: `docs/tooling/doc-contract-drift.md:30-39`, `tests/run.rules.jsonc`  
    Impact: orchestration docs are incomplete for CI/lane tooling.  
    Fix: sync docs (`docs/testing/test-runner-interface.md`, `docs/testing/test-decomposition-regrouping.md`) to active lane set.
[x] 
36. **[P3] Inventory duplicate-flag reporting undercounts service flag exposures**  
    Evidence: `docs/config/inventory.json:5978-5983`, `tools/service/indexer-service.js:445-447`  
    Impact: flag governance analytics are incomplete for service surfaces.  
    Fix: include dynamic service CLI participation in duplicate-flag accounting.
[x] 
37. **[P3] `readJsonLinesSyncSafe` drops valid falsy JSON lines (`0`, `false`, `""`)**  
    Evidence: `src/shared/files.js:167-182`  
    Impact: generic NDJSON consumers can lose legitimate entries.  
    Fix: filter only parse failures (`null` sentinel), not all falsy values.
[x] 
38. **[P3] Script inventory CLI command section is manual/static and can drift from launcher surface**  
    Evidence: `tools/docs/script-inventory.js` (hardcoded `CLI_ENTRYPOINTS`) vs `bin/pairofcleats.js` command tree  
    Impact: generated command docs can become stale without code-level coupling.  
    Fix: derive CLI entrypoints from a shared command manifest used by both launcher and inventory generator.
[x] 
39. **[P2] Strict manifest readers fail when `compression.keepRaw` writes dual artifacts**  
    Evidence: `src/index/build/artifacts/writer.js`, `src/shared/artifact-io/manifest.js`  
    Impact: strict loaders reject duplicate artifact names in the manifest (`ERR_MANIFEST_INVALID`) even when both compressed and raw files were intentionally emitted.  
    Fix: make manifest source resolution deterministic for multi-format entries (or emit one canonical manifest source per artifact name).
[x] 
40. **[P3] Query-result cache loader does not enforce cache schema version**  
    Evidence: `src/retrieval/query-cache.js`  
    Impact: stale/incompatible cache payloads from older schema revisions can be reused silently when `entries` exists.  
    Fix: require `version === QUERY_CACHE_VERSION` before trusting on-disk payloads.
[x] 
41. **[P3] Query-plan disk cache misses dirtying on TTL/LRU evictions**  
    Evidence: `src/retrieval/query-plan-cache.js`  
    Impact: evicted/expired entries can remain in `query-plan-cache.json` and be reloaded on next process start.  
    Fix: mark disk cache dirty on cache-handle eviction callbacks.
[x] 
42. **[P3] Query-plan signature-invalid entries can be deleted in memory but persist on disk**  
    Evidence: `src/retrieval/query-plan-cache.js`  
    Impact: invalid entries removed by `get()` may reappear after restart because persistence is skipped when dirty flag was never set.  
    Fix: mark dirty when `get()` invalidates/deletes an entry.
[x] 
43. **[P3] Federated query cache does not self-heal corrupt JSON files**  
    Evidence: `src/retrieval/federation/query-cache.js`  
    Impact: corrupted cache files repeatedly parse-fail and keep caching disabled until manual cleanup.  
    Fix: rotate/delete corrupt cache files on parse failure and rebuild fresh cache content.
[x] 
44. **[P3] Relative `cache.root` stays unresolved and depends on invocation cwd**  
    Evidence: `tools/dict-utils/config.js`, `tools/dict-utils/paths/repo.js`  
    Impact: cache paths can drift across invocations for the same repo/config when launched from different directories.  
    Fix: resolve `cache.root` to an absolute path during config normalization.
[x] 
45. **[P3] Index cache identity uses raw path string instead of canonicalized path**  
    Evidence: `src/retrieval/index-cache.js`  
    Impact: equivalent directories addressed via different strings can split cache identity and cause stale/missed reuse behavior.  
    Fix: canonicalize cache key paths (`path.resolve`/realpath) before key construction.
[x] 
46. **[P3] Query-cache disk signature relies only on size + mtime**  
    Evidence: `src/retrieval/query-cache.js`  
    Impact: fast same-size rewrites can be missed, allowing stale disk-cache payload reuse.  
    Fix: include stronger change signals (e.g. `ctime`, inode, or content hash).
[x] 
47. **[P3] Hot-hit timestamp refresh is not persisted when disk cache load fails**  
    Evidence: `src/retrieval/cli/run-search-session.js`  
    Impact: memory hits can refresh `entry.ts` but fail to update disk state, causing avoidable misses after memory freshness windows expire.  
    Fix: always create/update a writable cache object before deciding persistence.
[x] 
48. **[P2] `timeoutMs: 0` causes immediate subprocess timeout instead of disabling timeout**  
    Evidence: `src/shared/subprocess.js`  
    Impact: callers using `0` as “no timeout” can see instant cancellation.  
    Fix: only arm timeout when `timeoutMs > 0`.
[x] 
49. **[P2] TUI supervisor `resultPolicy.captureStdout` is effectively unreachable**  
    Evidence: `tools/tui/supervisor.js`  
    Impact: requested text/JSON result capture remains null because subprocess stdout capture mode is never enabled.  
    Fix: pass capture settings (`captureStdout`, `maxOutputBytes`, etc.) through to `spawnSubprocess`.
[x] 
50. **[P3] Artifact indexing failures can incorrectly mark successful jobs as failed/retried**  
    Evidence: `tools/tui/supervisor.js`  
    Impact: observer-side artifact-stat errors can trigger failure handling despite command success.  
    Fix: isolate artifact collection errors from primary job success/failure state transitions.
[x] 
51. **[P3] TUI supervisor job map retains completed jobs indefinitely**  
    Evidence: `tools/tui/supervisor.js`  
    Impact: long-running supervisor sessions leak job state and grow memory unbounded.  
    Fix: delete finalized jobs from `state.jobs`.
[x] 
52. **[P3] Completed job IDs cannot be reused in a supervisor session**  
    Evidence: `tools/tui/supervisor.js`  
    Impact: clients reusing stable job IDs get `job already exists` after first run.  
    Fix: remove finalized jobs (or support idempotent replacement semantics).
[x] 
53. **[P3] `job:artifacts` omits `extracted-prose` index mode**  
    Evidence: `tools/tui/supervisor.js`  
    Impact: artifact telemetry under-reports mode outputs and can hide extracted-prose index state.  
    Fix: include `extracted-prose` in indexed mode artifact probes.
[x] 
54. **[P2] Search history artifact path mismatch between retrieval writer and supervisor**  
    Evidence: `src/retrieval/cli/persist.js`, `tools/tui/supervisor.js`  
    Impact: supervisor reports missing `search-history.jsonl` while retrieval appends to `searchHistory`, producing false artifact visibility.  
    Fix: align on one canonical filename/path for search-history output.
[x] 
55. **[P3] Non-strict validator misses compressed JSONL/parts artifacts for relation families**  
    Evidence: `src/index/validate/presence.js`  
    Impact: valid compressed outputs (e.g. `.jsonl.gz`/`.jsonl.zst`) can be reported missing in non-strict validation.  
    Fix: extend legacy artifact probes to include compressed shard variants.
[x] 
56. **[P3] Non-strict chunk-meta legacy presence checks do not recognize compressed primary files**  
    Evidence: `src/index/validate/presence.js`  
    Impact: compressed-only `chunk_meta` outputs can trigger false missing warnings/errors.  
    Fix: include `.gz`/`.zst` checks for chunk-meta primary candidates.
[x] 
57. **[P3] Non-strict dense-vector presence checks ignore `.zst` variants**  
    Evidence: `src/index/validate/presence.js`  
    Impact: valid compressed dense-vector artifacts can be treated as absent.  
    Fix: mirror compression-aware detection used by other artifact probes.
[x] 
58. **[P3] Non-strict ANN metadata fallbacks only probe uncompressed JSON meta files**  
    Evidence: `src/index/validate.js`  
    Impact: compressed `hnsw`/`lancedb`/`sqlite-vec` metadata can be skipped, causing false validation drift.  
    Fix: read these metadata artifacts via compression-aware artifact loaders in all modes.
[x] 
59. **[P2] YAML collector emits anchor/alias pseudo tokens as imports**  
    Evidence: `src/index/language-registry/import-collectors/yaml.js`  
    Impact: intra-document YAML syntax markers pollute cross-file import graphs as fake dependencies.  
    Fix: treat anchors/aliases as metadata, not import specifiers.
[x] 
60. **[P2] YAML collector over-collects generic `path`/`file` keys as imports**  
    Evidence: `src/index/language-registry/import-collectors/yaml.js`  
    Impact: ordinary config metadata is misclassified as dependencies, inflating unresolved/import noise.  
    Fix: tighten key heuristics or require path-like import semantics.
[x] 
61. **[P2] INI collector over-collects generic `path`/`file` keys**  
    Evidence: `src/index/language-registry/import-collectors/ini.js`  
    Impact: non-dependency values become external imports and degrade relation accuracy.  
    Fix: scope to explicit include/import directives.
[x] 
62. **[P2] INI collector treats entire `[paths]`/`[files]` sections as import sources**  
    Evidence: `src/index/language-registry/import-collectors/ini.js`  
    Impact: broad section-level false positives swamp real dependency signals.  
    Fix: narrow section-trigger behavior to include/import-specific sections only.
[x] 
63. **[P2] TOML collector emits `dependency:<name>` pseudo tokens as imports**  
    Evidence: `src/index/language-registry/import-collectors/toml.js`  
    Impact: package metadata identifiers appear as unresolved external dependencies.  
    Fix: record dependency names as metadata/usages, not file-import specifiers.
[x] 
64. **[P2] TOML collector over-collects generic `path`/`file` keys**  
    Evidence: `src/index/language-registry/import-collectors/toml.js`  
    Impact: many non-import config paths are misrouted into dependency graphs.  
    Fix: restrict collection to explicit import/include/path dependency contexts.
[x] 
65. **[P2] XML collector emits `xmlns:*` namespace declarations as imports**  
    Evidence: `src/index/language-registry/import-collectors/xml.js`  
    Impact: namespace declarations produce fake dependency edges.  
    Fix: exclude namespace declarations from import specifiers (retain as metadata if needed).
[x] 
66. **[P2] GraphQL collector misses single-quoted `#import` directives**  
    Evidence: `src/index/language-registry/import-collectors/graphql.js`  
    Impact: valid include directives can be dropped from import graphs.  
    Fix: support both single- and double-quoted import syntax.
[x] 
67. **[P2] R collector parses commented-out `library/require/source` as active imports**  
    Evidence: `src/index/language-registry/import-collectors/r.js`  
    Impact: commented statements create false dependencies.  
    Fix: strip/ignore `#` comments before import matching.
[x] 
68. **[P2] Julia collector parses commented-out `using/import/include` statements**  
    Evidence: `src/index/language-registry/import-collectors/julia.js`  
    Impact: commented examples become false import edges.  
    Fix: ignore comment lines before regex extraction.
[x] 
69. **[P2] Makefile dependency parsing misclassifies target-specific assignments as dependencies**  
    Evidence: `src/index/language-registry/import-collectors/makefile.js`  
    Impact: rules like `target: VAR = value` can emit non-path tokens as dependencies.  
    Fix: skip assignment-style right-hand sides when parsing dependency lists.
[x] 
70. **[P2] JVM-style collectors treat `package ...` declarations as imports**  
    Evidence: `src/index/language-registry/import-collectors/utils.js`  
    Impact: declaration metadata becomes bogus dependency edges.  
    Fix: separate package declarations from import extraction.
[x] 
71. **[P3] Template partial collector captures at most one `{{> ...}}` reference per line**  
    Evidence: `src/index/language-registry/import-collectors/utils.js`  
    Impact: additional partial references on same line are silently dropped.  
    Fix: use global matching (`matchAll`) to capture all partial references.
[x] 
72. **[P3] Template partial collector does not support slash-delimited partial names**  
    Evidence: `src/index/language-registry/import-collectors/utils.js`  
    Impact: common partial paths like `partials/header` are missed.  
    Fix: expand token regex to include path separators.
[x] 
73. **[P2] Config-key allowlist enforcement is effectively disabled**  
    Evidence: `tools/config/inventory.js`  
    Impact: unknown config keys never trigger `--check` failures because known-config set defaults to full schema leaves.  
    Fix: maintain a real known-config allowlist (or derive and pin one) for drift checks.
[x] 
74. **[P2] Top-level CLI blocks valid `service api` security/runtime flags**  
    Evidence: `bin/pairofcleats.js`, `tools/api/server.js`  
    Impact: auth/CORS/body-limit and related server flags are rejected by launcher validation.  
    Fix: align launcher allowlist with API server option surface.
[x] 
75. **[P2] `tui build --verify-manifest` does not verify targets-manifest checksum binding**  
    Evidence: `tools/tui/build.js`  
    Impact: verification can pass even if `targets.json` changed after build-manifest generation.  
    Fix: recompute and compare `targetsManifest.sha256` during verify mode.
[x] 
76. **[P3] Repo-inventory doc reference scan is scoped to only two source files**  
    Evidence: `tools/docs/repo-inventory.js`  
    Impact: many genuinely referenced docs are misreported as orphaned.  
    Fix: scan broader doc/reference sources (or parse intra-doc links recursively).
[x] 
77. **[P3] Repo-inventory script-reference scan misses CLI command invocations**  
    Evidence: `tools/docs/repo-inventory.js`  
    Impact: scripts used via `pairofcleats ...` appear orphaned.  
    Fix: include CLI invocation patterns in script reference extraction.
[x] 
78. **[P3] Config budget check compares CLI allowlist size, not detected public usage**  
    Evidence: `tools/config/inventory.js`  
    Impact: budget gate can pass/fail for wrong reasons and miss real public-flag growth.  
    Fix: budget against detected public flags from scan output.
[x] 
79. **[P3] Public-flag detection scans only two files**  
    Evidence: `tools/config/inventory.js`  
    Impact: public flags introduced in other entrypoints can bypass allowlist checks.  
    Fix: expand public-flag source coverage (or centralize command schema intake).
[x] 
80. **[P3] Script inventory hard-codes Phase 3 spec path**  
    Evidence: `tools/docs/script-inventory.js`  
    Impact: generated docs can point to stale phase specs as roadmap phases move.  
    Fix: parameterize/discover active phase spec directory.
[x] 
81. **[P3] Test timings contract doc omits emitted provenance fields**  
    Evidence: `docs/contracts/test-timings-contract.md`, `tests/runner/run-reporting.js`  
    Impact: doc consumers can implement incomplete parsers and drop `generatedAt`/`runId`/`totalMs`.  
    Fix: update contract doc to match emitted schema.
[x] 
82. **[P3] Test coverage contract doc omits emitted provenance fields**  
    Evidence: `docs/contracts/test-coverage-contract.md`, `tools/testing/coverage/index.js`  
    Impact: contract/documentation drift can break downstream validators.  
    Fix: document `generatedAt` and `runId` in coverage contract.
[x] 
83. **[P3] Test profile contract doc omits emitted provenance fields**  
    Evidence: `docs/contracts/test-profile-contract.md`, `tests/run.js`  
    Impact: consumers relying on docs may reject valid profile outputs or miss run identity.  
    Fix: sync profile contract doc with runtime output.
[x] 
84. **[P3] Test-runner interface doc timeout default drift for CI lane**  
    Evidence: `docs/testing/test-runner-interface.md`, `tests/run.js`  
    Impact: operators plan against incorrect timeout expectations.  
    Fix: update docs to the actual lane timeout resolution behavior.
[x] 
85. **[P3] Release-discipline guide omits doc-contract-drift artifacts produced by release checks**  
    Evidence: `docs/guides/release-discipline.md`, `tools/release/check.js`  
    Impact: release artifact expectations/documentation diverge from generated manifest contents.  
    Fix: include doc-contract-drift outputs in the documented release artifact list.
[x] 
86. **[P2] API body parser does not terminate oversized request streams**  
    Evidence: `tools/api/router/body.js`  
    Impact: on `ERR_BODY_TOO_LARGE`, the promise rejects but the request stream is left flowing, which can retain socket/memory pressure until the client finishes sending.  
    Fix: destroy or explicitly drain/ignore the request stream after size-limit rejection.
[x] 
87. **[P2] API bearer-token comparison is not constant-time**  
    Evidence: `tools/api/router/auth.js`  
    Impact: direct string equality can leak token prefix match timing and weakens auth hardening for exposed API servers.  
    Fix: compare normalized token buffers with `crypto.timingSafeEqual`.
[x] 
88. **[P2] Federated allowlist can exclude workspace cache root when explicit repo roots are configured**  
    Evidence: `tools/api/router.js`  
    Impact: `/search/federated` can fail with forbidden workspace-cache errors even for valid workspaces when `--allowed-repo-roots` is used.  
    Fix: always include resolved federation cache root(s) in the effective allowlist.
[x] 
89. **[P2] Federated allowlist checks workspace config path against repo-root allowlist**  
    Evidence: `tools/api/router.js`  
    Impact: workspace files outside repo trees are rejected even when all referenced repos are valid, breaking common centralized workspace-file layouts.  
    Fix: validate workspace file paths with a dedicated policy separate from repo-root containment.
[x] 
90. **[P2] GET `/search` does not support `meta` filters**  
    Evidence: `tools/api/router/search.js`  
    Impact: GET requests cannot express metadata filters that POST and CLI paths support, causing API surface drift and missing filters in automation.  
    Fix: parse and forward `meta` query input into payload validation/build.
[x] 
91. **[P2] GET `/search` does not support `metaJson` filters**  
    Evidence: `tools/api/router/search.js`  
    Impact: query-string clients cannot provide JSON metadata constraints, forcing POST-only behavior for equivalent filtering logic.  
    Fix: parse `metaJson` in GET path and run it through the same normalization used by POST/CLI.
[x] 
92. **[P3] `/index/diffs` route ignores `mode` query parameter**  
    Evidence: `tools/api/router/index-diffs.js`  
    Impact: API callers cannot match CLI `--mode` behavior and may receive unfiltered diffs unexpectedly.  
    Fix: accept both `mode` and `modes` aliases and normalize them consistently.
[x] 
93. **[P3] `/index/diffs` route drops other diff-shaping knobs**  
    Evidence: `tools/api/router/index-diffs.js`, `src/index/diff/list.js`  
    Impact: API cannot reproduce CLI-limited diff output (`max-*` controls), creating behavior divergence for tooling clients.  
    Fix: pass supported `maxChangedFiles`/`maxEvents`/`maxBytes`-style parameters through route handling.
[x] 
94. **[P3] Environment boolean parsing is case-sensitive**  
    Evidence: `src/shared/env.js`  
    Impact: values like `TRUE`/`True` are treated as falsey defaults, producing surprising config behavior across environments.  
    Fix: lowercase/normalize boolean env strings before comparison.
[x] 
95. **[P3] `workspace status` mutates manifests during read-only inspection**  
    Evidence: `tools/workspace/status.js`  
    Impact: status polling rewrites manifest timestamp/hash-adjacent metadata and can trigger downstream invalidation churn.  
    Fix: load/read manifest without `write: true` in status path.
[x] 
96. **[P3] `workspace catalog` mutates manifests during read-only inspection**  
    Evidence: `tools/workspace/catalog.js`  
    Impact: repeated catalog calls rewrite manifest artifacts and create unnecessary cache/watcher churn.  
    Fix: use non-writing manifest generation/read path for catalog commands.
[x] 
97. **[P3] Repo-root normalization rejects repository root path values**  
    Evidence: `src/shared/path-normalize.js`  
    Impact: callers cannot represent repo root (`.` or absolute root) as repo-relative, causing inconsistent path identity behavior at root boundary.  
    Fix: handle `path.relative(...) === ''` as valid root-relative output instead of returning `null`.
[x] 
98. **[P3] Repo path normalization leaves root path absolute**  
    Evidence: `src/shared/path-normalize.js`  
    Impact: root paths are returned absolute while sibling paths are relative, breaking canonical-path consistency for cache keys/identity comparisons.  
    Fix: normalize root to `''`/`.` under same strip-dot policy as other relative paths.
[x] 
99. **[P3] Drive-letter normalization misses long-path prefixes**  
    Evidence: `src/shared/path-normalize.js`  
    Impact: `\\\\?\\c:\\...` style paths keep lowercase drive letters while normal paths are uppercased, causing inconsistent canonicalization on Windows.  
    Fix: support drive-letter normalization after `\\\\?\\` and related long-path prefixes.

[x] 100. **[P3] POSIX path normalization collapses implementation-defined leading `//` roots**  
     Evidence: `src/shared/path-normalize.js`  
     Impact: `//host/path` can be collapsed to `/host/path`, losing semantics on systems that treat double-slash prefixes specially.  
     Fix: preserve leading `//` and only collapse additional redundant separators beyond the root form.

[x] 101. **[P2] Atomic write fallback temp directory may not exist**  
     Evidence: `src/shared/json-stream/atomic.js`, `src/shared/io/atomic-write.js`  
     Impact: fallback temp-path writes can fail with `ENOENT` before first write when fallback directory has not been created.  
     Fix: `mkdir` the selected temp path parent before opening temp file.

[x] 102. **[P3] `atomicWriteText` newline option is ignored for Buffer payloads**  
     Evidence: `src/shared/io/atomic-write.js`  
     Impact: callers requesting trailing newline with binary/text buffers do not get newline-normalized output.  
     Fix: append newline for Buffer input when `newline === true`, matching string behavior.

[x] 103. **[P2] Cache-root resolver double-appends `cache-v1` for already-versioned overrides**  
     Evidence: `src/shared/cache-roots.js`  
     Impact: passing an explicit `.../cache-v1` root resolves to `.../cache-v1/cache-v1`, silently redirecting all cache operations.  
     Fix: detect version-suffixed overrides and avoid appending layout version twice.

[x] 104. **[P2] Cache clear operation targets wrong directory for already-versioned overrides**  
     Evidence: `src/shared/cache-roots.js`  
     Impact: `clearCacheRoot` can report success while leaving actual cache data untouched when override already ends with `cache-v1`.  
     Fix: reuse suffix-aware cache-root resolution in clear path.

[x] 105. **[P2] Directory containment helper is symlink-blind**  
     Evidence: `src/shared/path-normalize.js:isPathUnderDir`  
     Impact: resolve-based checks can be bypassed via symlinked paths where lexical containment differs from real filesystem containment.  
     Fix: compare canonical realpaths (or nearest-existing-ancestor realpaths) before boundary checks.

[x] 106. **[P2] Manifest loader errors are frequently untyped (`err.code` missing)**  
     Evidence: `src/shared/artifact-io/loaders/core.js`, `src/shared/artifact-io/loaders/chunk-meta.js`  
     Impact: downstream code relying on `err.code` falls back to brittle message matching and misses intended recovery paths.  
     Fix: attach stable `ERR_MANIFEST_*`/`ERR_ARTIFACT_*` codes for all manifest-path failure cases.

[x] 107. **[P3] Artifact presence resolver ignores legacy fallback paths**  
     Evidence: `src/shared/artifact-io/manifest.js`  
     Impact: presence checks report missing artifacts even when fallback legacy files are available and loaders can still recover.  
     Fix: include fallback-path probes in presence resolution when strict mode is off.

[x] 108. **[P3] Non-strict array/object loaders still fail on multi-entry manifest ambiguity**  
     Evidence: `src/shared/artifact-io/loaders/core.js`  
     Impact: dual-write raw/compressed artifact states in compatibility mode still fail reads despite non-strict intent.  
     Fix: in non-strict mode, select deterministic candidate instead of throwing ambiguity errors.

[x] 109. **[P2] Packed token-postings load path lacks checksum validation parity**  
     Evidence: `src/shared/artifact-io/loaders/token-postings.js`  
     Impact: corrupted packed postings can be consumed without early checksum mismatch detection, unlike other packed artifact loaders.  
     Fix: enforce checksum validation during packed token-postings read/decode.

[x] 110. **[P3] `existsOrBak` positive checks can still fail reads when only `.bak` exists**  
     Evidence: `src/shared/artifact-io/loaders/*.js`, `src/shared/artifact-io/fs.js`  
     Impact: loaders may treat artifacts as present and then throw `ENOENT` because they read only canonical path, not `.bak`.  
     Fix: read canonical-or-bak path consistently after `existsOrBak` checks.

[x] 111. **[P3] Manifest cache freshness key is weak (size + mtime only)**  
     Evidence: `src/shared/artifact-io/cache.js`  
     Impact: same-size rewrites within coarse mtime resolution can return stale manifest data for the lifetime of process cache.  
     Fix: include stronger freshness attributes (ctime/ino/hash) in cache key.

[x] 112. **[P1] Per-file artifact metadata paths are not constrained to index root**  
     Evidence: `src/shared/artifact-io/loaders/per-file.js`  
     Impact: malicious or malformed metadata can point loaders outside index root and read unintended files.  
     Fix: validate/resolve metadata-provided paths with same root-safe logic as manifest paths.

[x] 113. **[P2] Chunk-meta loader can prefer stale binary-columnar artifacts not declared by manifest**  
     Evidence: `src/shared/artifact-io/loaders/chunk-meta.js`  
     Impact: stale binary artifacts left on disk can shadow updated manifest-declared formats and return inconsistent chunk metadata.  
     Fix: gate binary-columnar fast path on explicit manifest declaration for active artifact format.

[x] 114. **[P2] Optional index artifact loaders swallow corruption errors even in strict flows**  
     Evidence: `src/retrieval/cli-index.js`  
     Impact: malformed optional artifacts degrade silently into null behavior, masking real index corruption and complicating diagnosis.  
     Fix: rethrow non-optional/non-size-limit errors (especially in strict mode) instead of blanket `catch -> null`.

[x] 115. **[P3] Optional-row loader fallback detection depends on message text prefix**  
     Evidence: `src/retrieval/cli-index.js`  
     Impact: behavior depends on exact error wording, so message changes break optional fallback handling.  
     Fix: branch on stable error codes, not error-message prefixes.

[x] 116. **[P2] Scheduler low-resource mode bypasses scheduling caps entirely**  
     Evidence: `src/shared/concurrency.js:createBuildScheduler`  
     Impact: `lowResourceMode` currently executes tasks directly instead of token-scheduling, which can increase concurrent load instead of reducing it.  
     Fix: keep scheduler active in low-resource mode and reduce token limits rather than bypassing queue control.

[x] 117. **[P2] JSONL iterator can deadlock on early consumer cancellation with bounded in-flight queue**  
     Evidence: `src/shared/artifact-io/json.js:createRowQueue`, `readJsonLinesIteratorSingle`  
     Impact: when `maxInFlight` backpressure is enabled and consumer exits early, producer can block forever waiting for drain, hanging iterator finalization.  
     Fix: propagate cancellation to queue producer and unblock pending `push` waits when consumer stops.

[x] 118. **[P3] TOML import collector strips inline comments inside quoted values**  
     Evidence: `src/index/language-registry/import-collectors/toml.js`  
     Impact: paths/URLs containing `#` in quoted strings are truncated, producing incorrect/missing dependency edges.  
     Fix: parse comments with quote awareness instead of regex-stripping everything after `#`.

[x] 119. **[P3] INI import collector strips comment markers inside quoted values**  
     Evidence: `src/index/language-registry/import-collectors/ini.js`  
     Impact: valid quoted values containing `;`/`#` are truncated and imported incorrectly.  
     Fix: comment stripping should respect quoted string boundaries.

[x] 120. **[P3] YAML import collector strips `#` from quoted scalar values**  
     Evidence: `src/index/language-registry/import-collectors/yaml.js`  
     Impact: quoted references with fragment/hash characters are truncated, causing false/missing import edges.  
     Fix: apply quote-aware comment handling before scalar normalization.

[x] 121. **[P3] Changed-only coverage filtering omits untracked files**  
     Evidence: `tools/testing/coverage/index.js`  
     Impact: new files can be exercised but excluded from changed-only coverage output, under-reporting real coverage for fresh code.  
     Fix: include untracked file set in changed-file resolution.

[x] 122. **[P2] Malformed V8 coverage JSON can abort entire coverage aggregation**  
     Evidence: `tools/testing/coverage/index.js`  
     Impact: one partial/corrupt coverage file can fail whole run post-processing instead of best-effort aggregation.  
     Fix: skip malformed coverage artifacts with warning and continue aggregation.

[x] 123. **[P3] Coverage merge summation over-counts total ranges across artifacts**  
     Evidence: `tools/testing/coverage/index.js`  
     Impact: merged totals inflate with each artifact merge, making coverage summary numerically misleading.  
     Fix: merge by path/range identity (or max/union semantics), not additive totals per artifact.

[x] 124. **[P3] Last-failure utility does not scan the active test log root**  
     Evidence: `tools/ci/get-last-failure.js`, `.testLogs` layout from `tests/runner`  
     Impact: tool can miss the newest failure entirely and report no logs found despite available runner logs.  
     Fix: include `.testLogs` in search roots (prefer latest run directory first).

[x] 125. **[P2] Phase-22 gate script resolves test paths from invocation CWD, not repo root**  
     Evidence: `tools/ci/run-phase22-gates.js`  
     Impact: invoking from non-root working directories breaks path resolution and falsely fails gate execution.  
     Fix: resolve tests from detected repo root and set subprocess cwd consistently.

[x] 126. **[P2] API test helper `requestRaw` still force-parses JSON**  
     Evidence: `tests/helpers/api-server.js`  
     Impact: non-JSON endpoint testing fails with parse errors, making helper unusable for raw text/status-body assertions.  
     Fix: return raw body text (or parse conditionally) in `requestRaw`.

[x] 127. **[P3] Last-failure utility ignores `.testLogs/latest` fast path**  
     Evidence: `tools/ci/get-last-failure.js`, `tests/runner/run-reporting.js`  
     Impact: unnecessary recursive scans of historical logs increase latency on large log histories.  
     Fix: resolve and inspect `.testLogs/latest` first, then fall back to broad scan.
