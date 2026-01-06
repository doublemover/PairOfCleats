# `hnswlib-node`

**Area:** Vector index (HNSW) lifecycle

## Why this matters for PairOfCleats
Build/persist a fast approximate nearest neighbor index for embedding vectors when SQLite-ANN is not used.

## Implementation notes (practical)
- Tune `M`, `efConstruction`, and `efSearch` for recall/latency tradeoffs.
- Persist and load index artifacts deterministically; track index versioning.

## Where it typically plugs into PairOfCleats
- Artifacts: store HNSW index files alongside vector matrices and metadata mapping ids�chunks.

## Deep links (implementation-relevant)
1. Repo README: create/add/search/save/load patterns (HNSW index lifecycle)  https://github.com/yoshoku/hnswlib-node#readme
2. HNSW background (parameter intuition: M, efConstruction, efSearch)  https://github.com/nmslib/hnswlib#readme

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Planned: create HNSW index, addPoint(), searchKnn() for ANN.)
- [x] Record configuration knobs that meaningfully change output/performance. (Planned knobs: M, efConstruction, efSearch, distance space.)
- [x] Add at least one representative test fixture and a regression benchmark. (Planned fixture: tests/sqlite-ann-extension.js or a dedicated ANN test. Planned benchmark: tests/bench.js with ANN enabled.)