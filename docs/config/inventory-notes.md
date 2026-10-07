# Config Inventory Notes

This file complements `docs/config/inventory.md` with manual analysis and ownership hints.

## Ownership map (primary modules)
- cache: `tools/shared/dict-utils.js`, `src/shared/cache.js`
- dictionary: `tools/shared/dict-utils.js`, `src/index/build/runtime.js`, `src/index/build/tokenization.js`
- extensions: `tools/download/extensions.js`, `tools/sqlite/verify-extensions.js`, `tools/sqlite/vector-extension.js`
- indexing: `src/index/build/runtime.js`, `src/index/build/indexer.js`, `src/index/build/file-processor.js`
- models: `tools/shared/dict-utils.js`, `src/shared/embedding.js`, `src/index/build/runtime.js`
- runtime: `tools/shared/dict-utils.js`, `src/shared/cli.js`
- search: `src/retrieval/cli.js`, `src/retrieval/pipeline.js`, `src/retrieval/sqlite-helpers.js`
- sql: `src/index/build/runtime.js`, `src/lang/sql.js`
- sqlite: `src/storage/sqlite/*`, `tools/build/sqlite-index.js`, `tools/build/compact-sqlite-index.js`
- tooling: `tools/tooling/detect.js`, `tools/tooling/install.js`, `src/integrations/tooling/*`
- triage: `src/integrations/triage/*`, `tools/triage/*`

## Overlap candidates to consolidate (initial)
- Embeddings: `PAIROFCLEATS_EMBEDDINGS`, `indexing.embeddings.*`, `--stub-embeddings`, and `--real-embeddings` are redundant toggles.
- Threads/concurrency: `PAIROFCLEATS_THREADS`, `indexing.concurrency`, `--threads`, per-feature concurrency fields, and worker-pool max workers overlap.
- Cache roots: `cache.root`, `PAIROFCLEATS_CACHE_ROOT`, `--cache-root`, and per-benchmark cache overrides are duplicated.
- SQLite paths: `sqlite.dbDir`, `codeDbPath`, `proseDbPath`, `--out`, and `--code-dir/--prose-dir` overlap in purpose.
- Search defaults: `search.annDefault`, `--ann/--no-ann`, `search.bm25.*`, and `--bm25-*` duplicate control surfaces.
- Watch/index toggles: `build_index.js` CLI flags vs indexing config `watch` and `incremental` semantics.

## Suspected unused or legacy knobs
- Requires targeted audit; config schema currently does not distinguish between deprecated and active keys.
- Flags and env vars in `docs/config/inventory.md` with low call-site counts are good candidates for pruning once behavior is traced.

## Loader contract and projection audit

`loadUserConfig()` validates `.pairofcleats.json` against `docs/config/schema.json`
before normalization. Validated settings are preserved, including explicit `false`,
`0`, empty containers, and values in schema-permitted extension namespaces. The
loader must not maintain a second whitelist that silently drops supported keys.
Strict schema namespaces still reject unknown properties and invalid types.
Runtime consumers own defaults, numeric limits, and per-invocation CLI precedence.

Loader-specific transformations remain deliberately narrow:
- `cache.root` is trimmed and resolved relative to the repository; a blank root is omitted
- `indexing.profile` is checked against the canonical profile contract
- `search.sqliteAutoChunkThreshold` and `search.sqliteAutoArtifactBytes` are floored and clamped to zero
- Missing settings remain absent, so runtime defaults and auto-policy fallbacks still apply
- Test-only overrides are merged after normalization, as before

The projection audit for [issue #515](https://github.com/doublemover/PairOfCleats/issues/515)
found these lost settings with existing runtime consumers:
- Search: `annDefault`, `denseVectorMode`, `rrf`, `scoreBlend`, `fieldWeights`,
  `sqliteFtsWeights`, and `maxCandidates`
- Indexing: `concurrency`, `importConcurrency`, `ioConcurrencyCap`, `scheduler`,
  `maxFileBytes`, `fileCaps`, and `scm`; explicit `typeInference: false` was also lost
- Open indexing settings such as `workerPool`, `memory`, and `tinyRepoFastPath`
  were accepted by the extensible schema but discarded before their runtime consumers

`indexing.maxFileLines` is schema-accepted but has no runtime consumer. Loading it
now warns that it has no effect and directs users to
`indexing.fileCaps.default.maxLines`. It is not silently interpreted as an alias.
Open-ended provider/indexing namespaces are forwarded to their owning modules;
schema acceptance there alone does not establish that an arbitrary option is supported.

Regression coverage:
- `tests/tooling/config/loader-schema-contract.test.js` enumerates all declared schema keys,
  nested map shapes, and current union variants, then checks loader preservation and rejection boundaries
- `tests/tooling/config/loader-search-runtime.test.js` checks actual search option resolution,
  explicit false/zero values, guardrails, defaults, CLI overrides, and effective config hashing
- `tests/tooling/config/loader-indexing-runtime.test.js` checks concurrency, SCM, scheduler,
  file caps, and actual build-runtime type-inference disable/default behavior without indexing or model downloads

## Phase 19 additions (lexicon and ANN candidate safety)
- `indexing.lexicon.enabled` is the global lexicon gate for build/retrieval lexicon features.
- `indexing.postings.chargramFields` and `indexing.postings.chargramStopwords` control optional chargram enrichment behavior.
- `retrieval.annCandidateCap`, `retrieval.annCandidateMinDocCount`, and `retrieval.annCandidateMaxDocCount` define ANN/minhash candidate safety bounds.
- `retrieval.relationBoost.*` is the boost-only ranking control surface and defaults to disabled.

## Existing authority and native-extension inventory

The known-key allowlists in `tools/config/inventory.js` include the following
implemented surfaces. Recognition by the inventory does not grant execution,
download or storage authority, and does not change the public-surface budgets.
See [execution authority](../guides/execution-authority.md) and
[environment overrides](env-overrides.md) for their launch-owned boundaries.

- `security.archives.maxBytes`, `maxEntryBytes` and `maxEntries` are owned by
  `tools/download/extensions.js`; positive values can tighten the fixed extraction
  ceilings, but cannot disable or raise them.
- `security.downloads` is owned by `tools/shared/download-utils.js`: `requireHash`,
  `warnUnsigned`, `allowlist`, `maxBytes`, `timeoutMs` and `maxRedirects` configure
  the existing bounded download policy. Native extensions additionally enforce
  `tools/sqlite/extension-trust.js`; their digest requirement is unconditional.
  `src/shared/config-authority.js` removes repository-selected download allowlists
  unless the exact repository has a launch-owned trust grant.
- `sqlite.annMode` and every declared `sqlite.vectorExtension` property are owned
  by `tools/sqlite/vector-extension.js`, including source/platform selection,
  digest, path, provider/table/encoding options and the legacy ANN-mode fallback.
  The config-authority layer removes the whole vector-extension object from
  untrusted repository configuration; artifact verification still precedes loading.
- `PAIROFCLEATS_TRUSTED_CONFIG` and `PAIROFCLEATS_TRUSTED_REPOS` are owned by
  `src/shared/config-authority.js`; they require an external user-owned config
  path or an exact canonical repository-root grant, respectively.
- `PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS` and `PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS`
  are launch inputs to `tools/download/shared-fetch.js`; ordinary repository
  configuration cannot supply these exceptions to the network policy.
- `PAIROFCLEATS_MCP_ALLOW_NATIVE_LOAD` is checked by
  `tools/mcp/tools/handlers/downloads.js` separately from artifact approval.
- `PAIROFCLEATS_TOOLING_DIR` and `PAIROFCLEATS_TOOLING_LOG_DIR` are normalized by
  `src/shared/env/runtime.js` and consumed by tooling/resource-root and diagnostic
  owners; their launch-selected paths take precedence over config paths.
- `PAIROFCLEATS_TUI_NODE`, `PAIROFCLEATS_TUI_SUPERVISOR` and
  `PAIROFCLEATS_TUI_WORKSPACE_ROOT` are pinned by `bin/tui-wrapper-env.js` for the
  trusted wrapper handoff, not accepted as repository config keys.
