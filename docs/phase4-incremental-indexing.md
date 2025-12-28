# Phase 4: Incremental Indexing (Per-File Cache)

## Goal
Avoid re-chunking and re-embedding unchanged files by caching per-file chunk bundles outside the repo.

## Cache Layout
- `<cache>/repos/<repoId>/incremental/<mode>/manifest.json`
- `<cache>/repos/<repoId>/incremental/<mode>/files/<sha1(relPath)>.json`

## Manifest Schema
```json
{
  "version": 1,
  "mode": "code",
  "files": {
    "src/index.js": {
      "hash": "<sha1>",
      "mtimeMs": 1700000000000,
      "size": 1234,
      "bundle": "<sha1>.json"
    }
  }
}
```

## Bundle Schema
```json
{
  "file": "src/index.js",
  "hash": "<sha1>",
  "mtimeMs": 1700000000000,
  "size": 1234,
  "chunks": [
    { "file": "src/index.js", "start": 0, "end": 120, "tokens": [], "embedding": [], "minhashSig": [] }
  ]
}
```

## Build Flow
1. Discover files (sorted) and build the import map.
2. For each file:
   - If `mtimeMs` and `size` match the manifest and a bundle exists, reuse it.
   - Otherwise, read and reprocess the file, then overwrite the bundle.
3. Rebuild global postings and index artifacts from chunk data.
4. Remove manifest entries for deleted files.

## CLI
- `node build_index.js --incremental`
- `npm run bootstrap -- --incremental` (or auto-enabled when cache exists)      

## SQLite incremental updates
- `node tools/build-sqlite-index.js --incremental` updates SQLite in place using the per-file cache.
- Falls back to a full rebuild if the manifest or bundles are missing.
- See `docs/sqlite-incremental-updates.md` for the detailed flow.

## Limitations
- Global postings are rebuilt each run (no in-place SQLite delta updates yet).
- Import scanning still reads all files, but the heavy embedding step is skipped for cached files.

## Future Enhancements
- Store precomputed n-grams/chargrams in bundles to reduce rebuild time.        
- Hook CI artifacts to ship incremental bundles alongside SQLite indexes.       
