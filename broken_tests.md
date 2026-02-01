# Broken Tests

---

```
 - [271.3s] tooling/script-coverage/script-coverage (exit 1)
         [error] Error: No extension binary found in C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\download-extensions\zip-slip\.tmp\vec0-1769979635597.zip
         2x Downloads 1/1 (done)
         2x Done. downloaded=0 skipped=0
         Downloads 0/1
         [error] Error: unsafe tar entry: ../pwned-tar.txt
         [sqlite] Vector extension disabled: invalid vector extension config (table)
         deleted: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\clean-artifacts\cache\repos\repo-6319f2cb2b14
         deleted: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\clean-artifacts\repo\index-sqlite
         2x Cleanup complete.
         deleted: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\clean-artifacts\cache\repos
         deleted: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\uninstall\cache
         deleted: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\uninstall\LocalAppData\PairOfCleats\extensions
         Uninstall complete.
         8x [init] load config (0ms)
         12x [init] auto policy (provided)
         2x [init] cache root (env): C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache
         2x [init] repo cache root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740
         6x [init] runtime envelope (0ms)
         3x [warn] NODE_OPTIONS prevents applying requested max-old-space-size.
         2x [init] repo provenance (61ms)
         10x [init] tree-sitter config (0ms)
         12x JS file caps default to tree-sitter maxBytes (524288).
         11x [init] embedding runtime (1ms)
         [init] dictionaries (327ms)
         9x [init] ignore rules (2ms)
         12x Wordlists enabled: 1 file(s), 370,105 words for identifier splitting.
         12x Code dictionaries enabled: no code dictionary files found for gated languages.
         12x Two-stage indexing: stage2 (enrichment) running.
         12x Embeddings: disabled.
         2x Incremental cache enabled (root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\incremental).
         12x Queue concurrency: io=32, cpu=16.
         12x [init] tree-sitter preload (0ms)
         12x Type inference metadata enabled via indexing.typeInference.
         2x [init] worker pools (1ms)
         12x Build environment snapshot.
         [init] runtime ready (419ms)
         12x Overall 0/27
         9x → Preprocess: 24 files across 4 mode(s).
         36x Crash logging enabled: logs\index-crash.log
         12x 📄  Scanning code ...
         12x [           Code | Stage 1]
         36x → Reusing shared discovery results.
         9x → Found 9 files.
         12x Scanning for imports...
         27x code Imports 9/9 (done)
         9x → Imports: modules=4, edges=4, files=4
         12x [tree-sitter] Missing WASM grammar for clike (WASM grammar not loaded).
         12x [tree-sitter] Missing WASM grammar for cpp (WASM grammar not loaded).
         12x [tree-sitter] Missing WASM grammar for objc (WASM grammar not loaded).
         12x [tree-sitter] Missing WASM grammar for rust (WASM grammar not loaded).
         24x Auto-selected context window: 3 lines
         36x Processing and indexing files...
         36x Indexing Concurrency: Files: 16, Imports: 16, IO: 32, CPU: 16
         3x [tokenization] Worker pool unavailable; using main thread.
         2x [git] Git metadata unavailable. (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\repo)
         9x Tree-sitter unavailable for clike; falling back to heuristic chunking.
         9x Tree-sitter unavailable for cpp; falling back to heuristic chunking.
         6x code Files 3/9
         9x Tree-sitter unavailable for objc; falling back to heuristic chunking.
         6x code Files 8/9
         34x code Files 9/9 (done)
         9x → Imports: resolved=1, external=3, unresolved=0
         (node:17396) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         12x (Use `node --trace-deprecation ...` to show where the warning was created)
         12x [tooling] doctor: 3 error(s), 0 warning(s).
         12x [index] clangd not detected; skipping tooling-based types.
         12x [index] sourcekit-lsp not detected; skipping tooling-based types.
         9x [index] tooling enriched 4 symbol(s).
         8x Cross-File Inference: 3 Call Links, 35 Usage Links, 4 Returns, 0 Risk Flows
         5x Cross-file inference updated 9 incremental bundle(s).
         7x → Indexed 26 chunks, total tokens: 941
         12x Overall 4/27 code relations
         36x Embeddings disabled; skipping dense vector build.
         12x code Stage 6/6 (done) write
         48x → Wrote .filelists.json (samples only).
         12x Writing index files (20 artifacts)...
         8x Writing index files 1/20 (5.0%) | artifacts/import_resolution_graph.json
         5x code Artifacts 20/20 (done) chunk_meta.json
         5x Writing index files 20/20 (100.0%) | chunk_meta.json
         8x 📦  code : 26 chunks, 109 tokens, dims=0
         12x → Wrote pieces manifest (21 entries).
         12x 📄  Scanning prose ...
         12x [          Prose | Stage 1]
         12x → Found 3 files.
         44x prose Files 3/3 (done)
         12x → Indexed 3 chunks, total tokens: 86
         12x prose Stage 6/6 (done) write
         24x Writing index files (12 artifacts)...
         23x Writing index files 1/12 (8.3%) | chunk_uid_map.jsonl
         12x prose Artifacts 12/12 (done) chargram_postings.json
         24x Writing index files 12/12 (100.0%) | chargram_postings.json
         12x 📦  prose: 3 chunks, 50 tokens, dims=0
         24x → Wrote pieces manifest (13 entries).
         12x 📄  Scanning extracted-prose ...
         12x [Extracted Prose | Stage 1]
         9x → Found 12 files.
         10x Auto-selected context window: 6 lines
         8x extracted-prose Files 5/12
         8x extracted-prose Files 10/12
         27x extracted-prose Files 12/12 (done)
         12x → Indexed 2 chunks, total tokens: 12
         12x extracted-prose Stage 6/6 (done) write
         12x extracted-prose Artifacts 12/12 (done) chargram_postings.json
         12x 📦  extracted-prose: 2 chunks, 5 tokens, dims=0
         12x 📄  Scanning records ...
         12x → Found 0 record(s).
         12x → Indexed 0 chunks, total tokens: 0
         12x Writing index files (11 artifacts)...
         11x Writing index files 1/11 (9.1%) | file_meta.json
         4x records Artifacts 11/11 (done) field_postings.json
         4x Writing index files 11/11 (100.0%) | field_postings.json
         12x 📦  records: 0 chunks, 0 tokens, dims=0
         12x → Wrote pieces manifest (12 entries).
         6x [embeddings] code: processed 8/9 files
         7x [embeddings] code: processed 9/9 files
         10x [embeddings] code/merged: wrote HNSW index (26 vectors).
         10x [embeddings] code/doc: wrote HNSW index (26 vectors).
         10x [embeddings] code/code: wrote HNSW index (26 vectors).
         10x [embeddings] code/merged: wrote LanceDB table (26 vectors).
         10x [embeddings] code/doc: wrote LanceDB table (26 vectors).
         10x [embeddings] code/code: wrote LanceDB table (26 vectors).
         10x [embeddings] code: wrote 26 vectors (dims=384).
         8x prose Files 3/3
         8x [embeddings] prose: processed 3/3 files
         14x [embeddings] prose/merged: wrote HNSW index (3 vectors).
         14x [embeddings] prose/doc: wrote HNSW index (3 vectors).
         14x [embeddings] prose/code: wrote HNSW index (3 vectors).
         14x [embeddings] prose/merged: wrote LanceDB table (3 vectors).
         14x [embeddings] prose/doc: wrote LanceDB table (3 vectors).
         14x [embeddings] prose/code: wrote LanceDB table (3 vectors).
         14x [embeddings] prose: wrote 3 vectors (dims=384).
         8x extracted-prose Files 2/2 (done)
         8x [embeddings] extracted-prose: processed 2/2 files
         13x [embeddings] extracted-prose/merged: wrote HNSW index (2 vectors).
         13x [embeddings] extracted-prose/doc: wrote HNSW index (2 vectors).
         13x [embeddings] extracted-prose/code: wrote HNSW index (2 vectors).
         13x [embeddings] extracted-prose/merged: wrote LanceDB table (2 vectors).
         13x [embeddings] extracted-prose/doc: wrote LanceDB table (2 vectors).
         13x [embeddings] extracted-prose/code: wrote LanceDB table (2 vectors).
         13x [embeddings] extracted-prose: wrote 2 vectors (dims=384).
         13x [embeddings] records: wrote 0 vectors (dims=384).
         12x Embeddings 4/4 (done) records
         2x [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210041Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         9x [sqlite] Using incremental bundles for code (9 files).
         31x [sqlite] Bundle parser workers: 16.
         9x [sqlite] bundles 1/9 (11.1%) | src/sample.c
         9x [sqlite] bundles 9/9 (100.0%) | src/sample.swift
         15x [sqlite] Validation (smoke) ok for code.
         15x [warn] [sqlite] Incremental bundle build failed for code: bundles missing embeddings; falling back to artifacts.
         2x [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210041Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         2x [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210041Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         13x [sqlite] Using incremental bundles for prose (3 files).
         13x [sqlite] bundles 1/3 (33.3%) | README.md
         13x [sqlite] bundles 3/3 (100.0%) | queries.txt
         13x [sqlite] Validation (smoke) ok for prose.
         13x [warn] [sqlite] Incremental bundle build failed for prose: bundles missing embeddings; falling back to artifacts.
         2x [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210041Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         2x [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210041Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         7x [sqlite] Using incremental bundles for extracted-prose (12 files).
         7x [sqlite] bundles 1/12 (8.3%) | src/sample.c
         7x [sqlite] bundles 12/12 (100.0%) | src/sample.swift
         13x [sqlite] Validation (smoke) ok for extracted-prose.
         13x [warn] [sqlite] Incremental bundle build failed for extracted-prose: bundles missing embeddings; falling back to artifacts.
         2x [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210041Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         2x [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210041Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         2x [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210041Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         10x [sqlite] SQLite Indexes Updated.
         36x Overall 27/27 (done) records sqlite
         6x [DONE] Index built for 12 files in 14 seconds (186 lines).
         8x                                 Code: 9 files   (163 lines).
         12x                                Prose: 3 files   (23 lines).
         8x                      Extracted Prose: 12 files  (186 lines).
         12x                              Records: 0 records (0 lines).
         5x SQLite 1/4 code done
         5x SQLite 4/4 (done) records done
         [init] repo provenance (65ms)
         2x [init] tree-sitter config (1ms)
         2x [init] dictionaries (351ms)
         2x [init] ignore rules (3ms)
         [init] worker pools (3ms)
         [init] runtime ready (451ms)
         3x → Imports: modules=5, edges=5, files=5
         3x → Imports: resolved=1, external=4, unresolved=0
         (node:23488) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         3x [index] tooling enriched 5 symbol(s).
         Cross-File Inference: 3 Call Links, 46 Usage Links, 5 Returns, 0 Risk Flows
         → Indexed 27 chunks, total tokens: 950
         7x code Artifacts 20/20 (done) chargram_postings.json
         7x Writing index files 20/20 (100.0%) | chargram_postings.json
         2x 📦  code : 27 chunks, 111 tokens, dims=0
         Auto-selected context window: 7 lines
         extracted-prose Files 3/12
         extracted-prose Files 9/12
         8x records Artifacts 11/11 (done) chargram_postings.json
         8x Writing index files 11/11 (100.0%) | chargram_postings.json
         3x [embeddings] code/merged: wrote HNSW index (27 vectors).
         3x [embeddings] code/doc: wrote HNSW index (27 vectors).
         3x [embeddings] code/code: wrote HNSW index (27 vectors).
         3x [embeddings] code/merged: wrote LanceDB table (27 vectors).
         3x [embeddings] code/doc: wrote LanceDB table (27 vectors).
         3x [embeddings] code/code: wrote LanceDB table (27 vectors).
         3x [embeddings] code: wrote 27 vectors (dims=384).
         2x Overall 21/27 prose embeddings
         2x Overall 23/27 records embeddings
         2x [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210058Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         2x [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210058Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (27 code, 0 prose, 0 extracted-prose).
         2x [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210058Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         2x [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210058Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         2x [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210058Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         2x [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210058Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         2x [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210058Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         2x [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental\file-manifest-updates\cache\repos\repo-c64e710b1740\builds\20260201T210058Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         [DONE] Index built for 12 files in 13 seconds (190 lines).
                                         Code: 9 files   (167 lines).
                              Extracted Prose: 12 files  (190 lines).
         3x [warn] [sqlite] Incremental update skipped for code: change ratio 1.00 (changed=9, deleted=0, total=9) exceeds 0.35.
         2x [warn] [sqlite] Incremental update skipped for prose: change ratio 1.00 (changed=3, deleted=0, total=3) exceeds 0.35.
         [warn] [sqlite] Incremental update skipped for extracted-prose: change ratio 1.00 (changed=12, deleted=0, total=12) exceeds 0.35.
         [init] cache root (env): C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache
         [init] repo cache root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774
         6x [init] runtime envelope (1ms)
         [init] repo provenance (69ms)
         [init] dictionaries (369ms)
         Incremental cache enabled (root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774\incremental).
         2x [init] runtime ready (470ms)
         [git] Git metadata unavailable. (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\repo)
         (node:28720) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         4x Writing index files 1/20 (5.0%) | file_meta.json
         [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774\builds\20260201T210115Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774\builds\20260201T210115Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774\builds\20260201T210115Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774\builds\20260201T210115Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774\builds\20260201T210115Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774\builds\20260201T210115Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774\builds\20260201T210115Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-incremental-no-change\cache\repos\repo-f8ab53cfb774\builds\20260201T210115Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         4x [init] load config (1ms)
         2x [init] cache root (env): C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache
         2x [init] repo cache root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934
         4x [init] repo provenance (63ms)
         [init] dictionaries (329ms)
         2x Incremental cache enabled (root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\incremental).
         9x Worker pool enabled (auto, maxThreads=16).
         9x Worker pool auto threshold: maxFileBytes=524288.
         4x [init] worker pools (10ms)
         [init] runtime ready (433ms)
         → Preprocess: 28 files across 4 mode(s).
         → Found 11 files.
         3x code Imports 11/11 (done)
         2x [git] Git metadata unavailable. (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\repo)
         code Files 3/11
         code Files 10/11
         4x code Files 11/11 (done)
         (node:17760) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         Cross-File Inference: 3 Call Links, 36 Usage Links, 5 Returns, 0 Risk Flows
         Cross-file inference updated 11 incremental bundle(s).
         → Indexed 28 chunks, total tokens: 966
         📦  code : 28 chunks, 117 tokens, dims=0
         → Found 14 files.
         Auto-selected context window: 5 lines
         extracted-prose Files 7/14
         extracted-prose Files 12/14
         3x extracted-prose Files 14/14 (done)
         Writing index files 1/11 (9.1%) | chunk_meta.json
         [embeddings] code: processed 8/11 files
         [embeddings] code: processed 11/11 files
         [embeddings] code/merged: wrote HNSW index (28 vectors).
         [embeddings] code/doc: wrote HNSW index (28 vectors).
         [embeddings] code/code: wrote HNSW index (28 vectors).
         [embeddings] code/merged: wrote LanceDB table (28 vectors).
         [embeddings] code/doc: wrote LanceDB table (28 vectors).
         [embeddings] code/code: wrote LanceDB table (28 vectors).
         [embeddings] code: wrote 28 vectors (dims=384).
         2x [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210143Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         2x [sqlite] Using incremental bundles for code (11 files).
         2x [sqlite] bundles 1/11 (9.1%) | src/sample.c
         2x [sqlite] bundles 11/11 (100.0%) | src/sample.swift
         2x [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210143Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (28 code, 0 prose, 0 extracted-prose).
         2x [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210143Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         2x [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210143Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         2x [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210143Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         2x [sqlite] Using incremental bundles for extracted-prose (14 files).
         2x [sqlite] bundles 1/14 (7.1%) | src/sample.c
         2x [sqlite] bundles 14/14 (100.0%) | src/sample.swift
         2x [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210143Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         2x [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210143Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         2x [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210143Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         [DONE] Index built for 14 files in 15 seconds (190 lines).
                                         Code: 11 files  (167 lines).
                              Extracted Prose: 14 files  (190 lines).
         [init] repo provenance (64ms)
         2x [init] worker pools (8ms)
         [init] runtime ready (453ms)
         2x → Preprocess: 26 files across 4 mode(s).
         2x → Found 10 files.
         6x code Imports 10/10 (done)
         8x code Files 10/10 (done)
         (node:24172) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         Cross-File Inference: 3 Call Links, 35 Usage Links, 5 Returns, 0 Risk Flows
         2x Cross-file inference updated 10 incremental bundle(s).
         → Indexed 27 chunks, total tokens: 948
         2x → Found 13 files.
         2x extracted-prose Files 6/13
         2x extracted-prose Files 11/13
         6x extracted-prose Files 13/13 (done)
         2x [embeddings] code: processed 10/10 files
         2x [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210201Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         4x [sqlite] Using incremental bundles for code (10 files).
         4x [sqlite] bundles 1/10 (10.0%) | src/sample.c
         2x [sqlite] bundles 10/10 (100.0%) | src/renamed.js
         2x [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210201Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (27 code, 0 prose, 0 extracted-prose).
         2x [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210201Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         2x [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210201Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         2x [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210201Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         4x [sqlite] Using incremental bundles for extracted-prose (13 files).
         4x [sqlite] bundles 1/13 (7.7%) | src/sample.c
         2x [sqlite] bundles 13/13 (100.0%) | src/renamed.js
         2x [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210201Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         2x [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210201Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         2x [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-compact\cache\repos\repo-417a974e6934\builds\20260201T210201Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         [DONE] Index built for 13 files in 12 seconds (188 lines).
         2x                                 Code: 10 files  (165 lines).
         2x                      Extracted Prose: 13 files  (188 lines).
         [warn] [sqlite] Incremental update skipped for code: change ratio 1.00 (changed=10, deleted=0, total=10) exceeds 0.35.
         [warn] [sqlite] Incremental update skipped for extracted-prose: change ratio 1.00 (changed=13, deleted=0, total=13) exceeds 0.35.
         SQLite compact 0/2 compacting code
         SQLite compact 2/2 (done) compacted prose
         SQLite compaction complete.
         2x [init] cache root (env): C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache
         2x [init] repo cache root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4
         3x [init] repo provenance (62ms)
         [init] dictionaries (331ms)
         [init] runtime ready (432ms)
         2x [git] Git metadata unavailable. (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\repo)
         (node:3068) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         2x [sqlite:code] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         2x [sqlite:code] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210216Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         4x SQLite 1/1 code done
         4x SQLite 1/1 (done) code done
         [init] dictionaries (317ms)
         Incremental cache enabled (root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\incremental).
         [init] runtime ready (418ms)
         (node:23588) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         2x Overall 20/27 code embeddings
         2x Overall 22/27 extracted-prose embeddings
         [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         [sqlite:code] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         [sqlite:code] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-sidecar-cleanup\cache\repos\repo-4b6a75fa42f4\builds\20260201T210234Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         2x [sqlite] SQLite Index Updated.
         2x [init] cache root (env): C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache
         2x [init] repo cache root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8
         [init] embedding runtime (2ms)
         [init] dictionaries (361ms)
         2x Incremental cache enabled (root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\incremental).
         [init] worker pools (9ms)
         [init] runtime ready (463ms)
         2x [git] Git metadata unavailable. (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\repo)
         code Files 3/10
         code Files 9/10
         (node:25780) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         Cross-File Inference: 3 Call Links, 36 Usage Links, 4 Returns, 0 Risk Flows
         → Indexed 27 chunks, total tokens: 952
         📦  code : 27 chunks, 115 tokens, dims=0
         [embeddings] code: processed 8/10 files
         2x [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210250Z_a8a7a72_f7c66aee\index-sqlite\index-code.db
         2x [sqlite] bundles 10/10 (100.0%) | src/sample.swift
         2x [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210250Z_a8a7a72_f7c66aee\index-sqlite\index-code.db (27 code, 0 prose, 0 extracted-prose).
         2x [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210250Z_a8a7a72_f7c66aee\index-sqlite\index-prose.db
         2x [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210250Z_a8a7a72_f7c66aee\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         2x [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210250Z_a8a7a72_f7c66aee\index-sqlite\index-extracted-prose.db
         2x [sqlite] bundles 13/13 (100.0%) | src/sample.swift
         2x [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210250Z_a8a7a72_f7c66aee\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         2x [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210250Z_a8a7a72_f7c66aee\index-sqlite\index-records.db
         2x [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210250Z_a8a7a72_f7c66aee\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         [DONE] Index built for 13 files in 14 seconds (188 lines).
         [init] dictionaries (341ms)
         [init] runtime ready (442ms)
         (node:18896) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         → Indexed 26 chunks, total tokens: 937
         [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-code.db
         [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-prose.db
         [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-extracted-prose.db
         [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-records.db
         [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         [DONE] Index built for 12 files in 12 seconds (186 lines).
         [sqlite:code] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-code.db
         [sqlite:code] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\sqlite-ann-extension\cache\repos\repo-0bb1a79684c8\builds\20260201T210312Z_a8a7a72_f7c66aee\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         [sqlite] Vector extension candidate set too large; using best-effort fallback.
         [sqlite] Vector extension disabled: invalid identifiers
         [init] cache root (env): C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache
         [init] repo cache root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505
         [init] dictionaries (358ms)
         [init] runtime ready (460ms)
         [git] Git metadata unavailable. (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\repo)
         (node:23544) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         Embeddings 0/1 building code
         [2026-02-01T21:03:42Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-code\dense_vectors.lancedb/vectors.lance, it will be created
         [2026-02-01T21:03:42Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-code\dense_vectors_doc.lancedb/vectors.lance, it will be created
         [2026-02-01T21:03:42Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-code\dense_vectors_code.lancedb/vectors.lance, it will be created
         [embeddings] code: SQLite dense vectors updated (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db).
         Embeddings 1/1 (done) built code
         Embeddings 0/1 building prose
         [2026-02-01T21:03:43Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-prose\dense_vectors.lancedb/vectors.lance, it will be created
         [2026-02-01T21:03:43Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-prose\dense_vectors_doc.lancedb/vectors.lance, it will be created
         [2026-02-01T21:03:43Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-prose\dense_vectors_code.lancedb/vectors.lance, it will be created
         [embeddings] prose: SQLite dense vectors updated (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-ann\cache\repos\repo-f3f0be80d505\builds\20260201T210327Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db).
         Embeddings 1/1 (done) built prose
         [init] cache root (env): C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache
         [init] repo cache root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache\repos\repo-4a7b5eabea5d
         [init] dictionaries (355ms)
         [init] worker pools (15ms)
         [git] Git metadata unavailable. (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\repo)
         (node:32676) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache\repos\repo-4a7b5eabea5d\builds\20260201T210349Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache\repos\repo-4a7b5eabea5d\builds\20260201T210349Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache\repos\repo-4a7b5eabea5d\builds\20260201T210349Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache\repos\repo-4a7b5eabea5d\builds\20260201T210349Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache\repos\repo-4a7b5eabea5d\builds\20260201T210349Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache\repos\repo-4a7b5eabea5d\builds\20260201T210349Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache\repos\repo-4a7b5eabea5d\builds\20260201T210349Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\lancedb-ann\cache\repos\repo-4a7b5eabea5d\builds\20260201T210349Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         tantivy smoke test skipped (set PAIROFCLEATS_TEST_TANTIVY=1 to run).
         [init] cache root (env): C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache
         [init] repo cache root: C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180
         [init] dictionaries (411ms)
         [init] ignore rules (4ms)
         [init] worker pools (16ms)
         [init] runtime ready (532ms)
         [git] Git metadata unavailable. (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\repo)
         code Files 2/9
         code Files 7/9
         (node:11848) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
         Writing index files 1/12 (8.3%) | file_meta.json
         [sqlite] code building code index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db
         [sqlite] code code index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db (26 code, 0 prose, 0 extracted-prose).
         [sqlite] prose building prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db
         [sqlite] prose prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db (0 code, 3 prose, 0 extracted-prose).
         [sqlite] extracted-prose building extracted-prose index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db
         [sqlite] extracted-prose extracted-prose index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-extracted-prose.db (0 code, 0 prose, 2 extracted-prose).
         [sqlite] records building records index -> C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db
         [sqlite] records records index built at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-records.db (0 code, 0 prose, 0 extracted-prose).
         [DONE] Index built for 12 files in 15 seconds (186 lines).
         Embeddings 0/4 building code
         [2026-02-01T21:04:26Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-code\dense_vectors.lancedb/vectors.lance, it will be created
         [2026-02-01T21:04:26Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-code\dense_vectors_doc.lancedb/vectors.lance, it will be created
         [2026-02-01T21:04:26Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-code\dense_vectors_code.lancedb/vectors.lance, it will be created
         [embeddings] code: SQLite dense vectors updated (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-code.db).
         [2026-02-01T21:04:26Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-prose\dense_vectors.lancedb/vectors.lance, it will be created
         [2026-02-01T21:04:26Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-prose\dense_vectors_doc.lancedb/vectors.lance, it will be created
         [2026-02-01T21:04:26Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-prose\dense_vectors_code.lancedb/vectors.lance, it will be created
         [embeddings] prose: SQLite dense vectors updated (C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-sqlite\index-prose.db).
         [2026-02-01T21:04:26Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-extracted-prose\dense_vectors.lancedb/vectors.lance, it will be created
         [2026-02-01T21:04:26Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-extracted-prose\dense_vectors_doc.lancedb/vectors.lance, it will be created
         [2026-02-01T21:04:26Z WARN  lance::dataset::write::insert] No existing dataset at C:\Users\sneak\Development\PairOfCleats_CODEX\.testCache\hnsw-atomic\cache\repos\repo-591592e92180\builds\20260201T210410Z_a8a7a72_cc36ecc3\index-extracted-prose\dense_vectors_code.lancedb/vectors.lance, it will be created
         Embeddings 4/4 (done) built records
         3x node:internal/modules/run_main:107
         3x     triggerUncaughtException(
         3x     ^
         3x AssertionError [ERR_ASSERTION]: should invalidate on signature change
         3x + actual - expected
         3x + {
         3x +   close: [Function: close]
         3x + }
         3x - null
         3x     at file:///C:/Users/sneak/Development/PairOfCleats_CODEX/tests/storage/sqlite/sqlite-cache.test.js:22:8 {
         3x   generatedMessage: false,
         3x   code: 'ERR_ASSERTION',
         3x   actual: { close: [Function: close] },
         3x   expected: null,
         3x   operator: 'strictEqual',
         3x   diff: 'simple'
         3x }
         Failed: sqlite-cache-test (attempt 1/3). Log: C:\Users\sneak\Development\PairOfCleats_CODEX\.testLogs\run-1769978945244-hirznc\sqlite-cache-test.attempt-1.log
         2x Retrying: sqlite-cache-test
         Failed: sqlite-cache-test (attempt 2/3). Log: C:\Users\sneak\Development\PairOfCleats_CODEX\.testLogs\run-1769978945244-hirznc\sqlite-cache-test.attempt-2.log
         Failed: sqlite-cache-test (attempt 3/3). Log: C:\Users\sneak\Development\PairOfCleats_CODEX\.testLogs\run-1769978945244-hirznc\sqlite-cache-test.attempt-3.log
         LOG: ./.testLogs/run-1769978945244-hirznc/tooling_script-coverage_script-coverage.attempt-1.log


  LOGS: ./.testLogs/run-1769978945244-hirznc
         ╶╶╴-╴-╶-╶╶╶-=---╶---=--╶--=---=--=-=-=--=---=--╶--=---╶---=-╴╴╴-╴-╶-╶╴╴
```