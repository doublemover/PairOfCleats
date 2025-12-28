# Roadmap

## Recently completed
- [x] Add .gitignore/.pairofcleatsignore support
- [x] Rich chunk metadata + JS AST extraction depth
- [x] Dictionary bootstrap/update tooling + slang support (repo dict opt-in)
- [x] SQLite backend without VSS (FTS5 + JS ANN re-rank)
- [x] Bootstrap workflow + lightweight tests
- [x] SQLite as full index storage (phase 1 parity path)
- [x] Phase 2: SQLite-driven candidate generation (postings/ngrams in SQL)
- [x] Phase 3: Parity harness + baseline report
- [x] Incremental indexing cache (per-file bundles)
- [x] CI helper scripts for prebuilt index artifacts
- [x] Fixture smoke + benchmark harness (phase 6 baseline)
- [x] SQLite-only scoring option (FTS5)
- [x] Deterministic ranking + BM25 calibration knobs
- [x] Split SQLite indexes (code/prose DBs)
- [x] Incremental indexing: SQLite delta updates for changed chunks
- [x] Metrics/telemetry for index tuning
- [x] Python AST parsing + richer metadata (docstrings, decorators, imports)
- [x] Improved scoring calibration + deterministic ranking between backends
- [x] Broader test harness + fixtures for indexing/search parity
- [x] Benchmark suite + agent eval harness
- [x] Optional persistent query cache
- [x] Parallel indexing improvements + backpressure
- [x] Swift support (chunking + metadata)
- [x] ObjC/C/C++ support (chunking + metadata)
- [x] Rust support (chunking + metadata)
- [x] MCP server packaging + per-repo index management
- [x] Pluggable embedding models + per-repo overrides
- [x] Model comparison harness + scoring path checks
- [x] SQLite ANN extension support (sqlite-vec)

## Now
- [ ] Index quality tuning + benchmark expansion

## Language support (priority order)
- [x] Python (basic chunking)
- [x] Swift
- [x] ObjC/C/C++
- [x] Rust

## Quality and performance

## Long-term
