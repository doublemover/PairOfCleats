# `@huggingface/transformers`

Updated: 2026-10-02. The legacy sheet filename is retained for existing links.
The dependency is now Transformers.js 4.x; `xenova` remains PairOfCleats' public
provider identifier, and existing `Xenova/...` model IDs remain valid.

**Area:** Embeddings and transformer inference (Transformers.js)

## Why this matters for PairOfCleats
Provides the local embeddings pipeline (tokenizers + transformer models) used when running embeddings in-process.

## Implementation notes (practical)
- Use the feature-extraction pipeline with explicit `dtype: 'q8'`, mean pooling,
  and the configured normalization policy. Do not accept Node's fp32 default when
  reusing quantized-model caches.
- Cache model assets to avoid repeated downloads and reduce build latency.
- Keep concurrency modest to avoid memory spikes during large builds.

## Where it typically plugs into PairOfCleats
- Stage 3 embeddings (code, prose, extracted-prose).
- CLI and service embedding runtime selection.

## Deep links (implementation-relevant)
1. README and usage overview - https://github.com/huggingface/transformers.js#readme
2. API reference (pipelines, model loading) - https://huggingface.co/docs/transformers.js/api/pipelines
3. Model catalog (Xenova namespace) - https://huggingface.co/Xenova

## Current integration and cache behavior

- `src/shared/embedding-adapter.js` owns pipeline loading, typed-array vector
  projection, and adapter/pipeline reuse. `src/shared/onnx-embeddings.js` also uses
  this dependency for tokenizer loading.
- `PAIROFCLEATS_MODELS_DIR` selects the model cache. Otherwise model assets live
  under the configured cache root's `models` directory. See
  `tools/dict-utils/paths/cache.js` for precedence.
- Prefetch the model with `node tools/download/models.js --model Xenova/all-MiniLM-L12-v2`.
  Reuse the complete model directory, including configuration, tokenizer files
  and `onnx/model_quantized.onnx`, for offline inference. An incomplete cache can
  still require downloads; there is no new global offline switch in this migration.
- Keep model caching separate from per-build embedding artifacts and content
  caches. A standalone build infers omitted dimensions before finalizing its
  embedding identity. See [the embedding contract](../../../guides/embeddings.md).

## Completed integration checklist
- [x] Pipeline entrypoints and typed-array output shapes are covered by
  `tests/indexing/embeddings/transformers-quantized-compatibility.test.js`.
- [x] Cache paths, prefetching and the model-cache environment override are
  documented above.
- [x] The deterministic adapter smoke test injects a mocked pipeline, so no model
  or network request occurs. It also checks q8 selection, pooling, normalization,
  cache identity and pipeline reuse. It passed in the dependency checkpoint.

Real cached MiniLM inference and strict ANN retrieval are separately recorded in
`docs/security/embedding-http-validation-2026-10-02.json`; the mocked smoke test
does not stand in for that native-provider evidence.
