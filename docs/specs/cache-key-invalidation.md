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
