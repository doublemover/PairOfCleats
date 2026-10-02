# Cache Key + Invalidation Spec

Status: Active v2.0  
Last updated: 2026-02-20T00:00:00Z

## Goals

- Define one deterministic cache-key schema for all cache layers.
- Ensure stale cache rejection is complete and deterministic.
- Keep invalidation semantics explicit for parser/chunking/caps/segmentation changes.

## Non-goals

- No backward compatibility for legacy cache layouts.

## Key schema

Key fields (normalized, concatenated, then hashed):

- `repoHash`: repo file-set/content hash.
- `buildConfigHash`: normalized config hash for build-affecting settings.
- `mode`: `code | prose | extracted-prose | records`.
- `schemaVersion`: artifact schema version.
- `featureFlags`: normalized sorted feature toggles.
- `pathPolicy`: `posix | native`.
- `languageId`: effective language for language-scoped caches.
- `parserVersion`: parser/runtime version for language parser.
- `grammarHash`: grammar artifact hash where applicable.
- `chunkingConfigVersion`: chunking policy version.
- `fileCapsVersion`: cap policy version.
- `segmentationVersion`: segmentation policy version for embedded-language files.

Key prefix:

- `cacheNamespace`
- `cacheKeyVersion`

Example payload:

`repoHash|buildConfigHash|mode|schemaVersion|featureFlags|pathPolicy|languageId|parserVersion|grammarHash|chunkingConfigVersion|fileCapsVersion|segmentationVersion`

Example full key:

`cacheNamespace:cacheKeyVersion:sha1(payload)`

## Invalidation rules

Any component change invalidates affected cache entries. Required invalidation triggers include:

1. File content or file set change.
2. Mode change.
3. Parser/runtime version change.
4. Grammar artifact change.
5. Chunking/cap/segmentation policy change.
6. Feature flag change.
7. Artifact schema version change.

## Cache layers

- In-memory hot caches.
- Persistent AST/chunk caches.
- VFS/segment caches.
- Query-plan/retrieval caches.

All layers must apply the same key schema components relevant to the cached artifact.

### SQLite handle ownership

SQLite cache entries are scoped to a physical path and its participating mode
generations. `acquire(path, options)` returns a `{ db, release }` lease for a
valid hit. `setAndAcquire(path, db, options)` pins a new handle before inserting
it, so capacity eviction cannot close a handle still used by a request.

Eviction, expiry, signature changes, and generation replacement remove cache
discoverability immediately. Physical close occurs after the final active lease
is released. Releases are idempotent and refer to the exact acquired entry.
`onEvict` reports logical eviction; a leased handle may still be open at that time.

`closeAll()` clears entries while leaving the cache reusable for generation
refresh. `dispose()` terminally retires it; later `setAndAcquire` calls produce
uncached leases that close on release. Disabled caches use the same uncached
lease ownership. Raw `get`/`set` callers retain their existing unleased behavior.

Search backends own newly opened handles before validation and release them on
initialization failure. Backend contexts expose idempotent disposal; the search
runner awaits cleanup on completion, failure, and cancellation, retaining both
initial and reinitialized contexts until finalization. LMDB close is awaited.
Cleanup attempts every owned resource without replacing the original operation
error. Custom caches exposing only `get`/`set` retain external ownership and must
adopt the lease protocol to provide active-request eviction protection.

## Cache clear/rebuild behavior

- `PAIROFCLEATS_CACHE_REBUILD=1` forces versioned cache root rebuild.
- `build-index --cache-rebuild` enables full rebuild.
- `pairofcleats cache clear` removes active versioned cache root.

## Logging and observability

- Emit cache hit/miss counters by namespace.
- Emit deterministic invalidation reason codes.
- Include key-version metadata in diagnostics.

## Compatibility policy

No legacy cache-key aliases are supported.
