# Shared Module Review: #414

Issue: `#414`  
Scope: `src/shared` domain helper families assigned to `#414` in the shared-module ledger, including embeddings-cache, indexing, filter, fs, hash, perf, text, validation, safe-regex, and root-level domain-specific utilities.

## Overall Assessment

Most of this surface is genuinely shared and domain-specific rather than a random grab-bag. The strongest areas are:

- small normalization helpers
- backend/config facades for ANN and embeddings
- the embeddings-cache family
- safe-regex backend structure
- low-level perf, text, and validation helpers

The main cleanup seams are concentrated in a handful of oversized files and two ownership problems:

- move or replace [dict-utils.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/dict-utils.js)
- split [token-id.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/token-id.js)
- split [onnx-embeddings.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/onnx-embeddings.js)
- split [progress-timeout-policy.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/indexing/progress-timeout-policy.js)
- split [embedding-adapter.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/embedding-adapter.js)
- split [dense-vector-artifacts.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/dense-vector-artifacts.js)
- split [build-pointer.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/indexing/build-pointer.js)
- split [tokenize.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/tokenize.js)

## Runtime-Risk Notes

- [onnx-embeddings.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/onnx-embeddings.js): session lifecycle, runtime/provider selection, batch execution, and output handling still live together; ONNX config, run-queue, and tokenization helpers now live under `src/shared/onnx-embeddings/**` instead of the shared root.
- [progress-timeout-policy.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/indexing/progress-timeout-policy.js): timeout classification, budget-extension rules, and progress interpretation are coupled together.
- [embedding-adapter.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/embedding-adapter.js): adapter selection, provider normalization, request shaping, and fallback behavior are combined.
- [dense-vector-artifacts.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/dense-vector-artifacts.js): artifact naming, binary serialization, JSONL sharding, hydration, and row materialization all meet in one file.
- [build-pointer.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/indexing/build-pointer.js): active generation selection and build freshness semantics are correctness-critical.
- [tokenize.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/tokenize.js): stemming, identifier splitting, punctuation extraction, dictionary segmentation, and n-grams are mixed together.

## Maintainability Notes

- [dict-utils.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/dict-utils.js) is only a root-level re-export of `tools/shared/dict-utils.js`.
- ONNX helper roots `src/shared/onnx-config.js`, `src/shared/onnx-run-queue.js`, and `src/shared/onnx-tokenization.js` have been removed; their owners are `src/shared/onnx-embeddings/config.js`, `run-queue.js`, and `tokenization.js`.
- [token-id.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/token-id.js) mixes generic token hashing with a specialized typed posting map.
- The old `src/shared/risk-explain.js` facade has been removed; [risk-explain-summary.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/risk-explain-summary.js) and [risk-explain-model.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/risk-explain-model.js) now own summary shaping and explanation model behavior directly.

## File Ledger

| File | Classification | Review Note |
| --- | --- | --- |
| `src/shared/ann-similarity.js` | `keep`, `document`, `test` | Keep as the ANN distance-to-similarity conversion helper. |
| `src/shared/bloom.js` | `keep`, `document`, `test` | Keep as the Bloom filter primitive. |
| `src/shared/boolean-normalization.js` | `keep`, `document`, `test` | Keep as the loose boolean normalization helper. |
| `src/shared/chargram-hash.js` | `keep`, `document`, `test` | Keep as the chargram hashing contract. |
| `src/shared/code-dictionaries.js` | `keep`, `document`, `test` | Keep as the code-dictionary naming and language-normalization helper. |
| `src/shared/dense-vector-artifacts.js` | `split`, `document`, `test` | Split naming/metadata, binary IO, and row materialization concerns. |
| `src/shared/dense-vector-mode.js` | `keep`, `document`, `test` | Keep as the dense-vector mode normalizer. |
| `src/shared/dict-utils.js` | `move`, `document`, `test` | Remove the src/shared-to-tools/shared re-export seam. |
| `src/shared/dictionary-wordlists.js` | `keep`, `document`, `test` | Keep as the dictionary-wordlist loading and signature helper family. |
| `src/shared/dictionary.js` | `keep`, `document`, `test` | Keep as the shared dictionary representation layer. |
| `src/shared/dockerfile.js` | `keep`, `document`, `test` | Keep as a focused Dockerfile-domain helper. |
| `src/shared/embedding-adapter.js` | `split`, `document`, `test` | Split adapter registry, provider selection, and request normalization. |
| `src/shared/embedding-batch.js` | `keep`, `document`, `test` | Keep as the embedding batch-policy helper. |
| `src/shared/embedding-identity.js` | `keep`, `document`, `test` | Keep as the embedding identity helper. |
| `src/shared/embedding-input-format.js` | `keep`, `document`, `test` | Keep as the embedding request/input format normalizer. |
| `src/shared/embedding-utils.js` | `split`, `document`, `test` | Split vector math/quantization from batch-output normalization. |
| `src/shared/embedding.js` | `keep`, `document`, `test` | Keep as the embedding defaults facade. |
| `src/shared/embeddings-cache/format.js` | `keep`, `document`, `test` | Keep inside the embeddings-cache family. |
| `src/shared/embeddings-cache/index.js` | `keep`, `document`, `test` | Keep as the embeddings-cache facade. |
| `src/shared/embeddings-cache/layout.js` | `keep`, `document`, `test` | Keep as the cache layout helper. |
| `src/shared/embeddings-cache/lru.js` | `keep`, `document`, `test` | Keep as the cache LRU helper. |
| `src/shared/filter/merge.js` | `keep`, `document`, `test` | Keep as the filter merge primitive. |
| `src/shared/fs/find-upwards.js` | `keep`, `document`, `test` | Keep as the upward path-discovery helper. |
| `src/shared/fs/ignore.js` | `keep`, `document`, `test` | Keep focused on ignore-list behavior. |
| `src/shared/hash.js` | `keep`, `document`, `test` | Keep as the shared hashing facade. |
| `src/shared/hash/xxhash-backend.js` | `keep`, `document`, `test` | Keep as the xxhash backend layer. |
| `src/shared/hnsw.js` | `keep`, `document`, `test` | Keep as the HNSW backend/config helper. |
| `src/shared/indexing/build-pointer.js` | `split`, `document`, `test` | Split active pointer resolution from freshness/compatibility helpers. |
| `src/shared/indexing/progress-timeout-policy.js` | `split`, `document`, `test` | Split budget math, classification rules, and progress-state interpretation. |
| `src/shared/indexing/stage1-watchdog-policy.js` | `keep`, `document`, `test` | Keep under indexing policy ownership. |
| `src/shared/indexing/stages.js` | `keep`, `document`, `test` | Keep stage identity under the indexing helper family and avoid scattering stage-name literals across build and report code. |
| `src/shared/indexing/tree-sitter-limits.js` | `keep`, `document`, `test` | Keep as the tree-sitter limit contract. |
| `src/shared/lancedb.js` | `keep`, `document`, `test` | Keep as the LanceDB helper surface. |
| `src/shared/onnx-embeddings.js` | `split`, `document`, `test` | Config, run queue, and tokenization helpers have moved under `src/shared/onnx-embeddings/**`; remaining split work is model/session lifecycle, execution, and output normalization. |
| `src/shared/ownership-segment.js` | `keep`, `document`, `test` | Keep focused on ownership-segment normalization. |
| `src/shared/packed-postings.js` | `keep`, `document`, `test` | Keep as the packed-postings helper layer. |
| `src/shared/perf/eta.js` | `keep`, `document`, `test` | Keep in the perf helper family. |
| `src/shared/perf/histogram.js` | `keep`, `document`, `test` | Keep as a focused histogram helper. |
| `src/shared/perf/percentiles.js` | `keep`, `document`, `test` | Keep as the percentile utility surface. |
| `src/shared/postings-config.js` | `keep`, `document`, `test` | Keep as the postings configuration contract. |
| `src/shared/risk-explain.js` | `removed`, `document`, `test` | Root facade removed after consumers moved to `risk-explain-summary.js` and `risk-explain-model.js`. |
| `src/shared/risk-filters.js` | `keep`, `document`, `test` | Keep as the canonical risk filter contract layer. |
| `src/shared/safe-regex.js` | `split`, `document`, `test` | Keep the facade, but separate backend resolution/policy checks if the family grows. |
| `src/shared/safe-regex/backends/re2.js` | `keep`, `document`, `test` | Keep as the RE2 backend implementation. |
| `src/shared/safe-regex/backends/re2js.js` | `keep`, `document`, `test` | Keep as the RE2JS backend implementation. |
| `src/shared/seed-ref.js` | `keep`, `document`, `test` | Keep as the seed-ref parsing contract. |
| `src/shared/tantivy.js` | `keep`, `document`, `test` | Keep as the Tantivy helper surface. |
| `src/shared/text/escape-regex.js` | `keep`, `document`, `test` | Keep as the text-level regex escape helper. |
| `src/shared/token-id.js` | `split`, `document`, `test` | Move the typed posting map out and keep token-id.js centered on hashing helpers. |
| `src/shared/tokenize.js` | `split`, `document`, `test` | Split identifier tokenization, dictionary segmentation, punctuation extraction, and n-gram helpers. |
| `src/shared/truncation.js` | `keep`, `document`, `test` | Keep as the truncation recording primitive. |
| `src/shared/type-entry-utils.js` | `keep`, `document`, `test` | Keep as the type-entry normalization/merge helper. |
| `src/shared/type-normalization.js` | `keep`, `document`, `test` | Keep as the type normalization contract surface. |
| `src/shared/validation/ajv-factory.js` | `keep`, `document`, `test` | Keep as the shared Ajv factory helper. |
