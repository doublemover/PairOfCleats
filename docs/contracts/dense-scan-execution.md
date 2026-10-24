# Exact stored-vector scan execution

The contiguous uint8 dense scorer indexes coordinates directly by row offset. It creates no row subarray and decodes the channel-presence mask once per invocation. Present all-zero rows and absent channels remain distinct. Iterable candidate domains are traversed directly; a noniterable legacy domain may still materialize IDs, and its copy count is explicit.

Each coordinate retains the existing scalar order: dequantize with `byte * scale + minVal`, multiply by that query coordinate, then add to the running dot product. Query dimension clipping/padding, quantization defaults, invalid-score refusal and deterministic score/ordinal tie order remain unchanged. No query-coefficient reassociation, SIMD approximation, dequantized-corpus cache or precision change is introduced.

The production dense ANN provider uses the asynchronous variant. It yields between at most 128 candidate visits or after an 8 ms observed interval, checks cancellation, and returns a result only after the complete admitted scan. One individual row is still evaluated as a scalar unit; very wide-row latency needs separate qualification. The synchronous ranker remains available for existing callers and deterministic fixtures.

Optional operation counters expose rows visited, vectors/coordinates scored, row views, candidate IDs copied and yielded blocks. The independent authored fixture compares stored-byte scalar scores and exact top-k order over nested/contiguous rows, a nonmultiple block tail, masks, legitimate zero vectors, invalid rows, empty/selective/full domains and close/equal scores; it also exercises cancellation through the actual provider. This is a stored-representation reference, not a claim about original FP32 embeddings or quantization recall.

All fixture execution and runtime qualification remain deferred. Throughput, allocation/GC/RSS, bytes touched, selective-domain crossover and alternate blocked/SIMD kernels remain unmeasured. Source operation-count changes establish no production latency improvement.
