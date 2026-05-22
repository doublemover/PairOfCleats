# Shared Module Review: #411

Issue: `#411`  
Scope: `src/shared` artifact, cache, IO, bundle, and serialization helpers assigned to `#411` in the shared-module ledger.

## Overall Assessment

This shared surface is useful and already owns many of the right low-level seams, but it is too flat. The main cleanup opportunities are:

1. the oversized artifact manifest and loader stack
2. the bundle persistence stack
3. the overlap between file helpers and atomic persistence helpers
4. the cache family layering story
5. specialized metadata and contract wrappers that should move out of the generic storage/serialization bucket

Highest-priority follow-ups:

- keep [manifest.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/manifest.js) as the public manifest facade and continue splitting remaining loader internals
- keep [bundle-io.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io.js) re-export-only and keep behavior in [bundle-io/read.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io/read.js), [bundle-io/write.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io/write.js), [bundle-io/patch.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io/patch.js), and [bundle-io/support.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io/support.js)
- keep atomic persistence mechanics split across [temp-path.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/io/temp-path.js), [replace-file.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/io/replace-file.js), and [replace-dir.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/io/replace-dir.js)
- keep file-path helpers in [file-paths.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/file-paths.js) and bounded read helpers in [file-read.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/file-read.js)
- keep the split cache leaves [cache/lru.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache/lru.js), [cache/size.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache/size.js), and [cache/layers.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache/layers.js)
- move [artifact-schema-index.js](C:/Users/sneak/Development/DOUBLECLEAT/src/contracts/artifact-schema-index.js) and [artifact-schemas.js](C:/Users/sneak/Development/DOUBLECLEAT/src/contracts/artifact-schemas.js) closer to contracts/tooling ownership

## Cluster Notes

### Artifact Manifest And Loader Stack

- [artifact-io.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io.js) is a healthy facade and should stay that way.
- [manifest.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/manifest.js) is a healthy facade. Manifest entry indexing, piece/path lookup, sidecar lookup, and canonical variant selection now live in [manifest-entry-selection.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/manifest-entry-selection.js), while [manifest-sources.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/manifest-sources.js) owns source resolution, fallback, and presence behavior.
- [core.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/loaders/core.js) and [core-binary-columnar.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/loaders/core-binary-columnar.js) should keep a stable external surface, while remaining internals continue moving to narrow owner modules.
- [columnar-rows.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/columnar-rows.js) now owns pure columnar row inflation and iteration, so loader shared state no longer mixes in row materialization mechanics.
- [binary-columnar.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/loaders/binary-columnar.js) now owns generic framed payload reads; [binary-columnar-chunk-meta.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/loaders/binary-columnar-chunk-meta.js) owns the async `chunk_meta` binary-columnar adapter, and [token-postings.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/loaders/token-postings.js) keeps sync `token_postings` binary-columnar decode local to preserve the sync public API.
- 2026-05-20 update: SQLite storage and index piece-assembly consumers now import direct artifact constants, JSON/JSONL, loaders, and manifest owner modules instead of the root facade. The regenerated ledger reports [artifact-io.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io.js) at 66 direct consumers.
- 2026-05-21 update: production and tool consumers under `src/**` and `tools/**` now import artifact constants, JSON readers, loader facades, and manifest helpers from narrow owner modules instead of [artifact-io.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io.js). The root remains a public/test compatibility facade and a measured performance target, not the default internal import target.

### Bundle And Persistence Stack

- [bundle-io.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io.js) is now a re-export-only public facade. Bundle path/name/format helpers live behind direct imports from [bundle-io-paths.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io-paths.js), checksum schema constant consumers import [bundle-io-constants.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io-constants.js), and behavior implementation is split across [bundle-io/read.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io/read.js), [bundle-io/write.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io/write.js), [bundle-io/patch.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io/patch.js), and [bundle-io/support.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io/support.js).
- The former `src/shared/io/atomic-persistence.js` facade has been removed. Temp-path strategy, file replacement, directory replacement, and shared retry/backup helpers now live behind direct owner imports.
- [atomic-write.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/io/atomic-write.js) is the right shared write facade, but it should continue delegating low-level mechanics instead of growing further.

### Cache And Cache-Root Layering

- The former root cache barrel has been removed. Cache layer descriptions, byte estimators, reporters, and LRU construction now live in [cache/layers.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache/layers.js), [cache/size.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache/size.js), and [cache/lru.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache/lru.js).
- [cache-key.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache-key.js), [cache-roots.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache-roots.js), and [cache/policy.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache/policy.js) are individually coherent, but their intended boundaries should be documented more explicitly.
- The old root-level `src/shared/cache-cas.js` helper has been split into `src/shared/cache-cas/{paths,metadata,objects,gc,leases}.js`, separating object/meta primitives from lease and GC-oriented helpers.

### File And JSON Stream Utility Overlap

- The former root `src/shared/files.js` facade has been removed. Path predicates now live in [file-paths.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/file-paths.js), while range/existence/safe JSON reads live in [file-read.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/file-read.js).
- The former root `src/shared/json-stream.js` facade has been removed. Object/array writers now live in [json-writers.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/json-stream/json-writers.js), while JSONL writers, sharded writers, and atomic temp/replace helpers are imported from their existing narrow owner modules.
- [streams.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/json-stream/streams.js) now keeps stream construction/lifecycle separate from byte accounting and checksum hashing; [jsonl-batch.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/json-stream/jsonl-batch.js) keeps batch-writer mechanics separate from worker compression pooling.

### Specialized Metadata And Contract Wrappers

- [artifact-schema-index.js](C:/Users/sneak/Development/DOUBLECLEAT/src/contracts/artifact-schema-index.js) and [artifact-schemas.js](C:/Users/sneak/Development/DOUBLECLEAT/src/contracts/artifact-schemas.js) are specialized contract adapters, not generic persistence primitives.
- [docmeta.js](C:/Users/sneak/Development/DOUBLECLEAT/src/index/metadata/docmeta.js) and [meta-v2.js](C:/Users/sneak/Development/DOUBLECLEAT/src/index/metadata/meta-v2.js) are metadata helpers and would be clearer under a dedicated metadata family.

## File Ledger

| File | Classification | Review Note |
| --- | --- | --- |
| `src/shared/artifact-io.js` | `keep`, `document`, `test` | Healthy facade; keep it as the stable artifact-io export surface while migrating internal storage/indexing consumers to narrower owners. |
| `src/shared/artifact-io/binary-columnar.js` | `keep`, `document`, `test` | Keep as the binary-columnar format helper. |
| `src/shared/artifact-io/cache.js` | `keep`, `document`, `test` | Internal artifact-read cache helper; keep family-local. |
| `src/shared/artifact-io/checksum.js` | `keep`, `document`, `test` | Keep as the artifact checksum primitive. |
| `src/shared/artifact-io/columnar-rows.js` | `keep`, `document`, `test` | Owns pure columnar row context, materialized inflation, and streaming iteration. |
| `src/shared/artifact-io/compression.js` | `keep`, `document`, `test` | Keep focused on compression transport behavior. |
| `src/shared/artifact-io/constants.js` | `keep`, `document` | Keep as the artifact-io constant contract surface. |
| `src/shared/artifact-io/fs.js` | `keep`, `document`, `test` | Keep as the artifact-local filesystem helper. |
| `src/shared/artifact-io/graph.js` | `keep`, `document`, `test` | Specialized graph artifact helper; keep narrow. |
| `src/shared/artifact-io/json.js` | `keep`, `document`, `test` | Good JSON read facade for the artifact family. |
| `src/shared/artifact-io/json/fallback.js` | `keep`, `document`, `test` | Keep internal as bounded fallback logic. |
| `src/shared/artifact-io/json/line-scan.js` | `keep`, `document`, `test` | Keep as the JSONL line-scan primitive. |
| `src/shared/artifact-io/json/read-json.js` | `keep`, `document`, `test` | Keep internal to the artifact JSON stack. |
| `src/shared/artifact-io/json/read-jsonl-array.js` | `keep`, `document`, `test` | Keep as bounded JSONL array materialization. |
| `src/shared/artifact-io/json/read-jsonl-stream.js` | `keep`, `document`, `test` | Keep as the streaming JSONL read helper. |
| `src/shared/artifact-io/json/read-plan.js` | `keep`, `document`, `test` | Keep as an internal read-plan helper. |
| `src/shared/artifact-io/json/row-queue.js` | `keep`, `document`, `test` | Keep as an internal row-buffering helper. |
| `src/shared/artifact-io/jsonl.js` | `keep`, `document`, `test` | Good artifact-local JSONL contract surface. |
| `src/shared/artifact-io/limits.js` | `keep`, `document`, `test` | Keep family-specific size and budget limits here. |
| `src/shared/artifact-io/loaders.js` | `keep`, `document`, `test` | Healthy public loader facade. |
| `src/shared/artifact-io/loaders/binary-columnar.js` | `keep`, `document`, `test` | Keep as the generic binary-columnar framed row payload primitive. |
| `src/shared/artifact-io/loaders/binary-columnar-chunk-meta.js` | `keep`, `document`, `test` | Owns `chunk_meta` binary-columnar layout resolution and row expansion. |
| `src/shared/artifact-io/loaders/chunk-meta.js` | `keep`, `document`, `test` | Keep as the chunk-meta loader adapter. |
| `src/shared/artifact-io/loaders/core-binary-columnar-json-rows.js` | `keep`, `document`, `test` | Own binary-columnar JSON row decode and row-count validation. |
| `src/shared/artifact-io/loaders/core-binary-columnar.js` | `keep`, `document`, `test` | Coordinate context, checksum, frame reading, and JSON row decode owners for binary-columnar JSON rows. |
| `src/shared/artifact-io/loaders/core-source-resolution.js` | `keep`, `document`, `test` | Keep as the loader source-resolution layer. |
| `src/shared/artifact-io/loaders/core-row-stream.js` | `keep`, `document`, `test` | Own streaming row dispatch across JSON, columnar, binary-columnar, and JSONL sources. |
| `src/shared/artifact-io/loaders/core.js` | `keep`, `document`, `test` | Keep as the stable public core loader surface over manifest/source resolution and leaf loader owners. |
| `src/shared/artifact-io/loaders/graph.js` | `keep`, `document`, `test` | Keep as the graph loader adapter. |
| `src/shared/artifact-io/loaders/minhash.js` | `keep`, `document`, `test` | Keep as the minhash loader adapter. |
| `src/shared/artifact-io/loaders/per-file.js` | `keep`, `document`, `test` | Keep as the per-file artifact adapter. |
| `src/shared/artifact-io/loaders/shared.js` | `keep`, `document`, `test` | Keep as the shared internal loader helper layer. |
| `src/shared/artifact-io/loaders/token-postings.js` | `keep`, `document`, `test` | Keep as the token-postings loader adapter. |
| `src/shared/artifact-io/manifest-entry-selection.js` | `keep`, `document`, `test` | Owns manifest entry indexing, sidecar lookup, piece-by-path matching, and canonical variant selection. |
| `src/shared/artifact-io/manifest.js` | `keep`, `document`, `test` | Public manifest facade only; keep load/path/source exports routed to narrow owners. |
| `src/shared/artifact-io/offsets.js` | `keep`, `document`, `test` | Keep as the artifact offset contract. |
| `src/shared/artifact-io/telemetry.js` | `keep`, `document`, `test` | Keep as the artifact-read telemetry helper. |
| `src/shared/artifact-io/varint.js` | `keep`, `document`, `test` | Keep as the compact integer encoding primitive. |
| `src/shared/bundle-checksum.js` | `keep`, `document`, `test` | Keep bundle checksum logic separate and deterministic. |
| `src/shared/bundle-contract.js` | `keep`, `document`, `test` | Keep bundle limits as a contract-only surface. |
| `src/shared/bundle-io.js` | `keep`, `document`, `test` | Public facade only; behavior lives in `bundle-io/{read,write,patch,support}.js`. |
| `src/shared/bundle-io/read.js` | `keep`, `document`, `test` | Owns bundle reads, patch application, and checksum verification. |
| `src/shared/bundle-io/write.js` | `keep`, `document`, `test` | Owns full bundle writes and cleanup of obsolete write artifacts. |
| `src/shared/bundle-io/patch.js` | `keep`, `document`, `test` | Owns patch append/read/validation/application and patch metadata accounting. |
| `src/shared/bundle-io/support.js` | `keep`, `document`, `test` | Owns shared worker offload, checksum sidecar writes, patch cleanup, and removal helpers. |
| `src/shared/cache-cas/{paths,metadata,objects,gc,leases}.js` | `keep`, `document`, `test` | Root helper split completed; keep path/hash, metadata, object write/touch, enumeration, and lease reads separate. |
| `src/shared/cache-key.js` | `keep`, `document`, `test` | Keep as the canonical cache-key normalization surface. |
| `src/shared/cache-roots.js` | `keep`, `document`, `test` | Keep as the cache-root ownership layer. |
| `src/shared/cache/{layers,lru,size}.js` | `keep`, `document`, `test` | Root cache barrel removed; keep cache layer descriptions, byte estimation, and LRU/reporting ownership in narrow leaves. |
| `src/shared/cache/json-file.js` | `keep`, `document`, `test` | Keep as a tiny structured JSON-read helper. |
| `src/shared/cache/policy.js` | `keep`, `document`, `test` | Keep as the explicit cache policy contract. |
| `src/shared/chunk-meta-cold.js` | `keep`, `document`, `test` | Keep as a specialized chunk-meta cold-path helper. |
| `src/shared/encoding.js` | `keep`, `document`, `test` | Keep as the shared encoding contract surface. |
| `src/shared/eol.js` | `keep`, `document`, `test` | Keep tiny and focused on EOL normalization. |
| `src/shared/file-signature.js` | `keep`, `document`, `test` | Keep as the file-signature contract. |
| `src/shared/file-stats.js` | `keep`, `document`, `test` | Keep as the file-stat normalization helper. |
| `src/shared/artifact-io/chunk-meta-presence.js` | `keep`, `document`, `test` | Own coarse chunk_meta presence probes after the root index-artifact helper split. |
| `src/shared/io/append-writer.js` | `keep`, `document`, `test` | Keep as a narrow append-only writer. |
| `src/shared/io/atomic-write.js` | `keep`, `document`, `test` | Keep as the main atomic-write facade. |
| `src/shared/io/persistence-helpers.js` | `keep`, `document`, `test` | Owns shared retry, backup, copy, and EXDEV fallback primitives for replace operations. |
| `src/shared/io/replace-dir.js` | `keep`, `document`, `test` | Owns directory replacement and rollback mechanics. |
| `src/shared/io/remove-path-with-retry.js` | `keep`, `document`, `test` | Keep as the shared removal-retry primitive. |
| `src/shared/io/temp-path.js` | `keep`, `document`, `test` | Owns sibling/fallback temp path derivation. |
| `src/shared/json-stream/atomic.js` | `keep`, `document`, `test` | Keep internal to the json-stream family. |
| `src/shared/json-stream/compress.js` | `keep`, `document`, `test` | Keep as the JSON-stream compression helper. |
| `src/shared/json-stream/encode.js` | `keep`, `document`, `test` | Keep as the JSON-stream encoding primitive. |
| `src/shared/json-stream/jsonl-batch.js` | `keep`, `document`, `test` | Own JSONL batch-writer lifecycle, block sizing, in-flight ordering, and stream writes. |
| `src/shared/json-stream/jsonl-compression-pool.js` | `keep`, `document`, `test` | Own worker-backed JSONL compression pooling and bounded worker termination. |
| `src/shared/json-stream/jsonl-compress-worker.js` | `keep`, `document`, `test` | Keep as the compression worker entrypoint. |
| `src/shared/json-stream/json-writers.js` | `keep`, `document`, `test` | Owns streaming JSON object and array file writers after the root json-stream facade removal. |
| `src/shared/json-stream/offsets.js` | `keep`, `document`, `test` | Keep as the JSONL offset writer helper. |
| `src/shared/json-stream/runtime.js` | `keep`, `document`, `test` | Keep as the json-stream runtime helper. |
| `src/shared/json-stream/byte-counter.js` | `keep`, `document`, `test` | Own byte accounting, max-byte enforcement, and checksum hashing for JSON streams. |
| `src/shared/json-stream/streams.js` | `keep`, `document`, `test` | Own write-stream construction, event waits, atomic cleanup, compression piping, and lifecycle coordination. |
| `src/shared/jsonc.js` | `keep`, `document`, `test` | Keep as the JSONC parsing contract surface. |
| `src/shared/artifact-io/optional-fallback.js` | `keep`, `document`, `test` | Own optional-artifact error classification plus sync and async fallback wrappers under the artifact IO family. |
| `src/shared/provenance.js` | `keep`, `document`, `test` | Keep as the provenance metadata contract. |
| `src/shared/stable-json.js` | `keep`, `document`, `test` | Keep as the canonical deterministic JSON primitive. |
