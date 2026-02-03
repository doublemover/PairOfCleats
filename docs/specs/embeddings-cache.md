# Embeddings Cache

## Purpose
The embeddings cache stores quantized vectors outside the index build directory so repeated builds can reuse embeddings without recomputation. It is safe to delete and is rebuilt on demand.

## Layout
Cache root (default):
- Windows: `%LOCALAPPDATA%/PairOfCleats`
- Linux: `$XDG_CACHE_HOME/pairofcleats` (falls back to `~/.cache/pairofcleats`)

Embeddings cache path:
```
<cacheRoot>/embeddings/<provider>/<model>/<dims>/<mode>/
  cache.meta.json
  files/
    cache.index.json
    shards/
      shard-00000.bin
      shard-00001.bin
```

Partitioning by provider, model, and dims prevents scanning unrelated caches. `mode` is one of `code`, `prose`, `extracted-prose`, or `records`.

## Cache Entry Format
Entries are stored as zstd-compressed binary buffers with a small header and length-prefixed vector sections.

Header fields:
- `key`: cache key (sha1 of file, hash, chunkSignature, identityKey)
- `file`: repo-relative path (posix)
- `hash`: file content hash
- `chunkSignature`: hash of chunk ranges + docmeta content
- `chunkHashes`: per-chunk hash of code text + doc text
- `cacheMeta.identityKey`: embedding identity hash
- `cacheMeta.identity`: embedding identity payload (provider, modelId, dims, quantization, etc)
- `vectors`: count and length encoding metadata

Vector payloads:
- `codeVectors`, `docVectors`, `mergedVectors` stored as Uint8 quantized vectors

## Index + Shards
`cache.index.json` tracks append-only entries and shard metadata:
- `entries[key]` includes `shard`, `offset`, `length`, `sizeBytes`, `createdAt`, `lastAccessAt`, and `hits`
- `files[path]` points to the most recent cache key for partial reuse
- `shards[name]` tracks shard size and createdAt

Shard files are append-only. Each entry is stored as:
```
uint32 length
<zstd payload bytes>
```

## Invalidation
Entries are valid when:
- `chunkSignature` matches
- `identityKey` matches
- `hash` matches (when present)

Partial reuse is supported when only some chunks change. `chunkHashes` allow matching unchanged chunks across cache entries for the same file path.

## Pruning
Pruning uses LRU metadata stored in the cache index. Entries are removed when:
- `maxAgeDays` is exceeded
- total size exceeds `maxGb`

Shards with no remaining entries are deleted.

## Configuration
`indexing.embeddings.cache`:
- `scope`: `global`, `repo`, or `local` (default `global`)
- `dir`: explicit cache root override
- `maxGb`: size limit for pruning
- `maxAgeDays`: age limit for pruning

## Legacy Entries
Older per-file cache entries (`*.embcache.zst` or `*.json`) are still readable, but new writes use the index + shard layout.
