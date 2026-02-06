# Build Warning/Error Triage (BUILDLIST)

## Runs
- Command: `node build_index.js --threads 16 --quality max`
- A (baseline success): `C:\Users\sneak\AppData\Local\PairOfCleats\ck1\repos\doublecleat-8857948ebbca\builds\20260206T095512Z_d1e6473_a343c955`
- B (failed OOM): `C:\Users\sneak\AppData\Local\PairOfCleats\ck1\repos\doublecleat-8857948ebbca\builds\20260206T103939Z_d1e6473_a343c955` (see `build_index_run.latest.log`)
- C (success, current): `C:\Users\sneak\AppData\Local\PairOfCleats\ck1\repos\doublecleat-8857948ebbca\builds\20260206T104639Z_d1e6473_a343c955` (see `build_index_run.retry1.log`)
- D (failed OOM): `C:\Users\sneak\AppData\Local\PairOfCleats\ck1\repos\doublecleat-8857948ebbca\builds\20260206T111056Z_d1e6473_a343c955` (see `build_index_run.retry2.log`)
- Validation: `node tools/index/validate.js --index-root '<buildRoot>' --json`

## Issues Found

### Tooling
- [x] Tooling doctor reports error: `pyright-langserver binary not available` (`tooling_report.json` summary: errors=1).
- [x] Node warning: `[DEP0190] DeprecationWarning: Passing args to a child process with shell option true...` (stdout during build).
- [ ] Swift tooling: `sourcekit-lsp` hover timeout, then circuit breaker trips (stdout).
- [x] clangd: “Failed to find compilation database ...” for VFS fixtures; reduce noise by running clangd with `--log=error` (verify on next full build).

### Validation
- [ ] `index-validate` warnings:
  - [x] Ordering ledger mismatch for `chunk_meta`:
    - prose: expected `sha1:2bacf71f...` got `sha1:6b55cacc...`
    - extracted-prose: expected `sha1:b80d19b1...` got `sha1:90b5c3ab...`
  - [x] Ordering ledger stage missing for records: `ordering ledger missing stage stage1:code`
  - [ ] Optional artifacts reported missing for non-code modes (file_relations/call_sites/risk_* / vfs_manifest).
  - [ ] LMDB warnings: `db missing` (code/prose).

### Embeddings
- [x] records: Stage3 embeddings failed to read `tests/fixtures/public-surface/records/sample.log` from triage records dir (ENOENT); skipped.

### Tree-sitter
- [ ] Many “Missing WASM grammar ... (WASM grammar not loaded)” and “Tree-sitter unavailable ... fallback to heuristic chunking” messages.
- [ ] Stage1 code tree-sitter metrics show heavy thrash:
  - `wasmLoads=1090`, `wasmEvictions=1089`, `cache.wasmLanguages=1`, `fallbacks=1286` (`build_state.stage-checkpoints.json`).

### Artifact Budgets/Telemetry
- [x] Budget log noise/confusion for shardable artifacts:
  - chunk_meta total bytes >> `MAX_JSON_BYTES` logs `(trim)` even though output is sharded and no trimming occurs.
  - symbol_occurrences / symbol_edges log `(trim)` due to total bytes > max, but writes shards and does not trim due to total budget.

### Other
- [ ] Import resolution: `[imports] suppressed 233 import resolution warnings.` (stdout; details not surfaced).
- [ ] Encoding: fallback decode used for several files (stdout).

## Work Log / Fix Attempts

### 1) Ordering ledger mismatch for `chunk_meta` (prose/extracted-prose)
- Discovery: `loadChunkMeta()` inflates `tokenIds` for JSON/columnar sources in strict mode, but not for JSONL sources, changing `JSON.stringify()` output used for ordering hashes.
- Fix: added `materializeTokenIds` option to `loadChunkMeta()` and defaulted it to `false` so loaders no longer add derived `tokenIds` by default.
- Verified: `node tools/index/validate.js --index-root '<buildRoot>' --json` now reports no `orderingDrift`.

### 2) records embeddings path (ENOENT)
- Discovery: embeddings runner resolves records file paths relative to `triage.recordsDir` even when filelists contain repo-relative paths (e.g. `tests/fixtures/...`).
- Fix: resolve records reads via repo root unless the filelist path is under `triage/records/` (with ENOENT fallback to the other candidate).

### 3) Tooling doctor pyright error + DEP0190 shell warning
- Discovery: tooling registry reports pyright “enabled=true” even when unavailable; spawning `.cmd` tooling with `shell:true` + args triggers DEP0190.
- Fix:
  - Tooling doctor: missing `pyright-langserver` is now a warning unless `tooling.enabledTools` explicitly includes `pyright` (still marks provider `available=false`).
  - Subprocess/LSP spawning: avoid passing args arrays when `shell:true` by building a shell command string.
- Verified:
  - `node tools/tooling/doctor.js --json` now reports `errors=0` (pyright is `warn`), and no DEP0190 output.

### 4) Ordering ledger stage missing for records
- Fix: pass `buildRoot` through records indexing (`src/integrations/triage/index-records.js`) so `writeIndexArtifacts()` records `stage2:records` ordering hashes.
- Verified: on build C, `node tools/index/validate.js --index-root '<buildRoot>' --json` no longer reports missing ordering ledger stage for records.

### 5) Byte budget overflow labels
- Fix: updated default overflow labels for shardable artifacts (`chunk_meta`, `symbol_occurrences`, `symbol_edges`, `call_sites`) from `(trim)` to `(shard)` to avoid implying data loss when writers shard output.

### 6) Tree-sitter cache thrash (partial mitigation)
- Fix: increased default `indexing.treeSitter.maxLoadedLanguages` (when `languagePasses` is enabled) from 1 to 3 to reduce WASM load/evict churn in mixed-language repos.

### 7) Tree-sitter missing grammars in Stage1 (language passes)
- Discovery: Stage1 per-batch preload/prune was gated on `treeSitter.languagePasses === false`, so the default (`languagePasses=true`) never loaded grammars before sync chunking, producing “Missing WASM grammar ... (WASM grammar not loaded)” and “Tree-sitter unavailable ...” fallbacks.
- Fix: always preload/prune per tree-sitter batch when `batchByLanguage` is enabled, regardless of `languagePasses`.
- Verified: tree-sitter contract tests still pass (no Stage1 integration validation yet).

### 8) clangd log noise
- Fix: pass `--log=error` in `src/index/tooling/clangd-provider.js` so clangd doesn’t spam info-level compilation DB messages during indexing.
- Verified: `node tests/indexing/type-inference/providers/type-inference-clangd-provider-no-clangd.test.js` passed (full build verification pending).

### 9) OOM regression after enabling Stage1 tree-sitter preloading
- Observation: build D crashed with `Fatal process out of memory: Zone` around `code Files 621/1,632`.
- Likely cause: per-batch tree-sitter preload path was also doing `resetTreeSitterParser({ hard: true })` and `pruneTreeSitterLanguages(...)` for every small batch, creating heavy churn in native/WASM allocations during Stage1.
- Fix (in progress): keep per-batch preload (to avoid missing-grammar fallbacks), but remove per-batch hard parser resets and per-batch prune calls. Next step is rerun `build_index` to confirm the OOM is gone.
