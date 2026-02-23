export const CACHE_INDEX_VERSION = 1;

export const createCacheIndex = (identityKey) => {
  const now = new Date().toISOString();
  return {
    version: CACHE_INDEX_VERSION,
    identityKey: identityKey || null,
    createdAt: now,
    updatedAt: now,
    nextShardId: 0,
    currentShard: null,
    entries: {},
    files: {},
    shards: {}
  };
};

export const normalizeCacheIndex = (index, identityKey) => {
  if (!index || typeof index !== 'object') return createCacheIndex(identityKey);
  if (index.version !== CACHE_INDEX_VERSION) return createCacheIndex(identityKey);
  const normalized = { ...index };
  normalized.identityKey = normalized.identityKey || identityKey || null;
  normalized.entries = { ...(normalized.entries || {}) };
  normalized.files = { ...(normalized.files || {}) };
  normalized.shards = { ...(normalized.shards || {}) };
  normalized.nextShardId = Number.isFinite(Number(normalized.nextShardId))
    ? Math.max(0, Math.floor(Number(normalized.nextShardId)))
    : Object.keys(normalized.shards).length;
  return normalized;
};

const parseIsoMillis = (value) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveLatestIso = (a, b) => {
  const aMs = parseIsoMillis(a);
  const bMs = parseIsoMillis(b);
  if (aMs && bMs) return aMs >= bMs ? a : b;
  if (aMs) return a;
  if (bMs) return b;
  return a || b || null;
};

const resolveEarliestIso = (a, b) => {
  const aMs = parseIsoMillis(a);
  const bMs = parseIsoMillis(b);
  if (aMs && bMs) return aMs <= bMs ? a : b;
  if (aMs) return a;
  if (bMs) return b;
  return a || b || null;
};

const mergeCacheIndexEntry = (existing = {}, incoming = {}) => {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    merged[key] = value;
  }
  const hasIncomingShard = Boolean(incoming.shard);
  const hasIncomingPath = Boolean(incoming.path);

  merged.key = incoming.key || existing.key || merged.key || null;
  merged.file = incoming.file || existing.file || merged.file || null;
  merged.hash = incoming.hash || existing.hash || merged.hash || null;
  merged.chunkSignature = incoming.chunkSignature || existing.chunkSignature || merged.chunkSignature || null;
  merged.shard = hasIncomingShard
    ? incoming.shard
    : (hasIncomingPath ? null : (existing.shard || merged.shard || null));
  merged.path = hasIncomingPath
    ? incoming.path
    : (hasIncomingShard ? null : (existing.path || merged.path || null));
  merged.offset = hasIncomingShard
    ? (Number.isFinite(Number(incoming.offset)) ? Number(incoming.offset) : null)
    : (hasIncomingPath
      ? null
      : (Number.isFinite(Number(existing.offset)) ? Number(existing.offset) : merged.offset || null));
  merged.length = hasIncomingShard
    ? (Number.isFinite(Number(incoming.length)) ? Number(incoming.length) : null)
    : (hasIncomingPath
      ? null
      : (Number.isFinite(Number(existing.length)) ? Number(existing.length) : merged.length || null));
  merged.sizeBytes = Number.isFinite(Number(incoming.sizeBytes))
    ? Number(incoming.sizeBytes)
    : (Number.isFinite(Number(existing.sizeBytes)) ? Number(existing.sizeBytes) : merged.sizeBytes || null);
  merged.chunkCount = Number.isFinite(Number(incoming.chunkCount))
    ? Number(incoming.chunkCount)
    : (Number.isFinite(Number(existing.chunkCount)) ? Number(existing.chunkCount) : merged.chunkCount || null);

  merged.createdAt = resolveEarliestIso(existing.createdAt, incoming.createdAt) || merged.createdAt || null;
  merged.lastAccessAt = resolveLatestIso(existing.lastAccessAt, incoming.lastAccessAt) || merged.lastAccessAt || null;
  merged.hits = Math.max(
    Number.isFinite(Number(existing.hits)) ? Number(existing.hits) : 0,
    Number.isFinite(Number(incoming.hits)) ? Number(incoming.hits) : 0
  );

  return merged;
};

export const mergeCacheIndex = (base, incoming) => {
  if (!base || typeof base !== 'object') return base;
  if (!incoming || typeof incoming !== 'object') return base;

  base.entries = { ...(base.entries || {}) };
  base.files = { ...(base.files || {}) };
  base.shards = { ...(base.shards || {}) };

  for (const [key, entry] of Object.entries(incoming.entries || {})) {
    const existing = base.entries[key] || null;
    base.entries[key] = existing ? mergeCacheIndexEntry(existing, entry) : entry;
  }

  for (const [file, key] of Object.entries(incoming.files || {})) {
    if (!file || !key) continue;
    base.files[file] = key;
  }

  for (const [shardName, shardMeta] of Object.entries(incoming.shards || {})) {
    const existing = base.shards[shardName] || null;
    if (!existing) {
      base.shards[shardName] = shardMeta;
      continue;
    }
    const createdAt = resolveEarliestIso(existing.createdAt, shardMeta?.createdAt);
    const sizeBytes = Math.max(
      Number.isFinite(Number(existing.sizeBytes)) ? Number(existing.sizeBytes) : 0,
      Number.isFinite(Number(shardMeta?.sizeBytes)) ? Number(shardMeta.sizeBytes) : 0
    );
    base.shards[shardName] = { ...existing, ...shardMeta, createdAt, sizeBytes };
  }

  const baseNext = Number.isFinite(Number(base.nextShardId)) ? Number(base.nextShardId) : 0;
  const incomingNext = Number.isFinite(Number(incoming.nextShardId)) ? Number(incoming.nextShardId) : 0;
  base.nextShardId = Math.max(baseNext, incomingNext);

  if (incoming.currentShard) {
    base.currentShard = incoming.currentShard;
  }

  base.updatedAt = resolveLatestIso(base.updatedAt, incoming.updatedAt) || new Date().toISOString();
  if (!base.createdAt) base.createdAt = incoming.createdAt || base.updatedAt;
  if (!base.identityKey) base.identityKey = incoming.identityKey || null;

  return base;
};
