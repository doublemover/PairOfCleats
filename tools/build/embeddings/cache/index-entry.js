/**
 * Upsert a cache-index entry with minimal allocation.
 *
 * This helper mutates `cacheIndex.entries`/`cacheIndex.files` in place to avoid
 * cloning large index maps on every write.
 *
 * @param {object} input
 * @param {object|null} input.cacheIndex
 * @param {string|null} input.cacheKey
 * @param {object} input.payload
 * @param {object|null} [input.shardEntry]
 * @param {(chunkHashes:string[]|null|undefined)=>string|null} input.buildChunkHashesFingerprint
 * @returns {object|null}
 */
export const upsertCacheIndexEntry = ({
  cacheIndex,
  cacheKey,
  payload,
  shardEntry = null,
  buildChunkHashesFingerprint
}) => {
  if (!cacheIndex || !cacheKey || !payload) return null;
  const now = new Date().toISOString();
  const entries = cacheIndex.entries && typeof cacheIndex.entries === 'object'
    ? cacheIndex.entries
    : {};
  const existing = entries[cacheKey] || {};
  const hasShard = Boolean(shardEntry?.shard);
  const hasStandalonePath = Boolean(shardEntry?.path);
  const chunkHashesFingerprint = payload.chunkHashesFingerprint
    || (typeof buildChunkHashesFingerprint === 'function'
      ? buildChunkHashesFingerprint(payload.chunkHashes)
      : null)
    || existing.chunkHashesFingerprint
    || null;
  const chunkHashesCount = Number.isFinite(Number(payload.chunkHashesCount))
    ? Number(payload.chunkHashesCount)
    : (
      Array.isArray(payload.chunkHashes)
        ? payload.chunkHashes.length
        : (Number.isFinite(Number(existing.chunkHashesCount)) ? Number(existing.chunkHashesCount) : null)
    );
  const chunkCount = Number.isFinite(Number(payload.chunkCount))
    ? Number(payload.chunkCount)
    : (
      Array.isArray(payload.codeVectors)
        ? payload.codeVectors.length
        : (Number.isFinite(Number(existing.chunkCount)) ? Number(existing.chunkCount) : null)
    );
  const next = {
    key: cacheKey,
    file: payload.file || existing.file || null,
    hash: payload.hash || existing.hash || null,
    chunkSignature: payload.chunkSignature || existing.chunkSignature || null,
    shard: hasShard ? shardEntry.shard : (hasStandalonePath ? null : (existing.shard || null)),
    path: hasStandalonePath ? shardEntry.path : (hasShard ? null : (existing.path || null)),
    offset: hasShard
      ? (Number.isFinite(Number(shardEntry?.offset)) ? Number(shardEntry.offset) : null)
      : (hasStandalonePath ? null : (existing.offset || null)),
    length: hasShard
      ? (Number.isFinite(Number(shardEntry?.length)) ? Number(shardEntry.length) : null)
      : (hasStandalonePath ? null : (existing.length || null)),
    sizeBytes: Number.isFinite(Number(shardEntry?.sizeBytes))
      ? Number(shardEntry.sizeBytes)
      : existing.sizeBytes || null,
    chunkCount,
    chunkHashesFingerprint,
    chunkHashesCount,
    createdAt: existing.createdAt || now,
    lastAccessAt: now,
    hits: Number.isFinite(Number(existing.hits)) ? Number(existing.hits) : 0
  };

  entries[cacheKey] = next;
  cacheIndex.entries = entries;
  if (next.file) {
    const fileIndex = cacheIndex.files && typeof cacheIndex.files === 'object'
      ? cacheIndex.files
      : {};
    fileIndex[next.file] = cacheKey;
    cacheIndex.files = fileIndex;
  }
  cacheIndex.updatedAt = now;
  return next;
};
