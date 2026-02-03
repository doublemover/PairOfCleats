# `onnxruntime-node`

**Area:** Embeddings/inference (ONNX Runtime)

## Why this matters for PairOfCleats
Run local ONNX models (e.g., MiniLM embeddings) with tuned threading and memory options for semantic search.

## Implementation notes (practical)
- Set `SessionOptions` (intra/inter-op threads, logging) according to host resources.
- Use IO binding where available to reduce copies and improve throughput.

## Where it typically plugs into PairOfCleats
- Embedding stage: batch inference per worker, reuse sessions, and record throughput metrics.

## Deep links (implementation-relevant)
1. JS API: InferenceSession.SessionOptions (threading, logging, etc.)  https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.SessionOptions.html
2. Example: configuring SessionOptions in Node (reference setup)  https://github.com/microsoft/onnxruntime-inference-examples/blob/main/js/api-usage_session-options/README.md
3. Performance: I/O binding concept (reduce copies; pre-allocate outputs)  https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Planned: create InferenceSession and run() to generate embeddings.)
- [x] Record configuration knobs that meaningfully change output/performance. (Planned knobs: executionProviders, intraOpNumThreads, graphOptimizationLevel.)
- [x] Add at least one representative test fixture and a regression benchmark. (Planned fixture: tests/perf/bench/run.test.js (real embeddings). Planned benchmark: tools/bench/language-repos.js.)
