# SQLite ANN Extension

PairOfCleats can optionally use a loadable SQLite vector extension (for example,
sqlite-vec) to execute ANN queries inside SQLite. This is optional and falls
back to the JS ANN path when the extension or vector table is unavailable.

## Setup
- Default provider: sqlite-vec (`vec0` module), but any compatible SQLite vector
  extension can be configured.
- Download a loadable extension binary for your platform.
- Place it under the extensions cache (default `<cache>/extensions`), or point
  `sqlite.vectorExtension.path` at the file.
- Rebuild the SQLite indexes so the `dense_vectors_ann` table is created.
`download-extensions` can read `sqlite.vectorExtension.downloads` keyed by
`<platform>-<arch>` (for example, `win32-x64`).
The download helper supports `.zip`, `.tar`, `.tar.gz`, and `.tgz` archives by
extracting the extension binary (matching the configured filename or platform
suffix).
If `vectorExtension.path` is set, it overrides the `dir` + `filename` layout.

Use the helper:
```
pairofcleats download-extensions --url vec0.dll=https://example.com/vec0.dll
```

Verify the extension install (presence-only):
```
pairofcleats verify-extensions --no-load
```

## Configuration
```
{
  "sqlite": {
    "annMode": "extension",
    "vectorExtension": {
      "provider": "sqlite-vec",
      "dir": "C:/cache/pairofcleats/extensions",
      "path": "",
      "downloads": {
        "win32-x64": { "url": "https://example.com/vec0.dll", "file": "vec0.dll" },
        "darwin-arm64": { "url": "https://example.com/vec0.dylib", "file": "vec0.dylib" },
        "linux-x64": { "url": "https://example.com/vec0.so", "file": "vec0.so" }
      },
      "table": "dense_vectors_ann",
      "column": "embedding",
      "encoding": "float32",
      "options": ""
    }
  }
}
```
Use `vectorExtension.options` for extension-specific flags (for example, distance
metric settings).

## Build
```
pairofcleats build-sqlite-index
```
When the extension loads successfully, the build creates `dense_vectors_ann` and
stores float32 embeddings for ANN queries.

## Search
```
pairofcleats search --backend sqlite "query"
```
If the extension or table is missing, `search.js` warns and uses the JS ANN
implementation instead.

## Notes
- Extensions are stored outside the repo under the cache root.
- Environment overrides: `PAIROFCLEATS_EXTENSIONS_DIR`, `PAIROFCLEATS_VECTOR_EXTENSION`.
- `clean-artifacts` keeps extensions; `pairofcleats uninstall` removes them.
- The extension table is optional and not required for SQLite to work.
- `dense_vectors_ann` stores float32 embeddings, which increases SQLite size.
- `dense_vectors_ann` uses `rowid` = `doc_id` for lookups.
