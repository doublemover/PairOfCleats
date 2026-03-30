# Suite Taxonomy Report

Generated: 2026-03-30T06:06:17.185Z

## Summary

- `hero`: 1917
- `matrix`: 153
- `meta`: 91
- `soak`: 1
- `heavy-runtime`: 8
- ownership suites tracked: 16
- replacement ids tracked: 58

## Lane Category Summary

- `gate`: 35 tests
  hero: 31
  matrix: 2
  meta: 2
- `ci-lite`: 770 tests
  hero: 639
  matrix: 106
  meta: 24
  soak: 1
- `ci`: 120 tests
  hero: 89
  matrix: 27
  meta: 4
- `ci-long`: 18 tests
  matrix: 10
  heavy-runtime: 8

## Peripheral Tooling Groups

- `tooling/install`: 25 tests
  hero: 24
  matrix: 1
- `tooling/vscode`: 25 tests
  hero: 22
  matrix: 3
- `tooling/sublime`: 9 tests
  hero: 8
  matrix: 1
- `tooling/config-inventory`: 4 tests
  meta: 4

## Coverage Ownership

- source: `docs/testing/consolidation-ownership.json`

- `lang/contracts/language-fixture-contracts` -> Shared language-fixture docmeta contract coverage for Go, JavaScript, Python, SQL, and TypeScript.
  replacements: indexing/language-fixture/chunk-meta-exists, lang/contracts/go, lang/contracts/javascript, lang/contracts/python, lang/contracts/sql, lang/contracts/typescript
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-fixture-index
  process isolation required: no
- `lang/fixtures-sample/metadata-matrix` -> Shared fixture-sample metadata coverage for Python, Rust, and Swift.
  replacements: lang/fixtures-sample/python-metadata, lang/fixtures-sample/rust-metadata, lang/fixtures-sample/swift-metadata
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-search-fixture
  process isolation required: no
- `tooling/vfs/routing-and-token-contract-matrix` -> Shared VFS routing, token, effective-language, and deterministic virtual-path coverage.
  replacements: tooling/vfs/hash-routing, tooling/vfs/routing-by-effective-language, tooling/vfs/virtualpath-deterministic
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-vfs-routing-contract
  process isolation required: no
- `tooling/lsp/configured-provider-preflight-matrix` -> Shared configured-provider workspace preflight coverage for multi-root routing, nested-root acceptance, probe failures, and probe timeouts.
  replacements: tooling/lsp/configured-provider-go-workspace-module-preflight-failed, tooling/lsp/configured-provider-go-workspace-module-preflight-timeout, tooling/lsp/configured-provider-gopls-workspace-root-ambiguous-preflight, tooling/lsp/configured-provider-gopls-workspace-root-nested-preflight
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-configured-provider-preflight-fixture
  process isolation required: no
- `tooling/lsp/signature-parse-matrix` -> Shared parser-level LSP signature coverage for Python, Ruby, Swift, Haskell, Elixir, and Zig.
  replacements: tooling/lsp/elixir-signature-parse, tooling/lsp/haskell-signature-parse, tooling/lsp/python-signature-parse, tooling/lsp/ruby-signature-parse, tooling/lsp/swift-signature-parse, tooling/lsp/zig-signature-parse
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-language-parser-contract
  process isolation required: no
- `tooling/lsp/adaptive-timeout-matrix` -> Shared adaptive-timeout coverage for signatureHelp, definition, references, and typeDefinition stages.
  replacements: tooling/lsp/definition-timeout-adaptive, tooling/lsp/references-timeout-adaptive, tooling/lsp/signature-help-timeout-adaptive, tooling/lsp/type-definition-timeout-adaptive
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-provider-timeout-fixture
  process isolation required: no
- `tooling/lsp/protocol-fail-open-matrix` -> Shared malformed-protocol fail-open coverage for hover, documentSymbol, and initialize stages.
  replacements: tooling/lsp/protocol-malformed-document-symbol-fail-open, tooling/lsp/protocol-malformed-hover-fail-open, tooling/lsp/protocol-malformed-initialize-fail-open
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-stub-protocol-fixture
  process isolation required: no
- `tooling/lsp/session-pool-lifecycle-matrix` -> Shared LSP session-pool lifecycle coverage for reuse, poisoned recycle, max lifetime, disposal barrier, and background expiry.
  replacements: tooling/lsp/session-pool-background-lifetime-expiry, tooling/lsp/session-pool-disposal-barrier, tooling/lsp/session-pool-max-lifetime-recycle, tooling/lsp/session-pool-poisoned-recycle, tooling/lsp/session-pool-reuse
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-session-pool-lifecycle-fixture
  process isolation required: no
- `tooling/doctor/command-profile-probe-cache-matrix` -> Shared doctor command-profile probe cache coverage for direct gopls resolution, hit/miss behavior, negative caching, and ttl expiry.
  replacements: tooling/doctor/command-profile-gopls, tooling/doctor/command-profile-probe-cache, tooling/doctor/command-profile-probe-cache-negative, tooling/doctor/command-profile-probe-cache-success-ttl
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-command-profile-cache-fixture
  process isolation required: no
- `retrieval/filters/search-filter-contract-matrix` -> Shared search filter coverage for normalization, file-case behavior, semantic filters, and query-syntax negation/phrase scoring.
  replacements: retrieval/filters/ext-filter, retrieval/filters/file-case-sensitive, retrieval/filters/lang-filter, retrieval/filters/query-syntax/negative-terms, retrieval/filters/query-syntax/phrases-and-scorebreakdown
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-search-filter-contract
  process isolation required: no
- `cli/search/contract-matrix` -> Shared CLI search coverage for payload contract, top-N filtering, and Windows-style path selectors.
  replacements: cli/search/contract, cli/search/topn-filters, cli/search/windows-path-filter
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-search-lifecycle-fixture
  process isolation required: no
- `services/api/search-contract-matrix` -> Shared API search contract coverage for the adapter-neutral compact search corpus plus query-param alias handling.
  replacements: services/api/search-happy-path
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-search-contract-fixture
  process isolation required: no
- `indexing/map/code-map-contract-matrix` -> Shared code-map coverage for output contracts, determinism, graphviz fallback, and symbol identity selection.
  replacements: indexing/map/build-symbol-identity
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-code-map-builder
  process isolation required: no
- `indexing/validate/index-contract-matrix` -> Shared index validation coverage for healthy baselines, manifest safety, missing pieces, unknown artifacts, and checksum mismatch.
  replacements: indexing/validate/index-load-manifest, indexing/validate/manifest-checks
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-index-validate-builder
  process isolation required: no
- `indexing/artifacts/artifact-write-controller-contract-matrix` -> Shared artifact write-controller coverage for concurrency policies, writer heuristics, and flattened phase timing telemetry.
  replacements: indexing/artifacts/artifact-write-phase-timings, indexing/artifacts/artifact-writer-heuristics
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-artifact-controller-policy
  process isolation required: no
- `shared/fs/atomic-replace-contract-matrix` -> Shared atomic replace coverage for success cleanup, missing-temp restore behavior, stale backups, sync collision guards, committed finals, and EXDEV fallback.
  replacements: shared/fs/atomic-replace-cleans-bak, shared/fs/atomic-replace-cross-device-fallback, shared/fs/atomic-replace-final-committed-missing-temp, shared/fs/atomic-replace-restores-backup-on-missing-temp, shared/fs/atomic-replace-stale-bak-does-not-mask-missing-temp, shared/fs/atomic-replace-sync-stale-bak-collision-guard
  overlap policy: legacy-removed-after-direct-parity
  matrix strategy: shared-atomic-persistence-failure-matrix
  process isolation required: no

