# Embeddings Cache

## Purpose
The embeddings cache stores quantized vectors outside the index build directory so repeated builds can reuse embeddings without recomputation. It is safe to delete and is rebuilt on demand.

## Layout

Cache root resolution:
- scope = global: <OS cache root>/embeddings
- scope = repo or local: <repoCacheRoot>/embeddings
- dir override: indexing.embeddings.cache.dir (absolute path)

Default OS cache roots:
- Windows: %LOCALAPPDATA%/PairOfCleats
- Linux: $XDG_CACHE_HOME/pairofcleats (falls back to ~/.cache/pairofcleats)

Directory layout (segments are sanitized by replacing non [a-zA-Z0-9._-] with "_"):

```
<cacheRoot>/embeddings/<provider>/<modelId>/<dims>d/<mode>/
  cache.meta.json
  files/
    cache.index.json
    shards/
      shard-00000.bin
      shard-00001.bin
  <cacheKey>.embcache.zst   (legacy fallback when shards are not used)
  <cacheKey>.json           (legacy read-only)
```

`mode` is one of `code`, `prose`, `extracted-prose`, or `records`.

## Cache meta (cache.meta.json)

Written per mode directory:

```
{
  "version": 1,
  "identityKey": "<sha1>",
  "identity": { ... },
  "dims": 1536,
  "mode": "code",
  "provider": "openai",
  "modelId": "text-embedding-3-large",
  "normalize": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

`identity` is the normalized embedding identity (see `src/shared/embedding-identity.js`).

## Cache index (files/cache.index.json)

Versioned index tracking shard entries and LRU metadata:

- `version`: 1
- `identityKey`: identity key for the index
- `createdAt`, `updatedAt`
- `nextShardId`, `currentShard`
- `entries`: `{ [cacheKey]: { key, file, hash, chunkSignature, shard, offset, length, sizeBytes, chunkCount, createdAt, lastAccessAt, hits } }`
- `files`: `{ [filePath]: cacheKey }` (latest key per file)
- `shards`: `{ [shardName]: { createdAt, sizeBytes } }`

`file` is a repo-relative POSIX path.

## Shard format

Shard files are append-only. Each entry is stored as:

```
uint32_le length
<zstd-compressed payload bytes>
```

`offset` in the index refers to the payload start (after the 4-byte length prefix).

## Cache entry format

Cache entries are zstd-compressed binary buffers with a fixed header and three vector sections.

Header prefix (12 bytes):
- magic: `PCEB`
- version: uint32_le (currently 1)
- header length: uint32_le

Header JSON fields:
- `version`, `key`, `file`, `hash`, `chunkSignature`, `chunkHashes`
- `cacheMeta`: `{ schemaVersion: 1, identityKey, identity, createdAt }`
- `vectors`: `{ count, encoding: "uint8", order: ["code","doc","merged"], lengths: { code: "u16|u32", doc: "u16|u32", merged: "u16|u32" } }`

Vector sections (in order: code, doc, merged):
- length array encoded as u16 or u32 (little-endian)
- concatenated vector bytes

## Cache keys and invalidation

Cache key:

```
cacheKey = sha1(`${file}:${fileHash}:${chunkSignature}:${identityKey}`)
```

- `file` is the normalized repo-relative POSIX path.
- `fileHash` comes from manifest metadata when available, otherwise computed from file contents.
- `chunkSignature` is `sha1(start:end:docSignature)` per chunk (docSignature is sha1 of `chunk.docmeta.doc`), joined by `|`.
- `identityKey` is sha1 of the normalized embedding identity (provider, modelId, dims, quantization, pooling, truncation, etc).

An entry is valid only when:
- `cached.chunkSignature === chunkSignature`
- `cached.cacheMeta.identityKey === identityKey`
- `cached.hash === fileHash` (when a file hash is present)

If `cache.meta.json` or `cache.index.json` has a mismatched `identityKey`, the cache is treated as empty.

## Partial reuse

When a file changes, the cache can reuse unchanged chunks:

- `chunkHashes[i] = sha1(codeText + "\n" + trimmedDocText)`
- On a miss for the current cache key, the most recent prior cache entry for the same file
  (from `cache.index.files[filePath]`) is scanned.
- Matching chunk hashes reuse vectors for those chunk positions only.

## Pruning

Pruning uses LRU metadata in the cache index:
- `maxAgeDays` removes entries older than the cutoff (based on `lastAccessAt`, falling back to `createdAt`).
- `maxGb` removes least-recently-used entries until size is within limit.
- Empty shards are deleted.

## Configuration

`indexing.embeddings.cache`:
- `scope`: `global`, `repo`, or `local` (`repo` and `local` both use the repo cache root)
- `dir`: explicit cache root override (absolute)
- `maxGb`: size limit for pruning
- `maxAgeDays`: age limit for pruning

## Examples

### Cache hit
1. Build index with embeddings enabled.
2. Re-run index without code changes.
3. Cache index is reused; vectors are read from shard files.

### Partial reuse
1. Edit a single file in a repo.
2. Cache uses `chunkHashes` to reuse unchanged chunk vectors.
3. Only modified chunks are recomputed and written.

### Invalidation
1. Change embedding model, dims, or quantization settings.
2. `identityKey` changes.
3. Cache entries are skipped and new entries are generated.

## Legacy entries

Older per-file cache entries (`*.embcache.zst` or `*.json`) are still readable, but new writes use the index + shard layout when available.
