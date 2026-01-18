# `@xenova/transformers`

**Area:** Embeddings and transformer inference (Transformers.js)

## Why this matters for PairOfCleats
Provides the local embeddings pipeline (tokenizers + transformer models) used when running embeddings in-process.

## Implementation notes (practical)
- Use the feature-extraction pipeline for embedding vectors.
- Cache model assets to avoid repeated downloads and reduce build latency.
- Keep concurrency modest to avoid memory spikes during large builds.

## Where it typically plugs into PairOfCleats
- Stage 3 embeddings (code, prose, extracted-prose).
- CLI and service embedding runtime selection.

## Deep links (implementation-relevant)
1. README and usage overview - https://github.com/xenova/transformers.js#readme
2. API reference (pipelines, model loading) - https://xenova.github.io/transformers.js/
3. Model catalog (Xenova namespace) - https://huggingface.co/Xenova

## Suggested extraction checklist
- [ ] Confirm the pipeline entrypoints and output shapes for embedding vectors.
- [ ] Document cache paths and environment flags for offline builds.
- [ ] Add a smoke test that exercises embeddings with stubbed network access.
