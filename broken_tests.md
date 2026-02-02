# Broken Tests

---

Note: Full `ci-long` run on 2026-02-02T16:24:54.3936675-05:00 with `--timeout-ms 240000`, `--jobs 4`, `--allow-timeouts`. Log root: `.\.testLogs\run-1770066489447-vptvd9`.

- [ ] cli/search/search-tie-order
Log: `.\.testLogs\run-1770066489447-vptvd9\cli_search_search-tie-order.attempt-1.log`
Log Excerpt:
```text
Found 0 files.
Index built for 0 files in 5 seconds (0 lines).
Expected at least 3 prose hits for backend=memory.
```
Observed Error: Expected at least 3 prose hits for backend=memory.
Likely Cause: Index build found 0 files, so search returned no prose hits.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/cli/search/search-tie-order.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] indexing/artifacts/artifact-size-guardrails
Log: `.\.testLogs\run-1770066489447-vptvd9\indexing_artifacts_artifact-size-guardrails.attempt-1.log`
Log Excerpt:
```text
Found 0 files.
Index built for 0 files in 1 seconds (0 lines).
Expected chunk_meta sharding when max JSON bytes is small.
```
Observed Error: Expected chunk_meta sharding when max JSON bytes is small.
Likely Cause: Index build found 0 files, so sharding guardrails never triggered.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/indexing/artifacts/artifact-size-guardrails.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] indexing/chunking/comment-join
Log: `.\.testLogs\run-1770066489447-vptvd9\indexing_chunking_comment-join.attempt-1.log`
Log Excerpt:
```text
comment join test failed: expected extracted-prose hit missing.
```
Observed Error: Expected extracted-prose hit missing.
Likely Cause: Unknown; needs local inspection of test fixture and extracted-prose pipeline.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/indexing/chunking/comment-join.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] indexing/determinism/symbol-artifact-determinism
Log: `.\.testLogs\run-1770066489447-vptvd9\indexing_determinism_symbol-artifact-determinism.attempt-1.log`
Log Excerpt:
```text
Found 0 files.
Index built for 0 files in 16 seconds (0 lines).
Missing symbols.jsonl at C:\Users\sneak\Development\DOUBLECLEAT\.testCache\symbol-artifact-determinism\cache-a\repos\repo-2a2b4827dba5\builds\20260202T210839Z_fb330c9_ee738a8c\index-code\symbols.jsonl
```
Observed Error: Missing symbols.jsonl artifact.
Likely Cause: Index build found 0 files, so symbols artifacts were never emitted.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/indexing/determinism/symbol-artifact-determinism.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] indexing/embeddings/embeddings-cache-identity
Log: `.\.testLogs\run-1770066489447-vptvd9\indexing_embeddings_embeddings-cache-identity.attempt-1.log`
Log Excerpt:
```text
Found 0 files.
Index built for 0 files in 15 seconds (0 lines).
embeddings cache identity test failed: missing cache files
```
Observed Error: Missing cache files for embeddings cache identity test.
Likely Cause: Index build found 0 files, so no embedding cache artifacts were produced.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/indexing/embeddings/embeddings-cache-identity.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] indexing/embeddings/embeddings-dims-mismatch
Log: `.\.testLogs\run-1770066489447-vptvd9\indexing_embeddings_embeddings-dims-mismatch.attempt-1.log`
Log Excerpt:
```text
Found 0 files.
Index built for 0 files in 16 seconds (0 lines).
embeddings dims mismatch test failed: no cache files found
```
Observed Error: No cache files found for embeddings dims mismatch test.
Likely Cause: Index build found 0 files, so no embedding cache artifacts were produced.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/indexing/embeddings/embeddings-dims-mismatch.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] indexing/extracted-prose/extracted-prose
Log: `.\.testLogs\run-1770066489447-vptvd9\indexing_extracted-prose_extracted-prose.attempt-1.log`
Log Excerpt:
```text
Extracted-prose test failed: expected hit missing.
```
Observed Error: Expected extracted-prose hit missing.
Likely Cause: Unknown; needs investigation of extracted-prose indexing/search path.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/indexing/extracted-prose/extracted-prose.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] indexing/incremental/incremental-cache-signature
Log: `.\.testLogs\run-1770066489447-vptvd9\indexing_incremental_incremental-cache-signature.attempt-1.log`
Log Excerpt:
```text
Found 0 files.
Index built for 0 files in 12 seconds (0 lines).
Expected cached entry after incremental rebuild
```
Observed Error: Expected cached entry after incremental rebuild.
Likely Cause: Index build found 0 files, so incremental cache never populated.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/indexing/incremental/incremental-cache-signature.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] indexing/incremental/incremental-tokenization-cache
Log: `.\.testLogs\run-1770066489447-vptvd9\indexing_incremental_incremental-tokenization-cache.attempt-1.log`
Log Excerpt:
```text
Found 0 files.
Index built for 0 files in 15 seconds (0 lines).
Expected sample entry for src.js
```
Observed Error: Expected sample entry for src.js.
Likely Cause: Index build found 0 files, so tokenization cache never populated.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/indexing/incremental/incremental-tokenization-cache.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] indexing/map/code-map-guardrails
Log: `.\.testLogs\run-1770066489447-vptvd9\indexing_map_code-map-guardrails.attempt-1.log`
Log Excerpt:
```text
Found 0 files.
Index built for 0 files in 15 seconds (0 lines).
Failed: guardrails did not truncate
```
Observed Error: Guardrails did not truncate.
Likely Cause: Index build found 0 files, so map guardrails never triggered.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocation in `tests/indexing/map/code-map-guardrails.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] tooling/script-coverage/script-coverage
Log: `.\.testLogs\run-1770066489447-vptvd9\tooling_script-coverage_script-coverage.attempt-1.log`
Log Excerpt:
```text
[error] Error: No extension binary found in C:\Users\sneak\Development\DOUBLECLEAT\.testCache\download-extensions\zip-slip\.tmp\vec0-1770067278116.zip
[error] Error: unsafe tar entry: ../pwned-tar.txt
Missing file_manifest entry for src/index.js
Failed: sqlite-incremental-test (attempt 3/3).
```
Observed Error: Extension download/zip-slip checks failed; sqlite-incremental test failed with missing file_manifest entry.
Likely Cause: Extension downloader errors plus index build found 0 files for sqlite-incremental fixture.
Fix Attempts:
Attempt 1 (2026-02-02T16:35:51.8103126-05:00): Added `--scm-provider none` to build_index invocations in `tests/storage/sqlite/incremental/file-manifest-updates.test.js`.
Retest Result: FAIL (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] lang/fixtures-sample/python-metadata (timeout)
Log: `.\.testLogs\run-1770066489447-vptvd9\lang_fixtures-sample_python-metadata.attempt-1.log`
Log Excerpt:
```text
Preprocess: 24 files across 4 mode(s).
Tree-sitter missing for clike/cpp/objc/rust.
Worker pool unavailable; using main thread.
```
Observed Error: Timed out after 240000ms.
Likely Cause: Slow fallback parsing without worker pool and missing tree-sitter WASM.
Fix Attempts: None yet.
Retest Result: TIMEOUT (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] lang/fixtures-sample/rust-metadata (timeout)
Log: `.\.testLogs\run-1770066489447-vptvd9\lang_fixtures-sample_rust-metadata.attempt-1.log`
Log Excerpt:
```text
Preprocess: 24 files across 4 mode(s).
Tree-sitter missing for clike/cpp/objc/rust.
Worker pool unavailable; using main thread.
```
Observed Error: Timed out after 240000ms.
Likely Cause: Slow fallback parsing without worker pool and missing tree-sitter WASM.
Fix Attempts: None yet.
Retest Result: TIMEOUT (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] lang/fixtures-sample/swift-metadata (timeout)
Log: `.\.testLogs\run-1770066489447-vptvd9\lang_fixtures-sample_swift-metadata.attempt-1.log`
Log Excerpt:
```text
Preprocess: 24 files across 4 mode(s).
Tree-sitter missing for clike/cpp/objc/rust.
Worker pool unavailable; using main thread.
```
Observed Error: Timed out after 240000ms.
Likely Cause: Slow fallback parsing without worker pool and missing tree-sitter WASM.
Fix Attempts: None yet.
Retest Result: TIMEOUT (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] retrieval/contracts/compact-json (timeout)
Log: `.\.testLogs\run-1770066489447-vptvd9\retrieval_contracts_compact-json.attempt-1.log`
Log Excerpt:
```text
Preprocess: 24 files across 4 mode(s).
Tree-sitter missing for clike/cpp/objc/rust.
Worker pool unavailable; using main thread.
```
Observed Error: Timed out after 240000ms.
Likely Cause: Slow fallback parsing without worker pool and missing tree-sitter WASM.
Fix Attempts: None yet.
Retest Result: TIMEOUT (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] retrieval/contracts/result-shape (timeout)
Log: `.\.testLogs\run-1770066489447-vptvd9\retrieval_contracts_result-shape.attempt-1.log`
Log Excerpt:
```text
Preprocess: 24 files across 4 mode(s).
Tree-sitter missing for clike/cpp/objc/rust.
Worker pool unavailable; using main thread.
```
Observed Error: Timed out after 240000ms.
Likely Cause: Slow fallback parsing without worker pool and missing tree-sitter WASM.
Fix Attempts: None yet.
Retest Result: TIMEOUT (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] retrieval/filters/ext-path (timeout)
Log: `.\.testLogs\run-1770066489447-vptvd9\retrieval_filters_ext-path.attempt-1.log`
Log Excerpt:
```text
Preprocess: 24 files across 4 mode(s).
Tree-sitter missing for clike/cpp/objc/rust.
Worker pool unavailable; using main thread.
```
Observed Error: Timed out after 240000ms.
Likely Cause: Slow fallback parsing without worker pool and missing tree-sitter WASM.
Fix Attempts: None yet.
Retest Result: TIMEOUT (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] retrieval/filters/type-signature-decorator (timeout)
Log: `.\.testLogs\run-1770066489447-vptvd9\retrieval_filters_type-signature-decorator.attempt-1.log`
Log Excerpt:
```text
Preprocess: 24 files across 4 mode(s).
Tree-sitter missing for clike/cpp/objc/rust.
Worker pool unavailable; using main thread.
```
Observed Error: Timed out after 240000ms.
Likely Cause: Slow fallback parsing without worker pool and missing tree-sitter WASM.
Fix Attempts: None yet.
Retest Result: TIMEOUT (ci-long run 2026-02-02T16:24:54.3936675-05:00)

- [ ] retrieval/parity/parity (timeout)
Log: `.\.testLogs\run-1770066489447-vptvd9\retrieval_parity_parity.attempt-1.log`
Log Excerpt:
```text
Index built for 1,666 files in 194 seconds (176,688 lines).
Query file not found or empty; using fallback queries (10).
```
Observed Error: Timed out after 240000ms.
Likely Cause: Long-running parity check after full index build; may need optimized queries or more resources.
Fix Attempts: None yet.
Retest Result: TIMEOUT (ci-long run 2026-02-02T16:24:54.3936675-05:00)
