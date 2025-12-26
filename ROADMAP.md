# Roadmap

## Recently completed
- [x] Add .gitignore/.pairofcleatsignore support
- [x] Rich chunk metadata + JS AST extraction depth
- [x] Dictionary bootstrap/update tooling + slang support (repo dict opt-in)
- [x] SQLite backend without VSS (FTS5 + JS ANN re-rank)
- [x] Bootstrap workflow + lightweight tests
- [x] SQLite as full index storage (phase 1 parity path)

## Now
- [ ] Phase 2: SQLite-driven candidate generation (postings/ngrams in SQL)
- [ ] Incremental indexing + cache updates per commit
- [ ] Improved scoring calibration + deterministic ranking between backends
- [ ] CI helper scripts for prebuilt index artifacts
- [ ] Expand metrics/telemetry for index tuning

## Language support (priority order)
- [ ] Python
- [ ] Swift
- [ ] ObjC/C/C++
- [ ] Rust

## Quality and performance
- [ ] Broader test harness + fixtures for indexing/search parity
- [ ] Benchmark suite + agent eval harness
- [ ] Optional persistent query cache
- [ ] Parallel indexing improvements + backpressure

## Long-term
- [ ] SQLite-only scoring path (optional)
- [ ] Pluggable embedding models + per-repo overrides
- [ ] MCP server packaging + per-repo index management
