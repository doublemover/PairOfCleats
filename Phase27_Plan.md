# Phase 27 Plan

All unfinished Phase 27 items from NEW_ROADMAP.md.

## Tasks
* [x] Create `src/retrieval/ann/`:
  * [x] `types.js`: `query({ embedding, topN, candidateSet, mode }) -> hits[]`
  * [x] `providers/sqlite-vec.js` wrapper around `rankVectorAnnSqlite`
  * [x] `providers/hnsw.js` wrapper around `rankHnswIndex`
* [x] Update `src/retrieval/pipeline.js` to use the provider interface
  * [ ] Sidecar service (Python) + HTTP (deferred; not required for completion)
  * [x] (Optional) After 27.1 lands, relocate under `src/retrieval/ann/providers/lancedb.js` to remove special-casing in pipeline
* [ ] (Optional) Add a standalone `tools/build-lancedb-index.js` entrypoint that rebuilds LanceDB tables from existing vector artifacts without re-embedding. (deferred)
  * [ ] (Optional) Add explicit `PAIROFCLEATS_TEST_LANCEDB=1` env gating if you want CI to skip even when the dependency is installed (deferred)
* [x] LanceDB ANN can be enabled without breaking sqlite/hnsw fallbacks
* [x] Demonstrable memory and/or latency win for ANN retrieval at scale (not required)
