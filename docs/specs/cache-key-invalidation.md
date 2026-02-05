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

## Local Cache Keys
In-memory caches should use the shared helper with a namespaced payload:
- `buildLocalCacheKey({ namespace, payload })` hashes a stable, versioned payload.
- Local keys are versioned via `LOCAL_CACHE_KEY_VERSION` for safe invalidation.
- Use descriptive namespaces (e.g., `graph-index`, `query-plan`, `context-pack-excerpt`).

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

## Cache Rebuild + Clear
- `PAIROFCLEATS_CACHE_REBUILD=1` forces the versioned cache root to be removed before use.
- `build-index --cache-rebuild` sets `PAIROFCLEATS_CACHE_REBUILD=1`.
- `pairofcleats cache clear` deletes the versioned cache root (use `--all` to remove legacy roots).

## Logging
- Log cache hits/misses with key prefix and reason.

## Breaking Changes
No backward compatibility; old caches are purged.
