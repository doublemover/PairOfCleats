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

- split [manifest.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/manifest.js)
- split [bundle-io.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io.js)
- split [atomic-persistence.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/io/atomic-persistence.js)
- split [files.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/files.js)
- split [cache.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache.js)
- move [artifact-schema-index.js](C:/Users/sneak/Development/DOUBLECLEAT/src/contracts/artifact-schema-index.js) and [artifact-schemas.js](C:/Users/sneak/Development/DOUBLECLEAT/src/contracts/artifact-schemas.js) closer to contracts/tooling ownership

## Cluster Notes

### Artifact Manifest And Loader Stack

- [artifact-io.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io.js) is a healthy facade and should stay that way.
- [manifest.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/manifest.js) is carrying too many responsibilities at once: manifest loading, path safety, compatibility/layout routing, sidecar inference, and fallback behavior.
- [core.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/loaders/core.js) and [core-binary-columnar.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/artifact-io/loaders/core-binary-columnar.js) should keep a stable external surface, but they need narrower internals.

### Bundle And Persistence Stack

- [bundle-io.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/bundle-io.js) currently mixes bundle format handling, patching, checksums, worker offload, and locking.
- [atomic-persistence.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/io/atomic-persistence.js) mixes temp-path strategy, rename retries, backup swap semantics, long-path handling, and EXDEV fallback behavior.
- [atomic-write.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/io/atomic-write.js) is the right shared facade, but it should continue delegating low-level mechanics instead of growing further.

### Cache And Cache-Root Layering

- [cache.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache.js) currently mixes cache layer descriptions, byte estimators, reporters, and LRU construction.
- [cache-key.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache-key.js), [cache-roots.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache-roots.js), and [cache/policy.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache/policy.js) are individually coherent, but their intended boundaries should be documented more explicitly.
- [cache-cas.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cache-cas.js) should probably be split into object/meta primitives versus lease and GC-oriented helpers.

### File And JSON Stream Utility Overlap

- [files.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/files.js) is one of the broadest shared modules in the repo. It now spans path predicates, file-range helpers, existence probes, and safe JSON reads.
- [json-stream.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/json-stream.js) is similarly too broad. It combines array/object writing, sharded JSONL, offsets, compression, and temp-dir replacement orchestration.
- [streams.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/json-stream/streams.js) and [jsonl-batch.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/json-stream/jsonl-batch.js) should be narrower internal families.

### Specialized Metadata And Contract Wrappers

- [artifact-schema-index.js](C:/Users/sneak/Development/DOUBLECLEAT/src/contracts/artifact-schema-index.js) and [artifact-schemas.js](C:/Users/sneak/Development/DOUBLECLEAT/src/contracts/artifact-schemas.js) are specialized contract adapters, not generic persistence primitives.
- [docmeta.js](C:/Users/sneak/Development/DOUBLECLEAT/src/index/metadata/docmeta.js) and [meta-v2.js](C:/Users/sneak/Development/DOUBLECLEAT/src/index/metadata/meta-v2.js) are metadata helpers and would be clearer under a dedicated metadata family.

## File Ledger

| File | Classification | Review Note |
| --- | --- | --- |
| `src/shared/artifact-io.js` | `keep`, `document`, `test` | Healthy facade; keep it as the stable artifact-io export surface. |
| `src/shared/artifact-io/binary-columnar.js` | `keep`, `document`, `test` | Keep as the binary-columnar format helper. |
| `src/shared/artifact-io/cache.js` | `keep`, `document`, `test` | Internal artifact-read cache helper; keep family-local. |
| `src/shared/artifact-io/checksum.js` | `keep`, `document`, `test` | Keep as the artifact checksum primitive. |
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
| `src/shared/artifact-io/loaders/binary-columnar.js` | `keep`, `document`, `test` | Keep as the specialized binary-columnar loader adapter. |
| `src/shared/artifact-io/loaders/chunk-meta.js` | `keep`, `document`, `test` | Keep as the chunk-meta loader adapter. |
| `src/shared/artifact-io/loaders/core-binary-columnar.js` | `split`, `document`, `test` | Split metadata/sidecar resolution from payload loading. |
| `src/shared/artifact-io/loaders/core-source-resolution.js` | `keep`, `document`, `test` | Keep as the loader source-resolution layer. |
| `src/shared/artifact-io/loaders/core.js` | `split`, `document`, `test` | Split orchestration from source/materialization policy. |
| `src/shared/artifact-io/loaders/graph.js` | `keep`, `document`, `test` | Keep as the graph loader adapter. |
| `src/shared/artifact-io/loaders/minhash.js` | `keep`, `document`, `test` | Keep as the minhash loader adapter. |
| `src/shared/artifact-io/loaders/per-file.js` | `keep`, `document`, `test` | Keep as the per-file artifact adapter. |
| `src/shared/artifact-io/loaders/shared.js` | `keep`, `document`, `test` | Keep as the shared internal loader helper layer. |
| `src/shared/artifact-io/loaders/token-postings.js` | `keep`, `document`, `test` | Keep as the token-postings loader adapter. |
| `src/shared/artifact-io/manifest.js` | `split`, `document`, `test` | Split manifest load/path safety from source resolution and fallback policy. |
| `src/shared/artifact-io/offsets.js` | `keep`, `document`, `test` | Keep as the artifact offset contract. |
| `src/shared/artifact-io/telemetry.js` | `keep`, `document`, `test` | Keep as the artifact-read telemetry helper. |
| `src/shared/artifact-io/varint.js` | `keep`, `document`, `test` | Keep as the compact integer encoding primitive. |
| `src/shared/bundle-checksum.js` | `keep`, `document`, `test` | Keep bundle checksum logic separate and deterministic. |
| `src/shared/bundle-contract.js` | `keep`, `document`, `test` | Keep bundle limits as a contract-only surface. |
| `src/shared/bundle-io.js` | `split`, `document`, `test` | Split worker offload, patching, and persistence internals. |
| `src/shared/cache-cas.js` | `split`, `document`, `test` | Split object/meta helpers from lease and GC-oriented helpers. |
| `src/shared/cache-key.js` | `keep`, `document`, `test` | Keep as the canonical cache-key normalization surface. |
| `src/shared/cache-roots.js` | `keep`, `document`, `test` | Keep as the cache-root ownership layer. |
| `src/shared/cache.js` | `split`, `document`, `test` | Split byte estimation and reporting from LRU construction. |
| `src/shared/cache/json-file.js` | `keep`, `document`, `test` | Keep as a tiny structured JSON-read helper. |
| `src/shared/cache/policy.js` | `keep`, `document`, `test` | Keep as the explicit cache policy contract. |
| `src/shared/chunk-meta-cold.js` | `keep`, `document`, `test` | Keep as a specialized chunk-meta cold-path helper. |
| `src/shared/encoding.js` | `keep`, `document`, `test` | Keep as the shared encoding contract surface. |
| `src/shared/eol.js` | `keep`, `document`, `test` | Keep tiny and focused on EOL normalization. |
| `src/shared/file-signature.js` | `keep`, `document`, `test` | Keep as the file-signature contract. |
| `src/shared/file-stats.js` | `keep`, `document`, `test` | Keep as the file-stat normalization helper. |
| `src/shared/files.js` | `split`, `document`, `test` | Split path predicates, safe JSON reads, and range helpers. |
| `src/shared/index-artifact-helpers.js` | `split`, `document`, `test` | Split optional-artifact fallback helpers from presence probes. |
| `src/shared/io/append-writer.js` | `keep`, `document`, `test` | Keep as a narrow append-only writer. |
| `src/shared/io/atomic-persistence.js` | `split`, `document`, `test` | Split temp-path strategy, retry policy, and replace mechanics. |
| `src/shared/io/atomic-write.js` | `keep`, `document`, `test` | Keep as the main atomic-write facade. |
| `src/shared/io/remove-path-with-retry.js` | `keep`, `document`, `test` | Keep as the shared removal-retry primitive. |
| `src/shared/json-stream.js` | `split`, `document`, `test` | Split sharded JSONL orchestration from stream writing primitives. |
| `src/shared/json-stream/atomic.js` | `keep`, `document`, `test` | Keep internal to the json-stream family. |
| `src/shared/json-stream/compress.js` | `keep`, `document`, `test` | Keep as the JSON-stream compression helper. |
| `src/shared/json-stream/encode.js` | `keep`, `document`, `test` | Keep as the JSON-stream encoding primitive. |
| `src/shared/json-stream/jsonl-batch.js` | `split`, `document`, `test` | Split compression pooling from batch-writer mechanics. |
| `src/shared/json-stream/jsonl-compress-worker.js` | `keep`, `document`, `test` | Keep as the compression worker entrypoint. |
| `src/shared/json-stream/offsets.js` | `keep`, `document`, `test` | Keep as the JSONL offset writer helper. |
| `src/shared/json-stream/runtime.js` | `keep`, `document`, `test` | Keep as the json-stream runtime helper. |
| `src/shared/json-stream/streams.js` | `split`, `document`, `test` | Split stream creation from checksum/accounting behavior. |
| `src/shared/jsonc.js` | `keep`, `document`, `test` | Keep as the JSONC parsing contract surface. |
| `src/shared/optional-artifact-fallback.js` | `merge`, `document`, `test` | Merge or re-export this thin wrapper from a clearer helper surface. |
| `src/shared/provenance.js` | `keep`, `document`, `test` | Keep as the provenance metadata contract. |
| `src/shared/stable-json.js` | `keep`, `document`, `test` | Keep as the canonical deterministic JSON primitive. |
