# Environment Overrides

PairOfCleats supports a small set of environment variables for advanced overrides and CI tooling. Prefer profiles and config files when possible.

## Priority order
1) CLI flags
2) `.pairofcleats.json`
3) `PAIROFCLEATS_PROFILE` (profile config)
4) Other `PAIROFCLEATS_*` env overrides

## Supported env vars (selected)
- `PAIROFCLEATS_PROFILE`: apply a profile from `profiles/*.json`.
- `PAIROFCLEATS_CACHE_ROOT`: override the cache root.
- `PAIROFCLEATS_HOME`: override the cache home directory (highest precedence for cache root selection).
- `PAIROFCLEATS_DICT_DIR`: override dictionaries directory.
- `PAIROFCLEATS_MODELS_DIR`: override models directory.
- `PAIROFCLEATS_TOOLING_DIR`: override tooling directory.
- `PAIROFCLEATS_EXTENSIONS_DIR`: override extensions directory.
- `PAIROFCLEATS_MODEL`: override embedding model id.
- `PAIROFCLEATS_EMBEDDINGS`: set to `stub` to bypass real embeddings.
- `PAIROFCLEATS_THREADS`: override indexing concurrency.
- `PAIROFCLEATS_BUNDLE_THREADS`: override SQLite bundle parse threads.
- `PAIROFCLEATS_MAX_OLD_SPACE_MB`: override Node heap size.
- `PAIROFCLEATS_NODE_OPTIONS`: append to Node options.
- `PAIROFCLEATS_UV_THREADPOOL_SIZE`: set `UV_THREADPOOL_SIZE` for spawned PairOfCleats Node processes (libuv threadpool size).
- `PAIROFCLEATS_STAGE`: force indexing stage (`stage1` sparse without relations/imports, `stage2` enrichment, `stage3` embeddings pass, `stage4` sqlite/ANN pass).
- `PAIROFCLEATS_WORKER_POOL`: control worker pool (`on`/`off`/`auto`).
- `PAIROFCLEATS_VERBOSE`: enable verbose logging.
- `PAIROFCLEATS_XXHASH_BACKEND`: select `auto|native|wasm` for xxhash backend selection.
- `PAIROFCLEATS_PROGRESS_FILES`: show file progress during indexing.
- `PAIROFCLEATS_PROGRESS_LINES`: show line progress during indexing.
- `PAIROFCLEATS_MAX_JSON_BYTES`: override JSON artifact size guardrails (bytes).
> Note: `UV_THREADPOOL_SIZE` must be set **before** a Node process starts. PairOfCleats applies `PAIROFCLEATS_UV_THREADPOOL_SIZE` by exporting `UV_THREADPOOL_SIZE` when spawning child Node processes (e.g. via `bin/pairofcleats.js`).

