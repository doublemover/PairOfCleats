# Cache Key + Invalidation Spec

## Goals
- Define a single cache key schema for all caches.
- Ensure cache invalidation is deterministic and complete.

## Non-goals
- Backward compatibility for old cache layouts.

## Key Schema
Key fields (concatenated and hashed):
- repoHash: hash of repo root content list + file hashes
- buildConfigHash: hash of config inputs affecting outputs
- mode: code / prose / extracted-prose
- schemaVersion: version of artifact schema
- featureFlags: normalized feature toggle list
- pathPolicy: posix or native

Key prefix:
- cacheNamespace: normalized namespace for cache isolation
- cacheKeyVersion: version tag for schema changes

Example key payload string:
repoHash|buildConfigHash|mode|schemaVersion|featureFlags|pathPolicy

Example full key:
cacheNamespace:cacheKeyVersion:sha1(payload)

Normalization:
- featureFlags are sorted and comma-joined.
- pathPolicy defaults to `native` on Windows, `posix` elsewhere unless explicitly set.
- cacheNamespace defaults to `pairofcleats` and can be overridden via `PAIROFCLEATS_CACHE_NAMESPACE`.

## Repo Hash
- Derived from discovery list, file hashes, and ignore rules.
- Must change if any file content changes.

## Build Config Hash
Include:
- tokenization config
- embeddings config
- stage caps
- filter index config
- artifact compression config

## Invalidation Rules
- Any key component change invalidates cache.
- File set changes invalidate resolved and unresolved import caches.
- Embeddings cache invalidates on model revision, dims, normalization, or quant change.
- VFS caches invalidate on manifest or routing config change.

## TTL / Expiry
- Optional TTL per cache type.
- Default: no TTL unless configured.

## Cache Layout
- Cache root is versioned by schemaVersion.
- Old caches are purged on schema change.

## Logging
- Log cache hits/misses with key prefix and reason.

## Breaking Changes
No backward compatibility; old caches are purged.
