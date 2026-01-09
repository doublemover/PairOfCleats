# Truth table

This document maps user-visible behavior to implementation, configuration switches, tests, and limitations.

## Build modes

- Claim: `build_index.js --mode code|prose|records|all` builds mode-specific indexes under repo cache.
  - Implementation: `build_index.js`, `src/index/build/args.js`, `src/index/build/indexer.js`, `tools/dict-utils.js`.
  - Config: CLI `--mode`, `--repo`; environment `PAIROFCLEATS_CACHE_ROOT`.
  - Tests: `tests/fixture-smoke.js`, `tests/fixture-empty.js`.
  - Limitations: `all` expands to code + prose only; `records` requires triage record inputs.

- Claim: file discovery honors ignore rules, minified/binary detection, and per-extension caps.
  - Implementation: `src/index/build/discover.js`, `src/index/build/ignore.js`, `src/shared/files.js`.
  - Config: `indexing.maxFileBytes`, `indexing.fileCaps.*`, `indexing.fileScan.*`.
  - Tests: `tests/discover.js`, `tests/file-size-guard.js`, `tests/skip-minified-binary.js`.
  - Limitations: git-backed discovery only applies when `repoRoot` matches git top-level.

## Chunking rules

- Claim: language chunkers emit stable chunk `kind` + `name` plus language-specific metadata.
  - Implementation: `src/lang/*.js`, `src/lang/tree-sitter.js`, `src/index/build/file-processor.js`.
  - Config: `indexing.treeSitter.*`, `indexing.javascriptParser`, `indexing.typescriptParser`.
  - Tests: `tests/fixture-smoke.js`, `tests/format-fidelity.js`, `tests/tree-sitter-chunks.js`.
  - Limitations: unsupported languages fall back to coarse chunking with minimal metadata.

- Claim: config-like formats (JSON/YAML/TOML/etc) chunk into deterministic sections.
  - Implementation: `src/index/chunking.js`.
  - Config: `indexing.yamlChunking`, `indexing.yamlTopLevelMaxBytes`.
  - Tests: `tests/chunking-yaml.js`, `tests/chunking-sql-lua.js`.
  - Limitations: large single documents may be grouped into a single section.

## Tokenization semantics

- Claim: token postings are generated from chunk tokens and dictionary settings with optional sampling.
  - Implementation: `src/index/build/postings.js`, `src/shared/postings-config.js`, `src/index/build/artifacts.js`.
  - Config: `indexing.chunkTokenMode`, `indexing.chunkTokenMaxFiles`, `indexing.chunkTokenMaxTokens`, `indexing.chunkTokenSampleSize`.
  - Tests: `tests/tokenize-dictionary.js`, `tests/tokenization-buffering.js`.
  - Limitations: sampling mode omits full token lists to control artifact size.

## Index artifact outputs

- Claim: artifacts include chunk metadata, token postings, repo map, optional dense vectors, and metrics.
  - Implementation: `src/index/build/artifacts.js`, `src/shared/artifact-io.js`.
  - Config: `indexing.artifacts.*`, `indexing.artifactCompression.*`, CLI `--sqlite`.
  - Tests: `tests/artifact-formats.js`, `tests/artifact-size-guardrails.js`, `tests/index-validate.js`, `tests/fixture-smoke.js`.
  - Limitations: dense vectors require embeddings enabled; sqlite outputs are optional.

## Search semantics

- Claim: search filters support type/kind, signature, decorator, and path/ext constraints.
  - Implementation: `src/retrieval/cli.js`, `src/retrieval/output.js`.
  - Config: CLI `--type`, `--signature`, `--decorator`, `--path`, `--ext`.
  - Tests: `tests/fixture-smoke.js`, `tests/search-filters.js`.
  - Limitations: filters depend on metadata availability for each language.

- Claim: risk filters narrow results by tags, sources, sinks, and flow identifiers.
  - Implementation: `src/index/risk.js`, `src/index/type-inference-crossfile.js`, `src/retrieval/output.js`.
  - Config: `indexing.riskAnalysis`, `indexing.riskAnalysisCrossFile`, CLI `--risk*` flags.
  - Tests: `tests/language-fidelity.js`.
  - Limitations: risk data is best-effort and may be empty for unsupported languages.

## Enrichment outputs

- Claim: docmeta surfaces signatures, decorators, control/dataflow, and inferred types when enabled.
  - Implementation: `src/index/build/file-processor.js`, `src/index/type-inference.js`, `src/index/type-inference-crossfile.js`.
  - Config: `indexing.controlFlow`, `indexing.astDataflow`, `indexing.typeInference`, `indexing.typeInferenceCrossFile`.
  - Tests: `tests/fixture-smoke.js`, `tests/language-fidelity.js`, `tests/type-inference-*.js`.
  - Limitations: tool-based enrichers degrade gracefully when tooling is unavailable.

## Service/API/MCP behavior

- Claim: API and MCP layers delegate to core build/search using repo-scoped configs.
  - Implementation: `tools/api-server.js`, `tools/mcp-server.js`, `src/integrations/core/index.js`.
  - Config: CLI `--repo`, `PAIROFCLEATS_*` env vars.
  - Tests: `tests/api-server.js`, `tests/mcp-server.js`.
  - Limitations: MCP resources list is empty; tool catalog is static per build.

## Determinism and provenance

- Claim: discovery ordering is deterministic and metrics include tool/runtime provenance.
  - Implementation: `src/index/build/discover.js`, `src/index/build/artifacts.js`, `tools/dict-utils.js`, `src/index/git.js`.
  - Config: `PAIROFCLEATS_*` env for config hash inputs.
  - Tests: `tests/discover.js`, `tests/repo-root.js`, `tests/tool-root.js`.
  - Limitations: timestamps and external tools can introduce non-deterministic fields.
